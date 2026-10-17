// PlayStation archive / sheet fix: inspect zip/7z, extract, optionally convert cue sets to CHD.

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { requireIdle } from "../jobs.ts";
import { say } from "../log.ts";
import { run } from "../platform/run.ts";
import { platform } from "../platform/index.ts";
import { inside, listDir, splitName } from "../util.ts";
import { unzipTo, zipNames } from "../zip.ts";
import { chdInstallHelp, probeChdman, type ChdInstall, type ChdTool } from "./chd.ts";
import { DISC_CHECK_SYSTEMS, sheetRefs, sniffArchive, type ArchiveKind } from "./disc-layout.ts";
import { rescanLibrary } from "./library.ts";

const ALLOWED = new Set(["PS"]);
const CHD_TIMEOUT = 30 * 60_000;
const EXTRACT_TIMEOUT = 30 * 60_000;
const MAX_LIST = 500;

export type FixKind = "readyChd" | "readyPbp" | "cueSet" | "orphanBin" | "unsupported" | "empty";

export interface FixTool {
  present: boolean;
  path: string;
  version: string;
}

export interface FixTools {
  chdman: ChdTool;
  p7zip: FixTool;
  install: { chdman: ChdInstall; p7zip: ChdInstall };
}

export interface MemberClass {
  kind: FixKind;
  cues: string[];
  chds: string[];
  pbps: string[];
  bins: string[];
  others: string[];
  summary: string;
}

export interface InspectResult {
  file: string;
  archive: ArchiveKind;
  members: string[];
  plan: MemberClass;
  needs: { p7zip: boolean; chdman: boolean };
  outputHint: string;
}

interface FixRun {
  running: boolean;
  started: number;
  finished: number;
  phase: string;
  current: string;
  error: string;
  written: string[];
  trashedArchive: boolean;
}

const runState: FixRun = {
  running: false, started: 0, finished: 0, phase: "", current: "", error: "", written: [], trashedArchive: false,
};

const PLAYABLE = /\.(chd|pbp|cue|bin|iso|img|ccd|m3u)$/i;
const junkName = (n: string) => n.startsWith("__MACOSX/") || /(^|\/)\.DS_Store$/i.test(n) || /(^|\/)\./.test(n.split("/").pop() || "");

function p7zipInstallHelp(osName = process.platform): ChdInstall {
  if (osName === "darwin") {
    return {
      os: "macOS",
      summary: "Install p7zip with Homebrew to unpack .7z archives (including .zip files that are actually 7z).",
      steps: [
        "In Terminal: brew install p7zip",
        "Confirm with: which 7zz || which 7z",
      ],
    };
  }
  if (osName === "win32") {
    return {
      os: "Windows",
      summary: "Install 7-Zip and put 7z.exe on your PATH.",
      steps: [
        "Install 7-Zip from https://www.7-zip.org/",
        "Add its install folder to PATH, or confirm: where 7z",
      ],
    };
  }
  return {
    os: "Linux",
    summary: "Install p7zip from your package manager.",
    steps: [
      "Debian/Ubuntu: sudo apt install p7zip-full",
      "Fedora: sudo dnf install p7zip",
      "Confirm with: which 7zz || which 7z",
    ],
  };
}

export async function probeP7zip(): Promise<FixTool> {
  for (const name of process.platform === "win32" ? ["7z", "7zz"] : ["7zz", "7z"]) {
    const lookup = process.platform === "win32" ? await run("where", [name]) : await run("which", [name]);
    const bin = lookup.code === 0 ? lookup.stdout.trim().split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "" : "";
    if (!bin) continue;
    const help = await run(bin, [], 10_000);
    const text = `${help.stdout}\n${help.stderr}`;
    const version = /\b(\d+\.\d+[^\s,]*)\b/.exec(text)?.[1] || "";
    return { present: true, path: bin, version };
  }
  return { present: false, path: "", version: "" };
}

export async function probeFixTools(): Promise<FixTools> {
  const [chdman, p7zip] = await Promise.all([probeChdman(), probeP7zip()]);
  return { chdman, p7zip, install: { chdman: chdInstallHelp(), p7zip: p7zipInstallHelp() } };
}

export async function discFixJson() {
  return { tools: await probeFixTools(), run: { ...runState } };
}

/** Classify archive member paths into a fix plan. Exported for tests. */
export function classifyMembers(rawNames: string[]): MemberClass {
  const names = rawNames
    .map((n) => n.replaceAll("\\", "/"))
    .filter((n) => n && !n.endsWith("/") && !junkName(n));
  const cues: string[] = [], chds: string[] = [], pbps: string[] = [], bins: string[] = [], others: string[] = [];
  for (const n of names) {
    const ext = splitName(n)[1].toLowerCase();
    if (ext === "cue" || ext === "ccd") cues.push(n);
    else if (ext === "chd") chds.push(n);
    else if (ext === "pbp") pbps.push(n);
    else if (ext === "bin" || ext === "iso" || ext === "img") bins.push(n);
    else if (ext === "m3u") others.push(n);
    else if (PLAYABLE.test(n)) others.push(n);
    else others.push(n);
  }
  if (!names.length) return { kind: "empty", cues, chds, pbps, bins, others, summary: "The archive is empty." };
  if (chds.length && !cues.length) {
    return { kind: "readyChd", cues, chds, pbps, bins, others, summary: `${chds.length} .chd file${chds.length === 1 ? "" : "s"} ready to place in Roms/PS.` };
  }
  if (pbps.length && !cues.length && !chds.length) {
    return { kind: "readyPbp", cues, chds, pbps, bins, others, summary: `${pbps.length} .pbp file${pbps.length === 1 ? "" : "s"} ready to place in Roms/PS.` };
  }
  if (cues.length) {
    return {
      kind: "cueSet", cues, chds, pbps, bins, others,
      summary: cues.length === 1
        ? "Complete cue/bin set - can convert to .chd when chdman is installed, or extract as-is."
        : `${cues.length} cue sheets (multi-disc) - each can become a .chd, with an .m3u playlist.`,
    };
  }
  if (bins.length) {
    return { kind: "orphanBin", cues, chds, pbps, bins, others, summary: "Track files without a .cue sheet - cannot convert automatically." };
  }
  return { kind: "unsupported", cues, chds, pbps, bins, others, summary: "No .chd, .pbp or .cue/.bin disc set found inside." };
}

async function sniffFile(file: string): Promise<ArchiveKind> {
  const fh = await fsp.open(file, "r");
  try {
    const buf = Buffer.alloc(8);
    const { bytesRead } = await fh.read(buf, 0, 8, 0);
    return sniffArchive(buf.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

async function listZipMembers(file: string): Promise<string[]> {
  const names = await zipNames(file);
  return names.filter((n) => !n.endsWith("/") && !junkName(n)).slice(0, MAX_LIST);
}

async function list7zMembers(bin: string, file: string): Promise<string[]> {
  const r = await run(bin, ["l", "-ba", "-slt", file], 120_000);
  if (r.code !== 0) throw new UserError((r.stderr || r.stdout || "7z could not list the archive.").trim().slice(0, 200));
  const names: string[] = [];
  for (const block of r.stdout.split(/\n(?=Path = )/)) {
    const pathLine = /^Path = (.+)$/m.exec(block)?.[1];
    const folder = /^Folder = \+/.test(block) || /Attributes = D/i.test(block);
    if (!pathLine || folder || junkName(pathLine)) continue;
    names.push(pathLine.replaceAll("\\", "/"));
    if (names.length >= MAX_LIST) break;
  }
  return names;
}

async function uniqueDest(folder: string, stem: string, ext: string): Promise<string> {
  const tryName = async (name: string) => {
    try { await fsp.access(path.join(folder, name)); return false; } catch { return true; }
  };
  const base = `${stem}.${ext}`;
  if (await tryName(base)) return base;
  for (let i = 2; i < 100; i++) {
    const n = `${stem} (${i}).${ext}`;
    if (await tryName(n)) return n;
  }
  throw new UserError(`Could not find a free name for ${stem}.${ext} in ${folder}.`);
}

function romFolder(code: string): string {
  if (!ALLOWED.has(code) || !DISC_CHECK_SYSTEMS.has(code)) {
    throw new UserError("Disc fix is only available for PlayStation (Roms/PS) right now.");
  }
  return path.join(ctx.roms, code);
}

function archivePath(code: string, file: string): string {
  const folder = romFolder(code);
  const base = path.basename(file);
  const full = path.join(folder, base);
  if (!inside(folder, full)) throw new UserError("That path is outside the PlayStation folder.");
  return full;
}

export async function inspectDiscArchive(body: Record<string, unknown>): Promise<InspectResult> {
  const code = String(body.code || "PS");
  const file = path.basename(String(body.file || ""));
  if (!file) throw new UserError("Pick an archive to inspect.");
  const full = archivePath(code, file);
  await fsp.access(full).catch(() => { throw new UserError(`${file} was not found in Roms/${code}.`); });

  let archive = await sniffFile(full);
  const ext = splitName(file)[1].toLowerCase();
  if (!archive && (ext === "zip" || ext === "7z" || ext === "rar")) archive = ext as ArchiveKind;
  if (archive === "rar") {
    return {
      file, archive, members: [], plan: classifyMembers([]),
      needs: { p7zip: false, chdman: false },
      outputHint: "RAR cannot be fixed automatically. Extract it, then run Fix on the .cue or .chd.",
    };
  }
  if (archive !== "zip" && archive !== "7z") {
    throw new UserError(`${file} is not a zip or 7z archive the manager can open.`);
  }

  const tools = await probeFixTools();
  let members: string[];
  if (archive === "zip") {
    try {
      members = await listZipMembers(full);
    } catch {
      // Misnamed 7z often fails yauzl - fall through to 7z if available.
      if (!tools.p7zip.present) throw new UserError("That zip could not be read. If it is really a 7z file, install p7zip (brew install p7zip) and try again.");
      members = await list7zMembers(tools.p7zip.path, full);
      archive = "7z";
    }
  } else {
    if (!tools.p7zip.present) throw new UserError("Unpacking .7z needs p7zip on your PATH. Install it, then Refresh tooling.");
    members = await list7zMembers(tools.p7zip.path, full);
  }

  const plan = classifyMembers(members);
  const stem = splitName(file)[0];
  const needs = {
    p7zip: archive === "7z",
    chdman: plan.kind === "cueSet",
  };
  const outputHint = plan.kind === "readyChd" ? `Will place ${plan.chds.length} .chd as ${stem}.chd (or similar).`
    : plan.kind === "readyPbp" ? `Will place ${plan.pbps.length} .pbp under Roms/PS.`
    : plan.kind === "cueSet" ? (plan.cues.length === 1 ? `Will produce ${stem}.chd when chdman is available, otherwise ${stem}.cue + tracks.` : `Will produce ${plan.cues.length} .chd files and an .m3u.`)
    : plan.summary;

  return { file, archive, members: members.slice(0, 40), plan, needs, outputHint };
}

async function extractZip(file: string, dest: string): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  await unzipTo(file, dest);
}

async function extract7z(bin: string, file: string, dest: string): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  const r = await run(bin, ["x", file, `-o${dest}`, "-y"], EXTRACT_TIMEOUT);
  if (r.code !== 0) throw new UserError((r.stderr || r.stdout || "7z extract failed.").trim().slice(0, 240));
}

/** If extract root has a single directory, return that directory. */
async function flattenRoot(root: string): Promise<string> {
  const entries = (await listDir(root)).filter((e) => !e.name.startsWith(".") && e.name !== "__MACOSX");
  if (entries.length === 1 && entries[0].isDirectory()) return path.join(root, entries[0].name);
  return root;
}

async function moveInto(folder: string, src: string, destName: string): Promise<string> {
  const dest = path.join(folder, destName);
  if (!inside(folder, dest)) throw new UserError("Unsafe destination.");
  await fsp.rename(src, dest).catch(async () => {
    await fsp.copyFile(src, dest);
    await fsp.unlink(src).catch(() => {});
  });
  return destName;
}

async function convertCueInPlace(chdman: string, folder: string, cueRel: string, outStem: string, destFolder: string): Promise<string> {
  const cuePath = path.join(folder, cueRel);
  const text = await fsp.readFile(cuePath, "utf8");
  const refs = sheetRefs("cue", text);
  if (!refs.length) throw new UserError(`${path.basename(cueRel)} has no FILE entries.`);
  const cueDir = path.dirname(cuePath);
  for (const ref of refs) {
    const track = path.join(cueDir, path.basename(ref));
    await fsp.access(track).catch(() => { throw new UserError(`Missing track ${ref} for ${path.basename(cueRel)}.`); });
  }
  const chdName = await uniqueDest(destFolder, outStem, "chd");
  const chdPath = path.join(destFolder, chdName);
  const result = await run(chdman, ["createcd", "-i", cuePath, "-o", chdPath, "-f"], CHD_TIMEOUT);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" ");
    throw new UserError(detail || `chdman failed for ${path.basename(cueRel)}.`);
  }
  return chdName;
}

async function copyTreeFiles(from: string, destFolder: string, relFiles: string[], stem: string): Promise<string[]> {
  const written: string[] = [];
  for (const rel of relFiles) {
    const src = path.join(from, rel);
    const ext = splitName(rel)[1].toLowerCase() || "bin";
    const name = await uniqueDest(destFolder, written.length ? `${stem} (${written.length + 1})` : stem, ext);
    // For multi-file cue sets keep original basenames when free, else unique.
    const base = path.basename(rel);
    const free = await fsp.access(path.join(destFolder, base)).then(() => false, () => true);
    const destName = free ? base : name;
    await moveInto(destFolder, src, destName);
    written.push(destName);
  }
  return written;
}

async function fixOneArchive(opts: {
  code: string; file: string; trashArchive: boolean; preferChd: boolean; tools: FixTools;
}): Promise<{ written: string[]; trashedArchive: boolean }> {
  const full = archivePath(opts.code, opts.file);
  const destFolder = romFolder(opts.code);
  const stem = splitName(opts.file)[0];
  const inspect = await inspectDiscArchive({ code: opts.code, file: opts.file });
  if (inspect.archive === "rar") throw new UserError("RAR archives cannot be fixed automatically.");
  if (inspect.plan.kind === "empty" || inspect.plan.kind === "unsupported" || inspect.plan.kind === "orphanBin") {
    throw new UserError(inspect.plan.summary);
  }
  if (inspect.archive === "7z" && !opts.tools.p7zip.present) {
    throw new UserError("Unpacking this archive needs p7zip (7zz/7z) on your PATH.");
  }

  const tmp = await fsp.mkdtemp(path.join(ctx.cacheDir || os.tmpdir(), "disc-fix-"));
  const written: string[] = [];
  try {
    runState.phase = "extract";
    runState.current = opts.file;
    if (inspect.archive === "zip") await extractZip(full, tmp);
    else await extract7z(opts.tools.p7zip.path, full, tmp);
    const root = await flattenRoot(tmp);

    if (inspect.plan.kind === "readyChd") {
      runState.phase = "place";
      for (const rel of inspect.plan.chds) {
        const src = path.join(root, rel);
        const name = await uniqueDest(destFolder, written.length ? `${stem} disc${written.length + 1}` : stem, "chd");
        runState.current = name;
        written.push(await moveInto(destFolder, src, name));
      }
    } else if (inspect.plan.kind === "readyPbp") {
      runState.phase = "place";
      for (const rel of inspect.plan.pbps) {
        const src = path.join(root, rel);
        const name = await uniqueDest(destFolder, written.length ? `${stem} (${written.length + 1})` : stem, "pbp");
        runState.current = name;
        written.push(await moveInto(destFolder, src, name));
      }
    } else if (inspect.plan.kind === "cueSet") {
      const useChd = opts.preferChd && opts.tools.chdman.present;
      if (useChd) {
        runState.phase = "convert";
        const chds: string[] = [];
        for (let i = 0; i < inspect.plan.cues.length; i++) {
          const cueRel = inspect.plan.cues[i];
          const outStem = inspect.plan.cues.length === 1 ? stem : `${stem} (Disc ${i + 1})`;
          runState.current = path.basename(cueRel);
          chds.push(await convertCueInPlace(opts.tools.chdman.path, root, cueRel, outStem, destFolder));
        }
        written.push(...chds);
        if (chds.length > 1) {
          const m3uName = await uniqueDest(destFolder, stem, "m3u");
          await fsp.writeFile(path.join(destFolder, m3uName), `${chds.join("\n")}\n`, "utf8");
          written.push(m3uName);
        }
      } else {
        runState.phase = "place";
        // Copy cue + referenced tracks + m3u for each set
        const toCopy = new Set<string>();
        for (const cueRel of inspect.plan.cues) {
          toCopy.add(cueRel);
          const text = await fsp.readFile(path.join(root, cueRel), "utf8");
          for (const ref of sheetRefs("cue", text)) {
            const beside = path.join(path.dirname(cueRel), path.basename(ref));
            toCopy.add(beside);
          }
        }
        for (const rel of inspect.members.filter((m) => m.toLowerCase().endsWith(".m3u"))) toCopy.add(rel);
        written.push(...await copyTreeFiles(root, destFolder, [...toCopy], stem));
      }
    }

    let trashedArchive = false;
    if (opts.trashArchive) {
      runState.phase = "trash";
      await platform.trash(full);
      trashedArchive = true;
    }
    return { written, trashedArchive };
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Start a background fix for one archive (or cue tip via startChdConvert separately). */
export async function startDiscFix(body: Record<string, unknown>) {
  requireIdle("Wait for the current transfer to finish before fixing discs.");
  if (runState.running) throw new UserError("A disc fix is already running.");
  const code = String(body.code || "PS");
  const file = path.basename(String(body.file || ""));
  if (!file) throw new UserError("Pick a file to fix.");
  const trashArchive = body.trashArchive !== false;
  const preferChd = body.preferChd !== false;
  const tools = await probeFixTools();

  Object.assign(runState, {
    running: true, started: Date.now(), finished: 0, phase: "start", current: file,
    error: "", written: [], trashedArchive: false,
  });
  say("cyan", "DISC", `Fixing ${file}...`);

  void (async () => {
    try {
      const result = await fixOneArchive({ code, file, trashArchive, preferChd, tools });
      runState.written = result.written;
      runState.trashedArchive = result.trashedArchive;
      await rescanLibrary();
      say("green", "DISC", `Fixed ${file} ? ${result.written.join(", ") || "done"}.`);
    } catch (error) {
      runState.error = (error as Error).message;
      say("red", "DISC", runState.error);
    } finally {
      Object.assign(runState, { running: false, finished: Date.now(), phase: "", current: "" });
    }
  })();

  return discFixJson();
}

/** Queue several archives; runs sequentially in one background job. */
export async function startDiscFixBatch(body: Record<string, unknown>) {
  requireIdle("Wait for the current transfer to finish before fixing discs.");
  if (runState.running) throw new UserError("A disc fix is already running.");
  const code = String(body.code || "PS");
  const files = Array.isArray(body.files) ? body.files.map((f) => path.basename(String(f))) : [];
  if (!files.length) throw new UserError("Pick archives to fix.");
  const trashArchive = body.trashArchive !== false;
  const preferChd = body.preferChd !== false;
  const tools = await probeFixTools();

  Object.assign(runState, {
    running: true, started: Date.now(), finished: 0, phase: "start", current: "",
    error: "", written: [], trashedArchive: false,
  });
  say("cyan", "DISC", `Fixing ${files.length} archive${files.length === 1 ? "" : "s"}...`);

  void (async () => {
    const allWritten: string[] = [];
    let anyTrash = false;
    try {
      for (const file of files) {
        runState.current = file;
        try {
          const result = await fixOneArchive({ code, file, trashArchive, preferChd, tools });
          allWritten.push(...result.written);
          if (result.trashedArchive) anyTrash = true;
        } catch (error) {
          runState.error = `${file}: ${(error as Error).message}`;
          say("yellow", "DISC", runState.error);
        }
      }
      runState.written = allWritten;
      runState.trashedArchive = anyTrash;
      await rescanLibrary();
      if (allWritten.length) say("green", "DISC", `Fixed ${allWritten.length} output file${allWritten.length === 1 ? "" : "s"}.`);
    } catch (error) {
      runState.error = (error as Error).message;
      say("red", "DISC", runState.error);
    } finally {
      Object.assign(runState, { running: false, finished: Date.now(), phase: "", current: "" });
    }
  })();

  return discFixJson();
}
