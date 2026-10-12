// PortMaster ports: the online catalogue (ports.json from the PortMaster-New releases), what is installed on the handheld,
// and installing or removing ports with the handheld's own PortMaster (harbourmaster), which also fetches their runtimes.
// MustardOS keeps port data in <card>/ports/<dir> and the launch scripts in <card>/ROMS/Ports, where the card is TF2 when
// it is in (PortMaster's own rule in harbourmaster/config.py).

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import { Writable } from "node:stream";
import { ctx } from "./context.ts";
import { runCommand, sshStatus, streamCommand } from "./device/ssh.ts";
import { UserError } from "./errors.ts";
import { say } from "./log.ts";
import { byId, DEFAULT_DEVICE, deviceFor, portCaps } from "../public/js/devices.js";

const DATA_URL = "https://github.com/PortsMaster/PortMaster-New/releases/latest/download/ports.json";
const SHOT_URL = "https://raw.githubusercontent.com/PortsMaster/PortMaster-New/main/ports/";
const PM = "/mnt/mmc/MUOS/PortMaster";
const HM = `cd ${PM} && ./harbourmaster --quiet --no-check --no-log --no-colour`;
const LOG = "/tmp/mgr-port.log";
const DONE = "/tmp/mgr-port.done";
const FRESH_MS = 12 * 3600_000;
const AGENT = { "User-Agent": "muos-anbernic-manager" };

/** MustardOS's glibc (2.38), for ports that need a newer one. */
const GLIBC = 2038;
const capsOf = (id: unknown) => new Set(portCaps(deviceFor(id) ?? byId(DEFAULT_DEVICE)!));
const DEFAULT_CAPS = capsOf(DEFAULT_DEVICE);

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
export const safePort = (n: unknown): n is string => typeof n === "string" && /^[a-z0-9][a-z0-9._+-]{0,80}\.zip$/i.test(n);
const safeDir = (n: unknown): n is string => typeof n === "string" && n.length > 0 && n.length <= 120 && !n.startsWith(".") && !/[/\\\0\r\n\t]/.test(n);

export interface Port {
  name: string; title: string; desc: string; inst: string; porter: string[]; genres: string[]; rtr: boolean; avail: string;
  size: number; added: string; updated: string; shot: string; runtime: string[]; store: { name: string; url: string }[];
  items: string[]; fits: boolean; why: string;
  /** PortMaster's requirements, checked against the model each time. */
  need: Need;
}

interface Need { reqs?: string[]; arch?: string[]; min_glibc?: string }

/** Why a port will not run on a handheld with these capabilities, or "" when it will (PortMaster's reqs and arch rules). */
export function unfit(attr: { reqs?: unknown; arch?: unknown; min_glibc?: unknown }, caps = DEFAULT_CAPS): string {
  const arch = Array.isArray(attr.arch) ? attr.arch.map(String) : [];
  if (arch.length && !arch.some((a) => caps.has(a))) return `Built for ${arch.join(" and ")}`;
  const glibc = /^(\d+)\.(\d+)$/.exec(String(attr.min_glibc ?? ""));
  if (glibc && Number(glibc[1]) * 1000 + Number(glibc[2]) > GLIBC) return `Needs glibc ${glibc[0]}`;
  for (const raw of Array.isArray(attr.reqs) ? attr.reqs.map(String) : []) {
    const req = raw.trim().toLowerCase();
    if (!req) continue;
    if (req.startsWith("!")) { if (caps.has(req.slice(1))) return `Not for ${req.slice(1)}`; continue; }
    if (!req.split("|").some((r) => caps.has(r))) return `Needs ${req.replace("|", " or ")}`;
  }
  return "";
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x).map(String) : []);

/** The ports in ports.json, with what this handheld can run worked out. */
export function parseCatalogue(raw: unknown): Port[] {
  const ports = (raw as { ports?: Record<string, Record<string, unknown>> })?.ports;
  if (!ports || typeof ports !== "object") throw new UserError("The PortMaster list is not in the expected format.");
  const out: Port[] = [];
  for (const [key, p] of Object.entries(ports)) {
    const name = typeof p?.name === "string" ? p.name : key;
    const attr = (p?.attr ?? {}) as Record<string, unknown>, source = (p?.source ?? {}) as Record<string, unknown>;
    if (!safePort(name) || typeof source.url !== "string") continue;
    const image = (attr.image ?? {}) as Record<string, unknown>;
    const shot = typeof image.screenshot === "string" && /^[\w.-]+\.(png|jpg|jpeg)$/i.test(image.screenshot) ? image.screenshot : "";
    const need: Need = { reqs: strings(attr.reqs).slice(0, 20), arch: strings(attr.arch).slice(0, 8), min_glibc: text(attr.min_glibc, 12) };
    const why = unfit(need);
    out.push({
      name, title: text(attr.title, 120) || name.replace(/\.zip$/i, ""), desc: text(attr.desc, 700), inst: text(attr.inst, 700),
      porter: strings(attr.porter).slice(0, 6), genres: strings(attr.genres).slice(0, 6), rtr: attr.rtr === true,
      avail: text(attr.availability, 20).toLowerCase(), size: Number(source.size) || 0,
      added: text(source.date_added, 10), updated: text(source.date_updated, 10), shot, runtime: strings(attr.runtime).slice(0, 6),
      store: (Array.isArray(attr.store) ? attr.store : []).flatMap((s: Record<string, unknown>) =>
        typeof s?.gameurl === "string" && /^https:\/\//.test(s.gameurl) ? [{ name: text(s.name, 40) || "Store", url: s.gameurl }] : []).slice(0, 4),
      items: strings(p.items).slice(0, 20), fits: !why, why, need,
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

// ---------------------------------------------------------------- the catalogue

let catalogue: { fetched: number; ports: Port[] } | null = null;
const cacheDir = () => path.join(ctx.cacheDir, "ports");
const catalogueFile = () => path.join(cacheDir(), "catalogue.json");

async function loadCatalogue(refresh: boolean): Promise<{ fetched: number; ports: Port[]; error: string }> {
  if (!catalogue) { try { catalogue = JSON.parse(await fsp.readFile(catalogueFile(), "utf8")); } catch {} }
  if (catalogue && catalogue.ports.length && !catalogue.ports[0].need) catalogue.fetched = 0;
  if (catalogue && !refresh && Date.now() - catalogue.fetched < FRESH_MS) return { ...catalogue, error: "" };
  try {
    const res = await fetch(DATA_URL, { headers: AGENT, redirect: "follow", signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    catalogue = { fetched: Date.now(), ports: parseCatalogue(await res.json()) };
    await fsp.mkdir(cacheDir(), { recursive: true });
    await fsp.writeFile(catalogueFile(), JSON.stringify(catalogue));
    return { ...catalogue, error: "" };
  } catch (error) {
    const message = error instanceof UserError ? error.message : `Could not load the PortMaster list: ${(error as Error).message}`;
    return { fetched: catalogue?.fetched ?? 0, ports: catalogue?.ports ?? [], error: message };
  }
}

// ---------------------------------------------------------------- the handheld

interface Installed { dir: string; name: string; title: string; kb: number; items: string[] }
export interface DevicePorts { portsDir: string; scriptsDir: string; freeKb: number; foreground: string; installed: Installed[]; scripts: string[] }

const DEVICE_SCRIPT = String.raw`PM=${PM}
[ -x "$PM/harbourmaster" ] || { echo "@nopm"; exit 0; }
if [ ! -f "$PM/config/muos_mmc_master_race.txt" ] && df | grep -q /mnt/sdcard; then B=/mnt/sdcard; else B=/mnt/mmc; fi
printf '@dirs\t%s\t%s\n' "$B/ports" "$B/ROMS/Ports"
printf '@free\t%s\n' "$(df -k "$B" | awk 'NR==2{print $4}')"
printf '@fg\t%s\n' "$(cat /opt/muos/config/system/foreground_process 2>/dev/null)"
for f in "$B"/ports/*/port.json; do [ -f "$f" ] || continue; d=$(dirname "$f")
  printf '=%s\t%s\t' "$(basename "$d")" "$(du -sk "$d" | cut -f1)"; tr -d '\r\n\t' < "$f"; echo
done
for s in "$B"/ROMS/Ports/*.sh; do [ -f "$s" ] && printf '>%s\n' "$(basename "$s")"; done
true`;

export function parseDevice(out: string): DevicePorts {
  if (out.includes("@nopm")) throw new UserError("PortMaster is not on this handheld. MustardOS brings it back with a factory reset of the PortMaster app.");
  const d: DevicePorts = { portsDir: "", scriptsDir: "", freeKb: 0, foreground: "", installed: [], scripts: [] };
  for (const line of out.split("\n")) {
    const f = line.split("\t");
    if (f[0] === "@dirs") { d.portsDir = f[1] ?? ""; d.scriptsDir = f[2]?.trim() ?? ""; }
    else if (f[0] === "@free") d.freeKb = Number(f[1]) || 0;
    else if (f[0] === "@fg") d.foreground = f[1]?.trim() ?? "";
    else if (f[0].startsWith("=") && safeDir(f[0].slice(1))) {
      let info: Record<string, unknown> = {};
      try { info = JSON.parse(f.slice(2).join("\t")); } catch {}
      const attr = (info.attr ?? {}) as Record<string, unknown>;
      d.installed.push({ dir: f[0].slice(1), name: safePort(info.name) ? info.name : "", title: text(attr.title, 120) || f[0].slice(1), kb: Number(f[1]) || 0, items: strings(info.items) });
    } else if (f[0].startsWith(">") && f[0].endsWith(".sh")) d.scripts.push(f[0].slice(1));
  }
  d.installed.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  return d;
}

async function connected(): Promise<void> {
  const s = await sshStatus();
  if (!s.configured || !s.reachable) throw new UserError("Connect the handheld over Wi-Fi with Secure Shell on to manage ports.");
}

let lastDevice: DevicePorts | null = null;
const readDevice = async () => (lastDevice = parseDevice((await runCommand(DEVICE_SCRIPT, 30_000)).out));

// ---------------------------------------------------------------- install and remove

interface Task { name: string; title: string; state: "running" | "done" | "failed"; line: string; started: number; error: string }
let task: Task | null = null;
let busy = "";
const inMenu = (d: DevicePorts) => d.foreground === "" || d.foreground === "muxfrontend";

/** The catalogue, the ports on the handheld when it can be reached over SSH, and a running install. */
export async function portsJson(query?: URLSearchParams) {
  const [cat, status] = await Promise.all([loadCatalogue(query?.get("refresh") === "1"), sshStatus()]);
  const reachable = !!(status.configured && status.reachable);
  let device: DevicePorts | null = null, deviceError = "";
  if (reachable && query?.get("device") !== "0") {
    try { device = await readDevice(); } catch (error) { deviceError = (error as Error).message; }
  }
  const caps = capsOf(query?.get("model"));
  const ports = cat.ports.map((p) => {
    const why = unfit(p.need ?? {}, caps);
    return { ...p, fits: !why, why };
  });
  return { catalogue: { fetched: cat.fetched, error: cat.error, ports }, reachable, host: status.host, device, deviceError, task };
}

/** Just the running (or last) install, for polling. */
export const portTask = () => ({ task });

const lastLine = (log: string) => log.replace(/\x1b\[[0-9;]*m/g, "").split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean).pop() ?? "";

async function watch(t: Task): Promise<void> {
  const deadline = Date.now() + 45 * 60_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 2500));
    const { out } = await runCommand(`cat ${DONE} 2>/dev/null; echo @@; tail -c 3000 ${LOG} 2>/dev/null`, 20_000).catch(() => ({ out: "@@" }));
    const [code, log = ""] = out.split("@@\n");
    if (log.trim()) t.line = lastLine(log).slice(0, 200);
    if (code.trim()) {
      const installed = (await readDevice().catch(() => null))?.installed.some((p) => p.name.toLowerCase() === t.name.toLowerCase());
      if (code.trim() === "0" && installed) {
        t.state = "done";
        say("green", "INSTALLED", `${t.title} on the handheld, with PortMaster.`);
      } else {
        t.state = "failed";
        t.error = t.line || `PortMaster stopped with code ${code.trim()}.`;
        say("red", "FAILED", `${t.title}: ${t.error}`);
      }
      await runCommand(`rm -f ${LOG} ${DONE}`).catch(() => {});
      return;
    }
    if (Date.now() > deadline) {
      t.state = "failed";
      t.error = "The install took longer than 45 minutes. Check PortMaster on the handheld.";
      return;
    }
  }
}

/** Has the handheld's PortMaster download and install a port (with any runtime it needs); runs in the background. */
export async function installPort(body: Record<string, unknown>) {
  const port = (await loadCatalogue(false)).ports.find((p) => p.name === body.name);
  if (!port) throw new UserError("That port is not in the PortMaster list.");
  if (busy || task?.state === "running") throw new UserError(`Wait until ${busy || `${task!.title} is installed`}.`);
  busy = `installing ${port.title}`;
  try {
    await connected();
    const d = await readDevice();
    if (!inMenu(d)) throw new UserError("Go back to the handheld's main menu first; a game or app is running.");
    if (port.size && d.freeKb * 1024 < port.size * 2.5) throw new UserError(`${port.title} needs about ${Math.ceil((port.size * 2.5) / 1024 ** 2)} MB free on the handheld.`);
    const run = `./harbourmaster --quiet --no-check --no-log --no-colour install pm/${port.name} >${LOG} 2>&1; echo $? >${DONE}`;
    const { out } = await runCommand(`rm -f ${LOG} ${DONE}; cd ${PM} && setsid -f sh -c ${quote(run)} </dev/null >/dev/null 2>&1; echo @ok`);
    if (!out.includes("@ok")) throw new UserError("PortMaster did not start on the handheld.");
    const t: Task = { name: port.name, title: port.title, state: "running", line: "Starting PortMaster", started: Date.now(), error: "" };
    task = t;
    say("cyan", "PORT", `Installing ${port.title} with PortMaster on the handheld.`);
    watch(t).catch((error) => { t.state = "failed"; t.error = (error as Error).message; });
    return { task };
  } finally {
    busy = "";
  }
}

/** Removes an installed port with PortMaster: its folder, launch script and artwork. */
export async function uninstallPort(body: Record<string, unknown>) {
  if (!safePort(body.name)) throw new UserError("Unknown port.");
  if (busy || task?.state === "running") throw new UserError(`Wait until ${busy || `${task!.title} is installed`}.`);
  busy = "removing a port";
  try {
    await connected();
    const before = await readDevice();
    const port = before.installed.find((p) => p.name.toLowerCase() === String(body.name).toLowerCase());
    if (!port) throw new UserError("That port is not installed on the handheld.");
    if (!inMenu(before)) throw new UserError("Go back to the handheld's main menu first; a game or app is running.");
    const { out, err } = await runCommand(`${HM} uninstall ${quote(port.name)} 2>&1`, 180_000);
    const after = await readDevice();
    if (after.installed.some((p) => p.name.toLowerCase() === port.name.toLowerCase())) throw new UserError(lastLine(out || err) || "PortMaster could not remove the port.");
    say("yellow", "REMOVED", `${port.title} from the handheld, with PortMaster.`);
    return portsJson(new URLSearchParams({ device: "1", model: String(body.model ?? "") }));
  } finally {
    busy = "";
  }
}

/** Streams one game file (PUT body) into an installed port's folder, for ports that need the game's own files. */
export async function uploadPortFile(req: http.IncomingMessage, query: URLSearchParams) {
  const dir = query.get("dir") ?? "", rel = (query.get("path") ?? "").normalize("NFC");
  const parts = rel.split("/");
  if (!safeDir(dir) || !rel || parts.length > 12 || parts.some((p) => !p || p === "." || p === ".." || /[\\\0\r\n]/.test(p))) throw new UserError("Invalid path.");
  if (busy || task?.state === "running") throw new UserError(`Wait until ${busy || `${task!.title} is installed`}.`);
  await connected();
  const d = lastDevice ?? (await readDevice());
  if (!d.installed.some((p) => p.dir === dir)) throw new UserError("That port is not installed on the handheld.");
  const expected = Number(req.headers["content-length"] ?? NaN);
  const target = `${d.portsDir}/${dir}/${rel}`;
  const check = Number.isFinite(expected) ? ` && [ "$(wc -c < "$p")" -eq ${expected} ]` : "";
  const cmd = `t=${quote(target)}; p="$t.mgr-part"; mkdir -p "$(dirname "$t")" && cat > "$p"${check} && mv -f "$p" "$t" && echo @ok || { rm -f "$p"; echo @fail; }`;
  let out = "";
  const sink = new Writable({ write(chunk, _e, done) { out += chunk.toString(); done(); } });
  const { err } = await streamCommand(cmd, { stdin: req, stdout: sink }, 60 * 60_000);
  if (!out.includes("@ok")) throw new UserError(err.trim() || `Could not copy ${parts[parts.length - 1]} to the handheld.`);
  return { ok: true, path: `${dir}/${rel}` };
}

// ---------------------------------------------------------------- screenshots

/** A port's screenshot from the PortMaster repository, kept on disk after the first look. */
export async function portShot(query: URLSearchParams) {
  const name = query.get("name") ?? "";
  const port = (await loadCatalogue(false)).ports.find((p) => p.name === name);
  if (!port || !port.shot) throw new UserError("This port has no screenshot.");
  const ext = path.extname(port.shot).toLowerCase();
  const file = path.join(cacheDir(), "shots", `${crypto.createHash("sha1").update(name).digest("hex")}${ext}`);
  try { return { image: await fsp.readFile(file), name: file }; } catch {}
  const missing = `${file}.none`;
  if (fs.existsSync(missing)) throw new UserError("This port has no screenshot.");
  const res = await fetch(`${SHOT_URL}${encodeURIComponent(name.replace(/\.zip$/i, ""))}/${encodeURIComponent(port.shot)}`, { headers: AGENT, signal: AbortSignal.timeout(30_000) });
  await fsp.mkdir(path.dirname(file), { recursive: true });
  if (res.status === 404) { await fsp.writeFile(missing, ""); throw new UserError("This port has no screenshot."); }
  if (!res.ok) throw new UserError(`GitHub answered ${res.status}.`);
  const image = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(file, image);
  return { image, name: file };
}
