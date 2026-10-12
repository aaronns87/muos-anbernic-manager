// Artwork > Roms/ library: the health of Roms/<SYS>/Imgs and tools to fix it.

import { $, app, api, esc, human, plural, initial, busy, toast, icon, model } from "./core.js";
import { screenText } from "./devices.js";
import { loadLibrary } from "./games.js";
import { maxSides, artMax, pngData, pickImage, droppedImage, confirmBox } from "./art-images.js";

const GRID_LIMIT = 300;
const FILTERS = [["all", "All images"], ["missing", "Missing"], ["orphan", "Leftovers"], ["dup", "Duplicates"], ["convert", "Not PNG"], ["large", "Oversized"]];
const state = {
  status: "idle", data: null, error: "",
  code: "", detail: null, detailStatus: "idle", detailError: "",
  filter: "all", q: "", selected: new Set(),
  /** A running bulk operation: { label, done, total, failed, stop }. */
  task: null
};
const noop = () => {};
let redraw = noop;

const stemOf = (name) => { const i = name.lastIndexOf("."); return i > 0 ? name.slice(0, i) : name; };
const sysInfo = (code) => app.data?.systems.find((s) => s.code === code) || { name: code, code, accent: "#7c9cff" };
const panel = (cls, title, body, actions = "") =>
  `<section class="panel ${cls}"><h2>${title}</h2>${body}${actions ? `<div class="panel-actions">${actions}</div>` : ""}</section>`;
const blocked = () => busy() || !!state.task;
const dis = () => (blocked() ? " disabled" : "");

export const localWorking = () => !!state.task;

/** Roms/ image totals for the Artwork summary, or null before the first check. */
export const localTotals = () => state.data?.totals ?? null;

let summaryQueued = false;
/** Starts the first check of Roms/ images in the background, so the summary can show problems on any tab. */
export function ensureLocalSummary(onDone) {
  if (state.status !== "idle" || summaryQueued) return;
  summaryQueued = true;
  if (redraw === noop) redraw = onDone;
  loadSummary(true).then(() => { summaryQueued = false; onDone(); });
}

/** Roms/ images changed elsewhere (e.g. scraping); reload when this tab shows next. */
export function invalidateLocal() {
  state.status = "idle";
  state.detail = null;
  state.detailStatus = "idle";
}

// ---------------------------------------------------------------- loading

async function loadSummary(quiet = false) {
  if (!quiet) { state.status = "loading"; redraw(); }
  else if (state.status === "idle") state.status = "loading";
  try {
    state.data = await api("artwork/local?screen=" + Math.max(...model().screen));
    state.status = "ready";
  } catch (error) {
    state.status = "error";
    state.error = error.message;
  }
  if (!quiet) redraw();
}

async function loadDetail(quiet = false) {
  const code = state.code;
  if (!code) return;
  if (!quiet) { state.detailStatus = "loading"; redraw(); }
  try {
    const detail = await api(`artwork/local/system?screen=${Math.max(...model().screen)}&code=` + encodeURIComponent(code));
    if (state.code !== code) return;
    state.detail = detail;
    state.detailStatus = "ready";
    const names = new Set(detail.images.map((i) => i.name));
    state.selected = new Set([...state.selected].filter((n) => names.has(n)));
  } catch (error) {
    state.detailStatus = "error";
    state.detailError = error.message;
  }
  if (!quiet) redraw();
}

let libraryTimer;
/** The Games section reads its own copy of Roms/; refresh it once edits settle. */
function refreshLibrarySoon() {
  clearTimeout(libraryTimer);
  libraryTimer = setTimeout(async () => {
    if (state.task || busy()) return refreshLibrarySoon();
    try {
      await api("games/rescan", {});
      await loadLibrary();
    } catch {}
  }, 1500);
}

async function afterChange() {
  await Promise.all([loadSummary(true), loadDetail(true)]);
  redraw();
  refreshLibrarySoon();
}

// ---------------------------------------------------------------- panels

function sizePicker() {
  const max = artMax.get();
  return `<label class="inline-field" title="Images you add, convert or shrink are saved as PNG no larger than this">Save at most
    <select class="control" data-al-max>${maxSides().map(([v, label]) => `<option value="${v}"${v === max ? " selected" : ""}>${label}</option>`).join("")}</select></label>`;
}

function taskLine() {
  const t = state.task;
  if (!t) return "";
  return `<span class="spinner sm"></span> ${esc(t.label)}: ${t.done.toLocaleString()} of ${t.total.toLocaleString()}${t.failed ? ` (${t.failed} failed)` : ""}
    <button class="link-btn" data-al="stop">Stop</button>`;
}

function updateTask() {
  const line = $("al-task");
  if (line) line.innerHTML = taskLine();
}

function healthPanel() {
  const title = "Roms/ artwork health";
  if (!state.data) {
    if (state.status === "error") {
      return panel("full", title, `<div class="notice err">${esc(state.error)}</div>`, `<button class="btn" data-al="reload">${icon("refresh")}<span>Try again</span></button>`);
    }
    return panel("full", title, `<div class="muted-note"><span class="spinner sm"></span> Looking at every image in Roms/&hellip;</div>`);
  }
  const t = state.data.totals, lim = state.data.limits;
  const fix = (n, op, ico, label, tip) => n
    ? `<button class="fix" data-al="bulk" data-op="${op}"${dis()} title="${esc(tip)}">${icon(ico)}<span><b>${n.toLocaleString()}</b>${label}</span><em>Fix</em></button>`
    : `<div class="fix done">${icon("check")}<span><b>0</b>${label}</span></div>`;
  return panel("full al-health", `${icon("wrench")}${title}${state.status === "loading" ? ` <span class="spinner sm"></span>` : ""}`, `
    <div class="fixes">
      ${fix(t.orphans, "orphans", "trash", "leftovers", "Images whose ROM is no longer in Roms/: move them to the Trash")}
      ${fix(t.duplicates, "duplicates", "copy", "duplicates", "Keep one image per game: the PNG, else the biggest")}
      ${fix(t.convert, "convert", "image", "not PNG", "MustardOS only shows PNG images: convert them")}
      ${fix(t.large, "shrink", "box", "oversized", `Wider or taller than ${lim.side} px, or over ${human(lim.bytes)}: shrink them`)}
      <div class="fix info">${icon("folder")}<span><b>${t.images.toLocaleString()}</b>images &middot; ${human(t.bytes)}</span></div>
    </div>
    <div class="al-task" id="al-task">${taskLine()}</div>`,
    `<span class="muted-note">Trashed images go to the Trash, so you can put them back. The screen is ${esc(screenText(model()))}.</span><span class="grow"></span>${sizePicker()}<button class="btn icon" data-al="reload"${state.task ? " disabled" : ""} title="Check again" aria-label="Check again">${icon("refresh")}</button>`);
}

function systemsList() {
  if (!state.data) return "";
  const items = state.data.systems.map((r) => {
    const s = sysInfo(r.code);
    const pct = r.games ? Math.floor(((r.games - r.missing) / r.games) * 100) : 0;
    const issues = r.orphans + r.duplicates + r.convert + r.large;
    return `<button class="al-sys${r.code === state.code ? " on" : ""}" data-al-sys="${esc(r.code)}" style="--accent:${s.accent}">
      <span class="al-sys-name"><b>${esc(s.name)}</b><span class="code">${esc(r.code)}</span></span>
      <span class="al-sys-meta"><span class="meter${pct === 100 ? " full" : ""}"><i style="width:${pct}%"></i></span><small>${pct}%</small>
        ${r.missing ? `<span class="flag" title="${r.missing} missing">${r.missing.toLocaleString()}</span>` : ""}
        ${issues ? `<span class="flag warn" title="${issues} images to fix">${icon("alert")}${issues.toLocaleString()}</span>` : ""}</span>
    </button>`;
  }).join("");
  return `<section class="panel al-systems"><h2>${icon("layers")}Systems <small>${state.data.systems.length}</small></h2><div class="al-sys-list">${items}</div></section>`;
}

function counts(d) {
  const n = (fn) => d.images.filter(fn).length;
  return {
    all: d.images.length, missing: d.missing.length, orphan: n((i) => i.orphan), dup: n((i) => i.dup),
    convert: n((i) => i.convert && !i.orphan), large: n((i) => i.large && !i.orphan)
  };
}

function detailPanel() {
  if (!state.code) {
    return `<section class="panel al-detail"><div class="empty-state">${icon("image")}<p><b>Pick a system</b> to see its images, add missing ones and fix problems one by one.
      Drop image files straight onto a game.</p></div></section>`;
  }
  const s = sysInfo(state.code);
  const title = `${esc(s.name)} <span class="code" style="--accent:${s.accent}">${esc(state.code)}</span><span class="grow"></span><button class="btn icon small ghost" data-al="close" title="Close" aria-label="Close">${icon("x")}</button>`;
  const d = state.detail;
  if (!d || d.system !== state.code) {
    return panel("al-detail", title, state.detailStatus === "error"
      ? `<div class="notice err">${esc(state.detailError)}</div>`
      : `<div class="muted-note"><span class="spinner sm"></span> Reading Roms/${esc(state.code)}/Imgs&hellip;</div>`);
  }
  const n = counts(d);
  const max = artMax.get();
  return panel("al-detail", title, `<div class="art-tools">
      <div class="segmented" id="al-filter">${FILTERS.map(([id, label]) => `<button data-al-filter="${id}" class="${state.filter === id ? "on" : ""}">${label} <small>${n[id].toLocaleString()}</small></button>`).join("")}</div>
      <div class="search small">${icon("search")}<input id="al-q" type="search" placeholder="Search names" value="${esc(state.q)}" autocomplete="off" spellcheck="false"></div>
    </div>
    <div class="muted-note">Drop an image on a game, or use Add / Replace. Saved as Roms/${esc(state.code)}/Imgs/&lt;game&gt;.png${max ? `, at most ${max} px` : ""}; the old image goes to the Trash.</div>
    <div class="al-bulk" id="al-bulk"></div>
    <div class="ag-grid" id="al-grid"></div>`);
}

let listScroll = 0;

export function localPanels(bindRedraw) {
  redraw = bindRedraw;
  listScroll = document.querySelector(".al-sys-list")?.scrollTop || 0;
  if (state.status === "idle") queueMicrotask(() => loadSummary());
  if (state.code && !state.detail && state.detailStatus === "idle") queueMicrotask(() => loadDetail());
  return healthPanel() + (state.data ? `<div class="al-split">${systemsList()}${detailPanel()}</div>` : "");
}

// ---------------------------------------------------------------- the image grid

function shownItems() {
  const d = state.detail, q = state.q;
  if (!d) return [];
  if (state.filter === "missing") return d.missing.filter((name) => !q || name.toLowerCase().includes(q)).map((name) => ({ missing: true, name }));
  const test = {
    all: () => true, orphan: (i) => i.orphan, dup: (i) => i.dup,
    convert: (i) => i.convert && !i.orphan, large: (i) => i.large && !i.orphan
  }[state.filter];
  return d.images.filter((i) => test(i) && (!q || i.name.toLowerCase().includes(q)));
}

function badges(i) {
  return [
    i.orphan ? `<span class="badge bad" title="No ROM in Roms/${esc(state.code)} has this name">Leftover</span>` : "",
    i.dup ? `<span class="badge warn" title="This game has more than one image">Duplicate</span>` : "",
    i.convert ? `<span class="badge warn" title="MustardOS only shows PNG images">${i.ext === "png" ? "Broken PNG" : i.ext.toUpperCase()}</span>` : "",
    i.large ? `<span class="badge" title="Bigger than the handheld needs">Oversized</span>` : ""
  ].join("");
}

function cardHtml(item) {
  if (item.missing) {
    const stem = stemOf(item.name);
    return `<div class="ag-card missing" data-drop-stem="${esc(stem)}">
      <div class="ag-img"><span class="ph">${esc(initial(stem))}</span><span class="ag-drop">Drop an image</span></div>
      <div class="ag-info"><b title="${esc(item.name)}">${esc(stem)}</b><small>${esc(item.name)}</small></div>
      <div class="ag-actions"><button class="btn small" data-al="add" data-stem="${esc(stem)}"${dis()}>${icon("plus")}<span>Add image</span></button></div>
    </div>`;
  }
  const i = item, stem = stemOf(i.name), picked = state.selected.has(i.name);
  return `<div class="ag-card${picked ? " selected" : ""}"${i.orphan ? "" : ` data-drop-stem="${esc(stem)}"`}>
    <label class="ag-check" title="Select"><input type="checkbox" data-al-pick="${esc(i.name)}"${picked ? " checked" : ""}></label>
    <div class="ag-img"><img loading="lazy" decoding="async" src="${esc(i.url)}" alt="">${i.orphan ? "" : `<span class="ag-drop">Drop to replace</span>`}</div>
    <div class="ag-info"><b title="${esc(i.name)}">${esc(i.name)}</b>
      <small>${i.w ? `${i.w}&times;${i.h} &middot; ` : ""}${human(i.size)}</small>
      <div class="ag-badges">${badges(i)}</div></div>
    <div class="ag-actions">
      ${i.orphan ? "" : `<button class="btn small" data-al="replace" data-stem="${esc(stem)}"${dis()}>${icon("upload")}<span>Replace</span></button>`}
      <button class="btn icon small danger" data-al="trash" data-name="${esc(i.name)}"${dis()} title="Move to the Trash" aria-label="Move to the Trash">${icon("trash")}</button>
    </div>
  </div>`;
}

function renderGrid() {
  const box = $("al-grid");
  if (!box || !state.detail) return;
  const items = shownItems();
  const empty = state.q ? "Nothing matches." : {
    all: "No images in this folder yet.", missing: "Every game has artwork.", orphan: "No leftovers.",
    dup: "No duplicates.", convert: "Every image is a PNG.", large: "No oversized images."
  }[state.filter];
  box.innerHTML = items.length
    ? items.slice(0, GRID_LIMIT).map(cardHtml).join("") +
      (items.length > GRID_LIMIT ? `<div class="muted-note ag-more">Showing ${GRID_LIMIT} of ${items.length.toLocaleString()}. Search to narrow it down.</div>` : "")
    : `<div class="muted-note">${empty}</div>`;
  renderBulk();
}

function renderBulk() {
  const box = $("al-bulk");
  if (!box) return;
  if (state.filter === "missing" || !state.detail) { box.innerHTML = ""; return; }
  const shown = shownItems();
  const all = shown.length > 0 && shown.every((i) => state.selected.has(i.name));
  const n = state.selected.size, max = artMax.get();
  box.innerHTML = shown.length ? `<label class="check"><input type="checkbox" data-al="all"${all ? " checked" : ""}><span>Select all ${shown.length.toLocaleString()} shown</span></label>
    ${n ? `<b>${plural(n, "image")} selected</b>
      <button class="btn small" data-al="sel-png"${dis()} title="Re-save as PNG${max ? ` at most ${max} px` : ""}; leftovers are skipped">Save as PNG${max ? ` (max ${max} px)` : ""}</button>
      <button class="btn small danger" data-al="sel-trash"${dis()}>${icon("trash")}<span>Move to the Trash</span></button>
      <button class="link-btn" data-al="sel-none">Clear selection</button>` : ""}` : "";
}

export function afterLocalDraw() {
  const list = document.querySelector(".al-sys-list");
  if (list) list.scrollTop = listScroll;
  renderGrid();
}

// ---------------------------------------------------------------- actions

async function trashNames(code, names) {
  let trashed = 0;
  for (let i = 0; i < names.length; i += 1000) trashed += (await api("artwork/local/delete", { system: code, names: names.slice(i, i + 1000) })).trashed;
  return trashed;
}

async function saveImage(code, stem, source) {
  const png = await pngData(source, artMax.get());
  await api("artwork/local/put", { system: code, stem, data: png.data });
  return png;
}

async function useFile(stem, file) {
  if (!file) return;
  if (blocked()) { toast("Wait for the current job to finish first"); return; }
  try {
    const png = await saveImage(state.code, stem, file);
    toast(`Saved ${stem}.png (${png.width}\u00d7${png.height}, ${human(png.size)})`, 2500);
    await afterChange();
  } catch (error) {
    toast(error.message, 4000);
  }
}

async function askTrash(names) {
  if (!names.length || blocked()) return;
  const list = names.length <= 8 ? `<ul class="files-list" style="margin-top:10px">${names.map((n) => `<li><code>${esc(n)}</code></li>`).join("")}</ul>` : "";
  const ok = await confirmBox({
    title: "Move to the Trash",
    html: `<p>Move <b>${plural(names.length, "image")}</b> from Roms/${esc(state.code)}/Imgs to the Trash? You can put them back from the Trash.</p>${list}`,
    ok: "Move to the Trash", danger: true
  });
  if (!ok) return;
  try {
    const trashed = await trashNames(state.code, names);
    names.forEach((n) => state.selected.delete(n));
    toast(`${plural(trashed, "image")} moved to the Trash`, 2500);
    await afterChange();
  } catch (error) {
    toast(error.message, 4000);
  }
}

/** Runs fn for every item, showing progress; one failure does not stop the rest. */
async function runTask(label, items, fn) {
  const task = state.task = { label, done: 0, total: items.length, failed: 0, stop: false, error: "" };
  redraw();
  for (const item of items) {
    if (task.stop) break;
    try {
      await fn(item);
    } catch (error) {
      task.failed++;
      task.error = error.message;
    }
    task.done++;
    updateTask();
  }
  state.task = null;
  toast(`${label}: ${task.done - task.failed} done${task.failed ? `, ${task.failed} failed (${task.error})` : ""}${task.stop ? ", stopped" : ""}`, task.failed ? 6000 : 3000);
  await afterChange();
}

/** Images that can be re-saved as PNG: not leftovers, and no non-PNG copy that would overwrite the game's PNG. */
const convertible = (i) => !i.orphan && !(i.dup && i.ext !== "png");

async function reencode(label, list) {
  const todo = list.filter((x) => convertible(x.image));
  const skipped = list.length - todo.length;
  if (!todo.length) { toast(skipped ? "Nothing to do: resolve leftovers and duplicates first" : "Nothing to do", 3000); return; }
  await runTask(label, todo, ({ code, image }) => saveImage(code, stemOf(image.name), image.url));
  if (skipped) toast(`${plural(skipped, "image")} skipped: leftovers, or duplicates to resolve first`, 4000);
}

/** For each game with several images, keeps the working PNG (or the biggest image) and returns the rest. */
function extraCopies(images) {
  const groups = new Map();
  for (const i of images.filter((x) => x.dup)) {
    const key = stemOf(i.name).toLowerCase();
    groups.set(key, [...(groups.get(key) || []), i]);
  }
  const extra = [];
  for (const group of groups.values()) {
    const rank = (i) => (i.ext === "png" && !i.convert ? 1e12 : 0) + i.size;
    const keep = group.reduce((a, b) => (rank(b) > rank(a) ? b : a));
    extra.push(...group.filter((i) => i !== keep).map((i) => i.name));
  }
  return extra;
}

async function details(rows) {
  const out = [];
  for (const r of rows) out.push(await api(`artwork/local/system?screen=${Math.max(...model().screen)}&code=` + encodeURIComponent(r.code)));
  return out;
}

async function bulk(op) {
  if (blocked() || !state.data) return;
  const t = state.data.totals, rows = state.data.systems;
  const max = artMax.get();
  try {
    if (op === "orphans") {
      const which = rows.filter((r) => r.orphans);
      const ok = await confirmBox({
        title: "Trash leftover images",
        html: `<p>Move <b>${plural(t.orphans, "image")}</b> whose ROM is no longer in Roms/ to the Trash? They are in ${plural(which.length, "system")}.
          You can put them back from the Trash.</p>`,
        ok: "Move to the Trash", danger: true
      });
      if (!ok) return;
      await runTask("Moving leftovers to the Trash", which, async (r) => {
        const d = await api(`artwork/local/system?screen=${Math.max(...model().screen)}&code=` + encodeURIComponent(r.code));
        const names = d.images.filter((i) => i.orphan).map((i) => i.name);
        if (names.length) await trashNames(r.code, names);
      });
    } else if (op === "duplicates") {
      const ok = await confirmBox({
        title: "Resolve duplicates",
        html: `<p>For every game with more than one image, keep one and move the others to the Trash. The PNG is kept when there is one,
          otherwise the biggest image.</p><p class="muted-note">${plural(t.duplicates, "image")} involved. You can put them back from the Trash.</p>`,
        ok: "Resolve duplicates"
      });
      if (!ok) return;
      await runTask("Resolving duplicates", rows.filter((r) => r.duplicates), async (r) => {
        const names = extraCopies((await api(`artwork/local/system?screen=${Math.max(...model().screen)}&code=` + encodeURIComponent(r.code))).images);
        if (names.length) await trashNames(r.code, names);
      });
    } else if (op === "convert" || op === "shrink") {
      if (op === "shrink" && !max) { toast("Choose a maximum size first", 3000); return; }
      const key = op === "convert" ? "convert" : "large";
      const which = rows.filter((r) => r[key]);
      const ok = await confirmBox({
        title: op === "convert" ? "Convert to PNG" : "Shrink oversized images",
        html: `<p>${op === "convert" ? `Re-save <b>${plural(t.convert, "image")}</b> as PNG` : `Re-save <b>${plural(t.large, "oversized image")}</b>`}${max ? `, at most ${max} px wide or tall` : ""}.
          The originals go to the Trash. Leftovers are skipped, and so are non-PNG copies of games that already have a PNG (resolve duplicates for those).</p>`,
        ok: op === "convert" ? "Convert" : "Shrink"
      });
      if (!ok) return;
      state.task = { label: "Looking at images", done: 0, total: which.length, failed: 0, stop: false };
      redraw();
      const all = await details(which);
      state.task = null;
      const list = all.flatMap((d) => d.images.filter((i) => (op === "convert" ? i.convert : i.large)).map((image) => ({ code: d.system, image })));
      await reencode(op === "convert" ? "Converting to PNG" : "Shrinking", list);
    }
  } catch (error) {
    state.task = null;
    toast(error.message, 4000);
    redraw();
  }
}

function openSystem(code, filter) {
  if (state.code !== code) {
    state.code = code;
    state.detail = null;
    state.selected = new Set();
    state.q = "";
  }
  if (filter) state.filter = filter;
  loadDetail();
  requestAnimationFrame(() => document.querySelector(".al-split")?.scrollIntoView({ block: "start", behavior: "smooth" }));
}

/** active() tells whether the Roms/ library tab is showing. */
export function bindLocal(root, active) {
  for (const type of ["dragover", "drop"]) {
    document.addEventListener(type, (e) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
  }
  root.addEventListener("click", async (e) => {
    if (!active()) return;
    const sys = e.target.closest("[data-al-sys]");
    if (sys) return openSystem(sys.dataset.alSys);
    const f = e.target.closest("[data-al-filter]");
    if (f) {
      state.filter = f.dataset.alFilter;
      root.querySelectorAll("#al-filter button").forEach((b) => b.classList.toggle("on", b === f));
      return renderGrid();
    }
    const el = e.target.closest("[data-al]");
    if (!el) return;
    const act = el.dataset.al;
    if (act === "reload") { await loadSummary(); if (state.code) loadDetail(); return; }
    if (act === "stop") { if (state.task) state.task.stop = true; return; }
    if (act === "close") { state.code = ""; state.detail = null; state.selected = new Set(); return redraw(); }
    if (act === "bulk") return bulk(el.dataset.op);
    if (act === "add" || act === "replace") return useFile(el.dataset.stem, await pickImage());
    if (act === "trash") return askTrash([el.dataset.name]);
    if (act === "all") {
      const shown = shownItems();
      if (el.checked) shown.forEach((i) => state.selected.add(i.name)); else shown.forEach((i) => state.selected.delete(i.name));
      return renderGrid();
    }
    if (act === "sel-none") { state.selected.clear(); return renderGrid(); }
    if (act === "sel-trash") return askTrash([...state.selected]);
    if (act === "sel-png") {
      const images = state.detail.images.filter((i) => state.selected.has(i.name));
      state.selected.clear();
      return reencode("Saving as PNG", images.map((image) => ({ code: state.code, image })));
    }
  });
  root.addEventListener("change", (e) => {
    if (!active()) return;
    if (e.target.matches("[data-al-max]")) { artMax.set(e.target.value); redraw(); return; }
    const pick = e.target.closest("[data-al-pick]");
    if (pick) {
      if (pick.checked) state.selected.add(pick.dataset.alPick); else state.selected.delete(pick.dataset.alPick);
      pick.closest(".ag-card")?.classList.toggle("selected", pick.checked);
      renderBulk();
    }
  });
  let timer;
  root.addEventListener("input", (e) => {
    if (e.target.id !== "al-q") return;
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); renderGrid(); }, 120);
  });
  root.addEventListener("dragover", (e) => {
    const target = e.target.closest("[data-drop-stem]");
    if (!target || !e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    root.querySelectorAll(".ag-card.drop").forEach((c) => c !== target && c.classList.remove("drop"));
    target.classList.add("drop");
  });
  root.addEventListener("dragleave", (e) => {
    const target = e.target.closest("[data-drop-stem]");
    if (target && !target.contains(e.relatedTarget)) target.classList.remove("drop");
  });
  root.addEventListener("drop", (e) => {
    const target = e.target.closest("[data-drop-stem]");
    if (!target) return;
    e.preventDefault();
    target.classList.remove("drop");
    const file = droppedImage(e);
    if (!file) { toast("Drop an image file (PNG, JPEG, WebP or GIF)", 3000); return; }
    useFile(target.dataset.dropStem, file);
  });
}

/** From elsewhere (e.g. "Show" for a system's missing artwork): open a system in this tab. */
export function showLocalSystem(code, filter = "missing") {
  openSystem(code, filter);
}
