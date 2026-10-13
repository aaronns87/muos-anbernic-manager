// Save backups: the handheld's saves and save states (/run/muos/storage/save) copied over SSH into .tar.gz files in the
// backups folder, and restored from them, whole or file by file.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "./context.ts";
import { runCommand, sshStatus, streamCommand } from "./device/ssh.ts";
import { UserError } from "./errors.ts";
import { files, human, say } from "./log.ts";
import { platform } from "./platform/index.ts";
import { safeEntries, tarGzEntries, type TarEntry } from "./tar.ts";
import { isDir, listDir, removeQuietly, shq as quote } from "./util.ts";

const STORAGE = "/run/muos/storage";
const ROOT = "save";
const BACKUP = /^saves-[\w.-]+\.tar\.gz$/;

const LIST_SCRIPT = `
cd ${STORAGE} || exit 1
find ${ROOT} -type f | while IFS= read -r f; do printf '=S\\t%s\\t%s\\t%s\\n' "$f" "$(wc -c <"$f")" "$(date -r "$f" +%s)"; done
pgrep -f "/opt/muos/frontend/[m]uxfrontend" >/dev/null && echo "=F"
echo "=E"
`;

export interface DeviceSave { path: string; size: number; mtime: number }

async function deviceSaves() {
  const status = await sshStatus();
  if (!status.configured || !status.reachable) return { reachable: false, host: status.host, files: [] as DeviceSave[], frontend: false };
  const { out } = await runCommand(LIST_SCRIPT, 60_000);
  if (!out.includes("=E")) throw new UserError("The handheld did not answer completely. Try again.");
  const saves: DeviceSave[] = [];
  let frontend = false;
  for (const line of out.split("\n")) {
    const [tag, p, size, mtime] = line.split("\t");
    if (tag === "=S") saves.push({ path: p, size: Number(size) || 0, mtime: Number(mtime) || 0 });
    else if (tag === "=F") frontend = true;
  }
  return { reachable: true, host: status.host, files: saves.sort((a, b) => a.path.localeCompare(b.path)), frontend };
}

const listings = new Map<string, { key: string; entries: TarEntry[] }>();

async function backupEntries(file: string): Promise<TarEntry[]> {
  const st = await fsp.stat(file);
  const key = `${st.size}:${st.mtimeMs}`;
  const cached = listings.get(file);
  if (cached?.key === key) return cached.entries;
  const entries = await tarGzEntries(file);
  listings.set(file, { key, entries });
  return entries;
}

async function backupInfo(name: string) {
  const file = path.join(ctx.backups, name);
  const st = await fsp.stat(file);
  try {
    const entries = (await backupEntries(file)).filter((e) => !e.dir);
    return {
      name, size: st.size, created: st.mtimeMs, files: entries.length, bytes: entries.reduce((s, e) => s + e.size, 0),
      newest: entries.reduce((m, e) => Math.max(m, e.mtime), 0), error: "",
    };
  } catch {
    return { name, size: st.size, created: st.mtimeMs, files: 0, bytes: 0, newest: 0, error: "Not a readable backup." };
  }
}

async function backups() {
  const names = (await listDir(ctx.backups)).filter((e) => e.isFile() && BACKUP.test(e.name)).map((e) => e.name);
  return (await Promise.all(names.map(backupInfo))).sort((a, b) => b.created - a.created);
}

/** The backups folder, its backups and the saves on the handheld. */
export async function savesJson() {
  let device: Awaited<ReturnType<typeof deviceSaves>>, deviceError = "";
  try {
    device = await deviceSaves();
  } catch (error) {
    device = { reachable: false, host: "", files: [], frontend: false };
    deviceError = (error as Error).message;
  }
  return { folder: ctx.backups, available: await isDir(ctx.backups), backups: await backups(), device, deviceError };
}

function backupName(name: unknown): string {
  const n = String(name ?? "");
  if (!BACKUP.test(n)) throw new UserError(`"${n}" is not a save backup.`);
  return n;
}

async function readBackup(name: string): Promise<TarEntry[]> {
  const file = path.join(ctx.backups, name);
  if (!fs.existsSync(file)) throw new UserError(`${name} is no longer in the backups folder.`);
  try {
    return await backupEntries(file);
  } catch {
    throw new UserError(`${name} is damaged and cannot be read.`);
  }
}

async function takeBackup(label = ""): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").replace(/\..+$/, "");
  const name = `saves-${stamp}${label ? `-${label}` : ""}.tar.gz`;
  await fsp.mkdir(ctx.backups, { recursive: true });
  const file = path.join(ctx.backups, name), partial = `${file}.partial`;
  try {
    const { code, err } = await streamCommand(`set -o pipefail; cd ${STORAGE} && tar -cf - ${ROOT} | gzip -c`, { stdout: fs.createWriteStream(partial) });
    if (code !== 0) throw new UserError(`The handheld could not pack its saves${err ? `: ${err.trim()}` : ""}.`);
    const entries = await tarGzEntries(partial);
    if (!safeEntries(entries, ROOT)) throw new UserError("The backup from the handheld looks wrong; it was not kept.");
    await fsp.rename(partial, file);
    return name;
  } finally {
    await removeQuietly(partial);
  }
}

/** Copies every save and save state from the handheld into a new backup. */
export async function backupSaves() {
  const dev = await deviceSaves();
  if (!dev.reachable) throw new UserError("Connect the handheld over Wi-Fi with SSH on to back up saves.");
  if (!dev.files.length) throw new UserError("There are no saves on the handheld yet.");
  const name = await takeBackup();
  const info = await backupInfo(name);
  say("green", "BACKED UP", `${files(info.files)} (${human(info.bytes)}) from the handheld to ${name}.`);
  return { name, ...(await savesJson()) };
}

/** The files in one backup, next to what the handheld has now. */
export async function backupContents(query: URLSearchParams) {
  const name = backupName(query.get("name"));
  const entries = (await readBackup(name)).filter((e) => !e.dir);
  return { name, files: entries.map(({ path: p, size, mtime }) => ({ path: p, size, mtime })) };
}

/**
 * Puts files from a backup back on the handheld, after backing up what is there now. Files not in the backup are left
 * alone; files in it replace the handheld's copies.
 */
export async function restoreSaves(body: Record<string, unknown>) {
  const name = backupName(body.name);
  const file = path.join(ctx.backups, name);
  const entries = await readBackup(name);
  if (!safeEntries(entries, ROOT)) throw new UserError(`${name} holds files outside the save folder, so it is not restored.`);
  const known = new Set(entries.filter((e) => !e.dir).map((e) => e.path));
  const wanted = Array.isArray(body.files) ? body.files.map(String) : [];
  for (const p of wanted) if (!known.has(p)) throw new UserError(`${p} is not in ${name}.`);
  const dev = await deviceSaves();
  if (!dev.reachable) throw new UserError("Connect the handheld over Wi-Fi with SSH on to restore saves.");
  if (!dev.frontend) throw new UserError("A game is open on the handheld. Close it and go back to the menu, then restore.");
  const safety = dev.files.length ? await takeBackup("before-restore") : "";
  const list = wanted.length ? ` ${wanted.map(quote).join(" ")}` : "";
  const { code, err } = await streamCommand(`cd ${STORAGE} && gzip -dc | tar -xf -${list} && sync && echo @ok`, { stdin: fs.createReadStream(file) });
  if (code !== 0) throw new UserError(`Restoring failed on the handheld${err ? `: ${err.trim()}` : ""}.`);
  const count = wanted.length || known.size;
  say("green", "RESTORED", `${files(count)} from ${name} to the handheld${safety ? ` (previous saves kept in ${safety})` : ""}.`);
  return { restored: count, safety, ...(await savesJson()) };
}

/** Moves a backup to the Trash. */
export async function trashBackup(body: Record<string, unknown>) {
  const name = backupName(body.name);
  if (!fs.existsSync(path.join(ctx.backups, name))) throw new UserError(`${name} is no longer in the backups folder.`);
  await platform.trash(path.join(ctx.backups, name));
  say("yellow", "TRASHED", `${name} from the backups folder.`);
  return savesJson();
}
