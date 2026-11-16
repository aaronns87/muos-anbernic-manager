// Andromeda device backups (.muxbak): list ARCHIVE copies, download to this computer, create via backup.sh,
// and restore with the same extract.sh Archive Manager uses. Shown only when the handheld has backup.sh.

import fsp from "node:fs/promises";
import path from "node:path";
import { WIFI_ID } from "../catalogue.ts";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { human, say } from "../log.ts";
import { withTarget } from "./target.ts";
import { runCommand, sshStatus } from "./ssh.ts";
import { shq as quote } from "../util.ts";

/** Paths are built in pieces so BusyBox status checkers never embed the full needle in their own cmdline. */
const MUX = "/opt/muos/script/mux";
const SCRIPT_A = "bac", SCRIPT_B = "kup.sh";
const EXTRACT_A = "ext", EXTRACT_B = "ract.sh";
const SCRIPT = `${MUX}/${SCRIPT_A}${SCRIPT_B}`;
const EXTRACT = `${MUX}/${EXTRACT_A}${EXTRACT_B}`;
const MANIFEST = "/tmp/muxbackup_manifest.txt";
const CREATE_LOG = "/tmp/muos-manager-muxbak-create.log";
const CREATE_PID = "/tmp/muos-manager-muxbak-create.pid";
const RESTORE_LOG = "/tmp/muos-manager-muxbak-restore.log";
const RESTORE_PID = "/tmp/muos-manager-muxbak-restore.pid";
const FG = "/opt/muos/config/system/foreground_process";
const ARCHIVES: [string, string][] = [["TF2", "/mnt/sdcard/ARCHIVE"], ["SD1", "/mnt/mmc/ARCHIVE"]];

/** Alive pidfile (digits only) — avoids BusyBox pgrep matching the SSH checker script. */
const pidAlive = (pidFile: string, tag: string) =>
  `pid=$(cat ${quote(pidFile)} 2>/dev/null); case "$pid" in *[!0-9]*|"") ;; *) kill -0 "$pid" 2>/dev/null && echo ${tag} ;; esac`;

/** backup.sh sets foreground_process to muxbackup; our jobs also keep a pidfile. */
const backupRunning = () =>
  `fg=$(cat ${quote(FG)} 2>/dev/null); [ "$fg" = "muxbackup" ] && echo =C; ${pidAlive(CREATE_PID, "=C")}`;

/** extract/install: no reliable fg name — pidfile for our restores, plus ARCHIVE task lock if present. */
const extractRunning = () =>
  `${pidAlive(RESTORE_PID, "=X")}; [ -f /tmp/mux_extract_running ] && echo =X`;

const frontendRunning = () =>
  `fg=$(cat ${quote(FG)} 2>/dev/null); [ "$fg" = "muxfrontend" ] && echo =F`;

/** Resolve script path on the device without putting the joined name in this checker’s source. */
const scriptExists = () =>
  `_a=${quote(SCRIPT_A)}; _b=${quote(SCRIPT_B)}; [ -x ${quote(MUX)}"/$_a$_b" ] && echo =B`;

/** Sections backup.sh can archive (script/archive/<id>.sh). Labels match muxbackup. */
export const SECTIONS: [string, string][] = [
  ["save", "Saves"],
  ["bios", "BIOS"],
  ["catalogue", "Catalogue"],
  ["collection", "Collections"],
  ["content", "Content"],
  ["history", "History"],
  ["music", "Music"],
  ["network", "Network"],
  ["name", "Friendly names"],
  ["override", "Overrides"],
  ["package", "Packages"],
  ["pickles", "Pickles"],
  ["profile", "Profiles"],
  ["retroarch", "RetroArch"],
  ["screenshot", "Screenshots"],
  ["settings", "Settings"],
  ["syncthing", "Syncthing"],
  ["theme", "Themes"],
  ["track", "Play activity"],
  ["wasabi", "Wasabi"],
  ["application", "Applications"],
  ["init", "Init scripts"],
  ["launch", "Launch scripts"],
];

const SECTION_IDS = new Set(SECTIONS.map(([id]) => id));
const DEST_OK = new Set(["SD1", "SD2", "USB"]);

export interface MuxbakFile {
  path: string;
  name: string;
  size: number;
  mtime: number;
  storage: string;
}

let job: { kind: "create" | "restore"; name: string; started: number; reported?: boolean } | null = null;

/** ARCHIVE path must be a bare .muxbak name under TF2 or SD1 ARCHIVE. */
export function archiveMuxbakPath(value: unknown): { path: string; name: string; storage: string } {
  const p = String(value ?? "");
  const found = ARCHIVES.find(([, d]) => p.startsWith(d + "/"));
  const name = found ? p.slice(found[1].length + 1) : "";
  if (!found || !name || name.includes("/") || name.startsWith(".") || !/\.muxbak$/i.test(name) || /[\u0000-\u001f]/.test(name)) {
    throw new UserError("That is not a .muxbak file in ARCHIVE on the handheld.");
  }
  return { path: p, name, storage: found[0] };
}

async function requireSsh() {
  const status = await sshStatus();
  if (!status.configured || !status.reachable) throw new UserError("Connect the handheld over Wi-Fi with SSH on.");
  return status;
}

/** Whether Andromeda-style device backups are available on the connected handheld. */
export async function muxbakSupport() {
  const status = await sshStatus();
  if (!status.configured || !status.reachable) return { supported: false, host: status.host, destinations: [] as string[], sections: SECTIONS };
  const { out } = await runCommand(`${scriptExists()}; [ -d /mnt/mmc ] && echo =1; [ -d /mnt/sdcard ] && echo =2; [ -d /mnt/usb ] && echo =U`, 10_000);
  const destinations: string[] = [];
  if (out.includes("=1")) destinations.push("SD1");
  if (out.includes("=2")) destinations.push("SD2");
  if (out.includes("=U")) destinations.push("USB");
  return { supported: out.includes("=B"), host: status.host, destinations, sections: SECTIONS };
}

const LIST = `
for d in ${ARCHIVES.map(([, p]) => p).join(" ")}; do
  [ -d "$d" ] || continue
  find "$d" -maxdepth 1 -type f -name '*.muxbak' -print 2>/dev/null | while IFS= read -r f; do
    printf '=M\\t%s\\t%s\\t%s\\n' "$f" "$(wc -c <"$f")" "$(date -r "$f" +%s 2>/dev/null || stat -c %Y "$f" 2>/dev/null || echo 0)"
  done
done
${scriptExists()}
[ -d /mnt/mmc ] && echo =1
[ -d /mnt/sdcard ] && echo =2
[ -d /mnt/usb ] && echo =U
${backupRunning()}
${extractRunning()}
echo =E
`;

/** .muxbak files in ARCHIVE, plus support and job status. */
export async function muxbakJson() {
  const status = await sshStatus();
  if (!status.configured || !status.reachable) {
    return { supported: false, host: status.host, files: [] as MuxbakFile[], destinations: [] as string[], sections: SECTIONS, creating: false, restoring: null };
  }
  const { out } = await runCommand(LIST, 30_000);
  if (!out.includes("=E")) throw new UserError("The handheld did not answer completely. Try again.");
  const files: MuxbakFile[] = [];
  const destinations: string[] = [];
  let supported = false, creating = false;
  for (const line of out.split("\n")) {
    const [tag, a, b, c] = line.split("\t");
    if (tag === "=M") {
      const storage = ARCHIVES.find(([, p]) => a.startsWith(p + "/"))?.[0] ?? "";
      files.push({ path: a, name: path.posix.basename(a), size: Number(b) || 0, mtime: Number(c) || 0, storage });
    } else if (tag === "=B") supported = true;
    else if (tag === "=1") destinations.push("SD1");
    else if (tag === "=2") destinations.push("SD2");
    else if (tag === "=U") destinations.push("USB");
    else if (tag === "=C") creating = true;
  }
  files.sort((x, y) => y.mtime - x.mtime || x.name.localeCompare(y.name));
  return {
    supported, host: status.host, files, destinations, sections: SECTIONS, creating,
    restoring: out.includes("=X") || job?.kind === "restore" ? await restoreStatus() : null,
  };
}

/** Copies a .muxbak from ARCHIVE into the backups folder on this computer. */
export async function downloadMuxbak(body: Record<string, unknown>) {
  await requireSsh();
  const { path: remote, name, storage } = archiveMuxbakPath(body.path);
  await fsp.mkdir(ctx.backups, { recursive: true });
  const dest = path.join(ctx.backups, name);
  await withTarget(WIFI_ID, async (t) => {
    const fs = t.all.find(([label]) => label === storage)?.[1];
    if (!fs) throw new UserError(`${storage} is not available over SFTP.`);
    if (!(await fs.entry(["ARCHIVE", name]))) throw new UserError(`${name} is no longer in ARCHIVE on the handheld.`);
    await fs.get(["ARCHIVE", name], dest);
  });
  const st = await fsp.stat(dest);
  say("cyan", "DOWNLOADED", `${name} (${human(st.size)}) to the backups folder.`);
  return { name, size: st.size, folder: ctx.backups };
}

/** Starts backup.sh with a manifest for the chosen destination and sections. */
export async function createMuxbak(body: Record<string, unknown>) {
  await requireSsh();
  const dest = String(body.destination ?? "SD1").toUpperCase();
  if (!DEST_OK.has(dest)) throw new UserError("Pick SD1, SD2 (TF2) or USB as the backup destination.");
  const merge = body.merge !== false && body.merge !== 0 && body.merge !== "0";
  const raw = Array.isArray(body.sections) ? body.sections.map(String) : SECTIONS.map(([id]) => id);
  const sections = [...new Set(raw.filter((id) => SECTION_IDS.has(id)))];
  if (!sections.length) throw new UserError("Pick at least one backup section.");

  const state = await runCommand(`${scriptExists()}; ${backupRunning()}; ${extractRunning()}; ${frontendRunning()}`);
  if (!state.out.includes("=B")) throw new UserError("This MustardOS build has no device backup script (.muxbak).");
  if (state.out.includes("=C")) throw new UserError("A device backup is already running on the handheld.");
  if (state.out.includes("=X")) throw new UserError("The handheld is installing or restoring something. Wait for it to finish.");
  if (!state.out.includes("=F")) throw new UserError("A game or app is open on the handheld. Close it and go back to the menu, then create the backup.");

  const lines = [`BATCH ${dest}`, ...sections.map((id) => `SD1 ${id}`)];
  const write = `printf '%s\\n' ${lines.map((l) => quote(l)).join(" ")} >${quote(MANIFEST)} && echo @ok`;
  const written = await runCommand(write, 10_000);
  if (!written.out.includes("@ok")) throw new UserError("Could not write the backup manifest on the handheld.");

  // Join the script path on the device so this launcher cmdline does not contain the full path either.
  const start = `
_a=${quote(SCRIPT_A)}; _b=${quote(SCRIPT_B)}; _script=${quote(MUX)}"/$_a$_b"
: >${quote(CREATE_LOG)}; rm -f ${quote(CREATE_PID)}
( echo $$ >${quote(CREATE_PID)}; "$_script" ${merge ? "1" : "0"} >>${quote(CREATE_LOG)} 2>&1; echo "@exit $?" >>${quote(CREATE_LOG)}; rm -f ${quote(CREATE_PID)} ) </dev/null >/dev/null 2>&1 &
echo @started
`;
  await runCommand(start);
  job = { kind: "create", name: merge ? "Full backup" : sections.join(", "), started: Date.now() };
  say("cyan", "BACKUP", `Creating .muxbak on ${dest} (${sections.length} section${sections.length === 1 ? "" : "s"}${merge ? ", merged" : ""}).`);
  return createStatus();
}

/** Progress of a running or recent backup.sh job. */
export async function createStatus() {
  const { out } = await runCommand(`tail -c 16000 ${quote(CREATE_LOG)} 2>/dev/null; ${backupRunning()}; echo @@end`);
  const running = out.includes("=C");
  const text = out.replace(/=C/g, "").replace("@@end", "").replace(/\r/g, "");
  const exit = text.match(/@exit (\d+)/);
  const log = text.replace(/@exit \d+\s*$/, "").trimEnd();
  const code = exit ? Number(exit[1]) : null;
  if (job?.kind === "create" && !running && code !== null && !job.reported) {
    job.reported = true;
    if (code === 0) say("green", "BACKED UP", `${job.name} as .muxbak on the handheld.`);
    else say("red", "FAILED", `Device backup ended with code ${code}.`);
  }
  return {
    name: job?.kind === "create" ? job.name : "",
    started: job?.kind === "create" ? job.started : 0,
    running: running || (code === null && job?.kind === "create" && Date.now() - job.started < 5000),
    code, log: log.split("\n").slice(-200).join("\n"),
  };
}

/** Restores a .muxbak via extract.sh (overwrites matching sections on the device). */
export async function restoreMuxbak(body: Record<string, unknown>) {
  await requireSsh();
  const { path: archive, name } = archiveMuxbakPath(body.path);
  const state = await runCommand(`[ -f ${quote(archive)} ] && echo =H; ${frontendRunning()}; ${extractRunning()}; ${backupRunning()}`);
  if (!state.out.includes("=H")) throw new UserError(`${name} is no longer in ARCHIVE on the handheld.`);
  if (state.out.includes("=X")) throw new UserError("The handheld is already installing or restoring something. Wait for it to finish.");
  if (state.out.includes("=C")) throw new UserError("A device backup is running. Wait for it to finish.");
  if (!state.out.includes("=F")) throw new UserError("A game or app is open on the handheld. Close it and go back to the menu, then restore.");
  const start = `
_a=${quote(EXTRACT_A)}; _b=${quote(EXTRACT_B)}; _script=${quote(MUX)}"/$_a$_b"
: >${quote(RESTORE_LOG)}; rm -f ${quote(RESTORE_PID)}
( echo $$ >${quote(RESTORE_PID)}; "$_script" ${quote(archive)} launcher >>${quote(RESTORE_LOG)} 2>&1; echo "@exit $?" >>${quote(RESTORE_LOG)}; rm -f ${quote(RESTORE_PID)} ) </dev/null >/dev/null 2>&1 &
echo @started
`;
  await runCommand(start);
  job = { kind: "restore", name, started: Date.now() };
  say("cyan", "RESTORE", `${name} on the handheld (device data for those sections is replaced).`);
  return restoreStatus();
}

/** Progress of a running or recent .muxbak restore. */
export async function restoreStatus() {
  const { out } = await runCommand(`tail -c 16000 ${quote(RESTORE_LOG)} 2>/dev/null; ${extractRunning()}; echo @@end`);
  const running = out.includes("=X");
  const text = out.replace(/=X/g, "").replace("@@end", "").replace(/\r/g, "").replace(/\.{4,}/g, "...");
  const exit = text.match(/@exit (\d+)/);
  const log = text.replace(/@exit \d+\s*$/, "").trimEnd();
  const code = exit ? Number(exit[1]) : null;
  if (job?.kind === "restore" && !running && code !== null && !job.reported) {
    job.reported = true;
    if (code === 0) say("green", "RESTORED", `${job.name} on the handheld.`);
    else say("red", "FAILED", `Restoring ${job.name} ended with code ${code}.`);
  }
  return {
    name: job?.kind === "restore" ? job.name : "",
    archive: job?.kind === "restore" ? job.name : "",
    started: job?.kind === "restore" ? job.started : 0,
    running: running || (code === null && job?.kind === "restore" && Date.now() - job.started < 5000),
    code, log: log.split("\n").slice(-200).join("\n"),
  };
}
