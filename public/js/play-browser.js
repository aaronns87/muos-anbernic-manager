// In-browser play via EmulatorJS (CDN cores + local ROM/BIOS stream).

import { confirmBox } from "./art-images.js";
import { $, api, esc, TOKEN, toast } from "./core.js";

/** Manager system folder → EmulatorJS core. Keep in sync with src/games/play-rom.ts. */
export const PLAY_CORES = {
  // Nintendo
  GB: "gb", GBC: "gb", GBA: "gba", FC: "nes", FDS: "nes", SFC: "snes", VB: "vb",
  N64: "n64", NDS: "nds",
  // Sega
  SMS: "segaMS", GG: "segaGG", MD: "segaMD", SEGA32X: "sega32x",
  MDCD: "segaCD", SATURN: "segaSaturn",
  // NEC / Bandai / SNK
  PCE: "pce", PCECD: "pce", WS: "ws", NGP: "ngp",
  // Atari
  A2600: "atari2600", A5200: "a5200", A7800: "atari7800", LYNX: "lynx",
  // Commodore
  C64: "c64", VIC20: "vic20",
  // Sony
  PS: "psx", PSP: "psp",
  // Arcade: FinalBurn Neo sets only (MAME-only and hacked sets will not start).
  MAME: "fbneo", FBNEO: "fbneo", CPS1: "fbneo", CPS2: "fbneo", CPS3: "fbneo", NEOGEO: "fbneo",
  // Dreamcast — Flycast via manager-cached core (see /api/games/ejs-data/)
  DREAMCAST: "flycast",
};

/** Preferred BIOS basenames under workspace bios/ (first hit wins). Keep in sync with play-rom.ts. */
const PLAY_BIOS = {
  PS: ["scph5501.bin", "scph5502.bin", "scph5500.bin", "scph1001.bin", "scph7001.bin", "scph101.bin", "PSXONPSP660.bin"],
  SATURN: ["saturn_bios.bin", "sega_101.bin", "mpr-17933.bin", "mpr-17933c.bin"],
  MDCD: ["bios_CD_U.bin", "bios_CD_E.bin", "bios_CD_J.bin"],
  PCECD: ["syscard3.pce", "syscard2.pce", "syscard1.pce", "syscard3u.pce", "syscard2u.pce"],
  DREAMCAST: ["dc_boot.bin", "dc_flash.bin"],
};

const DISC_EXT = new Set(["chd", "iso", "cso", "pbp", "cue", "m3u"]);
const DISC_SYSTEMS = new Set(["PS", "SATURN", "MDCD", "PCECD", "PSP", "DREAMCAST"]);
const ARCADE_SYSTEMS = new Set(["MAME", "FBNEO", "CPS1", "CPS2", "CPS3", "NEOGEO"]);
const DREAMCAST_EXT = new Set(["chd", "cdi", "gdi"]);

const BLOCKED = new Set(["ccd", "toc", "gdi", "img", "wav", "ogg", "mp3"]);
const OK = new Set([
  "gb", "gbc", "gba", "nes", "unf", "unif", "fds", "smc", "sfc", "fig", "swc", "vb", "vboy",
  "z64", "n64", "v64", "nds",
  "sms", "gg", "md", "gen", "smd", "32x",
  "ngp", "ngc", "npc", "ws", "wsc", "pce",
  "a26", "a52", "a78", "lnx", "lyx",
  "d64", "t64", "crt", "prg", "tap",
  "chd", "iso", "cso", "pbp", "cue", "m3u",
  "bin", "rom", "zip", "7z",
]);

const EJS_DATA = "https://cdn.emulatorjs.org/stable/data/";
/** EmulatorJS data root that proxies the CDN and injects the cached Flycast core. */
function ejsDataRoot() {
  // EmulatorJS concatenates filenames onto this base (loader.js, cores/…); token lives in the path.
  return `${location.origin}/api/games/ejs-data/${encodeURIComponent(TOKEN)}/`;
}

const DEFAULT_KEYS = {
  0: "x", 1: "s", 2: "shift", 3: "enter",
  4: "up arrow", 5: "down arrow", 6: "left arrow", 7: "right arrow",
  8: "z", 9: "a", 10: "q", 11: "e",
};

const KEY_PRETTY = {
  "up arrow": "↑", "down arrow": "↓", "left arrow": "←", "right arrow": "→",
  enter: "Enter", shift: "Shift", space: "Space", escape: "Esc", tab: "Tab",
  backspace: "⌫", ctrl: "Ctrl", alt: "Alt", meta: "Meta",
};

let sessionKeys = { ...DEFAULT_KEYS };
let bound = false;
let loaderEl = null;
let listeningBtn = null;
let startGen = 0;
let saveStatus = { label: "No save yet", reachable: false, dirty: false, syncing: false };
let pendingSaveBytes = null;
let autosaveTimer = 0;

function extOf(file) {
  const i = file.lastIndexOf(".");
  return i >= 0 ? file.slice(i + 1).toLowerCase() : "";
}

export function canPlayInBrowser(sys, g) {
  if (!sys?.code || !g?.f) return false;
  if (!PLAY_CORES[sys.code]) return false;
  const x = (g.x || extOf(g.f)).toLowerCase();
  if (ARCADE_SYSTEMS.has(sys.code)) return x === "zip";
  if (sys.code === "DREAMCAST") return DREAMCAST_EXT.has(x);
  if (BLOCKED.has(x)) return false;
  if (DISC_EXT.has(x) && !DISC_SYSTEMS.has(sys.code)) return false;
  return OK.has(x);
}

/**
 * EmulatorJS derives the VFS filename from the last URL path segment (before ?).
 * Query-only URLs became literally "rom" / "bios" with no extension → PS core opened the RetroArch menu.
 */
function romUrl(code, file) {
  const q = new URLSearchParams({ token: TOKEN });
  return new URL(`/api/games/rom/${encodeURIComponent(code)}/${encodeURIComponent(file)}?${q}`, location.origin).href;
}

function biosUrl(file) {
  const q = new URLSearchParams({ token: TOKEN });
  return new URL(`/api/games/bios/${encodeURIComponent(file)}?${q}`, location.origin).href;
}

/** First preferred BIOS present in workspace bios/, or "". Dreamcast needs both files as a zip. */
async function resolveBiosUrl(code) {
  const preferred = PLAY_BIOS[code];
  if (!preferred?.length) return "";
  try {
    const q = new URLSearchParams({ list: "1", code, token: TOKEN });
    const res = await fetch(new URL(`/api/games/bios?${q}`, location.origin));
    if (!res.ok) return "";
    const data = await res.json();
    const have = Array.isArray(data.bios) ? data.bios : [];
    if (code === "DREAMCAST") {
      if (!preferred.every((n) => have.includes(n))) return "";
      const bq = new URLSearchParams({ token: TOKEN });
      return new URL(`/api/games/bios/dreamcast-bundle?${bq}`, location.origin).href;
    }
    const pick = preferred.find((n) => have.includes(n)) || have[0];
    return pick ? biosUrl(pick) : "";
  } catch {
    return "";
  }
}

/** Parse .cue / .m3u for sibling filenames and map them to ROM API URLs. */
async function resolveExternalFiles(code, file) {
  const x = extOf(file);
  if (x !== "cue" && x !== "m3u") return null;
  let text = "";
  try {
    const res = await fetch(romUrl(code, file));
    if (!res.ok) return null;
    text = await res.text();
  } catch {
    return null;
  }
  const names = new Set();
  if (x === "cue") {
    for (const m of text.matchAll(/FILE\s+"([^"]+)"/gi)) names.add(m[1].trim());
    for (const m of text.matchAll(/FILE\s+([^\s"]+)\s+/gi)) {
      const n = m[1].trim();
      if (n && !n.includes('"')) names.add(n);
    }
  } else {
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const base = t.replace(/^.*[/\\]/, "");
      if (base) names.add(base);
    }
  }
  const map = {};
  for (const n of names) {
    if (!n || n.includes("..") || n.includes("/") || n.includes("\\")) continue;
    if (n.toLowerCase() === file.toLowerCase()) continue;
    map[n] = romUrl(code, n);
  }
  return Object.keys(map).length ? map : null;
}

/**
 * EmulatorJS shape is { playerIndex: { buttonIndex: { value, value2 } } }.
 * Do not nest a keyboard/gamepad layer under the player — that blanks the settings UI
 * and leaves simulateInput with no keyCodes.
 */
function buildDefaultControls(keys) {
  const player0 = {
    0: { value: keys[0] ?? "x", value2: "BUTTON_2" },
    1: { value: keys[1] ?? "s", value2: "BUTTON_4" },
    2: { value: keys[2] ?? "shift", value2: "SELECT" },
    3: { value: keys[3] ?? "enter", value2: "START" },
    4: { value: keys[4] ?? "up arrow", value2: "DPAD_UP" },
    5: { value: keys[5] ?? "down arrow", value2: "DPAD_DOWN" },
    6: { value: keys[6] ?? "left arrow", value2: "DPAD_LEFT" },
    7: { value: keys[7] ?? "right arrow", value2: "DPAD_RIGHT" },
    8: { value: keys[8] ?? "z", value2: "BUTTON_1" },
    9: { value: keys[9] ?? "a", value2: "BUTTON_3" },
    10: { value: keys[10] ?? "q", value2: "LEFT_TOP_SHOULDER" },
    11: { value: keys[11] ?? "e", value2: "RIGHT_TOP_SHOULDER" },
    12: { value: "tab", value2: "LEFT_BOTTOM_SHOULDER" },
    13: { value: "r", value2: "RIGHT_BOTTOM_SHOULDER" },
    14: { value: "", value2: "LEFT_STICK" },
    15: { value: "", value2: "RIGHT_STICK" },
    16: { value: "h", value2: "LEFT_STICK_X:+1" },
    17: { value: "f", value2: "LEFT_STICK_X:-1" },
    18: { value: "g", value2: "LEFT_STICK_Y:+1" },
    19: { value: "t", value2: "LEFT_STICK_Y:-1" },
    20: { value: "l", value2: "RIGHT_STICK_X:+1" },
    21: { value: "j", value2: "RIGHT_STICK_X:-1" },
    22: { value: "k", value2: "RIGHT_STICK_Y:+1" },
    23: { value: "i", value2: "RIGHT_STICK_Y:-1" },
    24: { value: "1" },
    25: { value: "2" },
    26: { value: "3" },
    27: {},
    28: {},
    29: {},
  };
  return { 0: player0, 1: {}, 2: {}, 3: {} };
}

function focusPlayPlayer() {
  const host = $("play-ejs");
  if (!host) return;
  host.setAttribute("tabindex", "-1");
  try { host.focus({ preventScroll: true }); } catch { host.focus(); }
}

/** Push session keys into the live EmulatorJS instance (after its loadSettings can overwrite). */
function applySessionControls() {
  const emu = window.EJS_emulator;
  if (!emu || typeof emu.setupKeys !== "function") return;
  const built = buildDefaultControls(sessionKeys);
  emu.defaultControllers = built;
  emu.controls = JSON.parse(JSON.stringify(built));
  try { emu.setupKeys(); } catch { /* ignore */ }
  try { emu.checkGamepadInputs?.(); } catch { /* ignore */ }
}

function prettyKey(name) {
  const n = String(name || "").toLowerCase();
  if (!n) return "—";
  if (KEY_PRETTY[n]) return KEY_PRETTY[n];
  return n.length === 1 ? n.toUpperCase() : n;
}

function bindBtn(index, role, face = "") {
  const key = sessionKeys[index] ?? "";
  const faceHtml = face ? `<span class="play-bind-label">${esc(face)}</span>` : "";
  return `<button type="button" class="play-bind play-bind-${esc(role)}" data-play-key="${index}" data-face="${esc(face)}"
    title="Click, then press a key" aria-label="${esc(face || role)}: ${esc(prettyKey(key))}">
    ${faceHtml}<span class="play-bind-key">${esc(prettyKey(key))}</span>
  </button>`;
}

function saveBarHtml() {
  const syncCls = saveStatus.dirty ? "play-save-dirty" : "";
  return `<div class="toolbar-strip play-save-bar ${syncCls}" id="play-save-bar">
    <span class="play-save-label" id="play-save-label">${esc(saveStatus.label)}</span>
    <div class="play-controls-actions">
      <button type="button" class="btn small" data-play="save-pull" ${saveStatus.reachable ? "" : "disabled"} title="Copy SRAM from the handheld into this session">Load from device</button>
      <button type="button" class="btn small" data-play="save-store" title="Keep SRAM in the manager workspace">Save locally</button>
      <button type="button" class="btn small primary" data-play="save-push" ${saveStatus.reachable ? "" : "disabled"} title="Write SRAM to the handheld over SSH">Save to device</button>
    </div>
  </div>`;
}

function controlsFormHtml() {
  return `${saveBarHtml()}
  <details class="play-controls">
    <summary><span class="play-controls-title">Keyboard controls</span><span class="play-controls-badge">This session</span></summary>
    <div class="play-pad">
      <p class="play-pad-hint">Click a button, then press a key. Apply with <b>Restart with these keys</b>. Click the game screen afterwards so keys reach the emulator. SRAM syncs to <code>backups/saves-browser/</code>; Save to device needs Wi‑Fi + SSH.</p>
      <div class="play-pad-shell" aria-label="Controller key map">
        <div class="play-pad-shoulders">
          ${bindBtn(10, "shoulder", "L")}
          ${bindBtn(11, "shoulder", "R")}
        </div>
        <div class="play-pad-main">
          <div class="play-pad-dpad" aria-label="D-pad">
            <span class="play-pad-cluster-label">D-pad</span>
            <div class="play-dpad">
              <span class="play-dpad-gap"></span>${bindBtn(4, "dir", "Up")}
              <span class="play-dpad-gap"></span>
              ${bindBtn(6, "dir", "Left")}<span class="play-dpad-hub" aria-hidden="true"></span>${bindBtn(7, "dir", "Right")}
              <span class="play-dpad-gap"></span>${bindBtn(5, "dir", "Down")}
              <span class="play-dpad-gap"></span>
            </div>
          </div>
          <div class="play-pad-meta" aria-label="System">
            ${bindBtn(2, "meta", "Select")}
            ${bindBtn(3, "meta", "Start")}
          </div>
          <div class="play-pad-face" aria-label="Face buttons">
            <span class="play-pad-cluster-label">Face</span>
            <div class="play-face">
              <span class="play-face-gap"></span>${bindBtn(9, "face", "X")}
              <span class="play-face-gap"></span>
              ${bindBtn(1, "face", "Y")}<span class="play-face-hub" aria-hidden="true"></span>${bindBtn(8, "face", "A")}
              <span class="play-face-gap"></span>${bindBtn(0, "face", "B")}
              <span class="play-face-gap"></span>
            </div>
          </div>
        </div>
      </div>
      <div class="play-controls-actions">
        <button type="button" class="btn small" data-play="defaults">Reset defaults</button>
        <button type="button" class="btn small primary" data-play="restart">Restart with these keys</button>
      </div>
    </div>
  </details>`;
}

function playTarget() {
  const dlg = $("playbrowser");
  if (!dlg?.dataset?.code || !dlg?.dataset?.file) return null;
  return { code: dlg.dataset.code, file: dlg.dataset.file, name: dlg.dataset.name || dlg.dataset.code };
}

function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) bin += String.fromCharCode(...u8.subarray(i, i + chunk));
  return btoa(bin);
}

function updateSaveLabel() {
  const el = $("play-save-label");
  if (el) el.textContent = saveStatus.label;
  const bar = $("play-save-bar");
  if (bar) bar.classList.toggle("play-save-dirty", !!saveStatus.dirty);
  for (const sel of ["[data-play=\"save-pull\"]", "[data-play=\"save-push\"]"]) {
    document.querySelectorAll(sel).forEach((btn) => {
      btn.disabled = !saveStatus.reachable || saveStatus.syncing;
    });
  }
  document.querySelectorAll("[data-play=\"save-store\"]").forEach((btn) => {
    btn.disabled = saveStatus.syncing;
  });
}

async function refreshSaveStatus() {
  const t = playTarget();
  if (!t) return;
  try {
    const st = await api(`saves/browser?code=${encodeURIComponent(t.code)}&file=${encodeURIComponent(t.file)}`);
    saveStatus.reachable = !!st.reachable && !st.frontend;
    const bits = [];
    if (st.mirror?.exists) bits.push(`Local ${Math.round(st.mirror.size / 1024)} KB`);
    else bits.push("No local save");
    if (st.reachable) {
      if (st.frontend) bits.push("close the game on the handheld to sync");
      else if (st.devicePath) bits.push(`Device ${pathBasename(st.devicePath)}`);
      else bits.push("no device SRAM yet");
    } else bits.push("device offline");
    if (saveStatus.dirty) bits.push("unsaved changes");
    saveStatus.label = bits.join(" · ");
  } catch (err) {
    saveStatus.reachable = false;
    saveStatus.label = err.message || "Save status unavailable";
  }
  updateSaveLabel();
}

function pathBasename(p) {
  const i = String(p).lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

function readEmuSaveBytes() {
  try {
    const gm = window.EJS_emulator?.gameManager;
    if (!gm?.getSaveFile) return pendingSaveBytes;
    const data = gm.getSaveFile(true);
    if (data && data.length) {
      pendingSaveBytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      return pendingSaveBytes;
    }
  } catch { /* ignore */ }
  return pendingSaveBytes;
}

async function storeBrowserSave({ push = false } = {}) {
  const t = playTarget();
  if (!t) return;
  const bytes = readEmuSaveBytes();
  if (!bytes?.length) {
    toast("No SRAM from the emulator yet. Make in-game progress that writes a save first.", 4500);
    return;
  }
  saveStatus.syncing = true;
  updateSaveLabel();
  try {
    await api("saves/browser", { code: t.code, file: t.file, data: bytesToBase64(bytes), push });
    saveStatus.dirty = false;
    toast(push ? "Save written to the handheld" : "Save kept in the manager", 2500);
    await refreshSaveStatus();
  } catch (err) {
    toast(err.message || "Could not store save", 4500);
  } finally {
    saveStatus.syncing = false;
    updateSaveLabel();
  }
}

async function pullDeviceSaveIntoSession() {
  const t = playTarget();
  if (!t) return;
  saveStatus.syncing = true;
  updateSaveLabel();
  try {
    await api("saves/browser/pull", { code: t.code, file: t.file });
    const injected = await injectMirrorSave();
    toast(injected ? "Loaded SRAM from the handheld" : "Pulled save — restart the game to apply", 3500);
    await refreshSaveStatus();
  } catch (err) {
    toast(err.message || "Could not load from device", 4500);
  } finally {
    saveStatus.syncing = false;
    updateSaveLabel();
  }
}

async function fetchMirrorBytes() {
  const t = playTarget();
  if (!t) return null;
  try {
    const q = new URLSearchParams({ code: t.code, file: t.file, token: TOKEN });
    const res = await fetch(new URL(`/api/saves/browser/file?${q}`, location.origin), { cache: "no-store" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return buf.byteLength ? new Uint8Array(buf) : null;
  } catch {
    return null;
  }
}

async function injectMirrorSave() {
  const bytes = await fetchMirrorBytes();
  if (!bytes?.length) return false;
  pendingSaveBytes = bytes;
  try {
    const gm = window.EJS_emulator?.gameManager;
    if (!gm?.FS) return false;
    const path = typeof gm.getSaveFilePath === "function" ? gm.getSaveFilePath() : "";
    if (path) {
      try { gm.FS.mkdirTree(path.slice(0, path.lastIndexOf("/"))); } catch { /* exists */ }
      gm.FS.writeFile(path, bytes);
    } else {
      // Fallback: write under EmulatorJS saves mount using the ROM stem.
      const stem = (t => {
        const f = t?.file || "game";
        const i = f.lastIndexOf(".");
        return i >= 0 ? f.slice(0, i) : f;
      })(playTarget());
      const alt = `/data/saves/${stem}.srm`;
      try { gm.FS.mkdirTree("/data/saves"); } catch { /* exists */ }
      gm.FS.writeFile(alt, bytes);
    }
    if (typeof gm.loadSaveFiles === "function") gm.loadSaveFiles();
    return true;
  } catch {
    return false;
  }
}

function scheduleAutosave(bytes) {
  if (bytes?.length) {
    pendingSaveBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    saveStatus.dirty = true;
    updateSaveLabel();
  }
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    void storeBrowserSave({ push: false });
  }, 2500);
}

function clearListening() {
  if (listeningBtn) {
    listeningBtn.classList.remove("listening");
    listeningBtn.removeAttribute("aria-pressed");
    const idx = Number(listeningBtn.dataset.playKey);
    const keyEl = listeningBtn.querySelector(".play-bind-key");
    if (keyEl) keyEl.textContent = prettyKey(sessionKeys[idx] ?? "");
    listeningBtn = null;
  }
  const status = document.querySelector(".play-pad-status");
  if (status) status.hidden = true;
}

function setListening(btn) {
  clearListening();
  listeningBtn = btn;
  btn.classList.add("listening");
  btn.setAttribute("aria-pressed", "true");
  const keyEl = btn.querySelector(".play-bind-key");
  if (keyEl) keyEl.textContent = "…";
  let status = document.querySelector(".play-pad-status");
  if (!status) {
    status = document.createElement("p");
    status.className = "play-pad-status";
    document.querySelector(".play-pad")?.prepend(status);
  }
  const face = btn.dataset.face || "Button";
  status.hidden = false;
  status.innerHTML = `Listening for <b>${esc(face)}</b> — press a key (<kbd>Esc</kbd> cancels)`;
  btn.focus({ preventScroll: true });
}

function readKeysFromForm() {
  const next = { ...sessionKeys };
  for (const el of document.querySelectorAll("[data-play-key]")) {
    const idx = Number(el.dataset.playKey);
    if (Number.isFinite(idx) && sessionKeys[idx] !== undefined) next[idx] = sessionKeys[idx];
  }
  sessionKeys = next;
  return sessionKeys;
}

function setPlayFocus(on) {
  const dlg = $("playbrowser");
  if (!dlg) return;
  dlg.classList.toggle("play-focus", !!on);
  dlg.querySelectorAll('[data-play="focus"]').forEach((btn) => {
    const focused = !!on;
    btn.setAttribute("aria-pressed", focused ? "true" : "false");
    if (btn.closest(".play-head-actions")) {
      btn.title = focused ? "Show controls" : "Focus on game";
      btn.setAttribute("aria-label", focused ? "Show controls" : "Focus on game");
    }
  });
  if (on) requestAnimationFrame(() => focusPlayPlayer());
}

/** Lock page scroll while the play dialog is open (arrows/space otherwise scroll the library behind). */
function setPlayOpen(on) {
  document.documentElement.classList.toggle("play-open", !!on);
}

/** Keys that scroll the page or dialog; block their browser default while playing. */
const SCROLL_KEYS = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  " ", "Spacebar", "PageUp", "PageDown", "Home", "End",
]);

function playScrollKeyGuard(e) {
  const dlg = $("playbrowser");
  if (!dlg?.open || listeningBtn) return;
  const el = e.target;
  if (el?.closest?.("input, textarea, select, [contenteditable='true']") || el?.isContentEditable) return;
  if (!SCROLL_KEYS.has(e.key)) return;
  e.preventDefault();
  // Keep EmulatorJS focused unless the user is editing the on-screen key map.
  if (!el?.closest?.(".play-controls")) focusPlayPlayer();
}

function teardown() {
  clearListening();
  clearTimeout(autosaveTimer);
  // Flush SRAM to the workspace mirror before tearing down the core.
  try {
    const bytes = readEmuSaveBytes();
    const t = playTarget();
    if (bytes?.length && t) {
      void api("saves/browser", { code: t.code, file: t.file, data: bytesToBase64(bytes), push: false }).catch(() => {});
    }
  } catch { /* ignore */ }
  setPlayFocus(false);
  setPlayOpen(false);
  try { window.EJS_emulator?.pause?.(); } catch { /* ignore */ }
  try { window.EJS_emulator?.exit?.(); } catch { /* ignore */ }
  if (loaderEl) { loaderEl.remove(); loaderEl = null; }
  const host = $("play-ejs");
  if (host) host.innerHTML = "";
  pendingSaveBytes = null;
  delete window.EJS_player;
  delete window.EJS_gameUrl;
  delete window.EJS_core;
  delete window.EJS_pathtodata;
  delete window.EJS_gameName;
  delete window.EJS_gameID;
  delete window.EJS_startOnLoaded;
  delete window.EJS_defaultControls;
  delete window.EJS_Buttons;
  delete window.EJS_color;
  delete window.EJS_ready;
  delete window.EJS_onGameStart;
  delete window.EJS_onSaveUpdate;
  delete window.EJS_onSaveSave;
  delete window.EJS_disableLocalStorage;
  delete window.EJS_biosUrl;
  delete window.EJS_externalFiles;
  delete window.EJS_disableCue;
  delete window.EJS_threads;
}

async function startEmulator(sys, g) {
  const gen = ++startGen;
  teardown();
  const host = $("play-ejs");
  host.innerHTML = "";
  const core = PLAY_CORES[sys.code];
  readKeysFromForm();

  const needsBios = !!PLAY_BIOS[sys.code];
  const bios = needsBios ? await resolveBiosUrl(sys.code) : "";
  if (gen !== startGen) return;
  if (needsBios && !bios) {
    const hint = sys.code === "DREAMCAST"
      ? "dc_boot.bin and dc_flash.bin"
      : PLAY_BIOS[sys.code][0];
    toast(`Add a BIOS for ${sys.name || sys.code} to bios/ first (e.g. ${hint}), then try again.`, 6000);
    return;
  }

  // Dreamcast: ensure Flycast is cached (first run downloads ~10 MB from GitHub).
  if (sys.code === "DREAMCAST") {
    try {
      await api("games/flycast/ensure", {});
    } catch (err) {
      toast(err.message || "Could not prepare the Dreamcast core", 5000);
      return;
    }
    if (gen !== startGen) return;
  }

  const x = extOf(g.f);
  let external = null;
  if (x === "cue" || x === "m3u") {
    external = await resolveExternalFiles(sys.code, g.f);
    if (gen !== startGen) return;
  }

  window.EJS_player = "#play-ejs";
  window.EJS_core = core;
  window.EJS_gameUrl = romUrl(sys.code, g.f);
  // Stable id so EmulatorJS does not key settings off the tokenised ROM URL.
  window.EJS_gameID = `${sys.code}:${g.f}`;
  window.EJS_gameName = g.t || g.f;
  // Dreamcast uses a proxied data root so Flycast can be served from the manager cache.
  window.EJS_pathtodata = sys.code === "DREAMCAST" ? ejsDataRoot() : EJS_DATA;
  window.EJS_startOnLoaded = true;
  // Session remap is the source of truth; ignore prior EmulatorJS localStorage (can be
  // corrupted from older control shapes and shows as "undefined" in Control Settings).
  // SRAM is handled by our mirror APIs (EJS_onSaveUpdate), not EmulatorJS localStorage.
  window.EJS_disableLocalStorage = true;
  window.EJS_defaultControls = buildDefaultControls(sessionKeys);
  window.EJS_color = "#c4a35a";
  if (bios) window.EJS_biosUrl = bios;
  if (external) {
    window.EJS_externalFiles = external;
    // Real .cue sheets must not be replaced by EmulatorJS auto-cue.
    if (x === "cue") window.EJS_disableCue = true;
  }
  // PSP (and optional N64) benefit from threads when SharedArrayBuffer is available (COEP on HTML).
  if ((sys.code === "PSP" || sys.code === "N64") && typeof SharedArrayBuffer !== "undefined") {
    window.EJS_threads = true;
  }
  window.EJS_onSaveUpdate = (e) => {
    const save = e?.save;
    if (save) scheduleAutosave(save);
  };
  window.EJS_onSaveSave = (e) => {
    const save = e?.save;
    if (save) {
      pendingSaveBytes = save instanceof Uint8Array ? save : new Uint8Array(save);
      void storeBrowserSave({ push: false });
    }
  };
  // EmulatorJS listens for keys on #play-ejs; keep focus there so arrows/A/B reach the core.
  window.EJS_ready = () => {
    applySessionControls();
    focusPlayPlayer();
    try { window.EJS_emulator?.enableSaveUpdateEvent?.(); } catch { /* older CDN */ }
  };
  window.EJS_onGameStart = () => {
    applySessionControls();
    focusPlayPlayer();
    void injectMirrorSave().then((ok) => {
      if (ok) saveStatus.label = "SRAM loaded into session";
      updateSaveLabel();
    });
  };
  loaderEl = document.createElement("script");
  // Cache-bust so Restart re-runs loader.js after a previous session.
  const dataRoot = sys.code === "DREAMCAST" ? ejsDataRoot() : EJS_DATA;
  loaderEl.src = `${dataRoot}loader.js?v=${Date.now()}`;
  loaderEl.async = true;
  loaderEl.onerror = () => toast("Could not load the emulator. Check your network connection.", 5000);
  document.body.appendChild(loaderEl);
}

/** Open the play modal for a library game. */
export function openPlayBrowser(sys, g) {
  if (!canPlayInBrowser(sys, g)) {
    toast("This game cannot be played in the browser", 3000);
    return;
  }
  bindPlayBrowser();
  notePlayTarget(sys, g);
  $("play-title").textContent = g.t || g.f;
  const bits = [`${sys.name || sys.code}`, g.f];
  if (PLAY_BIOS[sys.code]) bits.push("needs BIOS in bios/");
  bits.push("needs a network connection the first time for emulator cores");
  $("play-sub").textContent = bits.join(" · ");
  saveStatus = { label: "Checking saves…", reachable: false, dirty: false, syncing: false };
  pendingSaveBytes = null;
  $("play-controls-wrap").innerHTML = controlsFormHtml();
  const dlg = $("playbrowser");
  setPlayFocus(false);
  setPlayOpen(true);
  if (!dlg.open) dlg.showModal();
  void refreshSaveStatus();
  // Let the dialog paint at full size before EmulatorJS measures #play-ejs.
  requestAnimationFrame(() => {
    focusPlayPlayer();
    void startEmulator(sys, g);
  });
}

async function requestClosePlay() {
  const dlg = $("playbrowser");
  if (!dlg?.open) return;
  clearListening();
  const title = $("play-title")?.textContent || "this game";
  const bytes = readEmuSaveBytes();
  const note = bytes?.length
    ? "SRAM will be kept in the manager (<code>backups/saves-browser/</code>). Use <b>Save to device</b> before leaving if you want it on the handheld."
    : "No SRAM was captured in this session.";
  const ok = await confirmBox({
    title: "Leave this game?",
    html: `<p>Stop playing <b>${esc(title)}</b> in the browser?</p><p class="muted-note">${note}</p>`,
    ok: "Leave game",
  });
  if (ok && dlg.open) dlg.close();
  else if (dlg.open) focusPlayPlayer();
}

export function bindPlayBrowser() {
  if (bound) return;
  bound = true;
  const dlg = $("playbrowser");
  dlg?.addEventListener("close", () => {
    startGen += 1;
    teardown();
  });
  // Esc must not dismiss play — only the close control after confirm.
  dlg?.addEventListener("cancel", (e) => {
    e.preventDefault();
    if (listeningBtn) clearListening();
  });
  // Capture: stop arrows/space scrolling the page or dialog while the game is open.
  window.addEventListener("keydown", playScrollKeyGuard, { capture: true });
  dlg?.addEventListener("click", (e) => {
    if (e.target.closest("#play-ejs") && !e.target.closest("[data-play-key]")) focusPlayPlayer();
  });
  document.addEventListener("click", (e) => {
    const close = e.target.closest("[data-play=\"close\"]");
    if (close && dlg?.open) {
      e.preventDefault();
      requestClosePlay();
      return;
    }
    const focusBtn = e.target.closest("[data-play=\"focus\"]");
    if (focusBtn && dlg?.open) {
      e.preventDefault();
      setPlayFocus(!dlg.classList.contains("play-focus"));
      return;
    }
    const bind = e.target.closest("[data-play-key]");
    if (bind && dlg?.open) {
      e.preventDefault();
      e.stopPropagation();
      if (listeningBtn === bind) clearListening();
      else setListening(bind);
      return;
    }
    if (listeningBtn && !e.target.closest(".play-controls")) clearListening();
    const act = e.target.closest("[data-play]");
    if (!act || !dlg?.open) return;
    if (act.dataset.play === "defaults") {
      clearListening();
      sessionKeys = { ...DEFAULT_KEYS };
      $("play-controls-wrap").innerHTML = controlsFormHtml();
      updateSaveLabel();
      return;
    }
    if (act.dataset.play === "save-pull") {
      e.preventDefault();
      void pullDeviceSaveIntoSession();
      return;
    }
    if (act.dataset.play === "save-store") {
      e.preventDefault();
      void storeBrowserSave({ push: false });
      return;
    }
    if (act.dataset.play === "save-push") {
      e.preventDefault();
      void storeBrowserSave({ push: true });
      return;
    }
    if (act.dataset.play === "restart") {
      clearListening();
      const cur = dlg.dataset.code && dlg.dataset.file
        ? { code: dlg.dataset.code, file: dlg.dataset.file, name: dlg.dataset.name, title: $("play-title").textContent }
        : null;
      if (!cur) return;
      void startEmulator({ code: cur.code, name: cur.name }, { f: cur.file, t: cur.title });
    }
  });
  document.addEventListener("keydown", (e) => {
    if (!dlg?.open || !listeningBtn) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { clearListening(); return; }
    const name = keyEventName(e);
    if (!name) return;
    const idx = Number(listeningBtn.dataset.playKey);
    sessionKeys[idx] = name;
    const btn = listeningBtn;
    clearListening();
    const keyEl = btn.querySelector(".play-bind-key");
    if (keyEl) keyEl.textContent = prettyKey(name);
    btn.setAttribute("aria-label", `${btn.dataset.face || "Button"}: ${prettyKey(name)}`);
    btn.classList.add("just-set");
    setTimeout(() => btn.classList.remove("just-set"), 450);
  }, true);
}

function keyEventName(e) {
  const k = e.key;
  if (!k) return "";
  if (k === "Shift") return "shift";
  if (k === "Control") return "ctrl";
  if (k === "Alt") return "alt";
  if (k === "Meta") return "meta";
  if (k === " ") return "space";
  if (k === "ArrowUp") return "up arrow";
  if (k === "ArrowDown") return "down arrow";
  if (k === "ArrowLeft") return "left arrow";
  if (k === "ArrowRight") return "right arrow";
  if (k === "Enter") return "enter";
  if (k === "Escape") return "escape";
  if (k === "Tab") return "tab";
  if (k === "Backspace") return "backspace";
  if (k.length === 1) return k.toLowerCase();
  return k.toLowerCase();
}

/** Remember current game on the dialog for restart. */
export function notePlayTarget(sys, g) {
  const dlg = $("playbrowser");
  if (!dlg) return;
  dlg.dataset.code = sys.code;
  dlg.dataset.file = g.f;
  dlg.dataset.name = sys.name || sys.code;
}

export function openPlayBrowserFor(sys, g) {
  notePlayTarget(sys, g);
  openPlayBrowser(sys, g);
}
