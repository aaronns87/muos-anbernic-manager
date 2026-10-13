// Overview: the connection, the device, how the library and the device compare, and the workspace.

import { $, app, api, esc, human, plural, initial, icon, ICONS, EXCLUDED, model, modelInfo, cardWord, usbMode, handheldMode, devName, devWord, ready, busy, isOnCard, osVersion, scanWhen, section } from "./core.js";
import { connection, deviceButtons, modePicker, isLive, wifiForm, filebrowserUrl, storages, storeRow, renderDevice, alternative } from "./device.js";
import { specs } from "./devices.js";
import { openCardModel } from "./model-pick.js";
import { libraryTotals } from "./games.js";
import { activityPanel } from "./activity.js";

let loadToken = 0;

export function resetOverview() {
  Object.assign(app.overview, { info: null, infoFor: "", infoError: "", summary: null, summaryFor: "", summaryError: "", loading: "" });
  loadToken++;
}

async function loadWorkspace() {
  if (app.overview.workspace || app.overview.loadingWorkspace) return;
  app.overview.loadingWorkspace = true;
  try { app.overview.workspace = await api("workspace"); } catch (error) { app.overview.workspace = { error: error.message, os: [], apps: [] }; }
  app.overview.loadingWorkspace = false;
  renderOverview();
}

/** The device details (identity, cards, battery); the sidebar needs them too. Over USB this takes a few seconds. */
export async function loadInfo() {
  const o = app.overview, c = app.device.target;
  if (!ready() || o.loading || (busy() && usbMode()) || o.infoFor === c.id) return;
  const id = c.id, token = loadToken;
  o.loading = "info";
  renderDevice();
  try { o.info = await api("device/info?volume=" + encodeURIComponent(id)); o.infoError = ""; }
  catch (error) { o.info = null; o.infoError = error.message; }
  if (token !== loadToken) return;
  o.infoFor = id;
  o.loading = "";
  renderDevice();
}

/** Counts of the games on the device; only the overview shows them. */
async function loadSummary() {
  const o = app.overview, c = app.device.target;
  if (!ready() || o.loading || (busy() && usbMode()) || o.infoFor !== c.id || o.summaryFor === c.id) return;
  const id = c.id, token = loadToken;
  o.loading = "summary";
  renderOverview();
  try { o.summary = await api("device/summary?volume=" + encodeURIComponent(id)); o.summaryError = ""; }
  catch (error) { o.summary = null; o.summaryError = error.message; }
  if (token !== loadToken) return;
  o.summaryFor = id;
  o.loading = "";
  renderOverview();
}

const spinner = `<span class="spinner sm"></span>`;
const kv = (rows) => `<dl class="kv">${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
const panel = (cls, title, body, actions = "", ico = "") =>
  `<section class="panel ${cls}"><h2>${ico ? icon(ico) : ""}${title}</h2>${body}${actions ? `<div class="panel-actions">${actions}</div>` : ""}</section>`;
const stat = (value, label, cls = "") => `<div class="stat${cls ? " " + cls : ""}"><b>${value}</b><span>${label}</span></div>`;
const ring = (pct, caption = "") => `<div class="ring" style="--p:${Math.max(0, Math.min(100, pct))}"><b>${pct}%</b>${caption ? `<small>${caption}</small>` : ""}</div>`;
const fact = (ico, label, value, sub = "") => `<div class="fact">${icon(ico)}<div><small>${esc(label)}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ""}</div></div>`;

function ago(seconds) {
  const d = Math.floor((Date.now() / 1000 - seconds) / 86400);
  return d < 1 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : d < 365 ? `${Math.floor(d / 30)} mo ago` : `${Math.floor(d / 365)} yr ago`;
}

// ---------------------------------------------------------------- the device

function devicePanel(conn) {
  const c = app.device.target, h = app.device.handheld, o = app.overview, live = isLive(conn);
  const head = `<div class="conn-head"><div class="conn-icon">${conn.icon}</div><div class="conn-text">
    <h3>${esc(conn.title)}${conn.code ? ` <span class="code">${esc(conn.code)}</span>` : ""}</h3>
    <p>${conn.state === "checking" ? `${ICONS.spin} ` : ""}${esc(live ? conn.tip || conn.sub : conn.sub)}</p></div>
    <span class="pill ${live ? "ok" : conn.state === "checking" ? "" : conn.cls === "err" ? "bad" : "warn"}">${live ? "Connected" : conn.state === "checking" ? "Checking" : "Not connected"}</span></div>`;
  let body = "";
  if (live) {
    const id = o.info?.identity || {};
    const w = app.device.wifi || {};
    const via = conn.state === "usb" ? ["cable", "Connection", "USB \u00b7 MTP", h && h.speed ? esc(h.speed) : ""]
      : conn.state === "wifi" ? ["wifi", "Connection", "Wi-Fi \u00b7 SFTP", `<code>${esc(`${w.host}:${w.port}`)}</code>`]
      : ["sd", "Connection", "Card reader", `${esc(c.fs === "fat" ? "FAT32" : "exFAT")} \u00b7 <code>${esc(c.mount || c.id)}</code>`];
    const battery = typeof id.battery === "number" && id.battery > 0 ? id.battery : 0;
    const { device: m, via: known } = modelInfo();
    const how = { usb: "Reported over USB", wifi: "Read from MustardOS over Wi-Fi", ssh: "Read from MustardOS over SSH", card: "Chosen for this card", picked: "From the model picker" }[known];
    const facts = [
      fact(via[0], via[1], via[2], via[3]),
      fact("handheld", "Handheld", esc(m.name), c.mode === "card" ? `${esc(how)} &middot; <button class="link-btn" data-ov="model">Change</button>` : esc(how)),
      fact("layers", "MustardOS", esc(osVersion(id.version) || "Installed"), id.serial ? `Serial <code>${esc(id.serial)}</code>` : esc(id.model || model().name)),
      battery ? fact("battery", "Battery", `${battery}%`, `<span class="meter${battery <= 15 ? " bad" : ""}"><i style="width:${battery}%"></i></span>`) : "",
      fact("image", "Artwork catalogue", esc(c.art ? `On ${c.art}` : handheldMode() ? "None yet" : "On SD1"), c.art ? "MUOS/info/catalogue" : handheldMode() ? "Scrappy creates it" : "Not on this card"),
      fact("transfer", "Games go to", esc(c.storage === "SD1" ? "SD1" : handheldMode() ? "SD2 (TF2)" : "This card"), o.info ? (o.info.roms_folder ? "ROMS folder present" : "ROMS created on first transfer") : "")
    ].filter(Boolean).join("");
    const list = storages();
    const stores = list ? list.map((s) => storeRow(s, { card: c.mode === "card" })).join("")
      : o.infoError ? `<div class="notice err">${esc(o.infoError)}</div>` : `<div class="muted-note">${spinner} Reading the cards&hellip;</div>`;
    body = `<div class="facts">${facts}</div><div class="stores grid">${stores}</div>`;
    if (conn.state === "wifi") body += `<details class="wifi-settings"><summary>Wi-Fi settings</summary>${wifiForm()}</details>`;
  } else {
    if (conn.steps.length) body = `<ol class="steps">${conn.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`;
    if (app.ui.mode === "wifi" && conn.state !== "checking") body += wifiForm();
    if (h && app.ui.mode === "usb") body += kv([["Model", esc(h.name)], ["USB function", esc(h.function || "-")], h.serial ? ["Serial", `<code>${esc(h.serial)}</code>`] : null]);
  }
  const alt = alternative();
  if (alt) body += `<div class="notice">${icon("info")} ${esc(alt.text)} Use the button below to switch.</div>`;
  const actions = live
    ? `<button class="btn primary" data-device="browse">${icon("handheld")}<span>Games on ${esc(devWord())}</span></button>${deviceButtons(conn)}`
    : deviceButtons(conn);
  return `<section class="panel wide conn ${live ? "live" : conn.cls}">${head}${body}${actions ? `<div class="panel-actions">${actions}</div>` : ""}</section>`;
}

// ---------------------------------------------------------------- library and device side by side

/** What of Roms/ is on the device: games, bytes still to transfer, and copies that differ. */
function syncCounts() {
  let total = 0, on = 0, differ = 0, missing = 0, bytes = 0;
  for (const sys of app.data.systems) {
    if (EXCLUDED.has(sys.code)) continue;
    for (const g of sys.games) {
      total++;
      const s = app.device.files[sys.code + "/" + g.f];
      if (s === "changed") differ++;
      if (isOnCard(sys, g)) on++;
      else { missing++; bytes += g.s; }
    }
  }
  return { total, on, differ, missing, bytes };
}

function syncPanel(conn) {
  const title = "Library on the device";
  if (!app.data) return panel("", title, `<div class="muted-note">${spinner} Loading&hellip;</div>`, "", "sync");
  if (!isLive(conn)) return panel("", title, `<div class="empty-state">${icon("sync")}<p>Connect the handheld or insert ${esc(cardWord())} to compare it with Roms/.</p></div>`, "", "sync");
  if (app.device.error) return panel("", title, `<div class="notice err">${esc(app.device.error)}</div>`, "", "sync");
  const s = syncCounts();
  const pct = s.total ? Math.floor((s.on / s.total) * 100) : 0;
  return panel("sync-panel", title, `<div class="ring-row">${ring(pct, "on " + esc(devWord()))}
      <ul class="legend">
        <li><i class="ok"></i><b>${s.on.toLocaleString()}</b> on ${esc(devName())}</li>
        <li><i></i><b>${s.missing.toLocaleString()}</b> not transferred <span>${human(s.bytes)}</span></li>
        ${s.differ ? `<li><i class="warn"></i><b>${s.differ.toLocaleString()}</b> differ from Roms/</li>` : ""}
      </ul></div>`,
    s.missing ? `<button class="btn" data-go="not-on-device">${icon("select")}<span>Pick games to transfer</span></button>` : `<span class="muted-note">${icon("check")} Everything in Roms/ is on ${esc(devName())}.</span>`,
    "sync");
}

function onDevicePanel(conn) {
  const o = app.overview, live = isLive(conn);
  const title = `On ${live ? esc(devName()) : "the device"}${o.loading === "summary" ? ` ${spinner}` : ""}`;
  if (!live) return panel("half", title, `<div class="empty-state">${icon("handheld")}<p>Nothing connected.</p></div>`, "", "handheld");
  if (o.summaryError) return panel("half", title, `<div class="notice err">${esc(o.summaryError)}</div>`, "", "handheld");
  const s = o.summary;
  if (!s) {
    const note = busy() && usbMode() ? "Counts appear when the current job finishes." : `Counting the games on ${esc(devName())}&hellip;`;
    return panel("half", title, `<div class="muted-note">${spinner} ${note}</div>`, "", "handheld");
  }
  const only = Math.max(0, s.games - s.in_library);
  return panel("half", title, `<div class="numbers">
      ${stat(s.games.toLocaleString(), "games")}
      ${stat(s.systems.toLocaleString(), "systems")}
      ${stat(human(s.bytes), "of ROMs")}
      ${stat(s.in_library.toLocaleString(), "also in Roms/")}
      ${stat(only.toLocaleString(), "only on device", only ? "warn" : "")}
      ${stat(s.catalogues.toLocaleString(), "artwork folders")}
    </div>${s.games ? "" : `<div class="muted-note">No games yet. Select games in Games and transfer them.</div>`}`,
    `<button class="btn" data-device="browse">${icon("arrow")}<span>Browse ${esc(devWord())}</span></button>`, "handheld");
}

function libraryPanel() {
  const t = libraryTotals();
  if (!t) return panel("half", "Roms/ library", `<div class="muted-note">${spinner} Loading&hellip;</div>`, "", "folder");
  const systems = app.data.systems.filter((s) => s.games.length).sort((a, b) => b.games.length - a.games.length);
  const top = systems.slice(0, 6), max = top[0]?.games.length || 1;
  const cats = {};
  for (const s of systems) cats[s.cat] = (cats[s.cat] || 0) + s.games.length;
  return panel("half", "Roms/ library", `<div class="numbers">
      ${stat(t.games.toLocaleString(), "games")}
      ${stat(`${t.filled}<small>/${t.systems}</small>`, "systems")}
      ${stat(human(t.bytes), "on disk")}
    </div>
    <div class="bars">${top.map((s) => `<button class="bar-row" data-go="system" data-code="${esc(s.code)}" style="--accent:${s.accent}" title="Show ${esc(s.name)}">
      <span class="bar-name"><span>${esc(s.name)}</span><span class="code">${esc(s.code)}</span></span>
      <span class="bar-track"><i style="width:${Math.max(3, Math.round((s.games.length / max) * 100))}%"></i></span>
      <b>${s.games.length.toLocaleString()}</b></button>`).join("")}</div>
    <div class="cat-chips">${Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<span>${esc(c)} <b>${n.toLocaleString()}</b></span>`).join("")}</div>
    <div class="muted-note">Scanned ${esc(scanWhen(app.data.generated))} from <code>${esc(app.data.roms || "Roms/")}</code>. Games rescans whenever you open it.</div>`,
    `<button class="btn" data-go="games">${icon("arrow")}<span>Open library</span></button>`, "folder");
}

function recentPanel() {
  if (!app.data) return panel("wide", "Recently added", `<div class="muted-note">${spinner} Loading&hellip;</div>`, "", "clock");
  const recent = app.data.systems.flatMap((s) => s.games.map((g) => [s, g])).sort((a, b) => b[1].m - a[1].m).slice(0, 8);
  if (!recent.length) return panel("wide", "Recently added", `<div class="empty-state">${icon("folder")}<p>No games in Roms/ yet.</p></div>`, "", "clock");
  return panel("wide", "Recently added", `<div class="recent">${recent.map(([s, g]) => `<button class="recent-item" data-go="search" data-q="${esc(g.t)}" style="--accent:${s.accent}" title="${esc(g.t)} (${esc(s.code)}/${esc(g.f)})">
      <span class="recent-art">${g.i ? `<img loading="lazy" src="${g.i}" alt="">` : `<span class="ph">${esc(initial(g.t))}</span>`}${isOnCard(s, g) ? `<span class="recent-on" title="On ${esc(devName())}">${icon("check")}</span>` : ""}</span>
      <b>${esc(g.t)}</b><small><span class="code">${esc(s.code)}</span> ${ago(g.m)}</small></button>`).join("")}</div>`, "", "clock");
}

function artworkPanel() {
  const t = libraryTotals();
  if (!t) return panel("", "Artwork", `<div class="muted-note">${spinner} Loading&hellip;</div>`, "", "image");
  const pct = (n) => (t.games ? Math.floor((n / t.games) * 100) : 0);
  const missing = t.games - t.art;
  return panel("", "Artwork", `<div class="ring-row">${ring(pct(t.art), "box art")}
      <ul class="legend">
        <li><i class="ok"></i><b>${t.art.toLocaleString()}</b> with artwork</li>
        <li><i class="${missing ? "warn" : ""}"></i><b>${missing.toLocaleString()}</b> missing</li>
        <li><i></i><b>${pct(t.described)}%</b> described</li>
      </ul></div>`,
    `<button class="btn" data-go="art-scrape">${icon("scrape")}<span>Scrape</span></button>${missing ? `<button class="btn ghost" data-go="missing">${icon("eye")}<span>Show missing</span></button>` : ""}`, "image");
}

function workspacePanel() {
  const w = app.overview.workspace;
  if (!w) return panel("half", "Workspace", `<div class="muted-note">${spinner} Loading&hellip;</div>`, "", "box");
  if (w.error) return panel("half", "Workspace", `<div class="notice err">${esc(w.error)}</div>`, `<button class="btn" data-go="workspace-retry">${icon("refresh")}<span>Try again</span></button>`, "box");
  const list = (items, empty) => items.length
    ? `<ul class="files-list">${items.map((f) => `<li><code title="${esc(f.name)}">${esc(f.name)}</code><span>${human(f.size)}</span></li>`).join("")}</ul>`
    : `<div class="muted-note">${empty}</div>`;
  const base = (dir, fallback) => `${dir ? dir.split(/[\\/]/).filter(Boolean).pop() : fallback}/`;
  const os = base(w.osDir, "os"), apps = base(w.appsDir, "apps");
  return panel("half", "Workspace", `${w.root ? kv([["Folder", `<code>${esc(w.root)}</code>`]]) : ""}
    <h3 class="sub-head">MustardOS images <small title="${esc(w.osDir || "")}">${esc(os)}</small></h3>${list(w.os, `No images in ${esc(os)}.`)}
    <h3 class="sub-head">Apps and updates <small title="${esc(w.appsDir || "")}">${esc(apps)}</small></h3>${list(w.apps, `No apps in ${esc(apps)}.`)}`, "", "box");
}

function hardwarePanel() {
  const m = model();
  return panel("half", `${esc(m.maker)} ${esc(m.name)}`, kv(specs(m).map(([k, v]) => [k, esc(v)])), "", "chip");
}

export function renderOverview() {
  if (!$("overview") || section() !== "overview") return;
  const conn = connection();
  const typed = [...$("overview").querySelectorAll(".wifi-form input")].map((i) => [i.id, i.value]);
  const focused = document.activeElement && document.activeElement.closest(".wifi-form") ? document.activeElement.id : "";
  const open = !!$("overview").querySelector(".wifi-settings[open]");
  $("overview").innerHTML = [
    devicePanel(conn), syncPanel(conn),
    libraryPanel(), onDevicePanel(conn),
    recentPanel(), artworkPanel(),
    workspacePanel(), hardwarePanel(),
    activityPanel()
  ].join("");
  for (const [id, value] of typed) if ($(id)) $(id).value = value;
  if (open && $("overview").querySelector(".wifi-settings")) $("overview").querySelector(".wifi-settings").open = true;
  if (focused && $(focused)) $(focused).focus();
  const live = isLive(conn);
  $("ov-sub").textContent = live
    ? `${conn.title} ${conn.state === "wifi" ? "over Wi-Fi" : usbMode() ? "over USB" : "in the card reader"}`
    : conn.state === "checking" ? `${conn.title}\u2026` : conn.title;
  $("ov-actions").innerHTML = `<span class="mode-label">Connect with</span>${modePicker()}`;
  loadWorkspace();
  loadInfo();
  loadSummary();
}

document.addEventListener("click", (e) => { if (e.target.closest('[data-ov="model"]')) openCardModel(); });
