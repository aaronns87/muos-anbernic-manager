// One library game's details that the library JSON leaves out: its verify result, other versions and BIOS needs.

import path from "node:path";
import { folderBios } from "../bios.ts";
import { gameCheck } from "../checks.ts";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { platform } from "../platform/index.ts";
import { getLibrary } from "./library.ts";

async function find(code: unknown, file: unknown) {
  const library = await getLibrary();
  const sys = library.systems.find((s) => s.code === code);
  const g = sys?.games.find((x) => x.f === file);
  if (!sys || !g) throw new UserError("That game is no longer in the library. Rescan and try again.");
  return { sys, g };
}

export async function gameDetails(query: URLSearchParams) {
  const { sys, g } = await find(query.get("code"), query.get("file"));
  const [check, bios] = await Promise.all([gameCheck(sys.code, sys.games, g), folderBios(sys.code)]);
  return { check, bios };
}

export async function revealGame(body: Record<string, unknown>) {
  const { sys, g } = await find(body.code, body.file);
  platform.reveal(path.join(ctx.roms, sys.code, g.f));
  return { ok: true };
}
