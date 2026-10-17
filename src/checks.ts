// Library checks: ROM dumps verified against the No-Intro lists in libretro-database, and duplicate games
// (the same game in several versions) with a suggested one to keep.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { ctx } from "./context.ts";
import { UserError } from "./errors.ts";
import { deleteGame } from "./games/actions.ts";
import { chdJson } from "./games/chd.ts";
import { discFixJson } from "./games/disc-fix.ts";
import { discLayoutReport, gameDiscLayout } from "./games/disc-layout.ts";
import { getLibrary, splitTitle, type Game } from "./games/library.ts";
import { ARCADE, norm } from "./games/systems.ts";
import { human, say } from "./log.ts";

const DAT_URL = "https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/no-intro/";
const DAT_AGE = 14 * 24 * 3600_000;
const MAX_ALT = 64 * 1024 * 1024;

/** No-Intro lists per ROM folder. */
export const DATS: Record<string, string[]> = {
  A2600: ["Atari - 2600"], A5200: ["Atari - 5200"], A7800: ["Atari - 7800"], A800: ["Atari - 8-bit Family"],
  LYNX: ["Atari - Lynx"], ATARIST: ["Atari - ST"], AMIGA: ["Commodore - Amiga"], C64: ["Commodore - 64"],
  VIC20: ["Commodore - VIC-20"], MSX: ["Microsoft - MSX", "Microsoft - MSX2"],
  FC: ["Nintendo - Nintendo Entertainment System"], FDS: ["Nintendo - Family Computer Disk System"],
  SFC: ["Nintendo - Super Nintendo Entertainment System", "Nintendo - Satellaview", "Nintendo - Sufami Turbo"],
  N64: ["Nintendo - Nintendo 64"], GB: ["Nintendo - Game Boy"], GBC: ["Nintendo - Game Boy Color"],
  GBA: ["Nintendo - Game Boy Advance"], NDS: ["Nintendo - Nintendo DS"], VB: ["Nintendo - Virtual Boy"],
  POKE: ["Nintendo - Pokemon Mini"], SMS: ["Sega - Master System - Mark III", "Sega - SG-1000"],
  GG: ["Sega - Game Gear"], MD: ["Sega - Mega Drive - Genesis", "Sega - PICO"], SEGA32X: ["Sega - 32X"],
  PCE: ["NEC - PC Engine - TurboGrafx 16", "NEC - PC Engine SuperGrafx"],
  WS: ["Bandai - WonderSwan", "Bandai - WonderSwan Color"], NGP: ["SNK - Neo Geo Pocket", "SNK - Neo Geo Pocket Color"],
};

/** Folders left out of the duplicate check: arcade clones need their parent sets, ports are one-offs. */
const NO_DUPES = new Set([...ARCADE, "PORTS"]);
const MODIFIED = /translat|hack|^t$|^t[+-]|patch|\bmod\b/i;
const PRERELEASE = /^(beta|proto|prototype|demo|sample|preview|promo|kiosk|pirate|alpha|debug|test)\b/i;
const BAD_DUMP = /^(b|b\d+|bad|o|o\d+|h\d*|overdump)$/i;

// ---------- DAT lists ----------

interface Dat { v: 2; name: string; version: string; fetched: number; crc: Record<string, [string, number]>; titles: Record<string, string[]> }

/** clrmamepro DAT text to {crc: [game, size]} and {normalised title: games}. */
export function parseDat(text: string, name = ""): Dat {
  const dat: Dat = { v: 2, name, version: /^\s*version\s+"([^"]*)"/m.exec(text)?.[1] ?? "", fetched: Date.now(), crc: {}, titles: {} };
  let game = "";
  for (const line of text.split("\n")) {
    const g = /^\s*name\s+"(.*)"\s*$/.exec(line);
    if (g) { game = g[1]; (dat.titles[norm(game)] ??= []).push(game); continue; }
    const rom = /^\s*rom\s*\(.*?\bsize\s+(\d+).*?\bcrc\s+([0-9A-Fa-f]{8})/.exec(line);
    if (rom && game) dat.crc[rom[2].toUpperCase()] ??= [game, Number(rom[1])];
  }
  return dat;
}

const dats = new Map<string, Dat>();
const datFile = (name: string) => path.join(ctx.cacheDir, "dats", `${name.replace(/[^\w.-]+/g, "_")}.json`);

async function loadDat(name: string): Promise<Dat> {
  let dat = dats.get(name);
  if (!dat) {
    try { dat = JSON.parse(await fsp.readFile(datFile(name), "utf8")) as Dat; } catch {}
  }
  if (!dat || dat.v !== 2 || Date.now() - dat.fetched > DAT_AGE) {
    try {
      const res = await fetch(DAT_URL + encodeURIComponent(name) + ".dat", { headers: { "User-Agent": "muos-anbernic-manager" }, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      dat = parseDat(await res.text(), name);
      if (!Object.keys(dat.crc).length) throw new Error("the list is empty");
      await fsp.mkdir(path.dirname(datFile(name)), { recursive: true });
      await fsp.writeFile(datFile(name), JSON.stringify(dat));
    } catch (error) {
      if (dat?.v !== 2) throw new UserError(`Couldn't download the No-Intro list "${name}": ${(error as Error).message}`);
    }
  }
  dats.set(name, dat);
  return dat;
}

// ---------- CRCs ----------

/** [entry name, size, crc, crc after removing a copier header or fixing the byte order]. */
type Entry = [string, number, string, string?];
interface Hashed { s: number; m: number; e: Entry[]; u?: string }

const hex = (n: number) => n.toString(16).toUpperCase().padStart(8, "0");

/** CRC of the ROM as No-Intro lists it: SNES without a 512-byte copier header, N64 in big-endian (.z64) order. */
export function altCrc(code: string, data: Buffer): string | undefined {
  if (code === "SFC" && data.length % 1024 === 512) return hex(zlib.crc32(data.subarray(512)));
  if (code === "N64" && data.length >= 4 && data.length % 4 === 0) {
    const magic = data.readUInt32BE(0);
    if (magic === 0x37804012) return hex(zlib.crc32(Buffer.from(data).swap16()));
    if (magic === 0x40123780) return hex(zlib.crc32(Buffer.from(data).swap32()));
  }
  return undefined;
}

interface ZipEntry { name: string; crc: number; size: number; csize: number; method: number; offset: number }

/** Entries from a zip's central directory; no unpacking needed for their CRCs. */
export function zipEntries(fd: number, size: number): ZipEntry[] | null {
  const tail = Buffer.alloc(Math.min(size, 65_557));
  fs.readSync(fd, tail, 0, tail.length, size - tail.length);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return null;
  const cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || cdOffset + cdSize > size) return null;
  const cd = Buffer.alloc(cdSize);
  fs.readSync(fd, cd, 0, cdSize, cdOffset);
  const out: ZipEntry[] = [];
  for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
    const nameLen = cd.readUInt16LE(p + 28), extra = cd.readUInt16LE(p + 30), comment = cd.readUInt16LE(p + 32);
    const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
    if (!name.endsWith("/")) {
      out.push({ name, method: cd.readUInt16LE(p + 10), crc: cd.readUInt32LE(p + 16), csize: cd.readUInt32LE(p + 20), size: cd.readUInt32LE(p + 24), offset: cd.readUInt32LE(p + 42) });
    }
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

function unzipEntry(fd: number, e: ZipEntry): Buffer | null {
  const head = Buffer.alloc(30);
  fs.readSync(fd, head, 0, 30, e.offset);
  if (head.readUInt32LE(0) !== 0x04034b50) return null;
  const data = Buffer.alloc(e.csize);
  fs.readSync(fd, data, 0, e.csize, e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28));
  if (e.method === 0) return data;
  return e.method === 8 ? zlib.inflateRawSync(data) : null;
}

async function streamCrc(file: string): Promise<number> {
  let crc = 0;
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) crc = zlib.crc32(chunk as Buffer, crc);
  return crc;
}

const needsAlt = (code: string, name: string, size: number) =>
  size <= MAX_ALT && ((code === "SFC" && size % 1024 === 512) || (code === "N64" && /\.(n64|v64)$/i.test(name)));

export async function hashRom(code: string, file: string, size: number): Promise<Omit<Hashed, "s" | "m">> {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".7z" || ext === ".rar") return { e: [], u: `${ext.slice(1)} archives can't be checked; zip keeps the CRC readable` };
  if (ext === ".zip") {
    const fd = fs.openSync(file, "r");
    try {
      const entries = zipEntries(fd, size);
      if (!entries) return { e: [], u: "The zip file is damaged or too large to read" };
      return {
        e: entries.map((z) => {
          let alt: string | undefined;
          if (needsAlt(code, z.name, z.size) || (code === "N64" && z.size <= MAX_ALT && !/\.z64$/i.test(z.name))) {
            try { const data = unzipEntry(fd, z); if (data) alt = altCrc(code, data); } catch {}
          }
          return alt ? [z.name, z.size, hex(z.crc), alt] : [z.name, z.size, hex(z.crc)];
        }),
      };
    } finally {
      fs.closeSync(fd);
    }
  }
  const name = path.basename(file);
  if (needsAlt(code, name, size) || (code === "N64" && size <= MAX_ALT)) {
    const data = await fsp.readFile(file);
    const alt = altCrc(code, data);
    return { e: [alt ? [name, size, hex(zlib.crc32(data)), alt] : [name, size, hex(zlib.crc32(data))]] };
  }
  return { e: [[name, size, hex(await streamCrc(file))]] };
}

let hashes: Map<string, Hashed> | null = null;
const hashFile = () => path.join(ctx.cacheDir, "rom-crc.json");

async function hashCache(): Promise<Map<string, Hashed>> {
  if (!hashes) {
    try { hashes = new Map(Object.entries(JSON.parse(await fsp.readFile(hashFile(), "utf8")) as Record<string, Hashed>)); }
    catch { hashes = new Map(); }
  }
  return hashes;
}

const saveHashes = async () => {
  if (!hashes) return;
  await fsp.mkdir(ctx.cacheDir, { recursive: true });
  await fsp.writeFile(hashFile(), JSON.stringify(Object.fromEntries(hashes)));
};

const cached = (file: string, g: Game) => {
  const h = hashes?.get(file);
  return h && h.s === g.s && h.m === g.m ? h : null;
};

// ---------- Verify ----------

type State = "ok" | "bad" | "modified" | "unknown" | "unchecked";
interface Checked { f: string; p: string; state: State; as?: string; like?: string; note?: string }
interface SystemResult { code: string; name: string; dats: { name: string; version: string }[]; error: string; counts: Record<State, number>; renamed: number; games: Checked[] }

/** Matches one ROM's CRCs against the lists. */
export function judge(g: Pick<Game, "f" | "t" | "g">, h: Pick<Hashed, "e" | "u">, lists: Dat[]): Omit<Checked, "p"> {
  if (h.u) return { f: g.f, state: "unchecked", note: h.u };
  for (const [, size, crc, alt] of h.e) {
    for (const dat of lists) {
      const hit = dat.crc[crc] ?? (alt ? dat.crc[alt] : undefined);
      if (hit && (!size || hit[1] === size || alt)) {
        const stem = g.f.replace(/\.[^.]+$/, "");
        return hit[0] === stem ? { f: g.f, state: "ok" } : { f: g.f, state: "ok", as: hit[0] };
      }
    }
  }
  if (!h.e.length) return { f: g.f, state: "unchecked", note: "The archive is empty" };
  if (g.g.some((t) => MODIFIED.test(t))) return { f: g.f, state: "modified" };
  const key = norm(g.t);
  const dat = lists.find((d) => d.titles[key]);
  if (!dat) return { f: g.f, state: "unknown" };
  const mine = new Set(regionsOf(g.g));
  const like = dat.titles[key].find((name) => regionsOf(splitTitle(name)[1]).some((r) => mine.has(r))) ?? dat.titles[key][0];
  const sizes = new Set(Object.values(dat.crc).filter(([game]) => game === like).map(([, size]) => size));
  const size = h.e.length === 1 ? h.e[0][1] : 0;
  const note = !size || !sizes.size || sizes.has(size) ? "Same size as the good dump but different contents: modified or damaged"
    : `${human(size)}, the good dump is ${[...sizes].map(human).join(" or ")}: ${Math.max(...sizes) > size ? "incomplete (underdump)" : "padded or overdumped"}`;
  return { f: g.f, state: "bad", like, note };
}

interface Run { running: boolean; started: number; finished: number; done: number; total: number; current: string; error: string }
const run: Run = { running: false, started: 0, finished: 0, done: 0, total: 0, current: "", error: "" };
let results: { checked: string; root: string; systems: SystemResult[] } | null = null;
const resultFile = () => path.join(ctx.cacheDir, "checks.json");

async function lastResults() {
  if (!results) {
    try { results = JSON.parse(await fsp.readFile(resultFile(), "utf8")); } catch {}
  }
  return results?.root === ctx.roms ? results : null;
}

/** The files behind Checks: verify results, ROM checksums and the downloaded No-Intro lists. */
export const checksCacheFiles = () => [resultFile(), hashFile(), path.join(ctx.cacheDir, "dats")];

export async function clearChecks(): Promise<void> {
  if (run.running) throw new UserError("Wait for the ROM check to finish first.");
  dats.clear();
  hashes = null;
  results = null;
  await Promise.all(checksCacheFiles().map((p) => fsp.rm(p, { recursive: true, force: true })));
}

export async function startVerify(body: Record<string, unknown>) {
  if (run.running) throw new UserError("A check is already running.");
  const library = await getLibrary();
  const only = Array.isArray(body.systems) ? new Set(body.systems.map(String)) : null;
  const systems = library.systems.filter((s) => DATS[s.code] && s.games.length && (!only || only.has(s.code)));
  if (!systems.length) throw new UserError("None of your systems have games that can be checked.");
  Object.assign(run, { running: true, started: Date.now(), finished: 0, done: 0, total: systems.reduce((n, s) => n + s.games.length, 0), current: "", error: "" });
  const previous = (await lastResults())?.systems ?? [];
  (async () => {
    const cache = await hashCache();
    const out: SystemResult[] = previous.filter((p) => !systems.some((s) => s.code === p.code) && library.systems.some((s) => s.code === p.code));
    for (const sys of systems) {
      const result: SystemResult = { code: sys.code, name: sys.name, dats: [], error: "", counts: { ok: 0, bad: 0, modified: 0, unknown: 0, unchecked: 0 }, renamed: 0, games: [] };
      out.push(result);
      let lists: Dat[] = [];
      run.current = sys.name;
      try {
        lists = await Promise.all(DATS[sys.code].map(loadDat));
        result.dats = lists.map((d) => ({ name: d.name, version: d.version }));
      } catch (error) {
        result.error = (error as Error).message;
        run.done += sys.games.length;
        continue;
      }
      for (const g of sys.games) {
        run.current = `${sys.name}: ${g.f}`;
        const file = path.join(ctx.roms, sys.code, g.f);
        let h = cached(file, g);
        if (!h) {
          try { h = { s: g.s, m: g.m, ...(await hashRom(sys.code, file, g.s)) }; cache.set(file, h); }
          catch (error) { h = { s: g.s, m: g.m, e: [], u: `Couldn't read it: ${(error as Error).message}` }; }
        }
        const verdict = { ...judge(g, h, lists), p: g.p };
        result.counts[verdict.state]++;
        if (verdict.as) result.renamed++;
        if (verdict.state !== "ok" || verdict.as) result.games.push(verdict);
        run.done++;
      }
      await saveHashes();
    }
    out.sort((a, b) => library.systems.findIndex((s) => s.code === a.code) - library.systems.findIndex((s) => s.code === b.code));
    results = { checked: new Date().toISOString(), root: ctx.roms, systems: out };
    await fsp.writeFile(resultFile(), JSON.stringify(results));
    const sum = (k: State) => out.reduce((n, s) => n + s.counts[k], 0);
    say(sum("bad") ? "yellow" : "green", "CHECKED", `${sum("ok")} verified, ${sum("bad")} bad, ${sum("unknown")} unknown.`);
  })().catch((error) => {
    run.error = (error as Error).message;
    say("red", "FAILED", `Checking ROMs: ${run.error}`);
  }).finally(() => {
    Object.assign(run, { running: false, finished: Date.now(), current: "" });
  });
  return { started: true, total: run.total };
}

// ---------- Duplicates ----------

const REGIONS = ["USA", "Europe", "Japan", "World", "Australia", "Asia", "Korea", "China", "Taiwan", "Brazil", "Germany", "France", "Spain", "Italy", "Netherlands", "Sweden", "Canada", "UK"];
const GOOD_CODES: Record<string, string> = { U: "USA", E: "Europe", J: "Japan", W: "World", K: "Korea" };
export const PREFER: Record<string, string[]> = {
  usa: ["USA", "World", "Europe", "Australia", "Canada", "UK", "Japan"],
  europe: ["Europe", "World", "UK", "USA", "Australia", "Japan"],
  japan: ["Japan", "World", "Asia", "USA", "Europe"],
};

export function regionsOf(tags: string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    if (/^[UEJWK]{1,3}$/.test(tag)) out.push(...[...tag].map((c) => GOOD_CODES[c]));
    else for (const part of tag.split(/,\s*/)) if (REGIONS.includes(part)) out.push(part);
  }
  return out;
}

function revision(tags: string[]): number {
  for (const t of tags) {
    const rev = /^Rev\s*([0-9]+|[A-Z])$/i.exec(t);
    if (rev) return /^\d+$/.test(rev[1]) ? Number(rev[1]) : rev[1].toUpperCase().charCodeAt(0) - 64;
    const v = /^v(\d+)(?:\.(\d+))?/i.exec(t);
    if (v) return Number(v[1]) + Number(v[2] ?? 0) / 100 - 1;
  }
  return 0;
}

/** Lower is better: prerelease or bad dumps last, then the preferred region, then the newest revision. */
export function rank(tags: string[], prefer: string[], verified: boolean): number[] {
  const tier = tags.some((t) => BAD_DUMP.test(t)) ? 3 : tags.some((t) => PRERELEASE.test(t)) ? 2 : 0;
  const english = tags.some((t) => /translat.*\ben/i.test(t) || /^t\+eng/i.test(t));
  const indexes = regionsOf(tags).map((r) => (prefer.includes(r) ? prefer.indexOf(r) : prefer.length));
  let region = indexes.length ? Math.min(...indexes) : prefer.length + 1;
  if (english && prefer[0] !== "Japan") region = Math.min(region, prefer.indexOf("Japan") - 0.5);
  return [tier, region, verified ? 0 : 1, -revision(tags), tags.length];
}

const better = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

/** Tags that only tell versions of one game apart; any other tag (publisher, edition, disc) keeps games apart. */
const VERSION_TAG = /^(rev\s*\S+|v\d[\w.]*|beta\s*\d*|proto\w*\s*\d*|demo|sample|preview|promo|kiosk|alpha|debug|unl|aftermarket|pirate|!|b\d*|bad|o\d*|h\d*|translat.*|t[+-].*|hack|virtual console|switch online|evercade|retro-bit.*|classic mini|steam|gog|[a-z]{2}(\s*,\s*[a-z]{2})*|[uejwk]{1,3}|\d{4}-\d{2}-\d{2})$/i;

export function groupKey(g: Pick<Game, "t" | "g">): string {
  const part = g.g.filter((t) => !VERSION_TAG.test(t) && !regionsOf([t]).length).map((t) => t.toLowerCase().replace(/\s+/g, "")).sort().join("|");
  const title = norm(g.t.replaceAll("+", " plus "));
  return title ? `${title}${part ? `#${part}` : ""}` : "";
}

export async function checksJson(query?: URLSearchParams) {
  const library = await getLibrary();
  await hashCache();
  const prefer = PREFER[query?.get("prefer") ?? ""] ?? PREFER.usa;
  const last = await lastResults();
  const states = new Map<string, State>();
  for (const s of last?.systems ?? []) for (const g of s.games) states.set(g.p, g.state);
  const verifiedSystems = new Set((last?.systems ?? []).filter((s) => !s.error).map((s) => s.code));
  const groups = [];
  let extra = 0, bytes = 0;
  for (const sys of library.systems) {
    if (NO_DUPES.has(sys.code) || sys.games.length < 2) continue;
    const byKey = new Map<string, Game[]>();
    for (const g of sys.games) {
      const key = groupKey(g);
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), g]);
    }
    for (const games of byKey.values()) {
      if (games.length < 2) continue;
      const rows = games.map((g) => {
        const h = cached(path.join(ctx.roms, sys.code, g.f), g);
        const state = states.get(g.p) ?? (verifiedSystems.has(sys.code) && h ? "ok" : undefined);
        return { f: g.f, p: g.p, s: g.s, t: g.t, tags: g.g, i: g.i, state, crc: h?.e.length === 1 ? `${h.e[0][2]}:${h.e[0][1]}` : "", r: rank(g.g, prefer, state === "ok") };
      });
      let keep = 0;
      rows.forEach((r, i) => { if (better(r.r, rows[keep].r)) keep = i; });
      const out = rows.map((r, i) => ({ f: r.f, p: r.p, s: r.s, tags: r.tags, i: r.i, state: r.state, keep: i === keep, copy: i !== keep && !!r.crc && r.crc === rows[keep].crc }));
      groups.push({ code: sys.code, system: sys.name, title: rows[keep].t, games: out });
      extra += games.length - 1;
      bytes += out.filter((g) => !g.keep).reduce((n, g) => n + g.s, 0);
    }
  }
  const supported = library.systems.filter((s) => DATS[s.code] && s.games.length).map((s) => ({ code: s.code, name: s.name, games: s.games.length }));
  const present = new Set(library.systems.flatMap((s) => s.games.map((g) => g.p)));
  const verify = last && { ...last, systems: last.systems.map((s) => {
    const gone = s.games.filter((g) => !present.has(g.p));
    if (!gone.length) return s;
    const counts = { ...s.counts };
    for (const g of gone) counts[g.state]--;
    return { ...s, counts, renamed: s.renamed - gone.filter((g) => g.as).length, games: s.games.filter((g) => present.has(g.p)) };
  }) };
  const disc = await discLayoutReport(library);
  const [chd, fix] = await Promise.all([chdJson(), discFixJson()]);
  return { run: { ...run }, verify, supported, disc, chd, fix, dupes: { groups, extra, bytes, prefer: query?.get("prefer") ?? "usa" } };
}

/** One game's last verify result, its CRC when hashed, and the other versions of it in the same folder. */
export async function gameCheck(code: string, games: Game[], g: Game) {
  await hashCache();
  const last = await lastResults();
  const sys = last?.systems.find((s) => s.code === code);
  const h = cached(path.join(ctx.roms, code, g.f), g);
  const hit = sys?.games.find((x) => x.p === g.p);
  const state: State | "" = hit?.state ?? (sys && !sys.error && h ? "ok" : "");
  const key = NO_DUPES.has(code) ? "" : groupKey(g);
  const copies = key ? games.filter((o) => o !== g && groupKey(o) === key).map((o) => ({ f: o.f, t: o.t, g: o.g, s: o.s })) : [];
  const disc = await gameDiscLayout(code, g);
  return {
    supported: !!DATS[code], checked: sys ? last!.checked : "", state, as: hit?.as ?? "", like: hit?.like ?? "", note: hit?.note ?? "",
    dats: sys?.dats ?? [], crc: h?.e.length === 1 ? h.e[0][2] : "", copies,
    disc: disc ? { state: disc.state, note: disc.note } : null,
  };
}

export async function trashGames(body: Record<string, unknown>) {
  const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];
  if (!paths.length) throw new UserError("Choose the games to move to the Trash.");
  let trashed = 0, size = 0;
  const failed: string[] = [];
  const library = await getLibrary();
  const sizes = new Map(library.systems.flatMap((s) => s.games.map((g) => [g.p, g.s] as const)));
  for (const p of paths) {
    try {
      await deleteGame({ path: p.replace(/^Roms\//, ""), library: true, art: body.art !== false });
      trashed++;
      size += sizes.get(p) ?? 0;
    } catch (error) {
      failed.push(`${p}: ${(error as Error).message}`);
    }
  }
  if (trashed) say("yellow", "TRASHED", `${trashed} games from the Library check (${human(size)}).`);
  return { trashed, size, failed };
}
