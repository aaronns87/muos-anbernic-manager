// Background jobs: copying ROMs to the device, and moving artwork either way. One runs at a time; the rest wait in a
// queue, and finished ones are kept as a short history.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CATALOGUE_PATH, EXCLUDED_TOP, FAT32_LIMIT, ROMS_DIR, USB_ID } from "./catalogue.ts";
import { ctx } from "./context.ts";
import { catalogueFor, deviceCatalogues, deviceFiles } from "./device/content.ts";
import type { Entry, Progress } from "./device/fs.ts";
import { waitSyncthingIdle } from "./device/syncthing.ts";
import { art, withTarget, type Target, type TargetInfo } from "./device/target.ts";
import { Cancelled, UserError } from "./errors.ts";
import { files, human, say } from "./log.ts";
import { platform } from "./platform/index.ts";
import { settings } from "./settings.ts";
import { inside, isDir, listDir, removeQuietly, sameFile, skipName, splitName } from "./util.ts";
import { collect, libraryImages, workspaceSystems } from "./workspace.ts";

/** One unit of work: the label shown while it runs, its size, and whatever the job needs to do it. */
export interface Work {
  rel: string;
  size: number;
}

export type JobKind = "transfer" | "art" | "artsend" | "apps" | "files";
/** Which way a transfer moves games: onto the handheld, or from it into the workspace's Roms/ folder. */
export type TransferDirection = "to-device" | "from-device";
/** How a transfer reaches the handheld: SFTP/USB/card straight to its Roms/, or into a local folder Syncthing shares with it. */
export type Transport = "sftp" | "syncthing";
/** Volume id of Syncthing jobs: they use the local sync folder, never a device session, so they share no space or USB limit with it. */
export const SYNC_VOLUME = "syncthing";
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
  /** Only transfers pull from the device; every other job writes to it (or to Roms/ for artwork, which has its own kind). */
  readonly direction: TransferDirection = "to-device";
  /** Only ROM copies can go through Syncthing instead of the device connection. */
  readonly transport: Transport = "sftp";
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

  /** Runs the files of the job; by default inside a session with the device or card. */
  protected execute(): Promise<void> {
    return withTarget(this.volume, (t) => this.work(t));
  }

  start(): void {
    this.started = Date.now();
    this.state = "running";
    this.promise = (async () => {
      let outcome: Job["state"] = "done";
      try {
        await this.execute();
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
      id: this.id, kind: this.kind, direction: this.direction, transport: this.transport, state: this.state, phase: this.phase, label: this.label, target: this.target,
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
  return activeJobs().filter((j) => j.volume === volume && j.direction === "to-device").reduce((n, j) => n + j.total - j.doneBytes, 0);
}

/** Bytes still to be written into Roms/ by the running and waiting pulls from the device. */
export function pendingLocalBytes(): number {
  return activeJobs().filter((j) => j.kind === "transfer" && j.direction === "from-device").reduce((n, j) => n + j.total - j.doneBytes, 0);
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
  const waiting = new Set(activeJobs().filter((j) => j.kind === "transfer" && j.direction === "to-device" && j.volume === t.info.id).flatMap((j) => j.jobs.map((w) => w.rel.toLowerCase())));
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

interface PlanShape {
  new: Work[];
  different: Work[];
  identical: string[];
  queued: string[];
  skipped: string[];
  too_big: string[];
}

export function planSummary(info: TargetInfo, plan: PlanShape) {
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

// ---------------------------------------------------------------- directions

/** What a transfer is asked to do. The two match modes are guided: they also replace files that differ. */
export type TransferMode = "to-device" | "from-device" | "match-device" | "match-library";

export const TRANSFER_MODES: readonly TransferMode[] = ["to-device", "from-device", "match-device", "match-library"];

export function transferMode(value: unknown): TransferMode {
  if (value === undefined || value === null || value === "") return "to-device";
  if (TRANSFER_MODES.includes(value as TransferMode)) return value as TransferMode;
  throw new UserError(`Unknown direction "${String(value)}". Use ${TRANSFER_MODES.join(", ")}.`);
}

export const modeDirection = (mode: TransferMode): TransferDirection => (mode === "to-device" || mode === "match-device" ? "to-device" : "from-device");

/** Files that differ are replaced when asked for, and by default in the match modes. */
const replaces = (body: Record<string, unknown>, mode: TransferMode): boolean =>
  body.replace === undefined || body.replace === null ? mode.startsWith("match-") : Boolean(body.replace);

// ---------------------------------------------------------------- pulling ROMs from the device

export interface PullWork extends Work {
  /** Path below ROMS/ on the device. */
  remote: string;
  /** Absolute destination under Roms/. */
  dest: string;
  /** Device modification time in seconds, 0 when unknown. */
  mtime: number;
  /** An older copy is in the way and goes to the Trash first. */
  replace: boolean;
}

const wanted = (parts: string[]): boolean => parts.length > 0 && parts.every((p) => p !== "" && p !== "." && p !== ".." && !p.includes("/") && !p.includes("\\"));

/** Free space on the computer's side of Roms/, less what other waiting pulls will take. */
export async function libraryFree(): Promise<number> {
  await fsp.mkdir(ctx.roms, { recursive: true });
  const st = await fsp.statfs(ctx.roms);
  return Math.max(0, st.bavail * st.bsize - pendingLocalBytes());
}

interface LocalRom {
  rel: string;
  abs: string;
  size: number;
  mtime: number;
}

/** Files already in Roms/<system> (artwork and hidden folders left out), keyed by lower-cased "system/.../file". */
async function localRoms(system: string): Promise<Map<string, LocalRom>> {
  const found = new Map<string, LocalRom>();
  const walk = async (dir: string, rel: string[]) => {
    for (const entry of await listDir(dir)) {
      if (skipName(entry.name)) continue;
      const next = [...rel, entry.name];
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), next);
      else if (entry.isFile()) {
        const st = await fsp.stat(path.join(dir, entry.name));
        const joined = next.join("/");
        found.set(joined.toLowerCase(), { rel: joined, abs: path.join(dir, entry.name), size: st.size, mtime: st.mtimeMs / 1000 });
      }
    }
  };
  await walk(path.join(ctx.roms, system), [system]);
  return found;
}

/** What is on the device under ROMS/ that the targets ask for: Roms/-style paths ("" is everything). */
async function pickedOnDevice(t: Target, targets: unknown[]): Promise<{ picked: Map<string, [string, Entry]>; skipped: string[] }> {
  const top = ((await t.roms.list([ROMS_DIR])) ?? []).filter((e) => e.folder && !skipName(e.name));
  const skipped = new Set<string>();
  const whole = new Set<string>(), prefixes: string[] = [];
  for (const raw of targets) {
    if (typeof raw !== "string") throw new UserError("Invalid path.");
    const target = raw.replace(/^\/+|\/+$/g, "");
    const parts = target.split("/").filter(Boolean);
    if (parts.includes("..")) throw new UserError(`Invalid path: ${target}`);
    if (parts.some(skipName)) throw new UserError(`${target} is a hidden or Imgs artwork path, which is not copied.`);
    if (!parts.length) {
      for (const e of top) {
        if (EXCLUDED_TOP.has(e.name.toUpperCase())) skipped.add(e.name);
        else whole.add(e.name.toLowerCase());
      }
      continue;
    }
    if (EXCLUDED_TOP.has(parts[0].toUpperCase())) throw new UserError(`${parts[0]} holds stock Anbernic firmware files, which MustardOS does not run.`);
    if (!top.some((e) => e.name.toLowerCase() === parts[0].toLowerCase())) throw new UserError(`Not on the handheld: ${target}`);
    if (parts.length === 1) whole.add(parts[0].toLowerCase());
    else prefixes.push(parts.join("/").toLowerCase());
  }
  const systems = new Set([...whole, ...prefixes.map((p) => p.split("/")[0])]);
  const all = await deviceFiles(t.roms, [...systems].sort());
  const picked = new Map<string, [string, Entry]>();
  for (const [key, value] of all) {
    if (whole.has(key.split("/")[0]) || prefixes.some((p) => key === p || key.startsWith(`${p}/`))) picked.set(key, value);
  }
  return { picked, skipped: [...skipped].sort() };
}

/** The pull counterpart of makePlan: device files missing from Roms/, or different there. */
export async function makePullPlan(t: Target, targets: unknown[]) {
  const { picked, skipped } = await pickedOnDevice(t, targets);
  if (!picked.size) throw new UserError(`No ROM files found on ${t.name} for the given paths.`);
  const onCard = !t.roms.remote;
  const waiting = new Set(activeJobs().filter((j) => j.kind === "transfer" && j.direction === "from-device" && j.volume === t.info.id).flatMap((j) => j.jobs.map((w) => w.rel.toLowerCase())));
  const folders = new Map((await workspaceSystems()).map((s) => [s.toLowerCase(), s]));
  const local = new Map<string, Map<string, LocalRom>>();
  const plan = { new: [] as PullWork[], identical: [] as string[], different: [] as PullWork[], queued: [] as string[], skipped, too_big: [] as string[] };
  for (const [, [remoteRel, entry]] of [...picked].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const parts = remoteRel.split("/");
    if (!wanted(parts)) {
      plan.skipped.push(remoteRel);
      continue;
    }
    const system = folders.get(parts[0].toLowerCase()) ?? parts[0];
    if (!local.has(system)) local.set(system, await localRoms(system));
    const existing = local.get(system)!.get(remoteRel.toLowerCase());
    const rel = existing?.rel ?? [system, ...parts.slice(1)].join("/");
    if (waiting.has(rel.toLowerCase())) {
      plan.queued.push(rel);
      continue;
    }
    const dest = path.join(ctx.roms, ...rel.split("/"));
    if (path.relative(ctx.roms, dest).startsWith("..")) {
      plan.skipped.push(remoteRel);
      continue;
    }
    const work: PullWork = { rel, size: entry.size, remote: remoteRel, dest, mtime: entry.mtime, replace: Boolean(existing) };
    if (!existing) {
      plan.new.push(work);
      continue;
    }
    if (existing.size === entry.size && (!onCard || Math.abs(existing.mtime - entry.mtime) <= 2)) {
      plan.identical.push(rel);
      continue;
    }
    const remotePath = t.roms.localPath?.([ROMS_DIR, ...remoteRel.split("/")]);
    if (onCard && remotePath && existing.size === entry.size && (await sameFile(existing.abs, remotePath))) plan.identical.push(rel);
    else plan.different.push(work);
  }
  return plan;
}

export class PullJob extends Job<PullWork> {
  readonly kind = "transfer";
  readonly verb = "PULLED";
  readonly direction = "from-device";

  async copyOne(t: Target, job: PullWork, progress: Progress): Promise<void> {
    await fsp.mkdir(path.dirname(job.dest), { recursive: true });
    const partial = path.join(path.dirname(job.dest), `.${path.basename(job.dest)}.partial`);
    await removeQuietly(partial);
    try {
      await t.roms.get([ROMS_DIR, ...job.remote.split("/")], partial);
      if (this.cancelled) throw new Cancelled();
      const got = (await fsp.stat(partial)).size;
      if (got !== job.size) throw new UserError(`${path.basename(job.dest)} arrived incomplete (${human(got)} of ${human(job.size)}).`);
      if (job.replace && (await fsp.access(job.dest).then(() => true, () => false))) await platform.trash(job.dest);
      await fsp.rename(partial, job.dest);
      if (job.mtime > 0) await fsp.utimes(job.dest, job.mtime, job.mtime).catch(() => {});
    } finally {
      await removeQuietly(partial);
    }
    progress(job.size);
  }

  protected report(outcome: Job["state"]): void {
    if (outcome === "done" && !this.failed.length) say("green", this.verb, `${files(this.copied)} (${human(this.doneBytes)}) from ${this.target} into Roms/.`);
    else if (outcome === "cancelled") say("yellow", "STOPPED", `Pull stopped after ${files(this.copied)}.`);
    else super.report(outcome);
  }

  protected async after(): Promise<void> {
    if (!this.copied) return;
    this.current = "Rescanning Roms/";
    const { rescanLibrary } = await import("./games/library.ts");
    await rescanLibrary();
  }
}

// ---------------------------------------------------------------- Syncthing transport

export const TRANSPORTS: readonly Transport[] = ["sftp", "syncthing"];

export function transportOf(value: unknown): Transport {
  if (value === undefined || value === null || value === "") return "sftp";
  if (TRANSPORTS.includes(value as Transport)) return value as Transport;
  throw new UserError(`Unknown transport "${String(value)}". Use ${TRANSPORTS.join(" or ")}.`);
}

/** The local folder Syncthing shares with the handheld's Roms/, from Settings. */
async function syncRoot(): Promise<string> {
  const root = settings().syncthingRomsPath;
  if (!root) throw new UserError("Choose the Syncthing ROMs folder in Settings before transferring through Syncthing.");
  if (!(await isDir(root))) throw new UserError(`The Syncthing ROMs folder ${root} is missing. Check Settings.`);
  return root;
}

const syncDest = (root: string, rel: string): string => {
  const dest = path.join(root, ...rel.split("/"));
  if (!inside(root, dest)) throw new UserError(`${rel} would land outside the Syncthing folder.`);
  return dest;
};

/** Copies a ROM into the sync folder. The temp name follows Syncthing's own scheme, so it is never synced half-written. */
async function copyIntoSyncFolder(src: string, dest: string, progress: Progress): Promise<void> {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const partial = path.join(path.dirname(dest), `.syncthing.${path.basename(dest)}.tmp`);
  await removeQuietly(partial);
  try {
    let sent = 0;
    const count = new Transform({
      transform(chunk: Buffer, _enc, done) {
        sent += chunk.length;
        done(progress(sent) ? new Cancelled() : null, chunk);
      },
    });
    await pipeline(fs.createReadStream(src), count, fs.createWriteStream(partial));
    const st = await fsp.stat(src);
    await fsp.utimes(partial, st.atime, st.mtime).catch(() => {});
    await fsp.rename(partial, dest);
  } finally {
    await removeQuietly(partial);
  }
}

class SyncthingCopyJob extends Job<RomWork> {
  readonly kind = "transfer";
  readonly transport = "syncthing";
  private readonly root: string;

  constructor(label: string, jobs: RomWork[], root: string) {
    super(label, jobs, SYNC_VOLUME, `Syncthing folder (${path.basename(root)})`);
    this.root = root;
  }

  /** No handheld session: the files only go into the local folder. */
  protected execute(): Promise<void> {
    return this.work(undefined as never);
  }

  async copyOne(_t: Target, job: RomWork, progress: Progress): Promise<void> {
    await copyIntoSyncFolder(job.src, syncDest(this.root, job.rel), progress);
  }

  /** The job is complete only once Syncthing has settled, so the files are on their way to the handheld. */
  protected async after(outcome: Job["state"]): Promise<void> {
    if (outcome !== "done" || !this.copied) return;
    this.phase = "sync";
    this.current = "Waiting for Syncthing";
    const wait = await waitSyncthingIdle(undefined, { folderId: settings().syncthingFolderId, settleMs: 2000, stop: () => this.cancelled });
    if (wait.idle) say("green", "SYNCTHING", wait.detail);
    else say("yellow", "CHECK", `${wait.detail} The games are in the sync folder and keep syncing in the background.`);
  }
}

/** The Syncthing counterpart of makePlan: the sync folder takes the place of the device when comparing. */
async function makeSyncPlan(root: string, targets: unknown[]) {
  const { picked, skipped } = await collect(targets);
  if (!picked.size) throw new UserError("No ROM files found in the given paths.");
  const waiting = new Set(activeJobs().filter((j) => j.kind === "transfer" && j.volume === SYNC_VOLUME).flatMap((j) => j.jobs.map((w) => w.rel.toLowerCase())));
  const plan = { new: [] as RomWork[], identical: [] as string[], different: [] as RomWork[], queued: [] as string[], skipped, too_big: [] as string[] };
  for (const [rel, src] of [...picked].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (waiting.has(rel.toLowerCase())) {
      plan.queued.push(rel);
      continue;
    }
    const st = await fsp.stat(src);
    const there = await fsp.stat(syncDest(root, rel)).catch(() => null);
    if (!there?.isFile()) plan.new.push({ rel, src, size: st.size });
    else if (there.size === st.size) plan.identical.push(rel);
    else plan.different.push({ rel, src, size: st.size });
  }
  return plan;
}

async function syncCard(root: string): Promise<TargetInfo> {
  const st = await fsp.statfs(root);
  return {
    id: SYNC_VOLUME, mode: "card", name: "Syncthing folder", kind: "syncthing", storage: "Syncthing",
    free: st.bavail * st.bsize, total: st.blocks * st.bsize, art: "", catalogue: false,
  };
}

function requireSendMode(mode: TransferMode): void {
  if (modeDirection(mode) !== "to-device") throw new UserError("Syncthing only sends games from Roms/ to the handheld. Use SFTP to pull games from it.");
}

async function startSyncCopy(body: Record<string, unknown>, mode: TransferMode) {
  requireSendMode(mode);
  const root = await syncRoot();
  const plan = await makeSyncPlan(root, (body.targets as unknown[]) || [""]);
  const card = await syncCard(root);
  const jobs = [...plan.new, ...(replaces(body, mode) ? plan.different : [])];
  if (!jobs.length && plan.queued.length) throw new UserError("These games are already waiting in Transfers.");
  if (!jobs.length) throw new UserError("Nothing to copy. The Syncthing folder already has everything.");
  const total = jobs.reduce((s, j) => s + j.size, 0);
  const free = Math.max(0, card.free - pendingBytes(SYNC_VOLUME));
  if (total > free) throw new UserError(`These ROMs need ${human(total)} and the Syncthing folder's drive has ${human(free)} free.`);
  const label = String(body.label || "ROMs").slice(0, 120);
  return startJob(new SyncthingCopyJob(label, jobs, root), `${label}: ${files(jobs.length)} (${human(total)}) into the Syncthing folder`);
}

// ---------------------------------------------------------------- planning and starting

/** The dry run for a transfer in either direction, with the direction it resolved to. */
export async function planTransfer(volume: string, targets: unknown[], direction?: unknown, transport?: unknown) {
  const mode = transferMode(direction), way = modeDirection(mode);
  if (transportOf(transport) === "syncthing") {
    requireSendMode(mode);
    const root = await syncRoot();
    const summary = planSummary(await syncCard(root), await makeSyncPlan(root, targets));
    return { ...summary, direction: way, mode, replace_default: replaces({}, mode), transport: "syncthing" as Transport };
  }
  return withTarget(volume, async (t) => {
    if (way === "to-device") return { ...planSummary(t.info, await makePlan(t, targets)), direction: way, mode, replace_default: replaces({}, mode) };
    const summary = planSummary(t.info, await makePullPlan(t, targets));
    return { ...summary, direction: way, mode, replace_default: replaces({}, mode), library: { free: await libraryFree() } };
  });
}

export async function startCopy(body: Record<string, unknown>) {
  const mode = transferMode(body.direction);
  if (transportOf(body.transport) === "syncthing") return startSyncCopy(body, mode);
  if (modeDirection(mode) === "from-device") return startPull(body, mode);
  const volume = String(body.volume ?? "");
  requireQueueable(volume);
  const { plan, free, name } = await withTarget(volume, async (t) => ({
    plan: await makePlan(t, (body.targets as unknown[]) || [""]), free: t.info.free - pendingBytes(volume), name: t.name,
  }));
  if (plan.too_big.length) throw new UserError(`${plan.too_big[0]} is 4 GB or larger, which FAT32 cannot store.`);
  const jobs = [...plan.new, ...(replaces(body, mode) ? plan.different : [])];
  if (!jobs.length && plan.queued.length) throw new UserError("These games are already waiting in Transfers.");
  if (!jobs.length) throw new UserError(`Nothing to copy. Everything is already on ${name}.`);
  const total = jobs.reduce((s, j) => s + j.size, 0);
  if (total > free) throw new UserError(`These ROMs need ${human(total)} and ${name} has ${human(free)} free.`);
  const label = String(body.label || "ROMs").slice(0, 120);
  return startJob(new CopyJob(label, jobs, volume, name), `${label}: ${files(jobs.length)} (${human(total)}) to ${name}`);
}

async function startPull(body: Record<string, unknown>, mode: TransferMode) {
  const volume = String(body.volume ?? "");
  requireQueueable(volume);
  const { plan, name } = await withTarget(volume, async (t) => ({ plan: await makePullPlan(t, (body.targets as unknown[]) || [""]), name: t.name }));
  const jobs = [...plan.new, ...(replaces(body, mode) ? plan.different : [])];
  if (!jobs.length && plan.queued.length) throw new UserError("These games are already waiting in Transfers.");
  if (!jobs.length) throw new UserError(`Nothing to pull. Roms/ already has everything on ${name}.`);
  const total = jobs.reduce((s, j) => s + j.size, 0);
  const free = await libraryFree();
  if (total > free) throw new UserError(`These ROMs need ${human(total)} and this computer has ${human(free)} free for Roms/.`);
  const label = String(body.label || "ROMs").slice(0, 120);
  return startJob(new PullJob(label, jobs, volume, name), `${label}: ${files(jobs.length)} (${human(total)}) from ${name} into Roms/`);
}
