// Read-only tool allowlist for the MCP guest token.

/** Tools a guest token may call. Everything else (writes, deletes, transfers, System Tools) is denied. */
export const GUEST_TOOLS: readonly string[] = [
  "connection_status", "device_status", "manager_status", "library_list", "library_search", "game_get",
  "bios_list", "job_list", "job_get", "play_activity", "play_capabilities", "web_services_status",
  "syncthing_idle", "syncthing_conflicts", "mcp_stats", "mcp_tool_catalogue", "checks_status", "disc_pipeline_status", "artwork_get_game",
  "saves_overview", "saves_game_list", "cores_list", "tuning_list", "collections_list", "homebrew_list",
  "files_list", "files_roots", "workspace_info", "os_images_list", "themes_list", "apps_list", "ports_list",
  "agent_pack_list",
];

const allowed = new Set(GUEST_TOOLS);

export function guestToolAllowed(name: string): boolean {
  return allowed.has(name);
}
