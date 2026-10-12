// Downloads and indexes the data behind game titles and descriptions:
// - EmulationStation's mamenames.xml, for arcade short names (alienfnt.zip) shown with their full titles;
// - the LaunchBox Games Database dump (Metadata.zip, free, no API key), refreshed after 30 days.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { SaxesParser } from "saxes";
import yauzl from "yauzl";
import { ctx } from "../context.ts";
import { dim, say } from "../log.ts";
import { INDEXED_PLATFORMS, norm } from "./systems.ts";

const NAMES_URL = "https://raw.githubusercontent.com/RetroPie/EmulationStation/master/resources/mamenames.xml";
const METADATA_URL = "https://gamesdb.launchbox-app.com/Metadata.zip";
const MAX_AGE_DAYS = 30;
const MAX_OVERVIEW = 2400;

export const namesFile = () => path.join(ctx.cacheDir, "mamenames.xml");
export const indexFile = () => path.join(ctx.cacheDir, "metadata-index.json");

export interface GameMeta {
  n: string; d: string; y: number | null; dev: string; pub: string; g: string; pl: string;
  r: number | null; rc: number; v: string; w: string; id: string;
  /** The description is the user's own, from Roms/<SYS>/Text/<stem>.txt. */
  u?: boolean;
}

export interface MameMeta {
  n: string; y: number | null; pub: string; g: string; c: string;
}

export interface MetadataIndex {
  keys: Record<string, Record<string, string>>;
  games: Record<string, GameMeta>;
  mame: Record<string, MameMeta>;
}

async function download(url: string, dest: string, showProgress: boolean): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(900_000) });
    if (!response.ok || !response.body) return false;
    const total = Number(response.headers.get("content-length") || 0);
    let received = 0, shown = -1;
    const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
    if (showProgress) {
      body.on("data", (chunk: Buffer) => {
        received += chunk.length;
        const pct = total ? Math.floor((received / total) * 100) : -1;
        if (pct !== shown && process.stdout.isTTY) {
          shown = pct;
          process.stdout.write(`\r  ${pct >= 0 ? `${pct}%` : `${Math.round(received / 1e6)} MB`} `);
        }
      });
    }
    await pipeline(body, fs.createWriteStream(`${dest}.tmp`));
    if (showProgress && process.stdout.isTTY) process.stdout.write("\r\x1b[K");
    await fsp.rename(`${dest}.tmp`, dest);
    return true;
  } catch {
    await fsp.rm(`${dest}.tmp`, { force: true });
    return false;
  }
}

export async function ensureArcadeNames(refresh: boolean): Promise<void> {
  const file = namesFile();
  const present = (await fsp.stat(file).catch(() => null))?.size;
  if (present && !refresh) return;
  dim("Downloading arcade titles...");
  const ok = await download(NAMES_URL, file, false);
  if (!ok || !(await fsp.readFile(file, "utf8").catch(() => "")).includes("<mamename>")) {
    say("yellow", "CHECK", "Could not download arcade titles. Arcade games show their file names.");
  }
}

export async function ensureDescriptions(mode: "auto" | "refresh" | "skip"): Promise<void> {
  if (mode === "skip") return;
  const st = await fsp.stat(indexFile()).catch(() => null);
  const old = st && Date.now() - st.mtimeMs > MAX_AGE_DAYS * 86_400_000;
  if (mode === "auto" && st?.size && !old) return;
  if (mode === "auto" && old) dim(`Descriptions are over ${MAX_AGE_DAYS} days old. Refreshing.`);
  const zip = path.join(ctx.cacheDir, "Metadata.zip");
  dim("Downloading game descriptions from the LaunchBox Games Database...");
  if (!(await download(METADATA_URL, zip, true))) {
    say("yellow", "CHECK", `Could not download descriptions.${st?.size ? " Using the cached ones." : ""}`);
    return;
  }
  dim("Indexing descriptions (about 30 seconds)...");
  try {
    const { games } = await buildIndex(zip, indexFile());
    dim(`${games.toLocaleString()} games indexed.`);
  } catch (error) {
    say("yellow", "CHECK", `Could not read the description download (${(error as Error).message}).`);
  } finally {
    await fsp.rm(zip, { force: true });
  }
}

/** Streams the direct children of the root element named in recordTags, as {child tag: text}. */
function readRecords(zipPath: string, entryName: string, recordTags: Set<string>, onRecord: (tag: string, record: Record<string, string>) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("Could not open the zip."));
      let found = false;
      zip.on("entry", (entry: yauzl.Entry) => {
        if (entry.fileName !== entryName) return zip.readEntry();
        found = true;
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return reject(err ?? new Error(`Could not read ${entryName}.`));
          const parser = new SaxesParser();
          const decoder = new TextDecoder();
          let depth = 0, record: Record<string, string> | null = null, tag = "", field = "", text = "";
          parser.on("opentag", (node) => {
            depth++;
            if (depth === 2 && recordTags.has(node.name)) {
              record = {};
              tag = node.name;
            } else if (depth === 3 && record) {
              field = node.name;
              text = "";
            }
          });
          parser.on("text", (t) => { if (record && depth === 3) text += t; });
          parser.on("cdata", (t) => { if (record && depth === 3) text += t; });
          parser.on("closetag", () => {
            if (depth === 3 && record) record[field] = text.trim();
            else if (depth === 2 && record) {
              onRecord(tag, record);
              record = null;
            }
            depth--;
          });
          parser.on("error", reject);
          stream.on("data", (chunk: Buffer) => parser.write(decoder.decode(chunk, { stream: true })));
          stream.on("end", () => {
            parser.close();
            zip.close();
            resolve();
          });
          stream.on("error", reject);
        });
      });
      zip.on("end", () => { if (!found) reject(new Error(`${entryName} is missing.`)); });
      zip.readEntry();
    });
  });
}

const yearOf = (text: string) => (/^\d+$/.test(text) ? Number(text) : null);

export async function buildIndex(zipPath: string, outPath: string): Promise<{ games: number; mame: number }> {
  const games: Record<string, GameMeta> = {};
  const keys: Record<string, Record<string, string>> = {};
  const alternates: [string, string][] = [];
  await readRecords(zipPath, "Metadata.xml", new Set(["Game", "GameAlternateName"]), (tag, r) => {
    if (tag === "GameAlternateName") {
      alternates.push([r.DatabaseID ?? "", r.AlternateName ?? ""]);
      return;
    }
    const platform = r.Platform ?? "";
    if (!INDEXED_PLATFORMS.has(platform)) return;
    const id = r.DatabaseID ?? "";
    let overview = r.Overview ?? "";
    if (overview.length > MAX_OVERVIEW) {
      const cut = overview.slice(0, MAX_OVERVIEW);
      overview = (cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut) + "...";
    }
    games[id] = {
      n: r.Name ?? "", d: overview, y: yearOf(r.ReleaseYear || (r.ReleaseDate ?? "").slice(0, 4)),
      dev: r.Developer ?? "", pub: r.Publisher ?? "", g: (r.Genres ?? "").replaceAll(";", ", "), pl: r.MaxPlayers ?? "",
      r: r.CommunityRating ? Math.round(Number(r.CommunityRating) * 10) / 10 : null,
      rc: Number.parseInt(r.CommunityRatingCount || "0", 10) || 0, v: r.VideoURL ?? "", w: r.WikipediaURL ?? "", id,
    };
    keys[platform] ??= {};
    keys[platform][norm(games[id].n)] ??= id;
  });
  const platformOf = new Map<string, string>();
  for (const [platform, table] of Object.entries(keys)) for (const id of Object.values(table)) platformOf.set(id, platform);
  for (const [id, name] of alternates) {
    const platform = platformOf.get(id);
    if (platform && name) keys[platform][norm(name)] ??= id;
  }
  const mame: Record<string, MameMeta> = {};
  await readRecords(zipPath, "Mame.xml", new Set(["MameFile"]), (_, r) => {
    mame[r.FileName ?? ""] = { n: r.Name ?? "", y: yearOf(r.Year ?? ""), pub: r.Publisher ?? "", g: r.Genre ?? "", c: r.CloneOf ?? "" };
  });
  const used = new Set(Object.values(keys).flatMap((table) => Object.values(table)));
  const index: MetadataIndex = { keys, games: Object.fromEntries([...used].filter((id) => games[id]).map((id) => [id, games[id]])), mame };
  await fsp.writeFile(`${outPath}.tmp`, JSON.stringify(index));
  await fsp.rename(`${outPath}.tmp`, outPath);
  return { games: Object.keys(index.games).length, mame: Object.keys(mame).length };
}

export async function loadIndex(): Promise<MetadataIndex | null> {
  try {
    return JSON.parse(await fsp.readFile(indexFile(), "utf8")) as MetadataIndex;
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? whole);

export async function loadArcadeNames(): Promise<Map<string, string>> {
  const xml = await fsp.readFile(namesFile(), "utf8").catch(() => "");
  const names = new Map<string, string>();
  for (const m of xml.matchAll(/<mamename>([\s\S]*?)<\/mamename>\s*<realname>([\s\S]*?)<\/realname>/g)) {
    names.set(unescape(m[1].trim()), unescape(m[2].trim()));
  }
  return names;
}
