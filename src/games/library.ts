// The games library: every ROM under Roms/ grouped by system, with Imgs artwork and LaunchBox descriptions.
// Built at startup and after Roms/ changes, kept in memory and served to the app as JSON.

import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { IMAGE_EXTS, NOT_ROMS } from "../catalogue.ts";
import { ctx } from "../context.ts";
import { say } from "../log.ts";
import { listDir, splitName, TEXT_DIR, timestamp } from "../util.ts";
import { referencedNames } from "../workspace.ts";
import { companions, isRunner } from "./engines.ts";
import { loadArcadeNames, loadIndex, type GameMeta, type MetadataIndex } from "./metadata.ts";
import { ARCADE, CATEGORIES, PLATFORMS, SKIP_FOLDERS, SYSTEMS, norm } from "./systems.ts";

const TAG = /\s*[([]([^)\]]*)[)\]]/g;
const ARTICLE = /^(.*?), (The|A|An)(\s+-\s+.*|:\s+.*)?$/;

export interface Game {
  /** Title, sort key, file name, extension, size, mtime (s), tags, arcade set, image URL, Roms/-relative path, metadata key. */
  t: string; k: string; f: string; x: string; s: number; m: number; g: string[]; a: string; i: string; p: string; lb: string;
  /** ScummVM only: files in the game's data folder (counted in s). */
  n?: number;
}

export interface System {
  code: string; name: string; maker: string; year: number | null; cat: string; games: Game[];
}

export interface Library {
  generated: string;
  /** Changes only when the games, their artwork or the Roms folder change, not on every scan. */
  sig?: string;
  root: string;
  roms: string;
  categories: string[];
  systems: System[];
  meta: Record<string, GameMeta>;
  totals: { systems: number; filled: number; games: number; art: number; bytes: number; arcade: number; described: number };
}

export function splitTitle(stem: string): [string, string[]] {
  const tags = [...stem.matchAll(TAG)].map((m) => m[1].trim()).filter(Boolean);
  let title = stem.replace(TAG, "").trim() || stem;
  const match = ARTICLE.exec(title);
  if (match) title = `${match[2]} ${match[1]}${match[3] ?? ""}`;
  return [title, tags];
}

function sortKey(title: string): string {
  const lowered = title.toLowerCase();
  for (const article of ["the ", "a ", "an "]) if (lowered.startsWith(article)) return lowered.slice(article.length);
  return lowered;
}

const titleCase = (text: string) => text.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const imageUrl = (code: string, name: string) => `/Roms/${encodeURIComponent(code)}/Imgs/${encodeURIComponent(name)}`;
const MAX_TEXT = 8000;

/** Descriptions written or picked in the manager: Roms/<SYS>/Text/<stem>.txt, by lower-cased stem. */
async function ownTexts(folder: string): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  for (const entry of await listDir(path.join(folder, TEXT_DIR))) {
    const [stem, ext] = splitName(entry.name);
    if (!entry.isFile() || entry.name.startsWith(".") || ext !== "txt") continue;
    const text = (await fsp.readFile(path.join(folder, TEXT_DIR, entry.name), "utf8").catch(() => "")).trim().slice(0, MAX_TEXT);
    if (text) texts.set(stem.toLowerCase(), text);
  }
  return texts;
}

function describer(metadata: MetadataIndex | null, metaOut: Record<string, GameMeta>) {
  return (code: string, stem: string, title: string, fullName: string | undefined): string => {
    const platforms = PLATFORMS[code];
    if (!metadata || !platforms) return "";
    const mame = ARCADE.has(code) ? metadata.mame[stem] : undefined;
    const names: string[] = [];
    if (mame) {
      names.push(mame.n);
      const parent = mame.c ? metadata.mame[mame.c] : undefined;
      if (parent) names.push(parent.n);
    }
    if (fullName) names.push(fullName);
    names.push(title, stem, stem.replace(/^[A-Z0-9]{2,4}-/, ""));
    const base = title.replace(TAG, "").trim();
    for (const sep of [" - ", ": "]) if (base.includes(sep)) names.push(base.split(sep)[0]);
    for (const name of names) {
      const key = norm(name);
      if (!key) continue;
      for (const platform of platforms) {
        const id = metadata.keys[platform]?.[key];
        if (id && metadata.games[id]) {
          metaOut[id] ??= metadata.games[id];
          return id;
        }
      }
    }
    if (mame) {
      const key = `m:${stem}`;
      metaOut[key] = { n: mame.n, d: "", y: mame.y, dev: "", pub: mame.pub, g: mame.g, pl: "", r: null, rc: 0, v: "", w: "", id: "" };
      return key;
    }
    return "";
  };
}

export async function scanLibrary(): Promise<Library> {
  const arcadeNames = await loadArcadeNames();
  const metaOut: Record<string, GameMeta> = {};
  const describe = describer(await loadIndex(), metaOut);
  const known = new Map(SYSTEMS.map((s) => [s[0], s]));
  for (const dir of await listDir(ctx.roms)) {
    if (dir.isDirectory() && !dir.name.startsWith(".") && !known.has(dir.name) && !SKIP_FOLDERS.has(dir.name.toUpperCase())) {
      known.set(dir.name, [dir.name, titleCase(dir.name), "Unrecognised folder", null, "Other"]);
    }
  }
  const totals = { systems: 0, filled: 0, games: 0, art: 0, bytes: 0, arcade: 0, described: 0 };
  const systems: System[] = [];
  const ordered = [...known.values()].sort((a, b) => CATEGORIES.indexOf(a[4]) - CATEGORIES.indexOf(b[4]) || cmp(a[1].toLowerCase(), b[1].toLowerCase()));
  for (const [code, name, maker, year, cat] of ordered) {
    const folder = path.join(ctx.roms, code);
    const games: Game[] = [];
    const entries = (await listDir(folder)).filter((e) => !e.name.startsWith(".")).sort((a, b) => cmp(a.name, b.name));
    const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name);
    const hidden = await referencedNames(folder, fileNames);
    const texts = await ownTexts(folder);
    const images = new Map<string, string>();
    for (const image of await listDir(path.join(folder, "Imgs"))) {
      const [stem, ext] = splitName(image.name);
      if (image.name.startsWith(".") || !IMAGE_EXTS.has(ext)) continue;
      if (!images.has(stem)) images.set(stem, image.name);
      if (!images.has(stem.toLowerCase())) images.set(stem.toLowerCase(), image.name);
    }
    for (const fileName of fileNames) {
      const [stem, ext] = splitName(fileName);
      if (NOT_ROMS.has(ext) || hidden.has(fileName.toLowerCase())) continue;
      const st = await fsp.stat(path.join(folder, fileName)).catch(() => null);
      if (!st) continue;
      const extra = await companions(code, fileName);
      let size = st.size;
      for (const [, full] of extra) size += (await fsp.stat(full).catch(() => null))?.size ?? 0;
      const fullName = ARCADE.has(code) ? arcadeNames.get(stem) : undefined;
      const [title, tags] = splitTitle(fullName ?? stem);
      const image = images.get(stem) ?? images.get(stem.toLowerCase());
      let lb = describe(code, stem, title, fullName);
      const own = texts.get(stem.toLowerCase());
      if (own) {
        const base = lb ? metaOut[lb] : { n: title, d: "", y: null, dev: "", pub: "", g: "", pl: "", r: null, rc: 0, v: "", w: "", id: "" };
        lb = `u:${code}/${stem}`;
        metaOut[lb] = { ...base, d: own, u: true };
      }
      if (lb && metaOut[lb].d) totals.described++;
      games.push({
        t: title, k: sortKey(title), f: fileName, x: ext, s: size, m: Math.trunc(st.mtimeMs / 1000), g: tags,
        a: fullName ? stem : "", i: image ? imageUrl(code, image) : "", p: `Roms/${code}/${fileName}`, lb,
        ...(isRunner(code, fileName) ? { n: extra.length } : {}),
      });
      totals.games++;
      totals.bytes += size;
      if (image) totals.art++;
      if (fullName) totals.arcade++;
    }
    games.sort((a, b) => cmp(a.k, b.k) || cmp(a.f.toLowerCase(), b.f.toLowerCase()));
    systems.push({ code, name, maker, year, cat, games });
  }
  totals.systems = systems.length;
  totals.filled = systems.filter((s) => s.games.length).length;
  return { generated: timestamp(), root: ctx.root, roms: ctx.roms, categories: CATEGORIES, systems, meta: metaOut, totals };
}

let current: Library | null = null;
let json = "";
let scanning: Promise<Library> | null = null;
let queued: Promise<Library> | null = null;

/** Rescans Roms/. A call during a scan waits for one more scan after it, so it sees its own changes; those calls share it. */
export function rescanLibrary(): Promise<Library> {
  if (scanning) {
    queued ??= scanning.catch(() => {}).then(() => {
      queued = null;
      return rescanLibrary();
    });
    return queued;
  }
  scanning = scanLibrary().then((library) => {
    const own = Object.entries(library.meta).filter(([key]) => key.startsWith("u:"));
    library.sig = createHash("sha1").update(library.roms).update(JSON.stringify(library.systems)).update(JSON.stringify(own)).digest("hex").slice(0, 16);
    const changed = library.sig !== current?.sig;
    current = library;
    json = JSON.stringify(library);
    if (changed) say("cyan", "SCANNED", `Roms/ (${library.totals.games.toLocaleString()} games)`);
    return library;
  }).finally(() => {
    scanning = null;
  });
  return scanning;
}

export function rescanInBackground(): void {
  rescanLibrary().catch((error) => say("red", "FAILED", `Rescanning Roms/: ${(error as Error).message}`));
}

export async function libraryJson(): Promise<string> {
  if (!current) await rescanLibrary();
  return json;
}

export const libraryTotals = () => current?.totals ?? null;

export const getLibrary = async (): Promise<Library> => current ?? rescanLibrary();
