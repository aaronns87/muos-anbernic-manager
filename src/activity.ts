// Activity log: what the manager changed and when. Built from the same lines it prints in its terminal, so every
// action that reports itself there is recorded without extra calls.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "./context.ts";

export interface Activity { t: number; tag: string; level: string; text: string }

/** Startup and housekeeping lines that say nothing about a change. */
const SKIP = new Set(["SERVING", "SCANNED", "TEST", "CLOSED", "RESTART", "STOPPING", "COPYING"]);
const KEEP = 2000;

let file = "";
let pending: Activity[] = [];

function append(entry: Activity): void {
  try { fs.appendFileSync(file, JSON.stringify(entry) + "\n"); } catch {}
}

export function recordActivity(level: string, tag: string, text: string): void {
  if (SKIP.has(tag)) return;
  const entry = { t: Date.now(), tag, level, text };
  if (file) return append(entry);
  pending.push(entry);
  if (pending.length > 200) pending.shift();
}

async function read(): Promise<Activity[]> {
  let text = "";
  try { text = await fsp.readFile(file, "utf8"); } catch { return []; }
  const out: Activity[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

/** Starts writing to the cache folder once main() has settled where that is; earlier lines are kept until then. */
export async function startActivityLog(): Promise<void> {
  file = path.join(ctx.cacheDir, "activity.jsonl");
  await fsp.mkdir(ctx.cacheDir, { recursive: true });
  const all = await read();
  if (all.length > KEEP * 1.5) await fsp.writeFile(file, all.slice(-KEEP).map((e) => JSON.stringify(e) + "\n").join(""));
  for (const entry of pending) append(entry);
  pending = [];
}

const LEVELS: Record<string, string> = { green: "done", cyan: "info", yellow: "warn", red: "error" };

export async function activityJson(query: URLSearchParams) {
  const q = (query.get("q") ?? "").trim().toLowerCase();
  const only = query.get("level") ?? "";
  const limit = Math.min(Math.max(Number(query.get("limit")) || 100, 1), 500);
  const offset = Math.max(Number(query.get("offset")) || 0, 0);
  const all = (await read()).reverse().map((e) => ({ ...e, level: LEVELS[e.level] ?? e.level }));
  const hits = all.filter((e) => (!only || e.level === only) && (!q || `${e.tag} ${e.text}`.toLowerCase().includes(q)));
  return { entries: hits.slice(offset, offset + limit), total: hits.length, all: all.length };
}
