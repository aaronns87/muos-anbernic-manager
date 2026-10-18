// Device > Controls: live stick pads, joycal wizard, and system input settings over SSH.

import { $, api, esc, icon, toast } from "./core.js";
import { confirmBox } from "./art-images.js";

const INPUT_KEYS = new Set([
  "settings/advanced/sticknav",
  "settings/advanced/dpad_swap",
  "settings/advanced/rumble",
]);

const C = {
  bound: false,
  snap: null,
  error: "",
  loading: false,
  device: "",
  buttonsFrom: "",
  state: null,
  poll: null,
  calibrating: false,
  wizard: "", // "" | rest | move | review
  wizardNote: "",
  draftJson: null,
  settings: null,
  edits: {},
  savingSettings: false,
  savingJoy: false,
};

const roleHint = (d) => {
  if (d.role === "sticks" || d.role === "mixed") return "sticks";
  if (d.role === "buttons") return "buttons";
  return "";
};

const stickCount = () => {
  const n = C.snap?.sticks;
  if (n === 0) return 0;
  if (n === 1 || n === 2) return n;
  const abs = (C.snap?.devices || []).find((d) => d.path === C.device)?.abs || [];
  if (abs.includes(3) || abs.includes(4)) return 2;
  if (abs.includes(0) || abs.includes(1)) return 1;
  return 2;
};

function stopPoll() {
  clearTimeout(C.poll);
  C.poll = null;
}

export function showControls() {
  if (!C.bound) bind();
  if (!C.snap && !C.loading) load();
  else {
    render();
    startPoll();
  }
}

export function renderControls() {
  const box = $("hh-controls");
  if (!box || box.hidden) return;
  render();
}

export function hideControls() {
  stopPoll();
}

async function load() {
  C.loading = true;
  C.error = "";
  render();
  try {
    C.snap = await api("controls");
    C.device = C.snap.stickDevice || C.snap.devices?.[0]?.path || "";
    C.buttonsFrom = C.snap.buttonDevice || C.device;
    C.draftJson = C.snap.joycalJson;
    const all = await api("handheld/settings").catch(() => null);
    if (all) {
      C.settings = {
        ...all,
        groups: (all.groups || [])
          .map((g) => ({ ...g, items: g.items.filter((i) => INPUT_KEYS.has(i.key)) }))
          .filter((g) => g.items.length),
      };
    }
  } catch (error) {
    C.error = error.message;
    C.snap = null;
  }
  C.loading = false;
  render();
  startPoll();
}

function startPoll() {
  stopPoll();
  const box = $("hh-controls");
  if (!box || box.hidden || !C.device || C.calibrating || C.wizard) return;
  if (!C.snap?.python) return;
  tick();
}

async function tick() {
  if (!$("hh-controls") || $("hh-controls").hidden || C.calibrating || C.wizard) return;
  try {
    const q = new URLSearchParams({ device: C.device, axes: "0,1,3,4" });
    if (C.buttonsFrom && C.buttonsFrom !== C.device) q.set("buttons", C.buttonsFrom);
    C.state = await api(`controls/state?${q}`);
    C.error = "";
    paintLive();
  } catch (error) {
    C.state = null;
    const el = $("ctrl-live-note");
    if (el) el.textContent = error.message;
  }
  C.poll = setTimeout(tick, 120);
}

function render() {
  const box = $("hh-controls");
  if (!box) return;
  if (C.loading && !C.snap) {
    box.innerHTML = `<div class="planning"><span class="spinner"></span> Asking the handheld&hellip;</div>`;
    return;
  }
  if (!C.snap) {
    box.innerHTML = `<section class="panel full"><h2>${icon("gamepad")}Controls</h2>
      <div class="notice err">${esc(C.error || "Controls need Wi-Fi with Secure Shell on.")}</div></section>`;
    return;
  }
  const s = C.snap;
  const devices = s.devices || [];
  const deviceOpts = devices.length
    ? devices.map((d) => {
      const hint = roleHint(d);
      const tag = hint ? ` [${hint}]` : "";
      return `<option value="${esc(d.path)}"${d.path === C.device ? " selected" : ""}>${esc(d.name)}${tag} (${esc(d.path)})</option>`;
    }).join("")
    : `<option value="">No stick device found</option>`;
  const btnDev = devices.find((d) => d.path === C.buttonsFrom);
  const btnNote = btnDev && C.buttonsFrom !== C.device
    ? ` Face buttons also from ${btnDev.name}.`
    : "";

  box.innerHTML = `<div class="hh-controls">
    <section class="panel full ctrl-hero">
      <h2>${icon("gamepad")}Live pads</h2>
      <p class="muted-note">${esc(s.note || "")} ${s.joycal ? "" : "This MustardOS build has no <code>joycal</code> binary yet; live testing still works when Python can read the sticks."}</p>
      <div class="ctrl-toolbar">
        <label class="ctrl-device">Input device
          <select class="control" data-ctrl="device"${C.calibrating ? " disabled" : ""}>${deviceOpts}</select>
        </label>
        <button class="btn small" data-ctrl="refresh"${C.loading ? " disabled" : ""}>${icon("refresh")}<span>Refresh</span></button>
        ${C.wizard || C.calibrating ? "" : `<button class="btn small primary" data-ctrl="cal-start"${!s.joycal || !C.device ? " disabled" : ""}>${icon("wand")}<span>Calibrate analogs</span></button>`}
      </div>
      <p class="muted-note" id="ctrl-live-note">${C.calibrating || C.wizard ? "Live sampling paused while calibrating." : (s.python ? `Sampling over SSH.${btnNote}` : "Python 3 is required on the handheld to sample sticks.")}</p>
      <div class="ctrl-pads" id="ctrl-pads">${padsHtml()}</div>
      <div class="ctrl-btns" id="ctrl-btns">${buttonsHtml()}</div>
    </section>
    ${wizardHtml()}
    ${joycalHtml()}
    ${settingsHtml()}
    <p class="muted-note">Per-game RetroArch remaps and PPSSPP controls stay in Emulation / Game Tuning / Menu+X on the handheld.</p>
  </div>`;
}

function axisPair(codes) {
  const axes = C.state?.axes || [];
  const x = axes.find((a) => a.code === codes[0]);
  const y = axes.find((a) => a.code === codes[1]);
  const norm = (a) => {
    if (!a || a.max === a.min) return 0;
    const mid = (a.max + a.min) / 2;
    const span = (a.max - a.min) / 2 || 1;
    return Math.max(-1, Math.min(1, (a.value - mid) / span));
  };
  const dead = (() => {
    const flat = Math.max(x?.flat || 0, y?.flat || 0);
    const span = Math.max(Math.abs((x?.max || 1) - (x?.min || 0)), 1) / 2;
    return Math.min(0.45, flat / span);
  })();
  // Invert Y so stick-up moves the knob up (ABS_Y grows when pushed down).
  return { nx: norm(x), ny: -norm(y), dead, live: !!(x || y) };
}

function stickSvg(label, pair) {
  const { nx, ny, dead, live } = pair;
  const cx = 50 + nx * 38;
  const cy = 50 + ny * 38;
  const rDead = dead * 38;
  return `<div class="ctrl-stick${live ? "" : " off"}">
    <span class="ctrl-stick-label">${esc(label)}</span>
    <svg viewBox="0 0 100 100" class="ctrl-stick-svg" aria-hidden="true">
      <circle cx="50" cy="50" r="46" class="ctrl-ring-outer"/>
      ${rDead > 2 ? `<circle cx="50" cy="50" r="${rDead.toFixed(1)}" class="ctrl-ring-dead"/>` : ""}
      <line x1="50" y1="8" x2="50" y2="92" class="ctrl-cross"/><line x1="8" y1="50" x2="92" y2="50" class="ctrl-cross"/>
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="8" class="ctrl-knob"/>
    </svg>
    <code class="ctrl-stick-readout">${live ? `${nx.toFixed(2)}, ${ny.toFixed(2)}` : "-"}</code>
  </div>`;
}

function padsHtml() {
  const n = stickCount();
  if (n === 0) return `<p class="muted-note">This board reports no analog sticks.</p>`;
  const left = stickSvg("Left stick", axisPair([0, 1]));
  const right = n > 1 ? stickSvg("Right stick", axisPair([3, 4])) : "";
  return left + right;
}

function buttonsHtml() {
  const btns = C.state?.buttons || {};
  const order = ["A", "B", "X", "Y", "L1", "R1", "L2", "R2", "Select", "Start", "L3", "R3", "Up", "Down", "Left", "Right"];
  return order.map((name) =>
    `<span class="ctrl-btn${btns[name] ? " on" : ""}">${esc(name)}</span>`).join("");
}

function paintLive() {
  const pads = $("ctrl-pads");
  const btns = $("ctrl-btns");
  if (pads) pads.innerHTML = padsHtml();
  if (btns) btns.innerHTML = buttonsHtml();
  const note = $("ctrl-live-note");
  if (note && !C.wizard && !C.calibrating) {
    const btnDev = (C.snap?.devices || []).find((d) => d.path === C.buttonsFrom);
    const extra = btnDev && C.buttonsFrom !== C.device ? ` Face buttons also from ${btnDev.name}.` : "";
    note.textContent = `Sampling over SSH.${extra}`;
  }
}

function wizardHtml() {
  if (!C.wizard && !C.calibrating) return "";
  const step = C.wizard || "busy";
  const steps = [
    ["rest", "1. Rest"],
    ["move", "2. Circles"],
    ["review", "3. Review"],
  ].map(([id, label]) =>
    `<span class="ctrl-wiz-step${step === id ? " on" : ""}${["rest", "move", "review"].indexOf(step) > ["rest", "move", "review"].indexOf(id) ? " done" : ""}">${esc(label)}</span>`).join("");
  let body = "";
  if (C.calibrating) {
    body = `<p class="muted-note"><span class="spinner sm"></span> ${esc(C.wizardNote || "Running joycal on the handheld... Follow the on-device timing: hold still, then move the sticks.")}</p>`;
  } else if (step === "rest") {
    body = `<p>Leave both analogs centered. The handheld will measure centre noise for a few seconds.</p>
      <button class="btn primary" data-ctrl="cal-run">${icon("play")}<span>Start calibration</span></button>
      <button class="btn ghost" data-ctrl="cal-cancel">Cancel</button>`;
  } else if (step === "move") {
    body = `<p>Move each stick in full circles and to every extreme until the timer ends.</p>`;
  } else if (step === "review") {
    body = `<p>Calibration produced new values. Apply them to <code>joycal.json</code> on the handheld, or discard.</p>
      <pre class="hh-bench-log ctrl-json">${esc(JSON.stringify(C.draftJson, null, 2) || "{}")}</pre>
      <div class="ctrl-wiz-actions">
        <button class="btn primary" data-ctrl="cal-apply">${icon("check")}<span>Apply on handheld</span></button>
        <button class="btn ghost" data-ctrl="cal-cancel">Discard</button>
      </div>`;
  }
  return `<section class="panel full">
    <h2>${icon("wand")}Calibrate</h2>
    <div class="ctrl-wiz-rail">${steps}</div>
    ${body}
  </section>`;
}

function joycalHtml() {
  const json = C.draftJson;
  const text = json ? JSON.stringify(json, null, 2) : "";
  return `<section class="panel full">
    <h2>${icon("sliders")}Calibration file <small>joycal.json</small></h2>
    <p class="muted-note">Stored at <code>${esc(C.snap.joycalPath)}</code>. Edit carefully after a calibration run, or clear to remove system stick calibration.</p>
    <textarea class="control mono ctrl-json-edit" data-ctrl="joy-text" rows="10" spellcheck="false" placeholder="No joycal.json yet - run Calibrate analogs first.">${esc(text)}</textarea>
    <div class="ctrl-wiz-actions">
      <button class="btn primary" data-ctrl="joy-save"${C.savingJoy ? " disabled" : ""}>${C.savingJoy ? `<span class="spinner sm"></span>` : icon("check")}<span>Save JSON</span></button>
      <button class="btn ghost" data-ctrl="joy-clear"${!json || C.savingJoy ? " disabled" : ""}>Remove file</button>
    </div>
  </section>`;
}

function settingsHtml() {
  const groups = C.settings?.groups || [];
  if (!groups.length) {
    return `<section class="panel full"><h2>${icon("sliders")}Input settings</h2>
      <p class="muted-note">Connect over SSH to load menu stick navigation, D-pad swap and rumble.</p></section>`;
  }
  const rows = groups.flatMap((g) => g.items).map((item) => {
    const v = item.key in C.edits ? C.edits[item.key] : item.value;
    let control = "";
    if (item.kind === "toggle" || (item.options && item.options.length === 2 && item.options.every(([o]) => o === "0" || o === "1"))) {
      control = `<select class="control" data-ctrl-set="${esc(item.key)}">
        ${(item.options || [["0", "Off"], ["1", "On"]]).map(([o, l]) =>
    `<option value="${esc(o)}"${String(v) === String(o) ? " selected" : ""}>${esc(l)}</option>`).join("")}
      </select>`;
    } else if (item.options) {
      control = `<select class="control" data-ctrl-set="${esc(item.key)}">
        ${item.options.map(([o, l]) => `<option value="${esc(o)}"${String(v) === String(o) ? " selected" : ""}>${esc(l)}</option>`).join("")}
      </select>`;
    } else {
      control = `<input class="control" data-ctrl-set="${esc(item.key)}" value="${esc(v)}">`;
    }
    const dirty = item.key in C.edits && C.edits[item.key] !== item.value;
    return `<label class="tune-row${dirty ? " set" : ""}">
      <span class="tune-row-text"><b>${esc(item.label)}</b><small>${esc(item.help || "")}</small></span>
      ${control}
    </label>`;
  }).join("");
  const dirty = Object.keys(C.edits).some((k) => {
    const item = groups.flatMap((g) => g.items).find((i) => i.key === k);
    return item && C.edits[k] !== item.value;
  });
  return `<section class="panel full">
    <h2>${icon("sliders")}Input settings</h2>
    <p class="muted-note">MustardOS system options for sticks and rumble. Same files as Device > Settings.</p>
    <div class="tune-rows">${rows}</div>
    <div class="ctrl-wiz-actions">
      <button class="btn primary" data-ctrl="set-save"${!dirty || C.savingSettings ? " disabled" : ""}>${C.savingSettings ? `<span class="spinner sm"></span>` : icon("check")}<span>Save settings</span></button>
    </div>
  </section>`;
}

async function startCalibrate() {
  C.wizard = "rest";
  C.wizardNote = "";
  stopPoll();
  render();
}

async function runCalibrate() {
  C.wizard = "move";
  C.calibrating = true;
  C.wizardNote = "Hold sticks still for the noise sample, then move them in full circles...";
  render();
  try {
    const res = await api("controls/calibrate", {
      device: C.device,
      noise: 2,
      duration: 6,
      deadzonePad: 8,
      apply: false,
    });
    C.draftJson = res.json;
    C.wizard = "review";
    C.calibrating = false;
    render();
  } catch (error) {
    C.calibrating = false;
    C.wizard = "";
    toast(error.message, 5000);
    render();
    startPoll();
  }
}

async function applyCalibrate() {
  C.savingJoy = true;
  render();
  try {
    await api("controls/joycal", { json: C.draftJson });
    toast("Calibration saved on the handheld", 2800);
    C.wizard = "";
    C.snap = await api("controls");
    C.draftJson = C.snap.joycalJson;
  } catch (error) {
    toast(error.message, 4500);
  }
  C.savingJoy = false;
  render();
  startPoll();
}

async function saveJoyText() {
  const raw = $("hh-controls")?.querySelector("[data-ctrl=joy-text]")?.value?.trim() || "";
  let json = null;
  if (raw) {
    try { json = JSON.parse(raw); }
    catch { toast("JSON is not valid", 3000); return; }
  }
  C.savingJoy = true;
  render();
  try {
    const res = await api("controls/joycal", { json });
    C.draftJson = res.json;
    toast(json ? "joycal.json saved" : "joycal.json removed", 2500);
    C.snap = await api("controls");
  } catch (error) {
    toast(error.message, 4500);
  }
  C.savingJoy = false;
  render();
}

async function clearJoy() {
  const ok = await confirmBox({
    title: "Remove stick calibration?",
    html: "<p>Deletes <code>joycal.json</code> on the handheld. Sticks go back to driver defaults.</p>",
    ok: "Remove", danger: true,
  });
  if (!ok) return;
  C.savingJoy = true;
  render();
  try {
    await api("controls/joycal", { json: null });
    C.draftJson = null;
    C.snap = await api("controls");
    toast("joycal.json removed", 2500);
  } catch (error) {
    toast(error.message, 4500);
  }
  C.savingJoy = false;
  render();
}

async function saveSettings() {
  const items = (C.settings?.groups || []).flatMap((g) => g.items);
  const changes = {};
  const seen = {};
  for (const item of items) {
    seen[item.key] = item.value;
    if (item.key in C.edits && C.edits[item.key] !== item.value) changes[item.key] = C.edits[item.key];
  }
  if (!Object.keys(changes).length) return;
  C.savingSettings = true;
  render();
  try {
    const res = await api("handheld/settings", { changes, seen });
    C.settings = {
      ...res.settings,
      groups: (res.settings.groups || [])
        .map((g) => ({ ...g, items: g.items.filter((i) => INPUT_KEYS.has(i.key)) }))
        .filter((g) => g.items.length),
    };
    C.edits = {};
    toast("Input settings saved", 2500);
  } catch (error) {
    toast(error.message, 4500);
  }
  C.savingSettings = false;
  render();
}

function bind() {
  C.bound = true;
  const box = $("hh-controls");
  box.addEventListener("click", (e) => {
    const el = e.target.closest("[data-ctrl]");
    if (!el || el.disabled) return;
    const a = el.dataset.ctrl;
    if (a === "refresh") load();
    else if (a === "cal-start") startCalibrate();
    else if (a === "cal-run") runCalibrate();
    else if (a === "cal-apply") applyCalibrate();
    else if (a === "cal-cancel") { C.wizard = ""; C.calibrating = false; render(); startPoll(); }
    else if (a === "joy-save") saveJoyText();
    else if (a === "joy-clear") clearJoy();
    else if (a === "set-save") saveSettings();
  });
  box.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.ctrl === "device") {
      C.device = t.value;
      const picked = (C.snap?.devices || []).find((d) => d.path === C.device);
      // Keep a separate Keys node for face buttons when the stick device has none.
      if (picked?.keys) C.buttonsFrom = C.device;
      else C.buttonsFrom = C.snap?.buttonDevice || C.device;
      C.state = null;
      render();
      startPoll();
    } else if (t.dataset.ctrlSet) {
      C.edits[t.dataset.ctrlSet] = t.value;
      render();
      startPoll();
    }
  });
}
