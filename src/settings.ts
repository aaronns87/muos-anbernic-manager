// Manager settings kept in .cache: the Roms folder, what copying does and what happens at start, plus the folder
// browser and cache upkeep behind the Settings section.

import crypto from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { activityCount, clearActivity } from "./activity.ts";
import { clearMarketCache } from "./app-market.ts";
import { checksCacheFiles, clearChecks } from "./checks.ts";
import { ctx } from "./context.ts";
import { UserError } from "./errors.ts";
import { rescanLibrary } from "./games/library.ts";
import { ensureArcadeNames, ensureDescriptions } from "./games/metadata.ts";
import { SYSTEMS } from "./games/systems.ts";
import { requireIdle } from "./jobs.ts";
import { say } from "./log.ts";
import { platform } from "./platform/index.ts";
import { clearPortCache } from "./ports.ts";
import { clearScrapeCache } from "./scrape.ts";
import { shortcutInfo } from "./shortcut.ts";
import { clearThemeCache } from "./themes.ts";
import { clearUpdateCache } from "./updates.ts";
import { isDir, listDir } from "./util.ts";
import { APP_FILE, OS_FILE } from "./workspace.ts";
import { tf2Systems } from "./system/ops.ts";

export interface Settings {
  /** Absolute path of the Roms folder; "" means Roms/ in the workspace. */
  roms: string;
  /** Absolute path of the MustardOS apps folder; "" means apps/ in the workspace. */
  apps: string;
  /** Absolute path of the MustardOS images folder; "" means os/ in the workspace. */
  os: string;
  /** Absolute path of the BIOS folder; "" means bios/ in the workspace. */
  bios: string;
  /** Absolute path of the save backups folder; "" means backups/ in the workspace. */
  backups: string;
  /** Copying games also sends their Roms/ image as box art when the device has none. */
  copyArt: boolean;
  /** Open the manager in the browser when it starts. */
  openBrowser: boolean;
  /** Look for a newer manager version on GitHub every few hours. */
  checkUpdates: boolean;
  /** "pending" from a first start with a clean cache until the setup wizard is finished. */
  wizard: "pending" | "done";
}

type Folder = "roms" | "apps" | "os" | "bios" | "backups";
const FOLDERS: Folder[] = ["roms", "apps", "os", "bios", "backups"];
const WORKSPACE_NAMES: Record<Folder, string> = { roms: "Roms", apps: "apps", os: "os", bios: "bios", backups: "backups" };
const FOLDER_NAMES: Record<Folder, string> = { roms: "Roms folder", apps: "apps folder", os: "OS images folder", bios: "BIOS folder", backups: "backups folder" };

const DEFAULTS: Settings = { roms: "", apps: "", os: "", bios: "", backups: "", copyArt: true, openBrowser: true, checkUpdates: true, wizard: "done" };
let current: Settings = { ...DEFAULTS };
const defaults: Record<Folder, string> = { roms: "", apps: "", os: "", bios: "", backups: "" };

const folderOf = (value: unknown): Folder => (FOLDERS.includes(value as Folder) ? (value as Folder) : "roms");

/** A test run with --root keeps its own file, so it never changes the settings of the real workspace. */
const settingsFile = () => path.join(ctx.cacheDir, path.resolve(ctx.managerDir, "..") === ctx.root
  ? "settings.json"
  : `settings-${crypto.createHash("sha1").update(ctx.root).digest("hex").slice(0, 12)}.json`);

export const settings = (): Readonly<Settings> => current;

/** Reads the settings and points ctx.roms, ctx.apps, ctx.os, ctx.bios and ctx.backups at the chosen folders. Call after --root is applied. */
export async function loadSettings(): Promise<void> {
  for (const f of FOLDERS) defaults[f] = ctx[f];
  const fresh = !(await listDir(ctx.cacheDir)).some((e) => !e.name.startsWith("."));
  try {
    const saved = JSON.parse(await fsp.readFile(settingsFile(), "utf8")) as Partial<Settings>;
    const text = (v: unknown) => (typeof v === "string" ? v : "");
    current = {
      roms: text(saved.roms),
      apps: text(saved.apps),
      os: text(saved.os),
      bios: text(saved.bios),
      backups: text(saved.backups),
      copyArt: saved.copyArt !== false,
      openBrowser: saved.openBrowser !== false,
      checkUpdates: saved.checkUpdates !== false,
      wizard: saved.wizard === "pending" ? "pending" : "done",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") say("yellow", "SETTINGS", `${settingsFile()} could not be read, so the defaults are used.`);
    current = { ...DEFAULTS, wizard: fresh ? "pending" : "done" };
    if (fresh) await save();
  }
  for (const f of FOLDERS) if (current[f]) ctx[f] = current[f];
}

export const firstRun = () => current.wizard === "pending";

/**
 * Creates the workspace folders that are missing: Roms (with a folder per MustardOS system when it has none yet),
 * apps, os, bios and backups. With base, the folders go there and become the chosen folders. Never touches files.
 */
export async function createWorkspace(base = ""): Promise<string[]> {
  const created: string[] = [];
  const mkdir = async (dir: string) => {
    if (await isDir(dir)) return;
    await fsp.mkdir(dir, { recursive: true });
    created.push(dir);
  };
  if (base) {
    const root = path.resolve(base.replace(/^~(?=$|\/)/, os.homedir()));
    for (const f of FOLDERS) {
      const dir = path.join(root, WORKSPACE_NAMES[f]);
      await mkdir(dir);
      const isDefault = dir === defaults[f];
      current[f] = isDefault ? "" : dir;
      ctx[f] = dir;
    }
    await save();
  } else {
    for (const f of FOLDERS) await mkdir(ctx[f]);
  }
  if (!(await systemFolders(ctx.roms))) for (const code of tf2Systems()) await mkdir(path.join(ctx.roms, code));
  return created;
}

async function save(): Promise<void> {
  await fsp.mkdir(ctx.cacheDir, { recursive: true });
  const file = settingsFile();
  await fsp.writeFile(`${file}.partial`, JSON.stringify(current, null, 2), { mode: 0o600 });
  await fsp.rename(`${file}.partial`, file);
}

const KNOWN = new Set(SYSTEMS.map(([code]) => code.toLowerCase()));

/** How many of a folder's subfolders are named like MustardOS system folders (MD, GBA, ...). */
async function systemFolders(folder: string): Promise<number> {
  return (await listDir(folder)).filter((e) => e.isDirectory() && KNOWN.has(e.name.toLowerCase())).length;
}

async function cacheUsage() {
  const sizeOf = async (p: string): Promise<number> => {
    const st = await fsp.stat(p).catch(() => null);
    if (!st) return 0;
    if (!st.isDirectory()) return st.size;
    let total = 0;
    for (const e of await listDir(p)) total += await sizeOf(path.join(p, e.name));
    return total;
  };
  const at = (name: string) => path.join(ctx.cacheDir, name);
  const total = async (paths: string[]) => (await Promise.all(paths.map(sizeOf))).reduce((a, b) => a + b, 0);
  const [descriptions, names, thumbnails, deviceArt, catalogues, checks] = await Promise.all([
    ...["metadata-index.json", "mamenames.xml", "thumbnails", "device-art"].map((name) => sizeOf(at(name))),
    total(CATALOGUES.map(at)),
    total(checksCacheFiles()),
  ]);
  return { folder: ctx.cacheDir, descriptions, names, thumbnails, deviceArt, catalogues, checks, activity: activityCount() };
}

const CATALOGUES = ["ports", "themes", "updates.json", "app-market.json", "app-market"];

/** Files directly in a folder whose lowercase name matches. */
async function filesIn(folder: string, match: RegExp): Promise<number> {
  return (await listDir(folder)).filter((e) => !e.name.startsWith(".") && !e.isDirectory() && match.test(e.name.toLowerCase())).length;
}

async function folderInfo(f: Folder) {
  const dir = ctx[f];
  return {
    path: dir,
    default: defaults[f],
    custom: !!current[f],
    available: await isDir(dir),
    count: f === "roms" ? await systemFolders(dir) : await filesIn(dir, f === "apps" ? APP_FILE : f === "os" ? OS_FILE : f === "backups" ? /\.tar\.gz$/ : /./),
  };
}

export async function settingsJson() {
  return {
    settings: current,
    roms: ctx.roms,
    defaultRoms: defaults.roms,
    available: await isDir(ctx.roms),
    systems: await systemFolders(ctx.roms),
    folders: Object.fromEntries(await Promise.all(FOLDERS.map(async (f) => [f, await folderInfo(f)]))),
    cache: await cacheUsage(),
    pickFolder: !!platform.pickFolder,
    root: ctx.root,
    wizard: current.wizard === "pending",
    shortcut: await shortcutInfo(),
    fileManager: platform.name === "macOS" ? "Finder" : platform.name === "Windows" ? "Explorer" : "the file manager",
  };
}

export async function saveSettings(body: Record<string, unknown>) {
  let rescan = false;
  const changes: [Folder, string, string][] = [];
  for (const f of FOLDERS) {
    if (body[f] === undefined) continue;
    if (f === "roms") requireIdle("Wait for the copy to finish before changing the Roms folder.");
    const value = body[f];
    const wanted = typeof value === "string" ? value.trim() : "";
    if (!wanted && f !== "roms") {
      changes.push([f, "", defaults[f]]);
      continue;
    }
    const target = wanted ? path.resolve(wanted.replace(/^~(?=$|\/)/, os.homedir())) : defaults[f];
    if (!(await isDir(target))) throw new UserError(`${target} is not a folder.`);
    const real = await fsp.realpath(target);
    const isDefault = real === (await fsp.realpath(defaults[f]).catch(() => defaults[f]));
    changes.push([f, isDefault ? "" : real, isDefault ? defaults[f] : real]);
  }
  for (const [f, stored, next] of changes) {
    if (f === "roms") rescan = ctx.roms !== next;
    else if (ctx[f] !== next) say("cyan", "SETTINGS", `The ${FOLDER_NAMES[f]} is now ${next}.`);
    current[f] = stored;
    ctx[f] = next;
  }
  if (typeof body.copyArt === "boolean") current.copyArt = body.copyArt;
  if (typeof body.openBrowser === "boolean") current.openBrowser = body.openBrowser;
  if (typeof body.checkUpdates === "boolean") current.checkUpdates = body.checkUpdates;
  if (body.wizard === "pending" || body.wizard === "done") current.wizard = body.wizard;
  await save();
  if (rescan) {
    say("cyan", "SETTINGS", `Roms folder is now ${ctx.roms}.`);
    await rescanLibrary();
  }
  return settingsJson();
}

// ---------------------------------------------------------------- folder browser

const MAC_SYSTEM_VOLUMES = new Set(["Recovery", "Preboot", "VM", "Update", "xarts", "iSCPreboot", "Hardware"]);

async function places() {
  const home = os.homedir();
  const found: { name: string; path: string; kind: string }[] = [
    { name: "Workspace", path: ctx.root, kind: "folder" },
    { name: "Workspace Roms", path: defaults.roms, kind: "roms" },
    { name: "Home", path: home, kind: "home" },
  ];
  for (const name of ["Desktop", "Documents", "Downloads"]) {
    if (await isDir(path.join(home, name))) found.push({ name, path: path.join(home, name), kind: "folder" });
  }
  if (process.platform === "darwin") {
    for (const e of await listDir("/Volumes")) {
      const p = path.join("/Volumes", e.name);
      if (e.name.startsWith(".") || MAC_SYSTEM_VOLUMES.has(e.name) || (await fsp.realpath(p).catch(() => p)) === "/") continue;
      found.push({ name: e.name, path: p, kind: "drive" });
    }
  } else if (process.platform === "win32") {
    for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
      if (await isDir(`${letter}:\\`)) found.push({ name: `${letter}:`, path: `${letter}:\\`, kind: "drive" });
    }
  } else {
    const user = os.userInfo().username;
    for (const base of [`/media/${user}`, `/run/media/${user}`, "/mnt"]) {
      for (const e of await listDir(base)) if (e.isDirectory()) found.push({ name: e.name, path: path.join(base, e.name), kind: "drive" });
    }
  }
  return found;
}

/** One folder's subfolders for the browser; hidden folders are left out. */
export async function browseFolders(query: URLSearchParams) {
  const wanted = query.get("path") || ctx.roms;
  let folder = path.resolve(wanted.replace(/^~(?=$|\/)/, os.homedir()));
  if (!(await isDir(folder))) folder = os.homedir();
  const dirs = [];
  let apps = 0, images = 0;
  for (const e of await listDir(folder)) {
    if (e.name.startsWith(".") || e.name.startsWith("$")) continue;
    const full = path.join(folder, e.name);
    if (e.isDirectory() || (e.isSymbolicLink() && (await isDir(full)))) dirs.push({ name: e.name, path: full, system: KNOWN.has(e.name.toLowerCase()) });
    else if (APP_FILE.test(e.name.toLowerCase())) apps++;
    if (!e.isDirectory() && OS_FILE.test(e.name.toLowerCase())) images++;
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  const parent = path.dirname(folder);
  return {
    path: folder, parent: parent === folder ? "" : parent, sep: path.sep,
    dirs, systems: dirs.filter((d) => d.system).length, apps, images, places: await places(),
  };
}

export async function pickFolder(body: Record<string, unknown>) {
  if (!platform.pickFolder) throw new UserError("This system has no folder picker; use the browser below.");
  const f = folderOf(body.which);
  return { path: await platform.pickFolder(`Choose the ${FOLDER_NAMES[f]}`, ctx[f]) };
}

export async function revealFolder(body: Record<string, unknown>) {
  const f = folderOf(body.which);
  if (!(await isDir(ctx[f]))) throw new UserError(`${ctx[f]} does not exist.`);
  platform.openUrl(ctx[f]);
  return { ok: true };
}

// ---------------------------------------------------------------- data and cache

let refreshing = "";

export async function refreshData(body: Record<string, unknown>) {
  const what = String(body.what ?? "");
  if (refreshing) throw new UserError("Already downloading. Wait for it to finish.");
  if (what !== "names" && what !== "descriptions" && what !== "rescan") throw new UserError("Unknown refresh.");
  refreshing = what;
  try {
    if (what === "names") await ensureArcadeNames(true);
    if (what === "descriptions") await ensureDescriptions("refresh");
    await rescanLibrary();
  } finally {
    refreshing = "";
  }
  return settingsJson();
}

export async function clearCache(body: Record<string, unknown>) {
  const what = String(body.what ?? "");
  if (what === "thumbnails") {
    clearScrapeCache();
    await fsp.rm(path.join(ctx.cacheDir, "thumbnails"), { recursive: true, force: true });
  } else if (what === "deviceArt") {
    await fsp.rm(path.join(ctx.cacheDir, "device-art"), { recursive: true, force: true });
  } else if (what === "catalogues") {
    await clearPortCache();
    await clearThemeCache();
    await clearUpdateCache();
    await clearMarketCache();
  } else if (what === "checks") {
    await clearChecks();
  } else if (what === "activity") {
    const n = await clearActivity();
    say("cyan", "CLEARED", `Activity log (${n} entr${n === 1 ? "y" : "ies"}).`);
    return settingsJson();
  } else {
    throw new UserError("Unknown cache.");
  }
  const LABELS: Record<string, string> = {
    thumbnails: "Scraper thumbnail lists.", deviceArt: "Device artwork previews.",
    catalogues: "PortMaster, app market, theme and update lists with their previews.", checks: "ROM check results and checksums.",
  };
  say("cyan", "CLEARED", LABELS[what]);
  return settingsJson();
}
