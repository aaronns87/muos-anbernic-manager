// Freeware games the ScummVM team hosts (scummvm.org/games), downloaded into Roms/SCUMMVM as ".<Title>/" plus an empty
// "<Title>.scummvm", so they copy to the handheld like any other game.

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
import { SCUMMVM, scummFolder } from "./engines.ts";
import { rescanInBackground } from "./library.ts";

const BASE = "https://downloads.scummvm.org/frs/extras/";
const AGENT = { "User-Agent": "muos-anbernic-manager" };

interface FreeGame { id: string; title: string; year: number; maker: string; about: string; files: string[]; size: number }

/** Every engine here is in the handheld's ScummVM build (checked against scummvm --list-engines, 2026.1). */
const FREE: FreeGame[] = [
  { id: "sky", title: "Beneath a Steel Sky", year: 1994, maker: "Revolution Software", size: 69_377_781,
    about: "Cyberpunk adventure in a grim future city, with Dave Gibbons art. The CD version, fully voiced.", files: ["Beneath a Steel Sky/bass-cd-1.2.zip"] },
  { id: "queen", title: "Flight of the Amazon Queen", year: 1995, maker: "Interactive Binary Illusions", size: 33_744_817,
    about: "Pilot Joe King crash-lands in the Amazon in this comic 1940s adventure. The talkie version.", files: ["Flight of the Amazon Queen/FOTAQ_Talkie-1.1.zip"] },
  { id: "lure", title: "Lure of the Temptress", year: 1992, maker: "Revolution Software", size: 5_678_861,
    about: "Revolution's first game: escape a dungeon and free a town from an evil sorceress.", files: ["Lure of the Temptress/lure-1.1.zip"] },
  { id: "drascula", title: "Drascula - The Vampire Strikes Back", year: 1996, maker: "Alcachofa Soft", size: 62_269_775,
    about: "Spanish comedy adventure: rescue your girlfriend from Count Drascula. Includes the music pack.",
    files: ["Drascula_ The Vampire Strikes Back/drascula-1.0.zip", "Drascula_ The Vampire Strikes Back/drascula-audio-mp3-2.0.zip"] },
  { id: "dreamweb", title: "Dreamweb", year: 1994, maker: "Creative Reality", size: 226_067_188,
    about: "Dark top-down cyberpunk thriller for grown-ups. The UK CD version with speech.", files: ["Dreamweb/dreamweb-cd-uk-1.1.zip"] },
  { id: "soltys", title: "Soltys", year: 1995, maker: "Laboratorium Komputerowe Avalon", size: 3_484_518,
    about: "Polish fairy-tale adventure about a young man and a stolen kingdom. English version.", files: ["Soltys/soltys-en-v1.0.zip"] },
  { id: "sfinx", title: "Sfinx", year: 1994, maker: "Laboratorium Komputerowe Avalon", size: 16_549_117,
    about: "Light-hearted puzzle adventure through a fantasy kingdom. English version.", files: ["Sfinx/sfinx-en-v1.1.zip"] },
  { id: "nippon", title: "Nippon Safes Inc", year: 1992, maker: "Dynabyte", size: 1_977_894,
    about: "Three crooks, one heist: an Italian comedy adventure with switchable characters.", files: ["Nippon Safes/nippon-1.0.zip"] },
  { id: "griffon", title: "The Griffon Legend", year: 2005, maker: "Syn9", size: 9_552_316,
    about: "Small action RPG in the style of the 16-bit Zelda games.", files: ["Griffon Legend/griffon-1.0.zip"] },
  { id: "got", title: "God of Thunder", year: 1993, maker: "Adept Software", size: 1_059_686,
    about: "Top-down action puzzler starring Thor, released as freeware by its author.", files: ["God of Thunder/gotfree.zip"] },
  { id: "mysthous", title: "Mystery House", year: 1980, maker: "On-Line Systems", size: 59_353,
    about: "Sierra's very first game and the first graphic adventure, in Apple II line art.", files: ["Mystery House/MYSTHOUS.zip"] },
  { id: "outoforder", title: "Out of Order", year: 2003, maker: "Frogwares", size: 10_606_154,
    about: "Surreal SLUDGE adventure about a man stuck in a very odd hospital.", files: ["SLUDGE/outoforder.zip"] },
  { id: "frasse", title: "Frasse and the Peculiar Ladder", year: 2006, maker: "Anders Gunnarsson", size: 84_623_698,
    about: "Charming SLUDGE adventure about a boy, a ladder and a tower full of oddballs.", files: ["SLUDGE/frasse-2.03.zip"] },
  { id: "lepton", title: "Lepton's Quest", year: 2009, maker: "Pixel Pants", size: 70_652_351,
    about: "Short and funny SLUDGE adventure with hand-painted art.", files: ["SLUDGE/leptonsquest.zip"] },
  { id: "robin", title: "Robin's Rescue", year: 2008, maker: "Hungry Software", size: 14_149_282,
    about: "Batman's Robin is kidnapped; a cute SLUDGE adventure from the Adventure Game Studio scene.", files: ["SLUDGE/robinsrescue.zip"] },
  { id: "helga", title: "Helga Deep in Trouble", year: 2008, maker: "Kristian Kolblinger", size: 177_322_133,
    about: "Comedy point-and-click about a Viking girl, made with the Wintermute engine.", files: ["Wintermute/helga_deep_in_trouble.zip"] },
];

interface Task { id: string; title: string; phase: "download" | "unpack" | "done" | "failed"; done: number; total: number; error: string }
let task: Task | null = null;

const runnerPath = (title: string) => path.join(ctx.roms, SCUMMVM, `${title}.scummvm`);

export async function freeGamesJson() {
  const games = [];
  for (const g of FREE) games.push({ id: g.id, title: g.title, year: g.year, maker: g.maker, about: g.about, size: g.size, have: await isFile(runnerPath(g.title)) });
  return { games, task, source: "https://www.scummvm.org/games/" };
}

function unzip(file: string, dest: string): Promise<void> {
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

/** The folder a zip unpacked into, stepping into it when it holds a single folder and nothing else. */
async function contentRoot(dir: string): Promise<string> {
  const entries = await listDir(dir);
  return entries.length === 1 && entries[0].isDirectory() ? contentRoot(path.join(dir, entries[0].name)) : dir;
}

async function install(game: FreeGame, t: Task): Promise<void> {
  const work = path.join(ctx.cacheDir, "scummvm", `.${game.id}-${Date.now()}`);
  const stage = path.join(ctx.roms, SCUMMVM, `.${game.title}.partial`);
  const dest = path.join(ctx.roms, SCUMMVM, `.${game.title}`);
  await fsp.mkdir(work, { recursive: true });
  try {
    await fsp.rm(stage, { recursive: true, force: true });
    await fsp.mkdir(stage, { recursive: true });
    for (const [i, rel] of game.files.entries()) {
      t.phase = "download";
      const zip = path.join(work, `${i}.zip`);
      const res = await fetch(BASE + encodeURI(rel), { headers: AGENT, redirect: "follow", signal: AbortSignal.timeout(30 * 60_000) });
      if (!res.ok || !res.body) throw new UserError(`scummvm.org answered ${res.status} for ${path.basename(rel)}.`);
      const count = new Transform({ transform(chunk: Buffer, _enc, done) { t.done += chunk.length; done(null, chunk); } });
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), count, fs.createWriteStream(zip));
      t.phase = "unpack";
      const out = path.join(work, String(i));
      await unzip(zip, out);
      await fsp.rm(zip, { force: true });
      await fsp.cp(await contentRoot(out), stage, { recursive: true });
    }
    if (!(await listDir(stage)).length) throw new UserError("The download was empty.");
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.rename(stage, dest);
    await fsp.writeFile(runnerPath(game.title), "");
    say("green", "ADDED", `Roms/${SCUMMVM}/${game.title}.scummvm with its game files, from scummvm.org.`);
    rescanInBackground();
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

/** Starts downloading one free game into Roms/SCUMMVM; progress shows in freeGamesJson().task. */
export async function installFreeGame(body: Record<string, unknown>) {
  const game = FREE.find((g) => g.id === body.id);
  if (!game) throw new UserError("Unknown game.");
  if (task && (task.phase === "download" || task.phase === "unpack")) throw new UserError(`Wait for ${task.title} to finish downloading.`);
  if (await isFile(runnerPath(game.title)) || await scummFolder(SCUMMVM, game.title)) throw new UserError(`${game.title} is already in Roms/${SCUMMVM}.`);
  const t: Task = { id: game.id, title: game.title, phase: "download", done: 0, total: game.size, error: "" };
  task = t;
  install(game, t).then(() => { t.phase = "done"; }, (error: Error) => {
    t.phase = "failed";
    t.error = error.message;
    say("red", "FAILED", `${game.title}: ${error.message}`);
  });
  return freeGamesJson();
}
