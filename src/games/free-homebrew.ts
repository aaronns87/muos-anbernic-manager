// Curated legal homebrew and freeware ROMs, downloaded into the right Roms/<system>/ folder. The games come from
// several catalogue files (data/free-homebrew.json plus data/catalogues/*.json); each holds only legal downloads:
// freeware, public domain or open-source games hosted by their authors. Never add commercial ROM dumps.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { say } from "../log.ts";
import { isFile, listDir, safePart } from "../util.ts";
import { rescanInBackground } from "./library.ts";

const AGENT = { "User-Agent": "muos-anbernic-manager" };

interface FreeHb {
  id: string;
  title: string;
  year: number;
  maker: string;
  about: string;
  system: string;
  file: string;
  url: string;
  size: number;
  zip?: boolean;
  /** Licence of a libre or public-domain game, shown beside it. */
  license?: string;
  /** Id of the catalogue the game comes from; set when the files are loaded. */
  catalogue: string;
}

/** One catalogue file: a named set of games. */
interface Catalogue {
  id: string;
  title: string;
  description: string;
  games: FreeHb[];
}

const dataDir = () => path.join(ctx.managerDir, "data");
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** The catalogue files: the original free-homebrew.json first, then every data/catalogues/*.json by name. */
function catalogueFiles(): string[] {
  const dir = path.join(dataDir(), "catalogues");
  const extra = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".json") && !n.startsWith(".")).sort().map((n) => path.join(dir, n)) : [];
  return [path.join(dataDir(), "free-homebrew.json"), ...extra];
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** A game entry only counts when it has what a download needs: https url, plain file name, a system folder name. */
function validGame(g: Partial<FreeHb>): boolean {
  return !!(g && ID.test(text(g.id)) && text(g.title) && safePart(text(g.system)) && safePart(text(g.file))
    && !text(g.file).includes("/") && text(g.url).startsWith("https://") && typeof g.size === "number");
}

let catalogues: Catalogue[] | null = null;

function loadCatalogues(): Catalogue[] {
  if (catalogues) return catalogues;
  const found: Catalogue[] = [];
  const seen = new Set<string>();
  for (const file of catalogueFiles()) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Catalogue>;
      const id = text(raw.id) || (path.basename(file) === "free-homebrew.json" ? "free" : path.basename(file, ".json"));
      if (!ID.test(id) || found.some((c) => c.id === id)) throw new Error(`the catalogue id "${id}" is invalid or used twice`);
      const games: FreeHb[] = [];
      for (const g of Array.isArray(raw.games) ? raw.games : []) {
        if (!validGame(g) || seen.has(g.id)) {
          say("yellow", "CHECK", `${path.basename(file)}: skipped an invalid or repeated game (${text(g?.id) || "no id"}).`);
          continue;
        }
        seen.add(g.id);
        games.push({ ...g, catalogue: id });
      }
      if (!games.length) throw new Error("it has no usable games");
      found.push({ id, title: text(raw.title) || id, description: text(raw.description), games });
    } catch (error) {
      say("yellow", "CHECK", `${path.basename(file)} was not loaded: ${(error as Error).message}`);
    }
  }
  if (!found.length) throw new UserError("The homebrew catalogue files are empty or invalid.");
  catalogues = found;
  return found;
}

const allGames = (): FreeHb[] => loadCatalogues().flatMap((c) => c.games);

interface Task { id: string; title: string; phase: "download" | "unpack" | "done" | "failed"; done: number; total: number; error: string }
let task: Task | null = null;

const romPath = (game: FreeHb) => path.join(ctx.roms, game.system, game.file);

function unzipAll(file: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("Could not open the zip."));
      zip.on("error", reject);
      zip.on("end", () => resolve());
      zip.on("entry", (entry: yauzl.Entry) => {
        const name = entry.fileName.replaceAll("\\", "/");
        if (name.endsWith("/") || name.startsWith("__MACOSX/") || /(^|\/)\.DS_Store$/.test(name)) return zip.readEntry();
        const out = path.join(dest, ...name.split("/"));
        if (!out.startsWith(dest + path.sep)) return reject(new UserError("The download holds an unsafe path."));
        fsp.mkdir(path.dirname(out), { recursive: true }).then(() => zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return reject(err ?? new Error("Could not read the zip."));
          pipeline(stream, fs.createWriteStream(out)).then(() => zip.readEntry(), reject);
        }), reject);
      });
      zip.readEntry();
    });
  });
}

async function findRom(dir: string, ext: string): Promise<string> {
  const want = ext.toLowerCase();
  const walk = async (d: string): Promise<string> => {
    for (const e of await listDir(d)) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        const hit = await walk(full);
        if (hit) return hit;
      } else if (e.isFile() && e.name.toLowerCase().endsWith(want)) return full;
    }
    return "";
  };
  return walk(dir);
}

async function install(game: FreeHb, t: Task): Promise<void> {
  const dest = path.join(ctx.roms, game.system);
  const out = romPath(game);
  const work = path.join(ctx.cacheDir, "homebrew", `.${game.id}-${Date.now()}`);
  await fsp.mkdir(work, { recursive: true });
  try {
    t.phase = "download";
    const res = await fetch(game.url, { headers: AGENT, redirect: "follow", signal: AbortSignal.timeout(30 * 60_000) });
    if (!res.ok || !res.body) throw new UserError(`Download failed (${res.status}).`);
    if (game.zip) {
      const zip = path.join(work, "game.zip");
      const count = new Transform({ transform(chunk: Buffer, _enc, done) { t.done += chunk.length; done(null, chunk); } });
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), count, fs.createWriteStream(zip));
      t.phase = "unpack";
      const stage = path.join(work, "zipout");
      await fsp.mkdir(stage, { recursive: true });
      await unzipAll(zip, stage);
      const rom = await findRom(stage, path.extname(game.file));
      if (!rom) throw new UserError("The zip did not contain a ROM file.");
      await fsp.mkdir(dest, { recursive: true });
      await fsp.copyFile(rom, out);
    } else {
      await fsp.mkdir(dest, { recursive: true });
      const count = new Transform({ transform(chunk: Buffer, _enc, done) { t.done += chunk.length; done(null, chunk); } });
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), count, fs.createWriteStream(out));
    }
    say("green", "ADDED", `Roms/${game.system}/${game.file} (${game.title}).`);
    rescanInBackground();
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/** The games of one catalogue ("" or "all" is every catalogue), with which are already in Roms/. */
export async function freeHomebrewJson(catalogue?: unknown) {
  const wanted = typeof catalogue === "string" && catalogue !== "all" ? catalogue : "";
  const list = loadCatalogues();
  if (wanted && !list.some((c) => c.id === wanted)) throw new UserError(`Unknown catalogue "${wanted}". Use ${list.map((c) => c.id).join(", ")} or all.`);
  const games = [];
  for (const g of allGames()) {
    if (wanted && g.catalogue !== wanted) continue;
    games.push({
      id: g.id, title: g.title, year: g.year, maker: g.maker, about: g.about, size: g.size,
      system: g.system, file: g.file, catalogue: g.catalogue, license: g.license ?? "", have: await isFile(romPath(g)),
    });
  }
  return {
    catalogue: wanted || "all",
    catalogues: list.map((c) => ({ id: c.id, title: c.title, description: c.description, count: c.games.length })),
    games, task,
    note: "Legal downloads only: freeware, public domain and open-source games from their authors. Scrape box art from Artwork after download.",
  };
}

export async function installFreeHomebrew(body: Record<string, unknown>) {
  const game = allGames().find((g) => g.id === body.id);
  if (!game) throw new UserError("Unknown game.");
  if (task && (task.phase === "download" || task.phase === "unpack")) throw new UserError(`Wait for ${task.title} to finish downloading.`);
  if (await isFile(romPath(game))) throw new UserError(`${game.title} is already in Roms/${game.system}.`);
  await fsp.mkdir(path.join(ctx.roms, game.system), { recursive: true });
  const t: Task = { id: game.id, title: game.title, phase: "download", done: 0, total: game.size, error: "" };
  task = t;
  install(game, t).then(() => { t.phase = "done"; }, (error: Error) => {
    t.phase = "failed";
    t.error = error.message;
    say("red", "FAILED", `${game.title}: ${error.message}`);
  });
  return freeHomebrewJson(body.catalogue);
}