// What is on the connected device: its games, how they compare with Roms/, and its artwork catalogues.

import fsp from "node:fs/promises";
import path from "node:path";
import { ART_KINDS, CATALOGUE_PATH, CATALOGUES, NOT_ROMS, ROMS_DIR, isArtFile } from "../catalogue.ts";
import { SCUMMVM } from "../games/engines.ts";
import { runningVersion } from "../updates.ts";
import { skipName, splitName } from "../util.ts";
import { workspaceFiles } from "../workspace.ts";
import type { Entry, DeviceFs } from "./fs.ts";
import { readWifiText } from "./sftp.ts";
import { art, type Target } from "./target.ts";

export async function deviceCatalogues(t: Target): Promise<Map<string, string>> {
  const fs = art(t);
  if (!fs) return new Map();
  return new Map(((await fs.list(CATALOGUE_PATH)) ?? []).filter((e) => e.folder).map((e) => [e.name.toLowerCase(), e.name]));
}

/** Catalogue folder MustardOS reads for a ROM folder: an existing one if any, else the core.json name. */
export function catalogueFor(system: string, existing: Map<string, string>): string {
  const names = CATALOGUES[system.toUpperCase()] ?? [];
  for (const name of names) if (existing.has(name.toLowerCase())) return existing.get(name.toLowerCase())!;
  return names[0] ?? "";
}

/** Files under ROMS/<system> on the device, keyed by lower-cased "system/.../file". */
export async function deviceFiles(fs: DeviceFs, systems: string[], recursive = true): Promise<Map<string, [string, Entry]>> {
  const found = new Map<string, [string, Entry]>();
  const top = new Map(((await fs.list([ROMS_DIR])) ?? []).filter((e) => e.folder).map((e) => [e.name.toLowerCase(), e.name]));
  for (const system of systems) {
    const name = top.get(system.toLowerCase());
    const stack = name ? [[name]] : [];
    while (stack.length) {
      const parts = stack.pop()!;
      const scummLevel = parts.length === 1 && parts[0].toUpperCase() === SCUMMVM;
      for (const entry of (await fs.list([ROMS_DIR, ...parts], scummLevel)) ?? []) {
        if (entry.folder) {
          const scummData = scummLevel && entry.name.startsWith(".");
          if (recursive && (!skipName(entry.name) || scummData)) stack.push([...parts, entry.name]);
        } else if (!entry.name.startsWith(".")) {
          const rel = [...parts, entry.name].join("/");
          found.set(rel.toLowerCase(), [rel, entry]);
        }
      }
    }
  }
  return found;
}

export type CopyState = "same" | "check" | "changed";

/** SYSTEM/file to same|check|changed for the Roms/ games that are on the device. */
export async function deviceIndex(t: Target): Promise<Record<string, CopyState>> {
  const local = await workspaceFiles();
  const found: Record<string, CopyState> = {};
  const files = await deviceFiles(t.roms, [...local.values()].map((s) => s.system), false);
  for (const [rel, entry] of files.values()) {
    const [folder, name] = rel.split("/");
    const system = local.get(folder.toLowerCase())!;
    const mine = system.names.get(name.toLowerCase());
    if (!mine) continue;
    const state: CopyState = mine.size !== entry.size ? "changed"
      : t.roms.remote || Math.abs(mine.mtime - entry.mtime) <= 2 ? "same" : "check";
    found[`${system.system}/${mine.name}`] = state;
  }
  return found;
}

async function romEntries(t: Target, folder: string, hidden: Set<string>): Promise<Entry[]> {
  return ((await t.roms.list([ROMS_DIR, folder])) ?? [])
    .filter((e) => !e.folder && !NOT_ROMS.has(splitName(e.name)[1]) && !hidden.has(e.name.toLowerCase()));
}

/** Every game on the device with how it compares with Roms/ and which artwork the catalogue has for it. */
export async function deviceListing(t: Target) {
  const local = await workspaceFiles();
  const existing = await deviceCatalogues(t);
  const artCache = new Map<string, Map<string, [string, string, number]>>();
  const artIn = async (catalogue: string, kind: string) => {
    const key = `${catalogue.toLowerCase()}|${kind}`;
    if (!artCache.has(key)) {
      const found = new Map<string, [string, string, number]>();
      for (const image of (await art(t)?.list([...CATALOGUE_PATH, catalogue, kind])) ?? []) {
        const stem = splitName(image.name)[0].toLowerCase();
        if (!image.folder && isArtFile(image.name) && !found.has(stem)) found.set(stem, [catalogue, image.name, image.size]);
      }
      artCache.set(key, found);
    }
    return artCache.get(key)!;
  };

  const folders = ((await t.roms.list([ROMS_DIR])) ?? []).filter((e) => e.folder && !skipName(e.name))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const systems = [];
  for (const folder of folders) {
    const mine = local.get(folder.name.toLowerCase());
    const system = mine?.system ?? folder.name;
    const entries = await romEntries(t, folder.name, mine?.hidden ?? new Set());
    if (!entries.length) continue;
    const catalogues = (CATALOGUES[system.toUpperCase()] ?? []).filter((n) => existing.has(n.toLowerCase())).map((n) => existing.get(n.toLowerCase())!);
    const games = [];
    for (const entry of entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))) {
      const stem = splitName(entry.name)[0].toLowerCase();
      const lib = mine?.names.get(entry.name.toLowerCase());
      const st = !lib ? "device" : lib.size !== entry.size ? "changed" : t.roms.remote || Math.abs(lib.mtime - entry.mtime) <= 2 ? "same" : "check";
      const found: Record<string, [string, string, number]> = {};
      for (const kind of ART_KINDS) {
        for (const catalogue of catalogues) {
          const hit = (await artIn(catalogue, kind)).get(stem);
          if (hit) {
            found[kind] = hit;
            break;
          }
        }
      }
      games.push({ f: entry.name, s: entry.size, st, lf: lib?.name ?? "", art: found });
    }
    systems.push({ code: system, folder: folder.name, games });
  }
  return { card: t.info, systems };
}

/** Counts of the games on the device and how many of them Roms/ also has. */
export async function deviceSummary(t: Target) {
  const local = await workspaceFiles();
  const found = { systems: 0, games: 0, bytes: 0, in_library: 0, catalogues: (await deviceCatalogues(t)).size };
  for (const folder of (await t.roms.list([ROMS_DIR])) ?? []) {
    if (!folder.folder || skipName(folder.name)) continue;
    const mine = local.get(folder.name.toLowerCase());
    const entries = await romEntries(t, folder.name, mine?.hidden ?? new Set());
    if (!entries.length) continue;
    found.systems++;
    found.games += entries.length;
    found.bytes += entries.reduce((sum, e) => sum + e.size, 0);
    found.in_library += entries.filter((e) => mine?.names.has(e.name.toLowerCase())).length;
  }
  return found;
}

/** Connection details, what the device reports about itself and its storage. */
export async function deviceInfo(t: Target) {
  const labels: Record<string, string> = { SD1: "SD1 (system card)", SD2: "TF2 (games card)" };
  let identity: Record<string, string | number> = {};
  let storages: { key: string; name: string; free: number; total: number }[];
  const described = (s: { name: string; free: number; total: number }) => {
    const key = s.name.toUpperCase().split(/\s/)[0];
    return { key, name: labels[key] ?? s.name, free: s.free, total: s.total };
  };
  if (t.session) {
    identity = { ...(await t.session.identity()) };
    storages = t.storages.map(described);
  } else if (t.info.mode === "wifi") {
    const version = (await readWifiText("/MUX (internal)/config/system/version")).split(/\r?\n/)[0].trim();
    const build = (await readWifiText("/MUX (internal)/config/system/build").catch(() => "")).trim();
    if (version) identity.version = await runningVersion(version, build);
    storages = t.storages.map(described);
  } else {
    storages = [{ key: "SD2", name: labels.SD2, free: t.info.free, total: t.info.total }];
    const version = await fsp.readFile(path.join(t.info.mount ?? "", "MUOS", "info", "version"), "utf8").catch(() => "");
    if (version.trim()) identity.version = version.split(/\r?\n/)[0].trim();
  }
  return { ...t.info, identity, storages, roms_folder: await t.roms.hasDir([ROMS_DIR]) };
}

/** [kind, path parts] of the device artwork (and Scrappy text) for one ROM. */
export async function deviceGameArt(t: Target, folder: string, name: string): Promise<[string, string[]][]> {
  const stem = splitName(name)[0].toLowerCase();
  const existing = await deviceCatalogues(t);
  const found: [string, string[]][] = [];
  for (const catalogue of (CATALOGUES[folder.toUpperCase()] ?? []).filter((n) => existing.has(n.toLowerCase())).map((n) => existing.get(n.toLowerCase())!)) {
    for (const kind of [...ART_KINDS, "text"]) {
      for (const entry of (await art(t)?.list([...CATALOGUE_PATH, catalogue, kind])) ?? []) {
        if (!entry.folder && splitName(entry.name)[0].toLowerCase() === stem) found.push([kind, [...CATALOGUE_PATH, catalogue, kind, entry.name]]);
      }
    }
  }
  return found;
}
