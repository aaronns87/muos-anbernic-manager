// Per-game save and save-state browser over SSH/SFTP (alongside full-device tar backups).

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { STORAGE, deviceSaves, type DeviceSave } from "./saves.ts";
import { UserError } from "./errors.ts";
import { ctx } from "./context.ts";
import { files, human, say } from "./log.ts";
import { runCommand, streamCommand } from "./device/ssh.ts";
import { platform } from "./platform/index.ts";
import { splitName, shq as quote } from "./util.ts";

const PULLED = "saves-pulled";

function stemOf(file: string): string {
  return splitName(file)[0];
}

export function savesForStem(all: DeviceSave[], file: string): DeviceSave[] {
  const stem = stemOf(file);
  return all.filter((f) => {
    const base = path.posix.basename(f.path);
    return base === stem || base.startsWith(`${stem}.`);
  });
}

function pulledRoot(): string {
  return path.join(ctx.backups, PULLED);
}

function pulledPath(devicePath: string): string {
  const rel = devicePath.replace(/^\//, "");
  return path.join(pulledRoot(), rel);
}

async function requireDevice() {
  const dev = await deviceSaves();
  if (!dev.reachable) throw new UserError("Connect the handheld over Wi-Fi with SSH on.");
  if (!dev.frontend) throw new UserError("A game is open on the handheld. Close it and go back to the menu first.");
  return dev;
}

export async function gameSavesJson(query: URLSearchParams) {
  const code = String(query.get("code") ?? "");
  const file = String(query.get("file") ?? "");
  if (!code || !file) throw new UserError("Pick a game first.");
  let dev: Awaited<ReturnType<typeof deviceSaves>>;
  let deviceError = "";
  try {
    dev = await deviceSaves();
  } catch (error) {
    dev = { reachable: false, host: "", files: [], frontend: false };
    deviceError = (error as Error).message;
  }
  const matched = dev.reachable ? savesForStem(dev.files, file) : [];
  const pulled = matched.map((f) => ({ path: f.path, local: fs.existsSync(pulledPath(f.path)) }));
  return { code, file, reachable: dev.reachable, host: dev.host, frontend: dev.frontend, files: matched, pulled, deviceError };
}

export async function pullGameSave(body: Record<string, unknown>) {
  const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];
  if (!paths.length) throw new UserError("Pick the files to pull.");
  const dev = await requireDevice();
  const known = new Set(dev.files.map((f) => f.path));
  for (const p of paths) if (!known.has(p)) throw new UserError(`${p} is not on the handheld.`);
  let done = 0;
  for (const p of paths) {
    const dest = pulledPath(p);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const full = path.posix.join(STORAGE, p);
    const { code, err } = await streamCommand(`cat ${quote(full)}`, { stdout: fs.createWriteStream(dest) });
    if (code !== 0) throw new UserError(`Could not pull ${p}${err ? `: ${err.trim()}` : ""}.`);
    done++;
  }
  say("green", "PULLED", `${files(done)} save data to backups/${PULLED}/.`);
  const detail = await gameSavesJson(new URLSearchParams({ code: String(body.code ?? ""), file: String(body.file ?? "") }));
  return { ...detail, pulled: done };
}

export async function pushGameSave(body: Record<string, unknown>) {
  const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];
  if (!paths.length) throw new UserError("Pick the files to push.");
  await requireDevice();
  let done = 0;
  for (const p of paths) {
    const src = pulledPath(p);
    if (!fs.existsSync(src)) throw new UserError(`${path.basename(p)} is not in backups/${PULLED}/ yet. Pull it first.`);
    const full = path.posix.join(STORAGE, p);
    const dir = path.posix.dirname(full);
    const { code, err } = await streamCommand(`mkdir -p ${quote(dir)} && cat > ${quote(full)} && sync`, { stdin: fs.createReadStream(src) });
    if (code !== 0) throw new UserError(`Could not push ${p}${err ? `: ${err.trim()}` : ""}.`);
    done++;
  }
  say("green", "PUSHED", `${files(done)} save files back to the handheld.`);
  return { pushed: done, ...(await gameSavesJson(new URLSearchParams({ code: String(body.code ?? ""), file: String(body.file ?? "") }))) };
}

export async function deleteGameSave(body: Record<string, unknown>) {
  const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];
  if (!paths.length) throw new UserError("Pick the files to delete.");
  const dev = await requireDevice();
  const known = new Set(dev.files.map((f) => f.path));
  for (const p of paths) if (!known.has(p)) throw new UserError(`${p} is not on the handheld.`);
  const list = paths.map(quote).join(" ");
  const { code, err } = await runCommand(`cd ${STORAGE} && rm -f ${list} && sync && echo @ok`, 60_000);
  if (code !== 0) throw new UserError(`Could not delete on the handheld${err ? `: ${err.trim()}` : ""}.`);
  say("yellow", "DELETED", `${files(paths.length)} on the handheld (${human(paths.reduce((n, p) => n + (dev.files.find((f) => f.path === p)?.size ?? 0), 0))}).`);
  return { deleted: paths.length, ...(await gameSavesJson(new URLSearchParams({ code: String(body.code ?? ""), file: String(body.file ?? "") }))) };
}

export async function pruneGameStates(body: Record<string, unknown>) {
  const keep = Math.max(1, Math.min(99, Number(body.keep) || 5));
  const file = String(body.file ?? "");
  if (!file) throw new UserError("Pick a game first.");
  const dev = await requireDevice();
  const stem = stemOf(file);
  const states = dev.files
    .filter((f) => /(^|\/)state\//.test(f.path) && !/\.png$/i.test(f.path))
  .filter((f) => {
      const base = path.posix.basename(f.path);
      return base === stem || base.startsWith(`${stem}.`);
    })
    .sort((a, b) => b.mtime - a.mtime);
  const drop = states.slice(keep);
  if (!drop.length) return { pruned: 0, kept: states.length, ...(await gameSavesJson(new URLSearchParams({ code: String(body.code ?? ""), file }))) };
  const list = drop.map((f) => quote(f.path)).join(" ");
  const { code, err } = await runCommand(`cd ${STORAGE} && rm -f ${list} && sync && echo @ok`, 60_000);
  if (code !== 0) throw new UserError(`Prune failed on the handheld${err ? `: ${err.trim()}` : ""}.`);
  say("yellow", "PRUNED", `Kept ${keep} save states for ${stem}; removed ${drop.length}.`);
  return { pruned: drop.length, kept: keep, ...(await gameSavesJson(new URLSearchParams({ code: String(body.code ?? ""), file }))) };
}

export async function trashPulledSave(body: Record<string, unknown>) {
  const devicePath = String(body.path ?? "");
  if (!devicePath) throw new UserError("Pick a file.");
  const local = pulledPath(devicePath);
  if (!fs.existsSync(local)) throw new UserError("That pulled copy is no longer in backups.");
  await platform.trash(local);
  return { ok: true };
}

export async function revealPulled() {
  const dir = pulledRoot();
  await fsp.mkdir(dir, { recursive: true });
  platform.reveal(dir);
  return { ok: true, folder: dir };
}

// --- Play-in-browser SRAM sync (EmulatorJS ↔ workspace mirror ↔ handheld) ---

const BROWSER = "saves-browser";

function browserRoot(): string {
  return path.join(ctx.backups, BROWSER);
}

function browserMirrorPath(code: string, file: string): string {
  const safeCode = code.replace(/[^A-Za-z0-9_-]/g, "_") || "SYS";
  return path.join(browserRoot(), safeCode, `${stemOf(file)}.srm`);
}

function preferredDeviceSrm(files: DeviceSave[], file: string): string | null {
  const matches = savesForStem(files, file).filter((f) => /\.(srm|sav)$/i.test(f.path));
  const srm = matches.find((f) => /\.srm$/i.test(f.path) && /(^|\/)save\//.test(f.path));
  return srm?.path ?? matches.find((f) => /\.srm$/i.test(f.path))?.path ?? matches[0]?.path ?? null;
}

function defaultDeviceSrm(file: string): string {
  return `save/current/browser/${stemOf(file)}.srm`;
}

async function mirrorStat(code: string, file: string) {
  const local = browserMirrorPath(code, file);
  try {
    const st = await fsp.stat(local);
    return { exists: true, size: st.size, mtime: st.mtimeMs, path: local };
  } catch {
    return { exists: false, size: 0, mtime: 0, path: local };
  }
}

/** Status of the browser save mirror and matching handheld SRAM for one game. */
export async function browserSaveJson(query: URLSearchParams) {
  const code = String(query.get("code") ?? "");
  const file = String(query.get("file") ?? "");
  if (!code || !file) throw new UserError("Pick a game first.");
  let reachable = false;
  let host = "";
  let frontend = false;
  let devicePath: string | null = null;
  let deviceSize = 0;
  let deviceMtime = 0;
  let deviceError = "";
  try {
    const dev = await deviceSaves();
    reachable = dev.reachable;
    host = dev.host;
    frontend = !!dev.frontend;
    if (dev.reachable) {
      devicePath = preferredDeviceSrm(dev.files, file);
      if (devicePath) {
        const hit = dev.files.find((f) => f.path === devicePath);
        deviceSize = hit?.size ?? 0;
        deviceMtime = hit?.mtime ?? 0;
      }
    }
  } catch (error) {
    deviceError = (error as Error).message;
  }
  const mirror = await mirrorStat(code, file);
  return {
    code, file, mirror, reachable, host, frontend, deviceError,
    devicePath, deviceSize, deviceMtime,
    targetPath: devicePath || defaultDeviceSrm(file),
  };
}

/** Download the workspace browser-save mirror as raw bytes (for EmulatorJS inject). */
export async function browserSaveDownload(query: URLSearchParams) {
  const code = String(query.get("code") ?? "");
  const file = String(query.get("file") ?? "");
  if (!code || !file) throw new UserError("Pick a game first.");
  const local = browserMirrorPath(code, file);
  if (!fs.existsSync(local)) throw new UserError("No browser save for this game yet.");
  const download = await fsp.readFile(local);
  return { download, name: `${stemOf(file)}.srm`, type: "application/octet-stream" };
}

/** Write EmulatorJS SRAM into the workspace mirror (base64). Optionally push to the handheld. */
export async function browserSaveStore(body: Record<string, unknown>) {
  const code = String(body.code ?? "");
  const file = String(body.file ?? "");
  const data = String(body.data ?? "");
  const push = body.push === true;
  if (!code || !file) throw new UserError("Pick a game first.");
  if (!data) throw new UserError("Save data is empty.");
  let buf: Buffer;
  try {
    buf = Buffer.from(data, "base64");
  } catch {
    throw new UserError("Save data is not valid base64.");
  }
  if (!buf.length) throw new UserError("Save data is empty.");
  if (buf.length > 16 * 1024 * 1024) throw new UserError("Save data is too large.");
  const local = browserMirrorPath(code, file);
  await fsp.mkdir(path.dirname(local), { recursive: true });
  await fsp.writeFile(local, buf);
  say("green", "BROWSER SAVE", `${code}/${stemOf(file)}.srm (${human(buf.length)})`);
  let pushed = false;
  let devicePath: string | null = null;
  if (push) {
    const result = await browserSavePushDevice({ code, file });
    pushed = true;
    devicePath = result.devicePath;
  }
  return { ...(await browserSaveJson(new URLSearchParams({ code, file }))), ok: true, size: buf.length, pushed, devicePath };
}

/** Pull matching handheld .srm into the browser mirror. */
export async function browserSavePullDevice(body: Record<string, unknown>) {
  const code = String(body.code ?? "");
  const file = String(body.file ?? "");
  if (!code || !file) throw new UserError("Pick a game first.");
  const dev = await requireDevice();
  const devicePath = preferredDeviceSrm(dev.files, file);
  if (!devicePath) throw new UserError("No SRAM (.srm/.sav) for this game on the handheld yet.");
  const local = browserMirrorPath(code, file);
  await fsp.mkdir(path.dirname(local), { recursive: true });
  const full = path.posix.join(STORAGE, devicePath);
  const { code: exit, err } = await streamCommand(`cat ${quote(full)}`, { stdout: fs.createWriteStream(local) });
  if (exit !== 0) throw new UserError(`Could not pull ${devicePath}${err ? `: ${err.trim()}` : ""}.`);
  const st = await fsp.stat(local);
  say("green", "BROWSER PULL", `${devicePath} → backups/${BROWSER}/ (${human(st.size)})`);
  return { ...(await browserSaveJson(new URLSearchParams({ code, file }))), ok: true, devicePath, size: st.size };
}

/** Push the browser mirror SRAM onto the handheld (existing path or save/current/browser/). */
export async function browserSavePushDevice(body: Record<string, unknown>) {
  const code = String(body.code ?? "");
  const file = String(body.file ?? "");
  if (!code || !file) throw new UserError("Pick a game first.");
  const local = browserMirrorPath(code, file);
  if (!fs.existsSync(local)) throw new UserError("No browser save to push. Play and save in the browser first.");
  const dev = await requireDevice();
  const devicePath = preferredDeviceSrm(dev.files, file) || defaultDeviceSrm(file);
  const full = path.posix.join(STORAGE, devicePath);
  const dir = path.posix.dirname(full);
  const { code: exit, err } = await streamCommand(`mkdir -p ${quote(dir)} && cat > ${quote(full)} && sync`, {
    stdin: fs.createReadStream(local),
  });
  if (exit !== 0) throw new UserError(`Could not push ${devicePath}${err ? `: ${err.trim()}` : ""}.`);
  const st = await fsp.stat(local);
  say("green", "BROWSER PUSH", `backups/${BROWSER}/ → ${devicePath} (${human(st.size)})`);
  return { ...(await browserSaveJson(new URLSearchParams({ code, file }))), ok: true, devicePath, size: st.size };
}