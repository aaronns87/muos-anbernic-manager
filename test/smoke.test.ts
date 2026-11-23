// Smoke suite: API contracts, static modules and source wiring for features that must stay alive.
// Run before commits with `npm run smoke`. When you add a user-visible feature, extend this file
// (and the browser smoke in test/browser.test.ts) so a broken wire fails here first.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { managerDir, startServer, type TestServer } from "./helpers.ts";

let srv: TestServer;

before(async () => {
  srv = await startServer({
    GB: ["Tetris (World).gb"],
    PS: [
      "Final Fantasy VII (USA) (Disc 1).cue",
      "Final Fantasy VII (USA) (Disc 2).cue",
    ],
  });
});

after(() => srv?.stop());

const api = (route: string, body?: unknown) => srv.api(route, body);

test("smoke: library lists seeded systems and games", async () => {
  const { status, json } = await api("games");
  assert.equal(status, 200);
  const systems = json.raw?.systems ?? json.systems;
  assert.ok(Array.isArray(systems));
  const codes = new Set(systems.map((s: { code: string }) => s.code));
  assert.ok(codes.has("GB"));
  assert.ok(codes.has("PS"));
  const ps = systems.find((s: { code: string }) => s.code === "PS");
  assert.equal(ps.games.length, 2);
});

test("smoke: games/flags returns bad-dump and tuning lists", async () => {
  const { status, json } = await api("games/flags");
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.bad));
  assert.ok(Array.isArray(json.tuning));
});

test("smoke: free homebrew catalogue is non-empty and legal-shaped", async () => {
  const { status, json } = await api("homebrew/free");
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.games));
  assert.ok(json.games.length >= 1);
  for (const g of json.games) {
    assert.ok(g.id && g.title && g.system && g.file);
    assert.equal(typeof g.size, "number");
    assert.equal(typeof g.have, "boolean");
  }
  assert.ok(typeof json.note === "string");
});

test("smoke: saves JSON answers without a handheld", async () => {
  const { status, json } = await api("saves");
  assert.equal(status, 200);
  assert.ok("backups" in json);
  assert.ok("device" in json || "deviceError" in json || "available" in json);
});

test("smoke: per-game saves route validates input", async () => {
  const missing = await api("saves/game");
  assert.equal(missing.status, 400);
  const ok = await api("saves/game?code=GB&file=Tetris%20(World).gb");
  assert.equal(ok.status, 200);
  assert.equal(ok.json.code, "GB");
  assert.ok(Array.isArray(ok.json.files));
  assert.equal(typeof ok.json.reachable, "boolean");
});

test("smoke: logs list and support pack zip", async () => {
  const list = await api("logs");
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json.entries) || Array.isArray(list.json.days));
  const res = await fetch(`${srv.base}/api/logs/support-pack`, {
    headers: { "X-Manager-Token": srv.token },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /zip|octet-stream/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 4);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
});

test("smoke: Syncthing idle probe answers offline", async () => {
  const { status, json } = await api("ssh/syncthing-idle");
  assert.equal(status, 200);
  assert.equal(typeof json.idle, "boolean");
  assert.ok("detail" in json);
});

test("smoke: play ROM stream for light and disc systems", async () => {
  // Path form keeps the real filename for EmulatorJS (query-only URLs were named "rom").
  const romPath = `/api/games/rom/GB/${encodeURIComponent("Tetris (World).gb")}?token=${srv.token}`;
  const head = await fetch(`${srv.base}${romPath}`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.ok(Number(head.headers.get("content-length")) > 0);

  const ok = await fetch(`${srv.base}${romPath}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("content-type") || "", /octet-stream|application\//);
  const body = Buffer.from(await ok.arrayBuffer());
  assert.ok(body.length > 0);
  assert.match(body.toString("utf8"), /rom data for Tetris/);
  assert.equal(body.length, Number(head.headers.get("content-length")));

  const badPath = await fetch(`${srv.base}/api/games/rom/GB/${encodeURIComponent("../etc/passwd")}?token=${srv.token}`);
  assert.equal(badPath.status, 400);

  const disc = await fetch(`${srv.base}/api/games/rom/PS/${encodeURIComponent("Final Fantasy VII (USA) (Disc 1).cue")}?token=${srv.token}`);
  assert.equal(disc.status, 200);
  assert.match(Buffer.from(await disc.arrayBuffer()).toString("utf8"), /Final Fantasy VII/);

  const blocked = await fetch(`${srv.base}/api/games/rom/GB/${encodeURIComponent("sheet.cue")}?token=${srv.token}`);
  assert.equal(blocked.status, 400);

  const dreamcast = await fetch(`${srv.base}/api/games/rom/DC/${encodeURIComponent("Sonic.chd")}?token=${srv.token}`);
  assert.equal(dreamcast.status, 400);
});

test("smoke: play BIOS list and stream for disc systems", async () => {
  const listEmpty = await fetch(`${srv.base}/api/games/bios?list=1&code=PS&token=${srv.token}`);
  assert.equal(listEmpty.status, 200);
  const emptyJson = await listEmpty.json() as { code: string; bios: string[]; preferred: string[] };
  assert.equal(emptyJson.code, "PS");
  assert.ok(Array.isArray(emptyJson.bios));
  assert.ok(Array.isArray(emptyJson.preferred));
  assert.ok(emptyJson.preferred.includes("scph5501.bin"));

  fs.mkdirSync(path.join(srv.root, "bios"), { recursive: true });
  fs.writeFileSync(path.join(srv.root, "bios", "scph5501.bin"), "fake ps bios");

  const listOk = await fetch(`${srv.base}/api/games/bios?list=1&code=PS&token=${srv.token}`);
  assert.equal(listOk.status, 200);
  const okJson = await listOk.json() as { bios: string[] };
  assert.ok(okJson.bios.includes("scph5501.bin"));

  const biosPath = `/api/games/bios/${encodeURIComponent("scph5501.bin")}?token=${srv.token}`;
  const head = await fetch(`${srv.base}${biosPath}`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), Buffer.byteLength("fake ps bios"));

  const dl = await fetch(`${srv.base}${biosPath}`);
  assert.equal(dl.status, 200);
  assert.equal(Buffer.from(await dl.arrayBuffer()).toString("utf8"), "fake ps bios");

  const bad = await fetch(`${srv.base}/api/games/bios/${encodeURIComponent("../etc/passwd")}?token=${srv.token}`);
  assert.equal(bad.status, 400);
});

test("smoke: multi-disc m3u preview and write beside ROMs", async () => {
  const lib = await api("games");
  const systems = lib.json.raw?.systems ?? lib.json.systems;
  const ps = systems.find((s: { code: string }) => s.code === "PS");
  assert.ok(ps);
  // Group id is the lowercased disc-set stem from filenames with (Disc N).
  const group = "final fantasy vii (usa)";
  const prev = await api("disc-m3u/preview", { code: "PS", group });
  assert.equal(prev.status, 200, prev.json?.error || "preview failed");
  assert.match(prev.json.m3uName, /\.m3u$/i);
  assert.ok(prev.json.preview.includes("Disc 1"));
  assert.ok(prev.json.preview.includes("Disc 2"));
  const written = await api("disc-m3u/write", { code: "PS", group });
  assert.equal(written.status, 200, written.json?.error || "write failed");
  const dest = path.join(srv.root, "Roms", "PS", prev.json.m3uName);
  assert.ok(fs.existsSync(dest), `expected ${dest}`);
  const text = fs.readFileSync(dest, "utf8");
  assert.match(text, /Disc 1/);
  assert.match(text, /Disc 2/);
});

test("smoke: workspace and activity endpoints respond", async () => {
  assert.equal((await api("workspace")).status, 200);
  assert.equal((await api("activity")).status, 200);
  assert.equal((await api("status")).status, 200);
});

test("smoke: MCP settings, tools, stats and /mcp auth", async () => {
  const settings = await api("mcp/settings");
  assert.equal(settings.status, 200);
  assert.equal(settings.json.enabled, true);
  assert.equal(settings.json.listening, true);
  assert.match(settings.json.url, /\/mcp$/);
  assert.ok(settings.json.tokenHint);

  const tools = await api("mcp/tools");
  assert.equal(tools.status, 200);
  assert.ok(tools.json.count >= 10);
  assert.ok(tools.json.groups?.library?.length);

  const stats = await api("mcp/stats");
  assert.equal(stats.status, 200);
  assert.ok(Array.isArray(stats.json.recent));
  assert.ok(Array.isArray(stats.json.sessions));

  const configs = await api("mcp/configs");
  assert.equal(configs.status, 200);
  assert.match(configs.json.cursor, /MuAnMCP/);
  assert.match(configs.json.cursor, /muOS Anbernic Manager/);
  assert.equal(configs.json.serverKey, "MuAnMCP");
  assert.match(configs.json.claudeDesktop, /Bearer/);

  const { mcpServerIcons } = await import("../src/mcp/icons.ts");
  const icons = await mcpServerIcons();
  assert.ok(icons.length >= 1);
  assert.match(icons[0].src, /^data:image\//);
  assert.ok(Array.isArray(configs.json.clients) && configs.json.clients.length >= 4);

  const clients = await api("mcp/clients");
  assert.equal(clients.status, 200);
  assert.ok(Array.isArray(clients.json.clients));
  assert.ok(clients.json.clients.some((c: { id: string }) => c.id === "cursor"));

  const agents = await api("mcp/agents");
  assert.equal(agents.status, 200);
  assert.ok(Array.isArray(agents.json.packs));
  assert.ok(agents.json.packs.length >= 6);
  assert.ok(agents.json.packs.some((p: { id: string; kind: string }) => p.id === "manager-mcp" && p.kind === "skill"));
  const content = await api("mcp/agents/content?id=manager-mcp");
  assert.equal(content.status, 200);
  assert.match(content.json.markdown || "", /Manager MCP skill/);
  assert.equal((await api("mcp/agents/content?id=not-a-pack")).status, 400);
  assert.equal((await api("mcp/agents/install", { id: "manager-mcp", clientId: "nope" })).status, 400);

  const noAuth = await fetch(`${srv.base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(noAuth.status, 401);

  const revealed = await api("mcp/settings?reveal=1");
  assert.equal(revealed.status, 200);
  assert.ok(revealed.json.token);
  const badTok = await fetch(`${srv.base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-token" },
    body: "{}",
  });
  assert.equal(badTok.status, 401);

  const off = await api("mcp/settings", { enabled: false });
  assert.equal(off.status, 200);
  assert.equal(off.json.enabled, false);
  const disabled = await fetch(`${srv.base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${revealed.json.token}` },
    body: "{}",
  });
  assert.equal(disabled.status, 404);
  const on = await api("mcp/settings", { enabled: true, assistantUsesTools: true });
  assert.equal(on.status, 200);
  assert.equal(on.json.enabled, true);
});

test("smoke: roadmap front-end modules parse", () => {
  const dir = path.join(managerDir, "public", "js");
  for (const f of [
    "profiles.js", "uptodate.js", "lists.js", "recipes.js", "free-homebrew.js", "play-browser.js", "tips.js",
    "device.js", "games.js", "saves.js", "checks.js", "logs.js", "settings.js", "overview.js", "mcp.js", "layout.js",
  ]) {
    execFileSync(process.execPath, ["--check", path.join(dir, f)], { stdio: "pipe" });
  }
});

test("smoke: index and source keep roadmap UI wiring", () => {
  const html = fs.readFileSync(path.join(managerDir, "public", "index.html"), "utf8");
  for (const id of ["smart-list", "hbfree", "hbf-body", "hbf-close", "confirm", "view-logs", "view-games", "view-emulation", "playbrowser", "play-ejs", "v-play"]) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} missing from index.html`);
  }
  assert.match(html, /Favourites|Never copied|No art|Bad dump|Needs tuning|On device only/);
  assert.match(html, /Play in browser/);

  const device = fs.readFileSync(path.join(managerDir, "public", "js", "device.js"), "utf8");
  assert.match(device, /Handheld on this network/);
  assert.match(device, /Save and connect/);
  assert.match(device, /Find on network/);
  assert.match(device, /waitSyncthingIdle|data-syncthing-idle/);

  const games = fs.readFileSync(path.join(managerDir, "public", "js", "games.js"), "utf8");
  assert.match(games, /data-uptodate/);
  assert.match(games, /smart-list|smartList/);
  assert.match(games, /data-fav|toggleFavourite/);
  assert.match(games, /card-play|openPlayBrowserFor|data-play-card/);

  const play = fs.readFileSync(path.join(managerDir, "public", "js", "play-browser.js"), "utf8");
  assert.match(play, /canPlayInBrowser|openPlayBrowser|EJS_defaultControls|cdn\.emulatorjs\.org/);
  assert.match(play, /return \{ 0: player0, 1: \{\}, 2: \{\}, 3: \{\} \}/);
  assert.match(play, /play-pad|play-bind|requestClosePlay|cancel|setPlayFocus|play-focus|EJS_disableLocalStorage|applySessionControls|playScrollKeyGuard|play-open/);
  assert.match(html, /data-play="focus"|play-float/);

  const tips = fs.readFileSync(path.join(managerDir, "public", "js", "tips.js"), "utf8");
  assert.match(tips, /id: "play-browser"|Play in the browser|page behind does not scroll/);

  const overview = fs.readFileSync(path.join(managerDir, "public", "js", "overview.js"), "utf8");
  assert.match(overview, /data-uptodate/);
  assert.match(overview, /digestPanelHtml|digest-panel/);

  const settings = fs.readFileSync(path.join(managerDir, "public", "js", "settings.js"), "utf8");
  assert.match(settings, /recipesPanelHtml|bindRecipes/);
  assert.match(settings, /export function showMcp|bindMcpPage|mcpPanel/);
  assert.match(settings, /mcp-scan|mcp-setup|mcp-tools-table|mcp-rotate|mcpAgentsSection|mcp-agent-review|Install all|mcp-agent-install-all|positionMcpMenus/);
  const core = fs.readFileSync(path.join(managerDir, "public", "js", "core.js"), "utf8");
  assert.match(core, /"ssh", "mcp", "settings"/);
  const indexHtml = fs.readFileSync(path.join(managerDir, "public", "index.html"), "utf8");
  assert.match(indexHtml, /data-section="mcp"|id="view-mcp"/);

  const mcpUi = fs.readFileSync(path.join(managerDir, "public", "js", "mcp.js"), "utf8");
  assert.match(mcpUi, /data-mcp-panel|sb-mcp-panel|Tools → MCP|assistantUsesMcp/);

  const chatUi = fs.readFileSync(path.join(managerDir, "public", "js", "chat.js"), "utf8");
  assert.match(chatUi, /chat-mcp-chip|assistantUsesMcp/);
  const chatSrc = fs.readFileSync(path.join(managerDir, "src", "chat.ts"), "utf8");
  assert.match(chatSrc, /"openai"|"xai"|"custom"/);
  assert.match(chatSrc, /api\.openai\.com|api\.x\.ai/);

  assert.match(device, /mcpListening|data-mcp-panel|sb-mcp/);

  const tipsMcp = fs.readFileSync(path.join(managerDir, "public", "js", "tips.js"), "utf8");
  assert.match(tipsMcp, /id: "mcp"|Tools → MCP/);

  const logs = fs.readFileSync(path.join(managerDir, "public", "js", "logs.js"), "utf8");
  assert.match(logs, /support-pack|exportSupportPack/);

  const checks = fs.readFileSync(path.join(managerDir, "public", "js", "checks.js"), "utf8");
  assert.match(checks, /Make playlist|disc-m3u/);

  const saves = fs.readFileSync(path.join(managerDir, "public", "js", "saves.js"), "utf8");
  assert.match(saves, /saves\/game|Save browser/);

  const add = fs.readFileSync(path.join(managerDir, "public", "js", "add-games.js"), "utf8");
  assert.match(add, /free-homebrew|openFreeHomebrew/);

  const server = fs.readFileSync(path.join(managerDir, "src", "server.ts"), "utf8");
  for (const route of [
    "games/flags", "homebrew/free", "disc-m3u/preview", "disc-m3u/write", "disc-m3u/batch",
    "saves/game", "logs/support-pack", "ssh/syncthing-idle", "games/rom",
    "mcp/settings", "mcp/stats", "mcp/tools", "mcp/configs", "mcp/clients", "mcp/agents", "mcp/token/rotate",
  ]) {
    assert.match(server, new RegExp(route.replace(/\//g, "\\/")), `route ${route} missing from server.ts`);
  }
  assert.match(server, /GET \/api\/games\/rom/);
  assert.match(server, /isMcpPath|handleMcpHttp/);

  const appJs = fs.readFileSync(path.join(managerDir, "public", "js", "app.js"), "utf8");
  assert.match(appJs, /"mcp"/);
  assert.match(appJs, /loadMcpStatus/);
});

test("smoke: data/free-homebrew.json is valid curated catalogue", () => {
  const file = path.join(managerDir, "data", "free-homebrew.json");
  assert.ok(fs.existsSync(file));
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const games = Array.isArray(data) ? data : data.games;
  assert.ok(Array.isArray(games) && games.length >= 1);
  for (const g of games) {
    assert.ok(g.id && g.title && g.system && g.url && g.file);
  }
});
