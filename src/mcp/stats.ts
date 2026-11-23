// MCP usage stats and a short audit log for the header panel and Settings.

export interface McpAuditEntry {
  at: number;
  tool: string;
  client: string;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface McpSessionInfo {
  id: string;
  created: number;
  lastActive: number;
  client: string;
}

const MAX_AUDIT = 100;
const audit: McpAuditEntry[] = [];
const sessions = new Map<string, McpSessionInfo>();
let callsToday = 0;
let callsSession = 0;
let dayKey = dayStamp();
let startedAt = Date.now();

function dayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function rollDay(): void {
  const d = dayStamp();
  if (d !== dayKey) {
    dayKey = d;
    callsToday = 0;
  }
}

export function mcpMarkStarted(): void {
  startedAt = Date.now();
  callsSession = 0;
}

export function mcpSessionOpen(id: string, client = "mcp"): void {
  sessions.set(id, { id, created: Date.now(), lastActive: Date.now(), client });
}

export function mcpSessionTouch(id: string): void {
  const s = sessions.get(id);
  if (s) s.lastActive = Date.now();
}

export function mcpSessionClose(id: string): void {
  sessions.delete(id);
}

export function mcpSessionCount(): number {
  return sessions.size;
}

export function recordMcpToolCall(entry: Omit<McpAuditEntry, "at">): void {
  rollDay();
  callsToday += 1;
  callsSession += 1;
  audit.unshift({ ...entry, at: Date.now() });
  if (audit.length > MAX_AUDIT) audit.length = MAX_AUDIT;
}

export function mcpStatsJson() {
  rollDay();
  const now = Date.now();
  // Drop stale sessions idle > 30 minutes from the UI list (transport may still hold them).
  for (const [id, s] of sessions) {
    if (now - s.lastActive > 30 * 60_000) sessions.delete(id);
  }
  return {
    startedAt,
    callsToday,
    callsSession,
    sessions: [...sessions.values()].sort((a, b) => b.lastActive - a.lastActive),
    recent: audit.slice(0, 40),
  };
}
