import { z } from "zod/v4";
import { checksJson, startVerify, trashGames } from "../../checks.ts";
import { chdJson, startChdConvert } from "../../games/chd.ts";
import {
  cancelDiscPipeline, discPipelineJson, dismissDiscPipeline, resumeDiscPipeline, startDiscPipeline,
} from "../../games/disc-pipeline.ts";
import { previewM3u, writeM3uBatch, writeM3uPlaylist } from "../../games/disc-m3u.ts";
import { freeHomebrewJson, installFreeHomebrew } from "../../games/free-homebrew.ts";
import { defineTool } from "../registry.ts";

export function registerLibraryExtraTools(): void {
  defineTool({
    name: "checks_status",
    group: "library",
    description: "Library check status: No-Intro verify results, disc layout and CHD hints.",
    inputSchema: z.object({}),
    handler: async () => checksJson(),
  });

  defineTool({
    name: "checks_verify",
    group: "library",
    description: "Start No-Intro verify for systems that have DATs. Poll with checks_status.",
    inputSchema: z.object({
      systems: z.array(z.string()).optional(),
    }),
    handler: async (args) => startVerify(args),
  });

  defineTool({
    name: "checks_trash",
    group: "library",
    description: "Move listed bad/unknown ROM paths to Trash after a verify. Destructive.",
    inputSchema: z.object({
      paths: z.array(z.string()).min(1).describe("Relative paths under Roms/"),
    }),
    confirm: {
      summary: (a) => `Move ${Array.isArray(a.paths) ? a.paths.length : 0} ROM path(s) to the Trash.`,
    },
    handler: async (args) => trashGames(args),
  });

  defineTool({
    name: "chd_status",
    group: "library",
    description: "CHD convert tool status and eligible disc games.",
    inputSchema: z.object({}),
    handler: async () => chdJson(),
  });

  defineTool({
    name: "chd_convert",
    group: "library",
    description: "Start CHD conversion for cue/m3u sets (needs chdman on this Mac). Poll with chd_status.",
    inputSchema: z.object({
      code: z.string().optional(),
      files: z.array(z.string()).min(1),
      trash: z.boolean().optional().describe("Trash source sheets after success"),
    }),
    handler: async (args) => startChdConvert(args),
  });

  defineTool({
    name: "disc_m3u_preview",
    group: "library",
    description: "Preview an .m3u playlist for a multi-disc group.",
    inputSchema: z.object({
      code: z.string(),
      group: z.string().describe("Group id from checks/disc layout"),
    }),
    handler: async (args) => previewM3u(args),
  });

  defineTool({
    name: "disc_m3u_write",
    group: "library",
    description: "Write one .m3u playlist beside the ROMs for a disc group.",
    inputSchema: z.object({
      code: z.string(),
      group: z.string(),
      m3uName: z.string().optional(),
      overwrite: z.boolean().optional(),
    }),
    handler: async (args) => writeM3uPlaylist(args),
  });

  defineTool({
    name: "disc_m3u_batch",
    group: "library",
    description: "Write .m3u playlists for every multi-disc group in a system.",
    inputSchema: z.object({
      code: z.string(),
    }),
    handler: async (args) => writeM3uBatch(args),
  });

  defineTool({
    name: "disc_pipeline_start",
    group: "library",
    description: "Queue fix archives -> CHD convert -> .m3u playlists -> verify for disc games. Poll with disc_pipeline_status.",
    inputSchema: z.object({
      code: z.string().optional().describe("System folder (default PS)"),
      file: z.string().optional(),
      files: z.array(z.string()).optional(),
      items: z.array(z.object({ code: z.string(), file: z.string() })).optional(),
      trashArchive: z.boolean().optional().describe("Trash archives after a fix (default true)"),
      trash: z.boolean().optional().describe("Trash cue/bin sources after CHD convert (default true)"),
      m3u: z.boolean().optional(),
      verify: z.boolean().optional(),
    }),
    handler: async (args) => startDiscPipeline(args),
  });

  defineTool({
    name: "disc_pipeline_status",
    group: "library",
    description: "Progress of the disc pipeline: state, each step, and whether it can resume.",
    inputSchema: z.object({}),
    handler: async () => discPipelineJson(),
  });

  defineTool({
    name: "disc_pipeline_control",
    group: "library",
    description: "cancel (stop after the current step, or drop a stopped pipeline), resume, or dismiss the disc pipeline.",
    inputSchema: z.object({ action: z.enum(["cancel", "resume", "dismiss"]) }),
    handler: async (args) => args.action === "cancel" ? cancelDiscPipeline() : args.action === "resume" ? resumeDiscPipeline() : dismissDiscPipeline(),
  });

  defineTool({
    name: "homebrew_list",
    group: "library",
    description: "Free & homebrew catalogues (legal downloads only: freeware, public domain, open source) and which titles are already in Roms/. Pass catalogue (e.g. free, pd-homebrew, libre-games) to list one; the reply names every catalogue.",
    inputSchema: z.object({ catalogue: z.string().optional().describe("Catalogue id, or all (default)") }),
    handler: async (args) => freeHomebrewJson(args.catalogue),
  });

  defineTool({
    name: "homebrew_install",
    group: "library",
    description: "Download one free/homebrew title into Roms/<system>/. Poll homebrew_list for task progress.",
    inputSchema: z.object({
      id: z.string(),
    }),
    handler: async (args) => installFreeHomebrew(args),
  });
}
