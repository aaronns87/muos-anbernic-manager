// In-browser play for light systems via EmulatorJS (CDN cores + local ROM stream).

import { $, esc, icon, TOKEN, toast } from "./core.js";

/** Manager system folder → EmulatorJS core. Keep in sync with src/games/play-rom.ts. */
export const PLAY_CORES = {
  GB: "gb", GBC: "gb", GBA: "gba", FC: "nes", SFC: "snes",
  SMS: "segaMS", GG: "segaGG", MD: "segaMD", NGP: "ngp", WS: "ws", PCE: "pce",
};

const BLOCKED = new Set(["cue", "m3u", "ccd", "toc", "gdi", "chd", "iso", "bin", "img", "wav", "ogg", "mp3"]);
const OK = new Set([
  "gb", "gbc", "gba", "nes", "unf", "unif", "fds", "smc", "sfc", "fig", "swc",
  "sms", "gg", "md", "gen", "smd", "ngp", "ngc", "npc", "ws", "wsc", "pce", "zip", "7z",
]);

const EJS_DATA = "https://cdn.emulatorjs.org/stable/data/";

/** Button index → { id, label } for the session key map UI. */
const CONTROL_ROWS = [
  [4, "Up"], [5, "Down"], [6, "Left"], [7, "Right"],
  [8, "A (confirm)"], [0, "B (back)"], [9, "X"], [1, "Y"],
  [3, "Start"], [2, "Select"],
  [10, "L"], [11, "R"],
];

const DEFAULT_KEYS = {
  0: "x", 1: "s", 2: "shift", 3: "enter",
  4: "up arrow", 5: "down arrow", 6: "left arrow", 7: "right arrow",
  8: "z", 9: "a", 10: "q", 11: "e",
};

let sessionKeys = { ...DEFAULT_KEYS };
let bound = false;
let loaderEl = null;

function extOf(file) {
  const i = file.lastIndexOf(".");
  return i >= 0 ? file.slice(i + 1).toLowerCase() : "";
}

export function canPlayInBrowser(sys, g) {
  if (!sys?.code || !g?.f) return false;
  if (!PLAY_CORES[sys.code]) return false;
  const x = (g.x || extOf(g.f)).toLowerCase();
  if (BLOCKED.has(x)) return false;
  return OK.has(x);
}

function romUrl(code, file) {
  const q = new URLSearchParams({ code, file, token: TOKEN });
  return new URL(`/api/games/rom?${q}`, location.origin).href;
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

function controlsFormHtml() {
  const rows = CONTROL_ROWS.map(([i, label]) => `<label class="play-key"><span>${esc(label)}</span>
    <input class="control" type="text" data-play-key="${i}" value="${esc(sessionKeys[i] ?? "")}" spellcheck="false" autocomplete="off"></label>`).join("");
  return `<details class="play-controls"><summary>Keyboard controls (this session)</summary>
    <p class="muted-note">Click a field and press a key, or type the EmulatorJS key name (for example <code>up arrow</code>, <code>enter</code>). Changes apply on Restart.</p>
    <div class="play-key-grid">${rows}</div>
    <div class="play-controls-actions">
      <button type="button" class="btn small" data-play="defaults">Reset defaults</button>
      <button type="button" class="btn small primary" data-play="restart">Restart with these keys</button>
    </div></details>`;
}

function readKeysFromForm() {
  const next = { ...sessionKeys };
  for (const input of document.querySelectorAll("[data-play-key]")) {
    next[Number(input.dataset.playKey)] = input.value.trim().toLowerCase();
  }
  sessionKeys = next;
  return sessionKeys;
}

function teardown() {
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
  delete window.EJS_startOnLoaded;
  delete window.EJS_defaultControls;
  delete window.EJS_Buttons;
  delete window.EJS_color;
  delete window.EJS_ready;
  delete window.EJS_onGameStart;
}

function startEmulator(sys, g) {
  teardown();
  const host = $("play-ejs");
  host.innerHTML = "";
  const core = PLAY_CORES[sys.code];
  window.EJS_player = "#play-ejs";
  window.EJS_core = core;
  window.EJS_gameUrl = romUrl(sys.code, g.f);
  window.EJS_gameName = g.t || g.f;
  window.EJS_pathtodata = EJS_DATA;
  window.EJS_startOnLoaded = true;
  window.EJS_defaultControls = buildDefaultControls(readKeysFromForm());
  window.EJS_color = "#c4a35a";
  // EmulatorJS listens for keys on #play-ejs; keep focus there so arrows/A/B reach the core.
  window.EJS_ready = () => focusPlayPlayer();
  window.EJS_onGameStart = () => focusPlayPlayer();
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
  $("play-sub").textContent = `${sys.name || sys.code} · ${g.f} · needs a network connection the first time for emulator cores`;
  $("play-controls-wrap").innerHTML = controlsFormHtml();
  const dlg = $("playbrowser");
  if (!dlg.open) dlg.showModal();
  // Let the dialog paint at full size before EmulatorJS measures #play-ejs.
  requestAnimationFrame(() => startEmulator(sys, g));
}

export function bindPlayBrowser() {
  if (bound) return;
  bound = true;
  const dlg = $("playbrowser");
  dlg?.addEventListener("close", () => teardown());
  dlg?.addEventListener("click", (e) => {
    if (e.target.closest("#play-ejs") && !e.target.closest("[data-play-key]")) focusPlayPlayer();
  });
  document.addEventListener("click", (e) => {
    const close = e.target.closest("[data-play=\"close\"]");
    if (close) { dlg?.close(); return; }
    const act = e.target.closest("[data-play]");
    if (!act || !dlg?.open) return;
    if (act.dataset.play === "defaults") {
      sessionKeys = { ...DEFAULT_KEYS };
      $("play-controls-wrap").innerHTML = controlsFormHtml();
      return;
    }
    if (act.dataset.play === "restart") {
      const cur = dlg.dataset.code && dlg.dataset.file
        ? { code: dlg.dataset.code, file: dlg.dataset.file, name: dlg.dataset.name, title: $("play-title").textContent }
        : null;
      if (!cur) return;
      startEmulator({ code: cur.code, name: cur.name }, { f: cur.file, t: cur.title });
    }
  });
  document.addEventListener("keydown", (e) => {
    if (!dlg?.open) return;
    const input = e.target.closest("[data-play-key]");
    if (!input) return;
    e.preventDefault();
    e.stopPropagation();
    const name = keyEventName(e);
    if (!name) return;
    input.value = name;
    sessionKeys[Number(input.dataset.playKey)] = name;
  }, true);
}

function keyEventName(e) {
  const k = e.key;
  if (!k || k === "Shift" || k === "Control" || k === "Alt" || k === "Meta") return "";
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
