// Play: what you play on the handheld (MustardOS's play time tracker and history), and its game collections.

import { $, api, app, clock, esc, formatDate, formatTime, icon, initial, isOnCard, plural, store, toast } from "./core.js";
import { confirmBox } from "./art-images.js";

const TABS = [
  ["time", "clock", "Play time", "How long and how often you play each game on the handheld"],
  ["recent", "restore", "Recently played", "The games you started last on the handheld"],
  ["collections", "star", "Collections", "Game collections on the handheld: make them, fill them and tidy them"],
];
const P = { play: null, cols: null, error: "", colError: "", loading: false, volume: "", q: "", sort: store.get("playSort", "time"), open: null, add: "", busy: false, bound: false };

const tab = () => TABS.find((t) => t[0] === store.get("playTab", "time")) || TABS[0];
const volume = () => app.device.target?.id || "";

export function showPlay() {
  if (!P.bound) bind();
  if (P.volume !== volume() || (!P.play && !P.loading)) load();
  else render();
}

export function renderPlay() {
  if ($("view-play").hidden) return;
  if (P.volume !== volume()) load();
  else render();
}

async function load() {
  P.volume = volume();
  P.play = P.cols = null;
  P.error = P.colError = "";
  if (!P.volume) return render();
  P.loading = true;
  const seq = P.seq = (P.seq || 0) + 1;
  render();
  const v = encodeURIComponent(P.volume);
  await Promise.all([
    api(`play?volume=${v}`).then((r) => { if (seq === P.seq) P.play = r; }, (e) => { if (seq === P.seq) P.error = e.message; }),
    loadCollections(seq),
  ]);
  if (seq !== P.seq) return;
  P.loading = false;
  render();
}

async function loadCollections(seq = P.seq) {
  try {
    const cols = await api(`collections?volume=${encodeURIComponent(P.volume)}`);
    if (seq !== P.seq) return;
    P.cols = cols;
    P.colError = "";
    if (P.open !== null && !P.cols.collections.some((c) => c.path === P.open)) P.open = null;
  } catch (error) {
    if (seq === P.seq) P.colError = error.message;
  }
}

// ---------------------------------------------------------------- helpers

/** Library games by "<ROM folder>/<file>", for box art and names. */
function library() {
  const map = new Map();
  for (const sys of app.data?.systems || []) for (const g of sys.games) map.set(`${sys.code}/${g.f}`.toLowerCase(), { sys, g });
  return map;
}

const thumb = (lib, system, file, name) => {
  const hit = lib.get(`${system}/${file}`.toLowerCase());
  return `<span class="pl-art">${hit?.g.i ? `<img loading="lazy" src="${hit.g.i}" alt="">` : `<span>${esc(initial(name))}</span>`}</span>`;
};

const when = (s) => {
  if (!s) return "";
  const d = new Date(s * 1000), days = Math.floor((Date.now() - d) / 86400000);
  if (days < 1 && new Date().getDate() === d.getDate()) return `Today ${formatTime(d)}`;
  if (days < 2) return `Yesterday ${formatTime(d)}`;
  return days < 7 ? `${d.toLocaleDateString(undefined, { weekday: "long" })} ${formatTime(d)}` : formatDate(d, "long");
};

function shell(html) {
  $("play-body").innerHTML = html;
}

function notice() {
  if (!volume()) return `<div class="notice">Connect the handheld over USB or Wi-Fi to see what you play. <a href="#overview">Connection</a></div>`;
  return "";
}

// ---------------------------------------------------------------- rendering

function render() {
  if ($("view-play").hidden) return;
  const [id, , , sub] = tab();
  $("play-tabs").innerHTML = TABS.map(([t, ico, label]) =>
    `<button role="tab" data-pl-tab="${t}" class="${t === id ? "on" : ""}" aria-selected="${t === id}">${icon(ico)}<span>${label}</span></button>`).join("");
  $("play-sub").textContent = sub;
  $("play-actions").innerHTML = `<button class="btn" data-pl="refresh" title="Read the handheld again"${P.loading || !volume() ? " disabled" : ""}>${icon("refresh")}<span>Refresh</span></button>`;
  const off = notice();
  if (off) return shell(off);
  if (P.loading && !P.play && !P.cols) return shell(`<div class="planning"><span class="spinner"></span> Reading the handheld&hellip;</div>`);
  if (id === "collections") return renderCollections();
  if (P.error) return shell(`<div class="notice err">${esc(P.error)}</div>`);
  if (!P.play) return shell("");
  if (!P.play.available) return shell(`<div class="notice">${esc(P.play.reason)}</div>`);
  if (id === "recent") renderRecent(); else renderTime();
}

function empty(what) {
  return `<div class="empty-state">${icon("clock")}<b>No ${what} yet</b>
    <p>MustardOS records this on the handheld while activity tracking is on (it is by default). Play something, return to the main menu, then press Refresh.</p></div>`;
}

function renderTime() {
  const games = P.play.games;
  if (!games.length) return shell(empty("play time"));
  const total = games.reduce((n, g) => n + g.total, 0), launches = games.reduce((n, g) => n + g.launches, 0);
  const top = [...games].sort((a, b) => b.total - a.total)[0];
  const q = P.q.trim().toLowerCase();
  const sorters = { time: (a, b) => b.total - a.total, recent: (a, b) => b.last - a.last, launches: (a, b) => b.launches - a.launches, name: (a, b) => a.name.localeCompare(b.name) };
  const list = games.filter((g) => !q || g.name.toLowerCase().includes(q) || g.system.toLowerCase().includes(q)).sort(sorters[P.sort] || sorters.time);
  const lib = library(), max = Math.max(...games.map((g) => g.total), 1);
  shell(`<div class="art-kpis pl-kpis">
      <div class="kpi"><span class="kpi-ico">${icon("clock")}</span><span><small>Played</small><b>${clock(total)}</b><em>on the handheld</em></span></div>
      <div class="kpi"><span class="kpi-ico">${icon("handheld")}</span><span><small>Games</small><b>${games.length.toLocaleString()}</b><em>started at least once</em></span></div>
      <div class="kpi"><span class="kpi-ico">${icon("bolt")}</span><span><small>Launches</small><b>${launches.toLocaleString()}</b><em>${clock(launches ? total / launches : 0)} a session</em></span></div>
      <div class="kpi"><span class="kpi-ico">${icon("star")}</span><span><small>Most played</small><b title="${esc(top.name)}">${esc(top.name)}</b><em>${clock(top.total)}</em></span></div>
    </div>
    <section class="panel pl-panel">
      <div class="pl-bar">
        <label class="search small">${icon("search")}<input type="search" data-pl-q placeholder="Search played games" value="${esc(P.q)}" aria-label="Search played games"></label>
        <select class="control" data-pl-sort aria-label="Sort">${[["time", "Most played"], ["recent", "Last played"], ["launches", "Most launches"], ["name", "Name"]].map(([v, l]) =>
          `<option value="${v}"${v === P.sort ? " selected" : ""}>${l}</option>`).join("")}</select>
        <span class="muted-note">${list.length < games.length ? `${list.length} of ${plural(games.length, "game")}` : plural(games.length, "game")}</span>
      </div>
      <div class="pl-list">${list.map((g) => `<div class="pl-row">
        ${thumb(lib, g.system, g.file, g.name)}
        <span class="pl-name"><b title="${esc(g.path)}">${esc(g.name)}</b><small>${esc(g.system || "?")}${g.core ? ` &middot; ${esc(g.core.replace(/_libretro\.so$/, ""))}` : ""}</small></span>
        <span class="pl-meter" title="${clock(g.total)}"><i style="width:${Math.max(2, (g.total / max) * 100).toFixed(1)}%"></i></span>
        <span class="pl-num"><b>${clock(g.total)}</b><small>${g.launches.toLocaleString()} launch${g.launches === 1 ? "" : "es"}</small></span>
        <span class="pl-when">${esc(when(g.last))}</span>
      </div>`).join("") || `<p class="muted-note">Nothing matches.</p>`}</div>
    </section>`);
}

function renderRecent() {
  const { recent, games } = P.play;
  const byName = new Map(games.map((g) => [g.name.toLowerCase(), g]));
  const list = recent.length ? recent.map((r) => ({ ...(byName.get(r.name.toLowerCase()) || { name: r.name, system: "", file: "", total: 0 }), name: r.name, last: r.mtime }))
    : [...games].sort((a, b) => b.last - a.last);
  if (!list.length) return shell(empty("history"));
  const lib = library();
  shell(`<section class="panel pl-panel"><h2>${icon("restore")}Recently played <small>${list.length}</small></h2>
    <div class="pl-list">${list.slice(0, 200).map((g) => `<div class="pl-row recent">
      ${thumb(lib, g.system, g.file, g.name)}
      <span class="pl-name"><b>${esc(g.name)}</b><small>${esc(g.system || "")}</small></span>
      <span class="pl-num">${g.total ? `<b>${clock(g.total)}</b><small>in total</small>` : ""}</span>
      <span class="pl-when">${esc(when(g.last))}</span>
    </div>`).join("")}</div></section>`);
}

// ---------------------------------------------------------------- collections

const colName = (p) => (p === "" ? "Top level" : p.split("/").pop());

function renderCollections() {
  if (P.colError) return shell(`<div class="notice err">${esc(P.colError)}</div>`);
  const c = P.cols;
  if (!c) return shell("");
  if (!c.available) return shell(`<div class="notice">${esc(c.reason)}</div>`);
  const named = c.collections.filter((x) => x.path !== "");
  const top = c.collections.find((x) => x.path === "");
  const lists = top?.items.length ? [top, ...named] : named;
  if (P.open === null && lists.length) P.open = lists[0].path;
  const open = c.collections.find((x) => x.path === P.open);
  shell(`<div class="col-grid">
    <section class="panel col-side">
      <h2>${icon("star")}Collections <small>${named.length}</small><span class="grow"></span>
        <button class="btn small" data-pl="new"${P.busy ? " disabled" : ""}>${icon("plus")}<span>New</span></button></h2>
      ${lists.length ? `<div class="col-list">${lists.map((x) => `<button class="col-item${x.path === P.open ? " on" : ""}" data-pl="open" data-path="${esc(x.path)}">
        ${icon(x.path ? "star" : "list")}<span>${esc(colName(x.path))}${x.path.includes("/") ? `<small>${esc(x.path.split("/").slice(0, -1).join(" / "))}</small>` : ""}</span><em>${x.items.length}</em></button>`).join("")}</div>`
        : `<p class="muted-note">No collections yet. Make one, then add games from your library that are on the handheld.</p>`}
      <p class="muted-note">Kept on ${esc(c.storage)} in MUOS/info/collection. The handheld shows changes after you go back to its main menu.</p>
    </section>
    ${open ? collectionPanel(open, c) : `<section class="panel col-main"><div class="empty-state">${icon("star")}<b>Pick or make a collection</b></div></section>`}
  </div>`);
}

function collectionPanel(col, c) {
  const lib = library(), dis = P.busy ? " disabled" : "";
  const q = P.add.trim().toLowerCase();
  const inCol = new Set(col.items.map((i) => `${i.system}/${i.path.split("/").pop()}`.toLowerCase()));
  let results = [];
  if (q.length > 1) {
    for (const sys of app.data?.systems || []) for (const g of sys.games) {
      if (results.length >= 40) break;
      if (!isOnCard(sys, g) || inCol.has(`${sys.code}/${g.f}`.toLowerCase())) continue;
      if (g.t.toLowerCase().includes(q) || g.f.toLowerCase().includes(q)) results.push({ sys, g });
    }
  }
  return `<section class="panel col-main">
    <h2>${icon(col.path ? "star" : "list")}${esc(colName(col.path))} <small>${plural(col.items.length, "game")}</small><span class="grow"></span>
      ${col.path ? `<button class="btn small" data-pl="rename" data-path="${esc(col.path)}"${dis}>Rename</button>
      <button class="btn small danger" data-pl="delete" data-path="${esc(col.path)}"${dis}>${icon("trash")}<span>Delete</span></button>` : ""}</h2>
    <div class="col-add">
      <label class="search small">${icon("plus")}<input type="search" data-pl-add placeholder="Add games: type a name" value="${esc(P.add)}" aria-label="Find games to add"${app.data ? "" : " disabled"}></label>
      ${results.length > 1 ? `<button class="btn small" data-pl="add-all"${dis}>Add all ${results.length}</button>` : ""}
    </div>
    ${q.length > 1 ? `<div class="col-results">${results.map(({ sys, g }) => `<div class="pl-row result">
        ${thumb(lib, sys.code, g.f, g.t)}
        <span class="pl-name"><b>${esc(g.t)}</b><small>${esc(sys.code)}</small></span>
        <button class="btn small" data-pl="add" data-sys="${esc(sys.code)}" data-file="${esc(g.f)}"${dis}>${icon("plus")}<span>Add</span></button>
      </div>`).join("") || `<p class="muted-note">No games on the handheld match. Only games from your Roms/ library that are on ${esc(app.device.target?.storage || "the handheld")} can be added here.</p>`}</div>` : ""}
    <div class="pl-list">${col.items.map((i) => `<div class="pl-row item">
      ${thumb(lib, i.system, i.path.split("/").pop(), i.name)}
      <span class="pl-name"><b>${esc(i.name)}</b><small title="${esc(i.path)}">${esc(i.system)}</small></span>
      <button class="btn icon small ghost" data-pl="remove" data-file="${esc(i.file)}" title="Remove from the collection"${dis}>${icon("x")}</button>
    </div>`).join("") || `<p class="muted-note">This collection is empty. Type above to add games.</p>`}</div>
  </section>`;
}

async function act(fn) {
  P.busy = true;
  render();
  try { await fn(); } catch (error) { toast(error.message, 4500); }
  await loadCollections();
  P.busy = false;
  render();
}

async function askName(title, value, ok) {
  const answer = confirmBox({ title, html: `<input class="control fx-input" id="pl-name" value="${esc(value)}" spellcheck="false" autocomplete="off" placeholder="Name">`, ok });
  const input = $("pl-name");
  input.focus();
  input.select();
  input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("c-ok").click(); } };
  return (await answer) ? input.value.trim() : "";
}

function add(games) {
  const storage = app.device.target?.storage || "TF2";
  act(async () => {
    const r = await api("collections/add", { volume: volume(), path: P.open, games: games.map(([sys, file]) => ({ storage, rel: `${sys}/${file}` })) });
    toast(r.added ? `Added ${plural(r.added, "game")}` : "Already in the collection", 2200);
  });
}

function bind() {
  P.bound = true;
  const view = $("view-play");
  view.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-pl-tab]");
    if (t) { store.set("playTab", t.dataset.plTab); return render(); }
    const el = e.target.closest("[data-pl]");
    if (!el || el.disabled) return;
    const { pl, path } = el.dataset;
    if (pl === "refresh") load();
    else if (pl === "open") { P.open = path; P.add = ""; render(); }
    else if (pl === "new") {
      const name = await askName("New collection", "", "Create");
      if (name) act(async () => { const r = await api("collections/create", { volume: volume(), name }); P.open = r.path; });
    } else if (pl === "rename") {
      const to = await askName(`Rename ${colName(path)}`, colName(path), "Rename");
      if (to && to !== colName(path)) act(async () => { const r = await api("collections/rename", { volume: volume(), path, to }); P.open = r.path; });
    } else if (pl === "delete") {
      const col = P.cols.collections.find((x) => x.path === path);
      const ok = await confirmBox({ title: `Delete ${colName(path)}?`, html: `<p>The collection is deleted from the handheld. Its ${plural(col?.items.length || 0, "game")} stay where they are.</p>`, ok: "Delete", danger: true });
      if (ok) act(async () => { await api("collections/delete", { volume: volume(), path }); P.open = null; });
    } else if (pl === "add") add([[el.dataset.sys, el.dataset.file]]);
    else if (pl === "add-all") add([...view.querySelectorAll('[data-pl="add"]')].map((b) => [b.dataset.sys, b.dataset.file]));
    else if (pl === "remove") act(async () => { await api("collections/remove", { volume: volume(), path: P.open, files: [el.dataset.file] }); });
  });
  view.addEventListener("input", (e) => {
    if (e.target.matches("[data-pl-q]")) { P.q = e.target.value; refocus("[data-pl-q]"); }
    else if (e.target.matches("[data-pl-add]")) { P.add = e.target.value; refocus("[data-pl-add]"); }
  });
  view.addEventListener("change", (e) => {
    if (e.target.matches("[data-pl-sort]")) { P.sort = e.target.value; store.set("playSort", P.sort); render(); }
  });
}

/** Redraws while typing in a search box without losing the cursor. */
function refocus(sel) {
  const at = document.activeElement?.selectionStart;
  render();
  const input = $("view-play").querySelector(sel);
  if (input) { input.focus(); if (at != null) input.setSelectionRange(at, at); }
}
