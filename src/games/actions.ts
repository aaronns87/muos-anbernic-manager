import fsp from "node:fs/promises";
import path from "node:path";
import { EXCLUDED_TOP, IMAGE_EXTS, ROMS_DIR } from "../catalogue.ts";
import { ctx } from "../context.ts";
import { deviceGameArt } from "../device/content.ts";
import { art, withTarget } from "../device/target.ts";
import { UserError } from "../errors.ts";
import { requireIdle } from "../jobs.ts";
import { say } from "../log.ts";
import { platform } from "../platform/index.ts";
import { inside, isFile, listDir, safePart, splitName, TEXT_DIR } from "../util.ts";
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

async function freeOrSame(from: string, to: string): Promise<boolean> {
  if (from.toLowerCase() === to.toLowerCase()) return true;
  return !(await isFile(to));
}

/** Renames a game file in Roms/ (same extension), and matching artwork / description when present. */
export async function renameGame(body: Record<string, unknown>) {
  const [system, name] = gamePath(body);
  requireIdle("Wait for the copy to finish before renaming games.");
  const src = path.join(ctx.roms, system, name);
  if (!inside(ctx.roms, src)) throw new UserError("Invalid path.");
  if (!(await isFile(src))) throw new UserError(`${system}/${name} is no longer in Roms/. Rescan Roms/ first.`);
  if (isRunner(system, name)) {
    throw new UserError("Rename ScummVM and similar engine games from Files; they use a data folder with the same name.");
  }

  const [, ext] = splitName(name);
  if (!ext) throw new UserError("This file has no extension to keep.");
  let raw = path.basename(String(body.to ?? "").trim().replaceAll("\\", "/"));
  if (!raw || raw.startsWith(".")) throw new UserError("Type a new file name.");
  const [toStem, toExt] = splitName(raw);
  if (!toStem.trim()) throw new UserError("Type a new file name.");
  if (toExt && toExt !== ext) {
    throw new UserError(`Keep the .${ext} extension (or leave it off). Changing the type is not supported here.`);
  }
  const destName = `${toStem.trim()}.${ext}`;
  if (/[/\\]/.test(destName) || destName.startsWith(".")) throw new UserError("Invalid file name.");
  if (destName === name) return { from: name, to: destName, art: 0, text: false };

  const dest = path.join(ctx.roms, system, destName);
  if (!inside(ctx.roms, dest)) throw new UserError("Invalid path.");
  if (!(await freeOrSame(src, dest))) throw new UserError(`${destName} already exists in ${system}.`);

  await fsp.rename(src, dest);

  const oldStem = splitName(name)[0];
  const newStem = splitName(destName)[0];
  let artRenamed = 0;
  const imgs = path.join(ctx.roms, system, "Imgs");
  for (const image of await listDir(imgs).catch(() => [])) {
    const [imageStem, imageExt] = splitName(image.name);
    if (!IMAGE_EXTS.has(imageExt) || imageStem.toLowerCase() !== oldStem.toLowerCase()) continue;
    const from = path.join(imgs, image.name);
    const toPath = path.join(imgs, `${newStem}.${imageExt}`);
    if (!(await freeOrSame(from, toPath))) continue;
    await fsp.rename(from, toPath).catch(() => {});
    artRenamed++;
  }

  let textRenamed = false;
  const textDir = path.join(ctx.roms, system, TEXT_DIR);
  for (const entry of await listDir(textDir).catch(() => [])) {
    const [stem, e] = splitName(entry.name);
    if (e !== "txt" || stem.toLowerCase() !== oldStem.toLowerCase()) continue;
    const from = path.join(textDir, entry.name);
    const toPath = path.join(textDir, `${newStem}.txt`);
    if (!(await freeOrSame(from, toPath))) break;
    await fsp.rename(from, toPath).catch(() => {});
    textRenamed = true;
    break;
  }

  say("green", "RENAMED", `${system}/${name} -> ${destName}${artRenamed ? ` (and ${artRenamed} artwork)` : ""}.`);
  rescanInBackground();
  return { from: name, to: destName, art: artRenamed, text: textRenamed };
}
