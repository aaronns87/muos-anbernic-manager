// Background jobs (one at a time): copying ROMs to the device, and moving artwork either way.

import fsp from "node:fs/promises";
import { CATALOGUE_PATH, FAT32_LIMIT, ROMS_DIR } from "./catalogue.ts";
import { catalogueFor, deviceCatalogues, deviceFiles } from "./device/content.ts";
import type { Progress } from "./device/fs.ts";
import { art, withTarget, type Target, type TargetInfo } from "./device/target.ts";
import { Cancelled, UserError } from "./errors.ts";
import { files, human, say } from "./log.ts";
import { settings } from "./settings.ts";
import { sameFile, splitName } from "./util.ts";
import { collect, libraryImage } from "./workspace.ts";

/** One unit of work: the label shown while it runs, its size, and whatever the job needs to do it. */
export interface Work {
  rel: string;
  size: number;
}

export type JobKind = "transfer" | "art" | "artsend" | "apps" | "files";

export abstract class Job<W extends Work = Work> {
  abstract readonly kind: JobKind;
  readonly verb: string = "COPIED";
  readonly label: string;
  readonly jobs: W[];
  readonly volume: string;
  readonly target: string;
  readonly total: number;
  state: "running" | "done" | "cancelled" | "failed" = "running";
  phase = "copy";
  index = 0;
  doneBytes = 0;
  current = "";
  copied = 0;
  failed: string[] = [];
  error = "";
  cancelled = false;
  readonly started = Date.now();
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
      const base = this.doneBytes;
      try {
        await this.copyOne(t, job, (sent) => {
          this.doneBytes = base + sent;
          return this.cancelled;
        });
        misses = 0;
        this.copied++;
      } catch (error) {
        if (error instanceof Cancelled) throw error;
        misses++;
        this.failed.push(job.rel);
        this.error = (error as Error).message;
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

  snapshot() {
    const elapsed = Math.max(((this.finished || Date.now()) - this.started) / 1000, 0.001);
    const speed = this.doneBytes / elapsed;
    return {
      kind: this.kind, state: this.state, phase: this.phase, label: this.label, target: this.target,
      index: this.index, count: this.jobs.length, done_bytes: this.doneBytes, total_bytes: this.total,
      current: this.current, speed, eta: speed && this.state === "running" ? (this.total - this.doneBytes) / speed : 0,
      elapsed, copied: this.copied, failed: this.failed.slice(0, 50), failed_count: this.failed.length, error: this.error,
    };
  }
}

let current: Job<Work> | null = null;

export const jobRunning = (): boolean => current?.state === "running";
export const currentJob = () => current;

/** Set while a System section job (install, TF2 setup, reset) owns a card; the message says which. */
export const locks = { system: "" };

export function requireIdle(message = "Wait for the current job to finish."): void {
  if (jobRunning()) throw new UserError(message);
  if (locks.system) throw new UserError(locks.system);
}

export function startJob<W extends Work>(job: Job<W>, message: string) {
  requireIdle();
  current = job as unknown as Job<Work>;
  say("cyan", "COPYING", message);
  job.start();
  return job.snapshot();
}

export function cancelJob(): void {
  if (current && jobRunning()) current.cancelled = true;
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
      const src = await libraryImage(system, stem);
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
  const plan = { new: [] as RomWork[], identical: [] as string[], different: [] as RomWork[], skipped, too_big: [] as string[] };
  for (const [rel, src] of [...picked].sort(([a], [b]) => (a < b ? -1 : 1))) {
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
      await fsp.utimes(remotePath, st.atime, st.mtime);
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
    card: info,
    new: { count: plan.new.length, bytes: sum(plan.new) },
    different: { count: plan.different.length, bytes: sum(plan.different), files: plan.different.slice(0, 50).map((j) => j.rel) },
    identical: plan.identical.length,
    skipped: plan.skipped,
    too_big: plan.too_big.slice(0, 20),
    systems: [...systems].sort(([a], [b]) => (a < b ? -1 : 1)).map(([code, values]) => ({ code, ...values })),
  };
}

export async function startCopy(body: Record<string, unknown>) {
  requireIdle("A copy is already running.");
  const volume = String(body.volume ?? "");
  const { plan, free, name } = await withTarget(volume, async (t) => ({
    plan: await makePlan(t, (body.targets as unknown[]) || [""]), free: t.info.free, name: t.name,
  }));
  if (plan.too_big.length) throw new UserError(`${plan.too_big[0]} is 4 GB or larger, which FAT32 cannot store.`);
  const jobs = [...plan.new, ...(body.replace ? plan.different : [])];
  if (!jobs.length) throw new UserError(`Nothing to copy. Everything is already on ${name}.`);
  const total = jobs.reduce((s, j) => s + j.size, 0);
  if (total > free) throw new UserError(`These ROMs need ${human(total)} and ${name} has ${human(free)} free.`);
  const label = String(body.label || "ROMs").slice(0, 120);
  return startJob(new CopyJob(label, jobs, volume, name), `${label}: ${files(jobs.length)} (${human(total)}) to ${name}`);
}
