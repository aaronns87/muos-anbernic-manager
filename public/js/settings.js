// Settings: the Roms folder (with a folder browser), what copying does, startup, appearance, game data and caches.

import { $, app, api, esc, human, plural, store, toast, busy, icon, model, section, DATE_FORMATS, formatDate, formatTime } from "./core.js";
import { renderStatusbar } from "./device.js";
import { applyView, loadLibrary } from "./games.js";
import { invalidateLocal } from "./art-local.js";
import { artMax, confirmBox, maxSides } from "./art-images.js";
import { screenText } from "./devices.js";
import { forgetImages } from "./system.js";
import { openWizard } from "./wizard.js";
import { checkManager } from "./manager-update.js";

const FOLDER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`;
const PLACE_ICONS = {
  roms: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="11" r="1"/><circle cx="18" cy="13" r="1"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10"/></svg>`,
  drive: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5 13 7 5h10l2 8"/><circle cx="17" cy="16.5" r="1"/></svg>`,
  folder: FOLDER,
};

const s = { data: null, error: "", loading: false, working: "", browse: null, bound: false };

/** Reads the settings again the next time the section opens, after the setup wizard changed them. */
export function forgetSettings() {
  s.data = null;
  if (section() === "settings") showSettings();
}

export function showSettings() {
  if (!s.bound) bind();
  if (!s.data && !s.loading) load();
  render();
}

async function load() {
  s.loading = true;
  try {
    s.data = await api("settings");
    s.error = "";
  } catch (error) {
    s.error = error.message;
  }
  s.loading = false;
  render();
}

// ---------------------------------------------------------------- rendering

const panel = (cls, title, body) => `<section class="panel ${cls}"><h2>${title}</h2>${body}</section>`;
const toggle = (key, on, label, note) => `<label class="set-row set-toggle">
    <span><b>${label}</b><small>${note}</small></span>
    <span class="switch"><input type="checkbox" role="switch" data-set-toggle="${key}"${on ? " checked" : ""}><span class="switch-track"></span></span>
  </label>`;

function render() {
  if (!$("settings")) return;
  if (!s.data) {
    $("settings").innerHTML = s.error
      ? `<div class="notice err">${esc(s.error)}</div>`
      : `<div class="planning"><span class="spinner"></span> Reading settings&hellip;</div>`;
    return;
  }
  const d = s.data;
  $("settings-sub").textContent = d.settings.roms ? `Roms folder: ${d.roms}` : "Where the manager finds your games, and how it behaves";
  $("settings").innerHTML = `<div class="ov-grid">${romsPanel(d)}${otherFoldersPanel(d)}${copyPanel(d)}${appearancePanel()}${dataPanel(d)}${cachePanel(d)}</div>`;
}

const KINDS = {
  roms: { name: "Roms folder", workspace: "Roms" },
  apps: { name: "apps folder", workspace: "apps" },
  os: { name: "OS images folder", workspace: "os", unit: "image" },
  bios: { name: "BIOS folder", workspace: "bios", unit: "file" },
  backups: { name: "backups folder", workspace: "backups", unit: "backup" },
};
KINDS.apps.unit = "package";

function folderState(which, f) {
  if (!f.available) return f.custom || which === "roms" ? `<span class="set-chip bad">Folder missing</span>` : `<span class="set-chip">Not created yet</span>`;
  if (which === "roms") return f.count ? `<span class="set-chip ok">${plural(f.count, "system folder")}</span>` : `<span class="set-chip warn">No system folders</span>`;
  const unit = KINDS[which].unit;
  return f.count ? `<span class="set-chip ok">${plural(f.count, unit)}</span>` : `<span class="set-chip">No ${unit}s yet</span>`;
}

/** The path, its state and the buttons to change it, plus the folder browser while choosing. */
function folderBox(d, which) {
  const f = d.folders[which];
  const working = s.working === `folder-${which}`;
  const choosing = s.browse?.which === which;
  const attrs = (extra = "") => ` data-which="${which}"${s.working.startsWith("folder-") || extra ? " disabled" : ""}`;
  return `<div class="set-path">
      <span class="set-path-icon">${FOLDER}</span>
      <code title="${esc(f.path)}">${esc(f.path)}</code>
      <span class="set-chip">${f.custom ? "Custom" : "Default"}</span>${folderState(which, f)}
    </div>
    <div class="panel-actions set-actions">
      <button class="btn${which === "roms" ? " primary" : ""}" data-set="browse"${attrs(s.browse ? "x" : "")}>${FOLDER} Change folder&hellip;</button>
      ${d.pickFolder ? `<button class="btn" data-set="pick"${attrs()}>${icon("search")}<span>Choose in ${esc(d.fileManager)}&hellip;</span></button>` : ""}
      ${f.available ? `<button class="btn" data-set="reveal" data-which="${which}">${icon("external")}<span>Show in ${esc(d.fileManager)}</span></button>` : ""}
      ${f.custom ? `<button class="btn ghost" data-set="default"${attrs()} title="${esc(f.default)}">${icon("refresh")}<span>Use the workspace ${KINDS[which].workspace} folder</span></button>` : ""}
      ${working ? `<span class="muted-note set-working"><span class="spinner"></span> ${which === "roms" ? "Scanning the new folder" : "Saving"}&hellip;</span>` : ""}
    </div>
    ${choosing ? browser(d) : ""}`;
}

function romsPanel(d) {
  return panel("full", "Roms folder", `<p class="muted-note">The games library, artwork, scraper and transfers all read this folder. It holds one folder per system
      (MD, GBA, PS&hellip;), each with its games and an Imgs folder for artwork.</p>${folderBox(d, "roms")}`);
}

function otherFoldersPanel(d) {
  const block = (which, title, note) => `<div class="set-folder"><div class="set-folder-head"><b>${title}</b><small>${note}</small></div>${folderBox(d, which)}</div>`;
  return panel("full", "Other folders",
    block("apps", "Apps", "MustardOS apps and updates (.muxapp, .muxupd, .muxzip) waiting to go to the handheld. By default the apps folder next to Roms.")
    + block("os", "OS images", "MustardOS card images (.img, .img.gz) for System Tools. Images one folder down are found too. By default the os folder next to Roms.")
    + block("bios", "BIOS", "BIOS files the emulators need (PlayStation, Sega CD, Neo Geo&hellip;), ready to send to the handheld. By default the bios folder next to Roms.")
    + block("backups", "Save backups", "Backups of the handheld's saves and save states. By default the backups folder next to Roms."));
}

function crumbs(b) {
  const parts = b.path.split(b.sep).filter(Boolean);
  const root = b.sep === "/" ? "/" : "";
  const out = [];
  let acc = root;
  out.push(`<button class="crumb" data-browse="${esc(root || parts[0] + b.sep)}">${root ? "/" : esc(parts[0])}</button>`);
  for (const [i, part] of parts.entries()) {
    if (!root && i === 0) { acc = part + b.sep; continue; }
    acc = acc.endsWith(b.sep) ? acc + part : acc + b.sep + part;
    out.push(`<span class="crumb-sep">&rsaquo;</span><button class="crumb" data-browse="${esc(acc)}">${esc(part)}</button>`);
  }
  return out.join("");
}

function browser(d) {
  const b = s.browse;
  if (!b.path) return `<div class="set-browser"><div class="planning"><span class="spinner"></span> Opening&hellip;</div></div>`;
  const places = b.places.map((p) => `<button class="place${b.path === p.path ? " on" : ""}" data-browse="${esc(p.path)}" title="${esc(p.path)}">
      ${PLACE_ICONS[p.kind] || FOLDER}<span>${esc(p.name)}</span></button>`).join("");
  const rows = b.dirs.length
    ? b.dirs.map((x) => `<button class="dir${x.system ? " sys" : ""}" data-browse="${esc(x.path)}">${FOLDER}<span>${esc(x.name)}</span>${x.system ? `<em>system</em>` : ""}</button>`).join("")
    : `<div class="muted-note dir-empty">No folders in here.</div>`;
  const verdict = b.which === "bios" || b.which === "backups"
    ? `<span class="set-chip">Any folder</span> ${b.which === "bios" ? "Put BIOS files directly in it, or in subfolders like dc/ as on the handheld." : "Each backup is one .tar.gz file."}`
    : b.which === "apps"
    ? b.apps
      ? `<span class="set-chip ok">${plural(b.apps, "app")}</span> Has MustardOS apps or updates.`
      : `<span class="set-chip">No apps here</span> Apps are .muxapp, .muxupd or .muxzip files. You can add them later.`
    : b.which === "os"
      ? b.images
        ? `<span class="set-chip ok">${plural(b.images, "image")}</span> Has MustardOS images.`
        : `<span class="set-chip">No images here</span> Images are .img or .img.gz files, here or one folder down.`
      : b.systems
        ? `<span class="set-chip ok">${plural(b.systems, "system folder")}</span> Looks like a Roms folder.`
        : `<span class="set-chip warn">No system folders</span> A Roms folder holds folders such as MD, GBA or PS.`;
  const same = b.path === d.folders[b.which].path;
  return `<div class="set-browser">
    <aside class="set-places">${places}</aside>
    <div class="set-files">
      <div class="set-nav">
        <button class="btn icon" data-browse="${esc(b.parent)}" title="Up one folder" aria-label="Up one folder"${b.parent ? "" : " disabled"}>${icon("arrow", "up")}</button>
        <div class="crumbs">${crumbs(b)}</div>
      </div>
      <form class="set-go" data-set-form="go">
        <input class="control" id="set-browse-path" value="${esc(b.input ?? b.path)}" spellcheck="false" autocomplete="off" aria-label="Folder path">
        <button class="btn" type="submit">Go</button>
      </form>
      <div class="set-dirs${b.loading ? " loading" : ""}">${rows}</div>
      <div class="set-verdict">${verdict}</div>
      <div class="set-foot">
        <button class="btn ghost" data-set="cancel">Cancel</button>
        <button class="btn primary" data-set="use"${same ? ` disabled title="This is already the ${KINDS[b.which].name}"` : ""}>${icon("check")}<span>Use this folder</span></button>
      </div>
    </div>
  </div>`;
}

function copyPanel(d) {
  return panel("half", "Transfers, startup and updates",
    toggle("copyArt", d.settings.copyArt, "Send box art with games",
      "Transferring a game also puts its Roms/ image in the device's artwork catalogue, unless the device has box art for it already.")
    + toggle("openBrowser", d.settings.openBrowser, "Open the browser at start",
      "Starting the manager opens this page. Off: it only prints the link. A restart reuses the open tab either way.")
    + toggle("checkUpdates", d.settings.checkUpdates, "Check for manager updates",
      "Every few hours the manager reads the version number on GitHub and shows Update in the top bar when there is a newer one. Nothing else is sent."));
}

function appearancePanel() {
  const theme = app.ui.theme;
  const seg = [["dark", "Dark"], ["light", "Light"], ["system", "Match system"]]
    .map(([v, l]) => `<button type="button" data-set-theme="${v}" class="${theme === v ? "on" : ""}">${l}</button>`).join("");
  const sizes = maxSides().map(([v, l]) => `<option value="${v}"${artMax.get() === v ? " selected" : ""}>${l}</option>`).join("");
  const now = new Date();
  const clockSeg = [["24", "24-hour"], ["12", "12-hour"]]
    .map(([v, l]) => `<button type="button" data-set-clock="${v}" class="${app.ui.clock === v ? "on" : ""}" title="${esc(formatTime(now, v))}">${l}</button>`).join("");
  const dates = DATE_FORMATS.map(([v, l]) => `<option value="${v}"${app.ui.dateFormat === v ? " selected" : ""}>${v === "none" ? l : `${esc(formatDate(now, v))} \u00b7 ${l}`}</option>`).join("");
  return panel("half", "Appearance, clock and images", `
    <div class="set-row"><span><b>Theme</b><small>Dark matches the MustardOS look on the handheld.</small></span>
      <div class="segmented">${seg}</div></div>
    <div class="set-row"><span><b>Clock</b><small>Time in the top bar: ${esc(formatTime(now))}.</small></span>
      <div class="segmented">${clockSeg}</div></div>
    <div class="set-row"><span><b>Date</b><small>Shown next to the clock.</small></span>
      <select class="control" data-set-date>${dates}</select></div>
    <div class="set-row"><span><b>Uploaded artwork size</b><small>Longest side for images you upload or shrink. The ${esc(model().name)}'s screen is ${esc(screenText(model()))}.</small></span>
      <select class="control" data-set-artmax>${sizes}</select></div>`);
}

function dataRow(label, note, size, action, button, title = "") {
  const working = s.working === action;
  return `<div class="set-row"><span><b>${label}</b><small>${note}${size !== null ? ` &middot; ${size ? human(size) : "not downloaded"}` : ""}</small></span>
    <button class="btn" data-set-refresh="${action}"${s.working ? " disabled" : ""}${title ? ` title="${title}"` : ""}>${working ? `<span class="spinner"></span> Working&hellip;` : button}</button></div>`;
}

function dataPanel(d) {
  return panel("half", "Game data",
    `<div class="set-row"><span><b>Setup wizard</b><small>Walk through the handheld, folders, connection and downloads again</small></span>
      <button class="btn" data-set="wizard">${icon("star")}<span>Run setup</span></button></div>` +
    dataRow("Roms folder scan", "Reads every system folder again, as at start", null, "rescan", "Rescan now")
    + dataRow("Game descriptions", "Text, genres, ratings and years from the LaunchBox Games Database", d.cache.descriptions, "descriptions", "Download again", "About 110 MB; takes a minute or two")
    + dataRow("Arcade titles", "Full names for MAME and FinalBurn Neo ROMs", d.cache.names, "names", "Download again"));
}

function cachePanel(d) {
  const row = (label, note, size, what) => `<div class="set-row"><span><b>${label}</b><small>${note} &middot; ${size ? human(size) : "empty"}</small></span>
    <button class="btn" data-set-clear="${what}"${!size || s.working ? " disabled" : ""}>${icon("trash")}<span>Clear</span></button></div>`;
  return panel("half", "Cache",
    row("Scraper file lists", "What the libretro thumbnail project has, kept for 14 days", d.cache.thumbnails, "thumbnails")
    + row("Device artwork previews", "Pictures already read from the handheld", d.cache.deviceArt, "deviceArt")
    + `<p class="muted-note set-cache-path">Kept in <code>${esc(d.cache.folder)}</code></p>`);
}

// ---------------------------------------------------------------- actions

async function browse(path, which = s.browse?.which || "roms") {
  if (s.browse && s.browse.which !== which) s.browse = null;
  const b = s.browse || (s.browse = { path: "", dirs: [], places: [], which });
  b.loading = true;
  b.input = undefined;
  render();
  try {
    Object.assign(b, await api(`settings/folders?path=${encodeURIComponent(path || "")}`));
  } catch (error) {
    toast(error.message, 3000);
  }
  b.loading = false;
  if (s.browse) render();
}

async function useOtherFolder(which, target) {
  s.working = `folder-${which}`;
  render();
  try {
    s.data = await api("settings", { [which]: target });
    s.browse = null;
    app.overview.workspace = null;
    if (which === "os") forgetImages();
    const f = s.data.folders[which];
    const k = KINDS[which];
    toast(`${k.name[0].toUpperCase() + k.name.slice(1)} set: ${plural(f.count, k.unit)}`, 2600);
  } catch (error) {
    toast(error.message, 3500);
  }
  s.working = "";
  render();
}

async function useFolder(path, which = "roms") {
  const target = path ?? "";
  if (which !== "roms") return useOtherFolder(which, target);
  if (busy()) { toast("Wait for the copy to finish first"); return; }
  if (target && s.browse && s.browse.path === target && !s.browse.systems) {
    const ok = await confirmBox({
      title: "Use this folder?",
      html: `<p><code>${esc(target)}</code> has no system folders such as MD, GBA or PS, so the library will be empty until you add some.</p>`,
      ok: "Use it anyway",
    });
    if (!ok) return;
  }
  s.working = "folder-roms";
  render();
  try {
    s.data = await api("settings", { roms: target });
    s.browse = null;
    invalidateLocal();
    await loadLibrary();
    toast(`${app.all.length.toLocaleString()} games in the new Roms folder`, 2600);
  } catch (error) {
    toast(error.message, 3500);
  }
  s.working = "";
  render();
}

async function saveToggle(key, value) {
  try {
    s.data = await api("settings", { [key]: value });
    toast("Saved");
    if (key === "checkUpdates") checkManager(value);
  } catch (error) {
    toast(error.message, 3000);
  }
  render();
}

async function refresh(what) {
  s.working = what;
  render();
  try {
    s.data = await api("settings/refresh", { what });
    await loadLibrary();
    toast(what === "rescan" ? `Found ${app.all.length.toLocaleString()} games` : "Downloaded and applied", 2400);
  } catch (error) {
    toast(error.message, 3500);
  }
  s.working = "";
  render();
}

async function clear(what) {
  try {
    s.data = await api("settings/clear-cache", { what });
    toast("Cleared");
  } catch (error) {
    toast(error.message, 3000);
  }
  render();
}

function bind() {
  s.bound = true;
  const root = $("view-settings");
  root.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-set], [data-browse], [data-set-theme], [data-set-clock], [data-set-refresh], [data-set-clear]");
    if (!el || el.disabled) return;
    if (el.dataset.browse !== undefined) { if (el.dataset.browse) browse(el.dataset.browse); return; }
    if (el.dataset.setTheme) {
      app.ui.theme = el.dataset.setTheme;
      store.set("theme", app.ui.theme);
      applyView();
      render();
      return;
    }
    if (el.dataset.setClock) {
      app.ui.clock = el.dataset.setClock;
      store.set("clock", app.ui.clock);
      renderStatusbar();
      render();
      return;
    }
    if (el.dataset.setRefresh) { refresh(el.dataset.setRefresh); return; }
    if (el.dataset.setClear) { clear(el.dataset.setClear); return; }
    const action = el.dataset.set;
    const which = el.dataset.which || "roms";
    if (action === "browse") browse(s.data.folders[which].path, which);
    else if (action === "cancel") { s.browse = null; render(); }
    else if (action === "wizard") openWizard();
    else if (action === "use") useFolder(s.browse.path, s.browse.which);
    else if (action === "default") useFolder("", which);
    else if (action === "reveal") api("settings/reveal", { which }).catch((error) => toast(error.message, 3000));
    else if (action === "pick") {
      try {
        toast(`Choose the folder in the ${s.data.fileManager} window`, 2600);
        const { path } = await api("settings/pick-folder", { which });
        if (path) browse(path, which);
      } catch (error) {
        toast(error.message, 3000);
      }
    }
  });
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.setToggle) saveToggle(t.dataset.setToggle, t.checked);
    else if (t.dataset.setArtmax !== undefined) { artMax.set(t.value); toast("Saved"); }
    else if (t.dataset.setDate !== undefined) { app.ui.dateFormat = t.value; store.set("dateFormat", t.value); renderStatusbar(); }
  });
  root.addEventListener("input", (e) => {
    if (e.target.id === "set-browse-path" && s.browse) s.browse.input = e.target.value;
  });
  root.addEventListener("submit", (e) => {
    if (e.target.dataset.setForm !== "go") return;
    e.preventDefault();
    browse($("set-browse-path").value.trim());
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && s.browse && !document.querySelector("dialog[open]")) { s.browse = null; render(); }
  });
}
