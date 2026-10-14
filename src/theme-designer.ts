// Theme Designer: MustardOS themes made on this computer, each an open theme folder in the workspace's themes/ folder
// laid out exactly as on the handheld. Reads and writes their scheme files and assets, starts themes from scratch, a
// .muxthm, the catalogue or the handheld, packs them as .muxthm and installs them like catalogue themes.
// Anything starting with a dot (the .designer/ notes, partial uploads) stays out of packages.

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { ctx } from "./context.ts";
import { UserError } from "./errors.ts";
import { say } from "./log.ts";
import { platform } from "./platform/index.ts";
import { downloadCatalogueTheme, fetchDeviceTheme, installThemeArchive, safeName } from "./themes.ts";
import { isDir, isFile, listDir, removeQuietly } from "./util.ts";
import { folderItems, unzipTo, writeZip, zipNames } from "./zip.ts";

export const DEFAULT_VERSION = "2601.0";
const RES = /^\d{3,4}x\d{3,4}$/;
const VERSION = /^\d{4}\.\d{1,2}$/;
const MAX_ASSET = 100 * 1024 * 1024;
const MAX_IMPORT = 2 * 1024 ** 3;

export type Scheme = Record<string, Record<string, string>>;

// ---------------------------------------------------------------- names and paths

function themeDir(name: unknown): string {
  if (!safeName(name)) throw new UserError("Pick a theme.");
  return path.join(ctx.themes, name);
}

async function theme(name: unknown): Promise<string> {
  const dir = themeDir(name);
  if (!(await isDir(dir))) throw new UserError(`${String(name)} is not in the themes folder.`);
  return dir;
}

async function taken(name: string, except = ""): Promise<boolean> {
  const lower = name.toLowerCase();
  return (await listDir(ctx.themes)).some((e) => e.name.toLowerCase() === lower && e.name !== except);
}

/** A path inside a theme with "/" separators; only the .designer folder may start with a dot. */
function cleanRel(rel: unknown): string {
  if (typeof rel !== "string" || !rel || rel.length > 240) throw new UserError("Unknown file.");
  const parts = rel.split("/");
  if (parts.length > 7 || parts.some((p, i) => !p || p === "." || p === ".." || /[\\\0\r\n\t]/.test(p) || (p.startsWith(".") && !(i === 0 && p === ".designer")))) {
    throw new UserError("Unknown file.");
  }
  return rel;
}

const SCHEME_FILE = /^(?:(?:\d{3,4}x\d{3,4}\/)?scheme\/[a-z0-9_]{1,40}\.ini|alternate\/[^/]{1,80}\.ini)$/i;

function schemeRel(rel: unknown): string {
  const r = cleanRel(rel);
  if (!SCHEME_FILE.test(r)) throw new UserError("Unknown scheme file.");
  return r;
}

type Kind = "png" | "bmp" | "svg" | "mp4" | "bin" | "wav" | "font" | "zip";

/** What a file at this place in a theme must be; throws for places a theme cannot hold an uploaded file. */
export function assetKind(rel: string): Kind {
  const ext = path.extname(rel).slice(1).toLowerCase();
  if (/^\.designer\/fonts\/[^/]+\.(ttf|otf|woff2?)$/i.test(rel)) return "font";
  if (rel === "assets.muxzip") return "zip";
  const r = rel.replace(/^\d{3,4}x\d{3,4}\//, "");
  if (r !== rel && /^preview(\.\d)?\.png$/i.test(r)) return "png";
  if (/^image\/(?:[^/]+\/){0,3}[^/]+\.(png|bmp|svg|mp4)$/i.test(r)) return ext as Kind;
  if (/^glyph\/(?:[^/]+\/){0,2}[^/]+\.(png|svg)$/i.test(r)) return ext as Kind;
  if (/^font\/(?:[^/]+\/)?[^/]+\.bin$/i.test(r)) return "bin";
  if (/^sound\/[^/]+\.wav$/i.test(r)) return "wav";
  throw new UserError(`${rel} is not a file a theme can hold there.`);
}

const MAGIC: Record<Kind, [string, (b: Buffer) => boolean]> = {
  png: ["a PNG picture", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  bmp: ["a BMP picture", (b) => b.subarray(0, 2).toString("latin1") === "BM"],
  svg: ["an SVG picture", (b) => /<svg[\s>]/i.test(b.subarray(0, 4096).toString("utf8"))],
  mp4: ["an MP4 video", (b) => b.subarray(4, 8).toString("latin1") === "ftyp"],
  wav: ["a WAV sound", (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WAVE"],
  font: ["a TTF, OTF or WOFF font", (b) => ["\x00\x01\x00\x00", "OTTO", "true", "wOFF", "wOF2"].includes(b.subarray(0, 4).toString("latin1"))],
  zip: ["a zip archive", (b) => b.length >= 4 && b.readUInt32LE(0) === 0x04034b50],
  bin: ["a MustardOS font", (b) => b.length > 16],
};

async function writeAtomic(file: string, data: string | Buffer): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.partial`);
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

const firstLine = async (file: string) => (await fsp.readFile(file, "utf8").catch(() => "")).split(/\r?\n/)[0].trim();
const area = (r: string) => r.split("x").map(Number).reduce((a, b) => a * b, 1);

interface ThemeFile { path: string; size: number; mtime: number }

async function walk(dir: string, rel = ""): Promise<ThemeFile[]> {
  const out: ThemeFile[] = [];
  for (const e of await listDir(path.join(dir, rel))) {
    if (e.name.startsWith(".") && !(rel === "" && e.name === ".designer")) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(dir, r)));
    else if (e.isFile()) {
      const st = await fsp.stat(path.join(dir, r));
      out.push({ path: r, size: st.size, mtime: st.mtimeMs });
    }
  }
  return out;
}

// ---------------------------------------------------------------- scheme files

export function parseIni(text: string): Scheme {
  const out: Scheme = {};
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const head = line.match(/^\[([^\]]+)\]$/);
    if (head) { section = head[1].trim().toLowerCase(); continue; }
    const eq = raw.indexOf("=");
    if (eq < 0 || !section) continue;
    const key = raw.slice(0, eq).trim().toUpperCase();
    const value = raw.slice(eq + 1);
    if (key) (out[section] ??= {})[key] = key === "COUNTER_TEXT_SEPARATOR" ? value : value.trim();
  }
  return out;
}

export function writeIni(scheme: Scheme): string {
  return Object.entries(scheme).filter(([, keys]) => Object.keys(keys).length)
    .map(([section, keys]) => `[${section}]\n${Object.entries(keys).map(([k, v]) => `${k}=${v}`).join("\n")}\n`).join("\n");
}

function cleanScheme(raw: unknown): Scheme {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new UserError("The scheme is not in the expected format.");
  const out: Scheme = {};
  for (const [section, keys] of Object.entries(raw)) {
    if (!/^[a-z_]{1,32}$/.test(section) || !keys || typeof keys !== "object") throw new UserError(`Unknown scheme section ${section}.`);
    for (const [key, v] of Object.entries(keys as Record<string, unknown>)) {
      if (!/^[A-Z0-9_]{1,64}$/.test(key)) throw new UserError(`Unknown scheme setting ${key}.`);
      const value = typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v : null;
      if (value === null || value.length > 256 || /[\r\n\0]/.test(value)) throw new UserError(`${key} has a value MustardOS cannot read.`);
      (out[section] ??= {})[key] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------- reading

async function summary(name: string) {
  const dir = path.join(ctx.themes, name);
  const files = await walk(dir);
  const res = (await listDir(dir)).filter((e) => e.isDirectory() && RES.test(e.name)).map((e) => e.name).sort((a, b) => area(a) - area(b));
  const variants = files.filter((f) => /^alternate\/[^/]+\.ini$/i.test(f.path)).map((f) => f.path.slice(10, -4)).sort();
  const preview = res.map((r) => `${r}/preview.png`).find((p) => files.some((f) => f.path === p)) ?? "";
  return {
    name, title: await firstLine(path.join(dir, "name.txt")), version: await firstLine(path.join(dir, "version.txt")),
    res, variants, preview, count: files.length, bytes: files.reduce((a, f) => a + f.size, 0),
    modified: files.reduce((a, f) => Math.max(a, f.mtime), 0),
  };
}

/** The themes folder and a summary of every theme in it. */
export async function designerJson() {
  const available = await isDir(ctx.themes);
  const themes = [];
  if (available) {
    for (const e of await listDir(ctx.themes)) if (e.isDirectory() && safeName(e.name)) themes.push(await summary(e.name));
  }
  themes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  return { folder: ctx.themes, available, themes, defaultVersion: DEFAULT_VERSION };
}

/** One theme: its details, every scheme file parsed, and the list of its other files. */
export async function designerTheme(query: URLSearchParams) {
  const name = query.get("name") ?? "";
  const dir = await theme(name);
  const files = await walk(dir);
  const schemes: Record<string, Scheme> = {};
  for (const f of files) if (SCHEME_FILE.test(f.path)) schemes[f.path] = parseIni(await fsp.readFile(path.join(dir, f.path), "utf8"));
  let fonts: Record<string, unknown> = {};
  try { fonts = JSON.parse(await fsp.readFile(path.join(dir, ".designer", "fonts.json"), "utf8")); } catch {}
  return {
    ...(await summary(name)),
    credits: (await fsp.readFile(path.join(dir, "credits.txt"), "utf8").catch(() => "")).trimEnd(),
    active: await firstLine(path.join(dir, "active.txt")),
    schemes, fonts, files: files.filter((f) => !SCHEME_FILE.test(f.path)),
  };
}

/** A file from a theme, for the preview and the asset lists. */
export async function designerFile(query: URLSearchParams) {
  const dir = await theme(query.get("name"));
  const rel = cleanRel(query.get("path"));
  const file = path.join(dir, ...rel.split("/"));
  if (!(await isFile(file))) throw new UserError("That file is not in the theme.");
  return { image: await fsp.readFile(file), name: rel };
}

// ---------------------------------------------------------------- editing

/** Writes one scheme file; an empty scheme removes the file, except a colour variant, which stays as an empty file. */
export async function saveScheme(body: Record<string, unknown>) {
  const dir = await theme(body.name);
  const rel = schemeRel(body.file);
  const scheme = cleanScheme(body.scheme);
  const file = path.join(dir, ...rel.split("/"));
  const empty = !Object.values(scheme).some((keys) => Object.keys(keys).length);
  if (empty && !rel.startsWith("alternate/")) await fsp.rm(file, { force: true });
  else await writeAtomic(file, writeIni(scheme));
  return { ok: true, file: rel };
}

/** The theme's name.txt, credits.txt, version.txt and active.txt (the colour variant it starts with). */
export async function saveMeta(body: Record<string, unknown>) {
  const name = String(body.name ?? "");
  const dir = await theme(name);
  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (title.length > 100 || /[\r\n]/.test(title)) throw new UserError("Keep the display name on one line, up to 100 characters.");
    await writeAtomic(path.join(dir, "name.txt"), `${title || name}\n`);
  }
  if (typeof body.credits === "string") {
    if (body.credits.length > 8000) throw new UserError("The credits are too long.");
    if (body.credits.trim()) await writeAtomic(path.join(dir, "credits.txt"), `${body.credits.replace(/\r\n/g, "\n").trimEnd()}\n`);
    else await fsp.rm(path.join(dir, "credits.txt"), { force: true });
  }
  if (typeof body.version === "string") {
    if (!VERSION.test(body.version)) throw new UserError("Pick the MustardOS version the theme is made for.");
    await writeAtomic(path.join(dir, "version.txt"), `${body.version}\n`);
  }
  if (typeof body.active === "string") {
    if (!body.active) await fsp.rm(path.join(dir, "active.txt"), { force: true });
    else if (!(await isFile(path.join(dir, "alternate", `${body.active}.ini`)))) throw new UserError(`There is no colour variant called ${body.active}.`);
    else await writeAtomic(path.join(dir, "active.txt"), body.active);
  }
  return designerTheme(new URLSearchParams({ name }));
}

/** Adds a screen size folder, or moves one with everything in it to the Trash. */
export async function setResolution(body: Record<string, unknown>) {
  const name = String(body.name ?? "");
  const dir = await theme(name);
  const res = String(body.res ?? "");
  if (!RES.test(res)) throw new UserError("Unknown screen size.");
  const target = path.join(dir, res);
  if (body.remove === true) {
    const left = (await listDir(dir)).filter((e) => e.isDirectory() && RES.test(e.name) && e.name !== res);
    if (!left.length) throw new UserError("A theme needs at least one screen size.");
    if (await isDir(target)) await platform.trash(target);
    say("yellow", "TRASHED", `${res} of the theme ${name}.`);
  } else {
    await fsp.mkdir(target, { recursive: true });
  }
  return designerTheme(new URLSearchParams({ name }));
}

const variantName = (v: unknown): string => {
  if (typeof v !== "string" || !/^[^/\\\0\r\n\t.][^/\\\0\r\n\t]{0,79}$/.test(v) || v.trim() !== v) throw new UserError("Give the colour variant a name without slashes.");
  return v;
};

/** Colour variants (alternate/<name>.ini): add, copy, rename, delete, or make one the variant the theme starts with. */
export async function variantAction(body: Record<string, unknown>) {
  const name = String(body.name ?? "");
  const dir = await theme(name);
  const alt = path.join(dir, "alternate");
  const v = variantName(body.variant);
  const ini = (n: string) => path.join(alt, `${n}.ini`);
  const active = await firstLine(path.join(dir, "active.txt"));
  const exists = async (n: string) => (await listDir(alt)).some((e) => e.name.toLowerCase() === `${n}.ini`.toLowerCase());
  switch (body.action) {
    case "add": {
      if (await exists(v)) throw new UserError(`There is already a variant called ${v}.`);
      const from = typeof body.copy === "string" && body.copy ? ini(variantName(body.copy)) : "";
      await writeAtomic(ini(v), from ? await fsp.readFile(from) : "");
      if (!active) await writeAtomic(path.join(dir, "active.txt"), v);
      break;
    }
    case "rename": {
      const to = variantName(body.to);
      if (to.toLowerCase() !== v.toLowerCase() && (await exists(to))) throw new UserError(`There is already a variant called ${to}.`);
      await fsp.rename(ini(v), ini(to));
      if (await isDir(path.join(alt, "rgb", v))) await fsp.rename(path.join(alt, "rgb", v), path.join(alt, "rgb", to));
      for (const ext of [".muxalt", "_bootlogo.json"]) {
        if (await isFile(path.join(alt, v + ext))) await fsp.rename(path.join(alt, v + ext), path.join(alt, to + ext));
      }
      if (active === v) await writeAtomic(path.join(dir, "active.txt"), to);
      break;
    }
    case "delete": {
      if (!(await isFile(ini(v)))) throw new UserError(`There is no variant called ${v}.`);
      await platform.trash(ini(v));
      if (await isDir(path.join(alt, "rgb", v))) await platform.trash(path.join(alt, "rgb", v));
      if (active === v) await fsp.rm(path.join(dir, "active.txt"), { force: true });
      break;
    }
    case "default":
      if (!(await isFile(ini(v)))) throw new UserError(`There is no variant called ${v}.`);
      await writeAtomic(path.join(dir, "active.txt"), v);
      break;
    default:
      throw new UserError("Unknown variant action.");
  }
  return designerTheme(new URLSearchParams({ name }));
}

/** Stores an uploaded picture, glyph, font, sound or preview at its place in the theme, checking it is the right kind. */
export async function uploadAsset(req: http.IncomingMessage, query: URLSearchParams) {
  const dir = await theme(query.get("name"));
  const rel = cleanRel(query.get("path"));
  const kind = assetKind(rel);
  const expected = Number(req.headers["content-length"] ?? NaN);
  if (expected > MAX_ASSET) throw new UserError("That file is larger than 100 MB.");
  const target = path.join(dir, ...rel.split("/"));
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const partial = path.join(path.dirname(target), `.${path.basename(target)}.partial`);
  try {
    let size = 0;
    await pipeline(req, async function* (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > MAX_ASSET) throw new UserError("That file is larger than 100 MB.");
        yield chunk;
      }
    }, fs.createWriteStream(partial));
    if (Number.isFinite(expected) && size !== expected) throw new UserError("The upload stopped early.");
    const head = Buffer.alloc(4096);
    const fd = await fsp.open(partial, "r");
    try { await fd.read(head, 0, head.length, 0); } finally { await fd.close(); }
    const [what, ok] = MAGIC[kind];
    if (!ok(head.subarray(0, Math.min(size, head.length)))) throw new UserError(`That file is not ${what}.`);
    await fsp.rename(partial, target);
    return { path: rel, size };
  } finally {
    await removeQuietly(partial);
  }
}

async function readFonts(dir: string): Promise<Record<string, unknown>> {
  try { return JSON.parse(await fsp.readFile(path.join(dir, ".designer", "fonts.json"), "utf8")); } catch { return {}; }
}

/** Moves one of the theme's files to the Trash. */
export async function removeAsset(body: Record<string, unknown>) {
  const name = String(body.name ?? "");
  const dir = await theme(name);
  const rel = cleanRel(body.path);
  assetKind(rel);
  const file = path.join(dir, ...rel.split("/"));
  if (!(await isFile(file))) throw new UserError("That file is not in the theme.");
  await platform.trash(file);
  const fonts = await readFonts(dir);
  if (rel in fonts) {
    delete fonts[rel];
    await writeAtomic(path.join(dir, ".designer", "fonts.json"), JSON.stringify(fonts, null, 2));
  }
  return designerTheme(new URLSearchParams({ name }));
}

// ---------------------------------------------------------------- fonts

const RANGES: Record<string, string> = {
  basic: "0x20-0x7E,0xA0-0xFF",
  european: "0x20-0x7E,0xA0-0xFF,0x100-0x17F,0x180-0x24F,0x1E00-0x1EFF,0x2010-0x2027,0x2030-0x205E",
  cyrillic: "0x20-0x7E,0xA0-0xFF,0x100-0x17F,0x400-0x4FF,0x2010-0x2027,0x2030-0x205E",
};
const run = promisify(execFile);

/** Converts a TTF/OTF/WOFF kept in .designer/fonts into a MustardOS .bin font with LVGL's lv_font_conv (fetched by npx). */
export async function convertFont(body: Record<string, unknown>) {
  const name = String(body.name ?? "");
  const dir = await theme(name);
  const source = cleanRel(body.source), slot = cleanRel(body.slot);
  if (assetKind(source) !== "font" || assetKind(slot) !== "bin") throw new UserError("Pick a font and where it goes.");
  if (!(await isFile(path.join(dir, source)))) throw new UserError("Upload the font first.");
  const size = Number(body.size), bpp = Number(body.bpp ?? 4), range = String(body.range ?? "european");
  if (!Number.isInteger(size) || size < 8 || size > 96) throw new UserError("Pick a font size from 8 to 96.");
  if (![1, 2, 4, 8].includes(bpp)) throw new UserError("Unknown smoothness.");
  if (!RANGES[range]) throw new UserError("Unknown character set.");
  const target = path.join(dir, ...slot.split("/"));
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const partial = path.join(path.dirname(target), `.${path.basename(target)}.partial`);
  const win = process.platform === "win32";
  const args = ["--yes", "lv_font_conv@1.5.2", "--bpp", String(bpp), "--size", String(size), "--font", path.join(dir, source),
    "-r", RANGES[range], "--format", "bin", "--no-compress", "--no-prefilter", "-o", partial];
  try {
    await run(win ? "npx.cmd" : "npx", win ? args.map((a) => `"${a}"`) : args, { timeout: 300_000, shell: win, maxBuffer: 4 * 1024 * 1024 });
    if (!(await isFile(partial))) throw new UserError("The converter made no font.");
    await fsp.rename(partial, target);
  } catch (error) {
    if (error instanceof UserError) throw error;
    const e = error as { code?: string; stderr?: string; message?: string };
    if (e.code === "ENOENT") throw new UserError("Converting fonts needs npx, which comes with Node.js and npm.");
    const detail = (e.stderr || e.message || "").trim().split("\n").filter(Boolean).pop() ?? "";
    const missing = /doesn't have any characters/i.test(e.stderr ?? "");
    throw new UserError(missing ? "The font lacks some of those characters. Pick a smaller character set." : `The font could not be converted${detail ? `: ${detail}` : "."}`);
  } finally {
    await removeQuietly(partial);
  }
  const fonts = await readFonts(dir);
  fonts[slot] = { source, size, bpp, range };
  await writeAtomic(path.join(dir, ".designer", "fonts.json"), JSON.stringify(fonts, null, 2));
  say("green", "FONT", `${path.basename(source)} at ${size} px is now ${slot} in ${name}.`);
  return designerTheme(new URLSearchParams({ name }));
}

// ---------------------------------------------------------------- whole themes

/** Picks the folder inside an archive that holds the theme when it was zipped with its own folder around it. */
async function themeRoot(file: string): Promise<string> {
  const names = (await zipNames(file)).map((n) => n.replaceAll("\\", "/")).filter((n) => !n.startsWith("__MACOSX/"));
  const atRoot = (n: string) => n === "version.txt" || n === "credits.txt" || n.startsWith("scheme/") || n.startsWith("glyph/") || RES.test(n.split("/")[0]);
  if (names.some(atRoot)) return "";
  const tops = new Set(names.map((n) => n.split("/")[0]));
  if (tops.size === 1) {
    const top = [...tops][0];
    if (names.some((n) => atRoot(n.slice(top.length + 1)))) return `${top}/`;
  }
  throw new UserError("That archive does not look like a MustardOS theme.");
}

async function unpackTheme(file: string, dest: string): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  await unzipTo(file, dest, await themeRoot(file), MAX_IMPORT);
}

async function finish(stage: string, name: string, version = DEFAULT_VERSION): Promise<void> {
  if (!(await isFile(path.join(stage, "version.txt")))) await fsp.writeFile(path.join(stage, "version.txt"), `${version}\n`);
  if (!(await isFile(path.join(stage, "name.txt")))) await fsp.writeFile(path.join(stage, "name.txt"), `${name}\n`);
}

async function newName(raw: unknown): Promise<string> {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!safeName(name)) throw new UserError("Give the theme a name without slashes, up to 100 characters (not active or override).");
  await fsp.mkdir(ctx.themes, { recursive: true });
  if (await taken(name)) throw new UserError(`There is already a theme called ${name}.`);
  return name;
}

const stageDir = () => path.join(ctx.themes, `.new-${crypto.randomBytes(4).toString("hex")}`);

async function placeStage(stage: string, name: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
    await fsp.rename(stage, path.join(ctx.themes, name));
  } catch (error) {
    await fsp.rm(stage, { recursive: true, force: true });
    throw error;
  }
}

/** A new theme: from scratch with a starter scheme, a copy of another local theme, a catalogue theme or one on the handheld. */
export async function createTheme(body: Record<string, unknown>) {
  const name = await newName(body.name);
  const stage = stageDir();
  const from = String(body.from ?? "blank");
  const version = typeof body.version === "string" && VERSION.test(body.version) ? body.version : DEFAULT_VERSION;
  await placeStage(stage, name, async () => {
    if (from === "blank") {
      const scheme = cleanScheme(body.scheme ?? {});
      const res = (Array.isArray(body.res) ? body.res : []).filter((r): r is string => typeof r === "string" && RES.test(r));
      for (const r of res.length ? res : ["640x480"]) await fsp.mkdir(path.join(stage, r), { recursive: true });
      await writeAtomic(path.join(stage, "scheme", "global.ini"), writeIni(scheme));
      const title = typeof body.title === "string" && body.title.trim() && !/[\r\n]/.test(body.title) ? body.title.trim().slice(0, 100) : name;
      await fsp.writeFile(path.join(stage, "name.txt"), `${title}\n`);
      if (typeof body.credits === "string" && body.credits.trim()) await fsp.writeFile(path.join(stage, "credits.txt"), `${body.credits.trim().slice(0, 8000)}\n`);
    } else if (from === "copy") {
      await fsp.cp(await theme(body.source), stage, { recursive: true });
      await fsp.rm(path.join(stage, "name.txt"), { force: true });
    } else if (from === "catalogue" || from === "device") {
      let file = "";
      try {
        if (from === "catalogue") file = await downloadCatalogueTheme(body.source);
        else {
          await fsp.mkdir(ctx.cacheDir, { recursive: true });
          file = path.join(ctx.cacheDir, `.theme-${process.pid}-${Date.now()}.zip`);
          await fetchDeviceTheme(body.source, file);
        }
        await unpackTheme(file, stage);
      } finally {
        if (file) await fsp.rm(file, { force: true });
      }
    } else {
      throw new UserError("Unknown starting point.");
    }
    await finish(stage, name, version);
  });
  say("green", "THEME", `Created ${name} in the themes folder.`);
  return { created: name, ...(await designerJson()) };
}

/** A .muxthm (or zip) uploaded from this computer becomes a new theme in the themes folder. */
export async function importTheme(req: http.IncomingMessage, query: URLSearchParams) {
  const name = await newName(query.get("name"));
  const expected = Number(req.headers["content-length"] ?? NaN);
  if (expected > MAX_IMPORT) throw new UserError("That archive is larger than 2 GB.");
  const stage = stageDir();
  const file = `${stage}.muxthm`;
  try {
    await pipeline(req, fs.createWriteStream(file));
    if (Number.isFinite(expected) && (await fsp.stat(file)).size !== expected) throw new UserError("The upload stopped early.");
    await placeStage(stage, name, async () => {
      await unpackTheme(file, stage);
      await finish(stage, name);
    });
  } finally {
    await removeQuietly(file);
  }
  say("green", "THEME", `Imported ${name} into the themes folder.`);
  return { created: name, ...(await designerJson()) };
}

export async function renameTheme(body: Record<string, unknown>) {
  const from = await theme(body.name);
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!safeName(to)) throw new UserError("Give the theme a name without slashes, up to 100 characters (not active or override).");
  if (await taken(to, String(body.name))) throw new UserError(`There is already a theme called ${to}.`);
  const tmp = stageDir();
  await fsp.rename(from, tmp);
  await fsp.rename(tmp, path.join(ctx.themes, to));
  return { created: to, ...(await designerJson()) };
}

export async function duplicateTheme(body: Record<string, unknown>) {
  const from = await theme(body.name);
  const to = await newName(body.to);
  const stage = stageDir();
  await placeStage(stage, to, () => fsp.cp(from, stage, { recursive: true }));
  return { created: to, ...(await designerJson()) };
}

export async function trashDesignedTheme(body: Record<string, unknown>) {
  const dir = await theme(body.name);
  await platform.trash(dir);
  say("yellow", "TRASHED", `The theme ${String(body.name)} from the themes folder.`);
  return designerJson();
}

export async function revealTheme(body: Record<string, unknown>) {
  await fsp.mkdir(ctx.themes, { recursive: true });
  platform.openUrl(body.name ? await theme(body.name) : ctx.themes);
  return { ok: true };
}

async function packTo(dir: string, file: string): Promise<void> {
  if (!(await isFile(path.join(dir, "version.txt")))) throw new UserError("Set the MustardOS version in Theme details first.");
  if (!(await listDir(dir)).some((e) => e.isDirectory() && RES.test(e.name))) throw new UserError("Add at least one screen size in Theme details first.");
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await writeZip(file, await folderItems(dir, (rel) => rel.split("/").some((p) => p.startsWith("."))));
}

/** The theme packed as a .muxthm, for saving on this computer or sharing. */
export async function packageTheme(query: URLSearchParams) {
  const name = query.get("name") ?? "";
  const dir = await theme(name);
  const file = path.join(ctx.cacheDir, `.package-${process.pid}-${Date.now()}.muxthm`);
  try {
    await packTo(dir, file);
    return { download: await fsp.readFile(file), name: `${name}.muxthm` };
  } finally {
    await removeQuietly(file);
  }
}

/** Packs the theme and installs it on the handheld in MUOS/theme, replacing a copy with the same name; applies it if asked. */
export async function installDesigned(body: Record<string, unknown>) {
  const name = String(body.name ?? "");
  const dir = await theme(name);
  const file = path.join(ctx.cacheDir, `.package-${process.pid}-${Date.now()}.muxthm`);
  try {
    await packTo(dir, file);
    return await installThemeArchive(file, name, body.apply === true);
  } finally {
    await removeQuietly(file);
  }
}
