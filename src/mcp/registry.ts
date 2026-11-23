// Shared MCP / Assistant tool registry: Zod schemas, OpenAI tool defs, execution + audit.

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { UserError } from "../errors.ts";
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

export interface RegisteredTool {
  name: string;
  group: ToolGroup;
  description: string;
  /** Zod object shape for MCP registerTool inputSchema. */
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const tools = new Map<string, RegisteredTool>();

export function defineTool(def: RegisteredTool): void {
  if (tools.has(def.name)) throw new Error(`MCP tool already registered: ${def.name}`);
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

/** OpenAI-compatible tools array for the in-app chat completions loop. */
export function openaiTools(): { type: "function"; function: { name: string; description: string; parameters: unknown } }[] {
  return listTools().map((t) => {
    const schema = z.toJSONSchema(t.inputSchema) as Record<string, unknown>;
    delete schema.$schema;
    return {
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: schema,
      },
    };
  });
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
    const parsed = tool.inputSchema.parse(args ?? {});
    const result = await tool.handler(parsed as Record<string, unknown>);
    recordMcpToolCall({ tool: name, client, ok: true, ms: Date.now() - started });
    return { ok: true, result };
  } catch (err) {
    const error = err instanceof UserError || err instanceof Error ? err.message : String(err);
    recordMcpToolCall({ tool: name, client, ok: false, ms: Date.now() - started, error });
    return { ok: false, error };
  }
}

/** Attach every registered tool to an MCP server instance. */
export function attachToolsToMcp(server: McpServer, clientLabel = "mcp"): void {
  for (const t of listTools()) {
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
