// Curated legal homebrew and freeware ROMs, downloaded into the right Roms/<system>/ folder.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { say } from "../log.ts";
import { isFile, listDir } from "../util.ts";
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
}

const catalogueFile = () => path.join(ctx.managerDir, "data", "free-homebrew.json");

let freeList: FreeHb[] | null = null;

function loadCatalogue(): FreeHb[] {
  if (freeList) return freeList;
  const raw = JSON.parse(fs.readFileSync(catalogueFile(), "utf8")) as { games?: FreeHb[] };
  if (!Array.isArray(raw.games) || !raw.games.length) throw new UserError("The homebrew catalogue file is empty or invalid.");
  freeList = raw.games;
  return freeList;
}

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

export async function freeHomebrewJson() {
  const games = [];
  for (const g of loadCatalogue()) games.push({
    id: g.id, title: g.title, year: g.year, maker: g.maker, about: g.about, size: g.size,
    system: g.system, file: g.file, have: await isFile(romPath(g)),
  });
  return { games, task, note: "Freeware and legal homebrew only. Scrape box art from Artwork after download." };
}

export async function installFreeHomebrew(body: Record<string, unknown>) {
  const game = loadCatalogue().find((g) => g.id === body.id);
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
  return freeHomebrewJson();
}