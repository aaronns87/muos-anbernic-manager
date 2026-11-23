// Streamable HTTP MCP endpoint mounted at /mcp on the manager's localhost server.

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { runningVersion } from "../manager-update.ts";
import { attachAgentsToMcp } from "./attach-agents.ts";
import { mcpServerIcons } from "./icons.ts";
import { MCP_SERVER_DESCRIPTION, MCP_SERVER_NAME } from "./names.ts";
import { attachToolsToMcp } from "./registry.ts";
import { guestToolAllowed } from "./guest.ts";
import { mcpEnabled, mcpTokenOk, type McpRole } from "./settings.ts";
import { mcpSessionClose, mcpSessionOpen, mcpSessionTouch } from "./stats.ts";

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  role: McpRole;
}

const sessions = new Map<string, Session>();
const MAX_SESSIONS = 32;

async function createMcpServer(role: McpRole): Promise<McpServer> {
  const version = await runningVersion().catch(() => "0.0.0");
  const icons = await mcpServerIcons();
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version,
    title: MCP_SERVER_NAME,
    description: MCP_SERVER_DESCRIPTION,
    ...(icons.length ? { icons } : {}),
  });
  if (role === "guest") attachToolsToMcp(server, "mcp-guest", guestToolAllowed);
  else attachToolsToMcp(server, "mcp");
  await attachAgentsToMcp(server);
  return server;
}

function bearerToken(req: IncomingMessage): string {
  const h = String(req.headers.authorization ?? "");
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (m) return m[1].trim();
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  return url.searchParams.get("token") ?? "";
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

/** True when this request should be handled as MCP (/mcp). */
export function isMcpPath(pathname: string): boolean {
  return pathname === "/mcp" || pathname.startsWith("/mcp/");
}

/** First tools/call in a guest request body that is not allowlisted, if any (bodies may be batches). */
function deniedGuestCall(body: unknown): { id: unknown; tool: string } | undefined {
  for (const msg of Array.isArray(body) ? body : [body]) {
    const m = msg as { id?: unknown; method?: unknown; params?: { name?: unknown } } | undefined;
    if (m?.method !== "tools/call") continue;
    const tool = String(m.params?.name ?? "");
    if (!guestToolAllowed(tool)) return { id: m.id ?? null, tool };
  }
  return undefined;
}

export async function handleMcpHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!mcpEnabled()) {
    sendJson(res, 404, { error: "MCP server is turned off in Tools → MCP." });
    return;
  }
  const role = mcpTokenOk(bearerToken(req));
  if (!role) {
    sendJson(res, 401, { error: "Missing or wrong MCP bearer token. Copy it from Tools → MCP." });
    return;
  }

  const method = req.method ?? "GET";
  const sessionId = String(req.headers["mcp-session-id"] ?? "");

  try {
    if (method === "POST") {
      const body = await readJsonBody(req);
      const existing = sessionId ? sessions.get(sessionId) : undefined;

      if (role === "guest") {
        const denied = deniedGuestCall(body);
        if (denied) {
          sendJson(res, 200, {
            jsonrpc: "2.0",
            error: { code: -32601, message: `Tool "${denied.tool}" is not allowed for the read-only guest token. Use the full token from Tools → MCP.` },
            id: denied.id,
          });
          return;
        }
      }
      if (existing && existing.role !== role) {
        sendJson(res, 403, { jsonrpc: "2.0", error: { code: -32002, message: "This session belongs to a different token." }, id: null });
        return;
      }

      if (existing) {
        mcpSessionTouch(sessionId);
        await existing.transport.handleRequest(req, res, body);
        return;
      }

      if (!sessionId && body && isInitializeRequest(body)) {
        if (sessions.size >= MAX_SESSIONS) {
          sendJson(res, 503, { jsonrpc: "2.0", error: { code: -32000, message: "Too many MCP sessions" }, id: null });
          return;
        }
        const server = await createMcpServer(role);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { transport, server, role });
            mcpSessionOpen(id, role === "guest" ? "mcp-guest" : "mcp");
          },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && sessions.has(sid)) {
            sessions.delete(sid);
            mcpSessionClose(sid);
          }
        };
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }

      if (sessionId) {
        sendJson(res, 404, { jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
        return;
      }
      sendJson(res, 400, { jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: no session id" }, id: null });
      return;
    }

    if (method === "GET" || method === "DELETE") {
      if (!sessionId) {
        sendJson(res, 400, { error: "Missing mcp-session-id header" });
        return;
      }
      const session = sessions.get(sessionId);
      if (session && session.role !== role) {
        sendJson(res, 403, { jsonrpc: "2.0", error: { code: -32002, message: "This session belongs to a different token." }, id: null });
        return;
      }
      if (!session) {
        sendJson(res, 404, { jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
        return;
      }
      mcpSessionTouch(sessionId);
      await session.transport.handleRequest(req, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("MCP request failed:", error);
    sendJson(res, 500, {
      jsonrpc: "2.0",
      error: { code: -32603, message: error instanceof Error ? error.message : "Internal error" },
      id: null,
    });
  }
}

export function closeAllMcpSessions(): void {
  for (const [id, s] of sessions) {
    try { void s.transport.close(); } catch { /* ignore */ }
    try { void s.server.close(); } catch { /* ignore */ }
    sessions.delete(id);
    mcpSessionClose(id);
  }
}
