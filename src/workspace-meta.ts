// Workspace metadata backup: manager settings, device profiles, recipe packs, MCP switches (tokens left out), idle
// jobs, the browser's library recipes and a few small caches, packed as a zip and sealed with a passphrase
// (scrypt + AES-256-GCM). Never ROMs, BIOS files, artwork or big caches. Restoring needs confirm: true.

import crypto from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import yauzl from "yauzl";
import { ctx } from "./context.ts";
import { resetProfilesCache } from "./device/profiles.ts";
import { UserError } from "./errors.ts";
import { importIdleConfig } from "./idle-jobs.ts";
import { say } from "./log.ts";
import { mcpSettings, saveMcpSettings } from "./mcp/settings.ts";
import { replacePacks } from "./recipes.ts";
import { saveSettings, settings } from "./settings.ts";
import { inside, listDir } from "./util.ts";
import { writeZip } from "./zip.ts";
import type { ZipItem } from "./zip.ts";

type Body = Record<string, unknown>;

export const META_FORMAT = "muos-manager-meta";
export const META_EXT = ".mumeta";
const MAGIC = Buffer.from("MUMETA1\0");
const SALT = 16, IV = 12, TAG = 16;
const HEADER = MAGIC.length + SALT + IV + TAG;
const MIN_PASSPHRASE = 8;
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 24 * 1024 * 1024;
const MAX_ENTRIES = 200;
const SMALL_CACHE_MAX = 1024 * 1024;
const INDEX_MAX = 256 * 1024;
const INDEX_TOTAL_MAX = 3 * 1024 * 1024;
const REDACTED = "REDACTED";

/** Small .cache files worth keeping; everything else in .cache is downloaded again or rebuilt. */
const CACHE_FILES = ["handheld-settings.json", "rom-crc.json", "checks.json"];
const INDEX_NAME = /^[\w.-]+\.json$/;

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const key = (passphrase: string, salt: Buffer) => scrypt(passphrase.normalize("NFKC"), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });

function passphraseOf(body: Body): string {
  const p = typeof body.passphrase === "string" ? body.passphrase : "";
  if (p.length < MIN_PASSPHRASE) throw new UserError(`Choose a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  return p;
}

/** Layout: magic | salt | iv | auth tag | ciphertext. The magic is authenticated too. */
export async function seal(plain: Buffer, passphrase: string): Promise<Buffer> {
  const salt = crypto.randomBytes(SALT), iv = crypto.randomBytes(IV);
  const cipher = crypto.createCipheriv("aes-256-gcm", await key(passphrase, salt), iv);
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export async function unseal(data: Buffer, passphrase: string): Promise<Buffer> {
  if (data.length < HEADER || !data.subarray(0, MAGIC.length).equals(MAGIC)) throw new UserError("That is not a manager metadata backup.");
  let at = MAGIC.length;
  const salt = data.subarray(at, at += SALT), iv = data.subarray(at, at += IV), tag = data.subarray(at, at += TAG);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", await key(passphrase, salt), iv);
    decipher.setAAD(MAGIC);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data.subarray(at)), decipher.final()]);
  } catch {
    throw new UserError("Wrong passphrase, or the backup file is damaged.");
  }
}

// ---------------------------------------------------------------- what goes in

async function readSmall(file: string, max: number): Promise<Buffer | null> {
  try {
    const st = await fsp.stat(file);
    if (!st.isFile() || st.size > max) return null;
    return await fsp.readFile(file);
  } catch { return null; }
}

const json = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");

/** Same object with every token field blanked, however many tokens a later version adds. */
function redactTokens(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /token/i.test(k) && v ? REDACTED : v]));
}

async function collect(libraryRecipes: unknown): Promise<{ items: ZipItem[]; skipped: string[] }> {
  const files = new Map<string, Buffer>();
  const skipped: string[] = [];
  const add = (name: string, data: Buffer | null, label = name) => (data ? void files.set(name, data) : void skipped.push(label));

  files.set("settings.json", json(settings()));
  add("device-profiles.json", await readSmall(path.join(ctx.cacheDir, "device-profiles.json"), 2 * 1024 * 1024));
  add("recipe-packs.json", await readSmall(path.join(ctx.cacheDir, "recipe-packs.json"), 2 * 1024 * 1024));
  add("idle-jobs.json", await readSmall(path.join(ctx.cacheDir, "idle-jobs.json"), 64 * 1024));
  try {
    files.set("mcp.json", json(redactTokens({ ...mcpSettings() })));
  } catch { skipped.push("mcp.json"); }
  if (libraryRecipes && typeof libraryRecipes === "object" && !Array.isArray(libraryRecipes)) {
    const raw = json(libraryRecipes);
    if (raw.length <= 256 * 1024) files.set("library-recipes.json", raw);
  }
  for (const name of CACHE_FILES) add(`cache/${name}`, await readSmall(path.join(ctx.cacheDir, name), SMALL_CACHE_MAX), `cache/${name} (missing or over 1 MB)`);

  let indexTotal = 0;
  const dir = path.join(ctx.cacheDir, "thumbnails");
  for (const e of (await listDir(dir)).filter((x) => x.isFile() && INDEX_NAME.test(x.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const data = await readSmall(path.join(dir, e.name), INDEX_MAX);
    if (!data || indexTotal + data.length > INDEX_TOTAL_MAX) { skipped.push(`scrape-index/${e.name}`); continue; }
    indexTotal += data.length;
    files.set(`scrape-index/${e.name}`, data);
  }

  const manifest = {
    format: META_FORMAT, version: 1, createdAt: new Date().toISOString(), platform: process.platform,
    manager: (await fsp.readFile(path.join(ctx.managerDir, "VERSION"), "utf8").catch(() => "")).trim(),
    files: [...files.keys()].sort(),
    note: "Settings, profiles, recipes and small caches only. MCP tokens are not included. No ROMs, BIOS files or artwork.",
  };
  const items: ZipItem[] = [{ name: "manifest.json", data: json(manifest) }, ...[...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, data]) => ({ name, data }))];
  return { items, skipped };
}

// ---------------------------------------------------------------- where it goes

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");

/** A path from the request: a bare name lives in the backups folder, anything else must stay inside the workspace. */
function resolveTarget(raw: unknown): string {
  const wanted = typeof raw === "string" ? raw.trim() : "";
  if (!wanted) return path.join(ctx.backups, `workspace-meta-${stamp()}${META_EXT}`);
  if (wanted.includes("\0")) throw new UserError("That path is not valid.");
  const full = path.resolve(path.isAbsolute(wanted) ? wanted : path.join(ctx.backups, wanted));
  if (full !== ctx.backups && !inside(ctx.root, full) && !inside(ctx.backups, full)) throw new UserError("Choose a file inside the workspace (the backups folder is the default).");
  return full;
}

export async function backupMeta(body: Body) {
  const passphrase = passphraseOf(body);
  let target = resolveTarget(body.path);
  const existing = await fsp.stat(target).catch(() => null);
  if (existing?.isDirectory()) target = path.join(target, `workspace-meta-${stamp()}${META_EXT}`);
  else if (existing) throw new UserError("A file with that name exists already. Pick another name.");
  if (!target.endsWith(META_EXT)) target += META_EXT;

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "muos-meta-"));
  try {
    const { items, skipped } = await collect(body.libraryRecipes);
    const zipFile = path.join(tmpDir, "meta.zip");
    await writeZip(zipFile, items);
    const sealed = await seal(await fsp.readFile(zipFile), passphrase);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const partial = `${target}.partial`;
    await fsp.writeFile(partial, sealed, { mode: 0o600 });
    await fsp.rename(partial, target);
    say("green", "BACKUP", `Saved workspace metadata (${items.length - 1} files, encrypted) to ${target}.`);
    return { ok: true, path: target, name: path.basename(target), bytes: sealed.length, files: items.map((i) => i.name).filter((n) => n !== "manifest.json"), skipped };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

/** The metadata backups in the backups folder, newest first. */
export async function metaBackupsJson() {
  const out: { name: string; bytes: number; mtime: number }[] = [];
  for (const e of await listDir(ctx.backups)) {
    if (!e.isFile() || !e.name.endsWith(META_EXT)) continue;
    const st = await fsp.stat(path.join(ctx.backups, e.name)).catch(() => null);
    if (st) out.push({ name: e.name, bytes: st.size, mtime: st.mtimeMs });
  }
  return { folder: ctx.backups, backups: out.sort((a, b) => b.mtime - a.mtime) };
}

// ---------------------------------------------------------------- restoring

const openZip = (file: string) => new Promise<yauzl.ZipFile>((resolve, reject) =>
  yauzl.open(file, { lazyEntries: true, decodeStrings: true }, (error, zip) => (error || !zip ? reject(error ?? new Error("bad zip")) : resolve(zip))));

/** Every file in the zip held in memory, with limits so a crafted archive cannot fill it. */
async function readEntries(file: string): Promise<Map<string, Buffer>> {
  const zip = await openZip(file).catch(() => { throw new UserError("The backup is damaged."); });
  const out = new Map<string, Buffer>();
  let total = 0;
  return new Promise((resolve, reject) => {
    const fail = (error: unknown) => { zip.close(); reject(error); };
    zip.on("error", fail);
    zip.on("end", () => resolve(out));
    zip.on("entry", (entry: yauzl.Entry) => {
      const name = entry.fileName.replaceAll("\\", "/");
      if (name.endsWith("/")) return zip.readEntry();
      if (out.size >= MAX_ENTRIES) return fail(new UserError("The backup has too many files."));
      total += entry.uncompressedSize;
      if (total > MAX_UNPACKED_BYTES) return fail(new UserError("The backup unpacks to more than the manager accepts."));
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) return fail(error ?? new Error("unreadable entry"));
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("error", fail);
        stream.on("end", () => { out.set(name, Buffer.concat(chunks)); zip.readEntry(); });
      });
    });
    zip.readEntry();
  });
}

function parse(data: Buffer | undefined, what: string): unknown {
  if (!data) return undefined;
  try { return JSON.parse(data.toString("utf8")); } catch { throw new UserError(`${what} in the backup is not valid JSON.`); }
}

async function writeCache(rel: string, data: Buffer, mode = 0o644): Promise<void> {
  const file = path.join(ctx.cacheDir, rel);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(`${file}.tmp`, data, { mode });
  await fsp.rename(`${file}.tmp`, file);
}

export async function restoreMeta(body: Body) {
  if (body.confirm !== true) throw new UserError("Restoring replaces your settings, device profiles and recipe packs. Confirm to continue.");
  const passphrase = passphraseOf(body);
  const wanted = String(body.file ?? body.path ?? "").trim();
  if (!wanted) throw new UserError("Choose the backup file to restore.");
  const source = resolveTarget(wanted);
  const st = await fsp.stat(source).catch(() => null);
  if (!st?.isFile()) throw new UserError("That backup file does not exist.");
  if (st.size > MAX_FILE_BYTES) throw new UserError("That file is too big to be a metadata backup.");

  const plain = await unseal(await fsp.readFile(source), passphrase);
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "muos-meta-"));
  let entries: Map<string, Buffer>;
  try {
    const zipFile = path.join(tmpDir, "meta.zip");
    await fsp.writeFile(zipFile, plain);
    entries = await readEntries(zipFile);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
  const manifest = parse(entries.get("manifest.json"), "manifest.json") as { format?: string } | undefined;
  if (manifest?.format !== META_FORMAT) throw new UserError("That is not a manager metadata backup.");

  const restored: string[] = [];
  const notes: string[] = [];

  // Validate everything that is parsed before the first write, so a bad file changes nothing.
  const savedSettings = parse(entries.get("settings.json"), "settings.json") as Record<string, unknown> | undefined;
  const profiles = parse(entries.get("device-profiles.json"), "device-profiles.json") as { profiles?: unknown } | undefined;
  if (profiles && !Array.isArray(profiles.profiles)) throw new UserError("device-profiles.json in the backup is not a profile list.");
  const packs = parse(entries.get("recipe-packs.json"), "recipe-packs.json") as { packs?: unknown } | undefined;
  if (packs && !Array.isArray(packs.packs)) throw new UserError("recipe-packs.json in the backup is not a pack list.");
  const mcp = parse(entries.get("mcp.json"), "mcp.json") as Record<string, unknown> | undefined;
  const idle = parse(entries.get("idle-jobs.json"), "idle-jobs.json");
  const libraryRecipes = parse(entries.get("library-recipes.json"), "library-recipes.json");

  if (savedSettings && typeof savedSettings === "object") {
    const prefs: Body = {};
    for (const k of ["copyArt", "openBrowser", "checkUpdates"]) if (typeof savedSettings[k] === "boolean") prefs[k] = savedSettings[k];
    await saveSettings(prefs);
    restored.push("settings");
    notes.push("Folder locations were kept as they are on this computer.");
  }
  if (profiles) {
    await writeCache("device-profiles.json", Buffer.from(`${JSON.stringify({ activeId: (profiles as { activeId?: unknown }).activeId ?? "", profiles: profiles.profiles }, null, 2)}\n`), 0o600);
    resetProfilesCache();
    restored.push("device profiles");
  }
  if (packs) {
    const n = await replacePacks(packs.packs as unknown[]);
    restored.push(`recipe packs (${n})`);
  }
  if (mcp && typeof mcp === "object") {
    const switches: Body = {};
    for (const k of ["enabled", "assistantUsesTools"]) if (typeof mcp[k] === "boolean") switches[k] = mcp[k];
    await saveMcpSettings(switches);
    restored.push("MCP switches");
    notes.push("MCP tokens are never backed up; this computer keeps its own.");
  }
  if (idle) {
    await importIdleConfig(idle);
    restored.push("idle jobs");
    notes.push("Idle jobs come back switched off; turn them on in Settings > Behaviour.");
  }
  for (const [name, data] of entries) {
    const cache = /^cache\/([\w.-]+)$/.exec(name)?.[1];
    const index = /^scrape-index\/([\w.-]+)$/.exec(name)?.[1];
    if (cache && CACHE_FILES.includes(cache)) await writeCache(cache, data);
    else if (index && INDEX_NAME.test(index)) await writeCache(path.join("thumbnails", index), data);
    else continue;
    const label = cache ? "cached check results" : "scraper file lists";
    if (!restored.includes(label)) restored.push(label);
  }
  say("green", "RESTORE", `Restored workspace metadata from ${path.basename(source)}: ${restored.join(", ") || "nothing"}.`);
  return { ok: true, restored, notes, libraryRecipes: libraryRecipes && typeof libraryRecipes === "object" ? libraryRecipes : null };
}
