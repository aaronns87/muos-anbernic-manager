// Opens the app in headless Chrome over the DevTools protocol (no extra packages) and visits every
// section and Emulation tab at desktop and phone widths: no script errors, no sideways scrolling.
// Skipped when Chrome is not installed; set CHROME_PATH to use another Chromium build.

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { startServer, type TestServer } from "./helpers.ts";

const CHROME = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find((p) => p && fs.existsSync(p));

const SECTIONS = ["overview", "games", "play", "artwork", "apps", "handheld", "themes", "emulation", "files", "tuning", "system", "ssh", "settings", "wiki"];
const TABS = ["saves", "bios", "cores", "retroarch", "checks"];

class Cdp {
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  readonly events: { method: string; params: any }[] = [];
  private ws: WebSocket;
  private session = "";
  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data));
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      } else if (msg.method) this.events.push(msg);
    });
  }
  send(method: string, params: object = {}, sessionId = this.session): Promise<any> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  attach(sessionId: string) { this.session = sessionId; }
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  }
  async until(expression: string, ms = 10_000): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await this.eval<boolean>(expression).catch(() => false)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }
}

let srv: TestServer, chrome: ChildProcess, cdp: Cdp, profile = "";

const errors = () => cdp.events.flatMap(({ method, params }) => {
  if (method === "Runtime.exceptionThrown") return [params.exceptionDetails.exception?.description ?? params.exceptionDetails.text];
  if (method === "Runtime.consoleAPICalled" && params.type === "error") return [params.args.map((a: any) => a.value ?? a.description).join(" ")];
  return [];
});

before(async () => {
  if (!CHROME) return;
  srv = await startServer({ GB: ["Tetris (World).gb", "Tetris (Japan).gb"], MD: ["Sonic the Hedgehog (USA, Europe).md"] });
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "manager-chrome-"));
  chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let err = "";
    const timer = setTimeout(() => reject(new Error(`Chrome did not start:\n${err}`)), 20_000);
    chrome.stderr!.on("data", (c: Buffer) => {
      err += c.toString();
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  cdp = new Cdp(ws);
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  cdp.attach(sessionId);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("manager.mode", JSON.stringify("card"));` });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: `${srv.base}/?token=${srv.token}#overview` });
  await cdp.until(`document.readyState === "complete" && !!document.querySelector('a[href="#games"]')`);
});

after(async () => {
  srv?.stop();
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
  if (profile) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function visit(width: number) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: width < 700 });
  const problems: string[] = [];
  const check = async (where: string) => {
    await new Promise((r) => setTimeout(r, 300));
    const sw = await cdp.eval<number>("document.documentElement.scrollWidth");
    if (sw <= width + 1) return;
    const wide = await cdp.eval<string[]>(`[...document.querySelectorAll("body *")]
      .filter((e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") return false; return true; })
      .filter((e) => e.getBoundingClientRect().right > ${width + 1} && ![...e.children].some((c) => c.getBoundingClientRect().right > ${width + 1}))
      .slice(0, 4).map((e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\\s+/).join(".") : "") + " " + Math.round(e.getBoundingClientRect().right) + "px")`);
    problems.push(`${where} at ${width}px scrolls sideways (${sw}px): ${wide.join(", ")}`);
  };
  for (const s of SECTIONS) {
    await cdp.eval(`location.hash = "#${s}"`);
    await cdp.until(`(() => { const v = document.getElementById("view-${s}"); return v && !v.hidden && v.innerText.trim().length > 0; })()`);
    await check(s);
  }
  await cdp.eval(`location.hash = "#emulation"`);
  for (const t of TABS) {
    await cdp.until(`!!document.querySelector('#emu-tabs [data-tab="${t}"]')`);
    await cdp.eval(`document.querySelector('#emu-tabs [data-tab="${t}"]').click()`);
    await cdp.until(`(() => { const b = document.getElementById("emu-body"); return b.innerText.trim().length > 10 && !b.querySelector(".planning"); })()`, 15_000);
    await check(`Emulation > ${t}`);
  }
  return problems;
}

test("every section and Emulation tab renders without errors on desktop and phone", { skip: !CHROME && "Chrome not found" }, async () => {
  const problems = [];
  for (const width of [1440, 1024, 768, 420, 390, 320]) problems.push(...await visit(width));
  await cdp.eval(`document.documentElement.dataset.theme = "light"`);
  problems.push(...await visit(1440), ...await visit(390));
  await cdp.eval(`document.documentElement.dataset.theme = "dark"`);
  assert.deepEqual(errors(), [], "script errors in the page");
  assert.deepEqual(problems, []);
});

test("Library check shows the Tetris duplicate with the World version suggested", { skip: !CHROME && "Chrome not found" }, async () => {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.eval(`location.hash = "#emulation"`);
  await cdp.eval(`document.querySelector('#emu-tabs [data-tab="checks"]').click()`);
  await cdp.until(`!!document.querySelector('[data-ck="view"][data-view="dupes"]')`);
  await cdp.eval(`document.querySelector('[data-ck="view"][data-view="dupes"]').click()`);
  await cdp.until(`document.querySelectorAll(".chk-group").length === 1`);
  const rows = await cdp.eval<{ f: string; picked: boolean; keep: boolean }[]>(`[...document.querySelectorAll(".chk-dup")].map((r) => ({
    f: r.querySelector("b").textContent, picked: r.querySelector("input").checked, keep: r.innerText.includes("Suggested") }))`);
  assert.deepEqual(rows, [
    { f: "Tetris (Japan).gb", picked: true, keep: false },
    { f: "Tetris (World).gb", picked: false, keep: true },
  ]);
  await cdp.eval(`document.querySelector('[data-ck="trash"]').click()`);
  await cdp.until(`document.getElementById("confirm").open`);
  assert.match(await cdp.eval<string>(`document.getElementById("c-body").innerText`), /GB\/Tetris \(Japan\)\.gb/);
  await cdp.eval(`document.getElementById("c-cancel").click()`);
  await cdp.until(`!document.getElementById("confirm").open`);
  assert.ok(fs.existsSync(path.join(srv.root, "Roms", "GB", "Tetris (Japan).gb")), "cancel leaves the file alone");
  assert.deepEqual(errors(), []);
});

test("sidebar order and number keys follow the sections", { skip: !CHROME && "Chrome not found" }, async () => {
  const order = await cdp.eval<string[]>(`[...document.querySelectorAll(".section-link")].map((a) => a.dataset.section)`);
  assert.deepEqual(order, SECTIONS);
  for (const [key, want] of [["3", "play"], ["7", "themes"], ["8", "emulation"], ["9", "files"], ["0", "wiki"]]) {
    await cdp.eval(`document.activeElement?.blur(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "${key}", bubbles: true }))`);
    await cdp.until(`location.hash === "#${want}"`);
  }
});

test("shared tabs support keyboard navigation and Settings folders use a desktop grid", { skip: !CHROME && "Chrome not found" }, async () => {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await cdp.eval(`location.hash = "#settings"`);
  await cdp.until(`!!document.querySelector(".set-folders-grid")`);
  assert.ok(await cdp.eval<boolean>(`getComputedStyle(document.querySelector('.set-folders-grid')).gridTemplateColumns.split(' ').length >= 2`));
  for (const [key, expected] of [["ArrowRight", "behaviour"], ["End", "resets"], ["ArrowRight", "folders"], ["ArrowLeft", "resets"], ["Home", "folders"]]) {
    await cdp.eval(`(() => { const tab = document.querySelector('#settings-tabs [aria-selected="true"]'); tab.focus(); tab.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true })); })()`);
    await cdp.until(`document.activeElement?.dataset.settingsTab === "${expected}"`);
    assert.equal(await cdp.eval<number>(`[...document.querySelectorAll('#settings-tabs [role="tab"]')].filter(t=>t.tabIndex === 0).length`), 1);
  }
  assert.equal(await cdp.eval<string>(`document.querySelector('.section-link[aria-current="page"]').dataset.section`), "settings");
  await cdp.eval(`document.querySelector('[data-skip-content]').click()`);
  assert.equal(await cdp.eval<string>(`document.activeElement.id`), "main-content");
  assert.equal(await cdp.eval<string>(`location.hash`), "#settings");
});

test("phone filters retain selections across collapse and resize and connection details stay available", { skip: !CHROME && "Chrome not found" }, async () => {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await cdp.eval(`location.hash = "#games"`);
  await cdp.until(`!document.getElementById('filters-toggle').hidden`);
  assert.ok(await cdp.eval<boolean>(`document.getElementById('filters-toggle').getBoundingClientRect().height >= 44`), "phone controls have a 44px touch target");
  assert.equal(await cdp.eval<boolean>(`document.getElementById('games-filters').hidden`), true);
  await cdp.eval(`document.getElementById('filters-toggle').click()`);
  await cdp.until(`!document.getElementById('games-filters').hidden`);
  await cdp.eval(`(() => { const art=document.getElementById('art'); art.value='without'; art.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  assert.match(await cdp.eval<string>(`document.getElementById('filters-toggle').textContent`), /Filters \(1\)/);
  await cdp.eval(`document.getElementById('filters-toggle').click()`);
  assert.equal(await cdp.eval<boolean>(`document.getElementById('games-filters').hidden`), true);
  assert.equal(await cdp.eval<string>(`getComputedStyle(document.getElementById('side-device')).display`), "none");
  await cdp.eval(`document.querySelector('[data-conn-panel]').click()`);
  await cdp.until(`!document.getElementById('sb-conn-panel').hidden`);
  assert.equal(await cdp.eval<number>(`document.querySelectorAll('#sb-conn-panel .mode-pick [data-mode]').length`), 3);
  await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await cdp.until(`document.getElementById('filters-toggle').hidden && !document.getElementById('games-filters').hidden`);
  assert.equal(await cdp.eval<string>(`document.getElementById('art').value`), "without");
  await cdp.eval(`document.querySelector('[data-clear-filters]').click()`);
  assert.equal(await cdp.eval<string>(`document.getElementById('filters-toggle').textContent.trim()`), "Filters");
  const measured = await cdp.eval<number[]>(`[parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sb')),document.querySelector('.statusbar').getBoundingClientRect().height]`);
  assert.ok(Math.abs(measured[0] - measured[1]) <= 1);
  assert.deepEqual(errors(), []);
});

test("Files preserves edits made during a save and previews workspace folders", { skip: !CHROME && "Chrome not found" }, async () => {
  fs.writeFileSync(path.join(srv.root, "readme.txt"), "hello from the workspace\n");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.eval(`location.hash = "#files"`);
  await cdp.until(`!!document.querySelector('.fx-row[data-name="readme.txt"]')`);
  await cdp.eval(`document.querySelector('.fx-row[data-name="readme.txt"] [data-fx="open"]').click()`);
  await cdp.until(`document.getElementById("fileview").open && document.getElementById("fv-text")?.value.includes("hello")`);
  assert.equal(await cdp.eval<boolean>(`document.getElementById("fv-save").hidden`), false);
  await cdp.eval(`(() => {
    window.__fileFetch = window.fetch;
    window.fetch = (url, init) => String(url) === "/api/files/write"
      ? new Promise((resolve, reject) => { window.__releaseWrite = () => window.__fileFetch(url, init).then(resolve, reject); })
      : window.__fileFetch(url, init);
    const input = document.getElementById("fv-text");
    input.value = "first edit";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("fv-save").click();
    input.value = "newer edit";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await cdp.until(`typeof window.__releaseWrite === "function"`);
  await cdp.eval(`window.__releaseWrite()`);
  await cdp.until(`!document.getElementById("fv-save").disabled && document.getElementById("fv-note").textContent === "Not saved"`);
  assert.equal(fs.readFileSync(path.join(srv.root, "readme.txt"), "utf8"), "first edit");
  await cdp.eval(`document.getElementById("fv-done").click()`);
  await cdp.until(`document.getElementById("confirm").open`);
  await cdp.eval(`document.getElementById("c-cancel").click(); window.fetch = window.__fileFetch; document.getElementById("fv-save").click()`);
  await cdp.until(`document.getElementById("fv-note").textContent.startsWith("Saved")`);
  assert.equal(fs.readFileSync(path.join(srv.root, "readme.txt"), "utf8"), "newer edit");
  await cdp.eval(`document.getElementById("fv-done").click()`);
  await cdp.until(`!document.getElementById("fileview").open`);
  await cdp.eval(`document.querySelector('.fx-row[data-name="Roms"] [data-fx="open"]').click()`);
  await cdp.until(`!!document.querySelector('.fx-row[data-name="GB"]')`);
  assert.match(await cdp.eval<string>(`document.querySelector('.fx-pane[data-side="local"] .fx-crumbs').innerText`), /Workspace\s*\/\s*Roms/);
  assert.match(await cdp.eval<string>(`document.querySelector('.fx-pane[data-side="device"]').innerText`), /Handheld/i);
  assert.deepEqual(errors(), []);
});

test("Designer keeps failed edits until Retry succeeds and blocks switching and export", { skip: !CHROME && "Chrome not found" }, async () => {
  for (const name of ["Autosave A", "Autosave B"]) {
    const made = await srv.api("designer/create", { name, from: "blank", res: ["640x480"] });
    assert.equal(made.status, 200, JSON.stringify(made.json));
  }
  await cdp.eval(`location.hash = "#themes"`);
  await cdp.until(`!!document.querySelector('[data-th-tab="designer"]')`);
  await cdp.eval(`document.querySelector('[data-th-tab="designer"]').click()`);
  await cdp.until(`!!document.querySelector('#dz input[type="color"][data-q]')`);
  await cdp.eval(`(() => {
    window.__designerFetch = window.fetch;
    window.__failScheme = true;
    window.__packageRequests = 0;
    window.fetch = (url, init) => {
      if (String(url).startsWith("/api/designer/package")) window.__packageRequests++;
      if (String(url) === "/api/designer/scheme" && window.__failScheme)
        return Promise.resolve(new Response(JSON.stringify({ error: "Simulated write failure" }), { status: 507, headers: { "Content-Type": "application/json" } }));
      return window.__designerFetch(url, init);
    };
    const input = document.querySelector('#dz input[type="color"][data-q]');
    input.value = "#123456";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await cdp.until(`!!document.querySelector('[data-dz="retry"]')`);
  await cdp.eval(`(() => { const pick = document.querySelector('[data-dz-theme]'); pick.value = "Autosave B"; pick.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await cdp.until(`document.querySelector('[data-dz-theme]').value === "Autosave A" && !!document.querySelector('[data-dz="retry"]')`);
  await cdp.eval(`document.querySelector('[data-dz="export"]').click()`);
  await cdp.until(`document.getElementById("toast").textContent.includes("not saved")`);
  assert.equal(await cdp.eval<number>(`window.__packageRequests`), 0);
  const file = path.join(srv.root, "themes", "Autosave A", "scheme", "global.ini");
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /123456/);
  await cdp.eval(`window.__failScheme = false; document.querySelector('[data-dz="retry"]').click()`);
  await cdp.until(`document.getElementById("dz-status").textContent.includes("Saved in")`);
  assert.match(fs.readFileSync(file, "utf8"), /123456/);
  await cdp.eval(`window.fetch = window.__designerFetch; (() => { const pick = document.querySelector('[data-dz-theme]'); pick.value = "Autosave B"; pick.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await cdp.until(`document.querySelector('[data-dz-theme]').value === "Autosave B" && document.getElementById("dz-status").textContent.includes("Saved in")`);
  assert.deepEqual(errors(), []);
});

test("wiki search narrows the pages and the table of contents", { skip: !CHROME && "Chrome not found" }, async () => {
  await cdp.eval(`location.hash = "#wiki"`);
  await cdp.until(`document.querySelectorAll(".wiki-article").length > 10`);
  await cdp.eval(`(() => { const q = document.getElementById("wiki-q"); q.value = "bios"; q.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const ids = await cdp.eval<string[]>(`[...document.querySelectorAll(".wiki-article")].map((a) => a.id)`);
  assert.ok(ids.includes("wiki-emulation") && !ids.includes("wiki-artwork"), ids.join());
  assert.equal(await cdp.eval<number>(`document.querySelectorAll(".wiki-toc a").length`), ids.length);
  assert.equal(await cdp.eval<string>(`document.activeElement.id`), "wiki-q");
  assert.deepEqual(errors(), []);
});

test("help button opens the current section's wiki article in a dialog", { skip: !CHROME && "Chrome not found" }, async () => {
  await cdp.eval(`location.hash = "#emulation"`);
  await cdp.until(`!document.getElementById("view-emulation").hidden && !!document.querySelector("[data-help]")`);
  await cdp.eval(`document.querySelector("[data-help]").click()`);
  await cdp.until(`document.getElementById("help").open`);
  const shown = () => cdp.eval<string[]>(`[...document.querySelectorAll("#help-wiki .wiki-article")].map((a) => a.id)`);
  assert.deepEqual(await shown(), ["help-emulation"]);
  assert.equal(await cdp.eval<string>(`document.querySelector("#help-wiki .wiki-toc a.on").dataset.wiki`), "emulation");
  assert.equal(await cdp.eval<number>(`document.querySelectorAll("#help-emulation h2 .btn").length`), 0, "no Open button for the page you are on");
  await cdp.eval(`document.querySelector('#help-wiki [data-wiki="games"]').click()`);
  assert.deepEqual(await shown(), ["help-games"]);
  await cdp.eval(`document.querySelector("#help-games h2 .btn").click()`);
  await cdp.until(`!document.getElementById("help").open && location.hash === "#games"`);
  await cdp.eval(`document.activeElement?.blur(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }))`);
  await cdp.until(`document.getElementById("help").open`);
  assert.deepEqual(await shown(), ["help-games"]);
  await cdp.eval(`document.getElementById("help-close").click()`);
  await cdp.until(`!document.getElementById("help").open && location.hash === "#games"`);
  assert.deepEqual(errors(), []);
});

test("major tabbed screens and Help fit a touch phone, with reduced motion respected", { skip: !CHROME && "Chrome not found" }, async () => {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const overflows: string[] = [];
  for (const [section, id] of [["settings", "settings-tabs"], ["handheld", "hh-tabs"], ["themes", "th-tabs"], ["play", "play-tabs"], ["artwork", "art-tabs"]]) {
    await cdp.eval(`location.hash = "#${section}"`);
    await cdp.until(`!!document.querySelector('#${id} [role="tab"]')`);
    const count = await cdp.eval<number>(`document.querySelectorAll('#${id} [role="tab"]').length`);
    for (let i = 0; i < count; i++) {
      await cdp.eval(`document.querySelectorAll('#${id} [role="tab"]')[${i}].click()`);
      await cdp.until(`document.querySelectorAll('#${id} [role="tab"]')[${i}].getAttribute('aria-selected') === 'true'`);
      await new Promise((r) => setTimeout(r, 250));
      const width = await cdp.eval<number>(`document.documentElement.scrollWidth`);
      if (width > 391) overflows.push(`${section} tab ${i}: ${width}px`);
    }
  }
  assert.deepEqual(overflows, []);
  await cdp.eval(`document.querySelector('[data-help]').click()`);
  await cdp.until(`document.getElementById('help').open`);
  assert.ok(await cdp.eval<boolean>(`(() => { const r=document.getElementById('help').getBoundingClientRect(); return r.left>=0 && r.right<=390 && r.height<=844; })()`));
  await cdp.eval(`document.getElementById('help-close').click(); location.hash='#games'`);
  await cdp.until(`!document.getElementById('view-games').hidden && !!document.querySelector('.game')`);
  assert.ok(await cdp.eval<boolean>(`parseFloat(getComputedStyle(document.querySelector('.game')).transitionDuration) < 0.001`));
  await cdp.send("Emulation.setEmulatedMedia", { features: [] });
  assert.deepEqual(errors(), []);
});
