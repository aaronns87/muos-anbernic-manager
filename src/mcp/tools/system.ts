import { z } from "zod/v4";
import { listCards } from "../../system/cards.ts";
import { workspaceImages, inspectImage, importOsImage } from "../../system/image.ts";
import {
  cancelSystemJob,
  dismissSystemJob,
  skipSystemVerify,
  startSystemJob,
  systemJob,
} from "../../system/ops.ts";
import { wifiTf2Status } from "../../system/tf2-wifi.ts";
import { defineTool } from "../registry.ts";

export function registerSystemTools(): void {
  defineTool({
    name: "system_cards",
    group: "system",
    description: "List removable cards suitable for System Tools (macOS reader). Includes busy/role hints.",
    inputSchema: z.object({}),
    handler: async () => ({ cards: await listCards(), wifiTf2: await wifiTf2Status(false).catch(() => null) }),
  });

  defineTool({
    name: "system_images",
    group: "system",
    description: "Workspace OS images under os/ plus TF2 folder layout hints.",
    inputSchema: z.object({}),
    handler: async () => ({ images: await workspaceImages() }),
  });

  defineTool({
    name: "system_inspect_image",
    group: "system",
    description: "Inspect a MustardOS .img / .img.gz path (size, hash if known).",
    inputSchema: z.object({
      path: z.string(),
    }),
    handler: async (args) => inspectImage(String(args.path)),
  });

  defineTool({
    name: "system_import_image",
    group: "system",
    description: "Import an OS image into os/mustardos_<ver>/ with hash metadata.",
    inputSchema: z.object({
      image: z.string().describe("Absolute path to .img or .img.gz"),
      hash: z.string().optional(),
      hashFile: z.string().optional(),
    }),
    handler: async (args) => importOsImage(args),
  });

  defineTool({
    name: "system_job_get",
    group: "system",
    description: "Current System Tools job snapshot (install / TF2 / reset) or null.",
    inputSchema: z.object({}),
    handler: async () => ({ job: systemJob() }),
  });

  defineTool({
    name: "system_start",
    group: "system",
    description:
      "Start a destructive System Tools job: install (flash OS), tf2 (set up games card), or reset. "
      + "confirm must equal the card id (from system_cards) or \"TF2\" when via=wifi. "
      + "Reader ops need macOS. Poll with system_job_get.",
    inputSchema: z.object({
      op: z.enum(["install", "tf2", "reset"]),
      confirm: z.string().describe("Must equal disk id, or TF2 for Wi-Fi TF2 ops"),
      disk: z.string().optional().describe("Card id for reader ops"),
      image: z.string().optional().describe("Image path for install"),
      hash: z.string().optional(),
      hashSource: z.string().optional(),
      allowUnchecked: z.boolean().optional(),
      skipVerify: z.boolean().optional(),
      via: z.enum(["wifi"]).optional().describe("TF2/reset over Wi-Fi SSH"),
      fs: z.enum(["FAT32", "ExFAT"]).optional(),
      name: z.string().optional().describe("Volume name for reset"),
    }),
    handler: async (args) => ({ job: startSystemJob(args) }),
  });

  defineTool({
    name: "system_cancel",
    group: "system",
    description: "Cancel the running System Tools job when possible.",
    inputSchema: z.object({}),
    handler: async () => {
      cancelSystemJob();
      return { ok: true, job: systemJob() };
    },
  });

  defineTool({
    name: "system_skip_verify",
    group: "system",
    description: "Skip verify stage on a running install job.",
    inputSchema: z.object({}),
    handler: async () => {
      skipSystemVerify();
      return { ok: true, job: systemJob() };
    },
  });

  defineTool({
    name: "system_dismiss",
    group: "system",
    description: "Dismiss a finished System Tools job from the UI state.",
    inputSchema: z.object({}),
    handler: async () => {
      dismissSystemJob();
      return { ok: true, job: systemJob() };
    },
  });
}
