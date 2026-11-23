import { z } from "zod/v4";
import { deleteGame } from "../../games/actions.ts";
import { gameDetails } from "../../games/details.ts";
import { getLibrary, rescanLibrary } from "../../games/library.ts";
import { playCoreFor, canPlayFile, playBlockedReason, PLAY_BIOS } from "../../games/play-rom.ts";
import { defineTool } from "../registry.ts";

const qs = (obj: Record<string, string>) => new URLSearchParams(obj);

export function registerLibraryTools(): void {
  defineTool({
    name: "library_list",
    group: "library",
    description: "List Roms/ systems with game counts, artwork %, and total size. Optional code filters to one system folder.",
    inputSchema: z.object({
      code: z.string().optional().describe("System folder code such as GB, PS, MD"),
      limit_games: z.number().int().min(0).max(200).optional().describe("Include up to N game titles per system (0 = counts only)"),
    }),
    handler: async (args) => {
      const lib = await getLibrary();
      const limit = typeof args.limit_games === "number" ? args.limit_games : 0;
      const systems = lib.systems
        .filter((s) => !args.code || s.code === args.code)
        .map((s) => ({
          code: s.code,
          name: s.name,
          maker: s.maker,
          year: s.year,
          games: s.games.length,
          bytes: s.games.reduce((a, g) => a + g.s, 0),
          art: s.games.filter((g) => g.i).length,
          sample: limit > 0 ? s.games.slice(0, limit).map((g) => ({ title: g.t, file: g.f, size: g.s, hasArt: !!g.i })) : undefined,
        }));
      return { root: lib.roms, totals: lib.totals, systems };
    },
  });

  defineTool({
    name: "library_search",
    group: "library",
    description: "Search the library by title, file name, or tag. Returns matching games across systems.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Search text"),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    handler: async (args) => {
      const lib = await getLibrary();
      const q = String(args.query).toLowerCase();
      const limit = typeof args.limit === "number" ? args.limit : 40;
      const hits: { code: string; title: string; file: string; size: number; tags: string[] }[] = [];
      for (const s of lib.systems) {
        for (const g of s.games) {
          const hay = `${g.t} ${g.f} ${g.g.join(" ")}`.toLowerCase();
          if (!hay.includes(q)) continue;
          hits.push({ code: s.code, title: g.t, file: g.f, size: g.s, tags: g.g });
          if (hits.length >= limit) return { query: args.query, hits };
        }
      }
      return { query: args.query, hits };
    },
  });

  defineTool({
    name: "game_get",
    group: "library",
    description: "Get details for one library game (metadata, path, related info).",
    inputSchema: z.object({
      code: z.string().describe("System folder code"),
      file: z.string().describe("ROM file name inside that folder"),
    }),
    handler: async (args) => gameDetails(qs({ code: String(args.code), file: String(args.file) })),
  });

  defineTool({
    name: "game_delete",
    group: "library",
    description: "Permanently delete a game from Roms/ and/or the handheld. Destructive. library=true moves local ROM to Trash; device=true deletes on device.",
    inputSchema: z.object({
      path: z.string().describe("Relative path SYSTEM/file, e.g. GB/Tetris.gb"),
      library: z.boolean().optional().describe("Delete from workspace Roms/ (default true)"),
      device: z.boolean().optional().describe("Delete from handheld if present"),
      art: z.boolean().optional().describe("Also remove artwork"),
      volume: z.string().optional().describe("Device volume id when deleting from handheld"),
    }),
    confirm: {
      summary: (a) => `Delete ${a.path}${a.library === false ? "" : " from Roms/ (to the Trash)"}${a.device ? " and from the handheld (permanent)" : ""}${a.art ? ", with its artwork" : ""}.`,
    },
    handler: async (args) => deleteGame({
      path: args.path,
      library: args.library !== false,
      device: !!args.device,
      art: !!args.art,
      volume: args.volume,
    }),
  });

  defineTool({
    name: "library_rescan",
    group: "library",
    description: "Rescan the Roms/ folder and refresh the in-memory library.",
    inputSchema: z.object({}),
    handler: async () => {
      const lib = await rescanLibrary();
      return { totals: lib.totals, generated: lib.generated };
    },
  });

  defineTool({
    name: "play_capabilities",
    group: "library",
    description: "Which systems/files can be played in the browser via EmulatorJS (does not start play).",
    inputSchema: z.object({
      code: z.string().optional(),
      file: z.string().optional(),
    }),
    handler: async (args) => {
      if (args.code && args.file) {
        return {
          code: args.code,
          file: args.file,
          core: playCoreFor(String(args.code)) || null,
          canPlay: canPlayFile(String(args.code), String(args.file)),
          bios: PLAY_BIOS[String(args.code)] ?? [],
          ...(playBlockedReason(String(args.code)) ? { reason: playBlockedReason(String(args.code)) } : {}),
        };
      }
      const lib = await getLibrary();
      const systems = lib.systems
        .filter((s) => playCoreFor(s.code))
        .map((s) => ({
          code: s.code,
          core: playCoreFor(s.code),
          bios: PLAY_BIOS[s.code] ?? [],
          playableFiles: s.games.filter((g) => canPlayFile(s.code, g.f)).length,
          total: s.games.length,
        }));
      return {
        systems,
        notPlayable: [{ code: "DREAMCAST", reason: playBlockedReason("DREAMCAST") }],
        note: "Arcade folders (MAME, FBNEO, CPS1-3, NEOGEO) use FinalBurn Neo and only start .zip sets it supports; a missing BIOS (PlayStation, Saturn, Mega-CD, PC Engine CD) is reported when play starts.",
      };
    },
  });
}
