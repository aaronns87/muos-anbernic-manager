// Runs as root (started through the macOS administrator prompt) to write a MustardOS image to a card and read it back.
// Usage: node flash-helper.ts <args.json>. Reports JSON lines to the progress file named in the arguments.
// Only Node built-ins: this file must not pull in the rest of the manager while running as root.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
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
  emit({ error: message });
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

if (!/^disk\d+$/.test(args.disk)) fail("Refusing an unusual disk identifier.");
if (!Number.isSafeInteger(args.bytes) || args.bytes <= 0 || args.bytes % 512) fail("The image length is not whole sectors.");

const info = execFileSync("diskutil", ["info", "-plist", `/dev/${args.disk}`], { encoding: "utf8" });
const external = key(info, "Internal") === "false" && key(info, "RemovableMedia") === "true" && key(info, "WholeDisk") === "true"
  && key(info, "VirtualOrPhysical") === "Physical" && key(info, "Writable") === "true" && key(info, "Ejectable") === "true";
if (!external) fail(`${args.disk} is not an external removable card. Nothing was written.`);
if (Number(key(info, "TotalSize")) !== args.size) fail(`${args.disk} changed since it was picked. Nothing was written.`);
if (args.bytes > args.size) fail("The image is larger than the card. Nothing was written.");

execFileSync("diskutil", ["unmountDisk", "force", `/dev/${args.disk}`], { stdio: "ignore" });
const mounted = () => execFileSync("mount", { encoding: "utf8" }).split("\n").filter((l) => l.startsWith(`/dev/${args.disk}s`));
if (mounted().length) fail(`Part of ${args.disk} is still mounted. Nothing was written.`);

emit({ stage: "write", done: 0, total: args.bytes });
const raw = `/dev/r${args.disk}`;
const buf = Buffer.allocUnsafe(CHUNK);
const hasher = crypto.createHash("sha256");
let fill = 0, written = 0;
const out = fs.openSync(raw, fs.constants.O_WRONLY);

function flush(): void {
  let off = 0;
  while (off < fill) off += fs.writeSync(out, buf, off, fill - off, written + off);
  written += fill;
  fill = 0;
  report("write", written);
}

const file = fs.createReadStream(args.image, { highWaterMark: CHUNK });
const source: AsyncIterable<Buffer> = args.kind === "gz" ? file.pipe(zlib.createGunzip()) : file;
try {
  for await (const chunk of source) {
    cancelled();
    let pos = 0;
    while (pos < chunk.length) {
      if (written + fill >= args.bytes) fail("The image continues past its backup GPT. Install again with an intact image.");
      const take = Math.min(chunk.length - pos, CHUNK - fill, args.bytes - written - fill);
      chunk.copy(buf, fill, pos, pos + take);
      hasher.update(chunk.subarray(pos, pos + take));
      fill += take;
      pos += take;
      if (fill === CHUNK) flush();
    }
  }
} catch (error) {
  fail(`Reading the image failed: ${(error as Error).message}. The card is incomplete.`);
}
if (fill) flush();
try {
  fs.fsyncSync(out);
} catch {}
fs.closeSync(out);
execFileSync("sync");
report("write", written, true);
if (written !== args.bytes) fail(`The image ended early at ${written} of ${args.bytes} bytes. The card is incomplete.`);
if (hasher.digest("hex") !== args.payloadHash) fail("The image changed while it was being written. Install again.");
if (mounted().length) fail("macOS mounted part of the card during the write, so it may have changed. Install again.");

emit({ stage: "verify", done: 0, total: args.bytes });
const back = crypto.createHash("sha256");
const input = fs.openSync(raw, fs.constants.O_RDONLY);
let read = 0;
while (read < args.bytes) {
  cancelled(true);
  const n = fs.readSync(input, buf, 0, Math.min(CHUNK, args.bytes - read), read);
  if (!n) fail("The card ended before the image did.");
  back.update(buf.subarray(0, n));
  read += n;
  report("verify", read);
}
fs.closeSync(input);
report("verify", read, true);
if (back.digest("hex") !== args.payloadHash) fail("Read-back does not match the image. Try another card reader or card, and do not boot this card.");
emit({ stage: "done" });
