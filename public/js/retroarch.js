// RetroArch tab: picture/play overrides (.cfg) and Menu+X-style core options (.opt) per ROM folder.

import { $, api, esc, icon, plural, toast } from "./core.js";
import { confirmBox } from "./art-images.js";
import {
  catalogueDirty, draftFromOwn, optGroupsHtml, valuesPayload,
} from "./opt-editor.js";

const R = {
  data: null, error: "", loading: false, saving: false, edit: "", scope: "folder", draft: null, others: false, wifi: undefined,
  opt: null, optLoading: false, optError: "", optDraft: null, optQ: "", optSaving: false,
};
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
    if (R.edit) await loadOpts(R.edit, false);
  } catch (error) {
    R.error = error.message;
  }
  R.loading = false;
  render();
}

async function loadOpts(folder, paint = true) {
  R.optLoading = true;
  R.optError = "";
  if (paint) render();
  try {
    R.opt = await api(`tuning/folder-options?${new URLSearchParams({ folder, scope: R.scope })}`);
    R.optDraft = draftFromOwn(R.opt.catalogue, R.opt.own, R.opt.base);
    R.optQ = "";
  } catch (error) {
    R.opt = null;
    R.optDraft = null;
    R.optError = error.message;
  }
  R.optLoading = false;
  if (paint) render();
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
  $("emu-sub").innerHTML = `Picture, play and core options (Menu+X) for each ROM folder on <b>${esc(d.host)}</b>`;
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
      <button class="btn small${editing ? " ghost" : ""}" data-ra="edit" data-folder="${esc(f.name)}"${R.saving || R.optSaving ? " disabled" : ""}>${editing ? "Close" : "Change"}</button>
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
    <div class="ra-opt-head"><h3>Picture and play</h3><span class="muted-note">Frontend overrides (.cfg)</span></div>
    <div class="ra-fields">${FIELDS.map((k) => select(f, k)).join("")}</div>
    <div class="ra-actions">
      <button class="btn ghost" data-ra="clear"${set && !R.saving ? "" : " disabled"}>Back to defaults</button>
      <span class="grow"></span>
      <button class="btn primary" data-ra="save" data-folder="${esc(f.name)}"${same || R.saving ? " disabled" : ""}>${R.saving ? `<span class="spinner sm"></span><span>Saving&hellip;</span>` : `${icon("check")}<span>Save picture &amp; play</span>`}</button>
    </div>
    ${coreOptionsBlock(f)}
  </div>`;
}

function coreOptionsBlock(f) {
  if (R.optLoading) return `<div class="ra-opt-head"><h3>Core options</h3></div><p class="muted-note"><span class="spinner sm"></span> Loading Menu+X options&hellip;</p>`;
  if (R.optError) return `<div class="ra-opt-head"><h3>Core options</h3></div><div class="notice err">${esc(R.optError)}</div>`;
  if (!R.opt || R.opt.folder !== f.name) return `<div class="ra-opt-head"><h3>Core options</h3></div><p class="muted-note">Loading&hellip;</p>`;
  const dirty = catalogueDirty(R.opt.catalogue, R.optDraft, R.opt.own, R.opt.base);
  const n = R.opt.catalogue?.length || 0;
  const filter = n > 12
    ? `<label class="search small">${icon("search")}<input type="search" data-ra-optq placeholder="Filter options" value="${esc(R.optQ)}" aria-label="Filter core options"></label>`
    : "";
  return `<div class="ra-opt-head"><h3>Core options</h3><span class="muted-note">Menu+X (.opt)${R.opt.hasOwnFile ? " · file on handheld" : ""}${n ? ` · ${n}` : ""}</span>${filter}</div>
    <p class="muted-note">Same options as Menu+X on the handheld for ${esc(R.scope === "core" ? `every folder using ${f.core}` : f.name)}. From the ${esc(R.opt.baseFrom === "core" ? "core defaults file" : "emulator defaults")} when left on Default.</p>
    ${optGroupsHtml(R.opt.catalogue, R.optDraft, R.opt.base, { q: R.optQ, disabled: R.optSaving, dataKey: "ra-opt" })}
    <div class="ra-actions">
      <button class="btn ghost" data-ra="opt-reset"${R.opt.hasOwnFile && !R.optSaving ? "" : " disabled"} title="Remove this options file">Back to defaults</button>
      <span class="grow"></span>
      <button class="btn primary" data-ra="opt-save" data-folder="${esc(f.name)}"${dirty && !R.optSaving ? "" : " disabled"}>${R.optSaving ? `<span class="spinner sm"></span><span>Saving&hellip;</span>` : `${icon("check")}<span>Save core options</span>`}</button>
    </div>`;
}

function draftFor(f) {
  const src = R.scope === "core" ? f.coreSettings : f.folderSettings;
  R.draft = Object.fromEntries(FIELDS.map((k) => [k, norm(k, src?.[k])]));
}

async function save(folder) {
  const f = R.data.folders.find((x) => x.name === folder);
  if (R.scope === "core" && f.shared.length) {
    const ok = await confirmBox({ title: `Change ${f.core} for ${f.shared.length + 1} folders?`, html: `<p>These picture and play options apply to ${esc([f.name, ...f.shared].join(", "))}.</p>`, ok: "Save" });
    if (!ok) return;
  }
  R.saving = true;
  render();
  try {
    await api("retroarch/save", { folder, scope: R.scope, values: R.draft });
    toast(R.scope === "core" ? `Saved picture & play for every folder using ${f.core}` : `Saved picture & play for ${folder}`, 2600);
    R.data = await api("retroarch");
    const fresh = R.data.folders.find((x) => x.name === folder);
    if (fresh) draftFor(fresh);
  } catch (error) {
    toast(error.message, 4500);
  }
  R.saving = false;
  render();
}

async function saveOpts(folder) {
  const f = R.data.folders.find((x) => x.name === folder);
  if (R.scope === "core" && f.shared.length) {
    const ok = await confirmBox({
      title: `Change core options for ${f.core}?`,
      html: `<p>These Menu+X options apply to ${esc([f.name, ...f.shared].join(", "))} unless a folder has its own .opt.</p>`,
      ok: "Save",
    });
    if (!ok) return;
  }
  R.optSaving = true;
  render();
  try {
    await api("tuning/folder-options", {
      folder, scope: R.scope, values: valuesPayload(R.opt.catalogue, R.optDraft),
    });
    toast(R.scope === "core" ? `Saved core options for ${f.core}` : `Saved core options for ${folder}`, 2600);
    await loadOpts(folder, false);
  } catch (error) {
    toast(error.message, 4500);
  }
  R.optSaving = false;
  render();
}

async function resetOpts(folder) {
  const ok = await confirmBox({
    title: "Remove core options file?",
    html: `<p>${R.scope === "core" ? `Every folder using ${esc(R.opt.core)}` : esc(folder)} goes back to ${R.scope === "folder" ? "the core's or emulator" : "emulator"} defaults.</p>`,
    ok: "Remove", danger: true,
  });
  if (!ok) return;
  R.optSaving = true;
  render();
  try {
    await api("tuning/folder-options/reset", { folder, scope: R.scope });
    toast("Core options cleared", 2600);
    await loadOpts(folder, false);
  } catch (error) {
    toast(error.message, 4500);
  }
  R.optSaving = false;
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
      if (R.edit === folder) { R.edit = ""; R.opt = null; R.optDraft = null; }
      else {
        R.edit = folder;
        R.scope = "folder";
        draftFor(R.data.folders.find((x) => x.name === folder));
        loadOpts(folder);
      }
      render();
    } else if (ra === "scope") {
      R.scope = el.dataset.scope;
      draftFor(R.data.folders.find((x) => x.name === R.edit));
      loadOpts(R.edit);
      render();
    } else if (ra === "clear") { for (const k of FIELDS) R.draft[k] = ""; render(); }
    else if (ra === "save") save(folder);
    else if (ra === "opt-save") saveOpts(folder);
    else if (ra === "opt-reset") resetOpts(R.edit);
  });
  view.addEventListener("change", (e) => {
    const t = e.target;
    const k = t.dataset?.raField;
    if (k && R.draft) { R.draft[k] = t.value; render(); return; }
    if (t.dataset?.raOpt) { R.optDraft[t.dataset.raOpt] = t.value; render(); }
  });
  view.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset?.raOpt && t.tagName === "INPUT") { R.optDraft[t.dataset.raOpt] = t.value; return; }
    if (t.dataset?.raOptq !== undefined) {
      R.optQ = t.value;
      const keep = t.selectionStart;
      render();
      const next = $("emu-body")?.querySelector("[data-ra-optq]");
      if (next) { next.focus(); next.setSelectionRange(keep, keep); }
    }
  });
}
