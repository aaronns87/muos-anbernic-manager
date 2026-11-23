import { z } from "zod/v4";
import { coresJson, folderGames, resetGameCore, setFolderCore, setGameCore } from "../../cores.ts";
import { cheatFile, cheatsGame, removeCheats, saveCheats } from "../../tuning/cheats.ts";
import { retroarchJson, saveRetroarch } from "../../retroarch.ts";
import { gameTuning, resetTuning, saveTuning, tuningJson } from "../../tuning/tuning.ts";
import { defineTool } from "../registry.ts";

const qs = (obj: Record<string, string>) => new URLSearchParams(obj);

export function registerEmulationTools(): void {
  defineTool({
    name: "cores_list",
    group: "emulation",
    description: "List emulation cores and folder assignments from the handheld.",
    inputSchema: z.object({}),
    handler: async () => coresJson(),
  });

  defineTool({
    name: "cores_set_folder",
    group: "emulation",
    description: "Set the default core for a ROM folder on the handheld.",
    inputSchema: z.object({
      folder: z.string(),
      core: z.string(),
      keepGames: z.boolean().optional(),
    }),
    handler: async (args) => setFolderCore(args),
  });

  defineTool({
    name: "cores_folder_games",
    group: "emulation",
    description: "List per-game core overrides in a folder.",
    inputSchema: z.object({ folder: z.string() }),
    handler: async (args) => folderGames(qs({ folder: String(args.folder) })),
  });

  defineTool({
    name: "cores_set_game",
    group: "emulation",
    description: "Set the core for one game on the handheld.",
    inputSchema: z.object({
      folder: z.string(),
      file: z.string(),
      core: z.string(),
    }),
    handler: async (args) => setGameCore(args),
  });

  defineTool({
    name: "cores_reset_game",
    group: "emulation",
    description: "Clear a per-game core override so the folder default applies.",
    inputSchema: z.object({
      folder: z.string(),
      file: z.string(),
    }),
    handler: async (args) => resetGameCore(args),
  });

  defineTool({
    name: "retroarch_get",
    group: "emulation",
    description: "Read RetroArch picture-and-play / folder overrides.",
    inputSchema: z.object({}),
    handler: async () => retroarchJson(),
  });

  defineTool({
    name: "retroarch_save",
    group: "emulation",
    description: "Save RetroArch folder override settings.",
    inputSchema: z.object({
      folder: z.string().optional(),
      values: z.record(z.string(), z.unknown()).optional(),
    }).passthrough(),
    handler: async (args) => saveRetroarch(args),
  });

  defineTool({
    name: "tuning_list",
    group: "emulation",
    description: "Game Tuning catalogue: profiles and recommendations.",
    inputSchema: z.object({}),
    handler: async () => tuningJson(),
  });

  defineTool({
    name: "tuning_game_get",
    group: "emulation",
    description: "Get Game Tuning options for one game.",
    inputSchema: z.object({
      code: z.string(),
      file: z.string(),
    }),
    handler: async (args) => gameTuning(qs({ code: String(args.code), file: String(args.file) })),
  });

  defineTool({
    name: "tuning_game_save",
    group: "emulation",
    description: "Save Game Tuning options for one game to the handheld.",
    inputSchema: z.object({
      code: z.string(),
      file: z.string(),
      values: z.record(z.string(), z.unknown()).optional(),
    }).passthrough(),
    handler: async (args) => saveTuning(args),
  });

  defineTool({
    name: "tuning_game_reset",
    group: "emulation",
    description: "Reset Game Tuning for one game to folder defaults.",
    inputSchema: z.object({
      code: z.string(),
      file: z.string(),
    }),
    handler: async (args) => resetTuning(args),
  });

  defineTool({
    name: "cheats_game_get",
    group: "emulation",
    description: "List available cheats for a game.",
    inputSchema: z.object({
      code: z.string(),
      file: z.string(),
    }),
    handler: async (args) => cheatsGame(qs({ code: String(args.code), file: String(args.file) })),
  });

  defineTool({
    name: "cheats_file_get",
    group: "emulation",
    description: "Read the cheat file currently on the handheld for a game.",
    inputSchema: z.object({
      code: z.string(),
      file: z.string(),
    }),
    handler: async (args) => cheatFile(qs({ code: String(args.code), file: String(args.file) })),
  });

  defineTool({
    name: "cheats_save",
    group: "emulation",
    description: "Save selected cheats for a game to the handheld.",
    inputSchema: z.object({
      code: z.string(),
      file: z.string(),
      cheats: z.unknown().optional(),
    }).passthrough(),
    handler: async (args) => saveCheats(args),
  });

  defineTool({
    name: "cheats_remove",
    group: "emulation",
    description: "Remove cheat files for a game from the handheld.",
    inputSchema: z.object({
      code: z.string(),
      file: z.string(),
    }),
    handler: async (args) => removeCheats(args),
  });
}
