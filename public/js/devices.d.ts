// Types for devices.js, which the server imports too.

export interface Device {
  id: string;
  name: string;
  maker: string;
  alias?: string[];
  chip: string;
  gpu: string;
  ram: number;
  slots: number;
  hdmi: boolean;
  arch: string[];
  inches: number;
  screen: [number, number];
  wifi: boolean;
  sticks: number;
  form: "horizontal" | "vertical" | "clamshell";
  lid?: boolean;
  pm?: { board?: string; screen?: [number, number]; extra?: string[] };
}

export const DEVICES: Device[];
export const DEFAULT_DEVICE: string;
export function byId(id: string): Device | null;
export function deviceFor(board: unknown): Device | null;
export function screenText(d: Device): string;
export function specs(d: Device): [string, string][];
export function portCaps(d: Device): string[];
export function imageDevice(file: unknown): Device | null;
