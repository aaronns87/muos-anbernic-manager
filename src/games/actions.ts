import path from "node:path";
import { EXCLUDED_TOP, IMAGE_EXTS, ROMS_DIR } from "../catalogue.ts";
import { ctx } from "../context.ts";
import { deviceGameArt } from "../device/content.ts";
import { art, withTarget } from "../device/target.ts";
import { UserError } from "../errors.ts";
import { requireIdle } from "../jobs.ts";
import { say } from "../log.ts";
import { platform } from "../platform/index.ts";
import { inside, isFile, listDir, safePart, splitName } from "../util.ts";
import { deleteDeviceTree, deviceFolder, isRunner, scummFolder } from "./engines.ts";
import { rescanInBackground } from "./library.ts";

/** [system, file] from a "SYSTEM/file" path in a request. */
export function gamePath(body: Record<string, unknown>): [string, string] {
  const parts = String(body.path ?? "").split("/").filter(Boolean);
  if (parts.length !== 2 || !parts.every(safePart)) throw new UserError("Invalid path.");
  if (EXCLUDED_TOP.has(parts[0].toUpperCase()) || parts[0].toLowerCase() === "imgs") {
    throw new UserError(`${parts[0]} files are not managed by the manager.`);
  }
  return [parts[0], parts[1]];
}

/** Deletes a game from Roms/ (to the Trash, optionally with its artwork) and/or from the device (permanently). */
export async function deleteGame(body: Record<string, unknown>) {
  const [system, name] = gamePath(body);
  if (!body.library && !body.device) throw new UserError("Choose where to delete the game from.");
  requireIdle("Wait for the copy to finish before deleting games.");
  const src = path.join(ctx.roms, system, name);
  if (!inside(ctx.roms, src)) throw new UserError("Invalid path.");
  if (body.library && !(await isFile(src))) throw new UserError(`${system}/${name} is no longer in Roms/. Rescan Roms/ first.`);
  let removed = false, artRemoved = 0;
  if (body.device) {
    await withTarget(String(body.volume ?? ""), async (t) => {
      const data = await deviceFolder(t.roms, [ROMS_DIR, system], system, name);
      await t.roms.delete([ROMS_DIR, system, name]);
      if (data) await deleteDeviceTree(t.roms, data);
      removed = true;
      const fs = art(t);
      if (body.device_art && fs) {
        for (const [, parts] of await deviceGameArt(t, system, name)) {
          await fs.delete(parts);
          artRemoved++;
        }
      }
      say("yellow", "DELETED", `${system}/${name} from ${t.name}${artRemoved ? " with its artwork" : ""}.`);
    });
  }
  const trashed: string[] = [];
  if (body.library) {
    const data = isRunner(system, name) ? await scummFolder(system, splitName(name)[0]) : "";
    trashed.push(await platform.trash(src));
    if (data) trashed.push(await platform.trash(path.join(ctx.roms, system, data)));
    const stem = splitName(name)[0].toLowerCase();
    const imgs = path.join(ctx.roms, system, "Imgs");
    if (body.art) {
      for (const image of await listDir(imgs)) {
        const [imageStem, ext] = splitName(image.name);
        if (IMAGE_EXTS.has(ext) && imageStem.toLowerCase() === stem) trashed.push(await platform.trash(path.join(imgs, image.name)));
      }
    }
    say("yellow", "TRASHED", `${system}/${name}${trashed.length > 1 ? " and its artwork" : ""}.`);
    rescanInBackground();
  }
  return { trashed, device: removed, art: artRemoved };
}
