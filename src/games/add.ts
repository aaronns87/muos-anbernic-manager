// Adding games to Roms/: which system a file belongs to, LaunchBox descriptions to pick from, the upload itself,
// and the user's own descriptions in Roms/<SYS>/Text/<stem>.txt.

import fs from "node:fs";
import fsp from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { EXCLUDED_TOP, NOT_ROMS } from "../catalogue.ts";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { say } from "../log.ts";
import { platform } from "../platform/index.ts";
import { inside, isFile, listDir, removeQuietly, safePart, splitName, TEXT_DIR } from "../util.ts";
import { SCUMMVM } from "./engines.ts";
import { rescanInBackground, splitTitle } from "./library.ts";
import { loadArcadeNames, loadIndex, type MetadataIndex } from "./metadata.ts";
import { PLATFORMS, SYSTEMS, norm } from "./systems.ts";

/** File extensions per ROM folder. Disc formats and .bin are shared, so they only narrow the choice. */
const EXTENSIONS: Record<string, string[]> = {
  A2600: ["a26", "bin"], A5200: ["a52"], A7800: ["a78"], A800: ["atr", "xex", "xfd", "atx", "car"],
  LYNX: ["lnx", "lyx"], ATARIST: ["st", "msa", "stx", "dim"], AMIGA: ["adf", "adz", "dms", "ipf", "hdf", "hdz", "lha"],
  C64: ["d64", "d71", "d81", "t64", "prg", "crt", "tap", "g64", "x64"], VIC20: ["20", "40", "60", "a0", "b0", "prg"],
  MSX: ["rom", "mx1", "mx2", "dsk", "cas"], DOS: ["exe", "com", "bat", "dosz"],
  FC: ["nes", "unf", "unif"], FDS: ["fds"], SFC: ["sfc", "smc", "fig", "swc", "bs"], N64: ["n64", "z64", "v64"],
  GB: ["gb"], GBC: ["gbc"], GBA: ["gba"], NDS: ["nds"], VB: ["vb", "vboy"], GW: ["mgw"], POKE: ["min"],
  SMS: ["sms"], GG: ["gg"], MD: ["md", "gen", "smd", "68k", "sgd", "bin"], SEGA32X: ["32x"],
  MDCD: ["cue", "chd", "iso"], SATURN: ["cue", "chd", "ccd"], DREAMCAST: ["gdi", "cdi", "chd"],
  PS: ["cue", "chd", "pbp", "m3u", "ecm", "ccd"], PSP: ["iso", "cso", "pbp"],
  PCE: ["pce", "sgx"], PCECD: ["cue", "chd", "ccd"], NEOCD: ["cue", "chd"], NGP: ["ngp", "ngc"], WS: ["ws", "wsc"],
  PICO: ["p8"], OPENBOR: ["pak"], SCUMMVM: ["scummvm"], EASYRPG: ["easyrpg"], ONS: ["ons"], JAVA: ["jar", "jad"],
};
const BY_EXT = new Map<string, string[]>();
for (const [code, exts] of Object.entries(EXTENSIONS)) for (const ext of exts) BY_EXT.set(ext, [...(BY_EXT.get(ext) ?? []), code]);
const ARCHIVES = new Set(["zip", "7z"]);
const NAMES = new Map(SYSTEMS.map((s) => [s[0], s[1]]));
const MAX_TEXT = 8000;

// ---------------------------------------------------------------- the big lookup tables, kept while in use

let index: Promise<MetadataIndex | null> | null = null;
let arcade: Promise<Map<string, string>> | null = null;
let idle: NodeJS.Timeout | undefined;

/** The LaunchBox index (about 90 MB) and the MAME names stay loaded for a few minutes after the last lookup. */
function tables() {
  index ??= loadIndex();
  arcade ??= loadArcadeNames();
  clearTimeout(idle);
  idle = setTimeout(() => { index = null; arcade = null; }, 4 * 60_000);
  idle.unref();
  return Promise.all([index, arcade]);
}

// ---------------------------------------------------------------- detection

interface Candidate { code: string; score: number; why: string[] }

/** Systems a file probably belongs to, best first, from its extension, the files in a zip, arcade set names and LaunchBox titles. */
export async function detectGames(body: Record<string, unknown>) {
  const files = Array.isArray(body.files) ? body.files.slice(0, 500) : [];
  const [meta, arcadeNames] = await tables();
  return {
    indexed: !!meta,
    files: files.map((raw) => {
      const file = (raw ?? {}) as Record<string, unknown>;
      const name = String(file.name ?? "");
      const inner = Array.isArray(file.inner) ? file.inner.map(String).slice(0, 200) : null;
      return detectOne(name, inner, meta, arcadeNames, file.folder === true);
    }),
  };
}

function detectOne(name: string, inner: string[] | null, meta: MetadataIndex | null, arcadeNames: Map<string, string>, folder = false) {
  const [stem, ext] = folder ? [name, ""] : splitName(name);
  const found = new Map<string, Candidate>();
  const add = (code: string, score: number, why: string) => {
    if (!NAMES.has(code) || EXCLUDED_TOP.has(code)) return;
    const c = found.get(code) ?? { code, score: 0, why: [] };
    c.score += score;
    c.why.push(why);
    found.set(code, c);
  };
  const fromExt = (e: string, where: string, unique: number, shared: number) => {
    const codes = BY_EXT.get(e) ?? [];
    for (const code of codes) add(code, codes.length === 1 ? unique : shared, codes.length === 1 ? `${where} .${e} file` : `${where} .${e} file, used by ${codes.length} systems`);
  };

  const arcadeName = folder ? "" : arcadeNames.get(stem) ?? "";
  if (folder) {
    add(SCUMMVM, 90, "a folder of game files, which only ScummVM runs");
  } else if (ARCHIVES.has(ext)) {
    const exts = new Set((inner ?? []).map((n) => splitName(n.split("/").pop() ?? "")[1]).filter((e) => BY_EXT.has(e)));
    if (exts.size === 1) fromExt([...exts][0], `holds a`, 85, 35);
    if (arcadeName) {
      add("MAME", 70, `"${stem}" is a MAME arcade set (${arcadeName})`);
      add("FBNEO", 62, `"${stem}" is an arcade set FinalBurn Neo also runs`);
    }
  } else if (ext) {
    fromExt(ext, "a", 90, 30);
  }

  const [title] = splitTitle(arcadeName || stem);
  if (meta) {
    const keys = [...new Set([norm(arcadeName), norm(title), norm(stem)].filter(Boolean))];
    for (const [code, platforms] of Object.entries(PLATFORMS)) {
      if (folder && code !== SCUMMVM) continue;
      for (const platformName of platforms) {
        const id = keys.map((k) => meta.keys[platformName]?.[k]).find(Boolean);
        if (!id || !meta.games[id]) continue;
        add(code, found.has(code) ? 30 : 22, `"${meta.games[id].n}" is a ${platformName} game in LaunchBox`);
        break;
      }
    }
  }

  const candidates = [...found.values()].sort((a, b) => b.score - a.score).slice(0, 6);
  const [top, next] = candidates;
  const confidence = !top ? "none" : top.score >= 80 && (!next || top.score - next.score >= 25) ? "sure" : top.score >= 45 ? "likely" : "none";
  return { name, stem, ext, title, arcade: arcadeName, candidates, pick: confidence === "none" ? "" : top.code, confidence };
}

// ---------------------------------------------------------------- descriptions

const words = (text: string) => text.toLowerCase().replace(/[([][^)\]]*[)\]]/g, " ").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .split(/[^a-z0-9]+/).filter((w) => w && !["the", "a", "an", "of", "and"].includes(w));

/** LaunchBox games on a system's platforms whose names match the query, best first. */
export async function searchDescriptions(body: Record<string, unknown>) {
  const code = String(body.code ?? ""), query = String(body.q ?? "").trim().slice(0, 200);
  const platforms = PLATFORMS[code];
  if (!platforms) throw new UserError(`The LaunchBox database has no platform for ${NAMES.get(code) ?? code}.`);
  if (!query) throw new UserError("Type a game name to search for.");
  const [meta] = await tables();
  if (!meta) throw new UserError("The description database is not downloaded yet. Get it in Settings > Game data.");
  const key = norm(query), want = words(query);
  const scored = new Map<string, number>();
  for (const platformName of platforms) {
    const table = meta.keys[platformName] ?? {};
    const exact = table[key];
    if (exact) scored.set(exact, 100);
    for (const [k, id] of Object.entries(table)) {
      if (scored.get(id) === 100 || !meta.games[id]) continue;
      let score = 0;
      if (key.length > 3 && (k.startsWith(key) || key.startsWith(k)) && k.length > 3) score = 70 - Math.min(20, Math.abs(k.length - key.length));
      else if (want.length) {
        const have = new Set(words(meta.games[id].n));
        const hits = want.filter((w) => have.has(w)).length;
        if (hits) score = (hits / want.length) * 60 - Math.max(0, have.size - hits) * 2;
      }
      if (score >= 30 && score > (scored.get(id) ?? 0)) scored.set(id, score);
    }
  }
  const results = [...scored].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, score]) => {
    const g = meta.games[id];
    return { id, exact: score === 100, name: g.n, year: g.y, dev: g.dev, pub: g.pub, genre: g.g, d: g.d };
  });
  return { results };
}

/** Writes (or with empty text, trashes) a game's own description. */
export async function saveDescription(body: Record<string, unknown>) {
  const system = await systemFolder(body.system, false);
  if (!safePart(body.stem)) throw new UserError("Invalid game name.");
  const folder = path.join(ctx.roms, system);
  const stem = body.stem;
  const hasGame = (await listDir(folder)).some((e) => e.isFile() && splitName(e.name)[0].toLowerCase() === stem.toLowerCase() && !NOT_ROMS.has(splitName(e.name)[1]));
  if (!hasGame) throw new UserError(`Roms/${system} has no game named ${stem}.`);
  const text = String(body.text ?? "").replace(/\r\n?/g, "\n").trim().slice(0, MAX_TEXT);
  const file = path.join(folder, TEXT_DIR, `${stem}.txt`);
  if (!text) {
    if (await isFile(file)) await platform.trash(file);
  } else {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(`${file}.partial`, `${text}\n`);
    await fsp.rename(`${file}.partial`, file);
  }
  rescanInBackground();
  return { ok: true };
}

// ---------------------------------------------------------------- upload

async function systemFolder(value: unknown, create: boolean): Promise<string> {
  const code = String(value ?? "");
  if (!safePart(code) || EXCLUDED_TOP.has(code.toUpperCase()) || code.toLowerCase() === "imgs" || code.toLowerCase() === "text") throw new UserError("Unknown system folder.");
  const known = NAMES.has(code) || (await listDir(ctx.roms)).some((e) => e.isDirectory() && e.name === code);
  if (!known) throw new UserError("Unknown system folder.");
  if (create) await fsp.mkdir(path.join(ctx.roms, code), { recursive: true });
  return code;
}

/** Folder parts below Roms/SCUMMVM for a game's data files ("" for none); the first part may be hidden (".Monkey Island"). */
function dataDir(system: string, value: string | null): string[] {
  if (!value) return [];
  if (system.toUpperCase() !== SCUMMVM) throw new UserError("Only ScummVM games bring a folder of game files.");
  const parts = value.normalize("NFC").split("/");
  const bad = (p: string, i: number) => !p || p === "." || p === ".." || p.length > 240 || /[\\\u0000-\u001f:]/.test(p) || (i > 0 && p.startsWith(".."));
  if (parts.length > 12 || parts.some(bad) || !/^[._]?[^._]/.test(parts[0])) throw new UserError(`"${value}" is not a usable folder.`);
  return parts;
}

/** Streams one file into Roms/<system>/ (PUT body), or into a ScummVM game's data folder with dir=; an existing file of
 *  that name goes to the Trash only with replace=1. */
export async function uploadGame(req: http.IncomingMessage, query: URLSearchParams) {
  const system = await systemFolder(query.get("system"), true);
  const dir = dataDir(system, query.get("dir"));
  const name = String(query.get("name") ?? "").normalize("NFC");
  const [, ext] = splitName(name);
  const nameOk = dir.length ? !!name && !name.includes("/") && !name.includes("\\") && name !== "." && name !== ".." : safePart(name);
  if (!nameOk || name.length > 240 || /[\u0000-\u001f:]/.test(name) || name.endsWith(".partial")) throw new UserError(`"${name}" is not a usable file name.`);
  if (!dir.length && (!ext || NOT_ROMS.has(ext))) throw new UserError(`.${ext || "(none)"} files are not games.`);
  const folder = path.join(ctx.roms, system, ...dir);
  if (!inside(path.join(ctx.roms, system), path.join(folder, name))) throw new UserError("Invalid path.");
  if (dir.length) await fsp.mkdir(folder, { recursive: true });
  const existing = (await listDir(folder)).find((e) => e.name.toLowerCase() === name.toLowerCase());
  const shown = [system, ...dir, existing?.name ?? name].join("/");
  if (existing && query.get("replace") !== "1") throw new UserError(`Roms/${shown} already exists.`);
  const expected = Number(req.headers["content-length"] ?? NaN);
  const partial = path.join(folder, `.${name}.partial`);
  try {
    await pipeline(req, fs.createWriteStream(partial));
    const size = (await fsp.stat(partial)).size;
    if (Number.isFinite(expected) && size !== expected) throw new UserError(`The upload of ${name} stopped early.`);
    if (existing) await platform.trash(path.join(folder, existing.name));
    await fsp.rename(partial, path.join(folder, name));
    if (!dir.length) say("green", "ADDED", `Roms/${system}/${name}`);
    return { system, name, size };
  } finally {
    await removeQuietly(partial);
  }
}
