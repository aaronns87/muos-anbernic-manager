// Persistent MCP server settings: enabled flag, bearer token, assistant tool use.

import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "../context.ts";
import { say } from "../log.ts";

export interface McpSettings {
  /** When false, /mcp is not served and the header chip is hidden. Default true. */
  enabled: boolean;
  /** Bearer token for external MCP clients (stable across restarts). */
  token: string;
  /** When true, the in-app Assistant may call MCP tools. Default true. */
  assistantUsesTools: boolean;
}

const DEFAULTS: McpSettings = { enabled: true, token: "", assistantUsesTools: true };

let current: McpSettings = { ...DEFAULTS };
let loaded = false;

const mcpFile = () => path.join(ctx.cacheDir, path.resolve(ctx.managerDir, "..") === ctx.root
  ? "mcp.json"
  : `mcp-${crypto.createHash("sha1").update(ctx.root).digest("hex").slice(0, 12)}.json`);

function newToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

async function save(): Promise<void> {
  await fsp.mkdir(ctx.cacheDir, { recursive: true });
  await fsp.writeFile(mcpFile(), JSON.stringify(current, null, 2) + "\n", { mode: 0o600 });
}

/** Load or create MCP settings. Call once after cacheDir is ready. */
export async function loadMcpSettings(): Promise<void> {
  try {
    const saved = JSON.parse(await fsp.readFile(mcpFile(), "utf8")) as Partial<McpSettings>;
    current = {
      enabled: saved.enabled !== false,
      token: typeof saved.token === "string" && saved.token ? saved.token : newToken(),
      assistantUsesTools: saved.assistantUsesTools !== false,
    };
    if (!saved.token) await save();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      say("yellow", "MCP", `${mcpFile()} could not be read; using defaults.`);
    }
    current = { ...DEFAULTS, token: newToken() };
    await save();
  }
  loaded = true;
}

export function mcpSettings(): Readonly<McpSettings> {
  if (!loaded) throw new Error("MCP settings not loaded yet.");
  return current;
}

export function mcpEnabled(): boolean {
  return loaded ? current.enabled : true;
}

export function mcpTokenOk(given: string): boolean {
  if (!loaded || !current.enabled || !current.token) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(current.token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Public settings for the UI (full token only when requested). */
export function mcpSettingsPublic(opts: { revealToken?: boolean } = {}) {
  const s = mcpSettings();
  return {
    enabled: s.enabled,
    assistantUsesTools: s.assistantUsesTools,
    url: `http://127.0.0.1:${ctx.port}/mcp`,
    token: opts.revealToken ? s.token : "",
    tokenHint: s.token ? `${s.token.slice(0, 4)}…${s.token.slice(-4)}` : "",
    listening: s.enabled && ctx.port > 0,
    bind: "127.0.0.1",
  };
}

export async function saveMcpSettings(body: Record<string, unknown>) {
  if ("enabled" in body) current.enabled = body.enabled !== false && body.enabled !== 0 && body.enabled !== "0";
  if ("assistantUsesTools" in body) {
    current.assistantUsesTools = body.assistantUsesTools !== false && body.assistantUsesTools !== 0 && body.assistantUsesTools !== "0";
  }
  await save();
  return mcpSettingsPublic({ revealToken: false });
}

export async function rotateMcpToken() {
  current.token = newToken();
  await save();
  say("green", "MCP", "MCP bearer token rotated.");
  return mcpSettingsPublic({ revealToken: true });
}

