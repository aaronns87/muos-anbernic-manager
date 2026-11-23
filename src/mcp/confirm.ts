// One-shot confirm tokens for destructive MCP tools: a first call returns a confirmId and a summary without
// doing anything; repeating the call with that confirmId (same arguments) executes it once.

import { randomBytes } from "node:crypto";
import { UserError } from "../errors.ts";

export const CONFIRM_TTL_MS = 5 * 60_000;
const MAX_PENDING = 200;

export interface PendingConfirm {
  tool: string;
  summary: string;
  /** The arguments the user was shown. The confirmed call must repeat them exactly. */
  payload: Record<string, unknown>;
  /** Extra arguments merged in when the confirmed call runs (e.g. the confirm string system_start needs). */
  extra: Record<string, unknown>;
  expires: number;
}

const pending = new Map<string, PendingConfirm>();

/** Key order does not matter when comparing payloads. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sweep(now: number): void {
  for (const [id, c] of pending) if (c.expires <= now) pending.delete(id);
  while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value as string);
}

export function createConfirm(opts: {
  tool: string;
  summary: string;
  payload?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}): { confirmId: string; summary: string; expiresInSec: number } {
  const now = Date.now();
  sweep(now);
  const confirmId = `cf_${randomBytes(9).toString("base64url")}`;
  pending.set(confirmId, {
    tool: opts.tool, summary: opts.summary, payload: opts.payload ?? {}, extra: opts.extra ?? {}, expires: now + CONFIRM_TTL_MS,
  });
  return { confirmId, summary: opts.summary, expiresInSec: CONFIRM_TTL_MS / 1000 };
}

/** Validates and consumes a token. It works once, for the tool and arguments it was issued for. */
export function takeConfirm(id: unknown, tool: string, payload: Record<string, unknown> = {}): PendingConfirm {
  const key = String(id ?? "");
  const found = pending.get(key);
  if (!found) throw new UserError("That confirmId is unknown or was already used. Call the tool again without confirmId to get a new one.");
  pending.delete(key);
  if (found.expires <= Date.now()) throw new UserError("That confirmId expired. Call the tool again without confirmId to get a new one.");
  if (found.tool !== tool) throw new UserError(`That confirmId was issued for ${found.tool}, not ${tool}.`);
  if (stable(found.payload) !== stable(payload)) throw new UserError("The arguments changed since the confirmId was issued. Call the tool again without confirmId.");
  return found;
}

export function pendingConfirmCount(): number {
  sweep(Date.now());
  return pending.size;
}

export function clearConfirms(): void {
  pending.clear();
}
