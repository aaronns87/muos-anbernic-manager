// Stream a library ROM for in-browser EmulatorJS play.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { inside, safePart, splitName } from "../util.ts";

/**
 * Manager system folder → EmulatorJS core id.
 * Keep in sync with public/js/play-browser.js.
 * No Dreamcast core in EmulatorJS; arcade ROM sets stay out.
 */
export const PLAY_CORES: Record<string, string> = {
  // Nintendo
  GB: "gb",
  GBC: "gb",
  GBA: "gba",
  FC: "nes",
  FDS: "nes",
  SFC: "snes",
  VB: "vb",
  N64: "n64",
  NDS: "nds",
  // Sega
  SMS: "segaMS",
  GG: "segaGG",
  MD: "segaMD",
  SEGA32X: "sega32x",
  MDCD: "segaCD",
  SATURN: "segaSaturn",
  // NEC / Bandai / SNK
  PCE: "pce",
  PCECD: "pce",
  WS: "ws",
  NGP: "ngp",
  // Atari
  A2600: "atari2600",
  A5200: "a5200",
  A7800: "atari7800",
  LYNX: "lynx",
  // Commodore
  C64: "c64",
  VIC20: "vic20",
  // Sony
  PS: "psx",
  PSP: "psp",
};

/** Preferred BIOS basenames under workspace bios/ (first hit wins). */
export const PLAY_BIOS: Record<string, string[]> = {
  PS: ["scph5501.bin", "scph5502.bin", "scph5500.bin", "scph1001.bin", "scph7001.bin", "scph101.bin", "PSXONPSP660.bin"],
  SATURN: ["saturn_bios.bin", "sega_101.bin", "mpr-17933.bin", "mpr-17933c.bin"],
  MDCD: ["bios_CD_U.bin", "bios_CD_E.bin", "bios_CD_J.bin"],
  PCECD: ["syscard3.pce", "syscard2.pce", "syscard1.pce", "syscard3u.pce", "syscard2u.pce"],
};

const BLOCKED_EXT = new Set(["ccd", "toc", "gdi", "img", "wav", "ogg", "mp3"]);

/** Disc / optical extensions — only for systems with an EmulatorJS disc core. */
const DISC_EXT = new Set(["chd", "iso", "cso", "pbp", "cue", "m3u"]);
const DISC_SYSTEMS = new Set(["PS", "SATURN", "MDCD", "PCECD", "PSP"]);

const OK_EXT = new Set([
  // Nintendo
  "gb", "gbc", "gba", "nes", "unf", "unif", "fds",
  "smc", "sfc", "fig", "swc",
  "vb", "vboy",
  "z64", "n64", "v64",
  "nds",
  // Sega
  "sms", "gg", "md", "gen", "smd", "32x",
  // NEC / Bandai / SNK
  "pce", "ws", "wsc", "ngp", "ngc", "npc",
  // Atari
  "a26", "a52", "a78", "lnx", "lyx",
  // Commodore
  "d64", "t64", "crt", "prg", "tap",
  // Disc / dumps / archives
  "chd", "iso", "cso", "pbp", "cue", "m3u",
  "bin", "rom", "zip", "7z",
]);

export function playCoreFor(code: string): string | "" {
  return PLAY_CORES[code] || "";
}

export function canPlayFile(code: string, file: string): boolean {
  if (!PLAY_CORES[code]) return false;
  const ext = splitName(file)[1].toLowerCase();
  if (!ext || BLOCKED_EXT.has(ext)) return false;
  if (DISC_EXT.has(ext) && !DISC_SYSTEMS.has(code)) return false;
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

/** Stream a playable ROM under Roms/<code>/ (avoids buffering large CHD/ISO in RAM). */
export async function playRomDownload(query: URLSearchParams) {
  const { code, file, full } = resolvePlayRom(query);
  let size: number;
  try {
    size = (await fsp.stat(full)).size;
  } catch {
    throw new UserError(`${code}/${file} is not in Roms/.`);
  }
  if (!size) throw new UserError("That ROM file is empty.");
  return {
    downloadStream: fs.createReadStream(full),
    name: file,
    type: "application/octet-stream",
    length: size,
  };
}

function resolveBiosFile(name: string): string {
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\") || !safePart(name)) {
    throw new UserError("Pick a BIOS file in bios/.");
  }
  const full = path.join(ctx.bios, name);
  if (!inside(ctx.bios, full)) throw new UserError("That path is outside bios/.");
  return full;
}

/** List which preferred BIOS files exist for a playable system. */
export async function playBiosList(query: URLSearchParams) {
  const code = String(query.get("code") ?? "");
  if (!safePart(code) || !PLAY_CORES[code]) throw new UserError("That system cannot be played in the browser.");
  const names = PLAY_BIOS[code] || [];
  const have: string[] = [];
  for (const name of names) {
    try {
      const st = await fsp.stat(path.join(ctx.bios, name));
      if (st.isFile() && st.size > 0) have.push(name);
    } catch { /* missing */ }
  }
  return { code, bios: have, preferred: names };
}

export async function playBiosHead(query: URLSearchParams) {
  const file = String(query.get("file") ?? "");
  const full = resolveBiosFile(file);
  let size: number;
  try {
    size = (await fsp.stat(full)).size;
  } catch {
    throw new UserError(`${file} is not in bios/.`);
  }
  if (!size) throw new UserError("That BIOS file is empty.");
  return { head: { length: size, name: file, type: "application/octet-stream" } };
}

export async function playBiosDownload(query: URLSearchParams) {
  const file = String(query.get("file") ?? "");
  const full = resolveBiosFile(file);
  let size: number;
  try {
    size = (await fsp.stat(full)).size;
  } catch {
    throw new UserError(`${file} is not in bios/.`);
  }
  if (!size) throw new UserError("That BIOS file is empty.");
  return {
    downloadStream: fs.createReadStream(full),
    name: file,
    type: "application/octet-stream",
    length: size,
  };
}
