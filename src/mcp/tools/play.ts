import { z } from "zod/v4";
import {
  addToCollection,
  collectionsJson,
  createCollection,
  deleteCollection,
  playJson,
  removeFromCollection,
  renameCollection,
  resetPlay,
} from "../../play.ts";
import { defineTool } from "../registry.ts";

export function registerPlayTools(): void {
  defineTool({
    name: "play_activity",
    group: "play",
    description: "Handheld play-time tracker and recent history (needs SD1 over USB or Wi-Fi).",
    inputSchema: z.object({
      volume: z.string().optional(),
    }),
    handler: async (args) => {
      const q = new URLSearchParams();
      if (args.volume) q.set("volume", String(args.volume));
      return playJson(q);
    },
  });

  defineTool({
    name: "play_reset",
    group: "play",
    description: "Reset play time tracker or clear recent history on the handheld. Destructive for that data.",
    inputSchema: z.object({
      what: z.enum(["time", "history"]),
      volume: z.string().optional(),
    }),
    confirm: {
      summary: (a) => `Reset the handheld play ${a.what === "time" ? "time tracker" : "history"}.`,
    },
    handler: async (args) => resetPlay(args),
  });

  defineTool({
    name: "collections_list",
    group: "play",
    description: "List MustardOS collections and their game entries on the handheld.",
    inputSchema: z.object({
      volume: z.string().optional(),
    }),
    handler: async (args) => {
      const q = new URLSearchParams();
      if (args.volume) q.set("volume", String(args.volume));
      return collectionsJson(q);
    },
  });

  defineTool({
    name: "collections_create",
    group: "play",
    description: "Create a collection folder on the handheld.",
    inputSchema: z.object({
      name: z.string(),
      volume: z.string().optional(),
    }),
    handler: async (args) => createCollection(args),
  });

  defineTool({
    name: "collections_rename",
    group: "play",
    description: "Rename a collection on the handheld.",
    inputSchema: z.object({
      path: z.string().describe("Current collection path"),
      to: z.string().describe("New name"),
      volume: z.string().optional(),
    }),
    handler: async (args) => renameCollection(args),
  });

  defineTool({
    name: "collections_delete",
    group: "play",
    description: "Delete a collection and its entries on the handheld. Destructive. Does not delete ROM files.",
    inputSchema: z.object({
      path: z.string(),
      volume: z.string().optional(),
    }),
    confirm: {
      summary: (a) => `Delete collection ${a.path} and its entries on the handheld (ROM files stay).`,
    },
    handler: async (args) => deleteCollection(args),
  });

  defineTool({
    name: "collections_add",
    group: "play",
    description: "Add games already on the handheld to a collection (pointers only; does not copy ROMs).",
    inputSchema: z.object({
      path: z.string().describe("Collection path; empty string for root Collections"),
      games: z.array(z.object({
        storage: z.string().describe("SD1 or TF2"),
        rel: z.string().describe("Relative path under ROMS"),
      })).min(1).max(500),
      volume: z.string().optional(),
    }),
    handler: async (args) => addToCollection(args),
  });

  defineTool({
    name: "collections_remove",
    group: "play",
    description: "Remove collection entry .cfg files. Does not delete ROM files.",
    inputSchema: z.object({
      path: z.string(),
      files: z.array(z.string()).min(1).describe("Entry .cfg file names"),
      volume: z.string().optional(),
    }),
    handler: async (args) => removeFromCollection(args),
  });
}
