import { z } from "zod/v4";
import { startBenchmark, stopBenchmark, benchmarkStatus } from "../../device/benchmark.ts";
import { controlsSnapshot, controlsState, readJoycal, runCalibrate, saveJoycal } from "../../device/controls.ts";
import { deviceInfo } from "../../device/content.ts";
import { wifiModel } from "../../device/model.ts";
import { allowUsb, disconnect as disconnectMtp, releaseUsb, restartUsb } from "../../device/mtp.ts";
import { handheldSettings, saveHandheldSettings, undoHandheldSettings } from "../../device/muos-settings.ts";
import { closeSftp, findHandhelds, saveWifiSettings, wifiStatus } from "../../device/sftp.ts";
import { closeSsh, sshStatus } from "../../device/ssh.ts";
import { syncthingIdleJson, waitSyncthingIdle } from "../../device/syncthing-idle.ts";
import { findCards, handheldStatus, withTarget } from "../../device/target.ts";
import { webServicesStatus } from "../../device/web-services.ts";
import { defineTool } from "../registry.ts";

export function registerDeviceTools(): void {
  defineTool({
    name: "connection_status",
    group: "device",
    description: "Connection status for Wi-Fi/SSH, USB/MTP, and TF2 card reader paths.",
    inputSchema: z.object({}),
    handler: async () => {
      const wifi = await wifiStatus();
      return {
        wifi,
        ssh: await sshStatus(),
        cards: await findCards(),
        handheld: await handheldStatus(),
        model: await wifiModel(!!wifi.reachable).catch(() => null),
        services: await webServicesStatus().catch(() => ({ host: "", services: [] })),
      };
    },
  });

  defineTool({
    name: "device_status",
    group: "device",
    description: "Live handheld device info when a connection is available (storage, battery, etc.).",
    inputSchema: z.object({
      volume: z.string().optional().describe("Volume id; empty uses the current target"),
    }),
    handler: async (args) => {
      const volume = typeof args.volume === "string" ? args.volume : "";
      try {
        return await withTarget(volume, (t) => deviceInfo(t));
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), wifi: await wifiStatus() };
      }
    },
  });

  defineTool({
    name: "wifi_save",
    group: "device",
    description: "Save Wi-Fi/SSH host settings (host, port, user). Connection opens on the next SSH/SFTP use.",
    inputSchema: z.object({
      host: z.string().describe("Hostname or IP"),
      port: z.number().int().optional(),
      user: z.string().optional(),
    }),
    handler: async (args) => {
      const s = await saveWifiSettings(args);
      return { host: s.host, port: s.port, user: s.user, wifi: await wifiStatus() };
    },
  });

  defineTool({
    name: "wifi_find",
    group: "device",
    description: "Scan the local network for MustardOS handhelds advertising mDNS.",
    inputSchema: z.object({}),
    handler: async () => ({ found: await findHandhelds() }),
  });

  defineTool({
    name: "device_reconnect",
    group: "device",
    description: "Drop USB and SFTP sessions so the next action reconnects fresh.",
    inputSchema: z.object({}),
    handler: async () => {
      await Promise.all([disconnectMtp(), closeSftp(), closeSsh()]);
      return { ok: true };
    },
  });

  defineTool({
    name: "usb_allow",
    group: "device",
    description: "Allow the manager to claim the handheld over USB (MTP).",
    inputSchema: z.object({}),
    handler: async () => {
      allowUsb();
      return { ok: true };
    },
  });

  defineTool({
    name: "usb_release",
    group: "device",
    description: "Release USB so other apps can use the handheld.",
    inputSchema: z.object({}),
    handler: async () => {
      await releaseUsb();
      return { ok: true };
    },
  });

  defineTool({
    name: "usb_restart",
    group: "device",
    description: "Restart the USB/MTP session to the handheld.",
    inputSchema: z.object({}),
    handler: async () => {
      await restartUsb();
      return { ok: true };
    },
  });

  defineTool({
    name: "web_services_status",
    group: "device",
    description: "MustardOS web services on the handheld (SSH, SFTP, Syncthing, etc.).",
    inputSchema: z.object({}),
    handler: async () => webServicesStatus(true),
  });

  defineTool({
    name: "syncthing_idle",
    group: "device",
    description: "Whether Syncthing on the handheld looks idle (safe before large copies).",
    inputSchema: z.object({}),
    handler: async () => syncthingIdleJson(),
  });

  defineTool({
    name: "syncthing_wait_idle",
    group: "device",
    description: "Block until Syncthing is idle or the wait times out. Use before big transfers when sync is enabled.",
    inputSchema: z.object({
      maxMs: z.number().int().positive().max(600_000).optional().describe("Max wait in ms (default from manager)"),
    }),
    handler: async (args) => waitSyncthingIdle(typeof args.maxMs === "number" ? args.maxMs : undefined),
  });

  defineTool({
    name: "handheld_settings_get",
    group: "device",
    description: "Read MustardOS Device Settings (muxsettings groups/values) over SSH.",
    inputSchema: z.object({}),
    handler: async () => handheldSettings(),
  });

  defineTool({
    name: "handheld_settings_save",
    group: "device",
    description: "Write Device Settings keys on the handheld. Destructive for those options. Prefer values from handheld_settings_get; pass seen for optimistic concurrency.",
    inputSchema: z.object({
      changes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).describe("Map of muxsettings keys to new values"),
      seen: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
        .describe("Values the caller last read; rejects if the handheld changed meanwhile"),
    }),
    handler: async (args) => saveHandheldSettings({ changes: args.changes, seen: args.seen }),
  });

  defineTool({
    name: "handheld_settings_undo",
    group: "device",
    description: "Undo the last handheld_settings_save for this host.",
    inputSchema: z.object({}),
    handler: async () => undoHandheldSettings(),
  });

  defineTool({
    name: "controls_snapshot",
    group: "device",
    description: "Device Controls snapshot: input devices, stick map, joycal presence (SSH).",
    inputSchema: z.object({}),
    handler: async () => controlsSnapshot(),
  });

  defineTool({
    name: "controls_state",
    group: "device",
    description: "Live controls poll (axes/buttons) for Device Controls. Pass device path from controls_snapshot.",
    inputSchema: z.object({
      device: z.string().optional(),
      axes: z.string().optional(),
      watch: z.string().optional(),
      labels: z.string().optional(),
      hat: z.string().optional(),
      buttons: z.string().optional(),
    }),
    handler: async (args) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(args)) if (typeof v === "string" && v) q.set(k, v);
      return controlsState(q);
    },
  });

  defineTool({
    name: "controls_joycal_get",
    group: "device",
    description: "Read joycal JSON calibration from the handheld.",
    inputSchema: z.object({}),
    handler: async () => readJoycal(),
  });

  defineTool({
    name: "controls_joycal_save",
    group: "device",
    description: "Write joycal JSON calibration to the handheld. Destructive for stick calibration.",
    inputSchema: z.object({
      json: z.unknown().describe("Joycal JSON object or string"),
    }),
    handler: async (args) => saveJoycal({ json: args.json }),
  });

  defineTool({
    name: "controls_calibrate",
    group: "device",
    description: "Run stick calibration on the handheld (joycal). Takes a while; device must be on Wi-Fi/SSH.",
    inputSchema: z.object({
      device: z.string().describe("Input device path from controls_snapshot"),
      noise: z.number().optional(),
      duration: z.number().optional(),
      deadzonePad: z.number().optional(),
    }),
    handler: async (args) => runCalibrate(args),
  });

  defineTool({
    name: "benchmark_status",
    group: "device",
    description: "Device Benchmark status (running/finished phases and log).",
    inputSchema: z.object({}),
    handler: async () => benchmarkStatus(),
  });

  defineTool({
    name: "benchmark_start",
    group: "device",
    description: "Start Device Benchmark (connect/storage/cpu). Poll with benchmark_status.",
    inputSchema: z.object({
      tests: z.array(z.enum(["connect", "storage", "cpu"])).optional()
        .describe("Subset of tests; default all three"),
    }),
    handler: async (args) => startBenchmark({ tests: args.tests }),
  });

  defineTool({
    name: "benchmark_stop",
    group: "device",
    description: "Stop a running Device Benchmark.",
    inputSchema: z.object({}),
    handler: async () => stopBenchmark(),
  });
}
