// Artwork section: a summary strip, then four tabs: syncing with the device, the Roms/ library's images,
// the artwork on the device, and scraping.

import { $, app, esc, icon, human, ART_KINDS, handheldMode, slowHint, devName, busy, section } from "./core.js";
import { connection, isLive } from "./device.js";
import { libraryTotals, loadDevice, openDeviceGame } from "./games.js";
import { localPanels, afterLocalDraw, bindLocal, showLocalSystem, localTotals, ensureLocalSummary } from "./art-local.js";
import { auditPanel, bindDeviceTools } from "./art-device.js";
import { scrapePanels, afterScrapeDraw, bindScrape, scrapeSystem } from "./art-scrape.js";

const LIST_LIMIT = 400;
const TABS = [["sync", "sync", "Sync"], ["local", "folder", "Roms/ library"], ["device", "handheld", "On device"], ["scrape", "scrape", "Scrape"]];
const TAB_IDS = TABS.map((t) => t[0]);
let tab = TAB_IDS.includes(sessionStorage.getItem("manager.artTab")) ? sessionStorage.getItem("manager.artTab") : "sync";
let filter = "all";
let query = "";
let rows = [];
/** The Roms/ and Scrape tabs only redraw when its own data changes (or a job starts or ends), not on every device refresh. */
let drawn = { tab: "", busy: false };

const panel = (cls, title, body, actions = "", ico = "") =>
  `<section class="panel ${cls}"><h2>${ico ? icon(ico) : ""}${title}</h2>${body}${actions ? `<div class="panel-actions">${actions}</div>` : ""}</section>`;

// ---------------------------------------------------------------- summary strip and tabs

function renderKpis(conn, live) {
  const t = libraryTotals(), local = localTotals(), c = app.device.target;
  const pct = t && t.games ? Math.floor((t.art / t.games) * 100) : 0;
  const issues = local ? local.orphans + local.duplicates + local.convert + local.large : null;
  const kpi = (to, ico, label, value, sub, cls = "") =>
    `<button class="kpi${cls ? " " + cls : ""}${tab === to ? " on" : ""}" data-art-tab="${to}"><span class="kpi-ico">${icon(ico)}</span><span><small>${label}</small><b>${value}</b><em>${sub}</em></span></button>`;
  $("art-kpis").innerHTML = t ? [
    `<div class="kpi ring-kpi"><div class="ring sm" style="--p:${pct}"><b>${pct}%</b></div><span><small>Coverage</small><b>${t.art.toLocaleString()}</b><em>of ${t.games.toLocaleString()} games have art</em></span></div>`,
    kpi("scrape", "scrape", "Missing artwork", (t.games - t.art).toLocaleString(), t.games - t.art ? "Find it with Scrape" : "Nothing missing", t.games - t.art ? "warn" : "ok"),
    kpi("local", "wrench", "Image problems", issues === null ? "&hellip;" : issues.toLocaleString(),
      issues === null ? "Checking Roms/" : issues ? "Leftovers, duplicates, formats" : "All images are fine", issues ? "warn" : issues === 0 ? "ok" : ""),
    kpi("device", "layers", "Device catalogue", live ? esc(c.art || "None") : "&ndash;",
      live ? (c.art ? `MUOS/info/catalogue on ${esc(devName())}` : handheldMode() ? "Created by Scrappy" : "Artwork stays on SD1") : esc(conn.title), live && c.art ? "" : "muted")
  ].join("") : "";
  const badge = { local: issues ? issues.toLocaleString() : "", scrape: t && t.games - t.art ? (t.games - t.art).toLocaleString() : "", device: live && c.art ? esc(c.art) : "" };
  $("art-tabs").innerHTML = TABS.map(([id, ico, label]) =>
    `<button role="tab" data-tab="${id}" class="${tab === id ? "on" : ""}" aria-selected="${tab === id}">${icon(ico)}<span>${label}</span>${badge[id] ? `<small>${badge[id]}</small>` : ""}</button>`).join("");
}

// ---------------------------------------------------------------- sync

function syncPanel(conn, live) {
  const c = app.device.target, t = libraryTotals();
  const name = live ? esc(devName()) : "The device";
  const ok = live && !!c.art && !busy();
  const where = !live ? `${esc(conn.title)}. <a class="link-btn" href="#overview">Connection</a>`
    : c.art ? `MustardOS reads artwork from the catalogue on <b>${esc(c.art)}</b>; Roms/ keeps one PNG per game in &lt;system&gt;/Imgs.`
    : handheldMode() ? `${name} has no artwork catalogue yet. Scrape a game with Scrappy on the handheld to create one.`
    : "This TF2 card has no artwork catalogue, so MustardOS keeps its artwork on SD1 inside the handheld. Connect over USB or Wi-Fi to reach it, or keep the artwork on TF2 from now on.";
  const keep = live && !handheldMode() && !c.art
    ? `<button class="btn" data-art="keep"${busy() ? " disabled" : ""}>${icon("sd")}<span>Keep artwork on TF2</span></button>` : "";
  return panel("full flow-panel", "Sync with the device", `<div class="flow">
      <div class="flow-node">
        <span class="flow-ico">${icon("folder")}</span>
        <b>Roms/ library</b>
        <small>${t ? `${t.art.toLocaleString()} images &middot; ${t.games ? Math.floor((t.art / t.games) * 100) : 0}% of games` : "Loading&hellip;"}</small>
      </div>
      <div class="flow-actions">
        <button class="flow-btn" data-art="send"${ok ? "" : " disabled"}>
          <span>${icon("upload")}<b>Send to ${live ? name : "device"}</b></span><small>Roms/ images into the catalogue</small>${icon("arrow", "flow-dir")}</button>
        <button class="flow-btn back" data-art="get"${ok ? "" : " disabled"}>
          ${icon("arrow", "flow-dir")}<span>${icon("download")}<b>Get from ${live ? name : "device"}</b></span><small>Scrappy images into Roms/</small></button>
      </div>
      <div class="flow-node${live ? "" : " off"}">
        <span class="flow-ico">${icon("handheld")}</span>
        <b>${name}</b>
        <small>${live ? (c.art ? `Catalogue on ${esc(c.art)}` : "No catalogue") : "Not connected"}</small>
      </div>
    </div>
    <div class="muted-note">${where}${busy() ? " Available when the current job finishes." : ""}</div>`, keep, "sync");
}

function coveragePanel() {
  if (!app.data) return panel("full", "Coverage by system", `<div class="muted-note"><span class="spinner sm"></span> Loading&hellip;</div>`, "", "image");
  const systems = app.data.systems.filter((s) => s.games.length)
    .map((s) => ({ s, art: s.games.filter((g) => g.i).length }))
    .sort((a, b) => (a.art / a.s.games.length) - (b.art / b.s.games.length) || b.s.games.length - a.s.games.length);
  const rowsHtml = systems.map(({ s, art }) => {
    const n = s.games.length, pct = Math.floor((art / n) * 100), missing = n - art;
    return `<tr style="--accent:${s.accent}">
      <td><span class="nav-dot"></span>${esc(s.name)} <span class="code">${esc(s.code)}</span></td>
      <td class="bar-cell"><div class="meter${pct === 100 ? " full" : ""}"><i style="width:${pct}%"></i></div><span>${pct}%</span></td>
      <td class="num">${n.toLocaleString()}</td>
      <td class="num">${missing ? `<span class="flag">${missing.toLocaleString()}</span>` : `<span class="nil">${icon("check")}</span>`}</td>
      <td class="row-actions">
        ${missing ? `<button class="btn icon small" data-sys-scrape="${esc(s.code)}" title="Scrape the ${missing} missing images">${icon("scrape")}</button>
          <button class="btn icon small" data-go="missing" data-code="${esc(s.code)}" title="Show the games without artwork">${icon("eye")}</button>` : ""}
        <button class="btn icon small" data-sys-fix="${esc(s.code)}" title="Open Roms/${esc(s.code)}/Imgs">${icon("folder")}</button>
      </td></tr>`;
  }).join("");
  return panel("full", "Coverage by system", `<div class="art-table"><table>
    <thead><tr><th>System</th><th>Artwork</th><th class="num">Games</th><th class="num">Missing</th><th></th></tr></thead>
    <tbody>${rowsHtml}</tbody></table></div>`, "", "image");
}

// ---------------------------------------------------------------- on device

function deviceRows() {
  const out = [];
  for (const sys of app.listing.data.systems) {
    for (const g of sys.games) out.push([sys, g]);
  }
  return out.sort((a, b) => a[1].k.localeCompare(b[1].k, undefined, { numeric: true }));
}

function matchesRow([sys, g]) {
  if (filter === "missing" && g.art.box) return false;
  if (filter === "send" && !(g.lib && g.lib.i && !g.art.box)) return false;
  if (filter === "get" && !(g.art.box && g.lib && !g.lib.i)) return false;
  return !query || g.search.includes(query);
}

function renderDeviceList() {
  const box = $("art-dev-list");
  if (!box) return;
  const shown = rows.map((r, i) => [r[0], r[1], i]).filter(matchesRow);
  const dot = (on, label) => `<span class="chip${on ? " on" : ""}" title="${esc(label)}${on ? "" : " missing"}">${on ? icon("check") : ""}${esc(label)}</span>`;
  box.innerHTML = shown.length ? `<div class="art-table"><table>
    <thead><tr><th>Game</th><th>On ${esc(devName())}</th><th>In Roms/</th><th></th></tr></thead>
    <tbody>${shown.slice(0, LIST_LIMIT).map(([sys, g, i]) => `<tr class="pick" data-row="${i}" tabindex="0" aria-label="${esc(g.t)}: open its artwork" style="--accent:${sys.accent}">
      <td><b>${esc(g.t)}</b> <span class="code">${esc(sys.folder)}</span><br><small>${esc(g.f)}</small></td>
      <td>${ART_KINDS.map(([k, label]) => dot(!!g.art[k], label)).join("")}</td>
      <td>${g.lib ? dot(!!g.lib.i, "Artwork") : `<small>Not in Roms/</small>`}</td>
      <td class="row-go">${icon("right")}</td>
    </tr>`).join("")}</tbody></table></div>
    ${shown.length > LIST_LIMIT ? `<div class="muted-note">Showing ${LIST_LIMIT} of ${shown.length.toLocaleString()}. Search to narrow it down.</div>` : ""}`
    : `<div class="muted-note">${rows.length ? "No games match." : `No games on ${esc(devName())} yet.`}</div>`;
}

function devicePanel(live) {
  const name = live ? esc(devName()) : "the device";
  const title = `Artwork of each game on ${name}`;
  if (!live) return panel("full", title, `<div class="empty-state">${icon("handheld")}<p>Connect the handheld or insert TF2 to see its artwork.</p></div>`, "", "handheld");
  const c = app.device.target, l = app.listing;
  if (!c.art && !handheldMode()) return panel("full", title, `<div class="muted-note">This card has no artwork catalogue; its artwork is on SD1 in the handheld.</div>`, "", "handheld");
  if (l.status === "error") return panel("full", title, `<div class="notice err">${esc(l.error)}</div>`, `<button class="btn" data-dev-art="reload">${icon("refresh")}<span>Try again</span></button>`, "handheld");
  if (l.status !== "ready") {
    return panel("full", title, `<div class="muted-note"><span class="spinner sm"></span> Reading the games on ${name}&hellip;${slowHint()}</div>`, "", "handheld");
  }
  rows = deviceRows();
  const count = (fn) => rows.filter(fn).length;
  const filters = [
    ["all", "All", rows.length],
    ["missing", "No box art", count(([, g]) => !g.art.box)],
    ["send", "Can send from Roms/", count(([, g]) => g.lib && g.lib.i && !g.art.box)],
    ["get", "Can get into Roms/", count(([, g]) => g.art.box && g.lib && !g.lib.i)]
  ];
  return panel("full", title, `<div class="art-tools">
      <div class="segmented" id="art-filter">${filters.map(([id, label, n]) => `<button data-filter="${id}" class="${filter === id ? "on" : ""}">${label} <small>${n.toLocaleString()}</small></button>`).join("")}</div>
      <div class="search small">${icon("search")}<input id="art-q" type="search" placeholder="Search games" aria-label="Search games" value="${esc(query)}" autocomplete="off" spellcheck="false"></div>
    </div>
    <div class="muted-note">Pick a game to get, send, upload, replace or delete its images.</div>
    <div id="art-dev-list"></div>`, "", "handheld");
}

// ---------------------------------------------------------------- drawing

function redrawTab() {
  drawn.tab = "";
  renderArtwork();
}

export function renderArtwork() {
  if (section() !== "artwork" || !$("artwork")) return;
  const conn = connection();
  const live = isLive(conn);
  $("art-sub").textContent = live
    ? `Roms/ and ${devName()}${app.device.target.art ? ` (catalogue on ${app.device.target.art})` : ""}`
    : "Roms/ artwork; connect the handheld to sync";
  ensureLocalSummary(redrawTab);
  renderKpis(conn, live);
  if (tab === "local") {
    if (drawn.tab === "local" && drawn.busy === busy()) return;
    $("artwork").innerHTML = localPanels(redrawTab);
    afterLocalDraw();
  } else if (tab === "scrape") {
    if (drawn.tab === "scrape" && drawn.busy === busy()) return;
    $("artwork").innerHTML = scrapePanels(redrawTab);
    afterScrapeDraw();
  } else if (tab === "device") {
    $("artwork").innerHTML = [auditPanel(live, redrawTab), devicePanel(live)].join("");
    renderDeviceList();
    if (live && app.listing.status === "idle") loadDevice();
  } else {
    $("artwork").innerHTML = [syncPanel(conn, live), coveragePanel()].join("");
  }
  drawn = { tab, busy: busy() };
}

export function showArtTab(name, code) {
  if (!TAB_IDS.includes(name)) return;
  tab = name;
  sessionStorage.setItem("manager.artTab", tab);
  if (code && name === "local") showLocalSystem(code);
  if (section() === "artwork") redrawTab(); else location.hash = "#artwork";
}

export function bindArtworkView() {
  const root = $("artwork");
  $("art-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) showArtTab(b.dataset.tab);
  });
  $("art-kpis").addEventListener("click", (e) => {
    const b = e.target.closest("[data-art-tab]");
    if (b) showArtTab(b.dataset.artTab);
  });
  bindLocal(root, () => tab === "local");
  bindDeviceTools(root, () => tab === "device");
  bindScrape(root, () => tab === "scrape");
  root.addEventListener("click", (e) => {
    const go = e.target.closest("[data-art-tab]");
    if (go) { showArtTab(go.dataset.artTab); return; }
    const scrape = e.target.closest("[data-sys-scrape]");
    if (scrape) { scrapeSystem(scrape.dataset.sysScrape); showArtTab("scrape"); return; }
    const fix = e.target.closest("[data-sys-fix]");
    if (fix) { showArtTab("local", fix.dataset.sysFix); return; }
    if (tab !== "device") return;
    const f = e.target.closest("[data-filter]");
    if (f) {
      filter = f.dataset.filter;
      root.querySelectorAll("#art-filter button").forEach((b) => b.classList.toggle("on", b === f));
      renderDeviceList();
      return;
    }
    if (e.target.closest("[data-dev-art='reload']")) { loadDevice(); return; }
    const row = e.target.closest("tr.pick");
    if (row) {
      const [sys, g] = rows[+row.dataset.row] || [];
      if (g) openDeviceGame(sys, g, true);
    }
  });
  root.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr.pick")) {
      e.preventDefault();
      e.target.click();
    }
  });
  let timer;
  root.addEventListener("input", (e) => {
    if (tab !== "device" || e.target.id !== "art-q") return;
    clearTimeout(timer);
    timer = setTimeout(() => { query = e.target.value.trim().toLowerCase(); renderDeviceList(); }, 120);
  });
}
