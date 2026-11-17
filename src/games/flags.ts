// Smart-list hints for Games: bad dumps from the checks cache and tuning suggestions.

import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "../context.ts";
import { getLibrary } from "./library.ts";
import { tuningHintKey } from "./smart-lists.ts";

const resultFile = () => path.join(ctx.cacheDir, "checks.json");

/** Paths like `PS/Game.cue` that verify marked as bad dumps. */
export async function badDumpKeys(): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const data = JSON.parse(await fsp.readFile(resultFile(), "utf8")) as { root?: string; systems?: { games: { p: string; state: string }[] }[] };
    if (data.root !== ctx.roms) return out;
    for (const sys of data.systems ?? []) for (const g of sys.games) if (g.state === "bad") out.add(g.p.replace(/^Roms\//, ""));
  } catch { /* no checks yet */ }
  return out;
}

export async function gamesFlagsJson() {
  const library = await getLibrary();
  const bad = await badDumpKeys();
  const tuning: string[] = [];
  for (const sys of library.systems) {
    for (const g of sys.games) {
      if (tuningHintKey(sys.code, g)) tuning.push(`${sys.code}/${g.f}`);
    }
  }
  return { bad: [...bad], tuning };
}