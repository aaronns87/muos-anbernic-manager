// Terminal output in the same badge style as run.sh.

import { recordActivity } from "./activity.ts";

const colour = process.stdout.isTTY && !process.env.NO_COLOR;
const code = (value: string) => (colour ? `\x1b[${value}m` : "");

export const C = {
  bold: code("1"), dim: code("2"), reset: code("0"),
  green: code("30;42"), yellow: code("30;43"), red: code("97;41"), cyan: code("30;46"),
};

export type Badge = "green" | "yellow" | "red" | "cyan";

export function say(badge: Badge, label: string, message: string): void {
  console.log(`  ${C[badge]} ${label} ${C.reset}  ${message}`);
  recordActivity(badge, label, message);
}

export function dim(message: string): void {
  console.log(`  ${C.dim}${message}${C.reset}`);
}

export function human(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n, unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return unit === 0 ? `${Math.trunc(value)} B` : `${value.toFixed(1)} ${units[unit]}`;
}

export function files(n: number): string {
  return n === 1 ? "1 file" : `${n} files`;
}
