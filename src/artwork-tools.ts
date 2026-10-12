// Artwork upkeep: the health of Roms/<SYS>/Imgs (with uploads and clean-up there) and leftover images in the device catalogue.

import fsp from "node:fs/promises";
import path from "node:path";
import { deviceArtParts, pngFromBase64, pngSize, replaceLibraryImage } from "./artwork.ts";
import { ART_KINDS, CATALOGUE_EXTRAS, CATALOGUE_PATH, CATALOGUE_SYSTEMS, NOT_ROMS, ROMS_DIR, isArtFile, normName } from "./catalogue.ts";
import { ctx } from "./context.ts";
import { deviceFiles } from "./device/content.ts";
import { art, withTarget, type Target } from "./device/target.ts";
import { UserError } from "./errors.ts";
import { rescanInBackground } from "./games/library.ts";
import { requireIdle } from "./jobs.ts";
import { say } from "./log.ts";
import { platform } from "./platform/index.ts";
import { inside, isFile, listDir, safePart, splitName } from "./util.ts";
import { referencedNames, workspaceSystems } from "./workspace.ts";

/** Bigger than this is flagged, as such images only cost space; the side grows with screens wider than 1000 px. */
const LARGE_BYTES = 700 * 1024;
const LARGE_SIDE = 1000;

function limitsFor(query?: URLSearchParams) {
  const side = Math.max(LARGE_SIDE, Math.min(4096, Math.round(Number(query?.get("screen")) || 0)));
  return { side, bytes: Math.round(LARGE_BYTES * (side / LARGE_SIDE) ** 2) };
}

// ---------------------------------------------------------------- Roms/

interface LocalImage {
  name: string;
  size: number;
  /** PNG dimensions; 0 when not a PNG (or a broken one). */
  w: number;
  h: number;
  ext: string;
  /** The library game it belongs to, "" for none. */
  game: string;
  /** No ROM in the folder has this name. */
  orphan: boolean;
  /** Another image has the same name with a different extension. */
  dup: boolean;
  large: boolean;
  /** Not a working PNG, so MustardOS cannot show it. */
  convert: boolean;
  url: string;
}

async function head(file: string): Promise<Buffer> {
  const handle = await fsp.open(file, "r");
  try {
    const buffer = Buffer.alloc(24);
    const { bytesRead } = await handle.read(buffer, 0, 24, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function systemFolder(value: unknown): Promise<string> {
  const system = (await workspaceSystems()).find((s) => s === value);
  if (!system) throw new UserError("Unknown system folder.");
  return system;
}

/** ROM stems of a Roms/ folder: every ROM-like file (so a .bin's image is no leftover) and the games the library shows. */
async function romStems(system: string) {
  const folder = path.join(ctx.roms, system);
  const files = (await listDir(folder)).filter((e) => e.isFile() && !e.name.startsWith(".")).map((e) => e.name);
  const hidden = await referencedNames(folder, files);
  const stems = new Map<string, string>(), games = new Map<string, string>();
  for (const name of files) {
    const [stem, ext] = splitName(name);
    if (NOT_ROMS.has(ext)) continue;
    if (!stems.has(stem.toLowerCase())) stems.set(stem.toLowerCase(), stem);
    if (!hidden.has(name.toLowerCase()) && !games.has(stem.toLowerCase())) games.set(stem.toLowerCase(), name);
  }
  return { stems, games };
}

async function systemArt(system: string, limits = limitsFor()) {
  const { stems, games } = await romStems(system);
  const imgs = path.join(ctx.roms, system, "Imgs");
  const images: LocalImage[] = [];
  const perStem = new Map<string, number>();
  for (const entry of await listDir(imgs)) {
    if (!entry.isFile() || !isArtFile(entry.name)) continue;
    const file = path.join(imgs, entry.name);
    const [stem, ext] = splitName(entry.name);
    const [st, start] = await Promise.all([fsp.stat(file), head(file)]);
    const [w, h] = pngSize(start) ?? [0, 0];
    const key = stem.toLowerCase();
    perStem.set(key, (perStem.get(key) ?? 0) + 1);
    images.push({
      name: entry.name, size: st.size, w, h, ext, game: games.get(key) ?? "", orphan: !stems.has(key), dup: false,
      large: st.size > limits.bytes || Math.max(w, h) > limits.side, convert: ext !== "png" || !w,
      url: `/Roms/${encodeURIComponent(system)}/Imgs/${encodeURIComponent(entry.name)}?v=${Math.trunc(st.mtimeMs)}`,
    });
  }
  for (const image of images) image.dup = perStem.get(splitName(image.name)[0].toLowerCase())! > 1;
  images.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
  const missing = [...games].filter(([key]) => !perStem.has(key)).map(([, name]) => name).sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  return { system, games: games.size, images, missing };
}

/** Per-system artwork health for the whole of Roms/. */
export async function localArtwork(query?: URLSearchParams) {
  const limits = limitsFor(query), systems = [];
  const totals = { games: 0, missing: 0, images: 0, bytes: 0, orphans: 0, duplicates: 0, convert: 0, large: 0 };
  for (const system of await workspaceSystems()) {
    const { games, images, missing } = await systemArt(system, limits);
    if (!games && !images.length) continue;
    const row = {
      code: system, games, missing: missing.length, images: images.length,
      bytes: images.reduce((sum, i) => sum + i.size, 0),
      orphans: images.filter((i) => i.orphan).length,
      duplicates: images.filter((i) => i.dup).length,
      convert: images.filter((i) => i.convert && !i.orphan).length,
      large: images.filter((i) => i.large && !i.orphan).length,
    };
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += row[key];
    systems.push(row);
  }
  return { systems, totals, limits };
}

export async function localArtworkSystem(query: URLSearchParams) {
  return systemArt(await systemFolder(query.get("code")), limitsFor(query));
}

/** Saves an uploaded PNG as a game's Roms/ artwork; its previous images go to the Trash. */
export async function putLocalArt(body: Record<string, unknown>) {
  requireIdle();
  const system = await systemFolder(body.system);
  if (!safePart(body.stem)) throw new UserError("Invalid game name.");
  const stem = (await romStems(system)).stems.get(body.stem.toLowerCase());
  if (!stem) throw new UserError(`Roms/${system} has no game named ${body.stem}.`);
  const data = pngFromBase64(body.data);
  const bulk = body.bulk === true;
  const image = await replaceLibraryImage(system, stem, "png", (partial) => fsp.writeFile(partial, data), !bulk);
  if (!bulk) say("green", "SAVED", `${stem}.png in Roms/${system}/Imgs.`);
  return { image };
}

/** Moves Roms/<system>/Imgs images to the Trash. */
export async function deleteLocalArt(body: Record<string, unknown>) {
  requireIdle();
  const system = await systemFolder(body.system);
  const names = Array.isArray(body.names) ? body.names : [];
  if (!names.length || names.length > 5000) throw new UserError("Choose between 1 and 5000 images.");
  const imgs = path.join(ctx.roms, system, "Imgs");
  let trashed = 0;
  for (const name of names) {
    if (!safePart(name) || !isArtFile(name)) throw new UserError("Invalid image name.");
    const file = path.join(imgs, name);
    if (!(await isFile(file)) || !inside(imgs, file)) continue;
    await platform.trash(file);
    trashed++;
  }
  say("yellow", "TRASHED", `${trashed} image${trashed === 1 ? "" : "s"} from Roms/${system}/Imgs.`);
  rescanInBackground();
  return { trashed };
}

// ---------------------------------------------------------------- device catalogue

/** Lower-cased ROM stems per upper-cased ROMS folder, from every storage that can be read. */
async function deviceStems(t: Target) {
  const sources = t.all;
  const stems = new Map<string, Set<string>>();
  const checked: string[] = [];
  for (const [label, fs] of sources) {
    const top = await fs.list([ROMS_DIR]);
    if (!top) continue;
    checked.push(label);
    const folders = top.filter((e) => e.folder).map((e) => e.name);
    for (const [rel] of (await deviceFiles(fs, folders)).values()) {
      const parts = rel.split("/");
      const [stem, ext] = splitName(parts[parts.length - 1]);
      if (NOT_ROMS.has(ext)) continue;
      const key = parts[0].toUpperCase();
      if (!stems.has(key)) stems.set(key, new Set());
      stems.get(key)!.add(stem.toLowerCase());
    }
  }
  return { stems, checked };
}

const MAX_LISTED = 5000;

/** Counts per catalogue and the images whose game is not on the device. */
export async function deviceArtAudit(body: Record<string, unknown>) {
  requireIdle();
  return withTarget(String(body.volume ?? ""), async (t) => {
    const fs = art(t);
    if (!fs) throw new UserError("The device has no MustardOS artwork catalogue to check.");
    const { stems, checked } = await deviceStems(t);
    const catalogues = [];
    const leftovers: { catalogue: string; kind: string; name: string; size: number; reason: "orphan" | "nofolder" }[] = [];
    const totals = { images: 0, bytes: 0, orphans: 0, orphanBytes: 0, nofolder: 0 };
    for (const folder of ((await fs.list(CATALOGUE_PATH)) ?? []).filter((e) => e.folder)) {
      if (CATALOGUE_EXTRAS.has(folder.name.toLowerCase())) continue;
      const codes = CATALOGUE_SYSTEMS.get(normName(folder.name)) ?? [];
      const present = codes.filter((c) => stems.has(c.toUpperCase()));
      const status = !codes.length ? "unknown" : present.length ? "checked" : "nofolder";
      const known = new Set(present.flatMap((c) => [...stems.get(c.toUpperCase())!]));
      const row = { name: folder.name, systems: codes, status, box: 0, preview: 0, splash: 0, bytes: 0, orphans: 0 };
      for (const kind of ART_KINDS) {
        for (const entry of (await fs.list([...CATALOGUE_PATH, folder.name, kind])) ?? []) {
          if (entry.folder || !isArtFile(entry.name)) continue;
          row[kind]++;
          row.bytes += entry.size;
          if (status === "unknown" || known.has(splitName(entry.name)[0].toLowerCase())) continue;
          row.orphans++;
          if (status === "checked") {
            totals.orphans++;
            totals.orphanBytes += entry.size;
          } else totals.nofolder++;
          if (leftovers.length < MAX_LISTED) {
            leftovers.push({ catalogue: folder.name, kind, name: entry.name, size: entry.size, reason: status === "checked" ? "orphan" : "nofolder" });
          }
        }
      }
      totals.images += row.box + row.preview + row.splash;
      totals.bytes += row.bytes;
      catalogues.push(row);
    }
    catalogues.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
    return { where: t.info.art, mode: t.info.mode, checked, catalogues, leftovers, totals, truncated: leftovers.length >= MAX_LISTED };
  });
}

/** Deletes catalogue images from the device, permanently. */
export async function deleteDeviceArt(body: Record<string, unknown>) {
  requireIdle();
  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length || files.length > 1000) throw new UserError("Choose between 1 and 1000 images.");
  const parts = files.map((f) => deviceArtParts(f && typeof f === "object" ? f : {}));
  return withTarget(String(body.volume ?? ""), async (t) => {
    const fs = art(t);
    if (!fs) throw new UserError("The device has no MustardOS artwork catalogue.");
    let deleted = 0, failed = 0;
    for (const p of parts) {
      try {
        await fs.delete(p);
        deleted++;
      } catch {
        failed++;
      }
    }
    say("yellow", "DELETED", `${deleted} image${deleted === 1 ? "" : "s"} from the catalogue on ${t.name}${failed ? ` (${failed} failed)` : ""}.`);
    return { deleted, failed };
  });
}
