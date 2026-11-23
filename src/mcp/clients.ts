// Detect local agentic IDEs, build MCP config snippets, and optionally merge them into client config files.

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { MCP_SERVER_DESCRIPTION, MCP_SERVER_LEGACY_KEYS, MCP_SERVER_NAME } from "./names.ts";
import { mcpSettings } from "./settings.ts";

export type McpClientFormat = "cursor-json" | "claude-desktop-json" | "codex-toml";
export type McpClientId = "cursor" | "claude-desktop" | "claude-code" | "codex" | "windsurf";

export interface McpClientDef {
  id: McpClientId;
  label: string;
  blurb: string;
  format: McpClientFormat;
  /** Config file path when present (or the path we would create). */
  configPath: string;
  /** User-global skills directory, if this client supports SKILL.md installs. */
  skillsDir?: string;
  /** How we decide the IDE looks installed. */
  detect: () => Promise<boolean>;
}

const SERVER_KEY = MCP_SERVER_NAME;
const ALL_SERVER_KEYS = [SERVER_KEY, ...MCP_SERVER_LEGACY_KEYS];
const home = () => os.homedir();

function darwinApp(name: string): string {
  return path.join("/Applications", `${name}.app`);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function anyExists(...paths: string[]): Promise<boolean> {
  for (const p of paths) if (await exists(p)) return true;
  return false;
}

function platformConfigPaths(): Record<McpClientId, { config: string; markers: string[]; skillsDir?: string }> {
  const h = home();
  if (process.platform === "darwin") {
    return {
      cursor: {
        config: path.join(h, ".cursor", "mcp.json"),
        skillsDir: path.join(h, ".cursor", "skills"),
        markers: [darwinApp("Cursor"), path.join(h, ".cursor"), path.join(h, "Library", "Application Support", "Cursor")],
      },
      "claude-desktop": {
        config: path.join(h, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
        markers: [darwinApp("Claude"), path.join(h, "Library", "Application Support", "Claude")],
      },
      "claude-code": {
        config: path.join(h, ".claude.json"),
        skillsDir: path.join(h, ".claude", "skills"),
        markers: [path.join(h, ".claude.json"), path.join(h, ".claude")],
      },
      codex: {
        config: path.join(h, ".codex", "config.toml"),
        skillsDir: path.join(h, ".agents", "skills"),
        markers: [path.join(h, ".codex"), path.join(h, "Library", "Application Support", "Codex"), darwinApp("Codex")],
      },
      windsurf: {
        config: path.join(h, ".codeium", "windsurf", "mcp_config.json"),
        markers: [
          darwinApp("Windsurf"),
          path.join(h, ".codeium", "windsurf"),
          path.join(h, "Library", "Application Support", "Windsurf"),
        ],
      },
    };
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(h, "AppData", "Roaming");
    return {
      cursor: {
        config: path.join(h, ".cursor", "mcp.json"),
        skillsDir: path.join(h, ".cursor", "skills"),
        markers: [path.join(h, ".cursor"), path.join(appData, "Cursor")],
      },
      "claude-desktop": {
        config: path.join(appData, "Claude", "claude_desktop_config.json"),
        markers: [path.join(appData, "Claude")],
      },
      "claude-code": {
        config: path.join(h, ".claude.json"),
        skillsDir: path.join(h, ".claude", "skills"),
        markers: [path.join(h, ".claude.json"), path.join(h, ".claude")],
      },
      codex: {
        config: path.join(h, ".codex", "config.toml"),
        skillsDir: path.join(h, ".agents", "skills"),
        markers: [path.join(h, ".codex"), path.join(appData, "Codex")],
      },
      windsurf: {
        config: path.join(h, ".codeium", "windsurf", "mcp_config.json"),
        markers: [path.join(h, ".codeium", "windsurf"), path.join(appData, "Windsurf")],
      },
    };
  }
  // linux
  const cfg = process.env.XDG_CONFIG_HOME || path.join(h, ".config");
  return {
    cursor: {
      config: path.join(h, ".cursor", "mcp.json"),
      skillsDir: path.join(h, ".cursor", "skills"),
      markers: [path.join(h, ".cursor"), path.join(cfg, "Cursor")],
    },
    "claude-desktop": {
      config: path.join(cfg, "Claude", "claude_desktop_config.json"),
      markers: [path.join(cfg, "Claude")],
    },
    "claude-code": {
      config: path.join(h, ".claude.json"),
      skillsDir: path.join(h, ".claude", "skills"),
      markers: [path.join(h, ".claude.json"), path.join(h, ".claude")],
    },
    codex: {
      config: path.join(h, ".codex", "config.toml"),
      skillsDir: path.join(h, ".agents", "skills"),
      markers: [path.join(h, ".codex")],
    },
    windsurf: {
      config: path.join(h, ".codeium", "windsurf", "mcp_config.json"),
      markers: [path.join(h, ".codeium", "windsurf"), path.join(cfg, "Windsurf")],
    },
  };
}

/** Skill install roots for clients that support SKILL.md (undefined = copy-only). */
export function clientSkillDirs(): Partial<Record<McpClientId, string>> {
  const paths = platformConfigPaths();
  const out: Partial<Record<McpClientId, string>> = {};
  for (const id of Object.keys(paths) as McpClientId[]) {
    if (paths[id].skillsDir) out[id] = paths[id].skillsDir;
  }
  return out;
}

function clientDefs(): McpClientDef[] {
  const paths = platformConfigPaths();
  return [
    {
      id: "cursor",
      label: "Cursor",
      blurb: "Global ~/.cursor/mcp.json — Streamable HTTP with bearer token.",
      format: "cursor-json",
      configPath: paths.cursor.config,
      skillsDir: paths.cursor.skillsDir,
      detect: () => anyExists(...paths.cursor.markers),
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      blurb: "Claude desktop app MCP servers (type: http).",
      format: "claude-desktop-json",
      configPath: paths["claude-desktop"].config,
      detect: () => anyExists(...paths["claude-desktop"].markers),
    },
    {
      id: "claude-code",
      label: "Claude Code",
      blurb: "Claude Code CLI / ~/.claude.json mcpServers entry.",
      format: "claude-desktop-json",
      configPath: paths["claude-code"].config,
      skillsDir: paths["claude-code"].skillsDir,
      detect: () => anyExists(...paths["claude-code"].markers),
    },
    {
      id: "codex",
      label: "Codex",
      blurb: "OpenAI Codex ~/.codex/config.toml [mcp_servers] block.",
      format: "codex-toml",
      configPath: paths.codex.config,
      skillsDir: paths.codex.skillsDir,
      detect: () => anyExists(...paths.codex.markers),
    },
    {
      id: "windsurf",
      label: "Windsurf",
      blurb: "Codeium Windsurf mcp_config.json (Cursor-compatible JSON).",
      format: "cursor-json",
      configPath: paths.windsurf.config,
      detect: () => anyExists(...paths.windsurf.markers),
    },
  ];
}

function endpoint(): { url: string; token: string } {
  const s = mcpSettings();
  if (!ctx.port) throw new UserError("The manager is not listening yet.");
  return { url: `http://127.0.0.1:${ctx.port}/mcp`, token: s.token };
}

function cursorEntry(url: string, token: string) {
  return { url, headers: { Authorization: `Bearer ${token}` }, description: MCP_SERVER_DESCRIPTION };
}

function claudeEntry(url: string, token: string) {
  return { type: "http", url, headers: { Authorization: `Bearer ${token}` }, description: MCP_SERVER_DESCRIPTION };
}

function snippetFor(format: McpClientFormat, url: string, token: string): string {
  if (format === "codex-toml") {
    return [
      `[mcp_servers.${SERVER_KEY}]`,
      `url = "${url}"`,
      `http_headers = { Authorization = "Bearer ${token}" }`,
      `description = ${JSON.stringify(MCP_SERVER_DESCRIPTION)}`,
      "",
    ].join("\n");
  }
  const entry = format === "claude-desktop-json" ? claudeEntry(url, token) : cursorEntry(url, token);
  return JSON.stringify({ mcpServers: { [SERVER_KEY]: entry } }, null, 2) + "\n";
}

async function readJsonFile(file: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fsp.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new UserError(`Could not read ${file}: ${(error as Error).message}`);
  }
}

function hasServerInJson(doc: Record<string, unknown>): boolean {
  const servers = doc.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return false;
  const map = servers as Record<string, unknown>;
  return ALL_SERVER_KEYS.some((k) => k in map);
}

async function hasServerInToml(file: string): Promise<boolean> {
  try {
    const text = await fsp.readFile(file, "utf8");
    return ALL_SERVER_KEYS.some((k) => text.includes(`[mcp_servers.${k}]`) || text.includes(`[mcp_servers."${k}"]`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function writeJsonMerged(file: string, format: McpClientFormat, url: string, token: string): Promise<void> {
  const doc = await readJsonFile(file);
  const servers = (doc.mcpServers && typeof doc.mcpServers === "object" && !Array.isArray(doc.mcpServers))
    ? { ...(doc.mcpServers as Record<string, unknown>) }
    : {};
  for (const legacy of MCP_SERVER_LEGACY_KEYS) delete servers[legacy];
  servers[SERVER_KEY] = format === "claude-desktop-json" ? claudeEntry(url, token) : cursorEntry(url, token);
  doc.mcpServers = servers;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(doc, null, 2) + "\n", { mode: 0o600 });
}

async function writeCodexToml(file: string, url: string, token: string): Promise<void> {
  let text = "";
  try {
    text = await fsp.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const block = [
    `[mcp_servers.${SERVER_KEY}]`,
    `url = "${url}"`,
    `http_headers = { Authorization = "Bearer ${token}" }`,
    `description = ${JSON.stringify(MCP_SERVER_DESCRIPTION)}`,
    "",
  ].join("\n");
  for (const key of ALL_SERVER_KEYS) {
    const re = new RegExp(`\\[mcp_servers\\.(?:${key}|"${key}")\\][\\s\\S]*?(?=\\n\\[|$)`, "m");
    if (re.test(text)) text = text.replace(re, "");
  }
  text = `${text.replace(/\s*$/, "")}\n\n${block}`;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, text.replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n"), { mode: 0o600 });
}

export async function scanMcpClients() {
  const { url, token } = endpoint();
  const clients = [];
  for (const def of clientDefs()) {
    const installed = await def.detect();
    const configExists = await exists(def.configPath);
    let configured = false;
    if (configExists) {
      if (def.format === "codex-toml") configured = await hasServerInToml(def.configPath);
      else configured = hasServerInJson(await readJsonFile(def.configPath));
    }
    clients.push({
      id: def.id,
      label: def.label,
      blurb: def.blurb,
      format: def.format,
      configPath: def.configPath,
      skillsDir: def.skillsDir || "",
      skillsSupported: !!def.skillsDir,
      installed,
      configExists,
      configured,
      setupSupported: true,
      snippet: snippetFor(def.format, url, token),
    });
  }
  return {
    url,
    serverKey: SERVER_KEY,
    scannedAt: Date.now(),
    clients,
  };
}

/** Public configs for copy-paste (all known clients + legacy keys). */
export function mcpClientConfigs() {
  const { url, token } = endpoint();
  const byId: Record<string, string> = {};
  for (const def of clientDefs()) {
    byId[def.id] = snippetFor(def.format, url, token);
  }
  return {
    url,
    serverKey: SERVER_KEY,
    clients: clientDefs().map((d) => ({
      id: d.id,
      label: d.label,
      blurb: d.blurb,
      format: d.format,
      configPath: d.configPath,
      snippet: byId[d.id],
    })),
    // Legacy keys used by older UI / tests.
    cursor: byId.cursor,
    claudeDesktop: byId["claude-desktop"],
  };
}

export async function installMcpClient(body: Record<string, unknown>) {
  const id = String(body.id || "").trim();
  const def = clientDefs().find((c) => c.id === id);
  if (!def) throw new UserError(`Unknown MCP client: ${id || "(empty)"}`);
  const installed = await def.detect();
  if (!installed && !body.force) {
    throw new UserError(`${def.label} does not look installed on this computer. Scan again, or copy the config manually.`);
  }
  const { url, token } = endpoint();
  if (def.format === "codex-toml") await writeCodexToml(def.configPath, url, token);
  else await writeJsonMerged(def.configPath, def.format, url, token);
  return {
    ok: true,
    id: def.id,
    label: def.label,
    configPath: def.configPath,
    message: `Wrote ${SERVER_KEY} into ${def.configPath}. Restart ${def.label} if it was already open.`,
  };
}
