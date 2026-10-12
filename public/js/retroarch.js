// RetroArch tab: picture and play options per ROM folder, or for every folder that uses the same core.

import { $, api, esc, icon, plural, toast } from "./core.js";
import { confirmBox } from "./art-images.js";

const R = { data: null, error: "", loading: false, saving: false, edit: "", scope: "folder", draft: null, others: false, wifi: undefined };
const FIELDS = ["aspect", "integer", "smooth", "shader", "overlay", "opacity", "rewind", "fps"];
const OPACITY = ["0.25", "0.5", "0.7", "0.85", "1"];

export function showRetroarch() {
  load();
  render();
}

export function renderRetroarch(wifi) {
  if (R.wifi !== undefined && wifi !== R.wifi && !R.loading) load();
  R.wifi = wifi;
  render();
}

async function load() {
  R.loading = true;
  render();
  try {
    R.data = await api("retroarch");
    R.error = "";
  } catch (error) {
    R.error = error.message;
  }
  R.loading = false;
  render();
}

// ---------------------------------------------------------------- helpers

const norm = (k, v) => (k === "opacity" && v ? String(Number(v)) : v || "");
const bool = (v) => (v === "true" ? "On" : v === "false" ? "Off" : "");
const shaderName = (v) => (v === "off" ? "Off" : v === "custom" ? "Custom preset" : v ? v.split("/").pop().replace(/\.glslp$/, "") : "");
const overlayName = (v) => (v === "off" ? "Off" : v ? v.replace(/\.cfg$/, "").split("/").slice(-2).join(" / ") : "");

function label(k, v) {
  v = norm(k, v);
  if (!v) return "";
  if (k === "aspect") return R.data.aspects[v] || `Mode ${v}`;
  if (k === "shader") return shaderName(v);
  if (k === "overlay") return overlayName(v);
  if (k === "opacity") return `${Math.round(Number(v) * 100)}%`;
  return bool(v);
}

const NAMES = { aspect: "Aspect", integer: "Integer scale", smooth: "Smoothing", shader: "Shader", overlay: "Overlay", opacity: "Overlay opacity", rewind: "Rewind", fps: "FPS" };

/** What a setting falls back to when left on Default, for the scope being edited. */
function inherited(f, k) {
  const fromCore = R.scope === "folder" ? norm(k, f.coreSettings?.[k]) : "";
  if (fromCore) return `${label(k, fromCore)} (${f.core})`;
  if (k === "shader" && !R.data.defaults.autoShaders) return "Off";
  return label(k, R.data.defaults[k]) || "Off";
}

function chips(f) {
  const out = [];
  for (const k of FIELDS) {
    const own = norm(k, f.folderSettings?.[k]), core = norm(k, f.coreSettings?.[k]);
    if (own) out.push(`<span class="set-chip ok" title="Set for ${esc(f.name)}">${NAMES[k]}: ${esc(label(k, own))}</span>`);
    else if (core) out.push(`<span class="set-chip" title="Set for every folder using ${esc(f.core)}">${NAMES[k]}: ${esc(label(k, core))}</span>`);
  }
  return out.join("") || `<span class="muted-note">RetroArch defaults</span>`;
}

function grouped(list, selected, name) {
  const groups = new Map();
  for (const p of list) {
    const g = p.includes("/") ? p.split("/")[0] : "Other";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }
  return [...groups].map(([g, items]) => `<optgroup label="${esc(g)}">${items.map((p) =>
    `<option value="${esc(p)}"${p === selected ? " selected" : ""}>${esc(name(p))}</option>`).join("")}</optgroup>`).join("");
}

function select(f, k) {
  const d = R.draft[k], def = `<option value="">Default: ${esc(inherited(f, k))}</option>`;
  const opt = (v, l) => `<option value="${v}"${d === v ? " selected" : ""}>${esc(l)}</option>`;
  let body;
  if (k === "aspect") body = Object.entries(R.data.aspects).map(([v, l]) => opt(v, l)).join("");
  else if (k === "shader") body = opt("off", "Off") + (d === "custom" ? opt("custom", "Custom preset (made on the handheld)") : "") + grouped(R.data.shaders, d, shaderName);
  else if (k === "overlay") body = opt("off", "Off") + grouped(R.data.overlays, d, overlayName);
  else if (k === "opacity") body = OPACITY.map((v) => opt(v, `${Math.round(Number(v) * 100)}%`)).join("");
  else body = opt("true", "On") + opt("false", "Off");
  return `<label><span>${NAMES[k]}</span><select class="control" data-ra-field="${k}">${def}${body}</select></label>`;
}

// ---------------------------------------------------------------- rendering

function render() {
  const root = $("emu-body");
  if (!root || $("view-emulation").hidden || !$("emu-tabs").querySelector('[data-tab="retroarch"].on')) return;
  $("emu-actions").innerHTML = `<button class="btn" data-ra="refresh" title="Read the handheld again"${R.loading ? " disabled" : ""}>${icon("refresh")}<span>Refresh</span></button>`;
  const d = R.data;
  if (!d) {
    root.innerHTML = R.error ? `<div class="notice err">${esc(R.error)}</div>` : `<div class="planning"><span class="spinner"></span> Asking the handheld&hellip;</div>`;
    return;
  }
  if (!d.reachable) {
    root.innerHTML = `<section class="panel"><h2>${icon("sliders")}RetroArch</h2>
      <div class="notice">RetroArch's settings live on the handheld. Connect it over Wi-Fi and turn on <b>Configuration &rsaquo; Web Services &rsaquo; Secure Shell</b>,
        then check the <a href="#ssh">SSH</a> section.</div></section>`;
    return;
  }
  $("emu-sub").innerHTML = `Picture and play options for each ROM folder on <b>${esc(d.host)}</b>, saved as RetroArch overrides`;
  const ra = d.folders.filter((f) => f.core), other = d.folders.filter((f) => !f.core);
  const df = d.defaults;
  root.innerHTML = `<section class="panel ra-panel">
    <h2>${icon("sliders")}Defaults <small>retroarch.cfg</small></h2>
    <div class="ra-defaults">${["aspect", "shader", "overlay", "integer", "smooth", "rewind", "fps"].map((k) =>
      `<span><small>${NAMES[k]}</small><b>${esc(k === "shader" && !df.autoShaders ? "Off" : label(k, df[k]) || "Off")}</b></span>`).join("")}</div>
    <p class="muted-note">Every folder uses these unless it has its own options below. Changes apply the next time a game starts.</p>
  </section>
  <section class="panel ra-panel">
    <h2>${icon("chip")}ROM folders <small>${ra.length}</small></h2>
    <div class="cores-list">${ra.map(row).join("")}</div>
    ${other.length ? `<p class="muted-note">${plural(other.length, "folder")} ${other.length === 1 ? "does" : "do"} not start a RetroArch core${R.others ? `: ${esc(other.map((f) => f.name).join(", "))}` : ""}.
      <button class="link-btn" data-ra="others">${R.others ? "Hide" : "Show"}</button></p>` : ""}
  </section>`;
}

function row(f) {
  const editing = R.edit === f.name;
  return `<div class="core-row${editing ? " open" : ""}">
    <div class="core-main ra-main">
      <div class="core-folder"><b>${esc(f.name)}</b><small>${f.count ? plural(f.count, "file") : "Empty"}</small></div>
      <div class="core-now"><span>${esc(f.system || "")}</span><b>${esc(f.core)}</b></div>
      <div class="ra-chips">${chips(f)}</div>
      <button class="btn small${editing ? " ghost" : ""}" data-ra="edit" data-folder="${esc(f.name)}"${R.saving ? " disabled" : ""}>${editing ? "Close" : "Change"}</button>
    </div>
    ${editing ? editor(f) : ""}
  </div>`;
}

function editor(f) {
  const same = FIELDS.every((k) => R.draft[k] === norm(k, (R.scope === "core" ? f.coreSettings : f.folderSettings)?.[k]));
  const set = FIELDS.some((k) => R.draft[k]);
  return `<div class="core-edit ra-edit">
    <div class="segmented ra-scope" role="radiogroup" aria-label="Apply to">
      <button role="radio" data-ra="scope" data-scope="folder" class="${R.scope === "folder" ? "on" : ""}" aria-checked="${R.scope === "folder"}">Only ${esc(f.name)}</button>
      <button role="radio" data-ra="scope" data-scope="core" class="${R.scope === "core" ? "on" : ""}" aria-checked="${R.scope === "core"}">Every folder using ${esc(f.core)}${f.shared.length ? ` (${f.shared.length + 1})` : ""}</button>
    </div>
    ${R.scope === "core" && f.shared.length ? `<p class="muted-note">Also changes ${esc(f.shared.join(", "))}. Options set for a single folder still win.</p>` : ""}
    <div class="ra-fields">${FIELDS.map((k) => select(f, k)).join("")}</div>
    <div class="ra-actions">
      <button class="btn ghost" data-ra="clear"${set && !R.saving ? "" : " disabled"}>Back to defaults</button>
      <span class="grow"></span>
      <button class="btn primary" data-ra="save" data-folder="${esc(f.name)}"${same || R.saving ? " disabled" : ""}>${R.saving ? `<span class="spinner sm"></span><span>Saving&hellip;</span>` : `${icon("check")}<span>Save</span>`}</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- actions

function draftFor(f) {
  const src = R.scope === "core" ? f.coreSettings : f.folderSettings;
  R.draft = Object.fromEntries(FIELDS.map((k) => [k, norm(k, src?.[k])]));
}

async function save(folder) {
  const f = R.data.folders.find((x) => x.name === folder);
  if (R.scope === "core" && f.shared.length) {
    const ok = await confirmBox({ title: `Change ${f.core} for ${f.shared.length + 1} folders?`, html: `<p>These options apply to ${esc([f.name, ...f.shared].join(", "))}.</p>`, ok: "Save" });
    if (!ok) return;
  }
  R.saving = true;
  render();
  try {
    await api("retroarch/save", { folder, scope: R.scope, values: R.draft });
    toast(R.scope === "core" ? `Saved for every folder using ${f.core}` : `Saved for ${folder}`, 2600);
    R.data = await api("retroarch");
    const fresh = R.data.folders.find((x) => x.name === folder);
    if (fresh) draftFor(fresh);
  } catch (error) {
    toast(error.message, 4500);
  }
  R.saving = false;
  render();
}

export function bindRetroarch(view) {
  view.addEventListener("click", (e) => {
    const el = e.target.closest("[data-ra]");
    if (!el || el.disabled) return;
    const { ra, folder } = el.dataset;
    if (ra === "refresh") load();
    else if (ra === "others") { R.others = !R.others; render(); }
    else if (ra === "edit") {
      if (R.edit === folder) R.edit = "";
      else { R.edit = folder; R.scope = "folder"; draftFor(R.data.folders.find((x) => x.name === folder)); }
      render();
    } else if (ra === "scope") { R.scope = el.dataset.scope; draftFor(R.data.folders.find((x) => x.name === R.edit)); render(); }
    else if (ra === "clear") { for (const k of FIELDS) R.draft[k] = ""; render(); }
    else if (ra === "save") save(folder);
  });
  view.addEventListener("change", (e) => {
    const k = e.target.dataset?.raField;
    if (!k || !R.draft) return;
    R.draft[k] = e.target.value;
    render();
  });
}
