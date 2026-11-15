// Theme Designer: the Themes section's third tab. Makes MustardOS themes in the themes folder with a live preview of the
// handheld's screens, saves every change as it happens, and exports themes as .muxthm or installs and applies them.

import { $, api, esc, human, icon, ICONS, model, plural, store, toast, TOKEN } from "./core.js";
import { confirmBox } from "./art-images.js";
import { comboItems } from "./combo.js";
import { drawScreen } from "./theme-preview.js";
import * as S from "./theme-schema.js";
import { assetPanel, assetClick, assetChange, assetDrop } from "./theme-assets.js";

const FIELD = new Map(S.FIELDS.map((f) => [`${f[0]}.${f[1]}`, f]));
const STYLE_PANELS = [["quick", "Quick style", "wand"], ...S.GROUPS.map(([id, label, ico]) => [id, label, ico])];
const FILE_PANELS = [["images", "Pictures", "image"], ["glyphs", "Icons", "grid"], ["fonts", "Fonts", "file"], ["sounds", "Sounds", "play"]];
const THEME_PANELS = [["details", "Details and sizes", "info"], ["variants", "Colour variants", "palette"]];
const ALL_PANELS = [...STYLE_PANELS, ...FILE_PANELS, ...THEME_PANELS];
const GLOBAL = "scheme/global.ini";
const BASE_FONT = `"Noto Sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
const HINT_SECTION = { ALIGN: "status", ALIGNMENT: "navigation", SPACING: "navigation", LIST: "glyph", HEADER: "glyph", FOOTER: "glyph", GRID: "glyph" };

/** Alpha settings that are shown together with their colour instead of on their own row. */
const PAIRED = new Set(S.FIELDS.filter((f) => f[2] === "h" && FIELD.has(`${f[0]}.${S.alphaOf(f[1])}`)).map((f) => `${f[0]}.${S.alphaOf(f[1])}`));

/** Each editor group's parts with their fields, every field in exactly one place. */
const PARTS = (() => {
  const taken = new Set(), out = new Map();
  for (const [id, , , , parts] of S.GROUPS) {
    out.set(id, parts.map(([sec, re, heading]) => {
      const fields = S.FIELDS.filter((f) => f[0] === sec && re.test(f[1]) && !taken.has(`${sec}.${f[1]}`));
      fields.forEach((f) => taken.add(`${sec}.${f[1]}`));
      return { heading, fields };
    }));
  }
  return out;
})();

const D = {
  list: null, loading: false, error: "", name: store.get("designerTheme", ""), model: null, files: new Map(),
  panel: store.get("designerPanel", "quick"), q: "", layer: GLOBAL, res: "", screen: "muxlaunch", variant: "", imgScope: "all",
  undo: [], redo: [], pending: new Map(), failed: new Map(), chain: Promise.resolve(), saving: 0, saveError: "", form: null, busy: "",
  host: null, regions: [], frame: 0,
};

const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
const split = (k) => { const i = k.indexOf("."); return [k.slice(0, i), k.slice(i + 1)]; };
const programOf = (screen) => S.SCREENS.find((s) => s[0] === screen)?.[2] ?? "muxconfig";
const programName = (p) => S.PROGRAMS.find((x) => x[0] === p)?.[1] || p;
const deviceRes = () => D.host?.data()?.device?.res || model().screen.join("x");
const reachable = () => !!D.host?.data()?.reachable && !!D.host?.data()?.device;
const fileUrl = (rel) => `/api/designer/file?${qs({ name: D.model.name, path: rel, v: Math.round(D.files.get(rel)?.mtime || 0), token: TOKEN })}`;
const hasScheme = (file) => !!D.model?.schemes[file];

// ---------------------------------------------------------------- entry points used by themes.js

/** Renders the designer into the Themes tab body; entering reloads the list (the themes folder may have moved). */
export function showDesigner(root, host, entering = false) {
  D.host = host;
  if (!root.querySelector("#dz")) {
    root.innerHTML = `<div class="dz" id="dz"><div class="dz-top" id="dz-top"></div><div id="dz-body" class="dz-body"></div></div>`;
    bind(root.querySelector("#dz"));
    renderAll();
  } else {
    renderTop();
    if (D.list && (D.form || !D.list.themes.length)) renderBody();
  }
  if ((!D.list || entering) && !D.loading) loadList();
}

export const designerCount = () => D.list?.themes.length ?? null;

export function reloadDesigner() {
  if (!D.loading) loadList();
}

/** Saves edits still waiting for their autosave, before the tab or section changes. */
export function flushDesigner() {
  return flush();
}

// ---------------------------------------------------------------- loading

async function loadList(select = "") {
  D.loading = true;
  renderTop();
  try {
    setList(await api("designer"));
    D.error = "";
  } catch (error) {
    D.error = error.message;
  }
  D.loading = false;
  const names = D.list?.themes.map((t) => t.name) || [];
  if (select) D.name = select;
  if (!names.includes(D.name)) D.name = names[0] || "";
  store.set("designerTheme", D.name);
  if (D.name && D.model?.name !== D.name) await openTheme(D.name);
  else {
    if (!D.name) D.model = null;
    renderAll();
  }
}

function setList(r) {
  D.list = { folder: r.folder, available: r.available, themes: r.themes, defaultVersion: r.defaultVersion };
  D.host?.counts();
}

async function openTheme(name) {
  await flush();
  D.name = name;
  store.set("designerTheme", name);
  D.model = null;
  D.undo = [];
  D.redo = [];
  D.form = null;
  renderAll();
  try {
    setModel(await api(`designer/theme?${qs({ name })}`));
  } catch (error) {
    toast(error.message, 5000);
  }
  renderAll();
}

async function reloadModel() {
  if (!D.model) return;
  setModel(await api(`designer/theme?${qs({ name: D.model.name })}`));
}

function setModel(m) {
  const old = D.model;
  const fresh = old?.name !== m.name;
  if (!fresh) for (const file of D.pending.keys()) if (old.schemes[file]) m.schemes[file] = old.schemes[file];
  D.model = m;
  D.files = new Map(m.files.map((f) => [f.path, f]));
  if (fresh) {
    const dev = deviceRes();
    D.res = m.res.includes(dev) ? dev : m.res[0] || dev;
    D.variant = m.active || "";
    D.layer = [GLOBAL, `${D.res}/scheme/global.ini`, `${D.res}/scheme/default.ini`, "scheme/default.ini"].find((f) => m.schemes[f]) || GLOBAL;
    const sized = m.files.filter((f) => /^\d+x\d+\/(image|glyph|font)\//.test(f.path)).length;
    const shared = m.files.filter((f) => /^(image|glyph|font)\//.test(f.path)).length;
    D.imgScope = sized > shared ? "res" : "all";
  }
  if (m.res.length && !m.res.includes(D.res)) D.res = m.res[0];
  if (D.variant && !m.variants.includes(D.variant)) D.variant = "";
  if (D.layer.startsWith("alternate/") && !m.schemes[D.layer]) D.layer = GLOBAL;
  const summary = D.list?.themes.find((t) => t.name === m.name);
  if (summary) Object.assign(summary, { title: m.title, version: m.version, res: m.res, variants: m.variants, preview: m.preview });
}

// ---------------------------------------------------------------- the scheme cascade

/** The scheme files MustardOS reads for one screen, in order: global, default and the screen's own (each from the size folder
 * when there, otherwise the theme root), then the colour variant if any of those exist. extra counts as existing. */
function cascade(res, program, variant, extra = "") {
  const has = (f) => f === extra || hasScheme(f);
  const out = [];
  for (const n of ["global", "default", program].filter(Boolean)) {
    const sized = `${res}/scheme/${n}.ini`, root = `scheme/${n}.ini`;
    if (has(sized)) out.push(sized);
    else if (has(root)) out.push(root);
  }
  const alt = `alternate/${variant}.ini`;
  if (out.length && variant && has(alt)) out.push(alt);
  return out;
}

function typed(f, raw, w, h) {
  if (!f) return raw ?? 0;
  const [, key, type, def, min, max] = f;
  const fallback = def === null ? S.dynamicDefault(key, w, h) : def;
  if (raw === undefined || raw === "") return fallback;
  if (type === "s") return raw;
  if (type === "h") {
    const m = String(raw).replace(/^(#|0x)/i, "").match(/^[0-9a-f]{1,6}/i);
    return m ? m[0].toUpperCase().padStart(6, "0") : fallback;
  }
  let n = type === "f" ? parseFloat(raw) : parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  if (min != null && n < min) n = min;
  if (max != null && n > max) n = max;
  return n;
}

/** Values as one screen sees them, with the file each comes from. */
function resolve(res = D.res, program = programOf(D.screen), variant = D.variant) {
  const [w, h] = res.split("x").map(Number);
  const files = cascade(res, program, variant);
  const vals = new Map(), from = new Map();
  for (const file of files) {
    for (const [sec, keys] of Object.entries(D.model.schemes[file] || {})) {
      for (const [k, v] of Object.entries(keys)) { vals.set(`${sec}.${k}`, v); from.set(`${sec}.${k}`, file); }
    }
  }
  return { w, h, files, from: (k) => from.get(k) || "", get: (sec, key) => typed(FIELD.get(`${sec}.${key}`), vals.get(`${sec}.${key}`), w, h) };
}

function layerLabel(file) {
  if (!file) return "MustardOS";
  if (file === GLOBAL) return "Whole theme";
  let m = file.match(/^(?:(\d+x\d+)\/)?scheme\/([\w]+)\.ini$/);
  if (m) {
    const what = m[2] === "global" ? "Whole theme" : m[2] === "default" ? "Every screen" : programName(m[2]);
    return m[1] ? `${what} at ${m[1]}` : m[2] === "default" ? "Every screen (default.ini)" : what;
  }
  m = file.match(/^alternate\/(.+)\.ini$/);
  return m ? `Variant ${m[1]}` : file;
}

const layerValue = (k) => { const [sec, key] = split(k); return D.model.schemes[D.layer]?.[sec]?.[key]; };
const isSet = (k) => layerValue(k) !== undefined;

/** Whether the layer being edited is read for the screen in the preview (counting it as existing once it is edited). */
function layerApplies() {
  return cascade(D.res, programOf(D.screen), D.variant || layerVariant(), D.layer).includes(D.layer);
}
const layerVariant = () => D.layer.match(/^alternate\/(.+)\.ini$/)?.[1] || "";

// ---------------------------------------------------------------- editing and saving

function write(file, k, value) {
  const [sec, key] = split(k);
  const s = (D.model.schemes[file] ||= {});
  if (value === undefined) {
    if (s[sec]) { delete s[sec][key]; if (!Object.keys(s[sec]).length) delete s[sec]; }
    if (!Object.keys(s).length && !file.startsWith("alternate/")) delete D.model.schemes[file];
  } else (s[sec] ||= {})[key] = value;
}

/** Applies changes [{file, k, value}] (value undefined removes the setting) as one undo step; merge joins quick repeats. */
function change(list, merge = "") {
  const done = [];
  for (const c of list) {
    const [sec, key] = split(c.k);
    const before = D.model.schemes[c.file]?.[sec]?.[key];
    const after = c.value === undefined || c.value === null ? undefined : String(c.value);
    if (before === after) continue;
    write(c.file, c.k, after);
    done.push({ file: c.file, k: c.k, before, after });
  }
  if (!done.length) return;
  const last = D.undo.at(-1);
  if (merge && last?.merge === merge && Date.now() - last.at < 1500) {
    for (const d of done) {
      const m = last.changes.find((x) => x.file === d.file && x.k === d.k);
      if (m) m.after = d.after; else last.changes.push(d);
    }
    last.at = Date.now();
  } else {
    D.undo.push({ changes: done, at: Date.now(), merge });
    if (D.undo.length > 300) D.undo.shift();
  }
  D.redo = [];
  new Set(done.map((d) => d.file)).forEach(queueSave);
  for (const d of done) if (d.file === D.layer) refreshRow(d.k);
  undoButtons();
  redraw();
}

function step(from, to, side) {
  const entry = from.pop();
  if (!entry) return;
  for (const c of side === "before" ? [...entry.changes].reverse() : entry.changes) write(c.file, c.k, c[side]);
  entry.merge = "";
  to.push(entry);
  new Set(entry.changes.map((c) => c.file)).forEach(queueSave);
  renderEditor();
  redraw();
}
const undo = () => step(D.undo, D.redo, "before");
const redo = () => step(D.redo, D.undo, "after");

function queueSave(file) {
  clearTimeout(D.pending.get(file));
  D.pending.set(file, setTimeout(() => saveNow(file), 400));
  status();
}

function saveNow(file) {
  clearTimeout(D.pending.get(file));
  D.pending.delete(file);
  const name = D.model.name, scheme = structuredClone(D.model.schemes[file] || {});
  D.saving++;
  status();
  D.chain = D.chain.then(async () => {
    try {
      await api("designer/scheme", { name, file, scheme });
      D.failed.delete(file);
    } catch (error) {
      D.failed.set(file, error.message);
      toast(`Not saved: ${error.message}`, 6000);
    }
    D.saveError = [...D.failed.values()][0] || "";
    D.saving--;
    status();
  });
  return D.chain;
}

async function flush() {
  if (!D.model) return;
  [...new Set([...D.failed.keys(), ...D.pending.keys()])].forEach(saveNow);
  do {
    [...D.pending.keys()].forEach(saveNow);
    await D.chain;
  } while (D.pending.size || D.saving);
  if (D.failed.size) throw new Error("Theme changes are not saved. Use Retry before switching, exporting or installing.");
}

addEventListener("beforeunload", (e) => {
  if (D.pending.size || D.saving || D.failed.size) e.preventDefault();
});

addEventListener("pagehide", () => {
  if (!D.model) return;
  for (const file of new Set([...D.failed.keys(), ...D.pending.keys()])) {
    fetch("/api/designer/scheme", {
      method: "POST", keepalive: true, headers: { "X-Manager-Token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ name: D.model.name, file, scheme: D.model.schemes[file] || {} }),
    }).catch(() => {});
  }
});

function status() {
  const el = $("dz-status");
  if (!el) return;
  const waiting = D.saving || D.pending.size;
  el.className = `dz-status${D.saveError && !waiting ? " err" : ""}`;
  el.innerHTML = !D.model ? "" : waiting ? `${ICONS.spin} Saving&hellip;` : D.saveError ? `${icon("alert")} Not saved <button class="btn small" data-dz="retry">Retry</button>` : `${icon("check")} Saved in the themes folder`;
}

// ---------------------------------------------------------------- the preview

const IMAGES = new Map();
const FACES = new Map();

function picture(paths, want) {
  for (const p of paths) {
    if (!D.files.has(p)) continue;
    const url = fileUrl(p);
    let e = IMAGES.get(url);
    if (!e) {
      const img = new Image();
      e = { img, state: "loading" };
      e.promise = new Promise((done) => {
        img.onload = () => { e.state = "ok"; done(); redraw(); };
        img.onerror = () => { e.state = "error"; done(); redraw(); };
      });
      img.src = url;
      IMAGES.set(url, e);
    }
    if (e.state === "ok") return e.img;
    if (e.state === "loading") { want?.push(e.promise); return null; }
  }
  return null;
}

const FONT_KIND = { list: ["font/panel/default.bin", "font/default.bin"], header: ["font/header/default.bin", "font/default.bin"], footer: ["font/footer/default.bin", "font/default.bin"], panel: ["font/default.bin"] };

function fontSlot(res, kind) {
  for (const n of FONT_KIND[kind] || FONT_KIND.panel) for (const p of [`${res}/${n}`, n]) if (D.files.has(p)) return p;
  return "";
}

function family(res, kind, want) {
  const src = D.model.fonts?.[fontSlot(res, kind)]?.source;
  if (!src || !D.files.has(src)) return BASE_FONT;
  const url = fileUrl(src);
  let e = FACES.get(url);
  if (!e) {
    e = { family: `dz-font-${FACES.size}`, state: "loading" };
    e.promise = new FontFace(e.family, `url("${url}")`).load()
      .then((face) => { document.fonts.add(face); e.state = "ok"; redraw(); })
      .catch(() => { e.state = "error"; });
    FACES.set(url, e);
  }
  if (e.state === "loading") want?.push(e.promise);
  return e.state === "ok" ? `"${e.family}", ${BASE_FONT}` : BASE_FONT;
}

/** Draws a screen of the theme; returns the pictures and fonts still loading. */
function paint(canvas, res, screen, regions) {
  const want = [];
  const R = resolve(res, programOf(screen), D.variant);
  drawScreen(canvas, {
    w: R.w, h: R.h, screen, program: programOf(screen), get: R.get, regions,
    image: (paths) => picture(paths, want), font: (kind) => family(res, kind, want), size: (kind) => D.model.fonts?.[fontSlot(res, kind)]?.size || 0,
  });
  return want;
}

function redraw() {
  if (D.frame) return;
  D.frame = requestAnimationFrame(() => {
    D.frame = 0;
    const canvas = $("dz-canvas");
    if (canvas && D.model) paint(canvas, D.res, D.screen, D.regions);
  });
}

async function shot(res, screen) {
  const canvas = document.createElement("canvas");
  const want = paint(canvas, res, screen, []);
  if (want.length) {
    await Promise.allSettled(want);
    await document.fonts.ready;
    paint(canvas, res, screen, []);
  }
  return new Promise((done) => canvas.toBlob(done, "image/png"));
}

async function putFile(url, body) {
  const res = await fetch(url, { method: "PUT", headers: { "X-Manager-Token": TOKEN, "Content-Type": "application/octet-stream" }, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** Draws the theme's preview pictures (main menu, Explore and Configuration) for each size missing one, or for one size. */
async function makePreviews(onlyRes = "") {
  const sizes = onlyRes ? [onlyRes] : D.model.res.filter((r) => !D.files.has(`${r}/preview.png`));
  for (const r of sizes) {
    for (const [file, screen] of [["preview.png", "muxlaunch"], ["preview.0.png", "muxplore"], ["preview.1.png", "muxconfig"]]) {
      await putFile(`/api/designer/upload?${qs({ name: D.model.name, path: `${r}/${file}` })}`, await shot(r, screen));
    }
  }
  if (sizes.length) await reloadModel();
  return sizes.length;
}

// ---------------------------------------------------------------- rendering

function renderAll() {
  renderTop();
  renderBody();
}

function renderTop() {
  const top = $("dz-top");
  if (!top) return;
  const list = D.list?.themes || [];
  const m = D.model, dis = !m || D.busy ? " disabled" : "";
  const canInstall = reachable();
  const why = canInstall ? "" : " title=\"Needs the handheld over Wi-Fi with SSH on\"";
  top.innerHTML = `
    <label class="dz-pick">${icon("palette")}<select class="control" data-dz-theme aria-label="Theme to edit"${D.busy ? " disabled" : ""}>
      ${list.length ? list.map((t) => `<option value="${esc(t.name)}"${t.name === D.name ? " selected" : ""}>${esc(t.name)}</option>`).join("") : `<option value="">No themes yet</option>`}
    </select></label>
    <span id="dz-status" class="dz-status"></span>
    <span class="grow"></span>
    <button class="btn small" data-dz="new"${D.busy ? " disabled" : ""}>${icon("plus")}<span>New theme</span></button>
    <button class="btn small ghost" data-dz="import" title="Add a .muxthm or theme zip from this computer"${D.busy ? " disabled" : ""}>${icon("upload")}<span>Import</span></button>
    <input type="file" id="dz-import" accept=".muxthm,.zip" hidden>
    ${m ? `<span class="dz-sep"></span>
    <button class="btn small ghost" data-dz="export" title="Save the theme as a .muxthm file to share or copy to the SD card"${dis}>${icon("download")}<span>Export</span></button>
    <button class="btn small" data-dz="install"${canInstall ? " title=\"Copy it to the handheld without changing the active theme\"" : why}${dis || (canInstall ? "" : " disabled")}>${icon("upload")}<span>Install</span></button>
    <button class="btn small primary" data-dz="install" data-apply="1"${canInstall ? " title=\"Copy it to the handheld and make it the active theme\"" : why}${dis || (canInstall ? "" : " disabled")}>${D.busy ? ICONS.spin : icon("check")}<span>${D.busy ? esc(D.busy) : "Install and apply"}</span></button>
    <details class="dz-menu"><summary class="btn small ghost" aria-label="More">&hellip;</summary><div class="dz-menu-list">
      <button data-dz="duplicate"${dis}>${icon("copy")} Duplicate</button>
      <button data-dz="rename"${dis}>${icon("pencil")} Rename</button>
      <button data-dz="reveal">${icon("folder")} Show in the themes folder</button>
      <button data-dz="trash" class="danger"${dis}>${icon("trash")} Move to the Trash</button>
    </div></details>` : `<button class="btn small ghost" data-dz="reveal" title="Open the themes folder">${icon("folder")}<span>Themes folder</span></button>`}`;
  status();
}

function renderBody() {
  const body = $("dz-body");
  if (!body) return;
  if (D.error && !D.list) return void (body.innerHTML = `<div class="notice err">${esc(D.error)}</div>`);
  if (!D.list) return void (body.innerHTML = `<div class="planning"><span class="spinner"></span> Loading your themes&hellip;</div>`);
  if (D.form || !D.list.themes.length) return void (body.innerHTML = newThemeView());
  if (!D.model) return void (body.innerHTML = `<div class="planning"><span class="spinner"></span> Opening ${esc(D.name)}&hellip;</div>`);
  body.innerHTML = `<div class="dz-work">
      <nav class="dz-nav" id="dz-nav" aria-label="Theme parts"></nav>
      <section class="dz-edit panel" id="dz-edit"></section>
      <aside class="dz-view panel" id="dz-view"></aside>
    </div>`;
  renderNav();
  renderEditor();
  renderView();
}

function renderNav() {
  const nav = $("dz-nav");
  if (!nav) return;
  const item = ([id, label, ico]) => `<button data-dz-panel="${id}" class="${id === D.panel && !D.q ? "on" : ""}" aria-current="${id === D.panel && !D.q}">${icon(ico)}<span>${label}</span>${count(id)}</button>`;
  nav.innerHTML = `<label class="search small">${icon("search")}<input type="search" data-dz-q placeholder="Find a setting" value="${esc(D.q)}" aria-label="Find a setting"></label>
    <h4>Style</h4>${STYLE_PANELS.map(item).join("")}
    <h4>Files</h4>${FILE_PANELS.map(item).join("")}
    <h4>Theme</h4>${THEME_PANELS.map(item).join("")}`;
}

/** A small count of settings the edited layer sets in a group, so customised parts stand out. */
function count(id) {
  const parts = PARTS.get(id);
  if (!parts || !D.model) return "";
  let n = 0;
  for (const p of parts) for (const f of p.fields) if (isSet(`${f[0]}.${f[1]}`)) n++;
  return n ? `<em class="tab-count">${n}</em>` : "";
}

function layerOptions() {
  const s = D.model.schemes, res = D.res;
  const opt = (file, label) => `<option value="${esc(file)}"${file === D.layer ? " selected" : ""}>${s[file] ? "&#9679; " : ""}${esc(label)}</option>`;
  const whole = [opt(GLOBAL, "Whole theme (every screen, every size)")];
  if (s["scheme/default.ini"] || D.layer === "scheme/default.ini") whole.push(opt("scheme/default.ini", "Every screen (default.ini)"));
  const sizes = D.model.res.map((r) => opt(`${r}/scheme/default.ini`, `Every screen at ${r}`));
  for (const r of D.model.res) if (s[`${r}/scheme/global.ini`]) sizes.push(opt(`${r}/scheme/global.ini`, `Whole theme at ${r} (global.ini)`));
  const screens = S.PROGRAMS.map(([p, label]) => opt(`${res}/scheme/${p}.ini`, `${label} at ${res}`));
  const roots = Object.keys(s).filter((f) => /^scheme\/\w+\.ini$/.test(f) && f !== GLOBAL && f !== "scheme/default.ini").map((f) => opt(f, `${layerLabel(f)} (every size)`));
  const others = Object.keys(s).filter((f) => /^\d+x\d+\/scheme\//.test(f) && !f.startsWith(`${res}/`) && !/\/(default|global)\.ini$/.test(f)).map((f) => opt(f, layerLabel(f)));
  const variants = D.model.variants.map((v) => opt(`alternate/${v}.ini`, `Variant ${v}`));
  return `<optgroup label="Everywhere">${whole.join("")}</optgroup>
    <optgroup label="One screen size">${sizes.join("")}</optgroup>
    <optgroup label="One screen">${screens.join("")}${roots.join("")}${others.join("")}</optgroup>
    ${variants.length ? `<optgroup label="Colour variants">${variants.join("")}</optgroup>` : ""}`;
}

function layerNotice() {
  if (D.panel === "quick" && !D.q) return "";
  const notes = [];
  const sized = D.layer.match(/^(\d+x\d+)\/scheme\/(\w+)\.ini$/);
  if (sized && !hasScheme(D.layer) && hasScheme(`scheme/${sized[2]}.ini`)) {
    notes.push(`<div class="notice small">At ${sized[1]} the handheld reads this file <b>instead of</b> scheme/${sized[2]}.ini once it exists, so the settings from that file stop applying at this size.
      <button class="btn small" data-dz="copy-layer">Start from its settings</button></div>`);
  }
  const v = layerVariant();
  if (v && D.variant !== v) notes.push(`<div class="notice small">You are editing the colour variant ${esc(v)}. <button class="btn small" data-dz="show-variant" data-v="${esc(v)}">Preview it</button></div>`);
  else if (!layerApplies()) {
    const p = D.layer.match(/scheme\/(\w+)\.ini$/)?.[1];
    const screen = S.SCREENS.find((x) => x[2] === p);
    notes.push(`<div class="notice small">These settings do not apply to the screen in the preview.${screen ? ` <button class="btn small" data-dz="screen" data-screen="${screen[0]}">Show ${esc(screen[1])}</button>` : ""}</div>`);
  }
  return notes.join("");
}

function renderEditor() {
  const ed = $("dz-edit");
  if (!ed || !D.model) return;
  const asset = !D.q && [...FILE_PANELS, ...THEME_PANELS].some((p) => p[0] === D.panel);
  const label = D.q ? `Settings matching "${esc(D.q)}"` : ALL_PANELS.find((p) => p[0] === D.panel)?.[1] || "";
  const scroll = ed.querySelector(".dz-fields")?.scrollTop || 0;
  const same = ed.dataset.panel === `${D.panel}|${D.q}`;
  ed.dataset.panel = `${D.panel}|${D.q}`;
  ed.innerHTML = `<header class="dz-edit-head">
      <h3>${label}</h3>
      ${asset ? "" : `<label class="dz-layer" title="Which scheme file your changes go to. Specific files win over general ones.">
        <span>Changes go to</span><select class="control" data-dz-layer>${layerOptions()}</select></label>
      <span class="dz-undo"><button class="btn small ghost icon-only" data-dz="undo" title="Undo (Ctrl+Z)" aria-label="Undo"${D.undo.length ? "" : " disabled"}>${icon("restore")}</button><button class="btn small ghost icon-only dz-flip" data-dz="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo"${D.redo.length ? "" : " disabled"}>${icon("restore")}</button></span>`}
    </header>
    ${asset ? "" : layerNotice()}
    <div class="dz-fields">${asset ? assetPanel(D.panel, H) : D.q ? searchView() : D.panel === "quick" ? quickView() : groupView(D.panel)}</div>`;
  if (same) ed.querySelector(".dz-fields").scrollTop = scroll;
}

function undoButtons() {
  const ed = $("dz-edit");
  if (!ed) return;
  const u = ed.querySelector('[data-dz="undo"]'), r = ed.querySelector('[data-dz="redo"]');
  if (u) u.disabled = !D.undo.length;
  if (r) r.disabled = !D.redo.length;
}

// ---------------------------------------------------------------- setting rows

/** Values for the editor: the preview screen's resolved values, with the edited layer's own values on top when the
 * layer is not one the preview reads. */
function editorValues() {
  const R = resolve();
  if (layerApplies() && cascade(D.res, programOf(D.screen), D.variant).includes(D.layer)) return R;
  const own = D.model.schemes[D.layer] || {};
  return { ...R, get: (sec, key) => (own[sec]?.[key] !== undefined ? typed(FIELD.get(`${sec}.${key}`), own[sec][key], R.w, R.h) : R.get(sec, key)), from: (k) => (isSet(k) ? D.layer : R.from(k)) };
}

function hintFor(sec, key) {
  if (HINT_SECTION[key] && HINT_SECTION[key] !== sec) return "";
  return S.HINTS[key] || "";
}

function bounds(f, R) {
  const [, key, type, , min, max] = f;
  if (min != null && max != null) return [min, max];
  if (/_GRADIENT_(START|STOP)$/.test(key)) return [0, 255];
  if (/RADIUS/.test(key)) return [0, 60];
  if (/(^|_)(HEIGHT|Y_POS)$|_Y$|LOCATION_Y/.test(key)) return [min ?? 0, R.h];
  if (/(^|_)WIDTH$|LOCATION_X/.test(key)) return [min ?? 0, R.w];
  if (/BORDER_WIDTH|SHADOW_WIDTH/.test(key)) return [0, 20];
  if (/OFFSET|PAD|PADDING|SPACING/.test(key)) return [min ?? -60, 120];
  if (/_COUNT$/.test(key)) return [min ?? 0, 16];
  if (/^FONT_\w+_SIZE$|^(LIST|HEADER|FOOTER|GRID)$/.test(key)) return [0, 96];
  if (type === "f") return null;
  return null;
}

function srcNote(k, R) {
  const from = R.from(k);
  if (isSet(k)) return from && from !== D.layer ? `<span class="warn">Hidden by ${esc(layerLabel(from))}</span>` : "";
  return `from ${esc(layerLabel(from))}`;
}

function rowHtml(f, R) {
  const [sec, key, type] = f;
  const k = `${sec}.${key}`;
  const ak = type === "h" && FIELD.has(`${sec}.${S.alphaOf(key)}`) ? `${sec}.${S.alphaOf(key)}` : "";
  const keys = ak ? `${k} ${ak}` : k;
  const set = isSet(k) || (ak && isSet(ak));
  const v = R.get(sec, key);
  const hint = hintFor(sec, key);
  const choices = S.choicesFor(sec, key);
  let ctl;
  if (type === "h") ctl = colourCtl(k, v) + (ak ? alphaCtl(ak, R.get(...split(ak))) : "");
  else if (S.isSides(key)) ctl = `<span class="dz-sides" role="group" aria-label="Sides">${S.SIDES.map(([bit, label]) => `<button class="${v & bit ? "on" : ""}" aria-pressed="${!!(v & bit)}" data-side="${bit}" data-k="${k}">${label}</button>`).join("")}</span>`;
  else if (choices) {
    const known = choices.some(([n]) => n === v);
    ctl = `<select class="control" data-k="${k}" data-t="num">${known ? "" : `<option value="${esc(v)}" selected>${esc(v)}</option>`}${choices.map(([n, l]) => `<option value="${n}"${n === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  } else if (S.isAlpha(key)) ctl = alphaCtl(k, v);
  else if (type === "s") ctl = `<input class="control dz-text" data-k="${k}" data-t="text" value="${esc(v)}" aria-label="${esc(S.labelFor(sec, key))}">`;
  else {
    const b = bounds(f, R);
    ctl = `${b ? `<input type="range" min="${b[0]}" max="${b[1]}" step="1" value="${esc(v)}" data-k="${k}" data-t="num" aria-label="${esc(S.labelFor(sec, key))}">` : ""}
      <input type="number" class="control dz-num" ${f[4] != null ? `min="${f[4]}"` : ""} ${f[5] != null ? `max="${f[5]}"` : ""} step="${type === "f" ? "0.1" : "1"}" value="${esc(v)}" data-k="${k}" data-t="num" aria-label="${esc(S.labelFor(sec, key))}">`;
  }
  return `<div class="dz-row${set ? " set" : ""}" data-keys="${keys}">
      <div class="dz-lab"><span>${esc(S.labelFor(sec, key))}</span>${hint ? `<small>${esc(hint)}</small>` : ""}
        <code title="[${sec}] in the scheme file">${key}${ak ? ` + ${split(ak)[1]}` : ""}</code></div>
      <div class="dz-ctl">${ctl}</div>
      <div class="dz-src">${srcNote(k, R)}</div>
      <button class="dz-reset" data-reset="${keys}" title="Remove from this file and use the value from further up" aria-label="Reset">${icon("eraser")}</button>
    </div>`;
}

const colourCtl = (k, v) => `<span class="dz-colour"><input type="color" value="#${v}" data-k="${k}" data-t="colour" aria-label="Colour">
  <input class="control dz-hex" value="${v}" maxlength="7" spellcheck="false" data-k="${k}" data-t="hex" aria-label="Hex colour"></span>`;

const alphaCtl = (k, v) => `<span class="dz-alpha" title="Opacity"><input type="range" min="0" max="255" value="${v}" data-k="${k}" data-t="alpha" aria-label="Opacity">
  <output>${Math.round((v / 255) * 100)}%</output></span>`;

function refreshRow(k) {
  const row = document.querySelector(`#dz-edit .dz-row[data-keys~="${CSS.escape(k)}"]`);
  if (!row) return;
  const keys = row.dataset.keys.split(" ");
  row.classList.toggle("set", keys.some(isSet));
  row.querySelector(".dz-src").innerHTML = srcNote(keys[0], editorValues());
  const nav = document.querySelector(`#dz-nav [data-dz-panel="${D.panel}"]`);
  if (nav) { nav.querySelector(".tab-count")?.remove(); nav.insertAdjacentHTML("beforeend", count(D.panel)); }
}

function groupView(id) {
  const R = editorValues();
  return (PARTS.get(id) || []).filter((p) => p.fields.length).map((p) => {
    const rows = p.fields.filter((f) => !PAIRED.has(`${f[0]}.${f[1]}`));
    return rows.length ? `<section class="dz-part"><h4>${esc(p.heading)}</h4>${rows.map((f) => rowHtml(f, R)).join("")}</section>` : "";
  }).join("") || `<div class="empty-state">${icon("info")}<b>Nothing to set here</b></div>`;
}

function searchView() {
  const R = editorValues();
  const words = D.q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  let total = 0;
  for (const [id, label] of S.GROUPS.map((g) => [g[0], g[1]])) {
    for (const p of PARTS.get(id)) {
      const rows = [];
      for (const f of p.fields) {
        if (PAIRED.has(`${f[0]}.${f[1]}`)) continue;
        const text = `${label} ${p.heading} ${S.labelFor(f[0], f[1])} ${f[1]} ${f[0]} ${hintFor(f[0], f[1])}`.toLowerCase();
        if (words.every((w) => text.includes(w)) && total < 150) { rows.push(rowHtml(f, R)); total++; }
      }
      if (rows.length) out.push(`<section class="dz-part"><h4>${esc(label)} &rsaquo; ${esc(p.heading)}</h4>${rows.join("")}</section>`);
    }
  }
  return out.join("") || `<div class="empty-state">${icon("search")}<b>No setting matches</b><p>Try a word like border, shadow, clock or footer.</p></div>`;
}

// ---------------------------------------------------------------- quick style

const quickTarget = () => (D.layer.startsWith("alternate/") ? D.layer : GLOBAL);
const ROLES = ["bg", "bar", "accent", "text", "onAccent", "muted"];

function quickView() {
  const R = resolve();
  const target = quickTarget();
  const grid = R.get("grid", "COLUMN_COUNT") > 0 && R.get("grid", "ROW_COUNT") > 0;
  const roleValue = (keys) => R.get(...keys[0]);
  const hidden = quickHidden(R, target);
  return `<p class="muted-note">Quick style changes many settings at once and saves them to <b>${esc(layerLabel(target))}</b>. Fine-tune any part afterwards in the groups on the left, or click the preview.</p>
    ${hidden ? `<div class="notice small">${plural(hidden, "setting")} in more specific files ${hidden === 1 ? "wins" : "win"} over Quick style on this screen.
      <button class="btn small" data-dz="quick-free">Let Quick style decide them</button></div>` : ""}
    <section class="dz-part"><h4>Palettes</h4><div class="dz-palettes">${S.PALETTES.map(([name, ...cols], i) => `<button class="dz-palette" data-palette="${i}" title="Use the ${name} colours">
      <span class="dz-swatches">${cols.map((c) => `<i style="background:#${c}"></i>`).join("")}</span><b>${name}</b></button>`).join("")}</div></section>
    <section class="dz-part"><h4>Colours</h4>${S.QUICK.map(([id, label, hint, keys]) => `<div class="dz-row">
      <div class="dz-lab"><span>${esc(label)}</span><small>${esc(hint)}</small></div>
      <div class="dz-ctl"><span class="dz-colour"><input type="color" value="#${roleValue(keys)}" data-q="${id}" aria-label="${esc(label)}">
        <input class="control dz-hex" value="${roleValue(keys)}" maxlength="7" spellcheck="false" data-q="${id}" data-t="hex" aria-label="${esc(label)} hex"></span></div>
      <div class="dz-src">${keys.length} settings</div></div>`).join("")}</section>
    <section class="dz-part"><h4>Shape and size</h4>${S.QUICK_SIZES.map(([id, label, min, max, keys]) => {
      const v = R.get(...keys[0]);
      return `<div class="dz-row"><div class="dz-lab"><span>${esc(label)}</span></div>
        <div class="dz-ctl"><input type="range" min="${min}" max="${max}" value="${v}" data-qs="${id}" aria-label="${esc(label)}"><output>${v}</output></div><div class="dz-src"></div></div>`;
    }).join("")}</section>
    <section class="dz-part"><h4>Main menu</h4><div class="dz-row"><div class="dz-lab"><span>Layout</span><small>A list of names, or a grid of pictures like a console's home screen. The grid uses the main menu icons; add bigger ones under Icons.</small></div>
      <div class="dz-ctl"><span class="dz-seg" role="group" aria-label="Main menu layout">
        <button data-dz="menu" data-style="list" class="${grid ? "" : "on"}" aria-pressed="${!grid}">${icon("list")} List</button>
        <button data-dz="menu" data-style="grid" class="${grid ? "on" : ""}" aria-pressed="${grid}">${icon("grid")} Grid</button></span></div><div class="dz-src"></div></div></section>`;
}

function quickKeys() {
  return [...S.QUICK.flatMap((q) => q[3]), ...S.QUICK_SIZES.flatMap((q) => q[4])].map(([s, k]) => `${s}.${k}`);
}

/** Quick style settings that a file read after the target sets, so they win on the preview screen. */
function quickOverrides(R, target) {
  const at = R.files.indexOf(target);
  return quickKeys().map((k) => [k, R.from(k)]).filter(([, f]) => f && f !== target && !f.startsWith("alternate/") && R.files.indexOf(f) > at);
}
const quickHidden = (R, target) => quickOverrides(R, target).length;

function quickFree() {
  change(quickOverrides(resolve(), quickTarget()).map(([k, file]) => ({ file, k, value: undefined })));
  renderEditor();
}

function applyRole(id, hex, merge = `q:${id}`) {
  const keys = S.QUICK.find((q) => q[0] === id)[3];
  change(keys.map(([s, k]) => ({ file: quickTarget(), k: `${s}.${k}`, value: hex })), merge);
}

function applyPalette(i) {
  const [, ...cols] = S.PALETTES[i];
  const target = quickTarget();
  change(ROLES.flatMap((id, n) => S.QUICK.find((q) => q[0] === id)[3].map(([s, k]) => ({ file: target, k: `${s}.${k}`, value: cols[n] }))));
  renderEditor();
}

function applySize(id, v) {
  const keys = S.QUICK_SIZES.find((q) => q[0] === id)[4];
  change(keys.map(([s, k]) => ({ file: quickTarget(), k: `${s}.${k}`, value: v })), `qs:${id}`);
}

function gridValues(res) {
  const [w, h] = res.split("x").map(Number);
  const top = 44, ch = h - 88, cw = Math.floor(w / 4), rh = Math.floor(ch / 2);
  return {
    COLUMN_COUNT: 4, ROW_COUNT: 2, LOCATION_X: 0, LOCATION_Y: top, COLUMN_WIDTH: cw, ROW_HEIGHT: rh,
    CELL_WIDTH: cw - 16, CELL_HEIGHT: rh - 16, CELL_RADIUS: 12, CELL_BORDER_WIDTH: 0, CELL_DEFAULT_BACKGROUND_ALPHA: 40,
    CELL_FOCUS_BACKGROUND_ALPHA: 255, CELL_DEFAULT_TEXT_ALPHA: 255, CELL_FOCUS_TEXT_ALPHA: 255,
  };
}

function setMenuStyle(style) {
  const list = [];
  for (const r of D.model.res) {
    const file = `${r}/scheme/muxlaunch.ini`;
    for (const [key, v] of Object.entries(gridValues(r))) {
      if (!FIELD.has(`grid.${key}`)) continue;
      list.push({ file, k: `grid.${key}`, value: style === "grid" ? v : undefined });
    }
  }
  change(list);
  D.screen = "muxlaunch";
  renderEditor();
  renderView();
}

// ---------------------------------------------------------------- the preview panel

function renderView() {
  const v = $("dz-view");
  if (!v || !D.model) return;
  const sizes = D.model.res.length ? D.model.res : [D.res];
  v.innerHTML = `<div class="dz-view-head">
      <div class="dz-screens" role="tablist" aria-label="Screen">${S.SCREENS.map(([id, label]) => `<button role="tab" data-dz="screen" data-screen="${id}" class="${id === D.screen ? "on" : ""}" aria-selected="${id === D.screen}">${esc(label)}</button>`).join("")}</div>
      <div class="dz-view-opts">
        <select class="control" data-dz-res aria-label="Screen size">${sizes.map((r) => `<option value="${r}"${r === D.res ? " selected" : ""}>${r}${r === deviceRes() ? " (your handheld)" : ""}</option>`).join("")}</select>
        ${D.model.variants.length ? `<select class="control" data-dz-variant aria-label="Colour variant"><option value="">No variant</option>${D.model.variants.map((x) => `<option value="${esc(x)}"${x === D.variant ? " selected" : ""}>${esc(x)}${x === D.model.active ? " (starts with)" : ""}</option>`).join("")}</select>` : ""}
      </div>
    </div>
    <div class="dz-stage"><canvas id="dz-canvas" aria-label="Preview of the ${esc(S.SCREENS.find((s) => s[0] === D.screen)?.[1] || "")} screen" role="img"></canvas><div class="dz-hl" id="dz-hl" hidden></div></div>
    <p class="muted-note dz-view-foot">Click any part to open its settings. Fonts are close matches unless the theme keeps the TTF its fonts were made from (Fonts).
      <button class="btn small ghost" data-dz="previews" title="Draw preview.png, preview.0.png and preview.1.png for ${esc(D.res)}; the theme picker shows them">${icon("image")}<span>Make preview pictures</span></button></p>`;
  redraw();
}

function regionAt(e) {
  const canvas = $("dz-canvas");
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * canvas.width, y = ((e.clientY - r.top) / r.height) * canvas.height;
  for (let i = D.regions.length - 1; i >= 0; i--) {
    const g = D.regions[i];
    if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h) return g;
  }
  return null;
}

function hover(e) {
  const hl = $("dz-hl"), canvas = $("dz-canvas");
  const g = e && regionAt(e);
  if (!g) { hl.hidden = true; canvas.title = ""; return; }
  const r = canvas.getBoundingClientRect(), s = r.width / canvas.width;
  Object.assign(hl.style, { left: `${canvas.offsetLeft + g.x * s}px`, top: `${canvas.offsetTop + g.y * s}px`, width: `${g.w * s}px`, height: `${g.h * s}px` });
  hl.hidden = false;
  const label = g.group === "images" ? "Pictures" : ALL_PANELS.find((p) => p[0] === g.group)?.[1] || g.group;
  hl.dataset.label = label;
  canvas.title = `${label}: click to edit`;
}

function openPanel(id) {
  D.panel = id;
  D.q = "";
  store.set("designerPanel", id);
  const group = S.GROUPS.find((g) => g[0] === id);
  if (group && !D.regions.some((r) => r.group === id)) D.screen = group[3];
  renderNav();
  renderEditor();
  renderView();
}

function setLayer(file) {
  D.layer = file;
  const v = layerVariant();
  if (v) D.variant = v;
  const sized = file.match(/^(\d+x\d+)\//);
  if (sized && D.model.res.includes(sized[1])) D.res = sized[1];
  const p = file.match(/scheme\/(\w+)\.ini$/)?.[1];
  const screen = S.SCREENS.find((x) => x[2] === p && x[0] === p) || S.SCREENS.find((x) => x[2] === p);
  if (screen) D.screen = screen[0];
  renderNav();
  renderEditor();
  renderView();
}

function setRes(res) {
  const old = D.res;
  D.res = res;
  if (D.layer.startsWith(`${old}/`) && !/\/(default|global)\.ini$/.test(D.layer)) D.layer = res + D.layer.slice(old.length);
  renderEditor();
  renderView();
}

// ---------------------------------------------------------------- new themes

const suggest = (base = "My Theme") => {
  const names = new Set((D.list?.themes || []).map((t) => t.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
};

function startForm(from = "blank") {
  D.form = { from, name: suggest(), named: false, palette: 0, res: new Set([deviceRes()]), source: "", version: D.list?.defaultVersion || "2601.0", busy: false, file: null };
  renderBody();
}

function newThemeView() {
  const f = D.form || (D.form = { from: "blank", name: suggest(), named: false, palette: 0, res: new Set([deviceRes()]), source: "", version: D.list?.defaultVersion || "2601.0", busy: false, file: null, first: true });
  const data = D.host?.data();
  const cat = data?.catalogue?.themes || [];
  const dev = data?.device?.installed || [];
  const mine = D.list?.themes || [];
  const FROM = [
    ["blank", "wand", "Start fresh", "Pick a palette and screen sizes, then fine-tune"],
    ["catalogue", "web", "A library theme", `Remix one of ${cat.length || "the"} community themes`],
    ["device", "handheld", "From the handheld", reachable() ? `${plural(dev.length, "theme")} installed` : "Needs Wi-Fi and SSH"],
    ["copy", "copy", "Copy one of yours", mine.length ? plural(mine.length, "theme") : "None yet"],
    ["file", "upload", "Import a file", ".muxthm or theme zip"],
  ];
  const disabled = (id) => (id === "device" && !reachable()) || (id === "copy" && !mine.length) || (id === "catalogue" && !cat.length);
  const fit = (t) => t.res.includes(deviceRes());
  const sorted = [...cat].sort((a, b) => fit(b) - fit(a) || a.name.localeCompare(b.name));
  comboItems("dz-cat", sorted.map((t) => ({ value: t.name, sub: fit(t) || !t.res.length ? "" : `Made for ${t.res.join(", ")}` })));
  let source = "";
  if (f.from === "blank") {
    source = `<div class="dz-field"><span>Colours</span><div class="dz-palettes">${S.PALETTES.map(([name, ...cols], i) => `<button class="dz-palette${i === f.palette ? " on" : ""}" data-form-palette="${i}" aria-pressed="${i === f.palette}">
        <span class="dz-swatches">${cols.map((c) => `<i style="background:#${c}"></i>`).join("")}</span><b>${name}</b></button>`).join("")}</div></div>
      <div class="dz-field"><span>Screen sizes</span><div class="dz-checks">${S.RESOLUTIONS.map((r) => `<label class="check"><input type="checkbox" data-form-res="${r}"${f.res.has(r) ? " checked" : ""}> ${r}${r === deviceRes() ? " <em>your handheld</em>" : ""}</label>`).join("")}</div></div>`;
  } else if (f.from === "catalogue") {
    source = `<label class="dz-field"><span>Theme</span><input class="control" data-combo="dz-cat" data-form="source" value="${esc(f.source)}" placeholder="Type to search ${cat.length} themes" autocomplete="off" role="combobox" aria-haspopup="listbox" aria-expanded="false"></label>
      ${cat.some((t) => t.name === f.source) ? `<img class="dz-src-shot" src="/api/themes/preview?${qs({ name: f.source, res: deviceRes(), kind: "png", token: TOKEN })}" alt="">` : ""}`;
  } else if (f.from === "device") {
    source = `<label class="dz-field"><span>Theme on the handheld</span><select class="control" data-form="source"><option value="">Pick one</option>${dev.map((t) => `<option value="${esc(t.name)}"${t.name === f.source ? " selected" : ""}>${esc(t.name)} (${human(t.kb * 1024)})</option>`).join("")}</select></label>`;
  } else if (f.from === "copy") {
    source = `<label class="dz-field"><span>Your theme</span><select class="control" data-form="source"><option value="">Pick one</option>${mine.map((t) => `<option value="${esc(t.name)}"${t.name === f.source ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>`;
  } else {
    source = `<label class="dz-field"><span>File</span><input type="file" class="control" accept=".muxthm,.zip" data-form="file"></label>`;
  }
  return `<section class="panel dz-new">
    ${mine.length ? "" : `<div class="dz-hero">${icon("palette")}<div><h2>Design your own MustardOS theme</h2>
      <p>Colours, layout, pictures, icons, fonts and sounds, with a live preview of the handheld's screens. Themes are kept in the themes folder${D.list?.folder ? ` (<code>${esc(D.list.folder)}</code>)` : ""}; install and apply them over Wi-Fi when they are ready.</p></div></div>`}
    <h3>${mine.length ? "New theme" : "Start a theme"}</h3>
    <div class="dz-from" role="radiogroup" aria-label="Start from">${FROM.map(([id, ico, label, sub]) => `<button role="radio" data-form-from="${id}" class="${id === f.from ? "on" : ""}" aria-checked="${id === f.from}"${disabled(id) ? " disabled" : ""}>
      ${icon(ico)}<b>${label}</b><small>${esc(sub)}</small></button>`).join("")}</div>
    <div class="dz-form">
      <label class="dz-field"><span>Name</span><input class="control" data-form="name" value="${esc(f.name)}" maxlength="100" placeholder="My Theme"><small>The folder name on the handheld too.</small></label>
      ${source}
      ${f.from === "blank" || f.from === "file" ? "" : `<p class="muted-note">The copy is yours to change; the original stays as it is.</p>`}
      ${f.from === "blank" ? `<label class="dz-field"><span>Made for</span><select class="control" data-form="version">${S.VERSIONS.map(([v, l]) => `<option value="${v}"${v === f.version ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>` : ""}
    </div>
    <footer class="dz-new-foot">${mine.length ? `<button class="btn" data-dz="cancel-new"${f.busy ? " disabled" : ""}>Cancel</button>` : ""}
      <button class="btn primary" data-dz="create"${f.busy ? " disabled" : ""}>${f.busy ? ICONS.spin : icon("plus")}<span>${f.busy ? esc(f.busy) : "Create theme"}</span></button></footer>
  </section>`;
}

function blankScheme(palette) {
  const out = structuredClone(S.STARTER);
  const cols = S.PALETTES[palette].slice(1);
  ROLES.forEach((id, n) => { for (const [s, k] of S.QUICK.find((q) => q[0] === id)[3]) (out[s] ||= {})[k] = cols[n]; });
  for (const sec of Object.values(out)) for (const k of Object.keys(sec)) sec[k] = String(sec[k]);
  return out;
}

async function create() {
  const f = D.form;
  const name = f.name.trim();
  if (!name) return toast("Give the theme a name.", 3000);
  if (f.from !== "blank" && f.from !== "file" && !f.source) return toast("Pick the theme to start from.", 3000);
  if (f.from === "file" && !f.file) return toast("Pick a .muxthm file.", 3000);
  if (f.from === "blank" && !f.res.size) return toast("Pick at least one screen size.", 3000);
  f.busy = f.from === "catalogue" ? "Downloading" : f.from === "device" ? "Copying from the handheld" : "Creating";
  renderBody();
  try {
    let r;
    if (f.from === "file") r = await putFile(`/api/designer/import?${qs({ name })}`, f.file);
    else r = await api("designer/create", { name, from: f.from, source: f.source, version: f.version, res: [...f.res], scheme: f.from === "blank" ? blankScheme(f.palette) : undefined });
    setList(r);
    D.form = null;
    D.panel = f.from === "blank" ? "quick" : D.panel;
    await openTheme(r.created);
    toast(`${r.created} is ready to design.`, 3000);
  } catch (error) {
    f.busy = "";
    renderBody();
    toast(error.message, 6000);
  }
}

// ---------------------------------------------------------------- theme actions

async function ask(title, label, value) {
  const ok = await confirmBox({ title, html: `<label class="dz-field"><span>${esc(label)}</span><input class="control" id="dz-ask" value="${esc(value)}" maxlength="100"></label>`, ok: "OK" });
  return ok ? $("dz-ask")?.value.trim() || "" : "";
}

async function busy(label, fn) {
  D.busy = label;
  renderTop();
  try { await fn(); } catch (error) { toast(error.message, 6000); }
  D.busy = "";
  renderTop();
}

async function exportTheme() {
  await flush();
  await busy("Packing", async () => {
    const made = await makePreviews();
    const res = await fetch(`/api/designer/package?${qs({ name: D.model.name, token: TOKEN })}`, { headers: { "X-Manager-Token": TOKEN } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `${D.model.name}.muxthm` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    toast(`${D.model.name}.muxthm is in your downloads.${made ? " Preview pictures were drawn for it." : ""} Copy it to MUOS/theme on the SD card, or install it from here.`, 6000);
    if (made) renderAll();
  });
}

async function install(apply) {
  const name = D.model.name;
  const onDevice = D.host.data()?.device?.installed.some((t) => t.name === name);
  const ok = await confirmBox({
    title: `${apply ? "Install and apply" : "Install"} ${name}?`,
    html: `<p>The theme is packed and copied to MUOS/theme on SD1${onDevice ? `, replacing the ${esc(name)} already there` : ""}.${apply ? " Then it becomes the active theme: the handheld's menu closes and comes back with it a few seconds later, and the boot logo changes with it." : ""}</p>`,
    ok: apply ? "Install and apply" : "Install",
  });
  if (!ok) return;
  await flush();
  await busy(apply ? "Applying" : "Installing", async () => {
    await makePreviews();
    const r = await api("designer/install", { name, apply });
    toast(r.applied ? `${name} is installed and applied. The handheld's menu restarts with it.` : `${name} is installed on the handheld.`, 5000);
    D.host.refresh();
  });
  renderAll();
}

async function themeAction(what) {
  const name = D.model?.name;
  if (what === "duplicate") {
    const to = await ask(`Duplicate ${name}`, "Name of the copy", suggest(`${name} copy`));
    if (to) await busy("Copying", async () => { await flush(); const r = await api("designer/duplicate", { name, to }); setList(r); await openTheme(r.created); });
  } else if (what === "rename") {
    const to = await ask(`Rename ${name}`, "New name", name);
    if (to && to !== name) await busy("Renaming", async () => { await flush(); const r = await api("designer/rename", { name, to }); setList(r); D.model = null; await openTheme(r.created); });
  } else if (what === "trash") {
    if (!(await confirmBox({ title: `Move ${name} to the Trash?`, html: `<p>The theme folder goes to the Trash on this computer; you can put it back from there. Copies on the handheld stay.</p>`, ok: "Move to the Trash", danger: true }))) return;
    await busy("Removing", async () => {
      await flush();
      D.pending.clear();
      setList(await api("designer/delete", { name }));
      D.model = null;
      D.name = "";
      await loadList();
    });
  } else if (what === "reveal") {
    await api("designer/reveal", name ? { name } : {}).catch((error) => toast(error.message, 4000));
  }
  renderAll();
}

async function importFile(file) {
  const base = file.name.replace(/\.(muxthm|zip)$/i, "").replace(/[/\\]/g, " ").trim().slice(0, 100) || "Imported";
  const name = await ask("Import a theme", "Name in the themes folder", suggest(base));
  if (!name) return;
  await busy("Importing", async () => {
    const r = await putFile(`/api/designer/import?${qs({ name })}`, file);
    setList(r);
    D.form = null;
    await openTheme(r.created);
    toast(`${r.created} is imported.`, 3000);
  });
}

// ---------------------------------------------------------------- helpers for the asset panels

const H = {
  D, S, fileUrl, deviceRes, reachable, putFile, makePreviews, redraw, qs,
  has: (rel) => D.files.has(rel),
  render: () => { renderNav(); renderEditor(); renderView(); renderTop(); },
  editVariant: (v) => { D.panel = "quick"; D.q = ""; setLayer(`alternate/${v}.ini`); },
  async upload(rel, file) {
    await putFile(`/api/designer/upload?${qs({ name: D.model.name, path: rel })}`, file);
    await reloadModel();
  },
  async call(path, body) {
    await flush();
    setModel(await api(path, { name: D.model.name, ...body }));
    H.render();
  },
  async remove(rel) {
    setModel(await api("designer/remove-file", { name: D.model.name, path: rel }));
    H.render();
  },
};

// ---------------------------------------------------------------- events

function hexOf(value) {
  const m = String(value).trim().replace(/^(#|0x)/i, "");
  return /^[0-9a-f]{6}$/i.test(m) ? m.toUpperCase() : /^[0-9a-f]{3}$/i.test(m) ? m.replace(/./g, "$&$&").toUpperCase() : "";
}

function onInput(e) {
  const t = e.target;
  if (t.matches("[data-dz-q]")) {
    D.q = t.value;
    const at = t.selectionStart;
    renderNav();
    renderEditor();
    const input = document.querySelector("#dz-nav [data-dz-q]");
    input.focus();
    input.setSelectionRange(at, at);
    return;
  }
  if (t.matches("[data-form]")) {
    if (t.dataset.form === "name") { D.form.name = t.value; D.form.named = true; }
    else if (t.dataset.form === "source") {
      D.form.source = t.value;
      if (e.type !== "change") return;
      const known = t.tagName === "SELECT" || (D.host?.data()?.catalogue?.themes || []).some((x) => x.name === t.value);
      if (!D.form.named && t.value && known) D.form.name = suggest(`${t.value} remix`);
      renderBody();
    } else if (t.dataset.form === "version") D.form.version = t.value;
    return;
  }
  if (t.dataset.q) {
    const hex = t.type === "color" ? t.value.slice(1).toUpperCase() : hexOf(t.value);
    if (!hex) return;
    const row = t.closest(".dz-row");
    row.querySelector("input[type=color]").value = `#${hex}`;
    if (t.type === "color") row.querySelector(".dz-hex").value = hex;
    applyRole(t.dataset.q, hex);
    return;
  }
  if (t.dataset.qs) {
    t.nextElementSibling.textContent = t.value;
    applySize(t.dataset.qs, t.value);
    return;
  }
  const k = t.dataset.k;
  if (!k || !D.model) return;
  const kind = t.dataset.t;
  if (kind === "colour" || kind === "hex") {
    const hex = kind === "colour" ? t.value.slice(1).toUpperCase() : hexOf(t.value);
    if (!hex) return;
    const box = t.closest(".dz-colour");
    box.querySelector("input[type=color]").value = `#${hex}`;
    if (kind === "colour") box.querySelector(".dz-hex").value = hex;
    change([{ file: D.layer, k, value: hex }], `k:${k}`);
  } else if (kind === "alpha") {
    t.nextElementSibling.textContent = `${Math.round((t.value / 255) * 100)}%`;
    change([{ file: D.layer, k, value: t.value }], `k:${k}`);
  } else if (kind === "num") {
    if (t.value === "" || !Number.isFinite(Number(t.value))) return;
    t.closest(".dz-ctl").querySelectorAll(`[data-k="${CSS.escape(k)}"]`).forEach((o) => { if (o !== t) o.value = t.value; });
    change([{ file: D.layer, k, value: t.value }], `k:${k}`);
  } else if (kind === "text") {
    change([{ file: D.layer, k, value: t.value }], `k:${k}`);
  }
}

function onChange(e) {
  const t = e.target;
  if (t.matches("[data-dz-theme]")) {
    if (t.value && t.value !== D.name) openTheme(t.value).catch((error) => { t.value = D.name; toast(error.message, 6000); });
    return;
  }
  if (t.matches("[data-dz-layer]")) return setLayer(t.value);
  if (t.matches("[data-dz-res]")) return setRes(t.value);
  if (t.matches("[data-dz-variant]")) { D.variant = t.value; renderEditor(); return redraw(); }
  if (t.id === "dz-import") { const file = t.files[0]; t.value = ""; if (file) importFile(file); return; }
  if (t.matches("[data-form-res]")) { t.checked ? D.form.res.add(t.dataset.formRes) : D.form.res.delete(t.dataset.formRes); return; }
  if (t.matches("[data-form='file']")) {
    D.form.file = t.files[0] || null;
    if (D.form.file && !D.form.named) D.form.name = suggest(D.form.file.name.replace(/\.(muxthm|zip)$/i, "").slice(0, 100));
    const input = document.querySelector("[data-form='name']");
    if (input) input.value = D.form.name;
    return;
  }
  if (t.matches("[data-form]")) return onInput(e);
  if (t.dataset.k && t.tagName === "SELECT") return change([{ file: D.layer, k: t.dataset.k, value: t.value }]);
  if (t.dataset.t === "hex" || t.dataset.t === "num") {
    if (t.value === "" && t.dataset.k) change([{ file: D.layer, k: t.dataset.k, value: undefined }]);
    renderEditor();
    return;
  }
  if (assetChange(t, H)) return;
}

async function onClick(e) {
  const t = e.target;
  if (t.closest(".dz-menu-list button")) t.closest("details").open = false;
  const panel = t.closest("[data-dz-panel]");
  if (panel) return openPanel(panel.dataset.dzPanel);
  if (t.closest("#dz-canvas")) {
    const g = regionAt(e);
    if (g) openPanel(g.group === "images" ? "images" : ALL_PANELS.some((p) => p[0] === g.group) ? g.group : D.panel);
    return;
  }
  const side = t.closest("[data-side]");
  if (side) {
    const k = side.dataset.k, R = editorValues();
    const v = R.get(...split(k)) ^ Number(side.dataset.side);
    side.classList.toggle("on");
    side.setAttribute("aria-pressed", side.classList.contains("on"));
    return change([{ file: D.layer, k, value: v }]);
  }
  const reset = t.closest("[data-reset]");
  if (reset) {
    change(reset.dataset.reset.split(" ").map((k) => ({ file: D.layer, k, value: undefined })));
    return renderEditor();
  }
  const pal = t.closest("[data-palette]");
  if (pal) return applyPalette(Number(pal.dataset.palette));
  const fp = t.closest("[data-form-palette]");
  if (fp) { D.form.palette = Number(fp.dataset.formPalette); return renderBody(); }
  const from = t.closest("[data-form-from]");
  if (from && !from.disabled) { D.form.from = from.dataset.formFrom; D.form.source = ""; D.form.file = null; return renderBody(); }
  if (assetClick(t, H)) return;
  const el = t.closest("[data-dz]");
  if (!el || el.disabled) return;
  const what = el.dataset.dz;
  if (what === "new") startForm();
  else if (what === "cancel-new") { D.form = null; renderBody(); }
  else if (what === "create") create();
  else if (what === "import") $("dz-import").click();
  else if (what === "export") await exportTheme();
  else if (what === "install") await install(el.dataset.apply === "1");
  else if (what === "retry") await flush();
  else if (["duplicate", "rename", "trash", "reveal"].includes(what)) await themeAction(what);
  else if (what === "undo") undo();
  else if (what === "redo") redo();
  else if (what === "screen") { D.screen = el.dataset.screen; renderView(); renderEditor(); }
  else if (what === "show-variant") { D.variant = el.dataset.v; renderView(); renderEditor(); }
  else if (what === "menu") setMenuStyle(el.dataset.style);
  else if (what === "quick-free") quickFree();
  else if (what === "copy-layer") {
    const sized = D.layer.match(/^(\d+x\d+)\/scheme\/(\w+)\.ini$/);
    const src = D.model.schemes[`scheme/${sized[2]}.ini`] || {};
    change(Object.entries(src).flatMap(([sec, keys]) => Object.entries(keys).map(([k, v]) => ({ file: D.layer, k: `${sec}.${k}`, value: v }))));
    renderEditor();
  } else if (what === "previews") {
    el.disabled = true;
    try { await flush(); await makePreviews(D.res); toast(`Preview pictures for ${D.res} are saved in the theme.`, 3000); } catch (error) { toast(error.message, 5000); }
    el.disabled = false;
  }
}

function bind(root) {
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("click", (e) => { onClick(e).catch((error) => toast(error.message, 6000)); });
  root.addEventListener("mousemove", (e) => { if (e.target.id === "dz-canvas") hover(e); });
  root.addEventListener("mouseout", (e) => { if (e.target.id === "dz-canvas") hover(null); });
  root.addEventListener("dragover", (e) => { if (e.target.closest("[data-drop]")) { e.preventDefault(); e.target.closest("[data-drop]").classList.add("drag"); } });
  root.addEventListener("dragleave", (e) => { e.target.closest("[data-drop]")?.classList.remove("drag"); });
  root.addEventListener("drop", (e) => {
    const zone = e.target.closest("[data-drop]");
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove("drag");
    assetDrop(zone, e.dataTransfer.files, H);
  });
}

document.addEventListener("keydown", (e) => {
  const root = $("dz");
  if (!root || !root.offsetParent || !D.model || !(e.metaKey || e.ctrlKey) || e.altKey) return;
  if (e.target.matches("input[type=text], input[type=search], input:not([type]), textarea") && !e.target.dataset.k) return;
  const key = e.key.toLowerCase();
  if (key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((key === "z" && e.shiftKey) || key === "y") { e.preventDefault(); redo(); }
});
