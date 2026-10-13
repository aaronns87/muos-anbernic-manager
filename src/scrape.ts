// Artwork scraping from the libretro thumbnail server (thumbnails.libretro.com): free, no account, and named after
// No-Intro / MAME titles like the ROMs. This finds the box art, screenshot and title screen for each game; the app
// composes the final image and saves it as PNG in Roms/<SYS>/Imgs through putLocalArt.

import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "./context.ts";
import { UserError } from "./errors.ts";
import { getLibrary } from "./games/library.ts";
import { loadArcadeNames } from "./games/metadata.ts";
import { ARCADE } from "./games/systems.ts";

const BASE = "https://thumbnails.libretro.com";
const INDEX_DAYS = 14;
const ARCADE_SETS = ["FBNeo - Arcade Games", "MAME"];

/** libretro thumbnail sets per ROM folder, best first. */
export const SOURCES: Record<string, string[]> = {
  A2600: ["Atari - 2600"], A5200: ["Atari - 5200"], A7800: ["Atari - 7800"], A800: ["Atari - 8-bit"],
  AMIGA: ["Commodore - Amiga"], ATARIST: ["Atari - ST"], ATOMISWAVE: ["Atomiswave", ...ARCADE_SETS], C64: ["Commodore - 64"],
  CPS1: ARCADE_SETS, CPS2: ARCADE_SETS, CPS3: ARCADE_SETS, FBNEO: ARCADE_SETS, HBMAME: ["MAME", "FBNeo - Arcade Games"],
  MAME: ["MAME", "FBNeo - Arcade Games"], PGM2: ARCADE_SETS, VARCADE: ARCADE_SETS,
  DOS: ["DOS"], DREAMCAST: ["Sega - Dreamcast"], EASYRPG: ["RPG Maker"],
  FC: ["Nintendo - Nintendo Entertainment System"], FDS: ["Nintendo - Family Computer Disk System"],
  GB: ["Nintendo - Game Boy"], GBA: ["Nintendo - Game Boy Advance"], GBC: ["Nintendo - Game Boy Color"],
  GG: ["Sega - Game Gear"], GW: ["Handheld Electronic Game"], LYNX: ["Atari - Lynx"],
  MD: ["Sega - Mega Drive - Genesis"], MDCD: ["Sega - Mega-CD - Sega CD"], MSX: ["Microsoft - MSX", "Microsoft - MSX2"],
  N64: ["Nintendo - Nintendo 64"], NAOMI: ["Sega - Naomi", "Sega - Naomi 2", ...ARCADE_SETS], NDS: ["Nintendo - Nintendo DS"],
  NEOCD: ["SNK - Neo Geo CD"], NEOGEO: ["SNK - Neo Geo", ...ARCADE_SETS], NGP: ["SNK - Neo Geo Pocket Color", "SNK - Neo Geo Pocket"],
  PCE: ["NEC - PC Engine - TurboGrafx 16", "NEC - PC Engine SuperGrafx"], PCECD: ["NEC - PC Engine CD - TurboGrafx-CD"],
  POKE: ["Nintendo - Pokemon Mini"], PS: ["Sony - PlayStation"], PSP: ["Sony - PlayStation Portable"],
  SATURN: ["Sega - Saturn"], SCUMMVM: ["ScummVM"], SEGA32X: ["Sega - 32X"], SFC: ["Nintendo - Super Nintendo Entertainment System"],
  SMS: ["Sega - Master System - Mark III"], VB: ["Nintendo - Virtual Boy"], VIC20: ["Commodore - VIC-20"],
  WS: ["Bandai - WonderSwan Color", "Bandai - WonderSwan"],
};
const KNOWN_SETS = new Set(Object.values(SOURCES).flat());

const FOLDERS = { box: "Named_Boxarts", snap: "Named_Snaps", title: "Named_Titles" } as const;
type Kind = keyof typeof FOLDERS;
const KINDS = Object.keys(FOLDERS) as Kind[];

// ---------------------------------------------------------------- the server's file lists

type SetIndex = { at: number } & Record<Kind, string[]>;
const indexes = new Map<string, SetIndex>();
const indexDir = () => path.join(ctx.cacheDir, "thumbnails");
const indexFile = (set: string) => path.join(indexDir(), `${set.replace(/[^\w.-]+/g, "_")}.json`);

async function fetchText(url: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new UserError("Could not reach thumbnails.libretro.com. Check the internet connection.");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new UserError(`thumbnails.libretro.com answered ${res.status}.`);
  return res.text();
}

/** The PNG names (without .png) in one folder of a thumbnail set. */
async function listing(set: string, kind: Kind): Promise<string[]> {
  const html = await fetchText(`${BASE}/${encodeURIComponent(set)}/${FOLDERS[kind]}/`);
  if (!html) return [];
  const names: string[] = [];
  for (const m of html.matchAll(/href="([^"?/]+)\.png"/g)) {
    try { names.push(decodeURIComponent(m[1])); } catch {}
  }
  return names;
}

async function setIndex(set: string, refresh: boolean): Promise<SetIndex> {
  const fresh = (i: SetIndex | undefined) => i && !refresh && Date.now() - i.at < INDEX_DAYS * 86_400_000;
  let index = indexes.get(set);
  if (fresh(index)) return index!;
  if (!refresh) {
    try {
      index = JSON.parse(await fsp.readFile(indexFile(set), "utf8")) as SetIndex;
      if (fresh(index)) { indexes.set(set, index); return index; }
    } catch {}
  }
  const [box, snap, title] = await Promise.all(KINDS.map((k) => listing(set, k)));
  index = { at: Date.now(), box, snap, title };
  await fsp.mkdir(indexDir(), { recursive: true });
  await fsp.writeFile(indexFile(set), JSON.stringify(index));
  indexes.set(set, index);
  return index;
}

// ---------------------------------------------------------------- matching

/** libretro replaces these characters with "_" in file names. */
const fileSafe = (name: string) => name.replace(/[&*/:`<>?\\|"]/g, "_");
const tagsOf = (name: string) => [...name.matchAll(/[([]([^)\]]*)[)\]]/g)].map((m) => m[1].toLowerCase());
/** Title only, lowercase letters and digits: "The Legend of Zelda (USA) (Rev 1)" and "Legend of Zelda, The (Europe)" agree. */
function looseKey(name: string): string {
  let t = name.replace(/[([][^)\]]*[)\]]/g, " ").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  t = t.replace(/,\s*(the|a|an)\b/g, " ").replace(/^\s*(the|a|an)\s+/, " ").replace(/_/g, " ");
  return t.replace(/[^a-z0-9]/g, "");
}

const BAD_TAGS = /\b(beta|proto|prototype|demo|sample|hack|pirate|unl|bootleg|kiosk)\b/;
const REGION_RANK: [RegExp, number][] = [[/\b(usa|world)\b/, 3], [/\beurope\b/, 2], [/\bjapan\b/, 1]];

/** Higher is better: same tags as the ROM, then a common region, then fewer odd tags. */
function rank(candidate: string, wanted: string[]): number {
  const tags = tagsOf(candidate);
  let score = tags.filter((t) => wanted.includes(t)).length * 10 - tags.length * 0.3;
  const joined = tags.join(" ");
  for (const [re, points] of REGION_RANK) if (re.test(joined)) { score += points; break; }
  if (BAD_TAGS.test(joined)) score -= 8;
  return score;
}

interface Pick { set: string; name: string; close: boolean }
interface KindIndex { exact: Map<string, Pick>; loose: Map<string, Pick[]> }

function kindIndex(sets: [string, SetIndex][], kind: Kind): KindIndex {
  const exact = new Map<string, Pick>(), loose = new Map<string, Pick[]>();
  for (const [set, index] of sets) {
    for (const name of index[kind]) {
      const lower = name.toLowerCase();
      if (!exact.has(lower)) exact.set(lower, { set, name, close: false });
      const key = looseKey(name);
      if (key) loose.set(key, [...(loose.get(key) ?? []), { set, name, close: true }]);
    }
  }
  return { exact, loose };
}

function find(index: KindIndex, names: string[]): Pick | null {
  for (const n of names) {
    const hit = index.exact.get(fileSafe(n).toLowerCase());
    if (hit) return hit;
  }
  for (const n of names) {
    const list = index.loose.get(looseKey(fileSafe(n)));
    if (!list) continue;
    const wanted = tagsOf(n);
    return list.reduce((a, b) => (rank(b.name, wanted) > rank(a.name, wanted) ? b : a));
  }
  return null;
}

/** Games to scrape, with the best box art, screenshot and title screen found for each. */
export async function scrapePlan(body: Record<string, unknown>) {
  const only = body.only === "all" ? "all" : "missing";
  const wanted = Array.isArray(body.systems) ? new Set(body.systems.map(String)) : null;
  const library = await getLibrary();
  const systems = library.systems.filter((s) => s.games.length && (!wanted || !wanted.size || wanted.has(s.code)));
  const unsupported = systems.filter((s) => !SOURCES[s.code]).map((s) => ({ code: s.code, games: s.games.length }));
  const usable = systems.filter((s) => SOURCES[s.code]);
  const sets = [...new Set(usable.flatMap((s) => SOURCES[s.code]))];
  const loaded = new Map<string, SetIndex>();
  for (let i = 0; i < sets.length; i += 4) {
    const batch = sets.slice(i, i + 4);
    (await Promise.all(batch.map((s) => setIndex(s, !!body.refresh)))).forEach((index, j) => loaded.set(batch[j], index));
  }
  const arcadeNames = usable.some((s) => ARCADE.has(s.code)) ? await loadArcadeNames() : new Map<string, string>();

  const items = [];
  const perSystem = [];
  for (const sys of usable) {
    const chosen = SOURCES[sys.code].map((s) => [s, loaded.get(s)!] as [string, SetIndex]);
    const idx = Object.fromEntries(KINDS.map((k) => [k, kindIndex(chosen, k)])) as Record<Kind, KindIndex>;
    let found = 0, considered = 0;
    for (const g of sys.games) {
      if (only === "missing" && g.i) continue;
      considered++;
      const stem = g.f.slice(0, g.f.lastIndexOf(".") > 0 ? g.f.lastIndexOf(".") : undefined);
      const full = ARCADE.has(sys.code) ? arcadeNames.get(stem) : undefined;
      const names = [full, stem].filter((n): n is string => !!n);
      const picks = Object.fromEntries(KINDS.map((k) => [k, find(idx[k], names)])) as Record<Kind, Pick | null>;
      if (picks.box || picks.snap || picks.title) found++;
      items.push({ code: sys.code, stem, file: g.f, name: g.t, has: !!g.i, image: g.i, box: picks.box, snap: picks.snap, title: picks.title });
    }
    perSystem.push({ code: sys.code, considered, found });
  }
  return { only, items, systems: perSystem, unsupported, source: BASE };
}

/** The best box art, screenshot and title screen for one game, trying each name in turn. */
export async function scrapeGame(body: Record<string, unknown>) {
  const code = String(body.code ?? "");
  const sets = SOURCES[code];
  if (!sets) throw new UserError("thumbnails.libretro.com has no artwork for this system.");
  const names = [...new Set((Array.isArray(body.names) ? body.names : []).map(String).map((n) => n.trim()).filter((n) => n && n.length < 300))].slice(0, 6);
  if (!names.length) throw new UserError("Give the game a name first.");
  const chosen: [string, SetIndex][] = [];
  for (const set of sets) chosen.push([set, await setIndex(set, false)]);
  const picks = Object.fromEntries(KINDS.map((k) => [k, find(kindIndex(chosen, k), names)])) as Record<Kind, Pick | null>;
  return { ...picks, source: BASE };
}

// ---------------------------------------------------------------- images

const cache = new Map<string, Buffer>();
let cacheBytes = 0;

/** Forgets the thumbnail lists and images held in memory; Settings clears the files as well. */
export function clearScrapeCache(): void {
  indexes.clear();
  cache.clear();
  cacheBytes = 0;
}
const CACHE_LIMIT = 96 * 1024 * 1024;

/** One thumbnail, fetched through this server (the browser cannot read cross-site images into a canvas). */
export async function scrapeImage(query: URLSearchParams): Promise<{ image: Buffer; name: string }> {
  const set = query.get("set") ?? "", kind = query.get("kind") as Kind, name = query.get("name") ?? "";
  if (!KNOWN_SETS.has(set) || !FOLDERS[kind] || !name || name.length > 300 || /[/\\]|\.\./.test(name)) throw new UserError("Unknown thumbnail.");
  const key = `${set}/${kind}/${name}`;
  let data = cache.get(key);
  if (data) {
    cache.delete(key);
    cache.set(key, data);
    return { image: data, name: `${name}.png` };
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}/${encodeURIComponent(set)}/${FOLDERS[kind]}/${encodeURIComponent(name)}.png`, { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new UserError("Could not reach thumbnails.libretro.com.");
  }
  if (!res.ok) throw new UserError(`thumbnails.libretro.com has no ${kind} image for ${name}.`);
  data = Buffer.from(await res.arrayBuffer());
  cache.set(key, data);
  cacheBytes += data.length;
  for (const [k, v] of cache) {
    if (cacheBytes <= CACHE_LIMIT) break;
    cache.delete(k);
    cacheBytes -= v.length;
  }
  return { image: data, name: `${name}.png` };
}
