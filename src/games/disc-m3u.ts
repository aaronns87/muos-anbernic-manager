// Multi-disc .m3u playlists: detect sibling cue/chd sheets (No-Intro / Redump Disc N) without a playlist.

import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { say } from "../log.ts";
import { splitName } from "../util.ts";
import type { Game } from "./library.ts";
import { sheetRefs } from "./disc-layout.ts";

const SHEET = new Set(["cue", "chd", "m3u"]);
const DISC_TAG = /^(?:disc|disk)\s*(\d+)$/i;
const DISC_IN_NAME = /\((?:disc|disk)\s*(\d+)\)/i;

export interface M3uDisc {
  f: string;
  p: string;
  t: string;
  x: string;
  disc: number;
}

export interface M3uGroup {
  id: string;
  title: string;
  m3uName: string;
  discs: M3uDisc[];
  /** An existing .m3u already lists every disc in order. */
  covered: boolean;
}

export function discNumberFromGame(g: Pick<Game, "f" | "t" | "g">): number | null {
  for (const tag of g.g) {
    const m = DISC_TAG.exec(tag);
    if (m) return Number(m[1]);
  }
  const stem = splitName(g.f)[0];
  const m = DISC_IN_NAME.exec(stem) || DISC_IN_NAME.exec(g.t);
  return m ? Number(m[1]) : null;
}

/** Title stem shared by every disc in a set (disc index stripped). */
export function discSetStem(g: Pick<Game, "f" | "t">): string {
  return splitName(g.f)[0].replace(DISC_IN_NAME, "").trim();
}

export function proposeM3uName(stem: string): string {
  const safe = stem.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim() || "Multi-disc";
  return `${safe}.m3u`;
}

async function readM3uEntries(folder: string, name: string): Promise<string[]> {
  try {
    const text = await fsp.readFile(path.join(folder, name), "utf8");
    return sheetRefs("m3u", text).map((h) => h.toLowerCase());
  } catch {
    return [];
  }
}

/** Groups that still need a .m3u beside the ROMs. Exported for tests. */
export function findM3uGroups(games: Game[], coveredByM3u: Map<string, string[]>): M3uGroup[] {
  const byStem = new Map<string, Game[]>();
  for (const g of games) {
    if (!SHEET.has(g.x.toLowerCase()) || g.x.toLowerCase() === "m3u") continue;
    const n = discNumberFromGame(g);
    if (n === null) continue;
    const stem = discSetStem(g).toLowerCase();
    if (!stem) continue;
    byStem.set(stem, [...(byStem.get(stem) ?? []), g]);
  }
  const out: M3uGroup[] = [];
  for (const [stem, list] of byStem) {
    if (list.length < 2) continue;
    const discs: M3uDisc[] = list.map((g) => ({
      f: g.f, p: g.p, t: g.t, x: g.x, disc: discNumberFromGame(g) ?? 0,
    })).sort((a, b) => a.disc - b.disc || a.f.localeCompare(b.f));
    if (discs.some((d, i) => i && d.disc === discs[i - 1].disc)) continue;
    const entries = discs.map((d) => d.f.toLowerCase());
    const covered = [...coveredByM3u.entries()].some(([, refs]) =>
      entries.length === refs.length && entries.every((e, i) => e === refs[i]),
    );
    const title = list[0].t.replace(DISC_IN_NAME, "").trim() || discSetStem(list[0]);
    out.push({
      id: stem,
      title,
      m3uName: proposeM3uName(discSetStem(list[0])),
      discs,
      covered,
    });
  }
  out.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  return out;
}

export async function m3uCoverage(folder: string, names: Set<string>): Promise<Map<string, string[]>> {
  const covered = new Map<string, string[]>();
  for (const name of names) {
    if (!name.endsWith(".m3u")) continue;
    const refs = await readM3uEntries(folder, name);
    if (refs.length >= 2) covered.set(name, refs);
  }
  return covered;
}

export async function groupsForSystem(code: string, games: Game[]): Promise<M3uGroup[]> {
  const folder = path.join(ctx.roms, code);
  const names = new Set<string>();
  for (const g of games) names.add(g.f.toLowerCase());
  try {
    const covered = await m3uCoverage(folder, names);
    return findM3uGroups(games, covered);
  } catch {
    return findM3uGroups(games, new Map());
  }
}

export function attachM3uHints(games: M3uDisc[], groups: M3uGroup[]): Map<string, { id: string; m3uName: string; disc: number }> {
  const out = new Map<string, { id: string; m3uName: string; disc: number }>();
  for (const group of groups) {
    if (group.covered) continue;
    for (const d of group.discs) out.set(d.f, { id: group.id, m3uName: group.m3uName, disc: d.disc });
  }
  return out;
}

export function m3uPreviewLines(group: M3uGroup): string[] {
  return group.discs.map((d) => d.f);
}

export async function resolveM3uGroup(code: string, id: string): Promise<M3uGroup> {
  const { getLibrary } = await import("./library.ts");
  const library = await getLibrary();
  const sys = library.systems.find((s) => s.code === code);
  if (!sys) throw new UserError(`No folder ${code}.`);
  const groups = await groupsForSystem(code, sys.games);
  const group = groups.find((g) => g.id === id);
  if (!group) throw new UserError("That multi-disc set is no longer in the library. Refresh and try again.");
  return group;
}

export async function previewM3u(body: Record<string, unknown>) {
  const code = String(body.code ?? "");
  const id = String(body.group ?? "");
  const group = await resolveM3uGroup(code, id);
  const lines = m3uPreviewLines(group);
  return { code, group: id, title: group.title, m3uName: group.m3uName, lines, preview: `${lines.join("\n")}\n`, covered: group.covered };
}

export async function writeM3uPlaylist(body: Record<string, unknown>) {
  const code = String(body.code ?? "");
  const id = String(body.group ?? "");
  const overwrite = body.overwrite === true;
  const group = await resolveM3uGroup(code, id);
  if (group.covered) throw new UserError("This set already has a matching .m3u playlist.");
  const folder = path.join(ctx.roms, code);
  const m3uName = String(body.m3uName ?? group.m3uName);
  if (!/^[^/\\]+\.m3u$/i.test(m3uName)) throw new UserError("Pick a simple .m3u file name.");
  const dest = path.join(folder, m3uName);
  if (!overwrite) {
    try {
      await fsp.access(dest);
      throw new UserError(`${m3uName} already exists. Tick overwrite or pick another name.`);
    } catch (error) {
      if (!(error instanceof UserError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  for (const d of group.discs) {
    try {
      await fsp.access(path.join(folder, d.f));
    } catch {
      throw new UserError(`${d.f} is missing from ${code}.`);
    }
  }
  const lines = m3uPreviewLines(group);
  await fsp.writeFile(dest, `${lines.join("\n")}\n`, "utf8");
  say("green", "PLAYLIST", `Wrote ${m3uName} (${lines.length} discs) in Roms/${code}.`);
  return { ok: true, ...(await previewM3u({ code, group: id })) };
}

export async function writeM3uBatch(body: Record<string, unknown>) {
  const code = String(body.code ?? "");
  const { getLibrary } = await import("./library.ts");
  const sys = (await getLibrary()).systems.find((s) => s.code === code);
  if (!sys) throw new UserError(`No folder ${code}.`);
  const groups = (await groupsForSystem(code, sys.games)).filter((g) => !g.covered);
  if (!groups.length) throw new UserError("No multi-disc sets need a playlist.");
  let written = 0;
  const names: string[] = [];
  const failed: string[] = [];
  for (const group of groups) {
    try {
      const res = await writeM3uPlaylist({ code, group: group.id, overwrite: false });
      written++;
      names.push(res.m3uName);
    } catch (error) {
      failed.push(`${group.title}: ${(error as Error).message}`);
    }
  }
  if (written) say("green", "PLAYLISTS", `${written} .m3u playlists in Roms/${code}.`);
  return { written, names, failed };
}