// Local MustardOS images in the os folder, grouped by release (mustardos_<ver>/), with catalogue notes.

import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "./context.ts";
import { imageDevice } from "./devices.ts";
import { UserError } from "./errors.ts";
import { platform } from "./platform/index.ts";
import { hashLines, importOsImage } from "./system/image.ts";
import { compareVersions, deviceVersion, loadMustardCatalogue, versionIn, versionOfBuild } from "./updates.ts";
import { inside, isDir, isFile, listDir } from "./util.ts";

const IMAGE_RE = /\.img(\.gz|\.xz)?$/i;
const RELEASE_RE = /^mustardos_(\d+(?:\.\d+)+)$/i;

/** Version from a mustardos_<ver> folder name, or null when the name is not a release folder. */
export function parseOsReleaseFolder(name: string): string | null {
  const m = RELEASE_RE.exec(String(name || ""));
  return m ? m[1] : null;
}

export type OsImageRow = {
  name: string;
  path: string;
  size: number;
  deviceId: string;
  deviceName: string;
  hashOk: boolean | null;
};

export type OsReleaseRow = {
  id: string;
  version: string;
  folder: string;
  path: string;
  unsorted: boolean;
  images: OsImageRow[];
  totalSize: number;
  hashFile: boolean;
};

async function readHashNames(dir: string): Promise<Set<string> | null> {
  const file = path.join(dir, "hash.txt");
  if (!(await isFile(file))) return null;
  try {
    const rows = hashLines(await fsp.readFile(file, "utf8"));
    return new Set(rows.map((r) => r.name.toLowerCase()));
  } catch {
    return null;
  }
}

async function imagesIn(dir: string, hashNames: Set<string> | null): Promise<OsImageRow[]> {
  const out: OsImageRow[] = [];
  for (const e of await listDir(dir)) {
    if (!e.isFile() || !IMAGE_RE.test(e.name) || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    const st = await fsp.stat(full);
    const dev = imageDevice(e.name);
    out.push({
      name: e.name,
      path: full,
      size: st.size,
      deviceId: dev?.id || "",
      deviceName: dev ? `${dev.maker} ${dev.name.replace(/^TrimUI /, "")}` : "",
      hashOk: hashNames ? hashNames.has(e.name.toLowerCase()) : null,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Scan os/: mustardos_<ver> folders plus loose root images as Unsorted. */
export async function listOsReleases(): Promise<OsReleaseRow[]> {
  const root = ctx.os;
  if (!(await isDir(root))) return [];
  const releases: OsReleaseRow[] = [];
  const loose: OsImageRow[] = [];
  const rootHash = await readHashNames(root);

  for (const e of await listDir(root)) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      const ver = parseOsReleaseFolder(e.name);
      if (!ver) continue;
      const hashNames = await readHashNames(full);
      const images = await imagesIn(full, hashNames);
      releases.push({
        id: e.name.toLowerCase(),
        version: ver,
        folder: e.name,
        path: full,
        unsorted: false,
        images,
        totalSize: images.reduce((n, i) => n + i.size, 0),
        hashFile: hashNames !== null,
      });
    } else if (e.isFile() && IMAGE_RE.test(e.name) && !e.name.startsWith(".")) {
      const st = await fsp.stat(full);
      const dev = imageDevice(e.name);
      loose.push({
        name: e.name,
        path: full,
        size: st.size,
        deviceId: dev?.id || "",
        deviceName: dev ? `${dev.maker} ${dev.name.replace(/^TrimUI /, "")}` : "",
        hashOk: rootHash ? rootHash.has(e.name.toLowerCase()) : null,
      });
    }
  }

  releases.sort((a, b) => compareVersions(b.version, a.version) || a.folder.localeCompare(b.folder));
  if (loose.length) {
    loose.sort((a, b) => a.name.localeCompare(b.name));
    releases.push({
      id: "unsorted",
      version: "",
      folder: "Unsorted",
      path: root,
      unsorted: true,
      images: loose,
      totalSize: loose.reduce((n, i) => n + i.size, 0),
      hashFile: rootHash !== null,
    });
  }
  return releases;
}

function guardOsPath(target: string): string {
  if (!target || !path.isAbsolute(target)) throw new UserError("Pick a file or folder inside the OS images folder.");
  const resolved = path.resolve(target);
  const root = path.resolve(ctx.os);
  if (resolved === root) throw new UserError("The OS images folder itself cannot be removed.");
  if (!inside(ctx.os, resolved)) throw new UserError("That path is outside the OS images folder.");
  return resolved;
}

/** Move one image or a whole mustardos_<ver> folder to the Trash. */
export async function removeOsPath(body: Record<string, unknown>) {
  const target = guardOsPath(String(body.path ?? ""));
  const kind = String(body.kind ?? "");
  if (kind === "release") {
    if (!(await isDir(target))) throw new UserError("That release folder was not found.");
    const name = path.basename(target);
    if (!parseOsReleaseFolder(name)) throw new UserError("Only mustardos_<version> folders can be removed as a release.");
  } else if (kind === "image") {
    if (!(await isFile(target))) throw new UserError("That image was not found.");
    if (!IMAGE_RE.test(path.basename(target))) throw new UserError("Only MustardOS image files can be removed here.");
  } else {
    throw new UserError("Say whether to remove an image or a release.");
  }
  const trashed = await platform.trash(target);
  return { ok: true, trashed };
}

/** Reveal a path inside the OS images folder in the system file manager. */
export async function revealOsPath(body: Record<string, unknown>) {
  const which = String(body.which ?? "");
  if (which === "os" || which === "folder") {
    if (!(await isDir(ctx.os))) throw new UserError("The OS images folder does not exist yet.");
    platform.openUrl(ctx.os);
    return { ok: true };
  }
  const target = guardOsPath(String(body.path ?? ""));
  if (!(await isFile(target)) && !(await isDir(target))) throw new UserError("That path was not found.");
  platform.openUrl(target);
  return { ok: true };
}

/** Local releases plus matching MustardOS catalogue notes and optional official download links. */
export async function osLibraryJson(query?: URLSearchParams) {
  const device = /^[a-z0-9-]{3,40}$/.test(query?.get("device") || "") ? query!.get("device")! : "";
  const refresh = query?.get("refresh") === "1";
  const { data, error } = await loadMustardCatalogue(device, refresh);
  const releases = await listOsReleases();
  const byVer = new Map((data?.releases || []).map((r) => [r.ver, r]));
  const official = device && data?.images[device] ? data.images[device] : null;
  const officialVer = official ? versionIn(official.name.replace(/^MustardOS_[^_]+_/, "")) : "";

  const dev = await deviceVersion().catch(() => ({ version: "", build: "" }));
  const localNames = releases.flatMap((r) => r.images.map((i) => i.name));
  const byBuild = versionOfBuild(dev.build, [official?.name || "", ...localNames]);
  const runningVer = byBuild || /^(\d+(?:\.\d+)+)/.exec(dev.version)?.[1] || "";

  return {
    folder: ctx.os,
    available: await isDir(ctx.os),
    runningVer,
    runningBuild: dev.build || "",
    error,
    checked: data?.fetched || 0,
    releases: releases.map((rel) => {
      const note = rel.version ? byVer.get(rel.version) : undefined;
      const links = note?.links && Object.keys(note.links).length ? note.links : {};
      const officialLinks = official && officialVer && rel.version === officialVer ? official.links : {};
      return {
        ...rel,
        code: note?.code || "",
        type: note?.type || "",
        running: !!(runningVer && rel.version && rel.version === runningVer),
        notes: note
          ? { changes: note.changes, notes: note.notes, important: note.important }
          : null,
        downloads: { ...links, ...officialLinks },
      };
    }),
  };
}

export { importOsImage };
