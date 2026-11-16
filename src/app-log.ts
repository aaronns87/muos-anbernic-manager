// Application diagnostic log: streams errors, warnings, say() lines and exceptions into
// daily JSONL files under the workspace logs/ folder for the Logs section viewer.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "./context.ts";
import { UserError } from "./errors.ts";
import { platform } from "./platform/index.ts";

export type LogLevel = "debug" | "info" | "done" | "warn" | "error";
export type LogSource = "app" | "console" | "http" | "browser" | "process";

export interface LogEntry {
  t: number;
  level: LogLevel;
  source: LogSource;
  tag: string;
  text: string;
  stack?: string;
}

const KEEP_DAYS = 14;
const FILE_RE = /^manager-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const LEVELS: LogLevel[] = ["debug", "info", "done", "warn", "error"];
const BADGE_LEVEL: Record<string, LogLevel> = { green: "done", cyan: "info", yellow: "warn", red: "error" };

let dir = "";
let day = "";
let file = "";
let pending: LogEntry[] = [];
let capturing = false;
let origWarn: typeof console.warn | null = null;
let origError: typeof console.error | null = null;

const isoDay = (d = new Date()) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dayN = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dayN}`;
};

const fileFor = (d: string) => path.join(dir || ctx.logs, `manager-${d}.jsonl`);

function ensureToday(): void {
  const today = isoDay();
  if (day === today && file) return;
  day = today;
  file = fileFor(today);
}

function append(entry: LogEntry): void {
  if (!dir) {
    pending.push(entry);
    if (pending.length > 500) pending.shift();
    return;
  }
  ensureToday();
  try { fs.appendFileSync(file, JSON.stringify(entry) + "\n"); } catch { /* never throw from logging */ }
}

/** Writes one diagnostic line. Safe to call before startAppLog(); early lines are buffered. */
export function appLog(level: LogLevel, source: LogSource, tag: string, text: string, stack?: string): void {
  const entry: LogEntry = { t: Date.now(), level, source, tag: tag.slice(0, 64), text: String(text).slice(0, 8000) };
  if (stack) entry.stack = String(stack).slice(0, 16000);
  append(entry);
}

/** Maps a terminal badge colour from say() into a log level. */
export function appLogFromSay(badge: string, tag: string, text: string): void {
  appLog(BADGE_LEVEL[badge] ?? "info", "app", tag, text);
}

function formatArg(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function consoleLine(args: unknown[]): { text: string; stack?: string } {
  const err = args.find((a) => a instanceof Error) as Error | undefined;
  const text = args.map(formatArg).join(" ");
  return err?.stack ? { text: err.message || text, stack: err.stack } : { text };
}

/** Patches console.warn/error and process exception hooks once. */
export function installLogCaptures(): void {
  if (capturing) return;
  capturing = true;
  origWarn = console.warn.bind(console);
  origError = console.error.bind(console);
  console.warn = (...args: unknown[]) => {
    const { text, stack } = consoleLine(args);
    appLog("warn", "console", "CONSOLE", text, stack);
    origWarn!(...args);
  };
  console.error = (...args: unknown[]) => {
    const { text, stack } = consoleLine(args);
    appLog("error", "console", "CONSOLE", text, stack);
    origError!(...args);
  };
  process.on("uncaughtException", (error) => {
    appLog("error", "process", "UNCAUGHT", error.message || String(error), error.stack);
    origError!(error);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    appLog("error", "process", "UNHANDLED", err.message, err.stack);
    origError!(err);
  });
}

async function pruneOld(): Promise<void> {
  if (!dir) return;
  let names: string[] = [];
  try { names = await fsp.readdir(dir); } catch { return; }
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  for (const name of names) {
    const m = FILE_RE.exec(name);
    if (!m) continue;
    const t = Date.parse(`${m[1]}T00:00:00`);
    if (!Number.isFinite(t) || t >= cutoff) continue;
    try { await fsp.rm(path.join(dir, name), { force: true }); } catch { /* ignore */ }
  }
}

async function listDays(): Promise<string[]> {
  if (!dir) return [];
  let names: string[] = [];
  try { names = await fsp.readdir(dir); } catch { return []; }
  return names.map((n) => FILE_RE.exec(n)?.[1]).filter((d): d is string => !!d).sort().reverse();
}

async function readDay(d: string): Promise<LogEntry[]> {
  if (!DAY_RE.test(d)) return [];
  let text = "";
  try { text = await fsp.readFile(fileFor(d), "utf8"); } catch { return []; }
  const out: LogEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const e = JSON.parse(line) as LogEntry;
      if (e && typeof e.t === "number" && e.text) out.push(e);
    } catch { /* skip bad lines */ }
  }
  return out;
}

/** Opens the logs folder, flushes the buffer, prunes old files. Call after loadSettings(). */
export async function startAppLog(): Promise<void> {
  dir = ctx.logs;
  await fsp.mkdir(dir, { recursive: true });
  ensureToday();
  await pruneOld();
  for (const entry of pending) append(entry);
  pending = [];
  appLog("info", "app", "LOG", `Writing application logs to ${dir}`);
}

function filterEntries(all: LogEntry[], q: string, level: string): LogEntry[] {
  const needle = q.trim().toLowerCase();
  return all.filter((e) => {
    if (level && e.level !== level) return false;
    if (!needle) return true;
    return `${e.tag} ${e.text} ${e.source} ${e.stack || ""}`.toLowerCase().includes(needle);
  });
}

/** List/search API for the Logs section. */
export async function logsJson(query: URLSearchParams) {
  const q = query.get("q") ?? "";
  const level = query.get("level") ?? "";
  if (level && !LEVELS.includes(level as LogLevel)) throw new UserError("Unknown log level.");
  const days = await listDays();
  const wanted = query.get("day") || days[0] || isoDay();
  if (!DAY_RE.test(wanted)) throw new UserError("Day must be YYYY-MM-DD.");
  const limit = Math.min(Math.max(Number(query.get("limit")) || 200, 1), 1000);
  const offset = Math.max(Number(query.get("offset")) || 0, 0);
  const all = (await readDay(wanted)).toReversed();
  const hits = filterEntries(all, q, level);
  return {
    entries: hits.slice(offset, offset + limit),
    total: hits.length,
    all: all.length,
    day: wanted,
    days,
    dir: ctx.logs,
  };
}

/** Download filtered or whole-day log as an attachment. */
export async function logsDownload(query: URLSearchParams) {
  const q = query.get("q") ?? "";
  const level = query.get("level") ?? "";
  if (level && !LEVELS.includes(level as LogLevel)) throw new UserError("Unknown log level.");
  const days = await listDays();
  const wanted = query.get("day") || days[0] || isoDay();
  if (!DAY_RE.test(wanted)) throw new UserError("Day must be YYYY-MM-DD.");
  const format = query.get("format") === "txt" ? "txt" : "jsonl";
  const all = (await readDay(wanted)).toReversed();
  const hits = filterEntries(all, q, level);
  const name = `manager-${wanted}${q || level ? "-filtered" : ""}.${format}`;
  if (format === "txt") {
    const lines = hits.map((e) => {
      const when = new Date(e.t).toISOString();
      const stack = e.stack ? `\n${e.stack}` : "";
      return `${when} [${e.level}] ${e.source}/${e.tag} ${e.text}${stack}`;
    });
    return { download: Buffer.from(lines.join("\n") + (lines.length ? "\n" : ""), "utf8"), name, type: "text/plain; charset=utf-8" };
  }
  return {
    download: Buffer.from(hits.map((e) => JSON.stringify(e)).join("\n") + (hits.length ? "\n" : ""), "utf8"),
    name,
    type: "application/x-ndjson; charset=utf-8",
  };
}

/** Accept a browser-side error/warning. */
export function logsPost(body: Record<string, unknown>) {
  const levelRaw = String(body.level ?? "error");
  const level = (LEVELS.includes(levelRaw as LogLevel) ? levelRaw : "error") as LogLevel;
  const tag = String(body.tag ?? "BROWSER").slice(0, 64) || "BROWSER";
  const text = String(body.text ?? "").slice(0, 8000);
  if (!text.trim()) throw new UserError("Log text is required.");
  const stack = body.stack != null ? String(body.stack).slice(0, 16000) : undefined;
  appLog(level, "browser", tag, text, stack);
  return { ok: true };
}

/** Deletes one day or every log file. */
export async function logsClear(body: Record<string, unknown>) {
  const dayWanted = body.day != null ? String(body.day) : "";
  if (dayWanted) {
    if (!DAY_RE.test(dayWanted)) throw new UserError("Day must be YYYY-MM-DD.");
    await fsp.rm(fileFor(dayWanted), { force: true });
    if (dayWanted === day) { day = ""; file = ""; }
    return { ok: true, cleared: dayWanted };
  }
  const days = await listDays();
  for (const d of days) await fsp.rm(fileFor(d), { force: true });
  day = "";
  file = "";
  return { ok: true, cleared: "all", count: days.length };
}

/** Opens the logs folder in the system file manager. */
export async function logsReveal() {
  if (!(await fsp.stat(ctx.logs).then((s) => s.isDirectory()).catch(() => false))) {
    await fsp.mkdir(ctx.logs, { recursive: true });
  }
  platform.openUrl(ctx.logs);
  return { ok: true, path: ctx.logs };
}

/** Test helpers: reset in-memory state (does not delete files). */
export function _resetAppLogForTests(): void {
  dir = "";
  day = "";
  file = "";
  pending = [];
}
