import { z } from "zod/v4";
import { marketJson, marketDownload } from "../../app-market.ts";
import { appsJson, sendApps } from "../../apps.ts";
import { filesCopy, filesDelete, filesList, filesMkdir, filesRead, filesRename, filesRoots, filesWrite } from "../../files.ts";
import { installPort, portsJson, uninstallPort } from "../../ports.ts";
import { applyTheme, deleteTheme, installTheme, themesJson } from "../../themes.ts";
import { workspaceImages } from "../../system/image.ts";
import { osMarketJson } from "../../os-library.ts";
import { workspaceInfo } from "../../workspace.ts";
import { activityJson } from "../../activity.ts";
import { logsJson } from "../../app-log.ts";
import { runningVersion } from "../../manager-update.ts";
import { ctx } from "../../context.ts";
import { mcpSettingsPublic } from "../settings.ts";
import { mcpStatsJson } from "../stats.ts";
import { toolCatalogue, defineTool } from "../registry.ts";

const qs = (obj: Record<string, string>) => new URLSearchParams(obj);

export function registerFilesAppsTools(): void {
  defineTool({
    name: "files_roots",
    group: "files",
    description: "List file-browser roots (workspace and configured folders).",
    inputSchema: z.object({}),
    handler: async () => filesRoots(qs({})),
  });

  defineTool({
    name: "files_list",
    group: "files",
    description: "List a folder in the file browser (root id + path parts).",
    inputSchema: z.object({
      root: z.string(),
      path: z.string().optional().describe("Slash-separated path under the root"),
      side: z.string().optional().describe("local or device"),
    }),
    handler: async (args) => filesList(qs({
      root: String(args.root),
      path: String(args.path ?? ""),
      ...(args.side ? { side: String(args.side) } : {}),
    })),
  });

  defineTool({
    name: "files_read",
    group: "files",
    description: "Read a text file from the workspace file browser.",
    inputSchema: z.object({
      root: z.string(),
      path: z.string(),
    }),
    handler: async (args) => filesRead(qs({ root: String(args.root), path: String(args.path) })),
  });

  defineTool({
    name: "files_write",
    group: "files",
    description: "Write a text file in the workspace. Overwrites existing content.",
    inputSchema: z.object({
      root: z.string(),
      path: z.string(),
      text: z.string(),
    }),
    handler: async (args) => filesWrite(args),
  });

  defineTool({
    name: "files_mkdir",
    group: "files",
    description: "Create a folder in the file browser.",
    inputSchema: z.object({
      root: z.string(),
      path: z.string(),
      name: z.string(),
    }),
    handler: async (args) => filesMkdir(args),
  });

  defineTool({
    name: "files_rename",
    group: "files",
    description: "Rename a file or folder in the file browser.",
    inputSchema: z.object({
      root: z.string(),
      path: z.string(),
      name: z.string(),
    }),
    handler: async (args) => filesRename(args),
  });

  defineTool({
    name: "files_delete",
    group: "files",
    description: "Delete files/folders via the file browser. Destructive.",
    inputSchema: z.object({
      root: z.string(),
      paths: z.array(z.string()).optional(),
      path: z.string().optional(),
    }).passthrough(),
    handler: async (args) => filesDelete(args),
  });

  defineTool({
    name: "files_copy",
    group: "files",
    description: "Copy files between roots in the file browser.",
    inputSchema: z.object({
      fromRoot: z.string().optional(),
      toRoot: z.string().optional(),
    }).passthrough(),
    handler: async (args) => filesCopy(args),
  });

  defineTool({
    name: "apps_list",
    group: "apps",
    description: "List MustardOS apps in the workspace apps/ folder.",
    inputSchema: z.object({}),
    handler: async () => appsJson(),
  });

  defineTool({
    name: "apps_send",
    group: "apps",
    description: "Send/install apps from apps/ to the handheld.",
    inputSchema: z.object({
      files: z.array(z.string()).optional(),
    }).passthrough(),
    handler: async (args) => sendApps(args),
  });

  defineTool({
    name: "market_list",
    group: "apps",
    description: "Browse the app market catalogue for this handheld.",
    inputSchema: z.object({
      device: z.string().optional(),
    }),
    handler: async (args) => marketJson(qs(args.device ? { device: String(args.device) } : {})),
  });

  defineTool({
    name: "market_download",
    group: "apps",
    description: "Download an app market package into apps/.",
    inputSchema: z.object({
      id: z.string().optional(),
    }).passthrough(),
    handler: async (args) => marketDownload(args),
  });

  defineTool({
    name: "ports_list",
    group: "apps",
    description: "PortMaster catalogue and installed ports.",
    inputSchema: z.object({}),
    handler: async () => portsJson(qs({})),
  });

  defineTool({
    name: "ports_install",
    group: "apps",
    description: "Install a PortMaster port on the handheld (needs Wi-Fi on device).",
    inputSchema: z.object({
      name: z.string().optional(),
    }).passthrough(),
    handler: async (args) => installPort(args),
  });

  defineTool({
    name: "ports_uninstall",
    group: "apps",
    description: "Uninstall a PortMaster port. Destructive.",
    inputSchema: z.object({
      name: z.string().optional(),
    }).passthrough(),
    handler: async (args) => uninstallPort(args),
  });

  defineTool({
    name: "themes_list",
    group: "themes",
    description: "List themes available for install/apply.",
    inputSchema: z.object({}),
    handler: async () => themesJson(qs({})),
  });

  defineTool({
    name: "themes_install",
    group: "themes",
    description: "Install a theme package onto the handheld.",
    inputSchema: z.object({
      name: z.string().optional(),
    }).passthrough(),
    handler: async (args) => installTheme(args),
  });

  defineTool({
    name: "themes_apply",
    group: "themes",
    description: "Apply an installed theme on the handheld.",
    inputSchema: z.object({
      name: z.string().optional(),
    }).passthrough(),
    handler: async (args) => applyTheme(args),
  });

  defineTool({
    name: "themes_delete",
    group: "themes",
    description: "Delete a theme. Destructive.",
    inputSchema: z.object({
      name: z.string().optional(),
    }).passthrough(),
    handler: async (args) => deleteTheme(args),
  });

  defineTool({
    name: "os_images_list",
    group: "os",
    description: "List MustardOS images in the workspace os/ folder.",
    inputSchema: z.object({}),
    handler: async () => ({ images: await workspaceImages() }),
  });

  defineTool({
    name: "os_market",
    group: "os",
    description: "OS market catalogue for official MustardOS downloads.",
    inputSchema: z.object({
      device: z.string().optional(),
    }),
    handler: async (args) => osMarketJson(qs(args.device ? { device: String(args.device) } : {})),
  });

  defineTool({
    name: "workspace_info",
    group: "meta",
    description: "Workspace folder paths and basic info.",
    inputSchema: z.object({}),
    handler: async () => workspaceInfo(),
  });

  defineTool({
    name: "activity_list",
    group: "meta",
    description: "Recent manager activity log entries.",
    inputSchema: z.object({
      limit: z.number().int().optional(),
    }),
    handler: async (args) => activityJson(qs(args.limit ? { limit: String(args.limit) } : {})),
  });

  defineTool({
    name: "logs_list",
    group: "meta",
    description: "Application diagnostic logs (filtered).",
    inputSchema: z.object({
      day: z.string().optional(),
      level: z.string().optional(),
      q: z.string().optional(),
    }),
    handler: async (args) => logsJson(qs({
      ...(args.day ? { day: String(args.day) } : {}),
      ...(args.level ? { level: String(args.level) } : {}),
      ...(args.q ? { q: String(args.q) } : {}),
    })),
  });

  defineTool({
    name: "manager_status",
    group: "meta",
    description: "Manager version, port, MCP listening state, and workspace root.",
    inputSchema: z.object({}),
    handler: async () => ({
      version: await runningVersion(),
      port: ctx.port,
      root: ctx.root,
      mcp: mcpSettingsPublic(),
      tools: toolCatalogue().count,
    }),
  });

  defineTool({
    name: "mcp_stats",
    group: "meta",
    description: "MCP usage stats: sessions, call counts, recent tool audit log.",
    inputSchema: z.object({}),
    handler: async () => mcpStatsJson(),
  });

  defineTool({
    name: "mcp_tool_catalogue",
    group: "meta",
    description: "Full list of MCP tools grouped by domain.",
    inputSchema: z.object({}),
    handler: async () => toolCatalogue(),
  });
}
