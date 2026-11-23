// Shared MCP / Assistant tool registry: Zod schemas, OpenAI tool defs, execution + audit.

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { UserError } from "../errors.ts";
import { createConfirm, takeConfirm } from "./confirm.ts";
import { recordMcpToolCall } from "./stats.ts";
import { TOOL_DETAILS } from "./tool-details.ts";

export type ToolGroup =
  | "library"
  | "device"
  | "jobs"
  | "bios"
  | "saves"
  | "emulation"
  | "files"
  | "apps"
  | "themes"
  | "os"
  | "artwork"
  | "play"
  | "system"
  | "meta";

/** Marks a tool destructive: it needs a confirmId from a first call before it runs (see confirm.ts). */
export interface ConfirmSpec {
  /** One plain sentence saying what will happen, shown back to the user. */
  summary: (args: Record<string, unknown>) => string;
  /** True when the arguments already carry their own confirmation (system_start's confirm string). */
  satisfied?: (args: Record<string, unknown>) => boolean;
  /** Arguments stored with the confirmId and merged in when it is used. */
  extra?: (args: Record<string, unknown>) => Record<string, unknown>;
}

export interface RegisteredTool {
  name: string;
  group: ToolGroup;
  description: string;
  /** Zod object shape for MCP registerTool inputSchema. */
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  /** Destructive tools: first call returns { needsConfirm, confirmId, summary } without running. */
  confirm?: ConfirmSpec;
}

const CONFIRM_HINT = " Destructive: the first call only returns needsConfirm + confirmId + summary; repeat the same arguments with that confirmId after the user agrees (dryRun:true previews again).";

const tools = new Map<string, RegisteredTool>();

export function defineTool(def: RegisteredTool): void {
  if (tools.has(def.name)) throw new Error(`MCP tool already registered: ${def.name}`);
  if (def.confirm) {
    def = {
      ...def,
      description: def.description + CONFIRM_HINT,
      inputSchema: def.inputSchema.extend({
        confirmId: z.string().optional().describe("From a previous needsConfirm result for these exact arguments"),
        dryRun: z.boolean().optional().describe("Only return the confirmId and summary"),
      }),
    };
  }
  tools.set(def.name, def);
}

export function listTools(): RegisteredTool[] {
  return [...tools.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function toolCatalogue() {
  const byGroup: Record<string, string[]> = {};
  for (const t of listTools()) {
    (byGroup[t.group] ??= []).push(t.name);
  }
  return {
    count: tools.size,
    groups: byGroup,
    tools: listTools().map((t) => ({
      name: t.name,
      group: t.group,
      description: t.description,
      detail: TOOL_DETAILS[t.name] || t.description,
    })),
  };
}

type OpenAiTool = { type: "function"; function: { name: string; description: string; parameters: unknown } };

function toOpenAiTool(t: RegisteredTool): OpenAiTool {
  const schema = z.toJSONSchema(t.inputSchema) as Record<string, unknown>;
  delete schema.$schema;
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: schema,
    },
  };
}

/** Full OpenAI-compatible tools array (IDE / MCP clients; may exceed host chat limits). */
export function openaiTools(): OpenAiTool[] {
  return listTools().map(toOpenAiTool);
}

/**
 * Groq free tier is ~8k TPM and hard-caps 128 tools. Full JSON schemas for dozens of
 * tools blow the budget before CONTEXT. Chat gets a small priority subset with compact
 * schemas (Zod still validates on execute). IDE MCP clients keep the full catalogue.
 */
export const ASSISTANT_TOOL_LIMIT = 24;

/** High-priority names the Assistant should always keep when capping. */
const ASSISTANT_TOOL_PRIORITY = [
  "apps_list", "ports_list", "market_list",
  "library_list", "library_search", "library_rescan", "game_get",
  "connection_status", "device_status", "web_services_status", "wifi_find", "syncthing_status",
  "logs_list", "activity_list", "manager_status", "workspace_info",
  "recipes_list", "recipes_run",
  "handheld_settings_get", "controls_snapshot",
  "play_activity", "collections_list",
  "bios_list", "saves_overview", "saves_game_list", "homebrew_list", "benchmark_status",
  "job_list", "job_get", "transfer_plan",
  "themes_list", "files_roots", "files_list", "files_read",
  "artwork_get_plan", "artwork_scrape_plan", "checks_status",
  "system_cards", "system_job_get", "os_images_list",
  "cores_list", "tuning_list", "tuning_game_get", "retroarch_get",
  "mcp_tool_catalogue", "mcp_stats",
];

const GROUP_PRIORITY: Record<ToolGroup, number> = {
  meta: 0, apps: 1, library: 2, device: 3, play: 4, jobs: 5, bios: 6, saves: 7,
  artwork: 8, emulation: 9, files: 10, themes: 11, os: 12, system: 13,
};

/** Compact parameters for chat: keeps prompt tokens down; handlers still Zod-parse args. */
function compactChatParameters(t: RegisteredTool): Record<string, unknown> {
  try {
    const schema = z.toJSONSchema(t.inputSchema) as Record<string, unknown>;
    delete schema.$schema;
    const props = (schema.properties && typeof schema.properties === "object")
      ? schema.properties as Record<string, unknown>
      : {};
    const slim: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(props)) {
      const p = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      slim[key] = { type: p.type || "string" };
    }
    return {
      type: "object",
      properties: slim,
      required: Array.isArray(schema.required) ? schema.required : [],
      additionalProperties: true,
    };
  } catch {
    return { type: "object", properties: {}, additionalProperties: true };
  }
}

/** OpenAI tools for the in-app chat loop, capped for provider limits. */
export function openaiToolsForChat(limit = ASSISTANT_TOOL_LIMIT): OpenAiTool[] {
  const cap = Math.max(8, Math.min(128, limit | 0));
  const all = listTools();
  const rank = new Map(ASSISTANT_TOOL_PRIORITY.map((n, i) => [n, i]));
  const sorted = [...all].sort((a, b) => {
    const ra = rank.has(a.name) ? rank.get(a.name)! : 1000;
    const rb = rank.has(b.name) ? rank.get(b.name)! : 1000;
    if (ra !== rb) return ra - rb;
    const ga = GROUP_PRIORITY[a.group] ?? 50;
    const gb = GROUP_PRIORITY[b.group] ?? 50;
    if (ga !== gb) return ga - gb;
    return a.name.localeCompare(b.name);
  });
  return sorted.slice(0, cap).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: compactChatParameters(t),
    },
  }));
}

async function runConfirmed(tool: RegisteredTool, spec: ConfirmSpec, parsed: Record<string, unknown>): Promise<unknown> {
  const { confirmId, dryRun, ...args } = parsed;
  const preview = () => {
    const extra = spec.extra?.(args) ?? {};
    const made = createConfirm({ tool: tool.name, summary: spec.summary(args), payload: args, extra });
    return { needsConfirm: true, tool: tool.name, ...made, next: "Show the summary to the user. If they agree, call again with the same arguments plus confirmId." };
  };
  if (dryRun === true) return preview();
  if (confirmId) return tool.handler({ ...args, ...takeConfirm(confirmId, tool.name, args).extra });
  if (spec.satisfied?.(args)) return tool.handler(args);
  return preview();
}

export async function executeTool(
  name: string,
  args: Record<string, unknown> | undefined,
  client = "assistant",
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const tool = tools.get(name);
  const started = Date.now();
  if (!tool) {
    const error = `Unknown tool: ${name}`;
    recordMcpToolCall({ tool: name, client, ok: false, ms: 0, error });
    return { ok: false, error };
  }
  try {
    const parsed = tool.inputSchema.parse(args ?? {}) as Record<string, unknown>;
    const result = tool.confirm ? await runConfirmed(tool, tool.confirm, parsed) : await tool.handler(parsed);
    recordMcpToolCall({ tool: name, client, ok: true, ms: Date.now() - started });
    return { ok: true, result };
  } catch (err) {
    const error = err instanceof UserError || err instanceof Error ? err.message : String(err);
    recordMcpToolCall({ tool: name, client, ok: false, ms: Date.now() - started, error });
    return { ok: false, error };
  }
}

/** Attach every registered tool to an MCP server instance. */
export function attachToolsToMcp(server: McpServer, clientLabel = "mcp", allow?: (name: string) => boolean): void {
  for (const t of listTools()) {
    if (allow && !allow(t.name)) continue;
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.inputSchema.shape },
      async (args) => {
        const out = await executeTool(t.name, args as Record<string, unknown>, clientLabel);
        if (!out.ok) {
          return { content: [{ type: "text" as const, text: out.error || "Tool failed" }], isError: true };
        }
        const text = typeof out.result === "string" ? out.result : JSON.stringify(out.result, null, 2);
        return { content: [{ type: "text" as const, text }] };
      },
    );
  }
}

export function textResult(data: unknown): string {
  return typeof data === "string" ? data : JSON.stringify(data, null, 2);
}
