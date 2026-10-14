// Game Tuning: per-game emulator settings for speed and looks, saved on the handheld over SSH. Standalone PPSSPP gets
// SYSTEM/<DISCID>_ppsspp.ini, RetroArch cores get config/<Core>/<game>.opt, and any game can get its own CPU governor
// in content/<FOLDER>/<game>.gov. Both emulators read only the game's file once it exists, so it starts as a copy of
// what the game used before and untouched settings stay the same.

import fsp from "node:fs/promises";
import path from "node:path";
import { coresJson } from "../cores.ts";
import { ctx } from "../context.ts";
import { runCommand } from "../device/ssh.ts";
import { UserError } from "../errors.ts";
import { say } from "../log.ts";
import { inside, shq as quote } from "../util.ts";
import { discId, type ReadAt } from "./disc-id.ts";
import { CORE_FOLDERS, GOVERNORS, PROFILES, RECOMMENDATIONS, profileFor, type Profile } from "./profiles.ts";

const CFG = "/opt/muos/share/info/config";
const INFO = "/opt/muos/share/emulator/retroarch/info";
const CONTENT = "/opt/muos/share/info/content";
const ROMS = "/mnt/union/ROMS";
export const PPSSPP = "/opt/muos/share/emulator/ppsspp/.config/ppsspp/PSP/SYSTEM";
const GOVS = "/sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors";

export const stem = (f: string) => (f.lastIndexOf(".") > 0 ? f.slice(0, f.lastIndexOf(".")) : f);
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

// ---------------------------------------------------------------- settings files

/** RetroArch .opt lines: key = "value". Keys may hold dashes and dots. */
export function parseOpt(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^\s*([^\s=#]+)\s*=\s*"(.*)"\s*$/.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

export function setOpt(text: string, values: Record<string, string>): string {
  const left = new Map(Object.entries(values));
  const lines = text.split("\n").filter((l) => l.trim()).map((l) => {
    const k = /^\s*([^\s=#]+)\s*=/.exec(l)?.[1];
    if (!k || !left.has(k)) return l;
    const v = left.get(k)!;
    left.delete(k);
    return `${k} = "${v}"`;
  });
  for (const [k, v] of left) lines.push(`${k} = "${v}"`);
  return lines.join("\n") + "\n";
}

/** PPSSPP ini: [Section] headers and "Key = Value" lines. */
export function parseIni(text: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  let cur = new Map<string, string>();
  out.set("", cur);
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const sec = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (sec) { cur = out.get(sec[1]) ?? new Map(); out.set(sec[1], cur); continue; }
    const m = /^\s*([^=#;\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) cur.set(m[1], m[2]);
  }
  return out;
}

export function setIni(text: string, section: string, key: string, value: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  let start = lines.findIndex((l) => l.trim() === `[${section}]`);
  if (start < 0) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push(`[${section}]`, `${key} = ${value}`, "");
    return lines.join("\n");
  }
  let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
  if (end < 0) end = lines.length;
  const at = lines.findIndex((l, i) => i > start && i < end && new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`).test(l));
  if (at >= 0) lines[at] = `${key} = ${value}`;
  else {
    let last = end;
    while (last > start + 1 && !lines[last - 1].trim()) last--;
    lines.splice(last, 0, `${key} = ${value}`);
  }
  return lines.join("\n");
}

/** The [ControlMapping] section of controls.ini; PPSSPP resets the buttons when a game ini lacks it. */
export function controlMapping(controls: string): string {
  const lines = controls.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((l) => l.trim() === "[ControlMapping]");
  if (start < 0) return "";
  let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join("\n").trimEnd() + "\n";
}

/** A new PPSSPP game ini: the global settings and button mapping, so only the tuned keys change. */
export function newGameIni(global: string, controls: string, id: string, title: string): string {
  const body = global.replace(/\r/g, "").split("\n").filter((l) => !/^\s*(GraphicsBackend|FailedGraphicsBackends)\s*=/.test(l)).join("\n").trimEnd();
  const mapping = /^\s*\[ControlMapping\]\s*$/m.test(body) ? "" : controlMapping(controls);
  return `; Game config for ${id} - ${title.replace(/[#\n]/g, "")}\n${body}\n${mapping ? `\n${mapping}` : ""}`;
}

// ---------------------------------------------------------------- reading the handheld

interface Folder { name: string; so: string; core: string; profile: string | null; overrides: { file: string; name: string; so: string }[] }

let cache: { at: number; data: Awaited<ReturnType<typeof read>> } | null = null;

async function read() {
  const cores = await coresJson();
  if (!cores.reachable) return null;
  const soOf = (f: (typeof cores.folders)[number]) => {
    if (f.folder?.so) return f.folder.so;
    const system = cores.systems.find((s) => s.name === f.auto);
    return system?.cores.find((c) => c.key === system.defaultCore)?.so ?? "";
  };
  const sos = new Set<string>();
  for (const f of cores.folders) { sos.add(soOf(f)); for (const o of f.overrides) sos.add(o.so); }
  const lr = [...sos].filter((s) => s.endsWith(".so"));
  const { out } = await runCommand(`
for so in ${lr.map(quote).join(" ") || "''"}; do [ -n "$so" ] && printf '=N\\t%s\\t%s\\n' "$so" "$(sed -n 's/^corename *= *"\\(.*\\)"/\\1/p' "${INFO}/\${so%.so}.info" 2>/dev/null | head -1)"; done
printf '=G\\t%s\\n' "$(cat ${GOVS} 2>/dev/null)"
printf '=D\\t%s\\n' "$(cat ${CONTENT}/core.gov 2>/dev/null)"
cd ${CONTENT} 2>/dev/null && for f in */*.gov; do [ -f "$f" ] && printf '=T\\tgov\\t%s\\n' "$f"; done
cd ${CFG} 2>/dev/null && for f in */*.opt; do [ -f "$f" ] && printf '=T\\topt\\t%s\\n' "$f"; done
cd ${PPSSPP} 2>/dev/null && for f in *_ppsspp.ini; do [ -f "$f" ] && printf '=T\\tini\\t%s\\n' "$f"; done
echo =E`, 60_000);
  if (!out.includes("=E")) throw new UserError("The handheld did not answer completely. Try again.");
  const names = new Map<string, string>(), tuned: [string, string][] = [];
  let governors: string[] = [], defaultGov = "";
  for (const line of out.split("\n")) {
    const [tag, a = "", b = ""] = line.split("\t");
    if (tag === "=N") names.set(a, CORE_FOLDERS[a] || b);
    else if (tag === "=G") governors = a.trim().split(/\s+/).filter((g) => g in GOVERNORS);
    else if (tag === "=D") defaultGov = a.trim();
    else if (tag === "=T") tuned.push([a, b]);
  }
  const coreOf = (so: string) => (so.endsWith(".so") ? names.get(so) || "" : "");
  const folders: Folder[] = cores.folders.map((f) => {
    const so = soOf(f);
    return {
      name: f.name, so, core: coreOf(so), profile: profileFor(so, coreOf(so))?.id ?? null,
      overrides: f.overrides.map((o) => ({ file: o.file, name: o.name, so: o.so })),
    };
  });
  return { host: cores.host, folders, coreOf, governors, defaultGov, tuned };
}

export async function load(fresh = false) {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache.data;
  const data = await read();
  cache = data ? { at: Date.now(), data } : null;
  return data;
}

/** Which emulator a game starts with: its own core when it has one, else its folder's. */
export function emulatorOf(data: NonNullable<Awaited<ReturnType<typeof read>>>, folderName: string, file: string) {
  const folder = data.folders.find((f) => f.name === folderName);
  if (!folder) throw new UserError(`${folderName} is not a ROM folder on the handheld.`);
  const own = folder.overrides.find((o) => o.file === file || o.name === stem(file));
  const so = own?.so || folder.so, core = data.coreOf(so);
  return { folder, so, core, profile: profileFor(so, core), own: !!own };
}

export function checkFile(file: string) {
  if (!file || /[/\n\0]/.test(file) || file.startsWith(".")) throw new UserError(`"${file}" is not a game file name.`);
}

export async function tuningJson() {
  const data = await load(true);
  if (!data) return { reachable: false, folders: [], profiles: PROFILES, recommendations: RECOMMENDATIONS, governors: {} };
  return {
    reachable: true, host: data.host,
    folders: data.folders.map(({ name, so, core, profile }) => ({ name, so, core, profile })),
    governors: Object.fromEntries(data.governors.map((g) => [g, GOVERNORS[g]])), defaultGov: data.defaultGov,
    tuned: data.tuned, profiles: PROFILES, recommendations: RECOMMENDATIONS,
  };
}

/** Reads part of a game: the library copy when there is one, else the file on the handheld. */
async function readerFor(folder: string, file: string): Promise<[ReadAt, "library" | "handheld", () => Promise<void>] | null> {
  const local = path.join(ctx.roms, folder, file);
  if (inside(ctx.roms, local)) {
    const h = await fsp.open(local, "r").catch(() => null);
    if (h) {
      const read: ReadAt = async (pos, len) => {
        const buf = Buffer.alloc(len);
        const { bytesRead } = await h.read(buf, 0, len, pos);
        return buf.subarray(0, bytesRead);
      };
      return [read, "library", () => h.close()];
    }
  }
  const remote = quote(`${ROMS}/${folder}/${file}`);
  const read: ReadAt = async (pos, len) => {
    const { out, code } = await runCommand(`dd if=${remote} bs=65536 iflag=skip_bytes,count_bytes skip=${pos} count=${len} 2>/dev/null | base64`, 30_000);
    if (code !== 0) throw new Error("dd failed");
    return Buffer.from(out.replace(/\s+/g, ""), "base64");
  };
  return [read, "handheld", async () => {}];
}

const ids = new Map<string, string>();

export async function pspDiscId(folder: string, file: string, onDevice: boolean): Promise<{ id: string; from: string }> {
  const key = `${folder}/${file}`;
  if (ids.has(key)) return { id: ids.get(key)!, from: "cache" };
  const local = await fsp.stat(path.join(ctx.roms, folder, file)).then(() => true, () => false);
  if (!local && !onDevice) return { id: "", from: "" };
  const reader = await readerFor(folder, file);
  if (!reader) return { id: "", from: "" };
  const [readAt, from, close] = reader;
  try {
    const id = await discId(readAt, file).catch(() => "");
    if (id) ids.set(key, id);
    return { id, from: id ? from : "" };
  } finally {
    await close();
  }
}

export const DISC_ID = /^[A-Z]{4}[0-9]{5}$/;

/** What one game uses now: its own file's values (if any) and the values it falls back to without one. */
async function gameState(query: { folder: string; file: string; discId?: string }) {
  const data = await load();
  if (!data) throw new UserError("Connect the handheld over Wi-Fi with SSH on to tune games.");
  checkFile(query.file);
  const em = emulatorOf(data, query.folder, query.file);
  const name = stem(query.file), p = em.profile;
  const dir = `${CONTENT}/${query.folder}`;
  const { out: first } = await runCommand(`[ -f ${quote(`${ROMS}/${query.folder}/${query.file}`)} ] && echo =ON; echo =E`, 20_000);
  const onDevice = first.includes("=ON");
  let id = "", idFrom = "";
  if (p?.kind === "ppsspp") {
    const given = String(query.discId ?? "").toUpperCase();
    ({ id, from: idFrom } = DISC_ID.test(given) ? { id: given, from: "typed" } : await pspDiscId(query.folder, query.file, onDevice));
  }
  const files: Record<string, string> = { gameGov: `${dir}/${name}.gov`, folderGov: `${dir}/core.gov` };
  if (p?.kind === "retroarch" && em.core) Object.assign(files, { game: `${CFG}/${em.core}/${name}.opt`, folder: `${CFG}/${em.core}/${query.folder}.opt`, core: `${CFG}/${em.core}/${em.core}.opt` });
  if (p?.kind === "ppsspp") Object.assign(files, { global: `${PPSSPP}/ppsspp.ini`, controls: `${PPSSPP}/controls.ini`, ...(id ? { game: `${PPSSPP}/${id}_ppsspp.ini` } : {}) });
  const { out } = await runCommand(`${Object.entries(files).map(([k, f]) => `[ -f ${quote(f)} ] && { printf '=F\\t%s\\n' ${k}; cat ${quote(f)}; echo; }`).join("\n")}\necho =E`, 30_000);
  if (!out.includes("=E")) throw new UserError("The handheld did not answer completely. Try again.");
  const text: Record<string, string> = {};
  let cur = "";
  for (const line of out.split("\n")) {
    const m = /^=F\t(\w+)$/.exec(line);
    if (m) { cur = m[1]; text[cur] = ""; continue; }
    if (line === "=E") break;
    if (cur) text[cur] += line + "\n";
  }
  return { data, em, p, name, onDevice, id, idFrom, files, text };
}

function valuesOf(p: Profile, text: string | undefined): Record<string, string> | null {
  if (text === undefined) return null;
  const out: Record<string, string> = {};
  if (p.kind === "ppsspp") {
    const ini = parseIni(text);
    for (const s of p.settings) { const v = ini.get(s.section!)?.get(s.key); if (v !== undefined) out[s.key] = v; }
  } else {
    const opt = parseOpt(text);
    for (const s of p.settings) { const v = opt.get(s.key); if (v !== undefined) out[s.key] = v; }
  }
  return out;
}

export async function gameTuning(query: URLSearchParams) {
  const st = await gameState({ folder: String(query.get("folder") ?? ""), file: String(query.get("file") ?? ""), discId: String(query.get("discId") ?? "") });
  const { em, p, text } = st;
  const baseFrom = p?.kind === "ppsspp" ? (text.global !== undefined ? "global" : "defaults")
    : text.folder !== undefined ? "folder" : text.core !== undefined ? "core" : "defaults";
  const baseText = p?.kind === "ppsspp" ? text.global : text.folder ?? text.core;
  const base = p ? valuesOf(p, baseText) ?? {} : {};
  const own = p && (p.kind === "retroarch" || st.id) ? valuesOf(p, text.game) : null;
  const known = p?.kind === "retroarch" && baseText !== undefined ? new Set(parseOpt(baseText).keys()) : null;
  const gov = (s: string | undefined) => (s ?? "").trim();
  return {
    folder: em.folder.name, file: String(query.get("file")), stem: st.name, onDevice: st.onDevice,
    so: em.so, core: em.core, ownCore: em.own, profile: p?.id ?? null,
    discId: st.id, discIdFrom: st.idFrom,
    own, base, baseFrom,
    available: p ? p.settings.filter((s) => !known || known.has(s.key)).map((s) => s.key) : [],
    gov: { own: gov(text.gameGov), folder: gov(text.folderGov), system: st.data.defaultGov },
  };
}

// ---------------------------------------------------------------- saving

/** Checks values against the offered choices; a value the game's own file already holds is kept as it is. */
function checkValues(p: Profile, values: Record<string, unknown>, own: Record<string, string> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(values)) {
    const v = String(raw ?? "");
    const s = p.settings.find((x) => x.key === k);
    if (!s) throw new UserError(`${k} is not a setting Game Tuning changes.`);
    if (v && v !== own?.[k] && !s.options.some(([o]) => o === v)) throw new UserError(`"${v}" is not a choice for ${s.label}.`);
    out[k] = v;
  }
  return out;
}

export const writeFile = (file: string, content: string) =>
  `printf '%s' ${quote(b64(content))} | base64 -d > ${quote(file + ".tmp")} && mv ${quote(file + ".tmp")} ${quote(file)} || exit 1`;

export async function saveTuning(body: Record<string, unknown>) {
  const st = await gameState({ folder: String(body.folder ?? ""), file: String(body.file ?? ""), discId: String(body.discId ?? "") });
  const { data, em, p, name, text, files } = st;
  const gov = String(body.gov ?? "");
  if (gov && !data.governors.includes(gov)) throw new UserError(`${gov} is not a CPU governor on the handheld.`);
  const values = p ? checkValues(p, (body.values ?? {}) as Record<string, unknown>, valuesOf(p, text.game)) : {};
  const changes = Object.values(values).some(Boolean);
  const steps: string[] = [];
  if (p && (changes || text.game !== undefined)) {
    if (p.kind === "ppsspp") {
      if (!st.id) throw new UserError("PPSSPP needs the game's disc ID (like ULUS10391) to keep settings for it.");
      if (text.global === undefined) throw new UserError("PPSSPP's settings file is missing on the handheld. Start PPSSPP once, then try again.");
      const globalIni = parseIni(text.global);
      let ini = text.game ?? newGameIni(text.global, text.controls ?? "", st.id, name);
      for (const s of p.settings) {
        if (!(s.key in values)) continue;
        const v = values[s.key] || globalIni.get(s.section!)?.get(s.key) || s.def;
        ini = setIni(ini, s.section!, s.key, v);
      }
      steps.push(writeFile(files.game, ini));
    } else {
      if (!em.core) throw new UserError(`${em.so} is not a RetroArch core Game Tuning knows.`);
      const baseText = text.folder ?? text.core ?? "";
      const base = parseOpt(baseText);
      const set: Record<string, string> = {};
      for (const s of p.settings) if (s.key in values) set[s.key] = values[s.key] || base.get(s.key) || s.def;
      steps.push(`mkdir -p ${quote(`${CFG}/${em.core}`)} || exit 1`, writeFile(files.game, setOpt(text.game ?? baseText, set)));
    }
  }
  if (gov) steps.push(writeFile(files.gameGov, `${gov}\n`));
  else if (text.gameGov !== undefined && "gov" in body) steps.push(`rm -f ${quote(files.gameGov)}`);
  if (!steps.length) return { ok: true, changed: false };
  const { out, err } = await runCommand(`mkdir -p ${quote(`${CONTENT}/${em.folder.name}`)} || exit 1\n${steps.join("\n")}\nsync\necho OK`, 30_000);
  if (!out.includes("OK")) throw new UserError(`Saving on the handheld failed${err ? `: ${err.trim()}` : "."}`);
  cache = null;
  say("green", "TUNING", `Saved tuning for ${em.folder.name}/${String(body.file)}${p ? ` (${p.name})` : ""}${gov ? `, governor ${gov}` : ""}.`);
  return { ok: true, changed: true };
}

/** Removes the game's own settings and governor, so it uses its folder's again. */
export async function resetTuning(body: Record<string, unknown>) {
  const st = await gameState({ folder: String(body.folder ?? ""), file: String(body.file ?? ""), discId: String(body.discId ?? "") });
  const gone = [st.text.game !== undefined && st.files.game, st.text.gameGov !== undefined && st.files.gameGov].filter(Boolean) as string[];
  if (!gone.length) return { ok: true, changed: false };
  const { code } = await runCommand(`rm -f ${gone.map(quote).join(" ")} && sync`, 20_000);
  if (code !== 0) throw new UserError("The handheld could not remove the game's settings.");
  cache = null;
  say("yellow", "TUNING", `${st.em.folder.name}/${String(body.file)} uses its folder's settings again.`);
  return { ok: true, changed: true };
}
