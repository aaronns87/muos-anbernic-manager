import { z } from "zod/v4";
import { biosJson, deleteBios, fixBiosNames, sendBios } from "../../bios.ts";
import { createMuxbak, createStatus, muxbakJson, restoreMuxbak, restoreStatus } from "../../device/muxbak.ts";
import { gameSavesJson, deleteGameSave, pruneGameStates, pullGameSave, pushGameSave } from "../../saves-game.ts";
import { savesJson } from "../../saves.ts";
import { defineTool } from "../registry.ts";

const qs = (obj: Record<string, string>) => new URLSearchParams(obj);

export function registerBiosSavesTools(): void {
  defineTool({
    name: "bios_list",
    group: "bios",
    description: "List BIOS files in the workspace bios/ folder and their status vs MustardOS catalogue.",
    inputSchema: z.object({}),
    handler: async () => biosJson(),
  });

  defineTool({
    name: "bios_send",
    group: "bios",
    description: "Send BIOS files from workspace bios/ to the handheld.",
    inputSchema: z.object({
      files: z.array(z.string()).optional().describe("Specific BIOS basenames; omit to send all recognised"),
    }),
    handler: async (args) => sendBios({ files: args.files }),
  });

  defineTool({
    name: "bios_fix_names",
    group: "bios",
    description: "Rename BIOS files in bios/ to the lowercase names MustardOS expects.",
    inputSchema: z.object({}),
    handler: async () => fixBiosNames(),
  });

  defineTool({
    name: "bios_delete",
    group: "bios",
    description: "Delete a BIOS file from the workspace and/or handheld. Destructive.",
    inputSchema: z.object({
      file: z.string(),
      library: z.boolean().optional(),
      device: z.boolean().optional(),
    }),
    confirm: {
      summary: (a) => `Delete BIOS file ${a.file}${a.library === false ? "" : " from bios/"}${a.device ? " and from the handheld" : ""}.`,
    },
    handler: async (args) => deleteBios(args),
  });

  defineTool({
    name: "saves_overview",
    group: "saves",
    description: "Overview of save backups and muxbak options.",
    inputSchema: z.object({}),
    handler: async () => savesJson(),
  });

  defineTool({
    name: "saves_game_list",
    group: "saves",
    description: "List saves and save states for one game on the handheld (needs SSH).",
    inputSchema: z.object({
      code: z.string(),
      file: z.string(),
      volume: z.string().optional(),
    }),
    handler: async (args) => gameSavesJson(qs({
      code: String(args.code),
      file: String(args.file),
      ...(args.volume ? { volume: String(args.volume) } : {}),
    })),
  });

  defineTool({
    name: "saves_game_pull",
    group: "saves",
    description: "Pull one save/state file from the handheld to backups/saves-pulled/.",
    inputSchema: z.object({
      code: z.string(),
      file: z.string(),
      name: z.string().describe("Save file name on the device"),
      volume: z.string().optional(),
    }),
    handler: async (args) => pullGameSave(args),
  });

  defineTool({
    name: "saves_game_push",
    group: "saves",
    description: "Push a pulled save back to the handheld.",
    inputSchema: z.object({
      code: z.string(),
      file: z.string(),
      name: z.string(),
      volume: z.string().optional(),
    }),
    handler: async (args) => pushGameSave(args),
  });

  defineTool({
    name: "saves_game_delete",
    group: "saves",
    description: "Delete a save/state on the handheld. Destructive.",
    inputSchema: z.object({
      code: z.string(),
      file: z.string(),
      name: z.string(),
      volume: z.string().optional(),
    }),
    confirm: {
      summary: (a) => `Permanently delete ${a.name} for ${a.code}/${a.file} on the handheld.`,
    },
    handler: async (args) => deleteGameSave(args),
  });

  defineTool({
    name: "saves_game_prune_states",
    group: "saves",
    description: "Prune old save states for a game on the handheld, keeping the newest ones.",
    inputSchema: z.object({
      code: z.string(),
      file: z.string(),
      keep: z.number().int().min(0).optional(),
      volume: z.string().optional(),
    }),
    confirm: {
      summary: (a) => `Delete older save states for ${a.code}/${a.file} on the handheld, keeping ${a.keep ?? "the newest few"}.`,
    },
    handler: async (args) => pruneGameStates(args),
  });

  defineTool({
    name: "muxbak_list",
    group: "saves",
    description: "List MustardOS muxbak archives on the handheld.",
    inputSchema: z.object({}),
    handler: async () => muxbakJson(),
  });

  defineTool({
    name: "muxbak_status",
    group: "saves",
    description: "Status of an in-progress muxbak create/restore.",
    inputSchema: z.object({}),
    handler: async () => ({ create: await createStatus(), restore: await restoreStatus() }),
  });

  defineTool({
    name: "muxbak_create",
    group: "saves",
    description: "Start creating a muxbak archive on the handheld.",
    inputSchema: z.object({
      name: z.string().optional(),
    }).passthrough(),
    handler: async (args) => createMuxbak(args),
  });

  defineTool({
    name: "muxbak_restore",
    group: "saves",
    description: "Restore a muxbak archive on the handheld. Overwrites saves — destructive.",
    inputSchema: z.object({
      name: z.string(),
    }).passthrough(),
    confirm: {
      summary: (a) => `Restore backup ${a.name} on the handheld. This overwrites saves and settings.`,
    },
    handler: async (args) => restoreMuxbak(args),
  });
}
