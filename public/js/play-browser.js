// In-browser play via EmulatorJS (CDN cores + local ROM/BIOS stream).

import { confirmBox } from "./art-images.js";
import { $, esc, TOKEN, toast } from "./core.js";

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
};

/** Preferred BIOS basenames under workspace bios/ (first hit wins). Keep in sync with play-rom.ts. */
const PLAY_BIOS = {
  PS: ["scph5501.bin", "scph5502.bin", "scph5500.bin", "scph1001.bin", "scph7001.bin", "scph101.bin", "PSXONPSP660.bin"],
  SATURN: ["saturn_bios.bin", "sega_101.bin", "mpr-17933.bin", "mpr-17933c.bin"],
  MDCD: ["bios_CD_U.bin", "bios_CD_E.bin", "bios_CD_J.bin"],
  PCECD: ["syscard3.pce", "syscard2.pce", "syscard1.pce", "syscard3u.pce", "syscard2u.pce"],
};

const DISC_EXT = new Set(["chd", "iso", "cso", "pbp", "cue", "m3u"]);
const DISC_SYSTEMS = new Set(["PS", "SATURN", "MDCD", "PCECD", "PSP"]);

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

function extOf(file) {
  const i = file.lastIndexOf(".");
  return i >= 0 ? file.slice(i + 1).toLowerCase() : "";
}

export function canPlayInBrowser(sys, g) {
  if (!sys?.code || !g?.f) return false;
  if (!PLAY_CORES[sys.code]) return false;
  const x = (g.x || extOf(g.f)).toLowerCase();
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

/** First preferred BIOS present in workspace bios/, or "". */
async function resolveBiosUrl(code) {
  const preferred = PLAY_BIOS[code];
  if (!preferred?.length) return "";
  try {
    const q = new URLSearchParams({ list: "1", code, token: TOKEN });
    const res = await fetch(new URL(`/api/games/bios?${q}`, location.origin));
    if (!res.ok) return "";
    const data = await res.json();
    const have = Array.isArray(data.bios) ? data.bios : [];
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

function controlsFormHtml() {
  return `<details class="play-controls">
    <summary><span class="play-controls-title">Keyboard controls</span><span class="play-controls-badge">This session</span></summary>
    <div class="play-pad">
      <p class="play-pad-hint">Click a button, then press a key. Apply with <b>Restart with these keys</b>. Click the game screen afterwards so keys reach the emulator.</p>
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
  setPlayFocus(false);
  setPlayOpen(false);
  try { window.EJS_emulator?.pause?.(); } catch { /* ignore */ }
  try { window.EJS_emulator?.exit?.(); } catch { /* ignore */ }
  if (loaderEl) { loaderEl.remove(); loaderEl = null; }
  const host = $("play-ejs");
  if (host) host.innerHTML = "";
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
    const hint = PLAY_BIOS[sys.code][0];
    toast(`Add a BIOS for ${sys.name || sys.code} to bios/ first (e.g. ${hint}), then try again.`, 6000);
    return;
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
  window.EJS_pathtodata = EJS_DATA;
  window.EJS_startOnLoaded = true;
  // Session remap is the source of truth; ignore prior EmulatorJS localStorage (can be
  // corrupted from older control shapes and shows as "undefined" in Control Settings).
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
  // EmulatorJS listens for keys on #play-ejs; keep focus there so arrows/A/B reach the core.
  window.EJS_ready = () => {
    applySessionControls();
    focusPlayPlayer();
  };
  window.EJS_onGameStart = () => {
    applySessionControls();
    focusPlayPlayer();
  };
  loaderEl = document.createElement("script");
  // Cache-bust so Restart re-runs loader.js after a previous session.
  loaderEl.src = `${EJS_DATA}loader.js?v=${Date.now()}`;
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
  $("play-controls-wrap").innerHTML = controlsFormHtml();
  const dlg = $("playbrowser");
  setPlayFocus(false);
  setPlayOpen(true);
  if (!dlg.open) dlg.showModal();
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
  const ok = await confirmBox({
    title: "Leave this game?",
    html: `<p>Stop playing <b>${esc(title)}</b> in the browser? Progress in this session is not saved to the handheld.</p>`,
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
