// PlayStation CUE/BIN (and multi-disc M3U) ? CHD via MAME's chdman when it is on PATH.

import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { requireIdle } from "../jobs.ts";
import { say } from "../log.ts";
import { run } from "../platform/run.ts";
import { platform } from "../platform/index.ts";
import { listDir, splitName } from "../util.ts";
import { DISC_CHECK_SYSTEMS, sheetRefs, type DiscGame } from "./disc-layout.ts";
import { rescanLibrary } from "./library.ts";

const CHD_TIMEOUT = 30 * 60_000;
const ALLOWED = new Set(["PS"]);

export interface ChdTool {
  present: boolean;
  path: string;
  version: string;
}

export interface ChdInstall {
  os: string;
  summary: string;
  steps: string[];
}

interface ChdRun {
  running: boolean;
  started: number;
  finished: number;
  done: number;
  total: number;
  current: string;
  error: string;
  converted: number;
  failed: string[];
  trashed: number;
}

const runState: ChdRun = {
  running: false, started: 0, finished: 0, done: 0, total: 0, current: "", error: "",
  converted: 0, failed: [], trashed: 0,
};

/** Complete cue/m3u sheets ready for createcd (disc-layout state tip). */
export function isChdConvertible(g: Pick<DiscGame, "x" | "state">): boolean {
  const x = g.x.toLowerCase();
  return (x === "cue" || x === "m3u") && g.state === "tip";
}

/** Sheet file plus every FILE / playlist entry it names (basenames). Exported for tests. */
export function trashBasenamesForSheet(ext: string, sheetName: string, text: string): string[] {
  const names = new Set<string>([path.basename(sheetName)]);
  for (const ref of sheetRefs(ext, text)) names.add(path.basename(ref));
  return [...names];
}

export function chdInstallHelp(os = process.platform): ChdInstall {
  if (os === "darwin") {
    return {
      os: "macOS",
      summary: "Install rom-tools with Homebrew (the mame formula is only the emulator and does not include chdman).",
      steps: [
        "Install Homebrew from https://brew.sh if you do not already have it.",
        "In Terminal: brew install rom-tools",
        "Confirm with: which chdman",
      ],
    };
  }
  if (os === "win32") {
    return {
      os: "Windows",
      summary: "Install MAME and put chdman.exe on your PATH.",
      steps: [
        "Download MAME from https://www.mamedev.org/release.html and unpack it.",
        "Add that folder to your user PATH, or copy chdman.exe into a folder already on PATH.",
        "Open a new terminal and confirm with: where chdman",
      ],
    };
  }
  return {
    os: "Linux",
    summary: "Install MAME tools from your package manager (package name varies).",
    steps: [
      "Debian/Ubuntu: sudo apt install mame-tools",
      "Fedora: sudo dnf install mame-tools",
      "Arch: sudo pacman -S mame",
      "Confirm with: which chdman",
    ],
  };
}

export async function probeChdman(): Promise<ChdTool> {
  const lookup = process.platform === "win32" ? await run("where", ["chdman"]) : await run("which", ["chdman"]);
  const bin = lookup.code === 0 ? lookup.stdout.trim().split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "" : "";
  if (!bin) return { present: false, path: "", version: "" };
  const help = await run(bin, [], 15_000);
  const text = `${help.stdout}\n${help.stderr}`;
  const version = /\b(\d+\.\d+[^\s,]*)\b/.exec(text)?.[1] || "";
  return { present: true, path: bin, version };
}

export async function chdJson() {
  return { tool: await probeChdman(), install: chdInstallHelp(), run: { ...runState } };
}

async function resolveInFolder(folder: string, name: string): Promise<string | null> {
  const want = path.basename(name).toLowerCase();
  for (const e of await listDir(folder)) {
    if (e.isFile() && e.name.toLowerCase() === want) return path.join(folder, e.name);
  }
  return null;
}

async function trashNamed(folder: string, basenames: string[]): Promise<number> {
  let n = 0;
  const seen = new Set<string>();
  for (const name of basenames) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const full = await resolveInFolder(folder, name);
    if (!full) continue;
    await platform.trash(full);
    n++;
  }
  return n;
}

async function convertCue(bin: string, folder: string, cueName: string): Promise<{ chdName: string; trash: string[] }> {
  const cuePath = await resolveInFolder(folder, cueName);
  if (!cuePath) throw new UserError(`Missing cue sheet ${cueName}.`);
  const text = await fsp.readFile(cuePath, "utf8");
  const refs = sheetRefs("cue", text);
  if (!refs.length) throw new UserError(`${cueName} has no FILE entries.`);
  for (const ref of refs) {
    if (!(await resolveInFolder(folder, ref))) throw new UserError(`Missing track file ${ref} for ${cueName}.`);
  }
  const stem = splitName(path.basename(cuePath))[0];
  const chdName = `${stem}.chd`;
  const chdPath = path.join(folder, chdName);
  const result = await run(bin, ["createcd", "-i", cuePath, "-o", chdPath, "-f"], CHD_TIMEOUT);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" ");
    throw new UserError(detail || `chdman failed for ${cueName} (exit ${result.code}).`);
  }
  return { chdName, trash: trashBasenamesForSheet("cue", path.basename(cuePath), text) };
}

async function convertOne(bin: string, folder: string, fileName: string, trash: boolean): Promise<number> {
  const ext = splitName(fileName)[1].toLowerCase();
  if (ext === "cue") {
    const { trash: names } = await convertCue(bin, folder, fileName);
    return trash ? trashNamed(folder, names) : 0;
  }
  if (ext === "m3u") {
    const m3uPath = await resolveInFolder(folder, fileName);
    if (!m3uPath) throw new UserError(`Missing playlist ${fileName}.`);
    const text = await fsp.readFile(m3uPath, "utf8");
    const entries = sheetRefs("m3u", text);
    if (!entries.length) throw new UserError(`${fileName} is empty.`);
    const chdLines: string[] = [];
    const toTrash = new Set<string>([path.basename(m3uPath)]);
    for (const entry of entries) {
      const entryExt = splitName(entry)[1].toLowerCase();
      if (entryExt === "chd") {
        chdLines.push(path.basename(entry));
        continue;
      }
      if (entryExt !== "cue") throw new UserError(`${fileName} lists ${entry}; convert needs .cue (or existing .chd) lines.`);
      const { chdName, trash: names } = await convertCue(bin, folder, entry);
      chdLines.push(chdName);
      for (const n of names) toTrash.add(n);
    }
    await fsp.writeFile(m3uPath, `${chdLines.join("\n")}\n`, "utf8");
    toTrash.delete(path.basename(m3uPath));
    return trash ? trashNamed(folder, [...toTrash]) : 0;
  }
  throw new UserError(`Only .cue and .m3u sheets can be converted (${fileName}).`);
}

/** Starts a background CHD conversion for PlayStation sheets. */
export async function startChdConvert(body: Record<string, unknown>) {
  requireIdle("Wait for the current transfer to finish before converting discs.");
  if (runState.running) throw new UserError("A CHD conversion is already running.");
  const code = String(body.code || "PS");
  if (!ALLOWED.has(code) || !DISC_CHECK_SYSTEMS.has(code)) {
    throw new UserError("CHD conversion is only available for PlayStation (Roms/PS) right now.");
  }
  const files = Array.isArray(body.files) ? body.files.map((f) => path.basename(String(f))) : [];
  if (!files.length) throw new UserError("Pick the cue or m3u sheets to convert.");
  const trash = body.trash !== false;
  const tool = await probeChdman();
  if (!tool.present) throw new UserError("chdman was not found. Install MAME tools and put chdman on your PATH, then refresh.");

  const folder = path.join(ctx.roms, code);
  Object.assign(runState, {
    running: true, started: Date.now(), finished: 0, done: 0, total: files.length, current: "",
    error: "", converted: 0, failed: [], trashed: 0,
  });
  say("cyan", "CHD", `Converting ${files.length} PlayStation sheet${files.length === 1 ? "" : "s"}...`);

  void (async () => {
    try {
      for (const file of files) {
        if (!runState.running) break;
        runState.current = file;
        try {
          runState.trashed += await convertOne(tool.path, folder, file, trash);
          runState.converted++;
        } catch (error) {
          runState.failed.push(`${file}: ${(error as Error).message}`);
          runState.error = (error as Error).message;
        }
        runState.done++;
      }
      await rescanLibrary();
      if (runState.converted && !runState.failed.length) {
        say("green", "CHD", `Converted ${runState.converted} to .chd${trash ? `; moved ${runState.trashed} original file${runState.trashed === 1 ? "" : "s"} to the Trash` : ""}.`);
      } else if (runState.converted) {
        say("yellow", "CHD", `${runState.converted} converted, ${runState.failed.length} failed.`);
      } else if (runState.failed.length) {
        say("red", "CHD", runState.error || "Conversion failed.");
      }
    } catch (error) {
      runState.error = (error as Error).message;
      say("red", "CHD", runState.error);
    } finally {
      Object.assign(runState, { running: false, finished: Date.now(), current: "" });
    }
  })();

  return chdJson();
}

/** Eligible tip cue/m3u games from a disc-layout list. */
export function convertibleFromDisc(games: DiscGame[]): DiscGame[] {
  return games.filter(isChdConvertible);
}
