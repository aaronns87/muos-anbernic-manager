// MCP agent packs (skills + experts): SKILL.md under mcp/agents/, list/read/install into IDE skill dirs.

import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { clientSkillDirs, type McpClientId } from "./clients.ts";

export type AgentKind = "skill" | "expert";

export interface AgentPackMeta {
  id: string;
  kind: AgentKind;
  name: string;
  description: string;
  path: string;
  bytes: number;
}

const ID_RE = /^[a-z0-9-]+$/;

export function agentsRoot(): string {
  return path.join(ctx.managerDir, "mcp", "agents");
}

function packDir(id: string): string {
  if (!ID_RE.test(id)) throw new UserError("Invalid agent pack id.");
  const root = path.resolve(agentsRoot());
  const dir = path.resolve(root, id);
  if (dir !== root && !dir.startsWith(root + path.sep)) throw new UserError("Invalid agent pack path.");
  return dir;
}

function skillFile(id: string): string {
  return path.join(packDir(id), "SKILL.md");
}

/** Minimal YAML frontmatter parse for name / description / kind. */
export function parseSkillFrontmatter(raw: string): { name: string; description: string; kind: AgentKind; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) {
    return { name: "", description: "", kind: "skill", body: raw };
  }
  const yaml = m[1];
  const body = m[2].replace(/^\r?\n/, "");
  const scalar = (key: string): string => {
    const folded = new RegExp(`^${key}:\\s*>-?\\s*\\n((?:[ \\t]+.+\\n?)+)`, "m").exec(yaml);
    if (folded) {
      return folded[1].split(/\r?\n/).map((l) => l.replace(/^[ \t]+/, "")).filter(Boolean).join(" ").trim();
    }
    const line = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(yaml);
    if (!line) return "";
    let v = line[1].trim();
    if (v === ">" || v === ">|" || v === "|" || v === ">-") return "";
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
  };
  const kindRaw = scalar("kind").toLowerCase();
  const kind: AgentKind = kindRaw === "expert" ? "expert" : "skill";
  return { name: scalar("name") || "", description: scalar("description"), kind, body };
}

export async function listAgentPacks(): Promise<{ root: string; packs: AgentPackMeta[] }> {
  const root = agentsRoot();
  let entries: string[] = [];
  try {
    entries = await fsp.readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { root, packs: [] };
    throw error;
  }
  const packs: AgentPackMeta[] = [];
  for (const id of entries.sort()) {
    if (!ID_RE.test(id)) continue;
    const file = path.join(root, id, "SKILL.md");
    try {
      const st = await fsp.stat(file);
      if (!st.isFile()) continue;
      const raw = await fsp.readFile(file, "utf8");
      const meta = parseSkillFrontmatter(raw);
      packs.push({
        id,
        kind: meta.kind,
        name: meta.name || id,
        description: meta.description,
        path: file,
        bytes: st.size,
      });
    } catch {
      /* skip broken packs */
    }
  }
  return { root, packs };
}

export async function readAgentPack(id: string): Promise<{ id: string; kind: AgentKind; name: string; description: string; markdown: string }> {
  const file = skillFile(String(id || "").trim());
  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new UserError(`Unknown agent pack: ${id}`);
    throw error;
  }
  const meta = parseSkillFrontmatter(raw);
  return {
    id: String(id).trim(),
    kind: meta.kind,
    name: meta.name || String(id).trim(),
    description: meta.description,
    markdown: raw,
  };
}

/** Content endpoint helper (query id). */
export async function agentPackContent(q: URLSearchParams) {
  const id = q.get("id") || "";
  if (!id) throw new UserError("Pass id= for the agent pack.");
  return readAgentPack(id);
}

export async function installAgentPack(body: Record<string, unknown>) {
  const id = String(body.id || "").trim();
  const clientId = String(body.clientId || "").trim() as McpClientId;
  if (!id) throw new UserError("Pass the agent pack id.");
  if (!clientId) throw new UserError("Pass clientId (cursor, claude-code, or codex).");
  const dirs = clientSkillDirs();
  const skillsDir = dirs[clientId];
  if (!skillsDir) {
    throw new UserError(`That client does not support skill install. Copy the SKILL.md instead.`);
  }
  const pack = await readAgentPack(id);
  const destDir = path.join(skillsDir, id);
  const destFile = path.join(destDir, "SKILL.md");
  // Ensure dest stays under the skills root.
  const resolvedSkills = path.resolve(skillsDir);
  const resolvedDest = path.resolve(destFile);
  if (!resolvedDest.startsWith(resolvedSkills + path.sep) && resolvedDest !== path.join(resolvedSkills, "SKILL.md")) {
    throw new UserError("Refusing to write outside the client skills directory.");
  }
  await fsp.mkdir(destDir, { recursive: true });
  await fsp.writeFile(destFile, pack.markdown, { mode: 0o644 });
  return {
    ok: true,
    id,
    kind: pack.kind,
    name: pack.name,
    clientId,
    path: destFile,
    message: `Installed ${pack.name} into ${destFile}. Restart the IDE if it was already open.`,
  };
}

/** Install every shipped pack into one client skills directory. */
export async function installAllAgentPacks(body: Record<string, unknown>) {
  const clientId = String(body.clientId || "").trim() as McpClientId;
  if (!clientId) throw new UserError("Pass clientId (cursor, claude-code, or codex).");
  const dirs = clientSkillDirs();
  if (!dirs[clientId]) {
    throw new UserError(`That client does not support skill install. Copy the SKILL.md instead.`);
  }
  const { packs } = await listAgentPacks();
  if (!packs.length) throw new UserError("No agent packs found under mcp/agents/.");
  const installed = [];
  for (const p of packs) {
    const r = await installAgentPack({ id: p.id, clientId });
    installed.push({ id: r.id, name: r.name, path: r.path });
  }
  return {
    ok: true,
    clientId,
    count: installed.length,
    installed,
    message: `Installed ${installed.length} pack${installed.length === 1 ? "" : "s"}. Restart the IDE if it was already open.`,
  };
}

export function agentResourceUri(id: string): string {
  return `agent://${id}`;
}
