// What is played on the handheld: MustardOS's activity tracker (MUOS/info/track/playtime_data.json), its history
// (MUOS/info/history) and collections (MUOS/info/collection), all on SD1. A collection is a folder of small .cfg
// files, one per game: "<name>-<FNV-1a of the full path>.cfg" holding the full path, the ROM folder and the name.

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DeviceFs } from "./device/fs.ts";
import { withTarget, type Target } from "./device/target.ts";
import { UserError } from "./errors.ts";
import { cleanName, cleanParts, removeDevice } from "./files.ts";
import { requireIdle } from "./jobs.ts";
import { say } from "./log.ts";

const TRACK = ["MUOS", "info", "track", "playtime_data.json"];
const HISTORY = ["MUOS", "info", "history"];
const COLLECTION = ["MUOS", "info", "collection"];
/** Where each card is mounted on the handheld; collection entries hold full paths. */
const MOUNT: Record<string, string> = { TF2: "/mnt/sdcard", SD1: "/mnt/mmc" };

export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(s, "utf8")) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).toUpperCase().padStart(8, "0");
}

const stripExt = (f: string) => (f.lastIndexOf(".") > 0 ? f.slice(0, f.lastIndexOf(".")) : f);

/** A collection entry for a game at <storage>/ROMS/<rel>: its file name and contents. */
export function collectionItem(storage: string, rel: string): { file: string; text: string } {
  const mount = MOUNT[storage];
  if (!mount) throw new UserError(`${storage} is not a card on the handheld.`);
  const parts = cleanParts(rel);
  if (parts.length < 2) throw new UserError(`${rel} is not a game in a ROM folder.`);
  const full = `${mount}/ROMS/${parts.join("/")}`, name = stripExt(parts.at(-1)!);
  return { file: `${name}-${fnv1a(full)}.cfg`, text: `${full}\n${parts.slice(0, -1).join("/")}\n${name}` };
}

/** Folder and file of a full handheld path such as /mnt/union/ROMS/GB/Tetris.gb. */
export function romOf(full: string): { system: string; file: string } {
  const m = /\/ROMS\/(.+)\/([^/]+)$/i.exec(full);
  return m ? { system: m[1], file: m[2] } : { system: "", file: full.split("/").pop() || full };
}

async function readText(f: DeviceFs, parts: string[]): Promise<string | null> {
  if (!(await f.entry(parts))) return null;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "manager-play-"));
  try {
    const file = path.join(tmp, "f");
    await f.get(parts, file);
    return await fsp.readFile(file, "utf8");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

async function writeText(f: DeviceFs, parts: string[], text: string): Promise<void> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "manager-play-"));
  try {
    const file = path.join(tmp, parts.at(-1)!);
    await fsp.writeFile(file, text);
    await f.put(file, parts, () => false);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

const sd1 = (t: Target) => t.all.find(([label]) => label === "SD1")?.[1] ?? null;
const NEED_SD1 = "This is kept on SD1 inside the handheld. Connect over USB or Wi-Fi to see it.";

interface Track { name?: string; last_core?: string; launches?: number; total_time?: number; avg_time?: number; last_session?: number; start_time?: number; core_launches?: Record<string, number> }

export async function playJson(query: URLSearchParams) {
  return withTarget(query.get("volume") ?? "", async (t) => {
    const f = sd1(t);
    if (!f) return { available: false, reason: NEED_SD1, games: [], recent: [] };
    let data: Record<string, Track> = {};
    const text = await readText(f, TRACK);
    if (text) {
      try { data = JSON.parse(text); } catch { throw new UserError("The handheld's play time file is damaged and cannot be read."); }
    }
    const games = Object.entries(data).map(([full, g]) => ({
      path: full, ...romOf(full), name: g.name || stripExt(romOf(full).file), core: g.last_core || "",
      launches: g.launches || 0, total: g.total_time || 0, avg: Math.round(g.avg_time || 0), last: g.last_session || 0, started: g.start_time || 0,
      cores: g.core_launches || {},
    }));
    const recent = ((await f.list(HISTORY)) ?? []).filter((e) => !e.folder && e.name.endsWith(".cfg"))
      .map((e) => ({ name: e.name.replace(/(-[0-9A-F]{8})?\.cfg$/i, ""), mtime: e.mtime })).sort((a, b) => b.mtime - a.mtime);
    return { available: true, reason: "", games, recent, tracked: !!text };
  });
}

// ---------------------------------------------------------------- collections

/** The collection folder MustardOS uses: TF2's if it has one, else SD1's. */
async function collectionBase(t: Target): Promise<{ f: DeviceFs; storage: string } | null> {
  for (const [label, f] of t.all) if (label === "TF2" && (await f.hasDir(COLLECTION))) return { f, storage: label };
  const f = sd1(t);
  return f ? { f, storage: "SD1" } : null;
}

interface Entry { file: string; path: string; system: string; name: string }

async function readCollection(f: DeviceFs, parts: string[], out: { path: string; items: Entry[] }[], depth: number): Promise<void> {
  const list = (await f.list([...COLLECTION, ...parts])) ?? [];
  const items: Entry[] = [];
  for (const e of list) {
    if (e.folder) {
      if (depth < 3) await readCollection(f, [...parts, e.name], out, depth + 1);
      continue;
    }
    if (!e.name.endsWith(".cfg")) continue;
    const text = (await readText(f, [...COLLECTION, ...parts, e.name])) ?? "";
    const [full = "", system = "", name = ""] = text.split("\n").map((l) => l.trim());
    items.push({ file: e.name, path: full, system: system || romOf(full).system, name: name || e.name.replace(/(-[0-9A-F]{8})?\.cfg$/i, "") });
  }
  items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  out.push({ path: parts.join("/"), items });
}

export async function collectionsJson(query: URLSearchParams) {
  return withTarget(query.get("volume") ?? "", async (t) => {
    const base = await collectionBase(t);
    if (!base) return { available: false, reason: NEED_SD1, storage: "", collections: [], rename: false };
    const out: { path: string; items: Entry[] }[] = [];
    if (await base.f.hasDir(COLLECTION)) await readCollection(base.f, [], out, 0);
    out.sort((a, b) => (a.path === "" ? -1 : b.path === "" ? 1 : a.path.localeCompare(b.path, undefined, { sensitivity: "base" })));
    return { available: true, reason: "", storage: base.storage, collections: out, rename: !!base.f.rename };
  });
}

async function withCollections<T>(body: Record<string, unknown>, fn: (f: DeviceFs, storage: string) => Promise<T>): Promise<T> {
  requireIdle();
  return withTarget(String(body.volume ?? ""), async (t) => {
    const base = await collectionBase(t);
    if (!base) throw new UserError(NEED_SD1);
    return fn(base.f, base.storage);
  });
}

const collectionPath = (p: unknown) => {
  const parts = cleanParts(p);
  if (!parts.length) throw new UserError("Choose a collection.");
  return parts;
};

export async function createCollection(body: Record<string, unknown>) {
  const name = cleanName(body.name);
  return withCollections(body, async (f) => {
    const parts = [...COLLECTION, name];
    if (await f.hasDir(parts)) throw new UserError(`There is already a collection called ${name}.`);
    await f.mkdir(parts);
    say("green", "COLLECTION", `Created "${name}" on the handheld.`);
    return { ok: true, path: name };
  });
}

export async function deleteCollection(body: Record<string, unknown>) {
  const parts = collectionPath(body.path);
  return withCollections(body, async (f) => {
    if (!(await f.hasDir([...COLLECTION, ...parts]))) throw new UserError("That collection is no longer on the handheld.");
    const n = await removeDevice(f, [...COLLECTION, ...parts]);
    say("yellow", "COLLECTION", `Deleted "${parts.join("/")}" (${n} game${n === 1 ? "" : "s"}) from the handheld.`);
    return { ok: true };
  });
}

export async function renameCollection(body: Record<string, unknown>) {
  const parts = collectionPath(body.path), to = cleanName(body.to);
  return withCollections(body, async (f) => {
    const from = [...COLLECTION, ...parts], dest = [...COLLECTION, ...parts.slice(0, -1), to];
    if (parts.at(-1) === to) return { ok: true, path: parts.join("/") };
    if ((await f.hasDir(dest)) && parts.at(-1)!.toLowerCase() !== to.toLowerCase()) throw new UserError(`There is already a collection called ${to}.`);
    if (f.rename) {
      await f.rename(from, to);
    } else {
      const list = (await f.list(from)) ?? [];
      if (list.some((e) => e.folder)) throw new UserError("Collections with folders inside can only be renamed over Wi-Fi.");
      await f.mkdir(dest);
      for (const e of list) await writeText(f, [...dest, e.name], (await readText(f, [...from, e.name])) ?? "");
      await removeDevice(f, from);
    }
    say("green", "COLLECTION", `Renamed "${parts.join("/")}" to "${to}" on the handheld.`);
    return { ok: true, path: [...parts.slice(0, -1), to].join("/") };
  });
}

export async function addToCollection(body: Record<string, unknown>) {
  const parts = cleanParts(body.path);
  const games = Array.isArray(body.games) ? body.games : [];
  if (!games.length) throw new UserError("Choose games to add.");
  if (games.length > 500) throw new UserError("Add at most 500 games at a time.");
  const items = games.map((g) => collectionItem(String((g as Record<string, unknown>).storage ?? ""), String((g as Record<string, unknown>).rel ?? "")));
  return withCollections(body, async (f) => {
    const dir = [...COLLECTION, ...parts];
    if (parts.length && !(await f.hasDir(dir))) throw new UserError("That collection is no longer on the handheld.");
    const have = new Set(((await f.list(dir)) ?? []).map((e) => e.name.toLowerCase()));
    let added = 0;
    for (const item of items) {
      if (have.has(item.file.toLowerCase())) continue;
      await writeText(f, [...dir, item.file], item.text);
      added++;
    }
    say("green", "COLLECTION", `Added ${added} game${added === 1 ? "" : "s"} to "${parts.join("/") || "Collections"}" on the handheld.`);
    return { added, skipped: items.length - added };
  });
}

export async function removeFromCollection(body: Record<string, unknown>) {
  const parts = cleanParts(body.path);
  const files = (Array.isArray(body.files) ? body.files : []).map(cleanName);
  if (!files.length) throw new UserError("Choose games to remove.");
  if (files.some((n) => !n.endsWith(".cfg"))) throw new UserError("Only collection entries can be removed here.");
  return withCollections(body, async (f) => {
    let removed = 0;
    for (const name of files) {
      const p = [...COLLECTION, ...parts, name];
      if (!(await f.entry(p))) continue;
      await f.delete(p);
      removed++;
    }
    say("yellow", "COLLECTION", `Removed ${removed} game${removed === 1 ? "" : "s"} from "${parts.join("/") || "Collections"}" on the handheld.`);
    return { removed };
  });
}
