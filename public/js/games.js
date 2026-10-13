// Games: the Roms/ library, the games on the device, and the dialogs for one game.

import {
  $, app, api, esc, human, plural, initial, highlight, store, copyText, toast, section, icon, scanWhen,
  ACCENTS, EXCLUDED, ART_KINDS, ICONS, TOKEN,
  handheldMode, slowHint, devName, devWord, cardWord, busy, ready, keyOf, onCardState, isOnCard, canCopy
} from "./core.js";
import { renderDevice } from "./device.js";
import { startPlan } from "./copy.js";
import { renderCurrent } from "./views.js";
import { showArtTab } from "./artwork-view.js";
import { artMax, pngData, pickImage, droppedImage, confirmBox } from "./art-images.js";
import { consoleIcon } from "./consoles.js";
import { portsSection } from "./ports.js";
import { openFreeScummvm } from "./free-scummvm.js";
import { bindGameView, enrichViewer } from "./game-view.js";

// ---------------------------------------------------------------- library data

export async function loadLibrary() {
  const data = await api("games");
  data.systems.forEach((sys) => {
    sys.accent = ACCENTS[sys.cat] || ACCENTS.Other;
    sys.games.forEach((g) => {
      const m = g.lb ? data.meta[g.lb] : null;
      g.genres = genresOf(m);
      g.rate = m && m.r ? m.r : 0;
      g.year = m && m.y ? +String(m.y).slice(0, 4) || 0 : 0;
      const extra = m ? [m.g, m.dev, m.pub, m.y].filter(Boolean).join(" ") : "";
      g.search = [g.t, g.f, g.a, g.g.join(" "), sys.name, sys.code, extra].join(" ").toLowerCase();
    });
  });
  if (!app.data) {
    app.ui.collapsed = new Set(data.systems.map((s) => s.code));
    applyView();
  }
  app.data = data;
  app.libraryError = "";
  fillMetaFilters();
  resetListing();
  renderStats();
  renderCurrent();
}

/** Loads the library at startup or from Try again, keeping the error on screen if it fails. */
export function startLibraryLoad() {
  app.libraryError = "";
  if (section() === "games") render();
  loadLibrary().catch((error) => {
    app.libraryError = error.message;
    if (section() === "games") render();
    toast(error.message, 4000);
  });
}

export function libraryTotals() {
  if (!app.data) return null;
  const all = app.all;
  return {
    games: all.length,
    systems: app.data.systems.length,
    filled: app.data.systems.filter((s) => s.games.length).length,
    art: all.filter((g) => g.i).length,
    described: all.filter((g) => g.lb && app.data.meta[g.lb]?.d).length,
    bytes: all.reduce((a, g) => a + g.s, 0)
  };
}

export function renderStats() {
  const data = app.data;
  data.systems.forEach((sys) => {
    sys.bytes = sys.games.reduce((a, g) => a + g.s, 0);
    sys.art = sys.games.filter((g) => g.i).length;
  });
  app.all = data.systems.flatMap((s) => s.games);
  const t = libraryTotals();
  const pct = t.games ? Math.floor((t.art / t.games) * 100) : 0;
  const descPct = t.games ? Math.floor((t.described / t.games) * 100) : 0;
  $("games-count").textContent = t.games.toLocaleString();
  $("art-count").textContent = `${pct}%`;
  $("stats").innerHTML = `
    <span class="hstat"><b>${t.games.toLocaleString()}</b> games</span>
    <span class="hstat" title="${t.systems - t.filled} of ${t.systems} system folders are empty"><b>${t.filled}/${t.systems}</b> systems</span>
    <span class="hstat" title="${t.art.toLocaleString()} games with artwork"><b>${pct}%</b> artwork <span class="meter"><i style="width:${pct}%"></i></span></span>
    <span class="hstat" title="${t.described.toLocaleString()} games with a description"><b>${descPct}%</b> descriptions <span class="meter"><i style="width:${descPct}%"></i></span></span>
    <span class="hstat"><b>${human(t.bytes)}</b></span>
    <span class="hstat built" id="scan-state" title="Scanned ${esc(data.generated)} from ${esc(data.roms || data.root + "/Roms")}"></span>`;
  $("games-add").innerHTML = `<button class="btn" id="open-ports" title="Browse and install PortMaster ports on the handheld">${icon("web")}<span>Ports</span></button>
    <button class="btn primary" id="add-games" title="Add game files to the library">${icon("plus")}<span>Add games</span></button>`;
  renderScanState();
}

let lastScan = 0, scanning = false;

/** "14:35" for a scan from today, otherwise the full "2026-10-12 14:35". */
function renderScanState() {
  const el = $("scan-state");
  if (el) el.innerHTML = scanning ? `${ICONS.spin} Checking Roms/&hellip;` : `${icon("check")} Scanned ${esc(scanWhen(app.data.generated))}`;
}

/** Scans Roms/ again quietly when Games opens; only redraws when the games or their artwork changed. */
export async function autoRescan() {
  if (!app.data || scanning || busy() || Date.now() - lastScan < 4000) return;
  scanning = true;
  lastScan = Date.now();
  renderScanState();
  try {
    const result = await api("games/rescan", {});
    if (result.sig && result.sig !== app.data.sig) {
      await loadLibrary();
      toast(`Roms/ changed: ${result.games.toLocaleString()} games`, 2500);
    }
  } catch {}
  scanning = false;
  renderScanState();
}

export async function rescan() {
  if (busy()) { toast("Wait for the current job to finish first"); return; }
  $("busy-text").textContent = "Scanning Roms/\u2026";
  $("busy").hidden = false;
  try {
    await api("games/rescan", {});
    await loadLibrary();
    toast(`Found ${app.all.length.toLocaleString()} games in Roms/`);
  } catch (error) {
    toast(error.message, 3000);
  }
  $("busy").hidden = true;
}

// ---------------------------------------------------------------- genre, rating and year

const GENRE_ALIASES = { "Driving": "Racing", "Jump & Scrolling": "Platform", "Questions in English": "Quiz" };

/** A game's genres from its description, with MAME's "Main / Detail" names folded into the main genre. */
function genresOf(m) {
  if (!m || !m.g) return [];
  const names = String(m.g).split(/,\s*/).map((x) => x.split(" / ")[0].trim()).filter(Boolean).map((x) => GENRE_ALIASES[x] || x);
  return [...new Set(names)];
}

const RATINGS = { "4.5": (r) => r >= 4.5, "4": (r) => r >= 4, "3.5": (r) => r >= 3.5, "3": (r) => r >= 3, "2": (r) => r >= 2, low: (r) => r > 0 && r < 2, none: (r) => !r };

/** Fills the genre and year menus from the library, keeping the current choices. */
function fillMetaFilters() {
  const ui = app.ui, genres = {}, years = {};
  let noGenre = 0, noYear = 0;
  app.data.systems.forEach((sys) => sys.games.forEach((g) => {
    g.genres.length ? g.genres.forEach((x) => { genres[x] = (genres[x] || 0) + 1; }) : noGenre++;
    g.year ? (years[g.year] = (years[g.year] || 0) + 1) : noYear++;
  }));
  const count = (n) => ` \u00b7 ${n.toLocaleString()}`;
  $("genre").innerHTML = `<option value="all">Any genre</option>`
    + Object.entries(genres).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([x, n]) => `<option value="${esc(x)}">${esc(x)}${count(n)}</option>`).join("")
    + (noGenre ? `<option value="none">No genre${count(noGenre)}</option>` : "");
  const decades = {};
  Object.keys(years).map(Number).sort((a, b) => a - b).forEach((y) => { (decades[Math.floor(y / 10) * 10] ||= []).push(y); });
  $("year").innerHTML = `<option value="all">Any year</option>`
    + Object.entries(decades).map(([d, ys]) => `<optgroup label="${d}s">
        <option value="d${d}">All ${d}s${count(ys.reduce((a, y) => a + years[y], 0))}</option>
        ${ys.map((y) => `<option value="y${y}">${y}${count(years[y])}</option>`).join("")}</optgroup>`).join("")
    + (noYear ? `<option value="none">Unknown year${count(noYear)}</option>` : "");
  for (const key of ["genre", "year"]) {
    if (![...$(key).options].some((o) => o.value === ui[key])) ui[key] = "all";
    $(key).value = ui[key];
  }
}

/** Genre, rating and year filters; g is a library game (device games pass their Roms/ copy). */
function metaMatches(g) {
  const ui = app.ui;
  if (ui.genre !== "all" && !(ui.genre === "none" ? !g.genres.length : g.genres.includes(ui.genre))) return false;
  if (ui.rating !== "all" && !RATINGS[ui.rating](g.rate)) return false;
  if (ui.year !== "all") {
    if (ui.year === "none") return !g.year;
    if (ui.year[0] === "d") return Math.floor(g.year / 10) * 10 === +ui.year.slice(1);
    return g.year === +ui.year.slice(1);
  }
  return true;
}

const metaFiltering = () => app.ui.genre !== "all" || app.ui.rating !== "all" || app.ui.year !== "all";

// ---------------------------------------------------------------- the library view

const sorters = {
  title: (a, b) => a.k.localeCompare(b.k, undefined, { numeric: true }) || a.f.localeCompare(b.f),
  size: (a, b) => b.s - a.s,
  recent: (a, b) => b.m - a.m,
  type: (a, b) => a.x.localeCompare(b.x) || a.k.localeCompare(b.k, undefined, { numeric: true }),
  rating: (a, b) => b.rate - a.rate || sorters.title(a, b),
  newest: (a, b) => b.year - a.year || sorters.title(a, b),
  oldest: (a, b) => (a.year || 9999) - (b.year || 9999) || sorters.title(a, b)
};

function matches(g, sys) {
  const ui = app.ui;
  if (ui.art === "with" && !g.i) return false;
  if (ui.art === "without" && g.i) return false;
  if (ui.onCard !== "all" && app.device.target) {
    if (EXCLUDED.has(sys.code)) return false;
    if (ui.onCard === "on" && !isOnCard(sys, g)) return false;
    if (ui.onCard === "missing" && isOnCard(sys, g)) return false;
  }
  if (!metaMatches(g)) return false;
  return !ui.q || g.search.includes(ui.q);
}

/** The rating or year on a card while sorting by it, so the order is visible. */
function sortBadge(g) {
  const sort = app.ui.sort;
  if (sort === "rating") return g.rate ? `<span class="sort-badge">&#9733; ${g.rate.toFixed(1)}</span>` : "";
  if (sort === "newest" || sort === "oldest") return g.year ? `<span class="sort-badge">${g.year}</span>` : "";
  return "";
}

function card(g, si, idx) {
  const sys = app.data.systems[si], q = app.ui.q;
  const art = g.i
    ? `<img loading="lazy" decoding="async" src="${g.i}" alt="">`
    : `<span class="ph">${esc(initial(g.t))}</span>`;
  const tags = g.g.slice(0, 4).map((t) => `<span>${highlight(t, q)}</span>`).join("");
  const cardState = onCardState(sys, g);
  const badge = cardState
    ? `<span class="badge-on${cardState === "changed" ? " changed" : ""}">${cardState === "changed" ? "DIFFERS" : `ON ${devWord().toUpperCase()}`}</span>` : "";
  const copy = canCopy(sys)
    ? `<button class="card-transfer" data-v="${idx}" title="Transfer to ${esc(devName())}" aria-label="Transfer ${esc(g.t)} to ${esc(devName())}">${ICONS.up}</button>` : "";
  const key = keyOf(sys, g), on = app.sel.has(key);
  return `<article class="game${on ? " sel" : ""}" tabindex="0" data-v="${idx}" data-k="${esc(key)}">
    <div class="art">${art}${pickBox(on)}${sortBadge(g)}${badge}${copy}</div>
    <div class="info"><h3 title="${esc(g.t)}">${highlight(g.t, q)}</h3>
      ${tags ? `<div class="tags">${tags}</div>` : ""}
      <div class="file" title="${esc(g.f)}">${highlight(g.f, q)} &middot; ${human(g.s)}</div></div>
  </article>`;
}

const chevron = `<svg class="chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>`;
const pickBox = (on) => `<span class="pick" role="checkbox" aria-checked="${on}" aria-label="Select" title="Select (shift-click for a range)">${icon("check")}</span>`;
const sysPick = (code) => `<button class="sys-pick" data-pick-sys="${esc(code)}" title="Select every shown game in this system" aria-label="Select system">${icon("check")}</button>`;

export function render() {
  if (!app.data) {
    $("games-list").innerHTML = app.libraryError
      ? `<div class="dev-note"><div class="notice err">${esc(app.libraryError)}</div><button class="btn" data-lib="retry">${icon("refresh")}<span>Try again</span></button></div>`
      : `<div class="dev-note"><span class="spinner"></span> Loading the library&hellip;</div>`;
    return;
  }
  if (app.ui.where === "device" && app.device.target) return renderDeviceView();
  const ui = app.ui;
  app.visible = [];
  const out = [];
  const navCounts = {};
  let shown = 0;
  const filtering = isFiltering();
  app.data.systems.forEach((sys, si) => {
    if (sys.code === "PORTS") {
      const html = filtering && !ui.q ? "" : portsSection({ accent: sys.accent, collapsed: ui.collapsed.has(sys.code) && !ui.q, chevron, q: ui.q, localFiles: sys.games.length });
      navCounts[si] = html ? 1 : 0;
      if (html) out.push(html);
      return;
    }
    const games = sys.games.filter((g) => matches(g, sys)).sort(sorters[ui.sort]);
    navCounts[si] = games.length;
    if (!sys.games.length) {
      if (!ui.empty) return;
    } else if (filtering && !games.length) return;
    shown += games.length;
    const collapsed = ui.collapsed.has(sys.code) && !ui.q;
    const cards = games.map((g) => { app.visible.push([si, g]); return card(g, si, app.visible.length - 1); }).join("");
    const excludedNote = EXCLUDED.has(sys.code) && sys.games.length ? "Not copied: MustardOS installs ports with PortMaster" : "";
    const meta = [sys.maker, sys.year, sys.cat === sys.maker ? "" : sys.cat, excludedNote].filter(Boolean).map(esc).join(" &middot; ");
    const artPct = sys.games.length ? Math.floor((sys.art / sys.games.length) * 100) : 0;
    const copyable = canCopy(sys);
    const onCount = copyable ? sys.games.filter((g) => isOnCard(sys, g)).length : 0;
    out.push(`<section class="system${collapsed ? " collapsed" : ""}" id="sys-${esc(sys.code)}" data-code="${esc(sys.code)}" style="--accent:${sys.accent}">
      <header class="system-head" tabindex="0" role="button" aria-expanded="${!collapsed}">
        ${games.length ? sysPick(sys.code) : ""}
        <div class="sys-ico">${consoleIcon(sys.code)}</div>
        <div class="system-title"><h2>${esc(sys.name)} <span class="code">${esc(sys.code)}</span></h2><p>${meta}</p></div>
        <div class="system-stats">
          <div><b>${filtering ? `${games.length}/` : ""}${sys.games.length}</b>games</div>
          <div><b>${human(sys.bytes)}</b>size</div>
          <div><b>${artPct}%</b>artwork</div>
          ${copyable ? `<div><b>${onCount}</b>on ${esc(devWord())}</div>` : app.device.target ? `<div class="na" title="${sys.games.length ? "Not copied to the device" : "No games"}"><b>&ndash;</b>on ${esc(devWord())}</div>` : ""}
        </div>
        ${sys.code === "SCUMMVM" ? `<button class="btn small" data-svm="free" title="Download the freeware ScummVM games">${icon("download")}<span>Free games</span></button>` : ""}
        ${copyable ? `<button class="btn icon sys-transfer" data-code="${esc(sys.code)}" title="Transfer every ${esc(sys.code)} game to ${esc(devName())}" aria-label="Transfer ${esc(sys.name)}">${ICONS.up}</button>` : app.device.target ? `<span class="sys-transfer-gap"></span>` : ""}
        ${chevron}
      </header>
      ${games.length ? `<div class="games ${ui.view}">${cards}</div>`
        : sys.code === "SCUMMVM" ? `<div class="empty-note">No games in Roms/SCUMMVM yet. Drop a game's folder on <b>Add games</b>, or get one of the <button class="btn small" data-svm="free">${icon("download")}<span>Free games</span></button></div>`
        : `<div class="empty-note">No games in Roms/${esc(sys.code)} yet.</div>`}
    </section>`);
  });
  $("games-list").innerHTML = out.length ? out.join("")
    : `<div class="nothing">${ui.q ? `No games match &ldquo;${esc(ui.q)}&rdquo;.` : "No games match these filters."}</div>`;
  setNote(filtering ? `${shown.toLocaleString()} of ${app.all.length.toLocaleString()} games shown` : "", filtering);
  renderNav(navCounts);
  observeSections();
  syncSelection();
}

function isFiltering() {
  const ui = app.ui;
  return !!ui.q || ui.art !== "all" || metaFiltering() || (ui.onCard !== "all" && !!app.device.target);
}

function isDevFiltering() {
  const ui = app.ui;
  return !!ui.q || ui.art !== "all" || metaFiltering() || ui.devFilter !== "all";
}

function setNote(text, clearable) {
  const ui = app.ui;
  $("note").innerHTML = esc(text) + (clearable ? ` <button class="link-btn" data-clear-filters>Clear filters</button>` : "");
  $("art").classList.toggle("active", ui.art !== "all");
  $("copied-filter").classList.toggle("active", ui.onCard !== "all");
  $("dev-filter").classList.toggle("active", ui.devFilter !== "all");
  for (const key of ["genre", "rating", "year"]) $(key).classList.toggle("active", ui[key] !== "all");
}

export function clearFilters(draw = true) {
  const ui = app.ui;
  Object.assign(ui, { q: "", art: "all", onCard: "all", devFilter: "all", genre: "all", rating: "all", year: "all" });
  $("q").value = "";
  for (const id of ["art", "copied-filter", "dev-filter", "genre", "rating", "year"]) $(id).value = "all";
  if (draw) render();
}

// ---------------------------------------------------------------- platform carousel

/** The platforms shown in the list, in page order: { code, name, cat, accent, n }. */
let platforms = [];
let activeCode = "";

/** Library: systems with games (and empty ones when the switch is on), only those with matches while
 *  filtering. Device (device=true): only the systems whose counts were given and are non-zero. */
function renderNav(counts, device = false) {
  const filtering = device || isFiltering();
  const listed = (s, i) => device ? counts[i] > 0 : s.games.length ? !filtering || counts[i] > 0 : app.ui.empty;
  platforms = [];
  app.data.categories.forEach((cat) => {
    app.data.systems.forEach((s, i) => {
      if (s.cat !== cat || !listed(s, i)) return;
      platforms.push({ code: s.code, name: s.name, cat, accent: s.accent, n: filtering ? counts[i] || 0 : s.games.length });
    });
  });
  if (!platforms.some((p) => p.code === activeCode)) activeCode = platforms[0]?.code || "";
  renderPlatform();
  if (platOpen()) renderPlatTrack();
}

const platOpen = () => !$("plat-menu").hidden;

function renderPlatform() {
  const box = $("plat");
  box.hidden = !platforms.length;
  const i = platforms.findIndex((p) => p.code === activeCode), p = platforms[i];
  if (!p) return;
  const cur = $("plat-cur");
  cur.style.setProperty("--accent", p.accent);
  cur.innerHTML = `${consoleIcon(p.code, "plat-ico")}<span class="plat-text"><b>${esc(p.name)}</b><small>${p.n.toLocaleString()}</small></span>
    <span class="plat-pos">${i + 1}/${platforms.length}</span>${icon("down", "plat-chev")}`;
  cur.title = `${p.name}: pick a platform`;
  box.querySelector('[data-plat-step="-1"]').disabled = i <= 0;
  box.querySelector('[data-plat-step="1"]').disabled = i >= platforms.length - 1;
  document.querySelectorAll(".plat-tile.on").forEach((t) => t.classList.remove("on"));
  const tile = document.querySelector(`.plat-tile[data-plat="${CSS.escape(p.code)}"]`);
  if (tile) { tile.classList.add("on"); centerTile(tile); }
}

function renderPlatTrack() {
  let html = "", cat = "";
  for (const p of platforms) {
    if (p.cat !== cat) {
      if (cat) html += `</div></div>`;
      cat = p.cat;
      html += `<div class="plat-group"><span class="plat-cat">${esc(cat)}</span><div class="plat-tiles">`;
    }
    html += `<button class="plat-tile${p.code === activeCode ? " on" : ""}${p.n ? "" : " empty"}" data-plat="${esc(p.code)}" style="--accent:${p.accent}" title="${esc(p.name)}">
      <span class="plat-tile-ico">${consoleIcon(p.code)}</span><b>${esc(p.name)}</b><small><span class="code">${esc(p.code)}</span>${p.n.toLocaleString()}</small></button>`;
  }
  $("plat-track").innerHTML = html + (cat ? `</div></div>` : "");
  $("plat-count").textContent = `${platforms.length} platform${platforms.length === 1 ? "" : "s"}`;
}

function centerTile(tile, smooth = true) {
  const track = $("plat-track");
  if (!track || $("plat-menu").hidden) return;
  const left = tile.offsetLeft - track.offsetLeft - (track.clientWidth - tile.offsetWidth) / 2;
  track.scrollTo({ left: Math.max(0, left), behavior: smooth ? "smooth" : "instant" });
}

function openPlatforms(open = !platOpen()) {
  $("plat-menu").hidden = !open;
  $("plat").classList.toggle("open", open);
  $("plat-cur").setAttribute("aria-expanded", open);
  if (!open) return;
  renderPlatTrack();
  const tile = document.querySelector(".plat-tile.on");
  if (tile) { centerTile(tile, false); tile.focus({ preventScroll: true }); }
}

function stepPlatform(by) {
  const i = platforms.findIndex((p) => p.code === activeCode) + by;
  if (platforms[i]) scrollToSystem(platforms[i].code);
}

function markActive(code) {
  if (!code || code === activeCode) return;
  activeCode = code;
  renderPlatform();
}

/** Ignores the scroll observer while a jump settles, so it cannot highlight a neighbour. */
let jumpUntil = 0;

/** Expands the system and puts its header just below the sticky toolbar. */
export function scrollToSystem(code) {
  const sec = document.getElementById("sys-" + code);
  if (!sec) return;
  if (sec.classList.contains("collapsed")) {
    sec.classList.remove("collapsed");
    app.ui.collapsed.delete(code);
    applyView();
  }
  jumpUntil = Date.now() + 800;
  markActive(code);
  const place = () => {
    const offset = document.querySelector(".statusbar").offsetHeight + document.querySelector("#view-games .toolbar").offsetHeight + 8;
    scrollTo({ top: Math.max(0, scrollY + sec.getBoundingClientRect().top - offset), behavior: "instant" });
  };
  place();
  // Images above the target can still change height after the first jump.
  requestAnimationFrame(place);
  setTimeout(place, 250);
}

/** Games section, Roms/ library, only games without artwork; optionally at one system. */
export function showMissing(code) {
  app.ui.art = "without";
  $("art").value = "without";
  setWhere("library", false);
  if (code) app.ui.collapsed.delete(code);
  if (section() === "games") render(); else location.hash = "#games";
  if (code) setTimeout(() => scrollToSystem(code), 80);
}

let observer;
function observeSections() {
  if (observer) observer.disconnect();
  const top = (document.querySelector(".statusbar")?.offsetHeight || 54) + (document.querySelector("#view-games .toolbar")?.offsetHeight || 86) + 10;
  observer = new IntersectionObserver(() => {
    if (Date.now() < jumpUntil) return;
    const first = [...document.querySelectorAll(".system")].find((s) => s.getBoundingClientRect().bottom > top);
    if (first) markActive(first.dataset.code);
  }, { rootMargin: `-${Math.round(top)}px 0px -65% 0px` });
  document.querySelectorAll(".system").forEach((s) => observer.observe(s));
}

// ---------------------------------------------------------------- one library game

export function openViewer(index) {
  if (index < 0 || index >= app.visible.length) return;
  app.current = index;
  const [si, g] = app.visible[index];
  const sys = app.data.systems[si];
  const viewer = $("viewer");
  viewer.style.setProperty("--accent", sys.accent);
  $("v-art").innerHTML = g.i ? `<img src="${g.i}" alt="">` : `<span class="ph">${esc(initial(g.t))}</span>`;
  $("v-sys").innerHTML = `<span class="code" style="--accent:${sys.accent}">${esc(sys.code)}</span> ${esc(sys.name)}`;
  $("v-title").textContent = g.t;
  $("v-transfer").hidden = !canCopy(sys);
  $("v-transfer-label").textContent = `Transfer to ${devName()}`;
  $("v-delete").hidden = EXCLUDED.has(sys.code);
  const openArt = $("v-open-art");
  openArt.style.display = g.i ? "" : "none";
  if (g.i) openArt.href = g.i;
  $("v-count").textContent = `${index + 1} / ${app.visible.length}`;
  $("v-prev").style.visibility = index > 0 ? "visible" : "hidden";
  $("v-next").style.visibility = index < app.visible.length - 1 ? "visible" : "hidden";
  if (!viewer.open) viewer.showModal();
  viewer.scrollTop = 0;
  enrichViewer(index);
}

/** Rescans Roms/ and shows the game with this key again, after its artwork or description changed. */
async function reloadGame(key) {
  await api("games/rescan", {});
  await loadLibrary();
  let idx = app.visible.findIndex(([si, g]) => keyOf(app.data.systems[si], g) === key);
  if (idx < 0) {
    app.data.systems.forEach((sys, si) => sys.games.forEach((g) => { if (idx < 0 && keyOf(sys, g) === key) idx = app.visible.push([si, g]) - 1; }));
  }
  if (idx >= 0) openViewer(idx);
}

let removing = null;

function openRemove() {
  const [si, g] = app.visible[app.current];
  const sys = app.data.systems[si];
  removing = { g, sys };
  $("r-title").textContent = `${g.t} (${sys.code}/${g.f})`;
  $("r-path").textContent = g.p;
  $("r-library").checked = true;
  $("r-art-row").hidden = !g.i;
  $("r-art").checked = !!g.i;
  $("r-device-row").hidden = !onCardState(sys, g);
  $("r-device").checked = false;
  $("r-device-text").textContent = handheldMode() ? `Delete it from ${devName()}` : `Delete it from the ${cardWord()}`;
  $("r-error").innerHTML = "";
  syncRemove();
  $("viewer").close();
  $("remove").showModal();
}

function syncRemove() {
  $("r-art").disabled = !$("r-library").checked;
  $("r-confirm").disabled = !$("r-library").checked && !$("r-device").checked;
}

async function confirmRemove() {
  const { g, sys } = removing;
  const key = keyOf(sys, g);
  const body = {
    path: key,
    library: $("r-library").checked,
    art: $("r-library").checked && !$("r-art-row").hidden && $("r-art").checked,
    device: !$("r-device-row").hidden && $("r-device").checked,
    volume: app.device.target ? app.device.target.id : ""
  };
  $("r-confirm").disabled = true;
  try {
    await api("games/delete", body);
    $("remove").close();
    if (body.library) {
      sys.games = sys.games.filter((x) => x !== g);
      renderStats();
    }
    toast(body.library ? (body.device ? `Moved to the Trash and deleted from ${devName()}` : "Moved to the Trash") : `Deleted from ${devName()}`);
    if (body.device) { delete app.device.files[key]; resetListing(); renderDevice(); }
    render();
  } catch (error) {
    $("r-error").innerHTML = `<div class="notice err">${esc(error.message)}</div>`;
    syncRemove();
  }
}

// ---------------------------------------------------------------- the device view

export function resetListing() {
  app.listing = { status: "idle", volume: "", data: null, error: "" };
}

/** Toolbar controls that depend on the connection. */
export function syncGamesControls() {
  const c = app.device.target, err = !!app.device.error, ui = app.ui;
  $("copied-filter").hidden = !c || err || ui.where === "device";
  $("dev-filter").hidden = !c || ui.where !== "device";
  $("where").hidden = !c || err;
  $("where-device").textContent = handheldMode() ? "On device" : `On ${cardWord()}`;
  document.querySelectorAll("#where button").forEach((b) => {
    const on = b.dataset.where === (c ? ui.where : "library");
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
  const filter = $("copied-filter").options;
  filter[0].text = `On ${devWord()} or not`; filter[1].text = `Not on ${devWord()} yet`; filter[2].text = `Already on ${devWord()}`;
  if (section() === "games") renderBulk();
}

export function setWhere(where, draw = true) {
  if (where !== app.ui.where) { app.sel.clear(); lastPick = -1; }
  app.ui.where = where;
  sessionStorage.setItem("manager.where", where);
  if (!draw) return;
  renderDevice();
  if (section() !== "games") return;
  if (where === "device" && app.device.target && (app.listing.status === "idle" || app.listing.volume !== app.device.target.id)) loadDevice();
  else render();
  scrollTo({ top: 0 });
}

export async function loadDevice() {
  if (!app.device.target || !app.data) return;
  const volume = app.device.target.id;
  app.listing = { status: "loading", volume, data: null, error: "" };
  render();
  try {
    const data = await api("device/games?volume=" + encodeURIComponent(volume));
    if (app.listing.volume !== volume) return;
    const byCode = Object.fromEntries(app.data.systems.map((s) => [s.code.toLowerCase(), s]));
    data.systems.forEach((sys) => {
      const lib = byCode[sys.code.toLowerCase()];
      sys.name = lib ? lib.name : sys.folder;
      sys.accent = lib ? lib.accent : ACCENTS.Other;
      sys.lib = lib || null;
      const games = lib ? Object.fromEntries(lib.games.map((g) => [g.f, g])) : {};
      sys.games.forEach((g) => {
        g.lib = g.lf ? games[g.lf] || null : null;
        const stem = g.f.replace(/\.[^.]+$/, "");
        g.t = g.lib ? g.lib.t : stem.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, "").trim() || stem;
        g.x = (g.f.match(/\.([^.]+)$/) || ["", ""])[1].toLowerCase();
        g.k = g.lib ? g.lib.k : g.t.toLowerCase();
        g.search = [g.t, g.f, sys.name, sys.code].join(" ").toLowerCase();
      });
    });
    app.listing = { status: "ready", volume, data, error: "" };
  } catch (error) {
    if (app.listing.volume !== volume) return;
    app.listing = { status: "error", volume, data: null, error: error.message };
  }
  renderCurrent();
}

const devImage = (art, kind) => `/api/device/image?${new URLSearchParams({ volume: app.listing.volume, kind, catalogue: art[0], name: art[1], size: art[2], token: TOKEN })}`;
const viaLib = (sort) => (a, b) => sort(a.lib || NO_META, b.lib || NO_META) || sorters.title(a, b);
const NO_META = { rate: 0, year: 0 };
const devSorters = {
  title: sorters.title,
  size: sorters.size,
  recent: sorters.title,
  type: sorters.type,
  rating: viaLib((a, b) => b.rate - a.rate),
  newest: viaLib((a, b) => b.year - a.year),
  oldest: viaLib((a, b) => (a.year || 9999) - (b.year || 9999))
};

function devMatches(g) {
  const ui = app.ui;
  if (ui.art === "with" && !g.art.box) return false;
  if (ui.art === "without" && g.art.box) return false;
  if (ui.devFilter === "lib" && g.st === "device") return false;
  if (ui.devFilter === "only" && g.st !== "device") return false;
  if (ui.devFilter === "changed" && g.st !== "changed") return false;
  if (metaFiltering() && !metaMatches(g.lib || { genres: [], rate: 0, year: 0 })) return false;
  return !ui.q || g.search.includes(ui.q);
}

function devCard(g, idx) {
  const q = app.ui.q;
  const art = g.art.box
    ? `<img loading="lazy" decoding="async" src="${devImage(g.art.box, "box")}" alt="">`
    : `<span class="ph">${esc(initial(g.t))}</span>`;
  const badge = { same: ["", "IN ROMS/"], check: ["", "IN ROMS/"], changed: [" changed", "DIFFERS"], device: [" device", "NOT IN ROMS/"] }[g.st];
  const key = devKey(app.devVisible[idx][0], g), on = app.sel.has(key);
  return `<article class="game${on ? " sel" : ""}" tabindex="0" data-d="${idx}" data-k="${esc(key)}">
    <div class="art">${art}${pickBox(on)}${g.lib ? sortBadge(g.lib) : ""}<span class="badge-on${badge[0]}">${badge[1]}</span>${g.art.box ? "" : `<span class="no-art">NO ART</span>`}</div>
    <div class="info"><h3 title="${esc(g.t)}">${highlight(g.t, q)}</h3>
      <div class="file" title="${esc(g.f)}">${highlight(g.f, q)} &middot; ${human(g.s)}</div></div>
  </article>`;
}

function renderDeviceView() {
  const listing = app.listing, ui = app.ui;
  app.devVisible = [];
  const name = esc(devName());
  if (listing.status !== "ready") {
    $("games-list").innerHTML = listing.status === "error"
      ? `<div class="dev-note"><div class="notice err">${esc(listing.error)}</div><button class="btn" data-dev="reload">Try again</button></div>`
      : `<div class="dev-note"><span class="spinner"></span> Reading the games on ${name}&hellip;${slowHint()}</div>`;
    setNote("", false);
    renderNav({}, true);
    if (listing.status === "idle") loadDevice();
    return;
  }
  const out = [];
  const counts = {};
  let shown = 0, total = 0;
  listing.data.systems.forEach((sys) => {
    total += sys.games.length;
    const games = sys.games.filter(devMatches).sort(devSorters[ui.sort]);
    if (sys.lib) counts[app.data.systems.indexOf(sys.lib)] = games.length;
    if (!games.length) return;
    shown += games.length;
    const collapsed = ui.collapsed.has(sys.code) && !ui.q;
    const cards = games.map((g) => { app.devVisible.push([sys, g]); return devCard(g, app.devVisible.length - 1); }).join("");
    const art = sys.games.filter((g) => g.art.box).length;
    const only = sys.games.filter((g) => g.st === "device").length;
    out.push(`<section class="system${collapsed ? " collapsed" : ""}" id="sys-${esc(sys.code)}" data-code="${esc(sys.code)}" style="--accent:${sys.accent}">
      <header class="system-head" tabindex="0" role="button" aria-expanded="${!collapsed}">
        ${sysPick(sys.code)}
        <div class="sys-ico">${consoleIcon(sys.lib ? sys.lib.code : sys.code)}</div>
        <div class="system-title"><h2>${esc(sys.name)} <span class="code">${esc(sys.folder)}</span></h2><p>ROMS/${esc(sys.folder)} on ${name}${only ? ` &middot; ${only} not in Roms/` : ""}</p></div>
        <div class="system-stats">
          <div><b>${games.length === sys.games.length ? "" : `${games.length}/`}${sys.games.length}</b>games</div>
          <div><b>${human(sys.games.reduce((a, g) => a + g.s, 0))}</b>size</div>
          <div><b>${sys.games.length ? Math.floor((art / sys.games.length) * 100) : 0}%</b>box art</div>
        </div>
        ${chevron}
      </header>
      <div class="games ${ui.view}">${cards}</div>
    </section>`);
  });
  $("games-list").innerHTML = out.length ? out.join("")
    : `<div class="nothing">${total ? "No games on the device match these filters." : `No games on ${name} yet. Select games in the Roms/ library and transfer them.`}</div>`;
  setNote(`${shown.toLocaleString()}${shown === total ? "" : ` of ${total.toLocaleString()}`} game${total === 1 ? "" : "s"} on ${devName()}`, isDevFiltering());
  renderNav(counts, true);
  observeSections();
  syncSelection();
}

// ---------------------------------------------------------------- selection and bulk actions

const devKey = (sys, g) => `${sys.folder}/${g.f}`;
let lastPick = -1;
/** A bulk action in progress: { label, done, total }. */
let bulkTask = null;

/** The selected games: [sys, game] pairs in the view that is showing. */
function selectedGames() {
  const out = [];
  if (app.ui.where === "device" && app.device.target) {
    for (const sys of app.listing.data?.systems || []) for (const g of sys.games) if (app.sel.has(devKey(sys, g))) out.push([sys, g]);
  } else if (app.data) {
    for (const sys of app.data.systems) for (const g of sys.games) if (app.sel.has(keyOf(sys, g))) out.push([sys, g]);
  }
  return out;
}

export function setSelecting(on) {
  app.selecting = on;
  if (!on) { app.sel.clear(); lastPick = -1; }
  syncSelection();
}

export function clearSelection() {
  app.sel.clear();
  lastPick = -1;
  syncSelection();
}

/** Selects every game the filters show, in both expanded and collapsed systems. */
export function selectAllShown() {
  document.querySelectorAll("#games-list .game[data-k]").forEach((el) => app.sel.add(el.dataset.k));
  app.selecting = true;
  syncSelection();
}

/** Brings the cards, system checkboxes, toolbar button and bulk bar in line with app.sel. */
export function syncSelection() {
  const list = $("games-list");
  list.classList.toggle("selecting", app.selecting);
  list.querySelectorAll(".game[data-k]").forEach((el) => {
    const on = app.sel.has(el.dataset.k);
    el.classList.toggle("sel", on);
    el.querySelector(".pick")?.setAttribute("aria-checked", String(on));
  });
  list.querySelectorAll(".system").forEach((sec) => {
    const pick = sec.querySelector(".sys-pick");
    if (!pick) return;
    const games = [...sec.querySelectorAll(".game[data-k]")];
    const n = games.filter((el) => app.sel.has(el.dataset.k)).length;
    pick.classList.toggle("on", n > 0 && n === games.length);
    pick.classList.toggle("some", n > 0 && n < games.length);
  });
  const button = $("select-mode");
  button.classList.toggle("on", app.selecting);
  button.setAttribute("aria-pressed", String(app.selecting));
  renderBulk();
}

function togglePick(el, range) {
  const all = [...$("games-list").querySelectorAll(".game[data-k]")];
  const index = all.indexOf(el);
  const on = !app.sel.has(el.dataset.k);
  if (range && lastPick >= 0 && lastPick < all.length) {
    const [a, b] = index < lastPick ? [index, lastPick] : [lastPick, index];
    all.slice(a, b + 1).forEach((x) => (on ? app.sel.add(x.dataset.k) : app.sel.delete(x.dataset.k)));
  } else if (on) app.sel.add(el.dataset.k);
  else app.sel.delete(el.dataset.k);
  lastPick = index;
  app.selecting = true;
  syncSelection();
}

function toggleSystem(sec) {
  const games = [...sec.querySelectorAll(".game[data-k]")];
  const all = games.every((el) => app.sel.has(el.dataset.k));
  games.forEach((el) => (all ? app.sel.delete(el.dataset.k) : app.sel.add(el.dataset.k)));
  app.selecting = true;
  syncSelection();
}

function renderBulk() {
  const bar = $("bulk");
  const show = section() === "games" && (app.selecting || app.sel.size > 0);
  bar.hidden = !show;
  document.body.classList.toggle("has-bulk", show);
  if (!show) return;
  const picked = selectedGames(), n = picked.length;
  const shownCount = $("games-list").querySelectorAll(".game[data-k]").length;
  const bytes = picked.reduce((a, [, g]) => a + g.s, 0);
  const device = app.ui.where === "device" && !!app.device.target;
  const dis = busy() || !!bulkTask;
  let actions;
  if (device) {
    actions = `<button class="btn danger" data-bulk="device-delete"${n && !dis ? "" : " disabled"}>${icon("trash")}<span>Delete from ${esc(devWord())}</span></button>`;
  } else {
    const sendable = picked.filter(([sys]) => canCopy(sys)).length;
    const onDevice = picked.filter(([sys, g]) => onCardState(sys, g)).length;
    actions = `${onDevice ? `<button class="btn" data-bulk="device-remove"${dis ? " disabled" : ""} title="Delete the selected games that are on ${esc(devName())} from it">${icon("x")}<span>Remove from ${esc(devWord())}</span></button>` : ""}
      <button class="btn danger" data-bulk="trash"${n && !dis ? "" : " disabled"} title="Move the ROMs and their artwork to the Trash on this computer">${icon("trash")}<span>Move to Trash</span></button>
      <button class="btn primary" data-bulk="transfer"${sendable && ready() && !dis ? "" : " disabled"} title="${ready() ? `Transfer the selected games to ${esc(devName())}` : "Connect the handheld or insert TF2 first"}">${icon("transfer")}<span>Transfer${sendable && sendable !== n ? ` ${sendable.toLocaleString()}` : ""} to ${esc(devName())}</span></button>`;
    if (picked.length) {
      const extra = picked.length - picked.filter(([sys]) => !EXCLUDED.has(sys.code)).length;
      if (extra) actions = `<span class="bulk-note" title="Ports are installed with PortMaster">${extra} not transferable</span>` + actions;
    }
  }
  const sub = n ? `${human(bytes)}${device ? "" : ` \u00b7 ${picked.filter(([sys, g]) => isOnCard(sys, g)).length.toLocaleString()} on ${esc(devWord())}`}` : "Click games to select them";
  const task = bulkTask ? `<span class="bulk-task">${ICONS.spin}${esc(bulkTask.label)} ${bulkTask.done.toLocaleString()} of ${bulkTask.total.toLocaleString()}</span>` : "";
  bar.innerHTML = `<div class="bulk-inner">
    <button class="btn icon ghost" data-bulk="close" title="Done selecting (Esc)" aria-label="Done selecting">${icon("x")}</button>
    <div class="bulk-count"><b>${n ? `${n.toLocaleString()} selected` : "Select games"}</b><small>${sub}</small></div>
    <div class="bulk-sel">
      <button class="btn ghost" data-bulk="all"${shownCount && n < shownCount ? "" : " disabled"}>${icon("select")}<span>All ${shownCount.toLocaleString()} shown</span></button>
      ${n ? `<button class="btn ghost" data-bulk="none">${icon("x")}<span>Clear</span></button>` : ""}
    </div>
    <span class="grow"></span>${task || actions}
  </div>`;
}

/** Runs one request per game, showing progress in the bulk bar; failures are counted, not fatal. */
async function runBulk(label, items, fn) {
  bulkTask = { label, done: 0, total: items.length };
  renderBulk();
  let failed = 0, error = "";
  for (const item of items) {
    try { await fn(item); } catch (e) { failed++; error = e.message; }
    bulkTask.done++;
    if (bulkTask.done % 3 === 0 || bulkTask.done === items.length) renderBulk();
  }
  bulkTask = null;
  return { failed, error, done: items.length - failed };
}

async function bulkAction(action) {
  const picked = selectedGames();
  if (action === "close") return setSelecting(false);
  if (action === "all") return selectAllShown();
  if (action === "none") return clearSelection();
  if (!picked.length || busy() || bulkTask) return;
  const volume = app.device.target ? app.device.target.id : "";
  if (action === "transfer") {
    const keys = picked.filter(([sys]) => canCopy(sys)).map(([sys, g]) => keyOf(sys, g));
    const label = keys.length === 1 ? `${picked[0][1].t} (${picked[0][0].code}/${picked[0][1].f})` : `${plural(keys.length, "selected game")}`;
    return startPlan(keys, label, { onStart: () => setSelecting(false) });
  }
  if (action === "trash") {
    const ok = await confirmBox({
      title: "Move to the Trash",
      html: `<p>Move <b>${plural(picked.length, "ROM")}</b> (${human(picked.reduce((a, [, g]) => a + g.s, 0))}) and their artwork from Roms/ to the Trash on this computer?
        You can put them back from the Trash.</p><p class="muted-note">Copies on ${esc(devName())} are not touched.</p>`,
      ok: "Move to Trash", danger: true
    });
    if (!ok) return;
    const gone = new Set();
    const result = await runBulk("Moving to the Trash", picked, ([sys, g]) => api("games/delete", { path: keyOf(sys, g), library: true, art: !!g.i, device: false, volume })
      .then(() => gone.add(keyOf(sys, g))));
    for (const sys of app.data.systems) sys.games = sys.games.filter((g) => !gone.has(keyOf(sys, g)));
    app.sel.clear();
    renderStats();
    render();
    return toast(`${plural(result.done, "ROM")} moved to the Trash${result.failed ? `; ${result.failed} failed (${result.error})` : ""}`, result.failed ? 6000 : 3000);
  }
  if (action === "device-remove") {
    const on = picked.filter(([sys, g]) => onCardState(sys, g));
    const ok = await confirmBox({
      title: `Remove from ${devName()}`,
      html: `<p>Permanently delete <b>${plural(on.length, "game")}</b> from ${esc(devName())}? There is no Trash on the device.</p>
        <p class="muted-note">The ROMs stay in Roms/ on this computer.</p>`,
      ok: "Delete from device", danger: true
    });
    if (!ok) return;
    const result = await runBulk("Deleting from the device", on, ([sys, g]) => api("games/delete", { path: keyOf(sys, g), library: false, device: true, volume }).then(() => { delete app.device.files[keyOf(sys, g)]; }));
    app.sel.clear();
    resetListing();
    renderDevice();
    render();
    return toast(`Deleted ${plural(result.done, "game")} from ${devName()}${result.failed ? `; ${result.failed} failed (${result.error})` : ""}`, result.failed ? 6000 : 3000);
  }
  if (action === "device-delete") {
    const ok = await confirmBox({
      title: `Delete from ${devName()}`,
      html: `<p>Permanently delete <b>${plural(picked.length, "game")}</b> (${human(picked.reduce((a, [, g]) => a + g.s, 0))}) from ${esc(devName())}? There is no Trash on the device.</p>
        ${picked.some(([, g]) => g.st === "device") ? `<p class="muted-note">Some of them are not in Roms/ either.</p>` : ""}
        <label class="check"><input type="checkbox" id="bulk-art" checked><span>Also delete their artwork on ${esc(devName())}</span></label>`,
      ok: "Delete permanently", danger: true
    });
    if (!ok) return;
    const art = $("bulk-art")?.checked || false;
    const result = await runBulk("Deleting", picked, ([sys, g]) => api("games/delete", { path: devKey(sys, g), device: true, device_art: art, volume: app.listing.volume }).then(() => {
      sys.games = sys.games.filter((x) => x !== g);
      if (g.lib && sys.lib) delete app.device.files[keyOf(sys.lib, g.lib)];
    }));
    app.sel.clear();
    renderDevice();
    renderCurrent();
    return toast(`Deleted ${plural(result.done, "game")} from ${devName()}${result.failed ? `; ${result.failed} failed (${result.error})` : ""}`, result.failed ? 6000 : 3000);
  }
}

/** Games, Roms/ library, filtered to games that are not on the device yet, in select mode. */
export function showNotOnDevice() {
  clearFilters(false);
  app.ui.onCard = "missing";
  $("copied-filter").value = "missing";
  setWhere("library", false);
  app.selecting = true;
  if (section() === "games") render(); else location.hash = "#games";
}

/** Games, searching for text. */
export function showSearch(text) {
  clearFilters(false);
  app.ui.q = text.toLowerCase();
  $("q").value = text;
  setWhere("library", false);
  if (section() === "games") render(); else location.hash = "#games";
}

// ---------------------------------------------------------------- one game on the device

let devOpen = null;

function openDevGame(index) {
  const [sys, g] = app.devVisible[index] || [];
  if (g) openDeviceGame(sys, g, false);
}

/** One game on the device. manage (the Artwork section) adds the artwork actions; Games only shows the images. */
export function openDeviceGame(sys, g, manage) {
  devOpen = { sys, g, manage, confirming: false };
  renderDevGame();
  if (!$("devgame").open) $("devgame").showModal();
  $("devgame").scrollTop = 0;
}

function renderDevGame() {
  const { sys, g } = devOpen;
  const c = app.device.target;
  const working = busy() || devOpen.working;
  const where = { same: "Same file as in Roms/", check: "In Roms/ (date differs)", changed: "Different from the copy in Roms/", device: "Not in Roms/" }[g.st];
  $("d-title").textContent = g.t;
  $("d-scope").innerHTML = `<span class="code" style="--accent:${sys.accent}">${esc(sys.folder)}</span> ${esc(g.f)} &middot; ${human(g.s)} &middot; ${where}`;
  const libArt = g.lib && g.lib.i;
  const manage = devOpen.manage;
  const tiles = ART_KINDS.map(([kind, label]) => {
    const art = g.art[kind];
    const actions = [];
    if (manage && art && g.st !== "device") actions.push(`<button class="btn" data-d="get" data-kind="${kind}" title="Copy this image into Roms/${esc(sys.code)}/Imgs as the library artwork">Use in library</button>`);
    if (manage && art) actions.push(`<button class="btn danger" data-d="del" data-kind="${kind}">Delete</button>`);
    if (manage && libArt && c.art) actions.push(`<button class="btn" data-d="send" data-kind="${kind}" title="Copy the Roms/ artwork to ${esc(devName())} as ${esc(label.toLowerCase())}">${art ? "Replace from Roms/" : "Send from Roms/"}</button>`);
    if (manage && c.art) actions.push(`<button class="btn" data-d="upload" data-kind="${kind}" title="Pick an image file; it is saved as PNG${artMax.get() ? `, at most ${artMax.get()} px` : ""}. You can also drop a file on the picture.">Upload file</button>`);
    return `<div class="d-tile"${manage && c.art ? ` data-drop-kind="${kind}"` : ""}><div class="d-img">${art ? `<img src="${devImage(art, kind)}" alt="">` : "None"}</div>
      <b>${label}</b><small>${art ? `${esc(art[0])} &middot; ${human(art[2])}` : `Not on ${esc(devName())}`}</small>
      ${actions.length ? `<div class="d-actions"${working ? ' style="pointer-events:none;opacity:.5"' : ""}>${actions.join("")}</div>` : ""}</div>`;
  }).join("");
  $("d-art").innerHTML = tiles + `<div class="d-tile lib"><div class="d-img">${libArt ? `<img src="${g.lib.i}" alt="">` : g.lib ? "None" : "Not in Roms/"}</div>
    <b>Library artwork</b><small>${libArt ? `Roms/${esc(sys.code)}/Imgs` : c.art ? "Nothing to send" : ""}</small></div>`;
  if (!devOpen.confirming) {
    const sendBox = !manage && libArt && c.art && !g.art.box
      ? `<div class="notice d-send"><span>${esc(devName())} has no box art for this game, so its list shows none. The Roms/ artwork can go there.</span>
          <button class="btn primary" data-d="send" data-kind="box"${working ? " disabled" : ""}>Send box art</button></div>`
      : "";
    $("d-msg").innerHTML = !manage
      ? `${sendBox}<div class="muted-note">To get, send or delete this game's artwork, <button class="link-btn" data-d="manage">open it in Artwork</button>.</div>`
      : !c.art
        ? `<div class="notice">${handheldMode() ? "The handheld has no artwork catalogue yet." : "TF2 has no MUOS/info/catalogue folder, so its artwork lives on SD1. Connect the handheld over USB or Wi-Fi to manage it, or use Keep artwork on TF2."}</div>`
        : "";
  }
  $("d-delete").textContent = `Delete from ${devWord()}`;
  $("d-delete").disabled = working;
  $("d-delete").hidden = manage;
}

async function devAction(action, kind, file = null) {
  if (!devOpen || devOpen.working) return;
  const open = devOpen, { sys, g } = open;
  if (action === "upload" && !file) return;
  if (action !== "send" && action !== "upload" && !g.art[kind]) return;
  open.working = true;
  const body = { volume: app.listing.volume, path: `${sys.folder}/${g.f}`, kind };
  if (action !== "send" && action !== "upload") Object.assign(body, { catalogue: g.art[kind][0], name: g.art[kind][1] });
  if (action === "get") body.path = `${sys.code}/${g.f}`;
  $("d-msg").innerHTML = `<div class="planning" style="padding:4px 0"><span class="spinner"></span> Working&hellip;</div>`;
  try {
    if (action === "send" || action === "upload") {
      if (file) body.data = (await pngData(file, artMax.get())).data;
      g.art[kind] = (await api("games/artwork/send", body)).art;
      toast(file ? `Uploaded to ${devName()}` : `Sent to ${devName()}`);
    } else if (action === "get") {
      const image = (await api("games/artwork/get", body)).image + "?t=" + Date.now();
      if (g.lib) {
        if (!g.lib.i) { g.lib.i = image; renderStats(); }
        else g.lib.i = image;
      }
      toast("Saved in Roms/");
    } else {
      await api("games/artwork/delete", body);
      delete g.art[kind];
      toast(`Deleted from ${devName()}`);
    }
    open.working = false;
    renderCurrent();
    if (devOpen === open) {
      $("d-msg").innerHTML = "";
      renderDevGame();
    }
  } catch (error) {
    open.working = false;
    if (devOpen === open) $("d-msg").innerHTML = `<div class="notice err">${esc(error.message)}</div>`;
    else toast(error.message, 4000);
  }
}

function askDeleteDevGame() {
  const { g } = devOpen;
  const files = Object.keys(g.art).length;
  devOpen.confirming = true;
  $("d-msg").innerHTML = `<div class="notice err" style="display:flex;flex-direction:column;gap:10px">
    <span>Delete <b>${esc(g.f)}</b> from ${esc(devName())}? This is permanent; there is no Trash on the device.${g.st === "device" ? " It is not in Roms/ either." : ""}</span>
    ${files ? `<label class="check"><input type="checkbox" id="d-art-too" checked><span>Also delete its artwork on ${esc(devName())}</span></label>` : ""}
    <div class="dialog-actions"><button class="btn" data-d="keep">Keep it</button><button class="btn danger-solid" data-d="confirm">Delete permanently</button></div></div>`;
}

async function deleteDevGame() {
  if (!devOpen || devOpen.working) return;
  const { sys, g } = devOpen;
  devOpen.working = true;
  $("d-msg").querySelectorAll("button").forEach((b) => { b.disabled = true; });
  try {
    const result = await api("games/delete", { path: `${sys.folder}/${g.f}`, device: true, device_art: $("d-art-too")?.checked || false, volume: app.listing.volume });
    sys.games = sys.games.filter((x) => x !== g);
    if (g.lib && sys.lib) delete app.device.files[keyOf(sys.lib, g.lib)];
    $("devgame").close();
    toast(`Deleted from ${devName()}${result.art ? " with its artwork" : ""}`);
    renderDevice();
    renderCurrent();
  } catch (error) {
    if (devOpen) {
      devOpen.working = false;
      $("d-msg").innerHTML = `<div class="notice err">${esc(error.message)}</div>`;
    } else toast(error.message, 4000);
  }
}

// ---------------------------------------------------------------- controls

export function applyView() {
  const ui = app.ui;
  document.documentElement.dataset.theme = ui.theme === "system"
    ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : ui.theme;
  document.documentElement.style.setProperty("--card", ui.card + "px");
  $("view-grid").classList.toggle("on", ui.view === "grid");
  $("view-list").classList.toggle("on", ui.view === "list");
  $("card-size").value = ui.card;
  $("sort").value = ui.sort;
  $("show-empty").checked = ui.empty;
  $("collapse-all").textContent = ui.collapsed.size ? "Expand all" : "Collapse all";
}

function openGame(el) {
  el.dataset.d !== undefined ? openDevGame(+el.dataset.d) : openViewer(+el.dataset.v);
}

export function bindGames() {
  const ui = app.ui;
  let timer;
  $("q").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { ui.q = e.target.value.trim().toLowerCase(); render(); }, 120);
  });
  $("art").addEventListener("change", (e) => { ui.art = e.target.value; render(); });
  for (const key of ["genre", "rating", "year"]) $(key).addEventListener("change", (e) => { ui[key] = e.target.value; render(); });
  $("sort").addEventListener("change", (e) => { ui.sort = e.target.value; store.set("sort", ui.sort); render(); });
  $("show-empty").addEventListener("change", (e) => { ui.empty = e.target.checked; store.set("empty", ui.empty); render(); });
  $("view-grid").addEventListener("click", () => { ui.view = "grid"; store.set("view", "grid"); applyView(); render(); });
  $("view-list").addEventListener("click", () => { ui.view = "list"; store.set("view", "list"); applyView(); render(); });
  $("card-size").addEventListener("input", (e) => { ui.card = +e.target.value; store.set("card", ui.card); applyView(); });
  $("collapse-all").addEventListener("click", () => {
    ui.collapsed = ui.collapsed.size ? new Set() : new Set(app.data.systems.map((s) => s.code));
    applyView(); render();
  });
  const plat = $("plat");
  plat.addEventListener("click", (e) => {
    const step = e.target.closest("[data-plat-step]");
    if (step) return stepPlatform(+step.dataset.platStep);
    if (e.target.closest("#plat-cur")) return openPlatforms();
    const scroll = e.target.closest("[data-plat-scroll]");
    if (scroll) {
      const track = $("plat-track");
      return track.scrollBy({ left: +scroll.dataset.platScroll * track.clientWidth * 0.8, behavior: "smooth" });
    }
    const tile = e.target.closest("[data-plat]");
    if (tile) { openPlatforms(false); scrollToSystem(tile.dataset.plat); $("plat-cur").focus({ preventScroll: true }); }
  });
  plat.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && platOpen()) {
      e.stopPropagation();
      openPlatforms(false);
      $("plat-cur").focus({ preventScroll: true });
      return;
    }
    const tile = e.target.closest(".plat-tile");
    if (!tile || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const tiles = [...plat.querySelectorAll(".plat-tile")], next = tiles[tiles.indexOf(tile) + (e.key === "ArrowLeft" ? -1 : 1)];
    if (next) { next.focus({ preventScroll: true }); centerTile(next); }
  });
  $("plat-track").addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    e.currentTarget.scrollLeft += e.deltaY;
  }, { passive: false });
  document.addEventListener("click", (e) => { if (platOpen() && !plat.contains(e.target)) openPlatforms(false); });
  $("copied-filter").addEventListener("change", (e) => { ui.onCard = e.target.value; render(); });
  $("dev-filter").addEventListener("change", (e) => { ui.devFilter = e.target.value; render(); });
  $("note").addEventListener("click", (e) => { if (e.target.closest("[data-clear-filters]")) clearFilters(); });
  $("where").addEventListener("click", (e) => {
    const where = e.target.closest("[data-where]")?.dataset.where;
    if (where && where !== ui.where) setWhere(where);
  });
  $("select-mode").addEventListener("click", () => setSelecting(!app.selecting));
  $("bulk").addEventListener("click", (e) => {
    const b = e.target.closest("[data-bulk]");
    if (b && !b.disabled) bulkAction(b.dataset.bulk);
  });

  $("games-list").addEventListener("click", (e) => {
    const pickSys = e.target.closest(".sys-pick");
    if (pickSys) { toggleSystem(pickSys.closest(".system")); return; }
    const pick = e.target.closest(".pick");
    if (pick) { togglePick(pick.closest(".game"), e.shiftKey); return; }
    if (app.selecting && !e.target.closest(".card-transfer, .system-head")) {
      const el = e.target.closest(".game");
      if (el) { togglePick(el, e.shiftKey); return; }
    }
    const sysButton = e.target.closest(".sys-transfer");
    if (sysButton) {
      const sys = app.data.systems.find((s) => s.code === sysButton.dataset.code);
      startPlan([sys.code], `${sys.name} (${sys.code}) - ${sys.games.length.toLocaleString()} games`);
      return;
    }
    const gameButton = e.target.closest(".card-transfer");
    if (gameButton) {
      const [si, g] = app.visible[+gameButton.dataset.v];
      startPlan([keyOf(app.data.systems[si], g)], `${g.t} (${app.data.systems[si].code}/${g.f})`);
      return;
    }
    if (e.target.closest("[data-svm='free']")) { openFreeScummvm(); return; }
    if (e.target.closest("[data-lib='retry']")) { startLibraryLoad(); return; }
    const head = e.target.closest(".system-head");
    if (head) {
      const sec = head.parentElement;
      const code = sec.dataset.code;
      sec.classList.toggle("collapsed");
      sec.classList.contains("collapsed") ? ui.collapsed.add(code) : ui.collapsed.delete(code);
      head.setAttribute("aria-expanded", String(!sec.classList.contains("collapsed")));
      applyView();
      return;
    }
    if (e.target.closest("[data-dev='reload']")) { loadDevice(); return; }
    const game = e.target.closest(".game");
    if (game) openGame(game);
  });
  $("games-list").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.classList.contains("system-head")) {
      e.preventDefault();
      e.target.click();
      return;
    }
    const game = e.target.closest(".game");
    if (!game || e.target !== game) return;
    e.preventDefault();
    if (app.selecting || e.key === " ") togglePick(game, e.shiftKey); else openGame(game);
  });
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG" || !img.parentElement || img.closest("#themes, #themeview, .pm-sec, #portmaster, #portview, #appmarket, #appview")) return;
    const holder = img.parentElement;
    if (holder.classList.contains("d-img")) { holder.textContent = "Could not load"; return; }
    const el = holder.closest(".game");
    const g = el && el.dataset.d !== undefined ? app.devVisible[el.dataset.d]?.[1] : app.visible[el?.dataset.v ?? app.current]?.[1];
    img.replaceWith(Object.assign(document.createElement("span"), { className: "ph", textContent: g ? initial(g.t) : "?" }));
  }, true);

  $("v-transfer").addEventListener("click", () => {
    const [si, g] = app.visible[app.current];
    startPlan([keyOf(app.data.systems[si], g)], `${g.t} (${app.data.systems[si].code}/${g.f})`);
  });
  $("v-delete").addEventListener("click", openRemove);
  bindGameView({ open: openViewer, reload: reloadGame });
  $("v-close").addEventListener("click", () => $("viewer").close());
  $("v-prev").addEventListener("click", () => openViewer(app.current - 1));
  $("v-next").addEventListener("click", () => openViewer(app.current + 1));
  $("viewer").addEventListener("click", (e) => { if (e.target === $("viewer")) $("viewer").close(); });
  $("v-copy").addEventListener("click", async () => {
    const g = app.visible[app.current]?.[1];
    if (!g) return;
    toast(await copyText(app.data.roms ? app.data.roms + "/" + g.p.replace(/^Roms\//, "") : app.data.root + "/" + g.p) ? "Path copied" : "Could not copy the path");
  });

  $("r-library").addEventListener("change", syncRemove);
  $("r-device").addEventListener("change", syncRemove);
  $("r-cancel").addEventListener("click", () => $("remove").close());
  $("r-confirm").addEventListener("click", confirmRemove);

  $("d-close").addEventListener("click", () => $("devgame").close());
  $("d-delete").addEventListener("click", askDeleteDevGame);
  $("devgame").addEventListener("click", (e) => {
    if (e.target === $("devgame")) { $("devgame").close(); return; }
    const button = e.target.closest("[data-d]");
    if (!button || button.disabled) return;
    const action = button.dataset.d;
    if (action === "keep") { devOpen.confirming = false; renderDevGame(); }
    else if (action === "manage") {
      const { sys, g } = devOpen;
      $("devgame").close();
      showArtTab("device");
      setTimeout(() => openDeviceGame(sys, g, true), 80);
    }
    else if (action === "confirm") deleteDevGame();
    else if (action === "upload") pickImage().then((file) => devAction("upload", button.dataset.kind, file));
    else devAction(action, button.dataset.kind);
  });
  $("devgame").addEventListener("dragover", (e) => {
    const tile = e.target.closest("[data-drop-kind]");
    if (!tile || busy()) return;
    e.preventDefault();
    $("devgame").querySelectorAll(".d-tile.drop").forEach((t) => t !== tile && t.classList.remove("drop"));
    tile.classList.add("drop");
  });
  $("devgame").addEventListener("dragleave", (e) => {
    const tile = e.target.closest("[data-drop-kind]");
    if (tile && !tile.contains(e.relatedTarget)) tile.classList.remove("drop");
  });
  $("devgame").addEventListener("drop", (e) => {
    const tile = e.target.closest("[data-drop-kind]");
    if (!tile) return;
    e.preventDefault();
    tile.classList.remove("drop");
    const file = droppedImage(e);
    if (file) devAction("upload", tile.dataset.dropKind, file); else toast("Drop an image file (PNG, JPEG, WebP or GIF)", 3000);
  });
  $("devgame").addEventListener("close", () => { devOpen = null; });
}
