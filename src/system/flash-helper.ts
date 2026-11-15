// Runs as root (started through the macOS administrator prompt) to write a MustardOS image to a card and read it back.
// Usage: node flash-helper.ts <args.json>. Reports JSON lines to the progress file named in the arguments.
// Only Node built-ins: this file must not pull in the rest of the manager while running as root.
// Raw disk I/O goes through /bin/dd — Node's open() on /dev/rdisk* often returns EPERM on recent macOS even as root.

import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

interface Args {
  image: string;
  kind: "raw" | "gz";
  bytes: number;
  payloadHash: string;
  disk: string;
  size: number;
  progress: string;
  cancel: string;
}

const CHUNK = 4 * 1024 * 1024;
const args = JSON.parse(fs.readFileSync(process.argv[2], "utf8")) as Args;
const emit = (line: object) => fs.appendFileSync(args.progress, JSON.stringify(line) + "\n");

function fail(message: string, code = 1): never {
  try { emit({ error: message }); } catch { /* progress file may be gone */ }
  console.error(message);
  process.exit(code);
}

function cancelled(verifying = false): void {
  if (!fs.existsSync(args.cancel)) return;
  fail(verifying ? "Cancelled before the read-back finished. The card was written but not verified." : "Cancelled. The card is incomplete; install again before using it.", 3);
}

let last = 0;
function report(stage: string, done: number, final = false): void {
  const now = Date.now();
  if (!final && now - last < 250) return;
  last = now;
  emit({ stage, done, total: args.bytes });
}

/** A key from diskutil's XML plist, as a string ("true", "false", the text or the number). */
function key(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<key>${name}</key>\\s*(?:<(true|false)/>|<string>([^<]*)</string>|<integer>(\\d+)</integer>)`));
  return m ? m[1] ?? m[2] ?? m[3] ?? "" : "";
}

function why(error: unknown): string {
  const e = error as NodeJS.ErrnoException & { stderr?: Buffer };
  if (e?.stderr?.length) return e.stderr.toString().trim() || e.message;
  return e?.code ? `${e.code}: ${e.message}` : (e?.message || String(error));
}

const rawPaths = () => [`/dev/r${args.disk}`, `/dev/${args.disk}`];

const mounted = () => execFileSync("mount", { encoding: "utf8" }).split("\n").filter((l) => l.startsWith(`/dev/${args.disk}s`));

function unmount(): void {
  execFileSync("diskutil", ["unmountDisk", "force", `/dev/${args.disk}`], { stdio: "ignore" });
}

/** Run /bin/dd; prefer rdisk, fall back to disk. Throws on failure. */
function dd(ddArgs: string[]): { path: string } {
  let lastErr = "";
  for (const dev of rawPaths()) {
    try {
      execFileSync("/bin/dd", ddArgs.map((a) => a.replaceAll("%DEV%", dev)), {
        stdio: ["ignore", "ignore", "pipe"],
        maxBuffer: 4 * 1024 * 1024,
      });
      return { path: dev };
    } catch (error) {
      lastErr = why(error);
    }
  }
  throw new Error(lastErr || "dd failed on the card.");
}

if (typeof process.getuid === "function" && process.getuid() !== 0) {
  fail("The installer is not running as administrator. Enter your macOS password when asked, and try again.");
}
if (!/^disk\d+$/.test(args.disk)) fail("Refusing an unusual disk identifier.");
if (!Number.isSafeInteger(args.bytes) || args.bytes <= 0 || args.bytes % 512) fail("The image length is not whole sectors.");

const info = execFileSync("diskutil", ["info", "-plist", `/dev/${args.disk}`], { encoding: "utf8" });
const external = key(info, "Internal") === "false" && key(info, "RemovableMedia") === "true" && key(info, "WholeDisk") === "true"
  && key(info, "VirtualOrPhysical") === "Physical" && key(info, "Writable") === "true" && key(info, "Ejectable") === "true";
if (!external) fail(`${args.disk} is not an external removable card. Nothing was written.`);
if (Number(key(info, "TotalSize")) !== args.size) fail(`${args.disk} changed since it was picked. Nothing was written.`);
if (args.bytes > args.size) fail("The image is larger than the card. Nothing was written.");

unmount();
if (mounted().length) fail(`Part of ${args.disk} is still mounted. Nothing was written.`);

// Clear the old MBR/GPT via dd so leftover volumes cannot remount mid-write.
// Node fs.open on /dev/rdisk* often returns EPERM on recent macOS even as root; /bin/dd works.
emit({ stage: "prepare", done: 0, total: 1 });
cancelled();
try {
  dd(["if=/dev/zero", "of=%DEV%", "bs=1m", "count=10"]);
} catch (error) {
  // Card left as Free Space / no content after a prior failed prepare can refuse I/O until reformatted.
  try {
    execFileSync("diskutil", ["eraseDisk", "FAT32", "MUOSTEMP", "MBRFormat", `/dev/${args.disk}`], { stdio: "pipe" });
  } catch (eraseErr) {
    fail(`Could not clear the old partition map on ${args.disk}: ${why(error)}. Reformatting also failed: ${why(eraseErr)}. Nothing was written.`);
  }
  unmount();
  try {
    dd(["if=/dev/zero", "of=%DEV%", "bs=1m", "count=10"]);
  } catch (retryErr) {
    fail(`Could not clear the old partition map on ${args.disk}: ${why(retryErr)}. Nothing was written.`);
  }
}
execFileSync("sync");
unmount();
if (mounted().length) fail(`Part of ${args.disk} remounted after clearing. Nothing was written.`);
emit({ stage: "prepare", done: 1, total: 1 });

emit({ stage: "write", done: 0, total: args.bytes });

async function writeImage(): Promise<string> {
  let lastErr = "";
  for (const dev of rawPaths()) {
    cancelled();
    const ddProc = spawn("/bin/dd", [`of=${dev}`, `bs=${CHUNK}`, "conv=fsync"], { stdio: ["pipe", "ignore", "pipe"] });
    let ddErr = "";
    ddProc.stderr.on("data", (d: Buffer) => { ddErr += d.toString(); });
    const hasher = crypto.createHash("sha256");
    let written = 0;
    const tally = new Transform({
      transform(chunk, _enc, cb) {
        try {
          cancelled();
          if (written >= args.bytes) { cb(); return; }
          const take = Math.min(chunk.length, args.bytes - written);
          const slice = take === chunk.length ? chunk : chunk.subarray(0, take);
          hasher.update(slice);
          written += take;
          report("write", written);
          cb(null, slice);
        } catch (error) {
          cb(error as Error);
        }
      },
    });
    const file = fs.createReadStream(args.image, { highWaterMark: CHUNK });
    const source = args.kind === "gz" ? file.pipe(zlib.createGunzip()) : file;
    try {
      const done = new Promise<void>((resolve, reject) => {
        ddProc.on("error", reject);
        ddProc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(ddErr.trim() || `dd exited ${code}`))));
      });
      await pipeline(source, tally, ddProc.stdin!);
      await done;
      if (written !== args.bytes) fail(`The image ended early at ${written} of ${args.bytes} bytes. The card is incomplete.`);
      if (hasher.digest("hex") !== args.payloadHash) fail("The image changed while it was being written. Install again.");
      report("write", written, true);
      return dev;
    } catch (error) {
      try { ddProc.kill("SIGKILL"); } catch { /* ignore */ }
      lastErr = why(error);
      // Try the next device path.
    }
  }
  fail(`Writing to the card failed: ${lastErr}. Try another reader or card.`);
}

async function verifyImage(dev: string): Promise<void> {
  emit({ stage: "verify", done: 0, total: args.bytes });
  const blocks = Math.ceil(args.bytes / CHUNK);
  const ddProc = spawn("/bin/dd", [`if=${dev}`, `bs=${CHUNK}`, `count=${blocks}`], { stdio: ["ignore", "pipe", "pipe"] });
  let ddErr = "";
  ddProc.stderr.on("data", (d: Buffer) => { ddErr += d.toString(); });
  const back = crypto.createHash("sha256");
  let read = 0;
  await new Promise<void>((resolve, reject) => {
    ddProc.on("error", reject);
    ddProc.stdout!.on("data", (chunk: Buffer) => {
      try {
        cancelled(true);
        if (read >= args.bytes) return;
        const take = Math.min(chunk.length, args.bytes - read);
        back.update(chunk.subarray(0, take));
        read += take;
        report("verify", read);
      } catch (error) {
        reject(error);
      }
    });
    ddProc.on("close", (code) => {
      if (code === 0 || read >= args.bytes) resolve();
      else reject(new Error(ddErr.trim() || `dd exited ${code}`));
    });
  });
  report("verify", read, true);
  if (read < args.bytes) fail("The card ended before the image did.");
  if (back.digest("hex") !== args.payloadHash) fail("Read-back does not match the image. Try another card reader or card, and do not boot this card.");
}

writeImage().then(async (dev) => {
  execFileSync("sync");
  if (mounted().length) fail("macOS mounted part of the card during the write, so it may have changed. Install again.");
  await verifyImage(dev);
  emit({ stage: "done" });
}).catch((error) => {
  fail(`Writing to the card failed: ${why(error)}. Try another reader or card.`);
});
