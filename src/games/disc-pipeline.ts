// Queued disc pipeline: fix archives -> convert to CHD -> write .m3u playlists -> verify, one progress entry.
// Each step reuses the existing tool (disc-fix, chd, disc-m3u, checks) and waits for it to finish. Stop takes
// effect between steps; a stopped or failed pipeline resumes from the step that did not finish.

import fsp from "node:fs/promises";
import path from "node:path";
import { DATS, startVerify, verifyRunning } from "../checks.ts";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { requireIdle } from "../jobs.ts";
import { say } from "../log.ts";
import { safePart, splitName } from "../util.ts";
import { chdJson, startChdConvert } from "./chd.ts";
import { discFixJson, inspectDiscArchive, startDiscFix, startDiscFixBatch } from "./disc-fix.ts";
import { sheetRefs } from "./disc-layout.ts";
import { discSetStem, groupsForSystem, writeM3uPlaylist } from "./disc-m3u.ts";
import { getLibrary } from "./library.ts";

export type PipelineStepId = "fix" | "chd" | "m3u" | "verify";
export type PipelineStepState = "pending" | "running" | "done" | "skipped" | "failed";
export type PipelineState = "idle" | "running" | "paused" | "failed" | "done" | "cancelled";

export interface PipelineItem {
  code: string;
  file: string;
}

export interface PipelineOptions {
  trashArchive: boolean;
  preferChd: boolean;
  trash: boolean;
  m3u: boolean;
  verify: boolean;
}

interface PipelineStep {
  id: PipelineStepId;
  label: string;
  state: PipelineStepState;
  detail: string;
}

interface Pipeline {
  id: number;
  state: PipelineState;
  items: PipelineItem[];
  options: PipelineOptions;
  steps: PipelineStep[];
  current: PipelineStepId | "";
  error: string;
  stopRequested: boolean;
  /** Per folder: the files this pipeline has produced or was given, used to pick playlists and verify targets. */
  touched: Map<string, string[]>;
  started: number;
  finished: number;
}

interface StepOutcome {
  skipped?: boolean;
  detail: string;
}

const LABELS: Record<PipelineStepId, string> = {
  fix: "Fix archives", chd: "Convert to CHD", m3u: "Write playlists", verify: "Verify",
};
const ARCHIVE = new Set(["zip", "7z", "rar"]);
const WAIT_LIMIT = 3 * 60 * 60_000;

/** Tool entry points; tests replace these so no real archive, chdman or hashing is needed. */
export const pipelineDeps = {
  inspect: inspectDiscArchive,
  fixOne: startDiscFix,
  fixMany: startDiscFixBatch,
  fixStatus: discFixJson,
  chdStart: startChdConvert,
  chdStatus: chdJson,
  m3uWrite: writeM3uPlaylist,
  verifyStart: startVerify,
  verifyRunning,
  poll: 250,
};

let pipeline: Pipeline | null = null;
let nextId = 1;
let active: Promise<void> = Promise.resolve();

const ext = (file: string) => splitName(file)[1].toLowerCase();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(done: () => boolean | Promise<boolean>): Promise<void> {
  const until = Date.now() + WAIT_LIMIT;
  while (Date.now() < until) {
    await sleep(pipelineDeps.poll);
    if (await done()) return;
  }
  throw new UserError("A disc step took too long. Check the tool, then resume.");
}

async function exists(code: string, file: string): Promise<boolean> {
  return fsp.access(path.join(ctx.roms, code, file)).then(() => true, () => false);
}

function touch(p: Pipeline, code: string, files: string[]): void {
  const list = p.touched.get(code) ?? [];
  for (const f of files) if (!list.includes(f)) list.push(f);
  p.touched.set(code, list);
}

/** Accepts {code, file}, {code, files}, or {items: [{code, file}]}. Exported for tests. */
export function parsePipelineItems(body: Record<string, unknown>): PipelineItem[] {
  const raw: { code?: unknown; file?: unknown }[] = [];
  const defaultCode = body.code === undefined ? "PS" : body.code;
  if (Array.isArray(body.items)) raw.push(...body.items.map((i) => (i && typeof i === "object" ? i : {})));
  if (body.file !== undefined) raw.push({ code: defaultCode, file: body.file });
  if (Array.isArray(body.files)) raw.push(...body.files.map((file) => ({ code: defaultCode, file })));
  const seen = new Set<string>();
  const out: PipelineItem[] = [];
  for (const r of raw) {
    const code = String(r.code ?? defaultCode);
    const file = path.basename(String(r.file ?? ""));
    if (!safePart(code) || !safePart(file)) continue;
    const key = `${code}/${file}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code, file });
  }
  if (!out.length) throw new UserError("Pick at least one disc game for the pipeline.");
  return out;
}

// ---------------------------------------------------------------- steps

async function stepFix(p: Pipeline): Promise<StepOutcome> {
  let produced = 0;
  const notes: string[] = [];
  for (const code of new Set(p.items.map((i) => i.code))) {
    const files: string[] = [];
    for (const item of p.items.filter((i) => i.code === code && ARCHIVE.has(ext(i.file)))) {
      if (!(await exists(code, item.file))) continue;
      try {
        const info = await pipelineDeps.inspect({ code, file: item.file });
        if (info.archive === "rar" || info.plan.kind === "unsupported" || info.plan.kind === "empty") {
          notes.push(`${item.file}: ${info.outputHint || info.plan.summary}`);
          continue;
        }
        files.push(item.file);
      } catch (error) {
        notes.push(`${item.file}: ${(error as Error).message}`);
      }
    }
    if (!files.length) continue;
    const opts = { code, trashArchive: p.options.trashArchive, preferChd: p.options.preferChd };
    if (files.length === 1) await pipelineDeps.fixOne({ ...opts, file: files[0] });
    else await pipelineDeps.fixMany({ ...opts, files });
    await waitFor(async () => !(await pipelineDeps.fixStatus()).run.running);
    const run = (await pipelineDeps.fixStatus()).run;
    if (!run.written.length) throw new UserError(run.error || `Fixing the archives in ${code} produced no files.`);
    touch(p, code, run.written.map((w) => path.basename(w)));
    produced += run.written.length;
    if (run.error) notes.push(run.error);
  }
  if (!produced) return { skipped: true, detail: notes[0] || "No zip or 7z archives to fix." };
  return { detail: `${produced} file${produced === 1 ? "" : "s"} written${notes.length ? `; ${notes[0]}` : ""}` };
}

async function chdCandidates(p: Pipeline, code: string): Promise<string[]> {
  const out: string[] = [];
  for (const file of p.touched.get(code) ?? []) {
    const kind = ext(file);
    if ((kind !== "cue" && kind !== "m3u") || !(await exists(code, file))) continue;
    if (kind === "m3u") {
      const text = await fsp.readFile(path.join(ctx.roms, code, file), "utf8").catch(() => "");
      if (!sheetRefs("m3u", text).some((r) => ext(r) === "cue")) continue;
    }
    out.push(file);
  }
  return out;
}

async function stepChd(p: Pipeline): Promise<StepOutcome> {
  const files = await chdCandidates(p, "PS");
  if (!files.length) return { skipped: true, detail: "No .cue or .m3u sheets left to convert." };
  const tool = (await pipelineDeps.chdStatus()).tool;
  if (!tool.present) return { skipped: true, detail: "chdman was not found, so the sheets stay as they are." };
  await pipelineDeps.chdStart({ code: "PS", files, trash: p.options.trash });
  await waitFor(async () => !(await pipelineDeps.chdStatus()).run.running);
  const run = (await pipelineDeps.chdStatus()).run;
  if (!run.converted && run.failed.length) throw new UserError(run.failed[0]);
  touch(p, "PS", files.filter((f) => ext(f) === "cue").map((f) => `${splitName(f)[0]}.chd`));
  return { detail: `${run.converted} converted${run.failed.length ? `, ${run.failed.length} failed: ${run.failed[0]}` : ""}` };
}

async function stepM3u(p: Pipeline): Promise<StepOutcome> {
  const library = await getLibrary();
  const names: string[] = [];
  const failed: string[] = [];
  for (const [code, files] of p.touched) {
    const system = library.systems.find((s) => s.code === code);
    if (!system) continue;
    const lower = new Set(files.map((f) => f.toLowerCase()));
    const stems = new Set(files.map((f) => discSetStem({ f, t: "" }).toLowerCase()));
    for (const group of await groupsForSystem(code, system.games)) {
      if (group.covered) continue;
      const mine = group.discs.some((d) => lower.has(d.f.toLowerCase()) || stems.has(discSetStem({ f: d.f, t: d.t }).toLowerCase()));
      if (!mine) continue;
      try {
        names.push((await pipelineDeps.m3uWrite({ code, group: group.id, overwrite: false })).m3uName);
      } catch (error) {
        failed.push(`${group.title}: ${(error as Error).message}`);
      }
    }
  }
  if (!names.length && failed.length) throw new UserError(failed[0]);
  if (!names.length) return { skipped: true, detail: "No multi-disc set needs a playlist." };
  return { detail: `${names.length} playlist${names.length === 1 ? "" : "s"}${failed.length ? `, ${failed.length} failed: ${failed[0]}` : ""}` };
}

async function stepVerify(p: Pipeline): Promise<StepOutcome> {
  const systems = [...p.touched.keys()].filter((code) => DATS[code]);
  if (!systems.length) return { skipped: true, detail: "No-Intro has no list for these folders, so nothing to verify." };
  await pipelineDeps.verifyStart({ systems });
  await waitFor(() => !pipelineDeps.verifyRunning());
  return { detail: `Checked ${systems.join(", ")}. See Verify for the results.` };
}

const RUNNERS: Record<PipelineStepId, (p: Pipeline) => Promise<StepOutcome>> = {
  fix: stepFix, chd: stepChd, m3u: stepM3u, verify: stepVerify,
};

// ---------------------------------------------------------------- run control

async function execute(p: Pipeline): Promise<void> {
  p.state = "running";
  p.stopRequested = false;
  p.error = "";
  p.finished = 0;
  for (const step of p.steps) {
    if (step.state === "done" || step.state === "skipped") continue;
    if (p.stopRequested) {
      p.state = "paused";
      p.current = "";
      say("yellow", "DISC", `Disc pipeline stopped before "${step.label}". Resume to continue.`);
      return;
    }
    step.state = "running";
    step.detail = "";
    p.current = step.id;
    try {
      const out = await RUNNERS[step.id](p);
      step.state = out.skipped ? "skipped" : "done";
      step.detail = out.detail;
    } catch (error) {
      step.state = "failed";
      step.detail = (error as Error).message;
      p.error = step.detail;
      p.state = "failed";
      p.current = "";
      p.finished = Date.now();
      say("red", "DISC", `Disc pipeline: ${step.label} failed. ${step.detail}`);
      return;
    }
  }
  p.state = "done";
  p.current = "";
  p.finished = Date.now();
  say("green", "DISC", "Disc pipeline finished.");
}

function launch(p: Pipeline): void {
  active = execute(p).catch((error) => {
    p.state = "failed";
    p.error = (error as Error).message;
    p.current = "";
    p.finished = Date.now();
  });
}

export function discPipelineJson() {
  const p = pipeline;
  if (!p) return { id: 0, state: "idle" as PipelineState, items: [], steps: [], current: "", error: "", cancelling: false, resumable: false, started: 0, finished: 0 };
  return {
    id: p.id, state: p.state, items: p.items, options: p.options, steps: p.steps.map((s) => ({ ...s })), current: p.current,
    error: p.error, cancelling: p.state === "running" && p.stopRequested, resumable: p.state === "paused" || p.state === "failed",
    started: p.started, finished: p.finished,
  };
}

export async function startDiscPipeline(body: Record<string, unknown>) {
  if (pipeline?.state === "running") throw new UserError("A disc pipeline is already running.");
  requireIdle("Wait for the current transfer to finish before running the disc pipeline.");
  const items = parsePipelineItems(body);
  for (const i of items) {
    if (!(await exists(i.code, i.file))) throw new UserError(`${i.file} was not found in Roms/${i.code}.`);
  }
  const options: PipelineOptions = {
    trashArchive: body.trashArchive !== false, preferChd: body.preferChd !== false,
    trash: body.trash !== false, m3u: body.m3u !== false, verify: body.verify !== false,
  };
  const ids: PipelineStepId[] = ["fix", "chd", ...(options.m3u ? ["m3u" as const] : []), ...(options.verify ? ["verify" as const] : [])];
  const p: Pipeline = {
    id: nextId++, state: "idle", items, options, current: "", error: "", stopRequested: false,
    steps: ids.map((id) => ({ id, label: LABELS[id], state: "pending", detail: "" })),
    touched: new Map(), started: Date.now(), finished: 0,
  };
  for (const i of items) if (!ARCHIVE.has(ext(i.file))) touch(p, i.code, [i.file]);
  pipeline = p;
  say("cyan", "DISC", `Disc pipeline: ${items.length} game${items.length === 1 ? "" : "s"}.`);
  launch(p);
  return discPipelineJson();
}

/** While running: stop after the current step (resumable). When paused or failed: drop the pipeline. */
export function cancelDiscPipeline() {
  const p = pipeline;
  if (!p) throw new UserError("There is no disc pipeline to stop.");
  if (p.state === "running") {
    p.stopRequested = true;
  } else if (p.state === "paused" || p.state === "failed") {
    p.state = "cancelled";
    p.finished = Date.now();
    say("yellow", "DISC", "Disc pipeline cancelled.");
  }
  return discPipelineJson();
}

export function resumeDiscPipeline() {
  const p = pipeline;
  if (!p || (p.state !== "paused" && p.state !== "failed")) throw new UserError("There is no stopped disc pipeline to resume.");
  requireIdle("Wait for the current transfer to finish before resuming the disc pipeline.");
  for (const step of p.steps) if (step.state === "failed") step.state = "pending";
  say("cyan", "DISC", "Resuming the disc pipeline.");
  launch(p);
  return discPipelineJson();
}

/** Clears a finished, failed, paused or cancelled pipeline from the panel. */
export function dismissDiscPipeline() {
  if (pipeline?.state === "running") throw new UserError("Stop the disc pipeline before dismissing it.");
  pipeline = null;
  return discPipelineJson();
}

/** Resolves when the current run settles. For tests. */
export const waitForDiscPipeline = (): Promise<void> => active;
