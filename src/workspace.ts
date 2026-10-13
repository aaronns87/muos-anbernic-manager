// The ROM collection in the workspace's Roms/ folder, plus the os/ and apps/ folders next to it.

import fsp from "node:fs/promises";
import path from "node:path";
import { EXCLUDED_TOP, NOT_ROMS, isArtFile } from "./catalogue.ts";
import { ctx } from "./context.ts";
import { UserError } from "./errors.ts";
import { companions } from "./games/engines.ts";
import { inside, isDir, listDir, skipName, splitName } from "./util.ts";

export async function workspaceSystems(): Promise<string[]> {
  return (await listDir(ctx.roms))
    .filter((d) => d.isDirectory() && !skipName(d.name) && !EXCLUDED_TOP.has(d.name.toUpperCase()))
    .map((d) => d.name)
    .sort();
}

/** Files a .cue, .gdi or .m3u in this folder points at; the games list shows only the sheet. Lower-cased. */
export async function referencedNames(folder: string, names: string[]): Promise<Set<string>> {
  const hidden = new Set<string>();
  for (const name of names) {
    const ext = splitName(name)[1];
    if (ext !== "cue" && ext !== "m3u" && ext !== "gdi") continue;
    let text: string;
    try {
      text = await fsp.readFile(path.join(folder, name), "utf8");
    } catch {
      continue;
    }
    if (ext === "cue") {
      for (const m of text.matchAll(/FILE\s+"([^"]+)"/g)) hidden.add(m[1]);
    } else if (ext === "gdi") {
      for (const m of text.matchAll(/\s"?([^"\s]+\.(?:bin|raw))"?\s/gi)) hidden.add(m[1]);
    } else {
      for (const line of text.split(/\r?\n/)) if (line.trim() && !line.startsWith("#")) hidden.add(line.trim());
    }
  }
  return new Set([...hidden].map((h) => path.basename(h.replaceAll("\\", "/")).toLowerCase()));
}

export interface LocalFile {
  name: string;
  size: number;
  mtime: number;
}

export interface LocalSystem {
  system: string;
  /** Top-level files by lower-cased name. */
  names: Map<string, LocalFile>;
  /** Lower-cased names referenced by .cue/.gdi/.m3u sheets. */
  hidden: Set<string>;
}

/** Top-level ROM files per system folder, keyed by lower-cased folder name. */
export async function workspaceFiles(): Promise<Map<string, LocalSystem>> {
  const result = new Map<string, LocalSystem>();
  for (const system of await workspaceSystems()) {
    const folder = path.join(ctx.roms, system);
    const names = new Map<string, LocalFile>();
    for (const entry of await listDir(folder)) {
      if (entry.name.startsWith(".") || !entry.isFile()) continue;
      const st = await fsp.stat(path.join(folder, entry.name));
      names.set(entry.name.toLowerCase(), { name: entry.name, size: st.size, mtime: st.mtimeMs / 1000 });
    }
    result.set(system.toLowerCase(), { system, names, hidden: await referencedNames(folder, [...names.values()].map((f) => f.name)) });
  }
  return result;
}

/** ROM stems (exact and lower-cased) and Imgs images (by lower-cased stem) per system folder. */
export async function workspaceGames(): Promise<{ games: Map<string, Map<string, string>>; images: Map<string, Map<string, string[]>> }> {
  const games = new Map<string, Map<string, string>>(), images = new Map<string, Map<string, string[]>>();
  for (const system of await workspaceSystems()) {
    const folder = path.join(ctx.roms, system);
    const stems = new Map<string, string>();
    for (const entry of await listDir(folder)) {
      if (entry.name.startsWith(".") || !entry.isFile()) continue;
      const [stem, ext] = splitName(entry.name);
      if (NOT_ROMS.has(ext)) continue;
      if (!stems.has(stem)) stems.set(stem, stem);
      if (!stems.has(stem.toLowerCase())) stems.set(stem.toLowerCase(), stem);
    }
    games.set(system, stems);
    const found = new Map<string, string[]>();
    for (const entry of await listDir(path.join(folder, "Imgs"))) {
      if (!isArtFile(entry.name)) continue;
      const key = splitName(entry.name)[0].toLowerCase();
      found.set(key, [...(found.get(key) ?? []), entry.name]);
    }
    images.set(system, found);
  }
  return { games, images };
}

/** Path of the PNG in Roms/<system>/Imgs for a ROM stem, or "". */
export async function libraryImage(system: string, stem: string): Promise<string> {
  return (await libraryImages(system)).get(stem.toLowerCase()) ?? "";
}

/** The PNGs in Roms/<system>/Imgs by lowercase stem. */
export async function libraryImages(system: string): Promise<Map<string, string>> {
  const imgs = path.join(ctx.roms, system, "Imgs"), found = new Map<string, string>();
  for (const entry of await listDir(imgs)) {
    const [s, ext] = splitName(entry.name);
    if (ext === "png" && !found.has(s.toLowerCase())) found.set(s.toLowerCase(), path.join(imgs, entry.name));
  }
  return found;
}

/** Every ROM file under the given Roms/-relative paths ("" is everything): rel path to absolute path. */
export async function collect(targets: unknown[]): Promise<{ picked: Map<string, string>; skipped: string[] }> {
  const picked = new Map<string, string>(), skipped = new Set<string>();
  for (const raw of targets) {
    if (typeof raw !== "string") throw new UserError("Invalid path.");
    const target = raw.replace(/^\/+|\/+$/g, "");
    const parts = target.split("/").filter(Boolean);
    if (parts.includes("..")) throw new UserError(`Invalid path: ${target}`);
    const top = parts[0] ?? "";
    if (EXCLUDED_TOP.has(top.toUpperCase())) throw new UserError(`${top} holds stock Anbernic firmware files, which MustardOS does not run.`);
    if (parts.some(skipName)) throw new UserError(`${target} is a hidden or Imgs artwork path, which is not copied.`);
    const full = path.join(ctx.roms, ...parts);
    let st;
    try {
      st = await fsp.stat(full);
    } catch {
      throw new UserError(`Not found in Roms/: ${target}`);
    }
    if (parts.length && !inside(ctx.roms, await fsp.realpath(full))) throw new UserError(`Not found in Roms/: ${target}`);
    if (st.isFile()) {
      if (parts.length < 2) throw new UserError(`${target} is not inside a system folder.`);
      picked.set(parts.join("/"), full);
      continue;
    }
    const walk = async (dir: string, rel: string[]) => {
      const entries = (await listDir(dir)).sort((a, b) => (a.name < b.name ? -1 : 1));
      for (const entry of entries) {
        if (skipName(entry.name)) continue;
        if (entry.isDirectory()) {
          if (!rel.length && EXCLUDED_TOP.has(entry.name.toUpperCase())) {
            skipped.add(entry.name);
            continue;
          }
          await walk(path.join(dir, entry.name), [...rel, entry.name]);
        } else if (entry.isFile() && rel.length) {
          picked.set([...rel, entry.name].join("/"), path.join(dir, entry.name));
        }
      }
    };
    await walk(full, parts);
  }
  for (const rel of [...picked.keys()]) {
    const parts = rel.split("/");
    if (parts.length !== 2) continue;
    for (const [extraRel, extraFull] of await companions(parts[0], parts[1])) picked.set(extraRel, extraFull);
  }
  return { picked, skipped: [...skipped].sort() };
}

interface WorkspaceEntry {
  name: string;
  size: number;
  mtime: number;
}

async function sizeOf(p: string): Promise<number> {
  const st = await fsp.stat(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const entry of await listDir(p)) total += await sizeOf(path.join(p, entry.name)).catch(() => 0);
  return total;
}

export const OS_FILE = /\.(img|gz|xz|zip|7z)$/;
export const APP_FILE = /\.(muxapp|muxupd|muxzip|muxthm|muxalt|muxcat|muxcfg|zip)$/;

async function entries(folder: string, keep: (name: string, dir: boolean) => boolean): Promise<WorkspaceEntry[]> {
  const found: WorkspaceEntry[] = [];
  for (const entry of await listDir(folder)) {
    if (skipName(entry.name) || !keep(entry.name.toLowerCase(), entry.isDirectory())) continue;
    const full = path.join(folder, entry.name);
    found.push({ name: entry.name, size: await sizeOf(full), mtime: (await fsp.stat(full)).mtimeMs / 1000 });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** The OS images and MustardOS apps waiting in the OS images and apps folders (os/ and apps/ by default). */
export async function workspaceInfo() {
  return {
    root: ctx.root,
    roms: await isDir(ctx.roms),
    osDir: ctx.os,
    appsDir: ctx.apps,
    os: await entries(ctx.os, (n, dir) => dir || OS_FILE.test(n)),
    apps: await entries(ctx.apps, (n) => APP_FILE.test(n)),
  };
}
