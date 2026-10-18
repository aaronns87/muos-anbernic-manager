/** Ambient types for the shared browser/server device catalogue. */
declare module "../../public/js/devices.js" {
  export interface Device {
    id: string;
    name: string;
    maker: string;
    chip: string;
    gpu: string;
    ram: number;
    slots: number;
    hdmi: boolean;
    arch: string[];
    alias?: string[];
    inches: number;
    screen: [number, number];
    wifi: boolean;
    sticks: number;
    form: string;
    lid?: boolean;
    pm?: { board?: string; screen?: [number, number]; extra?: string[] };
  }
  export const DEVICES: Device[];
  export const DEFAULT_DEVICE: string;
  export function byId(id: string): Device | null;
  export function deviceFor(board: string): Device | null;
  export function screenText(d: Device): string;
  export function specs(d: Device): [string, string][];
  export function portCaps(d: Device): string[];
  export function imageDevice(file: string): Device | null;
}
