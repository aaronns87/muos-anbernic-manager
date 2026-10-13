// MustardOS packages (.muxapp, .muxupd, ...) in the apps folder: what they hold, sending them to ARCHIVE on the handheld,
// and installing them there over SSH with the same script Archive Manager runs.

import fs from "node:fs";
import fsp from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { ctx } from "./context.ts";
import type { Progress } from "./device/fs.ts";
import { runCommand, sshStatus } from "./device/ssh.ts";
import type { Target } from "./device/target.ts";
import { withTarget } from "./device/target.ts";
import { UserError } from "./errors.ts";
import { Job, requireIdle, startJob, type Work } from "./jobs.ts";
import { files, human, say } from "./log.ts";
import { platform } from "./platform/index.ts";
import { isDir, listDir, removeQuietly, safePart, shq as quote, splitName } from "./util.ts";
import { APP_FILE } from "./workspace.ts";

/** What each package type is, and whether extract.sh installs it. */
const KINDS: Record<string, { label: string; installs: boolean }> = {
  muxapp: { label: "App", installs: true },
  muxupd: { label: "System update", installs: true },
  muxzip: { label: "Bundle", installs: true },
  muxthm: { label: "Theme", installs: true },
  muxalt: { label: "Theme variant", installs: true },
  muxcat: { label: "Catalogue", installs: true },
  muxcfg: { label: "RetroArch config", installs: true },
  zip: { label: "Zip", installs: false },
};

/** ARCHIVE on each storage: the label used in the page, and its path on the handheld. */
const ARCHIVES: [string, string][] = [["TF2", "/mnt/sdcard/ARCHIVE"], ["SD1", "/mnt/mmc/ARCHIVE"]];
const LOG = "/tmp/muos-manager-install.log";

// ---------------------------------------------------------------- reading packages

interface Peek { top: string[]; apps: string[]; entries: number; bytes: number; unsafe: boolean; error: string }

/** Folders under MUOS/application (or application/ in a .muxzip) that a package adds. */
const APP_PATH = /(?:^|\/)(?:MUOS|storage)\/application\/([^/]+)\/|^application\/([^/]+)\//;

/** Lists a zip's central directory without unpacking it: top-level folders, apps it adds, entry count and unpacked size. */
async function peek(file: string, size: number, ext: string): Promise<Peek> {
  const out: Peek = { top: [], apps: [], entries: 0, bytes: 0, unsafe: false, error: "" };
  const handle = await fsp.open(file, "r");
  try {
    const tailSize = Math.min(size, 65_557);
    const tail = Buffer.alloc(tailSize);
    await handle.read(tail, 0, tailSize, size - tailSize);
    let end = -1;
    for (let i = tailSize - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    if (end < 0) return { ...out, error: "Not a zip archive, or it is damaged." };
    const count = tail.readUInt16LE(end + 10), dirSize = tail.readUInt32LE(end + 12), dirStart = tail.readUInt32LE(end + 16);
    if (dirStart === 0xffffffff || dirSize === 0xffffffff) return { ...out, error: "This archive is too large to check (ZIP64); unpack it and zip it again without ZIP64." };
    const dir = Buffer.alloc(dirSize);
    await handle.read(dir, 0, dirSize, dirStart);
    const top = new Set<string>(), apps = new Set<string>();
    let at = 0;
    for (let n = 0; n < count && at + 46 <= dir.length && dir.readUInt32LE(at) === 0x02014b50; n++) {
      const nameLen = dir.readUInt16LE(at + 28), extraLen = dir.readUInt16LE(at + 30), commentLen = dir.readUInt16LE(at + 32);
      const name = dir.toString("utf8", at + 46, at + 46 + nameLen);
      out.entries++;
      out.bytes += dir.readUInt32LE(at + 24);
      if (name.startsWith("/") || name.split("/").includes("..")) out.unsafe = true;
      const parts = name.split("/");
      if (parts.length > 1 && parts[0]) top.add(parts[0]);
      if (ext === "muxapp" && parts.length > 1 && parts[0]) apps.add(parts[0]);
      const hit = name.match(APP_PATH);
      if (hit) apps.add(hit[1] ?? hit[2]);
      at += 46 + nameLen + extraLen + commentLen;
    }
    out.top = [...top].sort((a, b) => a.localeCompare(b));
    out.apps = [...apps].sort((a, b) => a.localeCompare(b));
    return out;
  } catch {
    return { ...out, error: "Could not read this archive." };
  } finally {
    await handle.close();
  }
}

const peeks = new Map<string, { key: string; peek: Peek }>();

async function packageInfo(name: string) {
  const file = path.join(ctx.apps, name);
  const st = await fsp.stat(file);
  const [, ext] = splitName(name);
  const key = `${st.size}:${st.mtimeMs}`;
  let cached = peeks.get(file);
  if (cached?.key !== key) peeks.set(file, (cached = { key, peek: await peek(file, st.size, ext) }));
  const kind = KINDS[ext] ?? { label: ext.toUpperCase(), installs: false };
  const pico = ext === "zip" && /^pico-8_/i.test(name);
  return {
    name, ext, size: st.size, mtime: st.mtimeMs / 1000, kind: pico ? "PICO-8" : kind.label,
    installs: (kind.installs || pico) && !cached.peek.unsafe && !cached.peek.error, ...cached.peek,
  };
}

/** The packages in the apps folder. */
export async function appsJson() {
  const available = await isDir(ctx.apps);
  const packages = [];
  if (available) {
    for (const e of await listDir(ctx.apps)) {
      if (e.name.startsWith(".") || e.isDirectory() || !APP_FILE.test(e.name.toLowerCase())) continue;
      packages.push(await packageInfo(e.name));
    }
  }
  packages.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  return { folder: ctx.apps, available, packages };
}

function localName(value: unknown): string {
  const name = String(value ?? "").normalize("NFC");
  if (!safePart(name) || name.length > 240 || /[\u0000-\u001f:]/.test(name) || !APP_FILE.test(name.toLowerCase())) {
    throw new UserError(`"${name}" is not a MustardOS package name.`);
  }
  return name;
}

/** Streams one package into the apps folder (PUT body); an existing one goes to the Trash only with replace=1. */
export async function uploadApp(req: http.IncomingMessage, query: URLSearchParams) {
  const name = localName(query.get("name"));
  await fsp.mkdir(ctx.apps, { recursive: true });
  const existing = (await listDir(ctx.apps)).find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (existing && query.get("replace") !== "1") throw new UserError(`${existing.name} is already in the apps folder.`);
  const expected = Number(req.headers["content-length"] ?? NaN);
  const partial = path.join(ctx.apps, `.${name}.partial`);
  try {
    await pipeline(req, fs.createWriteStream(partial));
    const size = (await fsp.stat(partial)).size;
    if (Number.isFinite(expected) && size !== expected) throw new UserError(`The upload of ${name} stopped early.`);
    if (existing) await platform.trash(path.join(ctx.apps, existing.name));
    await fsp.rename(partial, path.join(ctx.apps, name));
    say("green", "ADDED", `${name} to the apps folder.`);
    return packageInfo(name);
  } finally {
    await removeQuietly(partial);
  }
}

export async function trashApp(body: Record<string, unknown>) {
  const name = localName(body.name);
  const file = path.join(ctx.apps, name);
  if (!(await fsp.stat(file).then((s) => s.isFile(), () => false))) throw new UserError(`${name} is not in the apps folder.`);
  await platform.trash(file);
  say("yellow", "TRASHED", `${name} from the apps folder.`);
  return appsJson();
}

// ---------------------------------------------------------------- the handheld

interface Install { archive: string; name: string; started: number; reported?: boolean }
let install: Install | null = null;

const DEVICE_SCRIPT = `
for d in ${ARCHIVES.map(([, p]) => p).join(" ")}; do
  [ -d "$d" ] || continue
  echo "=D	$d"
  for f in "$d"/*; do [ -f "$f" ] && printf '=A\\t%s\\t%s\\n' "$f" "$(ls -ln "$f" | awk '{print $5}')"; done
done
for f in /opt/muos/update/installed/*.done; do [ -f "$f" ] && printf '=I\\t%s\\n' "$(basename "$f" .done)"; done
for d in /run/muos/storage/application/*/; do [ -d "$d" ] && printf '=P\\t%s\\n' "$(basename "$d")"; done
pgrep -f "/opt/muos/frontend/[m]uxfrontend" >/dev/null && echo "=F"
pgrep -f "/opt/muos/script/mux/[e]xtract.sh" >/dev/null && echo "=X"
echo "=E"
`;

/** ARCHIVE contents, installed packages and apps on the handheld, read over SSH. */
export async function appsDevice() {
  const status = await sshStatus();
  if (!status.configured || !status.reachable) {
    return { reachable: false, host: status.host, archives: [], archive: [], installed: [], apps: [], frontend: false, installing: null };
  }
  const { out } = await runCommand(DEVICE_SCRIPT, 20_000);
  if (!out.includes("=E")) throw new UserError("The handheld did not answer completely. Try again.");
  const archives: string[] = [], archive: { path: string; name: string; size: number; storage: string }[] = [];
  const installed: string[] = [], apps: string[] = [];
  let frontend = false, extracting = false;
  for (const line of out.split("\n")) {
    const [tag, a, b] = line.split("\t");
    if (tag === "=D") archives.push(ARCHIVES.find(([, p]) => p === a)?.[0] ?? a);
    else if (tag === "=A") archive.push({ path: a, name: path.posix.basename(a), size: Number(b) || 0, storage: ARCHIVES.find(([, p]) => a.startsWith(p + "/"))?.[0] ?? "" });
    else if (tag === "=I") installed.push(a);
    else if (tag === "=P") apps.push(a);
    else if (tag === "=F") frontend = true;
    else if (tag === "=X") extracting = true;
  }
  return {
    reachable: true, host: status.host, archives, archive, installed, apps: apps.sort((x, y) => x.localeCompare(y)), frontend,
    installing: extracting || install ? await installStatus() : null,
  };
}

function devicePath(value: unknown): { path: string; name: string } {
  const p = String(value ?? "");
  const dir = ARCHIVES.map(([, d]) => d).find((d) => p.startsWith(d + "/"));
  const name = dir ? p.slice(dir.length + 1) : "";
  if (!dir || !name || name.includes("/") || name.startsWith(".") || /[\u0000-\u001f]/.test(name)) throw new UserError("That is not a file in ARCHIVE on the handheld.");
  return { path: p, name };
}

/** Removes a package from ARCHIVE on the handheld. There is no Trash on the device. */
export async function deleteDeviceApp(body: Record<string, unknown>) {
  const { path: file, name } = devicePath(body.path);
  if (install && (await installStatus()).running) throw new UserError("Wait for the install to finish.");
  const { out } = await runCommand(`rm -f ${quote(file)} && sync && echo @ok`);
  if (!out.includes("@ok")) throw new UserError(`Could not delete ${name} on the handheld.`);
  say("yellow", "DELETED", `${name} from ARCHIVE on the handheld.`);
  return appsDevice();
}

const APP_DIRS = ["/run/muos/storage/application", "/mnt/mmc/MUOS/application", "/mnt/sdcard/MUOS/application"];

/** Install markers that belong to an app: packages in the apps folder that install it, or markers named after it. */
async function markersFor(app: string, installed: string[]) {
  const lower = app.toLowerCase();
  const local = (await appsJson()).packages.filter((p) => p.apps.some((a) => a.toLowerCase() === lower)).map((p) => p.name.toLowerCase());
  return installed.filter((m) => {
    const l = m.toLowerCase();
    return local.includes(l) || (l.startsWith(lower) && /^[^a-z0-9]/.test(l.slice(lower.length)));
  });
}

/** Deletes an installed application's folder (and its install marker) from the handheld. Permanent. */
export async function uninstallDeviceApp(body: Record<string, unknown>) {
  const app = String(body.app ?? "");
  if (!app || app.includes("/") || app.startsWith(".") || /[\u0000-\u001f]/.test(app)) throw new UserError("That is not an application name.");
  const dev = await appsDevice();
  if (!dev.reachable) throw new UserError("Connect the handheld over Wi-Fi with SSH on to uninstall apps.");
  if (!dev.apps.includes(app)) throw new UserError(`${app} is not installed on the handheld.`);
  if (dev.installing?.running) throw new UserError("Wait for the install to finish.");
  if (!dev.frontend) throw new UserError("A game or app is open on the handheld. Close it and go back to the menu, then uninstall.");
  const markers = await markersFor(app, dev.installed);
  const script = [
    `for d in ${APP_DIRS.join(" ")}; do p="$d/$1"; if [ -e "$p" ] || [ -L "$p" ]; then rm -rf "$p" && echo "=R	$p"; fi; done`,
    ...markers.map((m) => `rm -f ${quote(`/opt/muos/update/installed/${m}.done`)}`),
    "sync; echo @ok",
  ].join("\n");
  const { out } = await runCommand(`sh -c ${quote(script)} sh ${quote(app)}`);
  if (!out.includes("@ok") || !out.includes("=R")) throw new UserError(`Could not uninstall ${app} on the handheld.`);
  say("yellow", "UNINSTALLED", `${app} from the handheld${markers.length ? ` (${markers.join(", ")})` : ""}.`);
  return appsDevice();
}

/** Runs extract.sh on a package in ARCHIVE, detached so it survives the SSH session; the handheld returns to its main menu. */
export async function startInstall(body: Record<string, unknown>) {
  const { path: archive, name } = devicePath(body.path);
  const [, ext] = splitName(name);
  if (!(KINDS[ext]?.installs || (ext === "zip" && /^pico-8_/i.test(name)))) throw new UserError(`MustardOS cannot install .${ext} files.`);
  const state = await runCommand(`[ -f ${quote(archive)} ] && echo =H; pgrep -f "/opt/muos/frontend/[m]uxfrontend" >/dev/null && echo =F; pgrep -f "/opt/muos/script/mux/[e]xtract.sh" >/dev/null && echo =X`);
  if (!state.out.includes("=H")) throw new UserError(`${name} is no longer in ARCHIVE on the handheld.`);
  if (state.out.includes("=X")) throw new UserError("The handheld is already installing something. Wait for it to finish.");
  if (!state.out.includes("=F")) throw new UserError("A game or app is open on the handheld. Close it and go back to the menu, then install.");
  const run = `/opt/muos/script/mux/extract.sh "$1" launcher >"$2" 2>&1; echo "@exit $?" >>"$2"`;
  await runCommand(`: >${LOG}; setsid -f sh -c ${quote(run)} sh ${quote(archive)} ${LOG} </dev/null >/dev/null 2>&1; echo @started`);
  install = { archive, name, started: Date.now() };
  say("cyan", "INSTALL", `${name} on the handheld.`);
  return installStatus();
}

/** The install's output so far; finished once extract.sh wrote its exit code. */
export async function installStatus() {
  const { out } = await runCommand(`tail -c 16000 ${LOG} 2>/dev/null; pgrep -f "/opt/muos/script/mux/[e]xtract.sh" >/dev/null && echo "@@running"`);
  const running = out.includes("@@running");
  const text = out.replace("@@running", "").replace(/\r/g, "").replace(/\.{4,}/g, "...");
  const exit = text.match(/@exit (\d+)/);
  const log = text.replace(/@exit \d+\s*$/, "").trimEnd();
  const code = exit ? Number(exit[1]) : null;
  if (install && !running && code !== null && !install.reported) {
    install.reported = true;
    if (code === 0) say("green", "INSTALLED", `${install.name} on the handheld.`);
    else say("red", "FAILED", `Installing ${install.name} ended with code ${code}.`);
  }
  return {
    name: install?.name ?? "", archive: install?.archive ?? "", started: install?.started ?? 0,
    running: running || (code === null && !!install && Date.now() - install.started < 5000), code, log: log.split("\n").slice(-200).join("\n"),
  };
}

// ---------------------------------------------------------------- sending

interface AppWork extends Work { src: string }

class AppSendJob extends Job<AppWork> {
  readonly kind = "apps";
  readonly verb = "SENT";

  async copyOne(t: Target, job: AppWork, progress: Progress): Promise<void> {
    const fs = archiveStorage(t);
    const existing = await fs.entry(["ARCHIVE", job.rel]);
    if (existing && existing.size === job.size) return;
    await fs.put(job.src, ["ARCHIVE", job.rel], progress);
  }
}

/** ARCHIVE on TF2 when there is one, else on SD1: where Archive Manager looks first. */
function archiveStorage(t: Target) {
  const found = t.all.find(([label]) => label === "TF2") ?? t.all.find(([label]) => label === "SD1") ?? t.all[0];
  if (!found) throw new UserError(`${t.name} has no storage to copy to.`);
  return found[1];
}

/** Copies packages from the apps folder into ARCHIVE on the connected device (card reader, USB or Wi-Fi). */
export async function sendApps(body: Record<string, unknown>) {
  requireIdle("Wait for the current job to finish first.");
  const names = (Array.isArray(body.names) ? body.names : []).map(localName);
  if (!names.length) throw new UserError("Pick at least one package.");
  const jobs: AppWork[] = [];
  for (const name of names) {
    const src = path.join(ctx.apps, name);
    const st = await fsp.stat(src).catch(() => null);
    if (!st?.isFile()) throw new UserError(`${name} is not in the apps folder.`);
    const info = await packageInfo(name);
    if (info.error || info.unsafe) throw new UserError(`${name} is damaged or unsafe, so it was not sent.`);
    jobs.push({ rel: name, src, size: st.size });
  }
  const volume = String(body.volume ?? "");
  const { free, name } = await withTarget(volume, async (t) => ({ free: t.info.free, name: t.name }));
  const total = jobs.reduce((s, j) => s + j.size, 0);
  if (total > free) throw new UserError(`These packages need ${human(total)} and ${name} has ${human(free)} free.`);
  const label = names.length === 1 ? names[0] : `${names.length} packages`;
  return startJob(new AppSendJob(label, jobs, volume, name), `${label}: ${files(jobs.length)} (${human(total)}) to ARCHIVE on ${name}`);
}
