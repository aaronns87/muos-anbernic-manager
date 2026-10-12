import { darwin } from "./darwin.ts";
import { linux } from "./linux.ts";
import type { Platform } from "./types.ts";
import { win32 } from "./win32.ts";

export const platform: Platform = process.platform === "darwin" ? darwin : process.platform === "win32" ? win32 : linux;
export type { Handheld, Platform, Volume } from "./types.ts";
