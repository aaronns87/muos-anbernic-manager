// Shareable recipe packs: a JSON list of handheld steps (core, cheats, CPU governor, tuning) that can be exported,
// imported and run by id. Packs the user imports live in .cache/recipe-packs.json; data/recipes/*.json are
// read-only presets shipped with the manager. Steps call the same functions as the Emulation and Game Tuning tabs.

import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "./context.ts";
import { resetGameCore, setFolderCore, setGameCore } from "./cores.ts";
import { UserError } from "./errors.ts";
import { say } from "./log.ts";
import { removeCheats, saveCheats } from "./tuning/cheats.ts";
import { saveTuning } from "./tuning/tuning.ts";

export const PACK_FORMAT = "muos-recipe-pack";
const MAX_PACKS = 100;
const MAX_STEPS = 100;
const MAX_BYTES = 512 * 1024;

type Body = Record<string, unknown>;

export interface PackStep extends Body { type: string }
export interface RecipePack {
  format: typeof PACK_FORMAT;
  version: 1;
  id: string;
  name: string;
  about: string;
  steps: PackStep[];
}

/** Step types and the fields each one needs (all strings unless noted). */
const STEP_FIELDS: Record<string, { need: string[]; label: string }> = {
  core_folder: { need: ["folder", "system", "core"], label: "Set folder core" },
  core_game: { need: ["folder", "system", "core", "file"], label: "Set game core" },
  core_game_reset: { need: ["folder", "name"], label: "Reset game core" },
  cheats_apply: { need: ["folder", "file", "source"], label: "Apply cheats" },
  cheats_remove: { need: ["folder", "file"], label: "Remove cheats" },
  governor_set: { need: ["folder", "file", "gov"], label: "Set CPU governor" },
  tuning_apply: { need: ["folder", "file"], label: "Apply game tuning" },
};
export const STEP_TYPES = Object.keys(STEP_FIELDS);

const packsFile = () => path.join(ctx.cacheDir, "recipe-packs.json");
const presetsDir = () => path.join(ctx.managerDir, "data", "recipes");

let queue: Promise<unknown> = Promise.resolve();
/** Runs store changes one after another so two requests cannot overwrite each other. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

const text = (v: unknown, max: number) => String(v ?? "").replace(/[\0\r\n]/g, " ").trim().slice(0, max);
const isObject = (v: unknown): v is Body => !!v && typeof v === "object" && !Array.isArray(v);

function cleanStep(raw: unknown, index: number): PackStep {
  const where = `Step ${index + 1}`;
  if (!isObject(raw)) throw new UserError(`${where} is not an object.`);
  const type = String(raw.type ?? "");
  const def = STEP_FIELDS[type];
  if (!def) throw new UserError(`${where}: unknown step type "${text(type, 40)}". Known: ${STEP_TYPES.join(", ")}.`);
  const step: PackStep = { type };
  for (const key of def.need) {
    const v = text(raw[key], 200);
    if (!v) throw new UserError(`${where} (${type}) needs "${key}".`);
    if ((key === "file" || key === "name") && (/[/\\]/.test(v) || v.startsWith("."))) throw new UserError(`${where}: "${key}" must be a file name, not a path.`);
    step[key] = v;
  }
  if (raw.discId !== undefined) step.discId = text(raw.discId, 20);
  if (raw.keepGames !== undefined) step.keepGames = raw.keepGames === true;
  if (type === "cheats_apply") {
    step.on = (Array.isArray(raw.on) ? raw.on : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0).slice(0, 5000);
    step.activate = raw.activate !== false;
  }
  if (type === "tuning_apply") {
    if (raw.gov !== undefined) step.gov = text(raw.gov, 40);
    const values: Record<string, string> = {};
    if (isObject(raw.values)) {
      for (const [k, v] of Object.entries(raw.values).slice(0, 200)) values[text(k, 120)] = text(v, 120);
    }
    step.values = values;
  }
  return step;
}

/** Checks and normalises one pack (from an import, a preset or the store); throws a UserError the app can show. */
export function cleanPack(raw: unknown): RecipePack {
  if (!isObject(raw)) throw new UserError("A recipe pack is a JSON object.");
  if (raw.format !== undefined && raw.format !== PACK_FORMAT) throw new UserError(`This is not a recipe pack (format "${text(raw.format, 40)}").`);
  const name = text(raw.name, 80);
  if (!name) throw new UserError("The pack needs a name.");
  const id = text(raw.id, 60).toLowerCase() || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new UserError("The pack id may only use a-z, 0-9 and dashes.");
  if (!Array.isArray(raw.steps) || !raw.steps.length) throw new UserError("The pack needs at least one step.");
  if (raw.steps.length > MAX_STEPS) throw new UserError(`A pack can have up to ${MAX_STEPS} steps.`);
  return { format: PACK_FORMAT, version: 1, id, name, about: text(raw.about, 300), steps: raw.steps.map(cleanStep) };
}

async function installed(): Promise<RecipePack[]> {
  try {
    const saved = JSON.parse(await fsp.readFile(packsFile(), "utf8")) as { packs?: unknown[] };
    return (saved.packs ?? []).flatMap((p) => { try { return [cleanPack(p)]; } catch { return []; } });
  } catch { return []; }
}

async function presets(): Promise<RecipePack[]> {
  let names: string[] = [];
  try { names = (await fsp.readdir(presetsDir())).filter((n) => n.endsWith(".json")).sort(); } catch { return []; }
  const out: RecipePack[] = [];
  for (const n of names) {
    try { out.push(cleanPack(JSON.parse(await fsp.readFile(path.join(presetsDir(), n), "utf8")))); } catch { /* skip a broken preset */ }
  }
  return out;
}

async function writePacks(packs: RecipePack[]) {
  await fsp.mkdir(ctx.cacheDir, { recursive: true });
  const tmp = `${packsFile()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify({ packs }, null, 2));
  await fsp.rename(tmp, packsFile());
}

const summary = (p: RecipePack, builtin: boolean) => ({
  id: p.id, name: p.name, about: p.about, builtin, steps: p.steps.map((s) => ({ ...s, label: STEP_FIELDS[s.type].label })),
});

export async function recipesJson() {
  const [built, mine] = await Promise.all([presets(), installed()]);
  const ids = new Set(built.map((p) => p.id));
  return { packs: [...built.map((p) => summary(p, true)), ...mine.filter((p) => !ids.has(p.id)).map((p) => summary(p, false))], stepTypes: STEP_TYPES };
}

async function find(id: string): Promise<{ pack: RecipePack; builtin: boolean }> {
  const built = (await presets()).find((p) => p.id === id);
  if (built) return { pack: built, builtin: true };
  const mine = (await installed()).find((p) => p.id === id);
  if (mine) return { pack: mine, builtin: false };
  throw new UserError(`There is no recipe pack "${text(id, 60)}".`);
}

export async function exportPack(query: URLSearchParams) {
  const { pack } = await find(String(query.get("id") ?? ""));
  return { pack, name: `${pack.id}.recipe.json` };
}

/** Adds (or replaces) an installed pack from a pack object or its JSON text. */
export function importPack(body: Body) {
  return serial(async () => {
    let raw: unknown = body.pack;
    if (raw === undefined && typeof body.json === "string") {
      if (body.json.length > MAX_BYTES) throw new UserError("That file is too big to be a recipe pack.");
      try { raw = JSON.parse(body.json); } catch { throw new UserError("That file is not valid JSON."); }
    }
    const pack = cleanPack(raw);
    if ((await presets()).some((p) => p.id === pack.id)) throw new UserError(`"${pack.id}" is a built-in pack. Change the id to import your copy.`);
    const mine = await installed();
    const at = mine.findIndex((p) => p.id === pack.id);
    if (at < 0 && mine.length >= MAX_PACKS) throw new UserError(`You can keep up to ${MAX_PACKS} imported packs.`);
    if (at >= 0) mine[at] = pack; else mine.push(pack);
    await writePacks(mine);
    say("green", "RECIPES", `${at >= 0 ? "Updated" : "Imported"} recipe pack ${pack.name} (${pack.steps.length} steps).`);
    return { ok: true, replaced: at >= 0, id: pack.id, ...(await recipesJson()) };
  });
}

/** Replaces the imported packs with the valid ones in a list (a metadata restore); returns how many were kept. */
export function replacePacks(raw: unknown[]) {
  return serial(async () => {
    const seen = new Set((await presets()).map((p) => p.id));
    const packs: RecipePack[] = [];
    for (const item of raw) {
      try {
        const pack = cleanPack(item);
        if (seen.has(pack.id)) continue;
        seen.add(pack.id);
        packs.push(pack);
      } catch { /* skip a damaged pack */ }
      if (packs.length >= MAX_PACKS) break;
    }
    await writePacks(packs);
    return packs.length;
  });
}

export function deletePack(body: Body) {
  return serial(async () => {
    const id = String(body.id ?? "");
    if ((await presets()).some((p) => p.id === id)) throw new UserError("Built-in packs cannot be removed.");
    const mine = await installed();
    if (!mine.some((p) => p.id === id)) throw new UserError(`There is no recipe pack "${text(id, 60)}".`);
    await writePacks(mine.filter((p) => p.id !== id));
    say("yellow", "RECIPES", `Removed recipe pack ${id}.`);
    return recipesJson();
  });
}

async function runStep(s: PackStep) {
  switch (s.type) {
    case "core_folder": return setFolderCore(s);
    case "core_game": return setGameCore(s);
    case "core_game_reset": return resetGameCore(s);
    case "cheats_apply": return saveCheats(s);
    case "cheats_remove": return removeCheats(s);
    case "governor_set": return saveTuning({ folder: s.folder, file: s.file, discId: s.discId, gov: s.gov, values: {} });
    case "tuning_apply": return saveTuning(s);
    default: throw new UserError(`Unknown step type ${s.type}.`);
  }
}

/** Runs a pack's steps in order and stops at the first one that fails; the handheld must be reachable over SSH. */
export async function runPack(body: Body) {
  const { pack } = await find(String(body.id ?? ""));
  const results: { type: string; label: string; ok: boolean; error?: string }[] = [];
  say("cyan", "RECIPES", `Running recipe pack ${pack.name} (${pack.steps.length} steps).`);
  for (const step of pack.steps) {
    const label = STEP_FIELDS[step.type].label;
    try {
      await runStep(step);
      results.push({ type: step.type, label, ok: true });
    } catch (error) {
      results.push({ type: step.type, label, ok: false, error: (error as Error).message });
      break;
    }
  }
  const failed = results.find((r) => !r.ok);
  say(failed ? "yellow" : "green", "RECIPES", failed ? `Recipe pack ${pack.name} stopped: ${failed.error}` : `Recipe pack ${pack.name} finished.`);
  return { ok: !failed, id: pack.id, name: pack.name, done: results.filter((r) => r.ok).length, total: pack.steps.length, results };
}
