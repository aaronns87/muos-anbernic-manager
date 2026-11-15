// Background jobs: copying ROMs to the device, and moving artwork either way. One runs at a time; the rest wait in a
// queue, and finished ones are kept as a short history.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { CATALOGUE_PATH, FAT32_LIMIT, ROMS_DIR, USB_ID } from "./catalogue.ts";
import { ctx } from "./context.ts";
import { catalogueFor, deviceCatalogues, deviceFiles } from "./device/content.ts";
import type { Progress } from "./device/fs.ts";
import { art, withTarget, type Target, type TargetInfo } from "./device/target.ts";
import { Cancelled, UserError } from "./errors.ts";
import { files, human, say } from "./log.ts";
import { settings } from "./settings.ts";
import { sameFile, splitName } from "./util.ts";
import { collect, libraryImages } from "./workspace.ts";

/** One unit of work: the label shown while it runs, its size, and whatever the job needs to do it. */
export interface Work {
  rel: string;
  size: number;
}

export type JobKind = "transfer" | "art" | "artsend" | "apps" | "files";
export type JobState = "queued" | "running" | "done" | "cancelled" | "failed";

/** How one file of a job went. "skipped" is a file the job never reached because it stopped. */
export interface FileResult {
  rel: string;
  size: number;
  state: "done" | "failed" | "running" | "waiting" | "skipped";
  secs?: number;
  done?: number;
  error?: string;
}

/** Per-file results kept for each job; a job with more files keeps the first ones and its totals. */
const FILE_LIMIT = 500;

let nextId = 1;

function newId(): number {
  pastJobs();
  return nextId++;
}

export abstract class Job<W extends Work = Work> {
  abstract readonly kind: JobKind;
  readonly id = newId();
  readonly verb: string = "COPIED";
  readonly label: string;
  readonly jobs: W[];
  readonly volume: string;
  readonly target: string;
  readonly total: number;
  state: JobState = "queued";
  message = "";
  phase = "copy";
  index = 0;
  doneBytes = 0;
  current = "";
  copied = 0;
  failed: string[] = [];
  error = "";
  cancelled = false;
  private readonly results: FileResult[] = [];
  private fileBase = 0;
  readonly created = Date.now();
  started = 0;
  finished = 0;
  promise: Promise<void> = Promise.resolve();

  constructor(label: string, jobs: W[], volume: string, target: string) {
    this.label = label;
    this.jobs = jobs;
    this.volume = volume;
    this.target = target;
    this.total = jobs.reduce((sum, j) => sum + j.size, 0);
  }

  abstract copyOne(t: Target, job: W, progress: Progress): Promise<void>;

  protected async work(t: Target): Promise<void> {
    let misses = 0;
    for (const [i, job] of this.jobs.entries()) {
      if (this.cancelled) throw new Cancelled();
      this.index = i + 1;
      this.current = job.rel;
      const base = this.fileBase = this.doneBytes;
      const began = Date.now();
      const secs = () => (Date.now() - began) / 1000;
      try {
        await this.copyOne(t, job, (sent) => {
          this.doneBytes = base + sent;
          return this.cancelled;
        });
        misses = 0;
        this.copied++;
        if (i < FILE_LIMIT) this.results[i] = { rel: job.rel, size: job.size, state: "done", secs: secs() };
      } catch (error) {
        if (error instanceof Cancelled) throw error;
        misses++;
        this.failed.push(job.rel);
        this.error = (error as Error).message;
        if (i < FILE_LIMIT) this.results[i] = { rel: job.rel, size: job.size, state: "failed", secs: secs(), error: this.error };
        if (misses >= 3) throw new UserError(`Stopped after three failures in a row. Last one: ${this.error}`);
      } finally {
        this.doneBytes = base + job.size;
      }
    }
  }

  protected report(outcome: Job["state"]): void {
    if (outcome === "done" && !this.failed.length) say("green", this.verb, `${files(this.copied)} (${human(this.doneBytes)}) to ${this.target}.`);
    else if (outcome === "done") say("yellow", "CHECK", `${this.copied} copied, ${this.failed.length} failed. ${this.error}`);
    else if (outcome === "cancelled") say("yellow", "STOPPED", `Copy stopped after ${files(this.copied)}.`);
    else say("red", "FAILED", this.error);
  }

  protected async after(_outcome: Job["state"]): Promise<void> {}

  start(): void {
    this.started = Date.now();
    this.state = "running";
    this.promise = (async () => {
      let outcome: Job["state"] = "done";
      try {
        await withTarget(this.volume, (t) => this.work(t));
      } catch (error) {
        if (error instanceof Cancelled) {
          outcome = "cancelled";
        } else {
          outcome = "failed";
          this.error = (error as Error).message;
        }
      }
      this.report(outcome);
      await this.after(outcome).catch((error) => say("red", "FAILED", (error as Error).message));
      this.finished = Date.now();
      this.state = outcome;
    })();
  }

  /** Every file of the job (up to FILE_LIMIT) with how it went so far. Folders created on the way are left out. */
  fileList(): FileResult[] {
    const out: FileResult[] = [];
    for (const [i, w] of this.jobs.slice(0, FILE_LIMIT).entries()) {
      if ((w as Work & { folder?: boolean }).folder) continue;
      const done = this.results[i];
      if (done) out.push(done);
      else if (this.state === "running" && i === this.index - 1) out.push({ rel: w.rel, size: w.size, state: "running", done: this.doneBytes - this.fileBase });
      else out.push({ rel: w.rel, size: w.size, state: this.state === "running" || this.state === "queued" ? "waiting" : "skipped" });
    }
    return out;
  }

  snapshot() {
    const elapsed = this.started ? Math.max(((this.finished || Date.now()) - this.started) / 1000, 0.001) : 0;
    const speed = elapsed ? this.doneBytes / elapsed : 0;
    return {
      id: this.id, kind: this.kind, state: this.state, phase: this.phase, label: this.label, target: this.target,
      index: this.index, count: this.jobs.length, done_bytes: this.doneBytes, total_bytes: this.total,
      current: this.current, file_done: this.state === "running" ? this.doneBytes - this.fileBase : 0, speed, eta: speed && this.state === "running" ? (this.total - this.doneBytes) / speed : 0,
      elapsed, copied: this.copied, failed: this.failed.slice(0, 50), failed_count: this.failed.length, error: this.error,
      created: this.created, started: this.started, finished: this.finished,
    };
  }
}

export type JobSnapshot = ReturnType<Job["snapshot"]> & { files?: FileResult[] };

let current: Job<Work> | null = null;
const queue: Job<Work>[] = [];
const HISTORY = 50;
let history: JobSnapshot[] | null = null;

const historyFile = () => path.join(ctx.cacheDir, "transfers.json");

function pastJobs(): JobSnapshot[] {
  if (!history) {
    try {
      const list = JSON.parse(fs.readFileSync(historyFile(), "utf8"));
      history = Array.isArray(list) ? list.slice(0, HISTORY) : [];
    } catch {
      history = [];
    }
    nextId = Math.max(nextId, ...history.map((j) => j.id + 1));
  }
  return history;
}

function saveHistory(): void {
  const file = historyFile(), tmp = `${file}.tmp`;
  fsp.writeFile(tmp, JSON.stringify(pastJobs()))
    .then(() => fsp.rename(tmp, file))
    .catch((error) => say("yellow", "CHECK", `The transfer history was not saved: ${(error as Error).message}`));
}

function remember(job: Job<Work>): void {
  const list = pastJobs();
  list.unshift({ ...job.snapshot(), files: job.fileList() });
  list.splice(HISTORY);
  saveHistory();
}

/** Running or waiting: other work that touches the cards waits for the queue to empty. */
export const jobRunning = (): boolean => current?.state === "running" || queue.length > 0;

/** The running job first, then the queue in the order it will run. */
export const activeJobs = (): Job<Work>[] => [...(current?.state === "running" ? [current] : []), ...queue];

export function jobList() {
  return {
    job: current?.snapshot() ?? null,
    active: activeJobs().map((j) => j.snapshot()),
    history: pastJobs().map(({ files: _files, ...j }) => j),
  };
}

/** The files of one job, running, waiting or finished. */
export function jobFiles(id: number): { id: number; files: FileResult[] } {
  const live = activeJobs().find((j) => j.id === id);
  if (live) return { id, files: live.fileList() };
  const past = pastJobs().find((j) => j.id === id);
  if (!past) throw new UserError("That transfer is no longer in the list.");
  return { id, files: past.files ?? [] };
}

/** Bytes still to be written to a volume by the running and waiting jobs. */
export function pendingBytes(volume: string): number {
  return activeJobs().filter((j) => j.volume === volume).reduce((n, j) => n + j.total - j.doneBytes, 0);
}

/** Set while a System section job (install, TF2 setup, reset) owns a card; the message says which. */
export const locks = { system: "" };

export function requireIdle(message = "Wait for the current job to finish."): void {
  if (jobRunning()) throw new UserError(message);
  if (locks.system) throw new UserError(locks.system);
}

/** For work that can wait in the queue. Over USB the handheld serves one session at a time, so a new job there cannot
 *  even be planned while another is using it. */
export function requireQueueable(volume: string): void {
  if (locks.system) throw new UserError(locks.system);
  if (volume === USB_ID && jobRunning()) throw new UserError("Over USB the handheld handles one transfer at a time. Wait for the current one to finish.");
}

function run(job: Job<Work>): void {
  current = job;
  say("cyan", "COPYING", job.message);
  job.start();
  job.promise.then(() => {
    remember(job);
    const next = queue.shift();
    if (next) run(next);
  });
}

export function startJob<W extends Work>(job: Job<W>, message: string) {
  if (locks.system) throw new UserError(locks.system);
  const j = job as unknown as Job<Work>;
  j.message = message;
  if (jobRunning()) {
    queue.push(j);
    say("cyan", "QUEUED", message);
  } else {
    run(j);
  }
  return job.snapshot();
}

function dropQueued(job: Job<Work>): void {
  job.state = "cancelled";
  job.finished = Date.now();
  say("yellow", "STOPPED", `${job.label} was taken out of the queue before it started.`);
  remember(job);
}

/** Stops one job by id, running or waiting. Without an id it stops the running job and empties the queue. */
export function cancelJob(id?: number): void {
  if (id === undefined) {
    for (const job of queue.splice(0)) dropQueued(job);
    if (current?.state === "running") current.cancelled = true;
    return;
  }
  const i = queue.findIndex((j) => j.id === id);
  if (i >= 0) dropQueued(queue.splice(i, 1)[0]);
  else if (current?.id === id && current.state === "running") current.cancelled = true;
}

/** Removes one finished job from the history, or all of them without an id. */
export function forgetJob(id?: number): void {
  const list = pastJobs();
  if (id === undefined) list.splice(0);
  else list.splice(0, list.length, ...list.filter((j) => j.id !== id));
  saveHistory();
}

export async function waitForJob(): Promise<void> {
  if (current) await current.promise;
}

// ---------------------------------------------------------------- ROM copies

interface RomWork extends Work {
  src: string;
}

class CopyJob extends Job<RomWork> {
  readonly kind = "transfer";
  private catalogues: Map<string, string> | null = null;
  private readonly artDone = new Set<string>();
  private readonly images = new Map<string, Map<string, string>>();
  private artSent = 0;

  async copyOne(t: Target, job: RomWork, progress: Progress): Promise<void> {
    await t.roms.put(job.src, [ROMS_DIR, ...job.rel.split("/")], progress);
    await this.sendArt(t, job.rel);
  }

  /** MustardOS reads artwork from its catalogue, not from beside the ROM, so the game's Roms/ image goes there as box art
   *  unless the device already has one. A failure here never fails the ROM copy. */
  private async sendArt(t: Target, rel: string): Promise<void> {
    const fs = settings().copyArt ? art(t) : null;
    const system = rel.split("/")[0];
    const [stem] = splitName(rel.split("/").pop()!);
    const key = `${system}/${stem}`.toLowerCase();
    if (!fs || this.artDone.has(key)) return;
    this.artDone.add(key);
    try {
      if (!this.images.has(system)) this.images.set(system, await libraryImages(system));
      const src = this.images.get(system)!.get(stem.toLowerCase());
      if (!src) return;
      this.catalogues ??= await deviceCatalogues(t);
      const catalogue = catalogueFor(system, this.catalogues);
      if (!catalogue) return;
      const parts = [...CATALOGUE_PATH, catalogue, "box", `${stem}.png`];
      if (await fs.entry(parts)) return;
      await fs.put(src, parts, () => this.cancelled);
      this.artSent++;
    } catch (error) {
      if (error instanceof Cancelled) throw error;
      say("yellow", "CHECK", `Box art for ${stem} was not sent: ${(error as Error).message}`);
    }
  }

  protected report(outcome: Job["state"]): void {
    super.report(outcome);
    if (this.artSent) say("green", "SENT", `${files(this.artSent)} of box art from Roms/ to ${this.target}.`);
  }
}

export async function makePlan(t: Target, targets: unknown[]) {
  const { picked, skipped } = await collect(targets);
  if (!picked.size) throw new UserError("No ROM files found in the given paths.");
  const remote = await deviceFiles(t.roms, [...new Set([...picked.keys()].map((rel) => rel.split("/")[0]))].sort());
  const onCard = !t.roms.remote;
  const waiting = new Set(activeJobs().filter((j) => j.kind === "transfer" && j.volume === t.info.id).flatMap((j) => j.jobs.map((w) => w.rel.toLowerCase())));
  const plan = { new: [] as RomWork[], identical: [] as string[], different: [] as RomWork[], queued: [] as string[], skipped, too_big: [] as string[] };
  for (const [rel, src] of [...picked].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (waiting.has(rel.toLowerCase())) {
      plan.queued.push(rel);
      continue;
    }
    const st = await fsp.stat(src);
    if (onCard && t.info.fs === "fat" && st.size >= FAT32_LIMIT) plan.too_big.push(rel);
    const hit = remote.get(rel.toLowerCase());
    if (!hit) {
      plan.new.push({ rel, src, size: st.size });
      continue;
    }
    const [remoteRel, entry] = hit;
    if (entry.size === st.size && (!onCard || Math.abs(st.mtimeMs / 1000 - entry.mtime) <= 2)) {
      plan.identical.push(rel);
      continue;
    }
    const remotePath = t.roms.localPath?.([ROMS_DIR, ...remoteRel.split("/")]);
    if (onCard && remotePath && entry.size === st.size && (await sameFile(src, remotePath))) {
      plan.identical.push(rel);
    } else {
      plan.different.push({ rel, src, size: st.size });
    }
  }
  return plan;
}

export function planSummary(info: TargetInfo, plan: Awaited<ReturnType<typeof makePlan>>) {
  const systems = new Map<string, { new: number; different: number; bytes: number; diff_bytes: number }>();
  for (const key of ["new", "different"] as const) {
    for (const job of plan[key]) {
      const code = job.rel.split("/")[0];
      const entry = systems.get(code) ?? { new: 0, different: 0, bytes: 0, diff_bytes: 0 };
      entry[key]++;
      entry[key === "new" ? "bytes" : "diff_bytes"] += job.size;
      systems.set(code, entry);
    }
  }
  const sum = (jobs: Work[]) => jobs.reduce((s, j) => s + j.size, 0);
  return {
    card: { ...info, free: Math.max(0, info.free - pendingBytes(info.id)) },
    queued: plan.queued.length,
    new: { count: plan.new.length, bytes: sum(plan.new) },
    different: { count: plan.different.length, bytes: sum(plan.different), files: plan.different.slice(0, 50).map((j) => j.rel) },
    identical: plan.identical.length,
    skipped: plan.skipped,
    too_big: plan.too_big.slice(0, 20),
    systems: [...systems].sort(([a], [b]) => (a < b ? -1 : 1)).map(([code, values]) => ({ code, ...values })),
  };
}

export async function startCopy(body: Record<string, unknown>) {
  const volume = String(body.volume ?? "");
  requireQueueable(volume);
  const { plan, free, name } = await withTarget(volume, async (t) => ({
    plan: await makePlan(t, (body.targets as unknown[]) || [""]), free: t.info.free - pendingBytes(volume), name: t.name,
  }));
  if (plan.too_big.length) throw new UserError(`${plan.too_big[0]} is 4 GB or larger, which FAT32 cannot store.`);
  const jobs = [...plan.new, ...(body.replace ? plan.different : [])];
  if (!jobs.length && plan.queued.length) throw new UserError("These games are already waiting in Transfers.");
  if (!jobs.length) throw new UserError(`Nothing to copy. Everything is already on ${name}.`);
  const total = jobs.reduce((s, j) => s + j.size, 0);
  if (total > free) throw new UserError(`These ROMs need ${human(total)} and ${name} has ${human(free)} free.`);
  const label = String(body.label || "ROMs").slice(0, 120);
  return startJob(new CopyJob(label, jobs, volume, name), `${label}: ${files(jobs.length)} (${human(total)}) to ${name}`);
}
