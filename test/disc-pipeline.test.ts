// Disc pipeline: step order, skipping, stop/resume between steps, failure + resume. Tools are stubbed.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { ctx, setRoot } from "../src/context.ts";
import {
  cancelDiscPipeline, discPipelineJson, dismissDiscPipeline, parsePipelineItems, pipelineDeps, resumeDiscPipeline,
  startDiscPipeline, waitForDiscPipeline,
} from "../src/games/disc-pipeline.ts";
import { rescanLibrary } from "../src/games/library.ts";

async function workspace(t: TestContext, files: string[]): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-"));
  const before = { root: ctx.root, cache: ctx.cacheDir };
  t.after(() => {
    setRoot(before.root);
    ctx.cacheDir = before.cache;
    fs.rmSync(root, { recursive: true, force: true });
  });
  setRoot(root);
  ctx.cacheDir = path.join(root, ".cache");
  fs.mkdirSync(ctx.cacheDir, { recursive: true });
  fs.mkdirSync(path.join(root, "Roms", "PS"), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(root, "Roms", "PS", f), "x");
  await rescanLibrary();
  return root;
}

function stubTools(calls: string[]) {
  const saved = { ...pipelineDeps };
  pipelineDeps.poll = 1;
  let fixRunning = false, chdRunning = false;
  pipelineDeps.inspect = (async () => ({ archive: "zip", plan: { kind: "cueSet", summary: "" }, outputHint: "" })) as never;
  pipelineDeps.fixOne = (async (body: Record<string, unknown>) => {
    calls.push(`fix:${body.file}`);
    fixRunning = true;
    setTimeout(() => { fixRunning = false; }, 2);
    fs.writeFileSync(path.join(ctx.roms, "PS", "Game (USA) (Disc 1).cue"), "x");
    fs.writeFileSync(path.join(ctx.roms, "PS", "Game (USA) (Disc 2).cue"), "x");
    await rescanLibrary();
  }) as never;
  pipelineDeps.fixStatus = (async () => ({ run: { running: fixRunning, written: ["Game (USA) (Disc 1).cue", "Game (USA) (Disc 2).cue"], error: "" } })) as never;
  pipelineDeps.chdStart = (async (body: Record<string, unknown>) => {
    calls.push(`chd:${(body.files as string[]).join("|")}`);
    chdRunning = true;
    setTimeout(() => { chdRunning = false; }, 2);
  }) as never;
  pipelineDeps.chdStatus = (async () => ({ tool: { present: true }, run: { running: chdRunning, converted: 2, failed: [] } })) as never;
  pipelineDeps.m3uWrite = (async (body: Record<string, unknown>) => {
    calls.push(`m3u:${body.code}`);
    return { m3uName: "Game (USA).m3u" };
  }) as never;
  return () => Object.assign(pipelineDeps, saved);
}

test("pipeline items accept {code,file}, files and items, and reject unsafe names", () => {
  assert.deepEqual(parsePipelineItems({ code: "PS", file: "A.zip" }), [{ code: "PS", file: "A.zip" }]);
  assert.deepEqual(parsePipelineItems({ files: ["A.zip", "A.zip", "B.cue"] }).map((i) => i.file), ["A.zip", "B.cue"]);
  assert.deepEqual(parsePipelineItems({ items: [{ code: "PS", file: "../x.zip" }, { code: "PSP", file: "Y.iso" }] }), [{ code: "PS", file: "x.zip" }, { code: "PSP", file: "Y.iso" }]);
  assert.throws(() => parsePipelineItems({ code: "PS" }), /at least one/);
  assert.throws(() => parsePipelineItems({ items: [{ code: "..", file: ".hidden" }] }), /at least one/);
});

test("pipeline runs fix, CHD, playlists and verify in order and skips what does not apply", async (t) => {
  await workspace(t, ["Game.zip"]);
  const calls: string[] = [];
  t.after(stubTools(calls));
  const started = await startDiscPipeline({ code: "PS", file: "Game.zip" });
  assert.equal(started.state, "running");
  assert.deepEqual(started.steps.map((s) => s.id), ["fix", "chd", "m3u", "verify"]);
  await waitForDiscPipeline();
  const done = discPipelineJson();
  assert.equal(done.state, "done");
  assert.deepEqual(calls, ["fix:Game.zip", "chd:Game (USA) (Disc 1).cue|Game (USA) (Disc 2).cue", "m3u:PS"]);
  assert.deepEqual(done.steps.map((s) => s.state), ["done", "done", "done", "skipped"]);
  assert.equal(dismissDiscPipeline().state, "idle");
});

test("pipeline stop takes effect between steps and resume continues from there", async (t) => {
  await workspace(t, ["Game.zip"]);
  const calls: string[] = [];
  t.after(stubTools(calls));
  await startDiscPipeline({ code: "PS", file: "Game.zip", verify: false });
  assert.equal(cancelDiscPipeline().cancelling, true);
  await waitForDiscPipeline();
  const paused = discPipelineJson();
  assert.equal(paused.state, "paused");
  assert.equal(paused.resumable, true);
  assert.deepEqual(calls, ["fix:Game.zip"]);
  resumeDiscPipeline();
  await waitForDiscPipeline();
  assert.equal(discPipelineJson().state, "done");
  assert.equal(calls.filter((c) => c.startsWith("fix:")).length, 1, "the finished fix step is not repeated");
  assert.equal(calls.length, 3);
  dismissDiscPipeline();
});

test("pipeline failure stops at the step, can be resumed, and cancel drops it", async (t) => {
  await workspace(t, ["Game.zip"]);
  const calls: string[] = [];
  t.after(stubTools(calls));
  let broken = true;
  const chdStart = pipelineDeps.chdStart;
  pipelineDeps.chdStart = (async (body: Record<string, unknown>) => {
    if (broken) throw new Error("chdman exploded");
    return chdStart(body);
  }) as never;
  await startDiscPipeline({ code: "PS", file: "Game.zip", verify: false });
  await waitForDiscPipeline();
  const failed = discPipelineJson();
  assert.equal(failed.state, "failed");
  assert.match(failed.error, /chdman exploded/);
  assert.deepEqual(failed.steps.map((s) => s.state), ["done", "failed", "pending"]);
  broken = false;
  resumeDiscPipeline();
  await waitForDiscPipeline();
  assert.equal(discPipelineJson().state, "done");

  broken = true;
  await startDiscPipeline({ code: "PS", file: "Game (USA) (Disc 1).cue", verify: false });
  await waitForDiscPipeline();
  assert.equal(discPipelineJson().state, "failed");
  assert.equal(cancelDiscPipeline().state, "cancelled");
  assert.throws(() => resumeDiscPipeline(), /no stopped/);
  dismissDiscPipeline();
});

test("pipeline refuses missing files and a second run while one is active", async (t) => {
  await workspace(t, ["Game.zip"]);
  const calls: string[] = [];
  t.after(stubTools(calls));
  await assert.rejects(startDiscPipeline({ code: "PS", file: "Nope.zip" }), /not found/);
  await startDiscPipeline({ code: "PS", file: "Game.zip", verify: false });
  await assert.rejects(startDiscPipeline({ code: "PS", file: "Game.zip" }), /already running/);
  await waitForDiscPipeline();
  dismissDiscPipeline();
});
