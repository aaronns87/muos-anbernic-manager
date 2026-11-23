// Idle jobs: while the manager runs, a 60 second timer runs one recipe pack (or a library rescan) when the handheld is
// reachable over SSH, Syncthing on it is idle and the cooldown since the last run has passed. The setting lives in
// .cache/idle-jobs.json; it is off until the user turns it on.

import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "./context.ts";
import { sshStatus } from "./device/ssh.ts";
import { syncthingIdleJson } from "./device/syncthing-idle.ts";
import { UserError } from "./errors.ts";
import { rescanLibrary } from "./games/library.ts";
import { jobRunning, locks } from "./jobs.ts";
import { say } from "./log.ts";
import { recipesJson, runPack } from "./recipes.ts";

/** Library recipe triggers the server can run on its own (the others need the open browser tab). */
export const LIBRARY_TRIGGERS = ["rescan-library"] as const;

export interface IdleConfig {
  enabled: boolean;
  /** Recipe pack to run, "" when a library recipe is chosen instead. */
  recipePackId: string;
  /** "rescan-library" or "". */
  libraryRecipeTrigger: string;
  cooldownMs: number;
  lastRunAt: number;
  /** One line about the last run, for the Settings panel. */
  lastResult: string;
}

const TICK_MS = 60_000;
const MIN_COOLDOWN_MS = 5 * 60_000;
const MAX_COOLDOWN_MS = 7 * 24 * 3600_000;
const DEFAULT_COOLDOWN_MS = 6 * 3600_000;

const DEFAULTS: IdleConfig = { enabled: false, recipePackId: "", libraryRecipeTrigger: "", cooldownMs: DEFAULT_COOLDOWN_MS, lastRunAt: 0, lastResult: "" };
const configFile = () => path.join(ctx.cacheDir, "idle-jobs.json");

let queue: Promise<unknown> = Promise.resolve();
/** Runs config changes one after another so a timer write and a request cannot overwrite each other. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : fallback);

/** Normalises stored or posted config; unknown fields are dropped. */
export function cleanIdleConfig(raw: unknown, base: IdleConfig = DEFAULTS): IdleConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <K extends keyof IdleConfig>(key: K): unknown => (key in r ? r[key] : base[key]);
  const trigger = String(pick("libraryRecipeTrigger") ?? "");
  const cooldown = Math.round(num(pick("cooldownMs"), base.cooldownMs));
  return {
    enabled: pick("enabled") === true,
    recipePackId: String(pick("recipePackId") ?? "").trim().slice(0, 60),
    libraryRecipeTrigger: (LIBRARY_TRIGGERS as readonly string[]).includes(trigger) ? trigger : "",
    cooldownMs: Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, cooldown)),
    lastRunAt: Math.max(0, Math.round(num(pick("lastRunAt"), 0))),
    lastResult: String(pick("lastResult") ?? "").replace(/[\0\r\n]/g, " ").slice(0, 300),
  };
}

export async function loadIdleConfig(): Promise<IdleConfig> {
  try {
    return cleanIdleConfig(JSON.parse(await fsp.readFile(configFile(), "utf8")), DEFAULTS);
  } catch { return { ...DEFAULTS }; }
}

async function writeConfig(cfg: IdleConfig): Promise<void> {
  await fsp.mkdir(ctx.cacheDir, { recursive: true });
  const tmp = `${configFile()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(cfg, null, 2) + "\n");
  await fsp.rename(tmp, configFile());
}

let ticking = false;
let running = false;

export async function idleJobsJson() {
  const [config, recipes] = await Promise.all([loadIdleConfig(), recipesJson()]);
  const nextAt = config.lastRunAt ? config.lastRunAt + config.cooldownMs : 0;
  return {
    config: { ...config, cooldownMinutes: Math.round(config.cooldownMs / 60_000) },
    packs: recipes.packs.map((p) => ({ id: p.id, name: p.name, builtin: p.builtin })),
    libraryTriggers: [{ id: "rescan-library", name: "Rescan the Roms library" }],
    running,
    nextAt,
    minCooldownMinutes: MIN_COOLDOWN_MS / 60_000,
    maxCooldownMinutes: MAX_COOLDOWN_MS / 60_000,
  };
}

export function saveIdleJobs(body: Record<string, unknown>) {
  return serial(async () => {
    const prev = await loadIdleConfig();
    const patch: Record<string, unknown> = {};
    if ("enabled" in body) patch.enabled = body.enabled === true || body.enabled === 1 || body.enabled === "1";
    if ("recipePackId" in body) patch.recipePackId = String(body.recipePackId ?? "").trim();
    if ("libraryRecipeTrigger" in body) patch.libraryRecipeTrigger = String(body.libraryRecipeTrigger ?? "").trim();
    if ("cooldownMinutes" in body) patch.cooldownMs = num(body.cooldownMinutes, NaN) * 60_000;
    else if ("cooldownMs" in body) patch.cooldownMs = num(body.cooldownMs, NaN);
    if ("cooldownMs" in patch && !Number.isFinite(patch.cooldownMs)) throw new UserError("The cooldown must be a number of minutes.");
    if (patch.recipePackId && !("libraryRecipeTrigger" in patch)) patch.libraryRecipeTrigger = "";
    if (patch.libraryRecipeTrigger && !("recipePackId" in patch)) patch.recipePackId = "";
    if (patch.libraryRecipeTrigger && !(LIBRARY_TRIGGERS as readonly string[]).includes(String(patch.libraryRecipeTrigger))) {
      throw new UserError("That library recipe cannot run by itself. Choose a recipe pack or Rescan the Roms library.");
    }
    const next = cleanIdleConfig({ ...prev, ...patch }, prev);
    if (next.recipePackId && !(await recipesJson()).packs.some((p) => p.id === next.recipePackId)) {
      throw new UserError(`There is no recipe pack "${next.recipePackId.slice(0, 60)}".`);
    }
    if (next.enabled && !next.recipePackId && !next.libraryRecipeTrigger) throw new UserError("Choose a recipe pack to run before turning idle jobs on.");
    await writeConfig(next);
    say("cyan", "IDLE", next.enabled ? "Idle jobs are on." : "Idle jobs are off.");
    return idleJobsJson();
  });
}

/** Applies a config from a metadata backup: kept switched off, and the last run time stays this machine's. */
export function importIdleConfig(raw: unknown) {
  return serial(async () => {
    const prev = await loadIdleConfig();
    await writeConfig({ ...cleanIdleConfig(raw, prev), enabled: false, lastRunAt: prev.lastRunAt, lastResult: prev.lastResult });
  });
}

/** Why a run would not start now, or "" when it may. Cheap checks first; the Syncthing probe goes over SSH. */
async function blocker(cfg: IdleConfig): Promise<string> {
  if (!cfg.enabled || (!cfg.recipePackId && !cfg.libraryRecipeTrigger)) return "off";
  if (cfg.lastRunAt && Date.now() - cfg.lastRunAt < cfg.cooldownMs) return "cooldown";
  if (jobRunning() || locks.system) return "busy";
  const ssh = await sshStatus().catch(() => null);
  if (!ssh?.configured || !ssh.reachable) return "offline";
  const syncthing = await syncthingIdleJson().catch(() => null);
  if (!syncthing?.idle) return "syncing";
  return "";
}

/** One timer step; exported for tests. Returns what happened. */
export async function idleJobsTick(): Promise<string> {
  if (ticking) return "running";
  ticking = true;
  try {
    const cfg = await loadIdleConfig();
    const why = await blocker(cfg);
    if (why) return why;
    running = true;
    const label = cfg.recipePackId ? `recipe pack ${cfg.recipePackId}` : "library rescan";
    say("cyan", "IDLE", `The handheld is online and Syncthing is idle; running ${label}.`);
    let result: string;
    try {
      if (cfg.recipePackId) {
        const r = await runPack({ id: cfg.recipePackId });
        result = r.ok ? `${r.name}: ${r.done} of ${r.total} steps done.` : `${r.name} stopped after ${r.done} of ${r.total} steps.`;
      } else {
        const lib = await rescanLibrary();
        result = `Library rescanned: ${lib.totals.games} games.`;
      }
    } catch (error) {
      result = `Failed: ${(error as Error).message}`;
      say("yellow", "IDLE", result);
    } finally {
      running = false;
    }
    // Written from fresh config so changes made during the run are kept; the cooldown counts from the finish.
    await serial(async () => writeConfig({ ...(await loadIdleConfig()), lastRunAt: Date.now(), lastResult: result }));
    return "ran";
  } finally {
    ticking = false;
  }
}

let timer: NodeJS.Timeout | undefined;

/** Starts the 60 second timer once; it never keeps the process alive and never throws. */
export function startIdleJobs(): void {
  if (timer) return;
  timer = setInterval(() => { idleJobsTick().catch(() => {}); }, TICK_MS);
  timer.unref();
}

export function stopIdleJobs(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
