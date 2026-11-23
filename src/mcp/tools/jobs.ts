import { z } from "zod/v4";
import { cancelJob, forgetJob, jobFiles, jobList, planTransfer, startCopy } from "../../jobs.ts";
import { defineTool } from "../registry.ts";

const directionSchema = z.enum(["to-device", "from-device", "match-device", "match-library"]).optional()
  .describe("to-device (default), from-device, match-device or match-library");

const transportSchema = z.enum(["sftp", "syncthing"]).optional()
  .describe("sftp (default): straight to the handheld. syncthing: copy into the local Syncthing-shared ROMs folder from Settings (to-device and match-device only) and wait for Syncthing to settle.");

export function registerJobTools(): void {
  defineTool({
    name: "transfer_plan",
    group: "jobs",
    description: "Dry-run a transfer. direction: to-device (default, library -> handheld), from-device (handheld -> Roms/), match-device (device gets the library selection, replacing differing files) or match-library (Roms/ gets what the handheld has, replacing differing files). targets are SYSTEM or SYSTEM/file paths; \"\" is everything.",
    inputSchema: z.object({
      volume: z.string().describe("Device volume id from connection_status / device_status"),
      targets: z.array(z.string()).min(1).describe("e.g. [\"GB\"] or [\"GB/Tetris.gb\"]"),
      direction: directionSchema,
      transport: transportSchema,
    }),
    handler: async (args) => planTransfer(String(args.volume), args.targets as string[], args.direction, args.transport),
  });

  defineTool({
    name: "transfer_start",
    group: "jobs",
    description: "Start a planned transfer (same direction as transfer_plan; default to-device). Returns a job id to poll with job_get.",
    inputSchema: z.object({
      volume: z.string(),
      targets: z.array(z.string()).min(1),
      direction: directionSchema,
      transport: transportSchema,
      replace: z.boolean().optional().describe("Also replace files that differ. Default false for to-device/from-device, true for the match modes."),
    }),
    handler: async (args) => ({ job: await startCopy({ volume: args.volume, targets: args.targets, direction: args.direction, transport: args.transport, replace: args.replace }) }),
  });

  defineTool({
    name: "job_list",
    group: "jobs",
    description: "List active and recent transfer/artwork/app jobs.",
    inputSchema: z.object({}),
    handler: async () => jobList(),
  });

  defineTool({
    name: "job_get",
    group: "jobs",
    description: "Get one job's file-level progress by id.",
    inputSchema: z.object({
      id: z.number().int().describe("Job id from transfer_start or job_list"),
    }),
    handler: async (args) => jobFiles(Number(args.id)),
  });

  defineTool({
    name: "job_cancel",
    group: "jobs",
    description: "Cancel a running or queued job.",
    inputSchema: z.object({
      id: z.number().int().optional().describe("Job id; omit to cancel the current job"),
    }),
    handler: async (args) => {
      cancelJob(typeof args.id === "number" ? args.id : undefined);
      return { ok: true, jobs: jobList() };
    },
  });

  defineTool({
    name: "job_forget",
    group: "jobs",
    description: "Remove a finished job from the history list.",
    inputSchema: z.object({
      id: z.number().int().optional(),
    }),
    handler: async (args) => {
      forgetJob(typeof args.id === "number" ? args.id : undefined);
      return { ok: true, jobs: jobList() };
    },
  });
}
