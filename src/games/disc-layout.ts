// Disc sheet integrity for systems that launch from .cue / .m3u / .bin (PlayStation first).
// Orphan .bin files and incomplete cue sheets are a common cause of a black screen on launch.

import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "../context.ts";
import type { Game, Library } from "./library.ts";
import { listDir, splitName } from "../util.ts";

export type DiscState = "ok" | "bad" | "tip";
/** Real container format when it differs from the file extension (e.g. 7z named .zip). */
export type ArchiveKind = "zip" | "7z" | "rar" | "";

export interface DiscGame {
  f: string;
  p: string;
  t: string;
  x: string;
  state: DiscState;
  note: string;
  /** True when Disc layouts can run Fix / CHD convert on this row. */
  fixable?: boolean;
  /** Detected archive kind for zip/7z/rar rows. */
  archive?: ArchiveKind;
}

export interface DiscSystem {
  code: string;
  name: string;
  games: DiscGame[];
  counts: { ok: number; bad: number; tip: number };
}

/** Systems that ship a Disc layouts check in the UI (helper works for any cue-based folder). */
export const DISC_CHECK_SYSTEMS = new Set(["PS"]);

const PREFERRED = new Set(["chd", "pbp"]);
const SHEETS = new Set(["cue", "ccd", "m3u"]);
const ORPHAN = new Set(["bin", "iso", "img"]);
const ARCHIVE_EXT = new Set(["zip", "7z", "rar"]);

/** Sniff zip / 7z / rar from the first bytes. Exported for tests. */
export function sniffArchive(buf: Buffer): ArchiveKind {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)) return "zip";
  if (buf.length >= 6 && buf[0] === 0x37 && buf[1] === 0x7a && buf[2] === 0xbc && buf[3] === 0xaf && buf[4] === 0x27 && buf[5] === 0x1c) return "7z";
  if (buf.length >= 4 && buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72 && buf[3] === 0x21) return "rar";
  return "";
}

async function archiveKind(file: string, ext: string): Promise<ArchiveKind> {
  const fh = await fsp.open(file, "r").catch(() => null);
  if (!fh) return ARCHIVE_EXT.has(ext) ? (ext as ArchiveKind) : "";
  try {
    const buf = Buffer.alloc(8);
    const { bytesRead } = await fh.read(buf, 0, 8, 0);
    const kind = sniffArchive(buf.subarray(0, bytesRead));
    if (kind) return kind;
    return ARCHIVE_EXT.has(ext) ? (ext as ArchiveKind) : "";
  } finally {
    await fh.close();
  }
}

/** Basenames referenced by a .cue / .ccd / .m3u sheet. Exported for tests. */
export function sheetRefs(ext: string, text: string): string[] {
  const out: string[] = [];
  if (ext === "cue" || ext === "ccd") {
    for (const line of text.split(/\r?\n/)) {
      const q = /^\s*FILE\s+"([^"]+)"/i.exec(line);
      if (q) { out.push(q[1]); continue; }
      const u = /^\s*FILE\s+(\S+)/i.exec(line);
      if (u) out.push(u[1]);
    }
  } else if (ext === "m3u") {
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith("#")) out.push(t);
    }
  }
  return out.map((h) => path.basename(h.replaceAll("\\", "/")));
}

async function folderNames(folder: string): Promise<Set<string>> {
  const names = new Set<string>();
  for (const e of await listDir(folder)) if (e.isFile()) names.add(e.name.toLowerCase());
  return names;
}

async function judgeGame(folder: string, names: Set<string>, g: Game): Promise<DiscGame> {
  const base = { f: g.f, p: g.p, t: g.t, x: g.x };
  const ext = g.x.toLowerCase();
  const full = path.join(folder, g.f);

  if (PREFERRED.has(ext)) {
    return { ...base, state: "ok", note: ext === "chd" ? "Compressed disc image (.chd)." : "PBP package." };
  }

  if (ARCHIVE_EXT.has(ext)) {
    const kind = await archiveKind(full, ext);
    if (kind === "rar" || ext === "rar") {
      return {
        ...base, state: "bad", archive: "rar", fixable: false,
        note: "RAR archive - cores cannot boot it. Extract manually (or with unar), then use Fix if you get a .cue/.bin or .chd.",
      };
    }
    if (kind === "7z" || kind === "zip") {
      const misnamed = ext !== kind;
      return {
        ...base, state: "bad", archive: kind, fixable: true,
        note: misnamed
          ? `This file is a .${kind} archive named .${ext}. Cores cannot boot archives - use Fix to extract / convert to .chd.`
          : `Archive (.${kind}), not a playable disc. Use Fix to extract / convert to .chd.`,
      };
    }
    return {
      ...base, state: "bad", archive: "", fixable: false,
      note: "Looks like an archive extension but the contents were not recognised. Extract manually and prefer .chd / .cue.",
    };
  }

  // Mislabeled archive with a non-archive extension (rare): sniff anyway for .bin-sized dumps named oddly - skip.

  if (SHEETS.has(ext)) {
    let text: string;
    try {
      text = await fsp.readFile(full, "utf8");
    } catch {
      return { ...base, state: "bad", note: "The sheet file could not be read." };
    }
    const refs = sheetRefs(ext, text);
    if (!refs.length) {
      return { ...base, state: "bad", note: ext === "m3u" ? "The playlist is empty." : "No FILE entries in the cue sheet." };
    }
    const missing = refs.filter((r) => !names.has(r.toLowerCase()));
    if (missing.length) {
      const sample = missing.slice(0, 3).join(", ");
      return {
        ...base,
        state: "bad",
        note: missing.length === 1
          ? `Missing track file ${sample}. Without it the game often boots to a black screen.`
          : `Missing ${missing.length} track files (${sample}${missing.length > 3 ? ", ..." : ""}).`,
      };
    }
    return {
      ...base,
      state: "tip",
      fixable: ext === "cue" || ext === "m3u",
      note: "Cue sheet is complete. A .chd or .pbp copy is more reliable on handhelds.",
    };
  }

  if (ORPHAN.has(ext)) {
    const stem = splitName(g.f)[0];
    const cue = `${stem}.cue`.toLowerCase();
    const hasCue = names.has(cue) || [...names].some((n) => n.startsWith(`${stem.toLowerCase()}.`) && n.endsWith(".cue"));
    return {
      ...base,
      state: "bad",
      note: hasCue
        ? "This .bin is listed as its own game; launch the matching .cue instead (or remove the loose .bin from the list by fixing the cue)."
        : "Needs a matching .cue sheet (or use .chd / .pbp). A lone .bin usually boots to a black screen.",
    };
  }

  if (ext === "ecm") {
    return { ...base, state: "tip", note: "ECM dumps need decompressing before most cores will run them." };
  }

  // Sniff non-archive extensions that might still be a 7z/zip with a wrong name (e.g. no extension).
  try {
    const buf = Buffer.alloc(8);
    const fh = await fsp.open(full, "r");
    try {
      const { bytesRead } = await fh.read(buf, 0, 8, 0);
      const kind = sniffArchive(buf.subarray(0, bytesRead));
      if (kind === "zip" || kind === "7z") {
        return {
          ...base, state: "bad", archive: kind, fixable: true,
          note: `This file is a .${kind} archive with the wrong extension. Use Fix to extract / convert to .chd.`,
        };
      }
    } finally {
      await fh.close();
    }
  } catch { /* ignore */ }

  return { ...base, state: "ok", note: "" };
}

/** Disc-layout report for systems in DISC_CHECK_SYSTEMS that have games. */
export async function discLayoutReport(library: Library): Promise<{ systems: DiscSystem[] }> {
  const systems: DiscSystem[] = [];
  for (const sys of library.systems) {
    if (!DISC_CHECK_SYSTEMS.has(sys.code) || !sys.games.length) continue;
    const folder = path.join(ctx.roms, sys.code);
    const names = await folderNames(folder);
    const games: DiscGame[] = [];
    for (const g of sys.games) games.push(await judgeGame(folder, names, g));
    games.sort((a, b) => (a.state === "bad" ? 0 : a.state === "tip" ? 1 : 2) - (b.state === "bad" ? 0 : b.state === "tip" ? 1 : 2) || a.f.localeCompare(b.f));
    const counts = { ok: 0, bad: 0, tip: 0 };
    for (const g of games) counts[g.state]++;
    systems.push({ code: sys.code, name: sys.name, games, counts });
  }
  return { systems };
}

/** One game's disc-layout result, or null when the system is not checked. */
export async function gameDiscLayout(code: string, g: Game): Promise<DiscGame | null> {
  if (!DISC_CHECK_SYSTEMS.has(code)) return null;
  const folder = path.join(ctx.roms, code);
  const names = await folderNames(folder);
  return judgeGame(folder, names, g);
}
