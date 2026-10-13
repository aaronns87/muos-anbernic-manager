// ScummVM games are more than one file: "<Name>.scummvm" is what the handheld lists and launches, and the game files sit
// in "<Name>/", ".<Name>/" or "_<Name>/" next to it. An empty .scummvm file makes ScummVM detect the game on first launch.

import path from "node:path";
import { ctx } from "../context.ts";
import type { DeviceFs } from "../device/fs.ts";
import { listDir, splitName } from "../util.ts";

export const SCUMMVM = "SCUMMVM";
const RUNNER = "scummvm";

/** True for the .scummvm file of a ScummVM game. */
export function isRunner(system: string, name: string): boolean {
  return system.toUpperCase() === SCUMMVM && splitName(name)[1] === RUNNER;
}

/** Data folder names a game may use, in the order the handheld's launcher tries them. */
export const scummFolders = (stem: string): string[] => [`.${stem}`, `_${stem}`, stem];

function findName(names: string[], want: string): string | undefined {
  return names.find((n) => n === want) ?? names.find((n) => n.toLowerCase() === want.toLowerCase());
}

async function walk(dir: string, rel: string[], out: [string, string][]): Promise<void> {
  for (const entry of await listDir(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, [...rel, entry.name], out);
    else if (entry.isFile() && entry.name !== ".DS_Store") out.push([[...rel, entry.name].join("/"), full]);
  }
}

/** The data folder of a ScummVM game in Roms/, or "". */
export async function scummFolder(system: string, stem: string): Promise<string> {
  const dirs = (await listDir(path.join(ctx.roms, system))).filter((e) => e.isDirectory()).map((e) => e.name);
  for (const want of scummFolders(stem)) {
    const hit = findName(dirs, want);
    if (hit) return hit;
  }
  return "";
}

/** Files in Roms/ a game needs besides its own file: [Roms/-relative path, absolute path]. */
export async function companions(system: string, name: string): Promise<[string, string][]> {
  if (!isRunner(system, name)) return [];
  const dir = await scummFolder(system, splitName(name)[0]);
  const out: [string, string][] = [];
  if (dir) await walk(path.join(ctx.roms, system, dir), [system, dir], out);
  return out;
}

/** Deletes a folder and everything in it on the device. */
export async function deleteDeviceTree(fs: DeviceFs, parts: string[]): Promise<void> {
  for (const entry of (await fs.list(parts, true)) ?? []) {
    if (entry.folder) await deleteDeviceTree(fs, [...parts, entry.name]);
    else await fs.delete([...parts, entry.name]);
  }
  await fs.removeDir(parts);
}

/** The data folder of a game on the device, as path parts, or null. */
export async function deviceFolder(fs: DeviceFs, base: string[], system: string, name: string): Promise<string[] | null> {
  if (!isRunner(system, name)) return null;
  const dirs = ((await fs.list(base, true)) ?? []).filter((e) => e.folder).map((e) => e.name);
  for (const want of scummFolders(splitName(name)[0])) {
    const hit = findName(dirs, want);
    if (hit) return [...base, hit];
  }
  return null;
}
