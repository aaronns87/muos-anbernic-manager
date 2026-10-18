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
import { forgetActivity } from "./activity.js";
import { forgetPlay } from "./play.js";
import { chatConfiguredChanged, mdHtml } from "./chat.js";

const FOLDER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`;
const PLACE_ICONS = {
  roms: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="11" r="1"/><circle cx="18" cy="13" r="1"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10"/></svg>`,
  drive: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5 13 7 5h10l2 8"/><circle cx="17" cy="16.5" r="1"/></svg>`,
  folder: FOLDER,
};

const s = { data: null, chat: null, error: "", loading: false, working: "", browse: null, bound: false, chatKey: "", promptBound: false, knowledgeBound: false, knowledgeMd: "" };

const SETTINGS_TABS = [
  ["folders", "folder", "Folders", "Where the manager finds games, apps, OS images, BIOS, backups and themes"],
  ["behaviour", "sliders", "Behaviour", "Copying, startup, updates, theme, clock and uploaded artwork size"],
  ["assistant", "chat", "Assistant", "Bring-your-own-key chat, model, context, system prompt and knowledge base"],
  ["data", "layers", "Data", "Refresh library metadata and clear downloaded caches"],
  ["resets", "trash", "Resets", "Clear logs and preferences on this computer, play history on the handheld, or start over"],
];

const settingsTab = () => SETTINGS_TABS.find((t) => t[0] === store.get("settingsTab", "folders")) || SETTINGS_TABS[0];

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
    const [data, chat] = await Promise.all([api("settings"), api("chat/settings")]);
    s.data = data;
    s.chat = chat;
    s.chatKey = "";
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

function paintTabs() {
  const tabs = $("settings-tabs");
  if (!tabs) return;
  const [id] = settingsTab();
  tabs.innerHTML = SETTINGS_TABS.map(([t, ico, label]) =>
    `<button role="tab" data-settings-tab="${t}" class="${t === id ? "on" : ""}" aria-selected="${t === id}">${icon(ico)}<span>${label}</span></button>`).join("");
}

function render() {
  if (!$("settings")) return;
  paintTabs();
  if (!s.data) {
    $("settings-sub").textContent = settingsTab()[3];
    $("settings").innerHTML = s.error
      ? `<div class="notice err">${esc(s.error)}</div>`
      : `<div class="planning"><span class="spinner"></span> Reading settings&hellip;</div>`;
    return;
  }
  const d = s.data, [tab, , , sub] = settingsTab();
  $("settings-sub").textContent = tab === "folders" && d.settings.roms ? `Roms folder: ${d.roms}` : sub;
  const body = tab === "folders" ? `${romsPanel(d)}${otherFoldersPanel(d)}`
    : tab === "behaviour" ? `${copyPanel(d)}${appearancePanel()}`
    : tab === "assistant" ? assistantPanel()
    : tab === "data" ? `${dataPanel(d)}${cachePanel(d)}`
    : `${historyPanel(d)}${resetPanel()}`;
  $("settings").innerHTML = `<div class="ov-grid">${body}</div>`;
}

function assistantPanel() {
  const c = s.chat;
  if (!c) return panel("full", "Assistant", `<p class="muted-note">Loading assistant settings&hellip;</p>`);
  const prov = c.providers.find((p) => p.id === c.provider) || c.providers[0];
  const models = (prov?.models || []).map((m) => `<option value="${esc(m.id)}"${c.model === m.id ? " selected" : ""}>${esc(m.label)}</option>`).join("");
  const providers = c.providers.map((p) => `<option value="${esc(p.id)}"${c.provider === p.id ? " selected" : ""}>${esc(p.label)}</option>`).join("");
  const help = c.help?.[c.provider] || "";
  const status = c.configured
    ? `<span class="set-chip ok">Key saved${c.keyHint ? ` (${esc(c.keyHint)})` : ""}</span>`
    : `<span class="set-chip warn">No key — chat stays hidden</span>`;
  const promptChip = c.systemPromptCustom
    ? `<span class="set-chip warn">Custom</span>`
    : `<span class="set-chip ok">Default</span>`;
  const promptWarn = c.systemPromptCustom
    ? `<div class="notice warn">${icon("alert")}<span><b>Custom system prompt.</b> Answers may ignore knowledge-base grounding, walkthrough refusal or other built-in limits.
        <button type="button" class="link-btn" data-set="chat-prompt">Edit</button> or revert from the editor.</span></div>`
    : "";
  return panel("full", `${icon("chat")} Assistant`, `
    <p class="muted-note">Optional help chat that uses <b>your own free API key</b> (bring your own key). The key stays in the manager cache on this
      computer and is sent only to the provider you choose. Without a key, the chat button stays hidden.</p>
    ${promptWarn}
    <div class="set-row"><span><b>Status</b><small>After you save a key, open chat from the mustard chat button in the bottom-right corner, or <b>Assistant</b> in the top bar.</small></span>${status}</div>
    <div class="set-row"><span><b>Provider</b><small>${esc(help)}</small></span>
      <select class="control" id="chat-provider">${providers}</select></div>
    <div class="set-row"><span><b>API key</b><small>Leave blank to keep the saved key. Clear removes it.</small></span>
      <input class="control mono" id="chat-key" type="password" autocomplete="off" spellcheck="false" placeholder="${c.configured ? "Saved — type a new key to replace" : "Paste a free API key"}" value="${esc(s.chatKey)}"></div>
    <div class="set-row"><span><b>Model</b><small>Or type a custom model id for this provider.</small></span>
      <select class="control" id="chat-model">${models}<option value="__custom__"${(prov?.models || []).every((m) => m.id !== c.model) ? " selected" : ""}>Custom&hellip;</option></select></div>
    <div class="set-row" id="chat-custom-row"${(prov?.models || []).some((m) => m.id === c.model) ? " hidden" : ""}><span><b>Custom model id</b><small>Used when the model list is set to Custom&hellip;</small></span>
      <input class="control mono" id="chat-custom" spellcheck="false" ${(prov?.models || []).some((m) => m.id === c.model) ? "disabled " : ""}value="${esc((prov?.models || []).some((m) => m.id === c.model) ? "" : c.model)}"></div>
    <div class="set-row"><span><b>Temperature</b><small>Lower is more factual (0–1).</small></span>
      <input class="control" id="chat-temp" type="number" min="0" max="1" step="0.1" value="${c.temperature}"></div>
    <div class="set-row"><span><b>Max reply tokens</b><small>Caps length and free-tier use.</small></span>
      <input class="control" id="chat-maxtok" type="number" min="256" max="4096" step="128" value="${c.maxTokens}"></div>
    <label class="set-row set-toggle"><span><b>Include library context</b><small>Search your Roms/ library and LaunchBox descriptions when answering.</small></span>
      <span class="switch"><input type="checkbox" role="switch" id="chat-library"${c.includeLibrary ? " checked" : ""}><span class="switch-track"></span></span></label>
    <label class="set-row set-toggle"><span><b>Include connection context</b><small>Send Wi-Fi/SSH/card status (never passwords) with each question.</small></span>
      <span class="switch"><input type="checkbox" role="switch" id="chat-connection"${c.includeConnection ? " checked" : ""}><span class="switch-track"></span></span></label>
    <div class="set-row"><span><b>System prompt</b><small>Instructions sent with every message before live context. Editable even before you add a key.</small></span>
      <span class="set-prompt-actions">${promptChip}<button class="btn" data-set="chat-prompt"${s.working ? " disabled" : ""}>${icon("pencil")}<span>Edit prompt</span></button></span></div>
    <div class="set-row"><span><b>Knowledge base</b><small>Read-only guide the assistant uses for manager UI and limits (not the in-app Wiki).</small></span>
      <button class="btn" data-set="chat-knowledge"${s.working ? " disabled" : ""}>${icon("book")}<span>View knowledge base</span></button></div>
    <div class="panel-actions set-actions">
      <button class="btn primary" data-set="chat-save"${s.working === "chat" ? " disabled" : ""}>${s.working === "chat" ? `<span class="spinner"></span>` : icon("check")}<span>Save assistant</span></button>
      <button class="btn danger" data-set="chat-clear"${!c.configured || s.working ? " disabled" : ""}>${icon("trash")}<span>Clear key</span></button>
    </div>
    <div class="notice">${icon("info")}<span><b>Free keys.</b> <a href="https://console.groq.com" target="_blank" rel="noopener">Groq</a> (fast),
      <a href="https://aistudio.google.com" target="_blank" rel="noopener">Google AI Studio</a> (Gemini), or
      <a href="https://openrouter.ai" target="_blank" rel="noopener">OpenRouter</a> models ending in <code>:free</code>.
      Free tiers rate-limit; if a reply fails, wait or switch provider. See the Wiki article <b>Assistant</b>.</span></div>`);
}


const KINDS = {
  roms: { name: "Roms folder", workspace: "Roms" },
  apps: { name: "apps folder", workspace: "apps" },
  os: { name: "OS images folder", workspace: "os", unit: "image" },
  bios: { name: "BIOS folder", workspace: "bios", unit: "file" },
  backups: { name: "backups folder", workspace: "backups", unit: "backup" },
  themes: { name: "themes folder", workspace: "themes", unit: "theme" },
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
      <button class="btn" data-set="browse"${attrs(s.browse ? "x" : "")}>${FOLDER} Change folder&hellip;</button>
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
    + block("backups", "Save backups", "Backups of the handheld's saves and save states. By default the backups folder next to Roms.")
    + block("themes", "Themes", "Themes you make in Themes &rsaquo; Designer, one folder per theme. By default the themes folder next to Roms."));
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
  const verdict = b.which === "bios" || b.which === "backups" || b.which === "themes"
    ? `<span class="set-chip">Any folder</span> ${b.which === "bios" ? "Put BIOS files directly in it, or in subfolders like dc/ as on the handheld." : b.which === "themes" ? "Each theme is a folder in it, the same layout as MUOS/theme on the handheld." : "Each backup is one .tar.gz file."}`
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
    `<p class="muted-note">How copying to the handheld behaves, what happens when the manager starts, and whether it looks for newer versions on GitHub.</p>`
    + toggle("copyArt", d.settings.copyArt, "Send box art with games",
      "Transferring a game also puts its Roms/ image in the device's artwork catalogue, unless the device has box art for it already.")
    + toggle("openBrowser", d.settings.openBrowser, "Open the browser at start",
      "Starting the manager opens this page. Off: it only prints the link. A restart reuses the open tab either way.")
    + toggle("checkUpdates", d.settings.checkUpdates, "Check for manager updates",
      "Every few hours the manager reads the version number on GitHub and shows Update in the top bar when there is a newer one. Nothing else is sent.")
    + shortcutRow(d.shortcut, "set", s.working === "shortcut", !!s.working));
}

/** Shared with the setup wizard. */
export const shortcutRow = (sc, attr, working, busy) => `<div class="set-row"><span><b>App shortcut</b>
    <small>${sc.exists ? `In ${esc(sc.place)}` : `Adds the manager to ${esc(sc.place)} with its icon`}. It opens a terminal window that runs the manager and this page; closing the window stops it.</small></span>
  <button class="btn" data-${attr}="shortcut"${busy ? " disabled" : ""} title="${esc(sc.path)}">${working ? `<span class="spinner"></span>` : icon(sc.exists ? "refresh" : "plus")}<span>${sc.exists ? "Create again" : "Add"}</span></button></div>`;

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
    <p class="muted-note">Theme and clock in the top bar, and how large uploaded box art is saved.</p>
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
    `<p class="muted-note">Rescan the library or download descriptions and arcade names again. The setup wizard walks through folders and connection from scratch.</p>
    <div class="set-row"><span><b>Setup wizard</b><small>Walk through the handheld, folders, connection and downloads again</small></span>
      <button class="btn" data-set="wizard">${icon("star")}<span>Run setup</span></button></div>` +
    dataRow("Roms folder scan", "Reads every system folder again, as at start", null, "rescan", "Rescan now")
    + dataRow("Game descriptions", "Text, genres, ratings and years from the LaunchBox Games Database", d.cache.descriptions, "descriptions", "Download again", "About 110 MB; takes a minute or two")
    + dataRow("Arcade titles", "Full names for MAME and FinalBurn Neo ROMs", d.cache.names, "names", "Download again"));
}

const clearButton = (attr, what, enabled, label = "Clear") => {
  const working = s.working === `${attr}-${what}`;
  return `<button class="btn danger" data-${attr}="${what}"${!enabled || s.working ? " disabled" : ""}>${working ? `<span class="spinner"></span>` : icon("trash")}<span>${label}</span></button>`;
};

function cachePanel(d) {
  const row = (label, note, size, what) => `<div class="set-row"><span><b>${label}</b><small>${note} &middot; ${size ? human(size) : "empty"}</small></span>
    ${clearButton("set-clear", what, size)}</div>`;
  return panel("half", "Cache",
    `<p class="muted-note">Clear downloaded lists and previews. They are fetched again when you need them.</p>`
    + row("Scraper file lists", "What the libretro thumbnail project has, kept for 14 days", d.cache.thumbnails, "thumbnails")
    + row("Device artwork previews", "Pictures already read from the handheld", d.cache.deviceArt, "deviceArt")
    + row("Online catalogues", "PortMaster, app market, theme and MustardOS update lists with their previews; downloaded again when needed", d.cache.catalogues, "catalogues")
    + row("ROM check results", "Verify results, ROM checksums and No-Intro lists", d.cache.checks, "checks")
    + `<p class="muted-note set-cache-path">Kept in <code>${esc(d.cache.folder)}</code></p>`);
}

const PREF_KEEP = new Set(["mode", "model", "cardModels", "ssh.snippets"]);
const prefKeys = () => {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i), m = /^(manager|library)\.(.+)$/.exec(k || "");
    if (m && !PREF_KEEP.has(m[2])) out.push(k);
  }
  return out;
};

const handheldReady = () => app.ui.mode !== "card" && !!app.device.target;

/** Redraws Settings when the handheld comes or goes, so its reset buttons follow the connection. */
export function settingsDeviceChanged() {
  if (section() === "settings" && s.data && s.handheld !== handheldReady()) render();
}

function historyPanel(d) {
  const handheld = s.handheld = handheldReady();
  const away = handheld ? "" : " &middot; connect over USB or Wi-Fi first";
  const row = (label, note, button) => `<div class="set-row"><span><b>${label}</b><small>${note}</small></span>${button}</div>`;
  let prefs = 0;
  try { prefs = prefKeys().length; } catch {}
  return panel("full", "History and resets", `<p class="muted-note">Clear the activity log or browser layout prefs here, or reset play history on the handheld when it is connected over USB or Wi-Fi.</p>
    <div class="set-cols">
    <div><h3>On this computer</h3>
      ${row("Activity log", `Everything the manager changed, shown on Overview &middot; ${d.cache.activity ? `${d.cache.activity.toLocaleString()} ${d.cache.activity === 1 ? "entry" : "entries"}` : "empty"}`, clearButton("set-clear", "activity", d.cache.activity))}
      ${row("View preferences", "Sorting, layout, open tabs, theme, clock and scraper choices this browser remembers. Keeps the connection, handheld model and SSH snippets", clearButton("set-reset", "prefs", prefs, "Reset"))}
    </div>
    <div><h3>On the handheld</h3>
      ${row("Play time", `Launches and time played per game, shown in Play${away}`, clearButton("set-play", "time", handheld, "Reset"))}
      ${row("Recently played", `The History list in the MustardOS menu${away}`, clearButton("set-play", "history", handheld))}
    </div></div>`);
}

function resetPanel() {
  const working = s.working === "reset";
  return panel("full set-danger", `${icon("alert")} Factory reset`, `<div class="set-row"><span><b>Start over from scratch</b>
      <small>Moves your games and every other workspace folder (Roms, apps, OS images, BIOS, backups, themes), plus all of the manager's settings,
        Wi-Fi and SSH logins, downloads and history, to the Trash. The manager then creates empty workspace folders and restarts with the setup wizard, as on its first run.
        Nothing on the handheld or its cards is changed.</small></span>
    <button class="btn danger-solid" data-set="reset"${s.working || busy() ? " disabled" : ""}>${working ? `<span class="spinner"></span>` : icon("trash")}<span>${working ? "Resetting&hellip;" : "Factory reset&hellip;"}</span></button></div>`);
}

const RESET_FOLDERS = [["roms", "Roms", "your game library"], ["apps", "apps", "app packages"], ["os", "os", "MustardOS images"], ["bios", "bios", "BIOS files"], ["backups", "backups", "save backups from the handheld"], ["themes", "themes", "themes you designed"]];

async function factoryReset() {
  const folders = RESET_FOLDERS.filter(([k]) => s.data.folders[k]?.available);
  const rows = folders.map(([k, name, what]) => {
    const f = s.data.folders[k], count = k === "roms" ? plural(app.all.length, "game") : plural(f.count, "file");
    return `<label class="set-reset-row"><input type="checkbox" data-reset-folder="${k}" checked>
      <span><b>${esc(name)}</b> &middot; ${esc(what)} &middot; ${count}<code><bdi>${esc(f.path)}</bdi></code></span></label>`;
  }).join("");
  const answer = confirmBox({
    title: "Factory reset the manager?",
    html: `<div class="notice err">${icon("alert")} <span>This removes your game library and everything else ticked below from this computer, and signs the manager
        out of the handheld. It all goes to the Trash, so you can get it back until you empty the Trash.</span></div>
      ${rows ? `<p><b>Folders to move to the Trash</b></p><div class="set-reset-list">${rows}</div>` : ""}
      <p>Always moved to the Trash: the manager's settings, Wi-Fi and SSH logins, downloaded game data and catalogues, ROM check results and the
        activity log. This browser forgets its view preferences too. Nothing on the handheld or its cards is changed.</p>
      <p>Type <b>RESET</b> to confirm.</p>
      <input class="control fx-input" id="reset-word" aria-label="Type RESET to confirm" autocomplete="off" spellcheck="false" placeholder="RESET">`,
    ok: "Factory reset",
    danger: true,
  });
  const ok = $("c-ok"), input = $("reset-word");
  ok.disabled = true;
  input.oninput = () => { ok.disabled = input.value.trim() !== "RESET"; };
  input.onkeydown = (e) => { if (e.key === "Enter" && !ok.disabled) { e.preventDefault(); ok.click(); } };
  input.focus();
  const confirmed = await answer;
  ok.disabled = false;
  if (!confirmed || input.value.trim() !== "RESET") return;
  const chosen = [...document.querySelectorAll("[data-reset-folder]:checked")].map((i) => i.dataset.resetFolder);

  s.working = "reset";
  render();
  let res;
  try {
    res = await api("settings/factory-reset", { confirm: "RESET", folders: chosen });
  } catch (error) {
    s.working = "";
    render();
    toast(error.message, 6000);
    return;
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (/^(manager|library)\./.test(k || "")) localStorage.removeItem(k);
    }
  } catch {}
  if (res.kept.length) toast(`Left on their own drive: ${res.kept.join(", ")}`, 8000);
  if (!res.restart) {
    $("settings").innerHTML = `<div class="notice ok">${icon("check")} <span>Factory reset done and the manager stopped. Start it again from the app shortcut,
      <code>run.sh</code> or <code>run.cmd</code>; it opens the setup wizard.</span></div>`;
    return;
  }
  toast("Factory reset done. Restarting the manager\u2026", 6000);
  const until = Date.now() + 3 * 60 * 1000;
  await new Promise((r) => setTimeout(r, 1500));
  while (Date.now() < until) {
    try {
      const d = await api("manager");
      if (d.started !== res.started) { location.reload(); return; }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  s.working = "";
  toast("The manager did not come back. Start it again with the app shortcut or run.sh.", 8000);
}

// ---------------------------------------------------------------- actions

async function browse(path, which = s.browse?.which || "roms") {
  if (s.browse && s.browse.which !== which) s.browse = null;
  const b = s.browse || (s.browse = { path: "", dirs: [], places: [], which });
  b.loading = true;
  b.input = undefined;
  const seq = b.seq = (b.seq || 0) + 1;
  render();
  try {
    const found = await api(`settings/folders?path=${encodeURIComponent(path || "")}`);
    if (s.browse !== b || b.seq !== seq) return;
    Object.assign(b, found);
  } catch (error) {
    if (s.browse !== b || b.seq !== seq) return;
    toast(error.message, 4000);
    if (!b.path) s.browse = null;
  }
  b.loading = false;
  render();
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

const CLEAR_CONFIRM = {
  checks: { title: "Clear ROM check results?", html: "<p>Checks forgets what it verified. The next check reads every ROM again, which takes a while for a big library.</p>" },
  activity: { title: "Clear the activity log?", html: "<p>Everything under Recent activity is removed. This cannot be undone.</p>" },
};

async function clear(what) {
  const ask = CLEAR_CONFIRM[what];
  if (ask && !(await confirmBox({ ...ask, ok: "Clear", danger: true }))) return;
  s.working = `set-clear-${what}`;
  render();
  try {
    s.data = await api("settings/clear-cache", { what });
    if (what === "activity") forgetActivity();
    toast("Cleared");
  } catch (error) {
    toast(error.message, 3000);
  }
  s.working = "";
  render();
}

async function resetPlay(what) {
  const time = what === "time";
  const ok = await confirmBox({
    title: time ? "Reset play time on the handheld?" : "Clear the handheld's history?",
    html: time
      ? "<p>MustardOS forgets how often and how long you played every game. This changes the handheld and cannot be undone.</p>"
      : "<p>Every game leaves the History list in the MustardOS menu; the games themselves stay. This changes the handheld and cannot be undone.</p>",
    ok: time ? "Reset play time" : "Clear history",
    danger: true,
  });
  if (!ok) return;
  s.working = `set-play-${what}`;
  render();
  try {
    const r = await api("play/reset", { volume: app.device.target?.id || "", what });
    forgetPlay();
    forgetActivity();
    toast(time ? "Play time reset" : r.removed ? `Removed ${plural(r.removed, "game")} from the history` : "The history was already empty", 2600);
  } catch (error) {
    toast(error.message, 3500);
  }
  s.working = "";
  render();
}

async function makeShortcut() {
  s.working = "shortcut";
  render();
  try {
    s.data = await api("settings/shortcut", {});
    toast(`Added to ${s.data.shortcut.place}`, 2600);
  } catch (error) {
    toast(error.message, 4000);
  }
  s.working = "";
  render();
}

async function saveAssistant(clear) {
  if (!s.chat) return;
  if (clear) {
    const ok = await confirmBox({
      title: "Clear the assistant key?",
      html: "<p>The chat button disappears until you paste a key again. Conversation history in the panel is not kept on the server.</p>",
      ok: "Clear key",
      danger: true,
    });
    if (!ok) return;
  }
  s.working = "chat";
  render();
  try {
    const modelSel = $("chat-model")?.value;
    const model = modelSel === "__custom__" ? ($("chat-custom")?.value || "").trim() : modelSel;
    s.chat = await api("chat/settings", {
      provider: $("chat-provider")?.value || s.chat.provider,
      apiKey: clear ? "" : ($("chat-key")?.value ?? s.chatKey),
      clearKey: !!clear,
      model,
      temperature: Number($("chat-temp")?.value),
      maxTokens: Number($("chat-maxtok")?.value),
      includeLibrary: !!$("chat-library")?.checked,
      includeConnection: !!$("chat-connection")?.checked,
    });
    s.chatKey = "";
    chatConfiguredChanged(s.chat.configured, s.chat);
    toast(clear ? "Assistant key cleared" : s.chat.configured ? "Assistant saved" : "Saved — add a key to enable chat", 2600);
  } catch (error) {
    toast(error.message, 4000);
  }
  s.working = "";
  render();
}

function syncPromptReset() {
  const c = s.chat, text = $("chat-prompt-text"), reset = $("chat-prompt-reset");
  if (!c || !text || !reset) return;
  const trimmed = text.value.trim();
  const isDefault = !trimmed || trimmed === (c.defaultSystemPrompt || "").trim();
  reset.disabled = isDefault || s.working === "prompt";
}

function openPromptEditor() {
  if (!s.chat) return;
  const dialog = $("chat-prompt"), text = $("chat-prompt-text");
  if (!dialog || !text) return;
  text.value = s.chat.systemPrompt || s.chat.defaultSystemPrompt || "";
  syncPromptReset();
  if (!dialog.open) dialog.showModal();
  text.focus();
}

function closePromptEditor() {
  $("chat-prompt")?.close();
}

async function savePrompt({ reset = false } = {}) {
  if (!s.chat) return;
  s.working = "prompt";
  syncPromptReset();
  const saveBtn = $("chat-prompt-save"), resetBtn = $("chat-prompt-reset");
  if (saveBtn) saveBtn.disabled = true;
  if (resetBtn) resetBtn.disabled = true;
  try {
    const body = reset ? { resetSystemPrompt: true } : { systemPrompt: $("chat-prompt-text")?.value ?? "" };
    s.chat = await api("chat/settings", body);
    toast(s.chat.systemPromptCustom ? "Custom system prompt saved" : "Using the default system prompt", 2600);
    closePromptEditor();
    render();
  } catch (error) {
    toast(error.message, 4000);
  }
  s.working = "";
  if (saveBtn) saveBtn.disabled = false;
  syncPromptReset();
}

function bindPromptDialog() {
  if (s.promptBound) return;
  const dialog = $("chat-prompt");
  if (!dialog) return;
  s.promptBound = true;
  $("chat-prompt-cancel")?.addEventListener("click", closePromptEditor);
  $("chat-prompt-save")?.addEventListener("click", () => savePrompt());
  $("chat-prompt-reset")?.addEventListener("click", () => {
    const text = $("chat-prompt-text");
    if (text && s.chat) text.value = s.chat.defaultSystemPrompt || "";
    syncPromptReset();
    savePrompt({ reset: true });
  });
  $("chat-prompt-text")?.addEventListener("input", syncPromptReset);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) closePromptEditor(); });
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); closePromptEditor(); });
}

function closeKnowledgeViewer() {
  $("chat-knowledge")?.close();
}

async function openKnowledgeViewer() {
  const dialog = $("chat-knowledge"), body = $("chat-knowledge-body");
  if (!dialog || !body) return;
  body.innerHTML = `<p class="muted-note"><span class="spinner sm"></span> Loading&hellip;</p>`;
  if (!dialog.open) dialog.showModal();
  try {
    if (!s.knowledgeMd) {
      const res = await api("chat/knowledge");
      s.knowledgeMd = res.markdown || "";
    }
    body.innerHTML = s.knowledgeMd
      ? mdHtml(s.knowledgeMd)
      : `<p class="muted-note">Knowledge base file is missing.</p>`;
  } catch (error) {
    body.innerHTML = `<p class="muted-note">${esc(error.message)}</p>`;
  }
  body.focus();
}

function bindKnowledgeDialog() {
  if (s.knowledgeBound) return;
  const dialog = $("chat-knowledge");
  if (!dialog) return;
  s.knowledgeBound = true;
  $("chat-knowledge-close")?.addEventListener("click", closeKnowledgeViewer);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) closeKnowledgeViewer(); });
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); closeKnowledgeViewer(); });
}

async function resetPrefs() {
  const ok = await confirmBox({
    title: "Reset view preferences?",
    html: "<p>Sorting, layout, open tabs, theme, clock and scraper choices go back to their defaults and the page reloads. The connection, handheld model and SSH snippets stay.</p>",
    ok: "Reset and reload",
    danger: true,
  });
  if (!ok) return;
  try { for (const k of prefKeys()) localStorage.removeItem(k); } catch {}
  location.reload();
}

function bind() {
  s.bound = true;
  bindPromptDialog();
  bindKnowledgeDialog();
  const root = $("view-settings");
  $("settings-tabs")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-settings-tab]");
    if (!b || b.classList.contains("on")) return;
    store.set("settingsTab", b.dataset.settingsTab);
    s.browse = null;
    render();
  });
  root.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-set], [data-browse], [data-set-theme], [data-set-clock], [data-set-refresh], [data-set-clear], [data-set-play], [data-set-reset]");
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
    if (el.dataset.setPlay) { resetPlay(el.dataset.setPlay); return; }
    if (el.dataset.setReset) { resetPrefs(); return; }
    const action = el.dataset.set;
    const which = el.dataset.which || "roms";
    if (action === "browse") browse(s.data.folders[which].path, which);
    else if (action === "cancel") { s.browse = null; render(); }
    else if (action === "wizard") openWizard();
    else if (action === "shortcut") makeShortcut();
    else if (action === "reset") factoryReset();
    else if (action === "chat-save") saveAssistant(false);
    else if (action === "chat-clear") saveAssistant(true);
    else if (action === "chat-prompt") openPromptEditor();
    else if (action === "chat-knowledge") openKnowledgeViewer();
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
    else if (t.id === "chat-provider" && s.chat) {
      s.chat.provider = t.value;
      const p = s.chat.providers.find((x) => x.id === t.value);
      if (p) s.chat.model = p.defaultModel;
      render();
    } else if (t.id === "chat-model") {
      const custom = t.value === "__custom__";
      const row = $("chat-custom-row"), input = $("chat-custom");
      if (row) row.hidden = !custom;
      if (input) { input.disabled = !custom; if (custom) input.focus(); }
    }
  });
  root.addEventListener("input", (e) => {
    if (e.target.id === "set-browse-path" && s.browse) s.browse.input = e.target.value;
    if (e.target.id === "chat-key") s.chatKey = e.target.value;
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
