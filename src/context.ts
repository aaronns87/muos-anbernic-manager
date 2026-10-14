// Paths and settings for this run, filled in by main.ts before anything else runs.

import path from "node:path";
import { fileURLToPath } from "node:url";

const managerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const ctx = {
  managerDir,
  publicDir: path.join(managerDir, "public"),
  cacheDir: path.join(managerDir, ".cache"),
  root: path.resolve(managerDir, ".."),
  roms: path.resolve(managerDir, "..", "Roms"),
  /** MustardOS apps and updates (.muxapp, .muxupd, ...). */
  apps: path.resolve(managerDir, "..", "apps"),
  /** MustardOS card images (.img, .img.gz). */
  os: path.resolve(managerDir, "..", "os"),
  /** BIOS files to send to the handheld. */
  bios: path.resolve(managerDir, "..", "bios"),
  /** Save backups taken from the handheld. */
  backups: path.resolve(managerDir, "..", "backups"),
  /** MustardOS themes made in the Theme Designer, one open theme folder each. */
  themes: path.resolve(managerDir, "..", "themes"),
  token: "",
  port: 0,
  /** A folder holding ROMS/ and ARCHIVE/ used as the TF2 card, for testing without one. */
  tf2Dir: "",
};

export function setRoot(root: string): void {
  ctx.root = path.resolve(root);
  ctx.roms = path.join(ctx.root, "Roms");
  ctx.apps = path.join(ctx.root, "apps");
  ctx.os = path.join(ctx.root, "os");
  ctx.bios = path.join(ctx.root, "bios");
  ctx.backups = path.join(ctx.root, "backups");
  ctx.themes = path.join(ctx.root, "themes");
}
