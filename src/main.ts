// muOS Anbernic Manager: scans Roms/, then serves the manager app on 127.0.0.1 until Ctrl-C.
// Usage: node src/main.ts [--no-open] [--port N] [--refresh-names] [--refresh-descriptions]
//                         [--skip-descriptions] [--tf2-dir DIR] [--root DIR] [--cache-dir DIR]

import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { startActivityLog } from "./activity.ts";
import { ctx, setRoot } from "./context.ts";
import { disconnect } from "./device/mtp.ts";
import { closeSftp } from "./device/sftp.ts";
import { closeSsh } from "./device/ssh.ts";
import { rescanLibrary } from "./games/library.ts";
import { ensureArcadeNames, ensureDescriptions } from "./games/metadata.ts";
import { cancelJob, jobRunning, waitForJob } from "./jobs.ts";
import { C, dim, human, say } from "./log.ts";
import { platform } from "./platform/index.ts";
import { listen, onShutdown } from "./server.ts";
import { loadSettings, settings } from "./settings.ts";
import { isDir } from "./util.ts";

const USAGE = `Usage: run.sh [options]

Starts the muOS Anbernic Manager. It scans Roms/ (every ROM grouped by system, with
artwork from each system's Imgs/ folder and game descriptions from the LaunchBox
Games Database) and serves the manager on 127.0.0.1.

The manager works with one device at a time: TF2 in the card reader, or the
handheld over USB with USB Function set to MTP (needs libmtp; on a Mac:
brew install libmtp). Overview shows the connection, the device, its storage and
what is on it. Games copies ROMs (all, one system, or one game), shows the games
on the device so you can delete them and manage their artwork, gets the artwork
Scrappy saved into Roms/<system>/Imgs, and sends Roms/ artwork to the device.
Keep it running while you use it and press Ctrl-C to stop.

  --no-open               do not open the browser
  --port N                first port to try (default 8765)
  --refresh-names         download the arcade title list again
  --refresh-descriptions  download the game descriptions again (about 110 MB)
  --skip-descriptions     do not download descriptions; use the cached ones if any
  --tf2-dir DIR           use a folder holding ROMS/ and ARCHIVE/ as the TF2 card (testing)
  --root DIR              workspace holding Roms/ (default: the folder above muos-anbernic-manager/)
  --cache-dir DIR         keep downloads, settings and logins there instead of muos-anbernic-manager/.cache (testing)`;

interface Instance { pid: number; port: number; token: string }

/** One file per workspace, so a test run with --root never stops the manager for the real Roms/. */
const instanceFile = () =>
  path.join(ctx.cacheDir, `instance-${crypto.createHash("sha1").update(ctx.root).digest("hex").slice(0, 12)}.json`);

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Asks a manager still running for this workspace to stop, so it lets go of the handheld's USB connection
 *  before this one starts. Only a process that answers with its token is stopped; a stale file is ignored. */
async function stopPrevious(): Promise<Instance | null> {
  let prev: Instance;
  try {
    prev = JSON.parse(await fsp.readFile(instanceFile(), "utf8"));
  } catch {
    return null;
  }
  if (!prev.pid || prev.pid === process.pid || !alive(prev.pid)) return null;
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${prev.port}/api/shutdown`, {
      method: "POST", body: "{}", signal: AbortSignal.timeout(4000),
      headers: { "Content-Type": "application/json", "X-Manager-Token": prev.token },
    });
  } catch {
    return null;
  }
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    say("red", "STOPPED", error ?? `The manager already running (pid ${prev.pid}) did not stop.`);
    process.exit(1);
  }
  say("yellow", "RESTART", `Stopped the manager that was still running (pid ${prev.pid}) so the handheld is free.`);
  const until = Date.now() + 10_000;
  while (alive(prev.pid) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 200));
  if (alive(prev.pid)) process.kill(prev.pid, "SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 300));
  return prev;
}

const WIDTH = 58;
const rule = () => console.log(`  ${C.green}+${"-".repeat(WIDTH)}+${C.reset}`);
const row = (text: string, faint = false) =>
  console.log(`  ${C.green}|${C.reset}${faint ? C.dim : ""}${` ${text}`.padEnd(WIDTH)}${faint ? C.reset : ""}${C.green}|${C.reset}`);

async function main(): Promise<void> {
  let args;
  try {
    args = parseArgs({
      options: {
        "no-open": { type: "boolean" }, port: { type: "string" }, "refresh-names": { type: "boolean" },
        "refresh-descriptions": { type: "boolean" }, "skip-descriptions": { type: "boolean" },
        "tf2-dir": { type: "string" }, root: { type: "string" }, "cache-dir": { type: "string" }, help: { type: "boolean", short: "h" },
      },
    }).values;
  } catch (error) {
    console.log(USAGE);
    say("red", "STOPPED", (error as Error).message);
    process.exit(1);
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (args.root) setRoot(args.root);
  if (args["cache-dir"]) ctx.cacheDir = path.resolve(args["cache-dir"]);
  if (args["tf2-dir"]) {
    ctx.tf2Dir = path.resolve(args["tf2-dir"]);
    if (!(await isDir(path.join(ctx.tf2Dir, "ROMS"))) || !(await isDir(path.join(ctx.tf2Dir, "ARCHIVE")))) {
      say("red", "STOPPED", `${ctx.tf2Dir} needs ROMS and ARCHIVE folders.`);
      process.exit(1);
    }
  }
  await loadSettings();
  if (!(await isDir(ctx.roms))) {
    if (!settings().roms) {
      say("red", "STOPPED", `${ctx.roms} does not exist.`);
      process.exit(1);
    }
    say("yellow", "CHECK", `The Roms folder ${ctx.roms} is not available. Connect its drive, or choose another in Settings.`);
  }

  console.log();
  console.log(`  ${C.cyan}${C.bold} muOS Anbernic Manager ${C.reset}`);
  dim("Device status, games and artwork for the handheld.");
  console.log();
  dim(`Using ${ctx.managerDir} (Node ${process.versions.node}, ${platform.name})`);
  await fsp.mkdir(ctx.cacheDir, { recursive: true });
  await startActivityLog();
  const previous = await stopPrevious();
  await ensureArcadeNames(!!args["refresh-names"]);
  await ensureDescriptions(args["skip-descriptions"] ? "skip" : args["refresh-descriptions"] ? "refresh" : "auto");

  dim("Scanning Roms/...");
  const { totals } = await rescanLibrary();
  const pct = (n: number) => (totals.games ? Math.floor((n * 100) / totals.games) : 0);
  console.log();
  rule();
  row("MANAGER READY");
  row(`Systems   ${totals.filled} with games, ${totals.systems} in total`, true);
  row(`Games     ${totals.games} (${human(totals.bytes)})`, true);
  row(`Artwork   ${totals.art} games (${pct(totals.art)}%)`, true);
  row(`Arcade    ${totals.arcade} full titles`, true);
  row(`About     ${totals.described} descriptions (${pct(totals.described)}%)`, true);
  rule();
  console.log();

  // Taking over the previous token and port lets a manager tab that is already open carry on after a reload.
  ctx.token = previous?.token ?? crypto.randomBytes(24).toString("base64url");
  const server = await listen(Number(args.port) || previous?.port || 8765);
  if (previous && ctx.port !== previous.port) ctx.token = crypto.randomBytes(24).toString("base64url");
  await fsp.writeFile(instanceFile(), JSON.stringify({ pid: process.pid, port: ctx.port, token: ctx.token }), { mode: 0o600 });
  const url = `http://127.0.0.1:${ctx.port}/?token=${ctx.token}`;
  say("green", "SERVING", `http://127.0.0.1:${ctx.port}/`);
  if (ctx.tf2Dir) say("yellow", "TEST", `Using ${ctx.tf2Dir} as the TF2 card.`);
  dim("Keep this window open while you use the manager. Press Ctrl-C to stop.");
  console.log();
  const reuseTab = previous && ctx.token === previous.token;
  if (args["no-open"] || reuseTab || !settings().openBrowser) dim(`${reuseTab ? "Reload the open manager tab, or open" : "Open"}: ${url}\n`);
  else platform.openUrl(url);

  let stopping = false;
  const stop = async () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log();
    if (jobRunning()) {
      say("yellow", "STOPPING", "Finishing the current file cleanup...");
      cancelJob();
      await waitForJob();
    }
    server.close();
    // A hung USB call must not keep the process alive: exiting frees the handheld's USB interface anyway.
    await Promise.race([Promise.all([disconnect(), closeSftp(), closeSsh()]), new Promise((resolve) => setTimeout(resolve, 5000))]);
    try {
      const mine = JSON.parse(await fsp.readFile(instanceFile(), "utf8")) as Instance;
      if (mine.pid === process.pid) await fsp.rm(instanceFile(), { force: true });
    } catch {}
    say("cyan", "CLOSED", "Manager stopped.");
    console.log();
    process.exit(0);
  };
  // Closing the Terminal window (SIGHUP) or a kill (SIGTERM) must also let go of the USB session.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, stop);
  onShutdown(() => {
    say("yellow", "RESTART", "A new manager was started for this workspace; stopping this one.");
    void stop();
  });
}

main().catch((error) => {
  say("red", "STOPPED", (error as Error).message);
  process.exit(1);
});
