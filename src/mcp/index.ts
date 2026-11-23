// MCP server public API: load settings, register tools, serve /mcp.

import { registerAgentPackTools } from "./attach-agents.ts";
import { registerArtworkTools } from "./tools/artwork.ts";
import { registerBiosSavesTools } from "./tools/bios-saves.ts";
import { registerDeviceTools } from "./tools/device.ts";
import { registerEmulationTools } from "./tools/emulation.ts";
import { registerFilesAppsTools } from "./tools/files-apps.ts";
import { registerJobTools } from "./tools/jobs.ts";
import { registerLibraryExtraTools } from "./tools/library-extra.ts";
import { registerLibraryTools } from "./tools/library.ts";
import { registerPlayTools } from "./tools/play.ts";
import { registerSystemTools } from "./tools/system.ts";
import { loadMcpSettings } from "./settings.ts";
export type { McpRole } from "./settings.ts";
export { GUEST_TOOLS, guestToolAllowed } from "./guest.ts";
import { mcpMarkStarted } from "./stats.ts";

let toolsReady = false;

/** Register all domain tools once. Safe to call multiple times. */
export function ensureMcpTools(): void {
  if (toolsReady) return;
  registerLibraryTools();
  registerLibraryExtraTools();
  registerDeviceTools();
  registerJobTools();
  registerBiosSavesTools();
  registerEmulationTools();
  registerFilesAppsTools();
  registerArtworkTools();
  registerPlayTools();
  registerSystemTools();
  registerAgentPackTools();
  toolsReady = true;
}

export async function initMcp(): Promise<void> {
  await loadMcpSettings();
  ensureMcpTools();
  mcpMarkStarted();
}

export {
  mcpSettings, mcpEnabled, mcpTokenOk, mcpSettingsPublic, saveMcpSettings, rotateMcpToken, rotateGuestToken, loadMcpSettings,
} from "./settings.ts";
export { mcpClientConfigs, scanMcpClients, installMcpClient } from "./clients.ts";
export { listAgentPacks, readAgentPack, agentPackContent, installAgentPack, installAllAgentPacks } from "./agents.ts";
export { mcpStatsJson, mcpSessionCount } from "./stats.ts";
export { toolCatalogue, openaiTools, openaiToolsForChat, ASSISTANT_TOOL_LIMIT, executeTool, listTools } from "./registry.ts";
export { handleMcpHttp, isMcpPath, closeAllMcpSessions } from "./http.ts";
export { MCP_SERVER_NAME, MCP_SERVER_DESCRIPTION } from "./names.ts";
