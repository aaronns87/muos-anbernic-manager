// Artwork between Roms/<SYS>/Imgs and the MustardOS catalogue (MUOS/info/catalogue) on the device.

import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  ART_KINDS, CATALOGUE_EXTRAS, CATALOGUE_PATH, CATALOGUE_SYSTEMS, CATALOGUES, IMAGE_EXTS, NOT_ROMS, ROMS_DIR, USB_ID, WIFI_ID,
  isArtFile, normName, type ArtKind,
} from "./catalogue.ts";
import { ctx } from "./context.ts";
import { catalogueFor, deviceCatalogues } from "./device/content.ts";
import type { DeviceFs, Progress } from "./device/fs.ts";
import { art, cardFor, handheldState, withTarget, type Target } from "./device/target.ts";
import { UserError } from "./errors.ts";
import { rescanInBackground, rescanLibrary } from "./games/library.ts";
import { gamePath } from "./games/actions.ts";
import { Job, requireIdle, startJob, type Work } from "./jobs.ts";
import { files, say } from "./log.ts";
import { platform } from "./platform/index.ts";
import { isDir, listDir, removeQuietly, safePart, sameFile, splitName } from "./util.ts";
import { libraryImage, workspaceGames } from "./workspace.ts";

function noCatalogue(t: Target): string {
  return t.info.mode === "card"
    ? "TF2 has no MUOS/info/catalogue folder, so MustardOS keeps artwork on SD1. Connect the handheld over USB or Wi-Fi instead, or choose Keep artwork on TF2."
    : "The handheld has no MUOS/info/catalogue folder yet. Start MustardOS once with the card inserted.";
}

function requireArt(t: Target): DeviceFs {
  const fs = art(t);
  if (!fs) throw new UserError(noCatalogue(t));
  return fs;
}

export function artKind(value: unknown): ArtKind {
  if (!ART_KINDS.includes(value as ArtKind)) throw new UserError("Unknown artwork type.");
  return value as ArtKind;
}

interface CatalogueImage {
  catalogue: string;
  name: string;
  size: number;
  ref: [number, string, string, string];
  local: string | null;
}

async function scanCatalogue(t: Target, kind: ArtKind) {
  if (!t.arts.length) throw new UserError(noCatalogue(t));
  const found: CatalogueImage[] = [], sources = [], seen = new Set<string>();
  let folders = 0;
  for (const [index, [label, fs]] of t.arts.entries()) {
    let count = 0;
    for (const catalogue of (await fs.list(CATALOGUE_PATH)) ?? []) {
      if (!catalogue.folder || CATALOGUE_EXTRAS.has(catalogue.name.toLowerCase())) continue;
      folders++;
      for (const image of (await fs.list([...CATALOGUE_PATH, catalogue.name, kind])) ?? []) {
        const key = `${catalogue.name.toLowerCase()}|${image.name.toLowerCase()}`;
        if (image.folder || !isArtFile(image.name) || !image.size || seen.has(key)) continue;
        seen.add(key);
        count++;
        found.push({
          catalogue: catalogue.name, name: image.name, size: image.size, ref: [index, catalogue.name, kind, image.name],
          local: fs.localPath?.([...CATALOGUE_PATH, catalogue.name, kind, image.name]) ?? null,
        });
      }
    }
    sources.push({ name: label, images: count, active: index === 0 });
  }
  const label = t.info.mode === "card" ? "TF2 in the card reader" : `${t.name} over ${t.info.mode === "usb" ? "USB" : "Wi-Fi"}`;
  return { found, info: { label, folders, sources } };
}

interface GetWork extends Work {
  ref: CatalogueImage["ref"];
  dest: string;
  old: string[];
}

interface SendWork extends Work {
  src: string;
  parts: [string, string, string];
}

interface StoredPlan {
  direction: "get" | "send";
  volume: string;
  kind: ArtKind;
  new: (GetWork | SendWork)[];
  different: (GetWork | SendWork)[];
  created: number;
}

const plans = new Map<string, StoredPlan>();

function keepPlan(direction: StoredPlan["direction"], volume: string, kind: ArtKind, fresh: StoredPlan["new"], different: StoredPlan["new"], extra: object) {
  const id = crypto.randomBytes(8).toString("hex");
  for (const old of [...plans.keys()].slice(0, -4)) plans.delete(old);
  plans.set(id, { direction, volume, kind, new: fresh, different, created: Date.now() });
  const sum = (jobs: Work[]) => jobs.reduce((s, j) => s + j.size, 0);
  return {
    plan: id, kind,
    new: { count: fresh.length, bytes: sum(fresh) },
    different: { count: different.length, bytes: sum(different), files: different.slice(0, 50).map((j) => j.rel) },
    ...extra,
  };
}

type Counts = Map<string, { new: number; different: number; same: number }>;
const bump = (systems: Counts, code: string, key: "new" | "different" | "same") => {
  const entry = systems.get(code) ?? { new: 0, different: 0, same: 0 };
  entry[key]++;
  systems.set(code, entry);
};
const sortedCounts = (systems: Counts) => [...systems].sort(([a], [b]) => (a < b ? -1 : 1)).map(([code, v]) => ({ code, ...v }));

/** Artwork Scrappy saved on the device that is new or different in Roms/<SYS>/Imgs. */
export async function getPlan(body: Record<string, unknown>) {
  const kind = artKind(body.kind || "box");
  requireIdle();
  const volume = String(body.volume ?? "");
  const { found, info } = await withTarget(volume, (t) => scanCatalogue(t, kind));
  const { games, images } = await workspaceGames();
  const fresh: GetWork[] = [], different: GetWork[] = [], unmatched: string[] = [], unmapped = new Set<string>();
  const claimed = new Set<string>(), systems: Counts = new Map();
  let identical = 0;
  for (const item of found) {
    const [stem, ext] = splitName(item.name);
    let codes = CATALOGUE_SYSTEMS.get(normName(item.catalogue));
    if (!codes) {
      unmapped.add(item.catalogue);
      const candidates = [...games].filter(([, stems]) => stems.get(stem) || stems.get(stem.toLowerCase())).map(([c]) => c);
      codes = candidates.length === 1 ? candidates : [];
    }
    const hits = codes.filter((c) => games.has(c)).map((c) => [c, games.get(c)!.get(stem) ?? games.get(c)!.get(stem.toLowerCase())] as const)
      .filter(([, s]) => s) as [string, string][];
    if (!hits.length) {
      unmatched.push(`${item.catalogue}/${item.name}`);
      continue;
    }
    for (const [code, romStem] of hits) {
      if (claimed.has(`${code}|${romStem.toLowerCase()}`)) continue;
      claimed.add(`${code}|${romStem.toLowerCase()}`);
      const imgs = path.join(ctx.roms, code, "Imgs");
      const destName = `${romStem}.${ext}`;
      const dest = path.join(imgs, destName);
      const existing = images.get(code)?.get(romStem.toLowerCase()) ?? [];
      const job: GetWork = { rel: `${code}/Imgs/${destName}`, ref: item.ref, size: item.size, dest, old: existing.map((n) => path.join(imgs, n)) };
      if (!existing.length) {
        fresh.push(job);
        bump(systems, code, "new");
      } else if (existing.length === 1 && existing[0] === destName && (await fsp.stat(dest)).size === item.size
        && (item.local === null || (await sameFile(item.local, dest)))) {
        identical++;
        bump(systems, code, "same");
      } else {
        different.push(job);
        bump(systems, code, "different");
      }
    }
  }
  return keepPlan("get", volume, kind, fresh, different, {
    source: info, found: found.length, identical,
    unmatched: { count: unmatched.length, files: unmatched.slice(0, 30) },
    unmapped: [...unmapped].sort().slice(0, 20),
    systems: sortedCounts(systems),
  });
}

/** Roms/<SYS>/Imgs artwork for the games on the device that its catalogue lacks or has differently. */
export async function sendPlan(body: Record<string, unknown>) {
  const kind = artKind(body.kind || "box");
  requireIdle();
  const volume = String(body.volume ?? "");
  const { images } = await workspaceGames();
  const fresh: SendWork[] = [], different: SendWork[] = [], systems: Counts = new Map();
  let identical = 0, missing = 0;
  const where = await withTarget(volume, async (t) => {
    const fs = requireArt(t);
    const existing = await deviceCatalogues(t);
    const folders = new Map(((await t.roms.list([ROMS_DIR])) ?? []).filter((e) => e.folder).map((e) => [e.name.toLowerCase(), e.name]));
    for (const system of [...images.keys()].sort()) {
      const folder = folders.get(system.toLowerCase()), catalogue = catalogueFor(system, existing);
      if (!folder || !catalogue) continue;
      const current = new Map(((await fs.list([...CATALOGUE_PATH, catalogue, kind])) ?? []).filter((e) => !e.folder).map((e) => [e.name.toLowerCase(), e]));
      for (const entry of (await t.roms.list([ROMS_DIR, folder])) ?? []) {
        const [stem, ext] = splitName(entry.name);
        if (entry.folder || NOT_ROMS.has(ext)) continue;
        const names = (images.get(system)!.get(stem.toLowerCase()) ?? []).filter((n) => n.toLowerCase().endsWith(".png"));
        if (!names.length) {
          missing++;
          continue;
        }
        const src = path.join(ctx.roms, system, "Imgs", names[0]);
        const size = (await fsp.stat(src)).size;
        const old = current.get(`${stem}.png`.toLowerCase());
        const job: SendWork = { rel: `${catalogue}/${kind}/${stem}.png`, src, size, parts: [catalogue, kind, old ? old.name : `${stem}.png`] };
        if (!old) {
          fresh.push(job);
          bump(systems, system, "new");
        } else if (old.size === size) {
          identical++;
          bump(systems, system, "same");
        } else {
          different.push(job);
          bump(systems, system, "different");
        }
      }
    }
    return t.info.art;
  });
  return keepPlan("send", volume, kind, fresh, different, {
    where, identical, missing, found: fresh.length + different.length + identical, systems: sortedCounts(systems),
  });
}

class GetArtJob extends Job<GetWork> {
  readonly kind = "art";
  readonly verb = "SYNCED";
  private partial = "";

  async copyOne(t: Target, job: GetWork, _progress: Progress): Promise<void> {
    const [index, catalogue, kind, name] = job.ref;
    if (index >= t.arts.length) throw new UserError(`The catalogue on ${t.name} changed. Check again.`);
    await fsp.mkdir(path.dirname(job.dest), { recursive: true });
    this.partial = path.join(path.dirname(job.dest), `.${path.basename(job.dest)}.partial`);
    try {
      await t.arts[index][1].get([...CATALOGUE_PATH, catalogue, kind, name], this.partial);
      if ((await fsp.stat(this.partial)).size !== job.size) throw new UserError(`${path.basename(job.dest)} arrived incomplete.`);
      for (const old of job.old) if (await fsp.access(old).then(() => true, () => false)) await platform.trash(old);
      await fsp.rename(this.partial, job.dest);
    } finally {
      await removeQuietly(this.partial);
    }
  }

  protected report(outcome: Job["state"]): void {
    if (outcome === "done" && !this.failed.length) say("green", "SYNCED", `${files(this.copied)} of artwork into Roms/.`);
    else super.report(outcome);
  }

  protected async after(): Promise<void> {
    if (!this.copied) return;
    this.phase = "rebuild";
    this.current = "Rescanning Roms/";
    await rescanLibrary();
  }
}

class SendArtJob extends Job<SendWork> {
  readonly kind = "artsend";
  readonly verb = "SENT";

  async copyOne(t: Target, job: SendWork, progress: Progress): Promise<void> {
    await requireArt(t).put(job.src, [...CATALOGUE_PATH, ...job.parts], progress);
  }
}

export function startArtJob(body: Record<string, unknown>) {
  requireIdle();
  const id = String(body.plan ?? "");
  const plan = plans.get(id);
  plans.delete(id);
  if (!plan) throw new UserError("This preview has expired. Check again.");
  const jobs = [...plan.new, ...(body.replace ? plan.different : [])];
  if (!jobs.length) throw new UserError("No artwork to copy.");
  const name = plan.volume === USB_ID ? handheldState.name : plan.volume === WIFI_ID ? "the handheld" : "TF2";
  const kind = plan.kind[0].toUpperCase() + plan.kind.slice(1);
  const job: Job<GetWork> | Job<SendWork> = plan.direction === "get"
    ? new GetArtJob(`${kind} artwork from ${name}`, jobs as GetWork[], plan.volume, name)
    : new SendArtJob(`${kind} artwork to ${name}`, jobs as SendWork[], plan.volume, name);
  return startJob(job as Job<Work>, `${job.label}: ${files(jobs.length)}`);
}

export async function keepArtOnCard(body: Record<string, unknown>) {
  requireIdle();
  const card = await cardFor(String(body.volume ?? ""));
  const root = path.join(card.mount, ...CATALOGUE_PATH);
  for (const names of Object.values(CATALOGUES)) {
    for (const kind of [...ART_KINDS, "text"]) await fsp.mkdir(path.join(root, names[0], kind), { recursive: true });
  }
  say("green", "CREATED", "MUOS/info/catalogue on TF2. MustardOS uses it from the next boot.");
  return { ok: true };
}

// ---------------------------------------------------------------- one game's artwork

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from the first 24 bytes of a PNG, or null if it is not one. */
export function pngSize(head: Buffer): [number, number] | null {
  if (head.length < 24 || !head.subarray(0, 8).equals(PNG_SIGNATURE) || head.toString("latin1", 12, 16) !== "IHDR") return null;
  return [head.readUInt32BE(16), head.readUInt32BE(20)];
}

/** An uploaded image (base64 PNG, as the browser produces it). */
export function pngFromBase64(value: unknown): Buffer {
  const data = Buffer.from(typeof value === "string" ? value : "", "base64");
  if (!pngSize(data)) throw new UserError("That is not a PNG image.");
  return data;
}

/** Writes a game's Roms/ image through fill(partial), then moves its previous images to the Trash. */
export async function replaceLibraryImage(system: string, stem: string, ext: string, fill: (partial: string) => Promise<unknown>, rescan = true): Promise<string> {
  const folder = path.join(ctx.roms, system);
  if (!(await isDir(folder))) throw new UserError(`Roms/${system} does not exist.`);
  const imgs = path.join(folder, "Imgs");
  await fsp.mkdir(imgs, { recursive: true });
  const dest = path.join(imgs, `${stem}.${ext}`);
  const partial = path.join(imgs, `.${path.basename(dest)}.partial`);
  try {
    await fill(partial);
    if (!(await fsp.stat(partial)).size) throw new UserError("The image arrived empty.");
    for (const entry of await listDir(imgs)) {
      const [imageStem, imageExt] = splitName(entry.name);
      if (IMAGE_EXTS.has(imageExt) && imageStem.toLowerCase() === stem.toLowerCase()) await platform.trash(path.join(imgs, entry.name));
    }
    await fsp.rename(partial, dest);
  } finally {
    await removeQuietly(partial);
  }
  if (rescan) rescanInBackground();
  return `/Roms/${encodeURIComponent(system)}/Imgs/${encodeURIComponent(path.basename(dest))}`;
}

export function deviceArtParts(body: Record<string, unknown>): string[] {
  const kind = artKind(body.kind);
  const { catalogue, name } = body;
  if (!safePart(catalogue) || !safePart(name) || !isArtFile(name) || CATALOGUE_EXTRAS.has(catalogue.toLowerCase())) {
    throw new UserError("Invalid artwork path.");
  }
  return [...CATALOGUE_PATH, catalogue, kind, name];
}

/** Sends one game's artwork to the device catalogue: its Roms/ PNG, or an uploaded PNG in body.data. */
export async function sendGameArt(body: Record<string, unknown>) {
  const [system, name] = gamePath(body);
  const kind = artKind(body.kind);
  requireIdle();
  const stem = splitName(name)[0];
  let src = "", temp = "";
  if (body.data !== undefined) {
    const data = pngFromBase64(body.data);
    await fsp.mkdir(ctx.cacheDir, { recursive: true });
    src = temp = path.join(ctx.cacheDir, `upload-${crypto.randomBytes(6).toString("hex")}.png`);
    await fsp.writeFile(temp, data);
  } else {
    src = await libraryImage(system, stem);
    if (!src) throw new UserError(`Roms/${system}/Imgs has no PNG for ${stem}.`);
  }
  try {
    return await withTarget(String(body.volume ?? ""), async (t) => {
      const fs = requireArt(t);
      const catalogue = catalogueFor(system, await deviceCatalogues(t));
      if (!catalogue) throw new UserError(`MustardOS has no artwork catalogue for ${system}.`);
      await fs.put(src, [...CATALOGUE_PATH, catalogue, kind, `${stem}.png`], () => false);
      say("green", "SENT", `${kind} artwork for ${system}/${name} to ${t.name}${temp ? " (from a file)" : ""}.`);
      return { art: [catalogue, `${stem}.png`, (await fsp.stat(src)).size] };
    });
  } finally {
    if (temp) await removeQuietly(temp);
  }
}

/** Copies one device image into Roms/<SYS>/Imgs as the game's artwork in the library. */
export async function getGameArt(body: Record<string, unknown>) {
  const [system, name] = gamePath(body);
  const parts = deviceArtParts(body);
  requireIdle();
  const stem = splitName(name)[0];
  const image = await replaceLibraryImage(system, stem, splitName(parts[parts.length - 1])[1], (partial) =>
    withTarget(String(body.volume ?? ""), (t) => requireArt(t).get(parts, partial)));
  say("green", "SYNCED", `${decodeURIComponent(image.split("/").pop()!)} into Roms/${system}/Imgs.`);
  return { image };
}

export async function deleteGameArt(body: Record<string, unknown>) {
  const parts = deviceArtParts(body);
  requireIdle();
  await withTarget(String(body.volume ?? ""), async (t) => {
    await requireArt(t).delete(parts);
    say("yellow", "DELETED", `${parts.slice(3).join("/")} from ${t.name}.`);
  });
  return { ok: true };
}

/** Bytes of one catalogue image on the device; USB downloads are cached in .cache/device-art. */
export async function deviceImage(query: URLSearchParams): Promise<{ data: Buffer; name: string }> {
  const volume = query.get("volume") ?? "";
  const parts = deviceArtParts({ kind: query.get("kind"), catalogue: query.get("catalogue"), name: query.get("name") });
  const name = parts[parts.length - 1];
  if (volume !== USB_ID && volume !== WIFI_ID) {
    const file = path.join((await cardFor(volume)).mount, ...parts);
    return { data: await fsp.readFile(file).catch(() => { throw new UserError("Not on the card."); }), name };
  }
  const cache = path.join(ctx.cacheDir, "device-art");
  const key = crypto.createHash("sha1").update(`${volume}|${parts.join("/")}|${query.get("size") ?? ""}`).digest("hex");
  const file = path.join(cache, `${key}.${splitName(name)[1]}`);
  if (!(await fsp.access(file).then(() => true, () => false))) {
    await fsp.mkdir(cache, { recursive: true });
    const partial = `${file}.${crypto.randomUUID()}.partial`;
    try {
      await withTarget(volume, (t) => requireArt(t).get(parts, partial));
      await fsp.rename(partial, file);
    } finally {
      await removeQuietly(partial);
    }
  }
  return { data: await fsp.readFile(file), name };
}
