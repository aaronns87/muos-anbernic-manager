// The manager's own version: VERSION in this folder against VERSION on the GitHub repository's main branch
// (from package.json "repository"), and updating itself: a git clone with a fast-forward pull, a downloaded copy
// by swapping in the files of GitHub's ZIP of main. Either way run.sh restarts it afterwards.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import { ctx } from "./context.ts";
import { UserError } from "./errors.ts";
import { requireIdle } from "./jobs.ts";
import { say } from "./log.ts";
import { run } from "./platform/run.ts";
import { settings } from "./settings.ts";
import { compareVersions } from "./updates.ts";
import { exists, listDir } from "./util.ts";

const CHECK_EVERY = 3 * 60 * 60 * 1000;
const RETRY_AFTER = 15 * 60 * 1000;
/** run.sh starts the manager again when it exits with this code, and sets MANAGER_RESTART=1. */
export const RESTART_CODE = 75;
/** npm may rewrite the lock file on its own; it is generated, so it never blocks an update. */
const LOCK = "package-lock.json";
/** A ZIP update replaces everything the release holds, never these. */
const KEEP = new Set([".cache", ".git", "node_modules"]);
const STAGE = ".update-new";
/** The replaced files of the last ZIP update, until the next one. */
const PREVIOUS = ".update-old";

interface Remote { version: string; checked: number; next: number; error: string }
let remote: Remote = { version: "", checked: 0, next: 0, error: "" };
let checking: Promise<void> | null = null;
let running = "";
let updating = false;
const STARTED = Date.now();
let restartHook: () => void = () => {};

export function onRestart(fn: () => void): void {
  restartHook = fn;
}

const canRestart = () => process.env.MANAGER_RESTART === "1";

/** Restarts through run.sh shortly after the reply is sent; false when the manager was not started by it. */
export function restartManager(): boolean {
  if (!canRestart()) return false;
  setTimeout(() => restartHook(), 400);
  return true;
}

export const startedAt = () => STARTED;

const diskVersion = async () => (await fsp.readFile(path.join(ctx.managerDir, "VERSION"), "utf8").catch(() => "")).trim();

/** The version this process started with (main.ts reads it first); VERSION on disk changes when an update brings a new one. */
export async function runningVersion(): Promise<string> {
  if (!running) running = (await diskVersion()) || "0";
  return running;
}

/** "owner/name" from a GitHub repository URL. */
export function githubRepo(url: string): string {
  return /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? "";
}

async function repoName(): Promise<string> {
  try {
    const pkg = JSON.parse(await fsp.readFile(path.join(ctx.managerDir, "package.json"), "utf8"));
    return githubRepo(typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? "");
  } catch {
    return "";
  }
}

async function checkRemote(name: string): Promise<void> {
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${name}/main/VERSION`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!res.ok) throw new Error(res.status === 404 ? "GitHub has no VERSION file yet" : `GitHub answered ${res.status}`);
    const version = (await res.text()).trim();
    if (!/^\d+(\.\d+)*$/.test(version)) throw new Error("GitHub's VERSION file holds no version number");
    remote = { version, checked: Date.now(), next: Date.now() + CHECK_EVERY, error: "" };
  } catch (error) {
    const e = error as Error;
    const message = e.name === "TimeoutError" ? "GitHub did not answer" : e instanceof TypeError ? "GitHub could not be reached" : e.message;
    remote = { ...remote, next: Date.now() + RETRY_AFTER, error: message };
  }
}

const git = (...args: string[]) => run("git", ["-C", ctx.managerDir, ...args], 120_000);

interface Install {
  /** "git": a clone, updated with git pull. "zip": downloaded files, updated from GitHub's ZIP of main. */
  method: "git" | "zip";
  branch: string;
  commit: string;
  changed: string[];
  /** Why Update now cannot run here; "" when it can. */
  blocker: string;
}

async function install(name: string): Promise<Install> {
  const base = { branch: "", commit: "", changed: [] as string[], blocker: "" };
  if (await exists(path.join(ctx.managerDir, ".git"))) {
    const top = await git("rev-parse", "--show-toplevel");
    if (top.code === -1) return { method: "git", ...base, blocker: "This copy was installed with git, but git is not available now. Install git, or update from a terminal." };
    const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
    if (top.code === 0 && real(top.stdout.trim()) === real(ctx.managerDir)) {
      const [branch, commit, status] = await Promise.all([
        git("rev-parse", "--abbrev-ref", "HEAD"), git("rev-parse", "--short", "HEAD"), git("status", "--porcelain", "--untracked-files=no"),
      ]);
      const state = {
        method: "git" as const, branch: branch.stdout.trim(), commit: commit.stdout.trim(), blocker: "",
        changed: status.stdout.split("\n").filter(Boolean).map((line) => line.slice(3)).filter((f) => f !== LOCK),
      };
      if (state.branch !== "main") state.blocker = `The manager folder is on branch ${state.branch}; updates come to main.`;
      else if (state.changed.length) state.blocker = "Files in the manager folder were changed, so a pull could clash with them.";
      return state;
    }
  }
  if (!name) return { method: "zip", ...base, blocker: "package.json names no GitHub repository to download from." };
  try {
    await fsp.access(ctx.managerDir, fs.constants.W_OK);
  } catch {
    return { method: "zip", ...base, blocker: "The manager folder is read-only for this user." };
  }
  return { method: "zip", ...base };
}

export async function managerStatus(refresh = false) {
  const name = await repoName();
  const enabled = settings().checkUpdates;
  if (name && enabled && (refresh || Date.now() > remote.next)) {
    checking ??= checkRemote(name).finally(() => { checking = null; });
    await checking;
  }
  const version = await runningVersion();
  const onDisk = (await diskVersion()) || version;
  const have = compareVersions(onDisk, version) > 0 ? onDisk : version;
  return {
    version,
    started: STARTED,
    pulled: have !== version ? have : "",
    latest: enabled ? remote.version : "",
    newer: enabled && !!remote.version && compareVersions(remote.version, have) > 0,
    checked: enabled && remote.checked ? remote.checked : 0,
    error: enabled ? remote.error : "",
    enabled,
    home: name ? `https://github.com/${name}` : "",
    dir: ctx.managerDir,
    canRestart: canRestart(),
    install: await install(name),
  };
}

async function pull(state: Install): Promise<boolean> {
  await git("checkout", "--", LOCK);
  const res = await git("pull", "--ff-only", "--quiet", "origin", "main");
  if (res.code !== 0) {
    const why = (res.stderr || res.stdout).trim().split("\n").slice(-3).join(" ");
    throw new UserError(`git pull did not work${why ? `: ${why}` : ""}`);
  }
  return (await git("rev-parse", "--short", "HEAD")).stdout.trim() !== state.commit;
}

function unzip(file: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("Could not open the download."));
      const fail = (e: unknown) => {
        zip.close();
        reject(e);
      };
      zip.on("error", fail);
      zip.on("end", () => resolve());
      zip.on("entry", (entry: yauzl.Entry) => {
        const name = entry.fileName.replaceAll("\\", "/");
        if (name.endsWith("/")) return zip.readEntry();
        const out = path.join(dest, ...name.split("/"));
        if (!out.startsWith(dest + path.sep)) return fail(new UserError("The download holds an unsafe path."));
        const mode = (entry.externalFileAttributes >>> 16) & 0o777;
        fsp.mkdir(path.dirname(out), { recursive: true }).then(() => zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return fail(err ?? new Error("Could not read the download."));
          pipeline(stream, fs.createWriteStream(out, mode ? { mode } : {})).then(() => zip.readEntry(), fail);
        }), fail);
      });
      zip.readEntry();
    });
  });
}

/** Downloads GitHub's ZIP of main and swaps its files into the manager folder; the old ones go to .update-old,
 *  and come back if any step fails. */
async function replaceFromZip(name: string): Promise<boolean> {
  const dir = ctx.managerDir, stage = path.join(dir, STAGE), old = path.join(dir, PREVIOUS), file = path.join(dir, ".update.zip");
  await fsp.rm(stage, { recursive: true, force: true });
  try {
    const res = await fetch(`https://codeload.github.com/${name}/zip/refs/heads/main`, { signal: AbortSignal.timeout(120_000) })
      .catch((error: Error) => {
        throw new UserError(error.name === "TimeoutError" ? "The download from GitHub took too long. Try again later."
          : "Could not reach GitHub. Check the internet connection and try again.");
      });
    if (!res.ok) throw new UserError(`GitHub answered ${res.status} for the download.`);
    await fsp.writeFile(file, Buffer.from(await res.arrayBuffer()));
    await unzip(file, stage);
    const top = await listDir(stage);
    const root = top.length === 1 && top[0].isDirectory() ? path.join(stage, top[0].name) : stage;
    for (const need of ["VERSION", "package.json", path.join("src", "main.ts")]) {
      if (!(await exists(path.join(root, need)))) throw new UserError(`The download has no ${need}; nothing was changed.`);
    }
    const next = (await fsp.readFile(path.join(root, "VERSION"), "utf8")).trim();
    if (compareVersions(next, (await diskVersion()) || "0") <= 0) return false;
    const names = (await listDir(root)).map((e) => e.name).filter((n) => !KEEP.has(n));
    await fsp.rm(old, { recursive: true, force: true });
    await fsp.mkdir(old);
    const moved: string[] = [];
    try {
      for (const n of names) {
        moved.push(n);
        if (await exists(path.join(dir, n))) await fsp.rename(path.join(dir, n), path.join(old, n));
        await fsp.rename(path.join(root, n), path.join(dir, n));
      }
    } catch (error) {
      for (const n of moved.reverse()) {
        if (!(await exists(path.join(old, n)))) continue;
        await fsp.rm(path.join(dir, n), { recursive: true, force: true }).catch(() => {});
        await fsp.rename(path.join(old, n), path.join(dir, n)).catch(() => {});
      }
      throw new UserError(`Could not replace the manager's files (${(error as Error).message}); the old ones are back in place.`);
    }
    return true;
  } finally {
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(file, { force: true }).catch(() => {});
  }
}

/** Updates the manager to GitHub's main branch the way it was installed; restarts through run.sh when it can. */
export async function updateManager() {
  requireIdle("Wait for the current job to finish before updating the manager.");
  if (updating) throw new UserError("The manager is updating already.");
  await runningVersion();
  const name = await repoName();
  const state = await install(name);
  if (state.blocker) throw new UserError(state.blocker);
  updating = true;
  let updated: boolean;
  try {
    updated = state.method === "git" ? await pull(state) : await replaceFromZip(name);
  } finally {
    updating = false;
  }
  const version = (await diskVersion()) || (await runningVersion());
  const restart = updated && canRestart();
  if (updated) say("green", "UPDATED", `The manager is now at version ${version}.${restart ? " Restarting..." : " Restart it to use the new version."}`);
  if (restart) setTimeout(() => restartHook(), 400);
  return { updated, restart, ...(await managerStatus()) };
}
