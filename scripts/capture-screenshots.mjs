#!/usr/bin/env node
// Capture README screenshots (1440×900 JPEG) from a running manager via Chrome CDP.
// Usage: node scripts/capture-screenshots.mjs [baseUrlWithToken]
// Default: reads .cache/instance-*.json for port/token.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs/screenshots");
const W = 1440, H = 900, QUALITY = 82;

const CHROME = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find((p) => p && fs.existsSync(p));
if (!CHROME) throw new Error("Chrome not found; set CHROME_PATH");

function instanceUrl() {
  if (process.argv[2]) return process.argv[2];
  const cache = path.join(ROOT, ".cache");
  const file = fs.readdirSync(cache).find((n) => /^instance-.*\.json$/.test(n));
  if (!file) throw new Error("No running manager instance in .cache/");
  const { port, token } = JSON.parse(fs.readFileSync(path.join(cache, file), "utf8"));
  return `http://127.0.0.1:${port}/?token=${token}`;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.session = "";
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data));
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      }
    });
  }
  send(method, params = {}, sessionId = this.session) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  attach(sessionId) { this.session = sessionId; }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async until(expression, ms = 30_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await this.eval(expression).catch(() => false)) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Timed out: ${expression}`);
  }
}

async function shot(cdp, name) {
  await new Promise((r) => setTimeout(r, 450));
  const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: QUALITY, fromSurface: true });
  const dest = path.join(OUT, `${name}.jpg`);
  fs.writeFileSync(dest, Buffer.from(data, "base64"));
  const kb = Math.round(fs.statSync(dest).size / 1024);
  console.log(`  ${name}.jpg  ${kb}K`);
}

async function go(cdp, hash) {
  await cdp.eval(`location.hash = ${JSON.stringify(hash)}`);
  const section = hash.replace(/^#/, "").split("/")[0];
  await cdp.until(`(() => { const v = document.getElementById("view-${section}"); return v && !v.hidden; })()`);
}

async function main() {
  const base = instanceUrl();
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "manager-shots-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars",
    `--window-size=${W},${H}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  const wsUrl = await new Promise((resolve, reject) => {
    let err = "";
    const timer = setTimeout(() => reject(new Error(`Chrome failed:\n${err}`)), 25_000);
    chrome.stderr.on("data", (c) => {
      err += c.toString();
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const cdp = new Cdp(ws);
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  cdp.attach(sessionId);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  // Skip Soft; keep classic mustard. Dismiss what's-new / wizard if they appear after load.
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem("manager.mode", JSON.stringify("card"));
localStorage.setItem("manager.soft", JSON.stringify(false));
localStorage.setItem("manager.theme", JSON.stringify("dark"));
localStorage.setItem("manager.scheme", JSON.stringify("mustard"));
localStorage.setItem("manager.zoom", JSON.stringify(100));
localStorage.setItem("manager.seenVersion", JSON.stringify("99.0.0"));
localStorage.setItem("manager.tipsOnStartup", JSON.stringify(false));`,
  });
  await cdp.send("Page.navigate", { url: `${base}#overview` });
  await cdp.until(`document.readyState === "complete" && !!document.querySelector('a[href="#games"]')`, 60_000);
  // Close first-run wizard / what's new if they opened.
  await cdp.eval(`(() => {
    for (const id of ["wizard", "whatsnew", "confirm"]) {
      const d = document.getElementById(id);
      if (d?.open) d.close();
    }
  })()`);

  console.log("Capturing into", OUT);

  // Overview
  await go(cdp, "#overview");
  await cdp.until(`!!document.querySelector('#overview .panel')`, 60_000);
  await shot(cdp, "overview");

  // Games library (hero) — expand systems so box art fills the frame
  await go(cdp, "#games");
  await cdp.until(`document.querySelectorAll('#games-list .system').length > 0`, 180_000);
  await cdp.eval(`document.getElementById("collapse-all")?.click()`);
  await cdp.until(`document.querySelectorAll('#games-list .game').length > 12`, 60_000);
  await cdp.eval(`window.scrollTo(0, 0); document.querySelector('#games-list')?.scrollTo?.(0, 0)`);
  // Wait for a handful of box-art images to decode
  await cdp.until(`[...document.querySelectorAll('#games-list .game img')].filter((i) => i.complete && i.naturalWidth > 0).length >= 8`, 60_000).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  await shot(cdp, "games");

  // Game details — prefer a card that already has art
  const opened = await cdp.eval(`(() => {
    const g = document.querySelector('#games-list .game[data-v] img')?.closest(".game[data-v]")
      || document.querySelector('#games-list .game[data-v]');
    if (!g) return false;
    g.click();
    return true;
  })()`);
  if (opened) {
    await cdp.until(`document.getElementById("viewer")?.open === true`, 15_000);
    await new Promise((r) => setTimeout(r, 600));
    await shot(cdp, "game");
    await cdp.eval(`document.getElementById("viewer")?.close()`);
  } else {
    console.warn("  skip game.jpg (no game card)");
  }

  // Artwork
  await go(cdp, "#artwork");
  await cdp.until(`document.getElementById("view-artwork") && !document.getElementById("view-artwork").hidden && (document.getElementById("artwork")?.innerText.trim().length > 20 || document.querySelector("#view-artwork .panel"))`, 60_000);
  await shot(cdp, "artwork");

  // OS library
  await go(cdp, "#os");
  await cdp.until(`document.getElementById("view-os") && !document.getElementById("view-os").hidden`, 30_000);
  await new Promise((r) => setTimeout(r, 800));
  await shot(cdp, "os");

  // Play activity
  await go(cdp, "#play");
  await cdp.until(`document.getElementById("view-play") && !document.getElementById("view-play").hidden`, 30_000);
  await shot(cdp, "play");

  // Apps + market (wait until GitHub list paints)
  await go(cdp, "#apps");
  await cdp.until(`!!document.querySelector('#view-apps [data-ap="market"]')`, 30_000);
  await cdp.eval(`document.querySelector('#view-apps [data-ap="market"]')?.click()`);
  await cdp.until(`document.getElementById("appmarket")?.open === true`, 20_000);
  await cdp.until(`!!document.querySelector('#appmarket .am-card, #appmarket .app-card, #appmarket article, #appmarket [data-am], #appmarket .market-app') || (document.getElementById("appmarket")?.innerText || "").length > 400`, 90_000);
  await new Promise((r) => setTimeout(r, 800));
  await shot(cdp, "apps");
  await cdp.eval(`document.getElementById("appmarket")?.close(); document.getElementById("appview")?.close()`);

  // Device
  await go(cdp, "#handheld");
  await cdp.until(`document.getElementById("handheld")?.innerText.trim().length > 10`, 30_000);
  await shot(cdp, "handheld");

  // Themes catalogue
  await go(cdp, "#themes");
  await cdp.until(`document.querySelectorAll('#themes .th-card').length > 4`, 120_000);
  await cdp.until(`[...document.querySelectorAll('#themes .th-img')].filter((i) => i.complete && i.naturalWidth > 0).length >= 4`, 60_000).catch(() => {});
  await shot(cdp, "themes");

  // Theme Designer — create a throwaway theme so the live preview is in frame
  await go(cdp, "#themes/designer");
  await cdp.until(`!!document.querySelector('[data-dz="create"], [data-dz="new"], [data-dz-panel]')`, 30_000);
  const hasEditor = await cdp.eval(`document.querySelectorAll('[data-dz-panel]').length > 3`);
  if (!hasEditor) {
    await cdp.eval(`document.querySelector('[data-dz="new"]')?.click()`);
    await new Promise((r) => setTimeout(r, 300));
    await cdp.eval(`(() => {
      document.querySelector('[data-form-from="blank"]')?.click();
      const name = document.querySelector('[data-form="name"]');
      if (name) { name.value = "Screenshot Theme"; name.dispatchEvent(new Event("input", { bubbles: true })); }
      document.querySelector('[data-dz="create"]')?.click();
    })()`);
    await cdp.until(`document.querySelectorAll('[data-dz-panel]').length > 3`, 60_000);
    await new Promise((r) => setTimeout(r, 1000));
  }
  await cdp.eval(`document.querySelector('[data-dz-panel="quick"]')?.click()`);
  await shot(cdp, "designer");
  await cdp.eval(`document.querySelector('[data-dz-panel="scheme"]')?.click()
    || [...document.querySelectorAll('[data-dz-panel]')].find((b) => /scheme|colour|header|list/i.test(b.textContent || ""))?.click()`);
  await new Promise((r) => setTimeout(r, 600));
  await shot(cdp, "designer-edit");

  // Emulation systems
  await go(cdp, "#emulation");
  await cdp.until(`document.getElementById("emu-body")?.innerText.trim().length > 20`, 30_000);
  await shot(cdp, "emulation");

  // Files
  await go(cdp, "#files");
  await cdp.until(`document.getElementById("files")?.innerText.trim().length > 10`, 30_000);
  await shot(cdp, "files");

  // Game Tuning
  await go(cdp, "#tuning");
  await cdp.until(`document.getElementById("view-tuning") && !document.getElementById("view-tuning").hidden`, 30_000);
  await cdp.until(`(document.getElementById("tune-body")?.innerText.trim().length || 0) > 10`, 30_000);
  await shot(cdp, "tuning");

  // System Tools
  await go(cdp, "#system");
  await cdp.until(`document.getElementById("view-system") && !document.getElementById("view-system").hidden`, 30_000);
  await new Promise((r) => setTimeout(r, 600));
  await shot(cdp, "system");

  // Terminal
  await go(cdp, "#ssh");
  await cdp.until(`document.getElementById("view-ssh") && !document.getElementById("view-ssh").hidden`, 15_000);
  await shot(cdp, "terminal");

  // Settings → Appearance
  await go(cdp, "#settings/appearance");
  await cdp.until(`!!document.querySelector('[data-set-scheme], .set-schemes')`, 20_000);
  await shot(cdp, "appearance");

  // Settings → Assistant (kept as settings.jpg for continuity)
  await go(cdp, "#settings/assistant");
  await cdp.until(`document.getElementById("settings")?.innerText.trim().length > 20`, 15_000);
  await shot(cdp, "settings");

  // Logs
  await go(cdp, "#logs");
  await cdp.until(`document.getElementById("view-logs") && !document.getElementById("view-logs").hidden`, 20_000);
  await new Promise((r) => setTimeout(r, 600));
  await shot(cdp, "logs");

  // Wiki
  await go(cdp, "#wiki");
  await cdp.until(`document.getElementById("wiki")?.innerText.trim().length > 40`, 20_000);
  await shot(cdp, "wiki");

  // Setup wizard
  await go(cdp, "#settings/data");
  await cdp.until(`!!document.querySelector('[data-set="wizard"]')`, 15_000);
  await cdp.eval(`document.querySelector('[data-set="wizard"]')?.click()`);
  await cdp.until(`document.getElementById("wizard")?.open === true`, 10_000);
  await new Promise((r) => setTimeout(r, 400));
  await shot(cdp, "wizard");
  await cdp.eval(`document.getElementById("wizard")?.close()`);

  chrome.kill();
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
