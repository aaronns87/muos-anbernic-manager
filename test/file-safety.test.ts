// Rename collisions, hidden-folder deletion and read-only transfer plans, using fake storage only.

import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { SFTPWrapper } from "ssh2";
import { ctx, setRoot } from "../src/context.ts";
import { CardFs } from "../src/device/fs.ts";
import { SftpFs } from "../src/device/sftp.ts";
import type { Target } from "../src/device/target.ts";
import { filesRename, removeDevice } from "../src/files.ts";
import { renameGame } from "../src/games/actions.ts";
import { makePlan } from "../src/jobs.ts";
import { renameAvailable } from "../src/util.ts";

function workspace(t: { after: (fn: () => void) => void }) {
  const before = { ...ctx };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manager-safety-"));
  setRoot(root);
  ctx.cacheDir = path.join(root, ".cache");
  t.after(() => { Object.assign(ctx, before); fs.rmSync(root, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, "Roms", "GB"), { recursive: true });
  return root;
}

test("local renames reject distinct files whose names differ only by case", async (t) => {
  const root = workspace(t), dir = path.join(root, "Roms", "GB");
  const src = path.join(dir, "Game.gb"), dest = path.join(dir, "game.gb");
  fs.writeFileSync(src, "source game");
  const stat = fs.lstatSync(src);
  // Simulate a distinct case-sensitive destination even when the host volume ignores case.
  t.mock.method(fsp, "lstat", async (file: string) => ({ ...stat, ino: file === dest ? stat.ino + 1 : stat.ino }));
  assert.equal(await renameAvailable(src, dest), false);
  await assert.rejects(new CardFs(dir).rename(["Game.gb"], "game.gb"), /already exists/);
  await assert.rejects(filesRename({ side: "local", root: "workspace", path: "Roms/GB", from: "Game.gb", to: "game.gb" }), /already exists/);
  await assert.rejects(renameGame({ path: "GB/Game.gb", to: "game.gb" }), /already exists/);
  assert.equal(fs.readFileSync(src, "utf8"), "source game");
});

test("local renames allow a case-only change but refuse existing files and folders", async (t) => {
  const root = workspace(t), dir = path.join(root, "Roms", "GB");
  const src = path.join(dir, "Game.gb");
  fs.writeFileSync(src, "source game");
  fs.writeFileSync(path.join(dir, "Other.gb"), "other game");
  fs.mkdirSync(path.join(dir, "Folder.gb"));
  assert.equal(await renameAvailable(src, path.join(dir, "Other.gb")), false);
  assert.equal(await renameAvailable(src, path.join(dir, "Folder.gb")), false);
  await new CardFs(dir).rename(["Game.gb"], "game.gb");
  assert.equal(fs.readFileSync(path.join(dir, "game.gb"), "utf8"), "source game");
  assert.equal(fs.readFileSync(path.join(dir, "Other.gb"), "utf8"), "other game");
});

test("SFTP renames distinguish collisions from case-insensitive aliases", async () => {
  let names = ["Game.gb", "game.gb"], renamed = false;
  const stat = { isDirectory: () => false, size: 1, mtime: 1 };
  const sftp = {
    stat: (_: string, cb: (err: null, value: object) => void) => cb(null, stat),
    readdir: (_: string, cb: (err: null, value: object[]) => void) => cb(null, names.map((filename) => ({ filename, attrs: stat }))),
    rename: (_: string, __: string, cb: (err: null) => void) => { renamed = true; cb(null); },
  } as unknown as SFTPWrapper;
  const device = new SftpFs(sftp, "/card");
  await assert.rejects(device.rename(["Game.gb"], "game.gb"), /already exists/);
  assert.equal(renamed, false);
  names = ["Game.gb"];
  await device.rename(["Game.gb"], "game.gb");
  assert.equal(renamed, true);
});

test("folder deletion removes nested hidden files as well as visible files", async (t) => {
  const root = workspace(t), dir = path.join(root, "card", "folder");
  fs.mkdirSync(path.join(dir, ".data"), { recursive: true });
  fs.writeFileSync(path.join(dir, "visible.txt"), "visible");
  fs.writeFileSync(path.join(dir, "._visible.txt"), "metadata");
  fs.writeFileSync(path.join(dir, ".hidden"), "hidden");
  fs.writeFileSync(path.join(dir, ".data", "save.dat"), "save");
  const card = new CardFs(path.join(root, "card")), list = card.list.bind(card);
  t.mock.method(card, "list", async (parts: string[], hidden = false) =>
    (await list(parts, hidden))?.sort((a, b) => Number(a.name.startsWith(".")) - Number(b.name.startsWith("."))) ?? null);
  assert.equal(await removeDevice(card, ["folder"]), 3);
  assert.equal(fs.existsSync(dir), false);
});

test("comparing identical games leaves card timestamps unchanged", async (t) => {
  const root = workspace(t), dir = path.join(root, "card", "ROMS", "GB");
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(root, "Roms", "GB", "Game.gb"), dest = path.join(dir, "Game.gb");
  fs.writeFileSync(src, "same game");
  fs.writeFileSync(dest, "same game");
  fs.utimesSync(src, 1_700_000_000, 1_700_000_000);
  fs.utimesSync(dest, 1_600_000_000, 1_600_000_000);
  const before = fs.statSync(dest).mtimeMs;
  const card = new CardFs(path.join(root, "card"));
  const target: Target = {
    roms: card, arts: [], all: [["TF2", card]], session: null, storages: [], name: "Fake TF2",
    info: { id: "test-card", mode: "card", name: "Fake TF2", kind: "card", storage: "TF2", free: 1000, total: 1000, art: "", catalogue: false, fs: "exfat" },
  };
  const plan = await makePlan(target, ["GB/Game.gb"]);
  assert.deepEqual(plan.identical, ["GB/Game.gb"]);
  assert.equal(fs.statSync(dest).mtimeMs, before);
  assert.equal(fs.readFileSync(dest, "utf8"), "same game");
});
