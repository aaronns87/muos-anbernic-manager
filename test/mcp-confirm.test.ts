// Confirm tokens for destructive MCP tools: first call previews, second call with confirmId runs once.

import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod/v4";
import { clearConfirms, createConfirm, pendingConfirmCount, takeConfirm } from "../src/mcp/confirm.ts";
import { ensureMcpTools, executeTool, listTools, toolCatalogue } from "../src/mcp/index.ts";
import { defineTool } from "../src/mcp/registry.ts";

test("confirm tokens work once, for the same tool and arguments, and expire", () => {
  clearConfirms();
  const made = createConfirm({ tool: "x_delete", summary: "Delete x", payload: { a: 1, b: [1, 2] } });
  assert.match(made.confirmId, /^cf_/);
  assert.equal(made.expiresInSec, 300);
  assert.equal(pendingConfirmCount(), 1);
  assert.equal(takeConfirm(made.confirmId, "x_delete", { b: [1, 2], a: 1 }).summary, "Delete x");
  assert.throws(() => takeConfirm(made.confirmId, "x_delete", { a: 1, b: [1, 2] }), /unknown or was already used/);

  const other = createConfirm({ tool: "x_delete", summary: "s", payload: { a: 1 } });
  assert.throws(() => takeConfirm(other.confirmId, "y_delete", { a: 1 }), /issued for x_delete/);
  const changed = createConfirm({ tool: "x_delete", summary: "s", payload: { a: 1 } });
  assert.throws(() => takeConfirm(changed.confirmId, "x_delete", { a: 2 }), /arguments changed/);

  const realNow = Date.now;
  const old = createConfirm({ tool: "x_delete", summary: "s" });
  try {
    Date.now = () => realNow() + 6 * 60_000;
    assert.throws(() => takeConfirm(old.confirmId, "x_delete"), /expired/);
  } finally {
    Date.now = realNow;
  }
  assert.throws(() => takeConfirm("", "x_delete"), /unknown/);
});

test("destructive MCP tools return needsConfirm first and only run with a matching confirmId", async () => {
  ensureMcpTools();
  clearConfirms();
  let ran = 0;
  if (!listTools().some((t) => t.name === "unit_confirm_probe")) {
    defineTool({
      name: "unit_confirm_probe",
      group: "meta",
      description: "Test-only destructive tool.",
      inputSchema: z.object({ target: z.string() }),
      confirm: { summary: (a) => `Remove ${a.target}` },
      handler: async (a) => { ran++; return { removed: a.target }; },
    });
  }

  const first = await executeTool("unit_confirm_probe", { target: "a" }, "test");
  assert.equal(first.ok, true);
  const preview = first.result as { needsConfirm: boolean; confirmId: string; summary: string };
  assert.equal(preview.needsConfirm, true);
  assert.equal(preview.summary, "Remove a");
  assert.equal(ran, 0);

  const wrong = await executeTool("unit_confirm_probe", { target: "b", confirmId: preview.confirmId }, "test");
  assert.equal(wrong.ok, false);
  assert.match(wrong.error!, /arguments changed/);
  assert.equal(ran, 0);

  const again = (await executeTool("unit_confirm_probe", { target: "a", dryRun: true }, "test")).result as { confirmId: string };
  const done = await executeTool("unit_confirm_probe", { target: "a", confirmId: again.confirmId }, "test");
  assert.deepEqual(done.result, { removed: "a" });
  assert.equal(ran, 1);
  const reuse = await executeTool("unit_confirm_probe", { target: "a", confirmId: again.confirmId }, "test");
  assert.equal(reuse.ok, false);
  assert.equal(ran, 1);
});

test("every destructive library, artwork, saves, files and system tool is guarded and documents confirmId", async () => {
  ensureMcpTools();
  clearConfirms();
  const guarded = [
    "game_delete", "artwork_local_delete", "artwork_delete_device", "bios_delete", "saves_game_delete",
    "saves_game_prune_states", "muxbak_restore", "files_delete", "ports_uninstall", "themes_delete",
    "checks_trash", "play_reset", "collections_delete", "system_start",
  ];
  const cat = toolCatalogue();
  const args: Record<string, Record<string, unknown>> = {
    game_delete: { path: "GB/Nope.gb" },
    artwork_local_delete: { system: "GB", names: ["x.png"] },
    artwork_delete_device: { volume: "v", catalogue: "c", kind: "box", name: "n" },
    bios_delete: { file: "scph1001.bin" },
    saves_game_delete: { code: "GB", file: "x.gb", name: "x.srm" },
    saves_game_prune_states: { code: "GB", file: "x.gb" },
    muxbak_restore: { name: "b.muxbak" },
    files_delete: { root: "roms", path: "x" },
    ports_uninstall: { name: "p" },
    themes_delete: { name: "t" },
    checks_trash: { paths: ["GB/x.gb"] },
    play_reset: { what: "time" },
    collections_delete: { path: "c" },
    system_start: { op: "tf2", disk: "disk9" },
  };
  for (const name of guarded) {
    const tool = listTools().find((t) => t.name === name);
    assert.ok(tool?.confirm, `${name} has a confirm spec`);
    assert.match(cat.tools.find((t) => t.name === name)!.detail, /confirmId/, `${name} detail mentions confirmId`);
    const out = await executeTool(name, args[name], "test");
    assert.equal(out.ok, true, `${name}: ${out.error}`);
    assert.equal((out.result as { needsConfirm?: boolean }).needsConfirm, true, `${name} previews first`);
  }
});

test("system_start keeps its confirm string and accepts a confirmId that carries it", async () => {
  ensureMcpTools();
  clearConfirms();
  const tool = listTools().find((t) => t.name === "system_start")!;
  const shape = tool.inputSchema.shape;
  assert.ok(shape.confirmId && shape.dryRun && shape.confirm);

  // A wrong explicit confirm still reaches the real check instead of being swallowed by the preview.
  const wrong = await executeTool("system_start", { op: "tf2", disk: "disk9", confirm: "nope" }, "test");
  assert.equal(wrong.ok, false);
  assert.doesNotMatch(wrong.error ?? "", /needsConfirm/);

  const wifi = (await executeTool("system_start", { op: "tf2", via: "wifi" }, "test")).result as { needsConfirm: boolean; confirmId: string };
  assert.equal(wifi.needsConfirm, true);
  const noDisk = await executeTool("system_start", { op: "tf2" }, "test");
  assert.equal(noDisk.ok, false);
  assert.match(noDisk.error!, /card id/);
});
