import { z } from "zod/v4";
import { withTarget } from "../../device/target.ts";
import { cancelJob, forgetJob, jobFiles, jobList, makePlan, planSummary, startCopy } from "../../jobs.ts";
import { defineTool } from "../registry.ts";

export function registerJobTools(): void {
  defineTool({
    name: "transfer_plan",
    group: "jobs",
    description: "Plan copying games (or a whole system) to the handheld. targets are SYSTEM or SYSTEM/file paths.",
    inputSchema: z.object({
      volume: z.string().describe("Destination volume id from connection_status / device_status"),
      targets: z.array(z.string()).min(1).describe("e.g. [\"GB\"] or [\"GB/Tetris.gb\"]"),
    }),
    handler: async (args) => {
      const volume = String(args.volume);
      const targets = args.targets as string[];
      return withTarget(volume, async (t) => planSummary(t.info, await makePlan(t, targets)));
    },
  });

  defineTool({
    name: "transfer_start",
    group: "jobs",
    description: "Start copying planned games to the handheld. Returns a job id to poll with job_get.",
    inputSchema: z.object({
      volume: z.string(),
      targets: z.array(z.string()).min(1),
    }),
    handler: async (args) => ({ job: await startCopy({ volume: args.volume, targets: args.targets }) }),
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
