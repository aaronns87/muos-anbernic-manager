// File explorer: folders on the handheld (over the card reader, USB or Wi-Fi) and in the workspace on this computer.
// Deleting on this computer moves things to the Trash; deleting on the handheld is permanent.

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ctx } from "./context.ts";
import type { DeviceFs, Progress } from "./device/fs.ts";
import { withTarget, type Target } from "./device/target.ts";
import { UserError } from "./errors.ts";
import { Job, requireIdle, requireQueueable, startJob, type Work } from "./jobs.ts";
import { files, human, say } from "./log.ts";
import { platform } from "./platform/index.ts";
import { exists, inside, removeQuietly } from "./util.ts";

type Side = "local" | "device";

const TEXT_MAX = 512 * 1024;
const IMAGE = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const TEXT = new Set([".txt", ".ini", ".cfg", ".conf", ".json", ".log", ".xml", ".opt", ".rac", ".gov", ".con", ".md", ".yml", ".yaml",
  ".sh", ".lua", ".csv", ".dat", ".m3u", ".cue", ".glslp", ".slangp", ".info", ".nfo", ".srm.txt"]);

const LOCAL_FOLDERS = [["roms", "Roms folder"], ["apps", "Apps folder"], ["os", "OS images"], ["bios", "BIOS folder"], ["backups", "Save backups"], ["themes", "Themes folder"]] as const;

/** The places on this computer the explorer may show: the workspace, plus folders from Settings that live elsewhere. */
export function localRoots(): { id: string; label: string; dir: string }[] {
  const roots = [{ id: "workspace", label: "Workspace", dir: ctx.root }];
  for (const [key, label] of LOCAL_FOLDERS) {
    const dir = ctx[key];
    if (dir && !inside(ctx.root, dir) && path.resolve(dir) !== path.resolve(ctx.root)) roots.push({ id: key, label, dir });
  }
  return roots;
}

/** Path parts below a root; refuses empty names, "." and "..", and backslashes. */
export function cleanParts(p: unknown): string[] {
  const parts = String(p ?? "").split("/").filter(Boolean);
  for (const part of parts) if (part === "." || part === ".." || part.includes("\\") || part.includes("\0")) throw new UserError(`"${part}" is not a valid name.`);
  return parts;
}

export function cleanName(n: unknown): string {
  const name = String(n ?? "").trim();
  if (!name || name === "." || name === ".." || /[/\\\0]/.test(name)) throw new UserError("Enter a name without slashes.");
  if (/[:*?"<>|]/.test(name)) throw new UserError('Names cannot contain : * ? " < > or |, which FAT32 and exFAT cards refuse.');
  if (name.length > 200) throw new UserError("That name is too long.");
  return name;
}

function localDir(root: string): string {
  const found = localRoots().find((r) => r.id === root);
  if (!found) throw new UserError("Choose a folder on this computer.");
  return found.dir;
}

function localPath(root: string, parts: string[]): string {
  const base = localDir(root), file = path.join(base, ...parts);
  if (file !== base && !inside(base, file)) throw new UserError("That path is outside the workspace.");
  return file;
}

function deviceFs(t: Target, root: string): DeviceFs {
  const found = t.all.find(([label]) => label === root);
  if (!found) throw new UserError(`${root} is not available over this connection.`);
  return found[1];
}

const side = (s: unknown): Side => {
  if (s !== "local" && s !== "device") throw new UserError("Choose this computer or the handheld.");
  return s;
};

interface Item { name: string; folder: boolean; size: number; mtime: number }

async function listLocal(dir: string): Promise<Item[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    throw new UserError("That folder is no longer there.");
  }
  const out: Item[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    try {
      const st = await fsp.stat(path.join(dir, e.name));
      out.push({ name: e.name, folder: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtime: st.mtimeMs / 1000 });
    } catch {}
  }
  return out;
}

const sorted = (items: Item[]) => items.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

export async function filesRoots(query: URLSearchParams) {
  const local = localRoots().map((r) => ({ id: r.id, label: r.label, dir: r.dir }));
  const volume = query.get("volume") ?? "";
  if (!volume) return { local, device: [], deviceError: "" };
  try {
    const device = await withTarget(volume, async (t) => t.all.map(([label, f]) => ({ id: label, label, rename: !!f.rename })));
    return { local, device, deviceError: "" };
  } catch (error) {
    return { local, device: [], deviceError: (error as Error).message };
  }
}

export async function filesList(query: URLSearchParams) {
  const s = side(query.get("side")), root = query.get("root") ?? "", parts = cleanParts(query.get("path"));
  if (s === "local") return { entries: sorted(await listLocal(localPath(root, parts))) };
  return withTarget(query.get("volume") ?? "", async (t) => {
    const list = await deviceFs(t, root).list(parts);
    if (!list) throw new UserError("That folder is no longer on the handheld.");
    return { entries: sorted(list.map((e) => ({ name: e.name, folder: e.folder, size: e.folder ? 0 : e.size, mtime: e.mtime }))) };
  });
}

const where = (s: Side, root: string, parts: string[]) => `${s === "local" ? "" : `${root}:`}${parts.join("/") || "/"}`;

export async function filesMkdir(body: Record<string, unknown>) {
  requireIdle();
  const s = side(body.side), root = String(body.root ?? ""), parts = [...cleanParts(body.path), cleanName(body.name)];
  if (s === "local") {
    const dir = localPath(root, parts);
    if (fs.existsSync(dir)) throw new UserError(`${parts.at(-1)} already exists.`);
    await fsp.mkdir(dir, { recursive: true });
  } else {
    await withTarget(String(body.volume ?? ""), async (t) => {
      const f = deviceFs(t, root);
      if ((await f.hasDir(parts)) || (await f.entry(parts))) throw new UserError(`${parts.at(-1)} already exists.`);
      await f.mkdir(parts);
    });
  }
  say("green", "CREATED", `Folder ${where(s, root, parts)}${s === "device" ? " on the handheld" : ""}.`);
  return { ok: true };
}

export async function filesRename(body: Record<string, unknown>) {
  requireIdle();
  const s = side(body.side), root = String(body.root ?? ""), dir = cleanParts(body.path);
  const from = [...dir, cleanName(body.from)], to = cleanName(body.to);
  if (from.at(-1) === to) return { ok: true };
  if (s === "local") {
    const src = localPath(root, from), dest = localPath(root, [...dir, to]);
    if (!(await exists(src))) throw new UserError(`${from.at(-1)} is no longer there.`);
    if ((await exists(dest)) && src.toLowerCase() !== dest.toLowerCase()) throw new UserError(`${to} already exists there.`);
    await fsp.rename(src, dest);
  } else {
    await withTarget(String(body.volume ?? ""), async (t) => {
      const f = deviceFs(t, root);
      if (!f.rename) throw new UserError("Renaming is not possible over USB. Connect over Wi-Fi or use a card reader.");
      await f.rename(from, to);
    });
  }
  say("green", "RENAMED", `${where(s, root, from)} to ${to}${s === "device" ? " on the handheld" : ""}.`);
  return { ok: true };
}

/** Deletes a file, or a folder with everything in it; returns how many files went. */
export async function removeDevice(f: DeviceFs, parts: string[]): Promise<number> {
  if (await f.entry(parts)) {
    await f.delete(parts);
    return 1;
  }
  const list = await f.list(parts);
  if (!list) throw new UserError(`${parts.at(-1)} is no longer on the handheld.`);
  let n = 0;
  for (const e of list) n += await removeDevice(f, [...parts, e.name]);
  await f.removeDir(parts);
  return n;
}

export async function filesDelete(body: Record<string, unknown>) {
  requireIdle();
  const s = side(body.side), root = String(body.root ?? ""), dir = cleanParts(body.path);
  const names = (Array.isArray(body.names) ? body.names : []).map(cleanName);
  if (!names.length) throw new UserError("Choose what to delete.");
  let deleted = 0, count = 0;
  const failed: string[] = [];
  const run = async (each: (name: string) => Promise<number>) => {
    for (const name of names) {
      try {
        count += await each(name);
        deleted++;
      } catch (error) {
        failed.push(`${name}: ${(error as Error).message}`);
      }
    }
  };
  if (s === "local") {
    await run(async (name) => {
      const file = localPath(root, [...dir, name]);
      if (!fs.existsSync(file)) throw new UserError("no longer there");
      await platform.trash(file);
      return 1;
    });
  } else {
    await withTarget(String(body.volume ?? ""), async (t) => {
      const f = deviceFs(t, root);
      await run((name) => removeDevice(f, [...dir, name]));
    });
  }
  const what = names.length === 1 ? where(s, root, [...dir, names[0]]) : `${deleted} items in ${where(s, root, dir)}`;
  if (deleted) say("yellow", s === "local" ? "TRASHED" : "DELETED", s === "local" ? `${what}.` : `${what} on the handheld (${files(count)}).`);
  return { deleted, failed };
}

/** A preview: images as they are, text files up to 512 KB as text. */
export async function filesRead(query: URLSearchParams) {
  const s = side(query.get("side")), root = query.get("root") ?? "", parts = cleanParts(query.get("path"));
  const name = parts.at(-1) ?? "", ext = path.extname(name).toLowerCase();
  const image = IMAGE.has(ext), text = TEXT.has(ext) || !ext;
  if (!image && !text) throw new UserError("There is no preview for this kind of file.");
  const load = async (file: string) => {
    const st = await fsp.stat(file);
    if (image) return { image: await fsp.readFile(file), name };
    if (st.size > TEXT_MAX) throw new UserError(`${name} is ${human(st.size)}; previews stop at ${human(TEXT_MAX)}.`);
    const data = await fsp.readFile(file);
    if (data.includes(0)) throw new UserError("This file is not text.");
    return { text: data.toString("utf8"), size: st.size, editable: true };
  };
  if (s === "local") {
    const file = localPath(root, parts);
    if (!(await fsp.stat(file).catch(() => null))?.isFile()) throw new UserError("That file is no longer there.");
    return load(file);
  }
  return withTarget(query.get("volume") ?? "", async (t) => {
    const f = deviceFs(t, root), entry = await f.entry(parts);
    if (!entry) throw new UserError("That file is no longer on the handheld.");
    if (!image && entry.size > TEXT_MAX) throw new UserError(`${name} is ${human(entry.size)}; previews stop at ${human(TEXT_MAX)}.`);
    if (image && entry.size > 20 * 1024 * 1024) throw new UserError("That image is too big to preview.");
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "manager-file-"));
    try {
      const file = path.join(tmp, "f" + ext);
      await f.get(parts, file);
      return await load(file);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
}

export async function filesWrite(body: Record<string, unknown>) {
  requireIdle();
  const s = side(body.side), root = String(body.root ?? ""), parts = cleanParts(body.path);
  const text = String(body.text ?? "");
  if (!parts.length) throw new UserError("Choose a file.");
  if (Buffer.byteLength(text) > TEXT_MAX) throw new UserError(`Files edited here must stay under ${human(TEXT_MAX)}.`);
  if (s === "local") {
    const file = localPath(root, parts);
    if (!(await fsp.stat(file).catch(() => null))?.isFile()) throw new UserError("That file is no longer there.");
    const partial = path.join(path.dirname(file), `.${path.basename(file)}.partial`);
    await fsp.writeFile(partial, text);
    await fsp.rename(partial, file);
  } else {
    await withTarget(String(body.volume ?? ""), async (t) => {
      const f = deviceFs(t, root);
      if (!(await f.entry(parts))) throw new UserError("That file is no longer on the handheld.");
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "manager-file-"));
      try {
        const file = path.join(tmp, parts.at(-1)!);
        await fsp.writeFile(file, text);
        await f.put(file, parts, () => false);
      } finally {
        await fsp.rm(tmp, { recursive: true, force: true });
      }
    });
  }
  say("green", "SAVED", `${where(s, root, parts)}${s === "device" ? " on the handheld" : ""}.`);
  return { ok: true };
}

// ---------------------------------------------------------------- copying between this computer and the handheld

interface FileWork extends Work {
  /** Absolute path on this computer, or path parts on the handheld. */
  local: string;
  device: string[];
  folder: boolean;
}

class FilesJob extends Job<FileWork> {
  readonly kind = "files";
  readonly up: boolean;
  readonly root: string;

  constructor(label: string, jobs: FileWork[], volume: string, target: string, up: boolean, root: string) {
    super(label, jobs, volume, target);
    this.up = up;
    this.root = root;
  }

  async copyOne(t: Target, job: FileWork, progress: Progress): Promise<void> {
    const f = deviceFs(t, this.root);
    if (job.folder) {
      if (this.up) await f.mkdir(job.device);
      else await fsp.mkdir(job.local, { recursive: true });
      return;
    }
    if (this.up) return f.put(job.local, job.device, progress);
    await fsp.mkdir(path.dirname(job.local), { recursive: true });
    const partial = path.join(path.dirname(job.local), `.${path.basename(job.local)}.partial`);
    try {
      await f.get(job.device, partial);
      await fsp.rename(partial, job.local);
    } finally {
      await removeQuietly(partial);
    }
    progress(job.size);
  }
}

async function walkLocal(file: string, device: string[], out: FileWork[], rel: string): Promise<void> {
  const st = await fsp.lstat(file);
  if (st.isSymbolicLink()) return;
  if (!st.isDirectory()) {
    out.push({ rel, size: st.size, local: file, device, folder: false });
    return;
  }
  out.push({ rel: rel + "/", size: 0, local: file, device, folder: true });
  for (const e of await fsp.readdir(file)) {
    if (e.startsWith(".")) continue;
    await walkLocal(path.join(file, e), [...device, e], out, `${rel}/${e}`);
  }
}

async function walkDevice(f: DeviceFs, parts: string[], local: string, out: FileWork[], rel: string): Promise<void> {
  const entry = await f.entry(parts);
  if (entry) {
    out.push({ rel, size: entry.size, local, device: parts, folder: false });
    return;
  }
  const list = await f.list(parts);
  if (!list) throw new UserError(`${parts.at(-1)} is no longer on the handheld.`);
  out.push({ rel: rel + "/", size: 0, local, device: parts, folder: true });
  for (const e of list) await walkDevice(f, [...parts, e.name], path.join(local, e.name), out, `${rel}/${e.name}`);
}

/** Copies picked files and folders between the two sides. With check set it only reports what would happen. */
export async function filesCopy(body: Record<string, unknown>) {
  requireQueueable(String(body.volume ?? ""));
  const from = side(body.from), up = from === "local";
  const src = (body.src ?? {}) as Record<string, unknown>, dest = (body.dest ?? {}) as Record<string, unknown>;
  const srcRoot = String(src.root ?? ""), srcDir = cleanParts(src.path), destRoot = String(dest.root ?? ""), destDir = cleanParts(dest.path);
  const names = (Array.isArray(src.names) ? src.names : []).map(cleanName);
  if (!names.length) throw new UserError("Choose what to copy.");
  const volume = String(body.volume ?? "");
  const plan = await withTarget(volume, async (t) => {
    const work: FileWork[] = [];
    const existing: string[] = [];
    if (up) {
      const f = deviceFs(t, destRoot);
      for (const name of names) {
        const target = [...destDir, name];
        if ((await f.entry(target)) || (await f.hasDir(target))) existing.push(name);
        await walkLocal(localPath(srcRoot, [...srcDir, name]), target, work, name);
      }
      return { work, existing, name: t.name, free: t.storages.find((s) => s.name.toUpperCase() === (destRoot === "TF2" ? "SD2" : destRoot))?.free ?? (t.info.storage === destRoot ? t.info.free : 0) };
    }
    const f = deviceFs(t, srcRoot);
    for (const name of names) {
      const target = localPath(destRoot, [...destDir, name]);
      if (fs.existsSync(target)) existing.push(name);
      await walkDevice(f, [...srcDir, name], target, work, name);
    }
    const st = await fsp.statfs(localDir(destRoot));
    return { work, existing, name: t.name, free: st.bavail * st.bsize };
  });
  const bytes = plan.work.reduce((n, w) => n + w.size, 0);
  const fileCount = plan.work.filter((w) => !w.folder).length;
  if (body.check) return { files: fileCount, bytes, existing: plan.existing, free: plan.free };
  if (plan.free && bytes > plan.free) throw new UserError(`This needs ${human(bytes)} and there is ${human(plan.free)} free.`);
  const keep = body.replace ? plan.work : plan.work.filter((w) => !plan.existing.includes(w.rel.split("/")[0]));
  if (!keep.length) throw new UserError("Everything picked is already there. Choose to replace it to copy again.");
  const target = up ? plan.name : "this computer";
  const label = names.length === 1 ? names[0] : `${names.length} items`;
  const job = new FilesJob(label, keep, volume, target, up, up ? destRoot : srcRoot);
  return { job: startJob(job, `${label}: ${files(keep.filter((w) => !w.folder).length)} (${human(keep.reduce((n, w) => n + w.size, 0))}) to ${target}`) };
}
