// Stream a library ROM for in-browser EmulatorJS play (light systems only).

import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { inside, safePart, splitName } from "../util.ts";

/** Manager system folder → EmulatorJS core id. */
export const PLAY_CORES: Record<string, string> = {
  GB: "gb",
  GBC: "gb",
  GBA: "gba",
  FC: "nes",
  SFC: "snes",
  SMS: "segaMS",
  GG: "segaGG",
  MD: "segaMD",
  NGP: "ngp",
  WS: "ws",
  PCE: "pce",
};

const BLOCKED_EXT = new Set(["cue", "m3u", "ccd", "toc", "gdi", "chd", "iso", "bin", "img", "wav", "ogg", "mp3"]);

const OK_EXT = new Set([
  "gb", "gbc", "gba", "nes", "unf", "unif", "fds",
  "smc", "sfc", "fig", "swc",
  "sms", "gg", "md", "gen", "smd",
  "ngp", "ngc", "npc",
  "ws", "wsc",
  "pce",
  "zip", "7z",
]);

export function playCoreFor(code: string): string | "" {
  return PLAY_CORES[code] || "";
}

export function canPlayFile(code: string, file: string): boolean {
  if (!PLAY_CORES[code]) return false;
  const ext = splitName(file)[1].toLowerCase();
  if (!ext || BLOCKED_EXT.has(ext)) return false;
  return OK_EXT.has(ext);
}

function resolvePlayRom(query: URLSearchParams): { code: string; file: string; full: string } {
  const code = String(query.get("code") ?? "");
  const file = String(query.get("file") ?? "");
  if (!safePart(code) || !PLAY_CORES[code]) throw new UserError("That system cannot be played in the browser.");
  if (!file || file.includes("..") || file.includes("/") || file.includes("\\") || !safePart(file)) {
    throw new UserError("Pick a game file in the library.");
  }
  if (!canPlayFile(code, file)) throw new UserError("That file type cannot be played in the browser.");
  const full = path.join(ctx.roms, code, file);
  if (!inside(ctx.roms, full)) throw new UserError("That path is outside Roms/.");
  return { code, file, full };
}

/** EmulatorJS probes with HEAD before GET; answer size without reading the file. */
export async function playRomHead(query: URLSearchParams) {
  const { file, full } = resolvePlayRom(query);
  let size: number;
  try {
    size = (await fsp.stat(full)).size;
  } catch {
    throw new UserError(`${path.basename(path.dirname(full))}/${file} is not in Roms/.`);
  }
  if (!size) throw new UserError("That ROM file is empty.");
  return { head: { length: size, name: file, type: "application/octet-stream" } };
}

/** Resolve a playable ROM under Roms/<code>/; returns file bytes for the download helper. */
export async function playRomDownload(query: URLSearchParams) {
  const { code, file, full } = resolvePlayRom(query);
  let data: Buffer;
  try {
    data = await fsp.readFile(full);
  } catch {
    throw new UserError(`${code}/${file} is not in Roms/.`);
  }
  if (!data.length) throw new UserError("That ROM file is empty.");
  return { download: data, name: file, type: "application/octet-stream" };
}
