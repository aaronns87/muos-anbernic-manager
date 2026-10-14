// Cheats: per-game cheats from the libretro cheat database, saved where the game's emulator loads them by itself.
// RetroArch reads <cheat_database_path>/<core>/<game>.cht when a game starts, but switches the enabled ones on only
// with apply_cheats_after_load. Standalone PPSSPP reads PSP/Cheats/<DISCID>.ini (MustardOS ships several hundred)
// and applies the _C1 entries while EnableCheats is on.

import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "../context.ts";
import { runCommand } from "../device/ssh.ts";
import { UserError } from "../errors.ts";
import { norm } from "../games/systems.ts";
import { say } from "../log.ts";
import { SOURCES } from "../scrape.ts";
import { shq as quote } from "../util.ts";
import { checkFile, DISC_ID, emulatorOf, load, parseIni, PPSSPP, pspDiscId, setIni, stem, writeFile } from "./tuning.ts";

const RA_CFG = "/opt/muos/share/info/config/retroarch.cfg";
const RA_CHEATS = "/opt/muos/share/emulator/retroarch/cheats";
const PSP_CHEATS = path.posix.join(path.posix.dirname(PPSSPP), "Cheats");
const ROMS = "/mnt/union/ROMS";
const TREE = "https://api.github.com/repos/libretro/libretro-database/git/trees/master:cht?recursive=1";
const RAW = "https://raw.githubusercontent.com/libretro/libretro-database/master/cht/";
const AGENT = { "User-Agent": "muos-anbernic-manager" };
const WEEK = 7 * 24 * 3600_000;
const DEVICE_TAG = /\s*\((Action Replay|Pro Action Replay|GameShark|Game Genie|Game Buster|Code Breaker|CodeBreaker|Xploder)\)$/;
const SET_ALIASES: Record<string, string> = { "Atari - 8-bit": "Atari - 8-bit Family" };

export interface Cheat { desc: string; code: string; on: boolean; note?: boolean }

// ---------------------------------------------------------------- file formats

const unquote = (v: string) => {
  const t = v.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
};

/** Entries without a real code are headings or notes in the database files. */
const isNote = (code: string) => !code.trim() || /^(_L\s+0x0+\s+0x0+\s*)+$/i.test(code.trim());

/** RetroArch .cht files: cheats = N, then cheatI_desc, cheatI_code and cheatI_enable. */
export function parseCht(text: string): Cheat[] {
  const keys = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([\w.-]+)\s*=\s*(.*)$/.exec(line);
    if (m) keys.set(m[1], unquote(m[2]));
  }
  const n = Math.min(Number.parseInt(keys.get("cheats") ?? "0", 10) || 0, 5000);
  const out: Cheat[] = [];
  for (let i = 0; i < n; i++) {
    const desc = keys.get(`cheat${i}_desc`) ?? "", code = keys.get(`cheat${i}_code`) ?? "";
    out.push({ desc: desc || `Cheat ${i + 1}`, code, on: keys.get(`cheat${i}_enable`) === "true", ...(isNote(code) ? { note: true } : {}) });
  }
  return out;
}

/** Switches cheats in an existing .cht on and off by number, keeping the other keys RetroArch may have saved. */
export function setChtEnabled(text: string, on: Set<number>): string {
  const n = parseCht(text).length;
  let out = text.replace(/^(\s*cheat(\d+)_enable\s*=\s*).*$/gm, (_, pre: string, i: string) => `${pre}${on.has(Number(i))}`);
  for (let i = 0; i < n; i++) if (!new RegExp(`^\\s*cheat${i}_enable\\s*=`, "m").test(out)) out = `${out.replace(/\n*$/, "")}\ncheat${i}_enable = ${on.has(i)}\n`;
  return out;
}

/** RetroArch's config reader ends a quoted value at the next quote, so quotes inside are swapped for apostrophes. */
export function writeCht(cheats: Cheat[]): string {
  const clean = (s: string) => s.replace(/"/g, "'").replace(/[\r\n]+/g, " ");
  const lines = [`cheats = ${cheats.length}`, ""];
  cheats.forEach((c, i) => lines.push(`cheat${i}_desc = "${clean(c.desc)}"`, `cheat${i}_code = "${clean(c.code)}"`, `cheat${i}_enable = ${c.on && !c.note ? "true" : "false"}`, ""));
  return lines.join("\n");
}

/** PPSSPP cheat files: _S disc ID, _G title, then _C0 (off) or _C1 (on) with the cheat's name, followed by _L code lines. */
export function parsePpssppCheats(text: string): Cheat[] {
  const out: Cheat[] = [];
  let cur: Cheat | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const c = /^_C([01])\s*(.*)$/.exec(line);
    if (c) {
      cur = { desc: c[2].trim() || `Cheat ${out.length + 1}`, code: "", on: c[1] === "1" };
      out.push(cur);
    } else if (cur && /^_[LM]\s/.test(line)) {
      cur.code += (cur.code ? " " : "") + line.replace(/\/\/.*$/, "").trim();
    }
  }
  return out.map((c) => (isNote(c.code) ? { ...c, note: true } : c));
}

/** Switches PPSSPP cheats on and off by position, leaving the rest of the file as it is. */
export function setPpssppCheats(text: string, on: Set<number>): string {
  let i = -1;
  return text.split("\n").map((line) => {
    const m = /^(\s*)_C[01](.*)$/.exec(line);
    if (!m) return line;
    i++;
    return `${m[1]}_C${on.has(i) ? 1 : 0}${m[2]}`;
  }).join("\n");
}

/** A PPSSPP cheat file from database entries; their codes hold several "_L a b" lines in one value. */
export function ppssppIni(cheats: Cheat[], id: string, title: string): string {
  const one = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const lines = [`_S ${id.slice(0, 4)}-${id.slice(4)}`, `_G ${one(title)}`];
  for (const c of cheats) {
    if (c.note) continue;
    lines.push(`_C${c.on ? 1 : 0} ${one(c.desc)}`);
    for (const part of c.code.split(/\s*\+\s*|\s+(?=_[LM]\s)/)) {
      const p = part.trim();
      if (p) lines.push(/^_[LM]\s/.test(p) ? p : `_L ${p}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** RetroArch names a game's cheat file after the ROM without its extension, cut again at the last dot that is left. */
export function retroarchName(file: string): string {
  const s = stem(file), dot = s.lastIndexOf(".");
  return dot > 0 ? s.slice(0, dot) : s;
}

// ---------------------------------------------------------------- the database

let index: { at: number; files: string[] } | null = null;
let fetching: Promise<string[]> | null = null;
const indexFile = () => path.join(ctx.cacheDir, "cheats-index.json");

async function fetchIndex(): Promise<string[]> {
  try {
    const res = await fetch(TREE, { headers: { ...AGENT, Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const tree = (await res.json()) as { tree?: { path: string; type: string }[] };
    const files = (tree.tree ?? []).filter((e) => e.type === "blob" && e.path.endsWith(".cht")).map((e) => e.path.slice(0, -4));
    if (!files.length) throw new Error("the list was empty");
    index = { at: Date.now(), files };
    await fsp.mkdir(ctx.cacheDir, { recursive: true });
    await fsp.writeFile(indexFile(), JSON.stringify(index));
    return files;
  } catch (error) {
    if (index) return index.files;
    throw new UserError(`Could not load the libretro cheat list (${(error as Error).message}). Check the internet connection.`);
  }
}

/** Every cheat file in the database as "System/Name", from the cache for a week. */
export async function cheatIndex(): Promise<string[]> {
  if (!index) index = await fsp.readFile(indexFile(), "utf8").then((t) => JSON.parse(t) as typeof index, () => null);
  if (index && Date.now() - index.at < WEEK) return index.files;
  fetching ??= fetchIndex().finally(() => { fetching = null; });
  return fetching;
}

function setsFor(folder: string, files: string[]): Set<string> {
  const want = SOURCES[folder] ?? [];
  const sets = new Set(files.map((f) => f.slice(0, f.indexOf("/"))));
  return new Set([...sets].filter((s) => want.some((w) => s === w || s.startsWith(`${w} (`) || SET_ALIASES[w] === s)));
}

const tagsOf = (s: string) => new Set([...s.matchAll(/[([]([^)\]]*)[)\]]/g)].flatMap((m) => m[1].split(/\s*,\s*/)).map((t) => t.toLowerCase()));

/** Database files for a game, best first: the PSP disc ID, then the exact name, then the same title with most tags in common. */
export function cheatCandidates(files: string[], folder: string, file: string, id = ""): { path: string; name: string }[] {
  const sets = setsFor(folder, files);
  const name = stem(file), key = norm(name), tags = tagsOf(name);
  const found: { path: string; name: string; score: number }[] = [];
  for (const f of files) {
    const slash = f.indexOf("/");
    if (!sets.has(f.slice(0, slash))) continue;
    const n = f.slice(slash + 1), base = n.replace(DEVICE_TAG, "");
    const m = id ? /\[([A-Z]{4})-?(\d{5})\]/.exec(n) : null;
    let score = 0;
    if (m && m[1] + m[2] === id) score = 1000;
    else if (base === name) score = 500;
    else if (key && norm(base) === key) score = 200 + [...tagsOf(base)].filter((t) => tags.has(t)).length * 10;
    if (score) found.push({ path: f, name: n, score });
  }
  return found.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 20).map(({ path: p, name: n }) => ({ path: p, name: n }));
}

const texts = new Map<string, Cheat[]>();

async function dbCheats(p: string): Promise<Cheat[]> {
  if (!(await cheatIndex()).includes(p)) throw new UserError("That cheat file is not in the libretro cheat database.");
  const known = texts.get(p);
  if (known) return known;
  let res: Response;
  try {
    res = await fetch(RAW + `${p}.cht`.split("/").map(encodeURIComponent).join("/"), { headers: AGENT, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new UserError("Could not reach GitHub to download the cheats. Check the internet connection.");
  }
  if (!res.ok) throw new UserError(`GitHub answered ${res.status} for the cheat file.`);
  const cheats = parseCht(await res.text());
  if (texts.size >= 40) texts.delete(texts.keys().next().value!);
  texts.set(p, cheats);
  return cheats;
}

export async function cheatFile(query: URLSearchParams) {
  return { cheats: await dbCheats(String(query.get("path") ?? "")) };
}

// ---------------------------------------------------------------- one game

async function cheatState(q: { folder: string; file: string; discId?: string }) {
  const data = await load();
  if (!data) throw new UserError("Connect the handheld over Wi-Fi with SSH on to set cheats.");
  checkFile(q.file);
  const em = emulatorOf(data, q.folder, q.file);
  const kind = em.profile?.kind === "ppsspp" ? "ppsspp" : em.so.endsWith(".so") && em.core ? "retroarch" : null;
  const { out: first } = await runCommand(`[ -f ${quote(`${ROMS}/${q.folder}/${q.file}`)} ] && echo =ON
sed -n 's/^cheat_database_path *= *"\\(.*\\)"/=P\\t\\1/p; s/^apply_cheats_after_load *= *"\\(.*\\)"/=A\\t\\1/p' ${RA_CFG} 2>/dev/null
echo =E`, 20_000);
  if (!first.includes("=E")) throw new UserError("The handheld did not answer completely. Try again.");
  const tag = (t: string) => first.split("\n").find((l) => l.startsWith(`=${t}\t`))?.slice(3).trim() ?? "";
  const onDevice = first.includes("=ON");
  let id = "", idFrom = "";
  if (kind === "ppsspp") {
    const given = String(q.discId ?? "").toUpperCase();
    ({ id, from: idFrom } = DISC_ID.test(given) ? { id: given, from: "typed" } : await pspDiscId(q.folder, q.file, onDevice));
  }
  const dbPath = tag("P") || RA_CHEATS;
  const target = kind === "retroarch" ? `${dbPath}/${em.core}/${retroarchName(q.file)}.cht` : kind === "ppsspp" && id ? `${PSP_CHEATS}/${id}.ini` : "";
  const files: Record<string, string> = {};
  if (target) files.own = target;
  if (kind === "ppsspp") Object.assign(files, { global: `${PPSSPP}/ppsspp.ini`, ...(id ? { game: `${PPSSPP}/${id}_ppsspp.ini` } : {}) });
  const text: Record<string, string> = {};
  if (Object.keys(files).length) {
    const { out } = await runCommand(`${Object.entries(files).map(([k, f]) => `[ -f ${quote(f)} ] && { printf '=F\\t%s\\n' ${k}; cat ${quote(f)}; echo; }`).join("\n")}\necho =E`, 30_000);
    if (!out.includes("=E")) throw new UserError("The handheld did not answer completely. Try again.");
    let cur = "";
    for (const line of out.split("\n")) {
      const m = /^=F\t(\w+)$/.exec(line);
      if (m) { cur = m[1]; text[cur] = ""; continue; }
      if (line === "=E") break;
      if (cur) text[cur] += line + "\n";
    }
  }
  const pspOn = (t: string | undefined) => (t === undefined ? undefined : parseIni(t).get("General")?.get("EnableCheats"));
  const active = kind === "retroarch" ? tag("A") === "true" : kind === "ppsspp" ? (pspOn(text.game) ?? pspOn(text.global) ?? "False") === "True" : false;
  return { em, kind, onDevice, id, idFrom, target, text, active };
}

export async function cheatsGame(query: URLSearchParams) {
  const folder = String(query.get("folder") ?? ""), file = String(query.get("file") ?? "");
  const st = await cheatState({ folder, file, discId: String(query.get("discId") ?? "") });
  let candidates: { path: string; name: string }[] = [], dbError = "";
  if (st.kind) {
    try {
      candidates = cheatCandidates(await cheatIndex(), folder, file, st.id);
    } catch (error) {
      dbError = (error as Error).message;
    }
  }
  const own = st.text.own === undefined ? null : st.kind === "ppsspp" ? parsePpssppCheats(st.text.own) : parseCht(st.text.own);
  return {
    folder, file, kind: st.kind, core: st.em.core, so: st.em.so, onDevice: st.onDevice,
    discId: st.id, discIdFrom: st.idFrom, target: st.target, active: st.active, own, candidates, dbError,
  };
}

export async function saveCheats(body: Record<string, unknown>) {
  const folder = String(body.folder ?? ""), file = String(body.file ?? "");
  const st = await cheatState({ folder, file, discId: String(body.discId ?? "") });
  if (!st.kind) throw new UserError(`${st.em.so.replace(/^ext-/, "") || "This emulator"} does not load cheats this way; RetroArch cores and PPSSPP do.`);
  if (!st.target) throw new UserError("PPSSPP needs the game's disc ID (like ULUS10391) for its cheats.");
  const source = String(body.source ?? "");
  const on = new Set((Array.isArray(body.on) ? body.on : []).map(Number).filter(Number.isInteger));
  const steps: string[] = [`mkdir -p ${quote(path.posix.dirname(st.target))} || exit 1`];
  if (source === "handheld") {
    if (st.text.own === undefined) throw new UserError("The game has no cheat file on the handheld any more. Refresh and try again.");
    const text = st.text.own.replace(/\n$/, "");
    steps.push(writeFile(st.target, st.kind === "ppsspp" ? setPpssppCheats(text, on) : setChtEnabled(text, on)));
  } else {
    const cheats = (await dbCheats(source)).map((c, i) => ({ ...c, on: on.has(i) && !c.note }));
    steps.push(writeFile(st.target, st.kind === "ppsspp" ? ppssppIni(cheats, st.id, stem(file)) : writeCht(cheats)));
  }
  if (body.activate && !st.active) {
    if (st.kind === "retroarch") {
      steps.push(`grep -q '^apply_cheats_after_load' ${RA_CFG} && sed -i 's/^apply_cheats_after_load *=.*/apply_cheats_after_load = "true"/' ${RA_CFG} || echo 'apply_cheats_after_load = "true"' >> ${RA_CFG}`);
    } else {
      if (st.text.global !== undefined) steps.push(writeFile(`${PPSSPP}/ppsspp.ini`, setIni(st.text.global, "General", "EnableCheats", "True")));
      if (st.text.game !== undefined) steps.push(writeFile(`${PPSSPP}/${st.id}_ppsspp.ini`, setIni(st.text.game, "General", "EnableCheats", "True")));
    }
  }
  const { out, err } = await runCommand(`${steps.join("\n")}\nsync\necho OK`, 30_000);
  if (!out.includes("OK")) throw new UserError(`Saving the cheats on the handheld failed${err ? `: ${err.trim()}` : "."}`);
  say("green", "CHEATS", `Saved ${on.size} cheat${on.size === 1 ? "" : "s"} on for ${folder}/${file}${body.activate && !st.active ? ", cheats switched on in the emulator" : ""}.`);
  return { ok: true };
}

/** Removes a RetroArch game's cheat file. PPSSPP's files come with MustardOS, so those are only switched off. */
export async function removeCheats(body: Record<string, unknown>) {
  const folder = String(body.folder ?? ""), file = String(body.file ?? "");
  const st = await cheatState({ folder, file });
  if (st.kind !== "retroarch") throw new UserError("Only RetroArch cheat files can be removed; switch PPSSPP cheats off instead.");
  if (st.text.own === undefined) return { ok: true, changed: false };
  const { code } = await runCommand(`rm -f ${quote(st.target)} && sync`, 20_000);
  if (code !== 0) throw new UserError("The handheld could not remove the cheat file.");
  say("yellow", "CHEATS", `Removed the cheats of ${folder}/${file}.`);
  return { ok: true, changed: true };
}
