// Register agent packs as MCP resources, prompts, and meta tools.

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { agentResourceUri, listAgentPacks, readAgentPack } from "./agents.ts";
import { defineTool } from "./registry.ts";

let metaToolsReady = false;

/** Register agent_pack_* tools once into the shared registry. */
export function registerAgentPackTools(): void {
  if (metaToolsReady) return;
  defineTool({
    name: "agent_pack_list",
    group: "meta",
    description: "List MCP agent packs (skills and experts) shipped with the manager.",
    inputSchema: z.object({}),
    handler: async () => listAgentPacks(),
  });
  defineTool({
    name: "agent_pack_get",
    group: "meta",
    description: "Read one agent pack SKILL.md by id (e.g. manager-mcp, library-games).",
    inputSchema: z.object({
      id: z.string().describe("Pack folder id"),
    }),
    handler: async (args) => readAgentPack(String(args.id || "")),
  });
  metaToolsReady = true;
}

/** Attach resources + prompts to a live MCP server instance. */
export async function attachAgentsToMcp(server: McpServer): Promise<void> {
  const { packs } = await listAgentPacks();

  server.registerResource(
    "agent-packs",
    "agent://",
    {
      title: "Manager agent packs",
      description: "Index of MCP skills and experts shipped with muOS Anbernic Manager",
      mimeType: "application/json",
    },
    async () => {
      const latest = await listAgentPacks();
      const text = JSON.stringify({
        packs: latest.packs.map((p) => ({
          id: p.id,
          kind: p.kind,
          name: p.name,
          description: p.description,
          uri: agentResourceUri(p.id),
        })),
      }, null, 2);
      return { contents: [{ uri: "agent://", mimeType: "application/json", text }] };
    },
  );

  for (const p of packs) {
    const uri = agentResourceUri(p.id);
    server.registerResource(
      `agent-${p.id}`,
      uri,
      {
        title: p.name,
        description: p.description || `${p.kind}: ${p.id}`,
        mimeType: "text/markdown",
      },
      async () => {
        const pack = await readAgentPack(p.id);
        return { contents: [{ uri, mimeType: "text/markdown", text: pack.markdown }] };
      },
    );
  }

  server.registerPrompt(
    "use-manager-mcp",
    {
      title: "Use manager MCP",
      description: "Load the manager-mcp skill and optionally one expert pack.",
      argsSchema: {
        expert: z.string().optional().describe("Optional expert pack id, e.g. library-games"),
      },
    },
    async (args) => {
      const base = await readAgentPack("manager-mcp");
      const messages: { role: "user"; content: { type: "text"; text: string } }[] = [
        { role: "user", content: { type: "text", text: base.markdown } },
      ];
      const expertId = typeof args.expert === "string" ? args.expert.trim() : "";
      if (expertId) {
        const expert = await readAgentPack(expertId);
        messages.push({ role: "user", content: { type: "text", text: expert.markdown } });
      }
      return { messages };
    },
  );
}
