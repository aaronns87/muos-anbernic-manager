import { z } from "zod/v4";
import { getPlan, sendPlan, startArtJob, sendGameArt, getGameArt, deleteGameArt, keepArtOnCard } from "../../artwork.ts";
import { deleteLocalArt, putLocalArt } from "../../artwork-tools.ts";
import { scrapeGame, scrapeImage, scrapePlan } from "../../scrape.ts";
import { defineTool } from "../registry.ts";

export function registerArtworkTools(): void {
  defineTool({
    name: "artwork_scrape_plan",
    group: "artwork",
    description: "Plan libretro thumbnail matches for Roms/ games (box/snap/title). Does not download yet.",
    inputSchema: z.object({
      systems: z.array(z.string()).optional().describe("System codes; omit for all with games"),
      only: z.enum(["missing", "all"]).optional().describe("Default missing (games without local art)"),
      refresh: z.boolean().optional().describe("Refresh thumbnail indexes"),
    }),
    handler: async (args) => scrapePlan(args),
  });

  defineTool({
    name: "artwork_scrape_game",
    group: "artwork",
    description: "Best libretro thumbnail picks for one game by name(s). Use artwork_scrape_save to write into Roms/.",
    inputSchema: z.object({
      code: z.string().describe("System code e.g. GB"),
      names: z.array(z.string()).min(1).max(6).describe("Title variants to search"),
    }),
    handler: async (args) => scrapeGame(args),
  });

  defineTool({
    name: "artwork_scrape_save",
    group: "artwork",
    description: "Download one libretro thumbnail into Roms/<system>/Imgs as PNG (replaces existing; old goes to Trash).",
    inputSchema: z.object({
      system: z.string(),
      stem: z.string().describe("ROM stem without extension"),
      set: z.string().describe("Libretro set id from scrape plan/pick"),
      kind: z.enum(["box", "snap", "title"]),
      name: z.string().describe("Thumbnail name from scrape pick"),
    }),
    handler: async (args) => {
      const q = new URLSearchParams({
        set: String(args.set),
        kind: String(args.kind),
        name: String(args.name),
      });
      const { image } = await scrapeImage(q);
      return putLocalArt({
        system: args.system,
        stem: args.stem,
        data: image.toString("base64"),
      });
    },
  });

  defineTool({
    name: "artwork_local_delete",
    group: "artwork",
    description: "Move local Roms/<system>/Imgs images to Trash. Destructive.",
    inputSchema: z.object({
      system: z.string(),
      names: z.array(z.string()).min(1).max(5000),
    }),
    handler: async (args) => deleteLocalArt(args),
  });

  defineTool({
    name: "artwork_get_plan",
    group: "artwork",
    description: "Plan pulling device catalogue artwork into Roms/Imgs (new/different). Returns a plan id for artwork_start.",
    inputSchema: z.object({
      volume: z.string(),
      kind: z.enum(["box", "preview", "splash"]).optional(),
    }),
    handler: async (args) => getPlan(args),
  });

  defineTool({
    name: "artwork_send_plan",
    group: "artwork",
    description: "Plan sending Roms/Imgs artwork to the device catalogue. Returns a plan id for artwork_start.",
    inputSchema: z.object({
      volume: z.string(),
      kind: z.enum(["box", "preview", "splash"]).optional(),
    }),
    handler: async (args) => sendPlan(args),
  });

  defineTool({
    name: "artwork_start",
    group: "artwork",
    description: "Start an artwork get/send job from a plan id. Poll with job_get. replace=true also copies 'different' files.",
    inputSchema: z.object({
      plan: z.string(),
      replace: z.boolean().optional(),
    }),
    handler: async (args) => ({ job: startArtJob(args) }),
  });

  defineTool({
    name: "artwork_send_game",
    group: "artwork",
    description: "Send one game's local PNG to the device catalogue (or data base64 PNG).",
    inputSchema: z.object({
      volume: z.string(),
      path: z.string().describe("SYSTEM/file under Roms/ e.g. GB/Tetris.gb"),
      kind: z.enum(["box", "preview", "splash"]).optional(),
      data: z.string().optional().describe("Optional base64 PNG instead of Roms/Imgs"),
    }),
    handler: async (args) => sendGameArt(args),
  });

  defineTool({
    name: "artwork_get_game",
    group: "artwork",
    description: "Copy one device catalogue image into Roms/<system>/Imgs for a game.",
    inputSchema: z.object({
      volume: z.string(),
      path: z.string().describe("SYSTEM/file under Roms/"),
      catalogue: z.string(),
      kind: z.enum(["box", "preview", "splash"]),
      name: z.string().describe("Image file name on device"),
    }),
    handler: async (args) => getGameArt(args),
  });

  defineTool({
    name: "artwork_delete_device",
    group: "artwork",
    description: "Delete one artwork file from the device catalogue. Destructive.",
    inputSchema: z.object({
      volume: z.string(),
      catalogue: z.string(),
      kind: z.enum(["box", "preview", "splash"]),
      name: z.string(),
    }),
    handler: async (args) => deleteGameArt(args),
  });

  defineTool({
    name: "artwork_keep_on_card",
    group: "artwork",
    description: "Ensure MUOS/info/catalogue folders exist on the TF2 card (reader).",
    inputSchema: z.object({
      volume: z.string(),
    }),
    handler: async (args) => keepArtOnCard(args),
  });
}
