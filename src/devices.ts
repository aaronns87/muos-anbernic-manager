// Re-export the shared device catalogue for server TypeScript (public/js/devices.js is plain JS).
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const d = require("../public/js/devices.js") as {
  DEVICES: { id: string; name: string; maker: string; chip: string; gpu: string; ram: number; slots: number;
    inches: number; screen: [number, number]; wifi: boolean; sticks: number; form: string; lid?: boolean }[];
  DEFAULT_DEVICE: string;
  byId: (id: string) => (typeof d.DEVICES)[number] | null;
  deviceFor: (board: string) => (typeof d.DEVICES)[number] | null;
  screenText: (dev: (typeof d.DEVICES)[number]) => string;
  specs: (dev: (typeof d.DEVICES)[number]) => [string, string][];
  portCaps: (dev: (typeof d.DEVICES)[number]) => string[];
  imageDevice: (file: string) => (typeof d.DEVICES)[number] | null;
};

export const DEVICES = d.DEVICES;
export const DEFAULT_DEVICE = d.DEFAULT_DEVICE;
export const byId = d.byId;
export const deviceFor = d.deviceFor;
export const screenText = d.screenText;
export const specs = d.specs;
export const portCaps = d.portCaps;
export const imageDevice = d.imageDevice;
