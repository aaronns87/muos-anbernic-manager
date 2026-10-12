// Boots the manager against a throwaway workspace and cache, and exercises the HTTP API and static files.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { managerDir as manager, startServer, type TestServer } from "./helpers.ts";

let srv: TestServer;
let base = "", token = "", root = "";
const api: TestServer["api"] = (...args) => srv.api(...args);

before(async () => {
  srv = await startServer({
    GB: ["Tetris (World).gb", "Tetris (Japan).gb", "Dr. Mario (World).gb"],
    MD: ["Sonic the Hedgehog (USA, Europe).md"],
    MAME: ["sf2.zip"],
  });
  ({ base, token, root } = srv);
});

after(() => srv?.stop());

test("API calls need the token and JSON bodies", async () => {
  assert.equal((await api("games", undefined, { "X-Manager-Token": "wrong" })).status, 403);
  assert.equal((await api("nothing-here")).status, 404);
  const res = await fetch(`${base}/api/checks/trash`, { method: "POST", headers: { "X-Manager-Token": token, "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(res.status, 415);
});

test("the library lists the temp workspace's games", async () => {
  const { status, json } = await api("games");
  assert.equal(status, 200);
  const gb = json.systems.find((s: { code: string }) => s.code === "GB");
  assert.deepEqual(gb.games.map((g: { f: string }) => g.f).sort(), ["Dr. Mario (World).gb", "Tetris (Japan).gb", "Tetris (World).gb"]);
  assert.equal(json.totals.games, 5);
  const sf2 = json.systems.find((s: { code: string }) => s.code === "MAME").games[0];
  assert.equal(sf2.t, "Street Fighter II: The World Warrior");
  assert.equal(sf2.a, "sf2");
});

test("duplicates: one group for Tetris, keeping the preferred region", async () => {
  const usa = (await api("checks?prefer=usa")).json;
  assert.equal(usa.run.running, false);
  assert.equal(usa.verify, null);
  assert.deepEqual(usa.supported.map((s: { code: string }) => s.code).sort(), ["GB", "MD"]);
  assert.equal(usa.dupes.groups.length, 1);
  const group = usa.dupes.groups[0];
  assert.equal(group.code, "GB");
  assert.equal(group.games.find((g: { keep: boolean }) => g.keep).f, "Tetris (World).gb");
  const japan = (await api("checks?prefer=japan")).json;
  assert.equal(japan.dupes.groups[0].games.find((g: { keep: boolean }) => g.keep).f, "Tetris (Japan).gb");
});

test("trash refuses empty or unsafe requests without touching files", async () => {
  assert.equal((await api("checks/trash", { paths: [] })).status, 400);
  const res = await api("checks/trash", { paths: ["Roms/../../etc/passwd", "Roms/GB/Nope (World).gb"] });
  assert.equal(res.status, 200);
  assert.equal(res.json.trashed, 0);
  assert.equal(res.json.failed.length, 2);
  assert.equal(fs.readdirSync(path.join(root, "Roms", "GB")).length, 3);
});

test("verify results leave out games that are no longer in the library", async () => {
  const counts = { ok: 3, bad: 2, modified: 0, unknown: 0, unchecked: 0 };
  const games = [
    { f: "Dr. Mario (World).gb", p: "Roms/GB/Dr. Mario (World).gb", state: "bad" },
    { f: "Gone (World).gb", p: "Roms/GB/Gone (World).gb", state: "bad" },
    { f: "Old (Japan).gb", p: "Roms/GB/Old (Japan).gb", state: "ok", as: "Old (Japan) (En)" },
  ];
  const saved = { checked: new Date().toISOString(), root: path.join(path.resolve(root), "Roms"), systems: [{ code: "GB", name: "Game Boy", dats: [], error: "", counts, renamed: 1, games }] };
  fs.writeFileSync(path.join(root, ".cache", "checks.json"), JSON.stringify(saved));
  const gb = (await api("checks")).json.verify.systems[0];
  assert.deepEqual(gb.games.map((g: { f: string }) => g.f), ["Dr. Mario (World).gb"]);
  assert.deepEqual([gb.counts.bad, gb.counts.ok, gb.renamed], [1, 2, 0]);
});

test("files: list, new folder, rename, read and save on this computer, and the activity log records it", async () => {
  const roots = (await api("files/roots")).json;
  assert.deepEqual(roots.local.map((r: { id: string }) => r.id), ["workspace"]);
  assert.deepEqual(roots.device, []);
  const list = async (p: string) => (await api(`files/list?side=local&root=workspace&path=${encodeURIComponent(p)}`)).json.entries.map((e: { name: string }) => e.name);
  assert.ok((await list("")).includes("Roms"));
  assert.equal((await api("files/mkdir", { side: "local", root: "workspace", path: "", name: "Notes" })).status, 200);
  assert.equal((await api("files/mkdir", { side: "local", root: "workspace", path: "", name: "Notes" })).status, 400);
  fs.writeFileSync(path.join(root, "Notes", "a.cfg"), 'x = "1"\n');
  assert.equal((await api("files/rename", { side: "local", root: "workspace", path: "Notes", from: "a.cfg", to: "b.cfg" })).status, 200);
  assert.deepEqual(await list("Notes"), ["b.cfg"]);
  const read = (await api("files/read?side=local&root=workspace&path=Notes/b.cfg")).json;
  assert.deepEqual([read.text, read.editable], ['x = "1"\n', true]);
  assert.equal((await api("files/write", { side: "local", root: "workspace", path: "Notes/b.cfg", text: 'x = "2"\n' })).status, 200);
  assert.equal(fs.readFileSync(path.join(root, "Notes", "b.cfg"), "utf8"), 'x = "2"\n');
  const log = (await api("activity?q=notes")).json;
  assert.ok(log.entries.some((e: { tag: string }) => e.tag === "CREATED"), JSON.stringify(log.entries));
  assert.ok(log.entries.some((e: { tag: string; level: string }) => e.tag === "SAVED" && e.level === "done"));
});

test("files refuse paths outside the workspace and unsafe names", async () => {
  assert.equal((await api("files/list?side=local&root=workspace&path=../..")).status, 400);
  assert.equal((await api("files/read?side=local&root=workspace&path=Roms/../../x")).status, 400);
  assert.equal((await api("files/list?side=local&root=elsewhere&path=")).status, 400);
  assert.equal((await api("files/mkdir", { side: "local", root: "workspace", path: "", name: "../up" })).status, 400);
  assert.equal((await api("files/rename", { side: "local", root: "workspace", path: "", from: "Roms", to: "a:b" })).status, 400);
  assert.equal((await api("files/write", { side: "local", root: "workspace", path: "../outside.txt", text: "x" })).status, 400);
  assert.ok(fs.existsSync(path.join(root, "Roms")));
});

test("BIOS sends and app downloads are validated before any network access", async () => {
  assert.equal((await api("bios/send", { keys: [] })).status, 400);
  assert.equal((await api("updates/download", { repo: "someone/else", asset: "x.muxapp" })).status, 400);
});

test("static files are served, hidden paths are not", async () => {
  const js = await fetch(`${base}/js/checks.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type") ?? "", /javascript/);
  assert.equal((await fetch(`${base}/.cache/settings.json`)).status, 404);
  assert.equal((await fetch(`${base}/`)).status, 200);
});

test("every front-end module parses", () => {
  const dir = path.join(manager, "public", "js");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    execFileSync(process.execPath, ["--check", path.join(dir, f)], { stdio: "pipe" });
  }
});

test("index.html has the elements the Emulation and Apps views render into", () => {
  const html = fs.readFileSync(path.join(manager, "public", "index.html"), "utf8");
  for (const id of ["view-emulation", "view-wiki", "wiki", "help", "help-wiki", "help-close", "help-full", "emu-tabs", "emu-body", "emu-actions", "emu-sub", "bios-files", "apps-updates", "confirm", "c-ok", "c-cancel",
    "view-play", "play-tabs", "play-body", "play-sub", "play-actions", "view-themes", "th-tabs", "themes", "th-sub", "th-actions", "themeview", "thv-title", "thv-body", "thv-foot", "view-files", "files", "fileview", "fv-title", "fv-where", "fv-body", "fv-note", "fv-save",
    "fv-done", "fv-close", "activity", "act-q", "act-level", "act-list", "act-count", "act-more", "act-close", "ag-files", "ag-folder",
    "portmaster", "pm-main", "pm-foot", "pm-close", "portview", "pmv-title", "pmv-sub", "pmv-body", "pmv-foot", "pmv-close", "pm-files", "pm-folder",
    "svmfree", "svf-body", "svf-note", "svf-close"]) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} is missing`);
  }
});
