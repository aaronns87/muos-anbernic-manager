// Workspace metadata backup (encrypted zip) and idle jobs, run against a temp workspace and cache.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ctx } from "../src/context.ts";
import { resetProfilesCache } from "../src/device/profiles.ts";
import { cleanIdleConfig, idleJobsJson, idleJobsTick, importIdleConfig, loadIdleConfig, saveIdleJobs } from "../src/idle-jobs.ts";
import { backupMeta, metaBackupsJson, restoreMeta, seal, unseal } from "../src/workspace-meta.ts";

function tempWorkspace(t: { after: (fn: () => void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-"));
  const before = { root: ctx.root, cache: ctx.cacheDir, backups: ctx.backups };
  t.after(() => {
    Object.assign(ctx, { root: before.root, cacheDir: before.cache, backups: before.backups });
    resetProfilesCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  ctx.root = dir;
  ctx.cacheDir = path.join(dir, ".cache");
  ctx.backups = path.join(dir, "backups");
  fs.mkdirSync(ctx.cacheDir, { recursive: true });
  return dir;
}

test("metadata seal: round trip, wrong passphrase and tampering are refused", async () => {
  const sealed = await seal(Buffer.from("hello zip"), "correct horse");
  assert.equal((await unseal(sealed, "correct horse")).toString(), "hello zip");
  await assert.rejects(unseal(sealed, "wrong passphrase"), /Wrong passphrase/);
  const bent = Buffer.from(sealed);
  bent[bent.length - 1] ^= 1;
  await assert.rejects(unseal(bent, "correct horse"), /Wrong passphrase/);
  await assert.rejects(unseal(Buffer.from("not a backup at all, just text"), "correct horse"), /not a manager metadata backup/);
});

test("metadata backup writes an encrypted file and restore brings the data back", async (t) => {
  tempWorkspace(t);
  const profiles = { activeId: "p1", profiles: [{ id: "p1", label: "Desk", wifi: { host: "192.168.0.9", user: "muos", port: 2022 }, ssh: { host: "", user: "root", port: 22 }, model: "RG35XX", updatedAt: 1 }] };
  fs.writeFileSync(path.join(ctx.cacheDir, "device-profiles.json"), JSON.stringify(profiles));
  fs.writeFileSync(path.join(ctx.cacheDir, "recipe-packs.json"), JSON.stringify({ packs: [{ id: "mine", name: "Mine", steps: [{ type: "governor_set", folder: "GBA", file: "G.gba", gov: "performance" }] }] }));
  fs.writeFileSync(path.join(ctx.cacheDir, "metadata-index.json"), "x".repeat(2048));
  fs.mkdirSync(path.join(ctx.cacheDir, "thumbnails"));
  fs.writeFileSync(path.join(ctx.cacheDir, "thumbnails", "Atari_-_2600.json"), "{}");
  fs.writeFileSync(path.join(ctx.cacheDir, "thumbnails", "Huge.json"), "x".repeat(300 * 1024));

  await assert.rejects(backupMeta({ passphrase: "short" }), /at least 8/);
  await assert.rejects(backupMeta({ passphrase: "long enough", path: "../../outside.mumeta" }), /inside the workspace/);
  const made = await backupMeta({ passphrase: "long enough", libraryRecipes: { "after-add": { enabled: false } } });
  assert.ok(made.path.startsWith(ctx.backups) && made.name.endsWith(".mumeta"));
  assert.ok(made.files.includes("device-profiles.json") && made.files.includes("library-recipes.json") && made.files.includes("scrape-index/Atari_-_2600.json"));
  assert.ok(!made.files.some((f: string) => f.includes("metadata-index") || f.includes("Huge")), "big caches stay out");
  assert.ok(made.skipped.includes("scrape-index/Huge.json"));
  const raw = fs.readFileSync(made.path);
  assert.ok(!raw.includes("192.168.0.9"), "the file is encrypted");
  assert.equal((await metaBackupsJson()).backups[0].name, made.name);

  fs.writeFileSync(path.join(ctx.cacheDir, "device-profiles.json"), JSON.stringify({ activeId: "", profiles: [] }));
  fs.rmSync(path.join(ctx.cacheDir, "recipe-packs.json"));
  resetProfilesCache();
  await assert.rejects(restoreMeta({ file: made.name, passphrase: "long enough" }), /Confirm/);
  await assert.rejects(restoreMeta({ file: made.name, passphrase: "not the one!!", confirm: true }), /Wrong passphrase/);
  await assert.rejects(restoreMeta({ file: "nope.mumeta", passphrase: "long enough", confirm: true }), /does not exist/);
  const done = await restoreMeta({ file: made.name, passphrase: "long enough", confirm: true });
  assert.ok(done.restored.includes("device profiles") && done.restored.some((r: string) => r.startsWith("recipe packs")));
  assert.deepEqual(done.libraryRecipes, { "after-add": { enabled: false } });
  const back = JSON.parse(fs.readFileSync(path.join(ctx.cacheDir, "device-profiles.json"), "utf8"));
  assert.equal(back.profiles[0].wifi.host, "192.168.0.9");
  assert.equal(fs.statSync(path.join(ctx.cacheDir, "device-profiles.json")).mode & 0o077, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ctx.cacheDir, "recipe-packs.json"), "utf8")).packs[0].id, "mine");
  assert.ok(fs.existsSync(path.join(ctx.cacheDir, "thumbnails", "Atari_-_2600.json")));
});

test("idle jobs: config is validated, restored switched off, and a tick without a handheld does nothing", async (t) => {
  tempWorkspace(t);
  assert.deepEqual(cleanIdleConfig({ enabled: true, cooldownMs: 1, libraryRecipeTrigger: "other" }).cooldownMs, 5 * 60_000);
  assert.equal(cleanIdleConfig({ libraryRecipeTrigger: "other" }).libraryRecipeTrigger, "");

  assert.equal((await idleJobsJson()).config.enabled, false);
  await assert.rejects(saveIdleJobs({ enabled: true }), /Choose a recipe pack/);
  await assert.rejects(saveIdleJobs({ recipePackId: "missing-pack" }), /no recipe pack/);
  await assert.rejects(saveIdleJobs({ libraryRecipeTrigger: "scrape_missing_all" }), /cannot run by itself/);
  const saved = await saveIdleJobs({ enabled: true, libraryRecipeTrigger: "rescan-library", cooldownMinutes: 90 });
  assert.equal(saved.config.cooldownMs, 90 * 60_000);
  assert.equal(saved.config.enabled, true);
  assert.equal(await idleJobsTick(), "offline");
  assert.equal((await loadIdleConfig()).lastRunAt, 0);

  await importIdleConfig({ enabled: true, libraryRecipeTrigger: "rescan-library", cooldownMs: 600_000, lastRunAt: 5 });
  const after = await loadIdleConfig();
  assert.equal(after.enabled, false);
  assert.equal(after.cooldownMs, 600_000);
  assert.equal(after.lastRunAt, 0);
});
