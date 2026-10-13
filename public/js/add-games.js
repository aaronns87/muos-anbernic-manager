// Games > Add new: drop or choose game files, check the detected system, pick a description and artwork, then copy
// everything into Roms/<SYS>/ (artwork goes to Imgs, descriptions to Text).

import { $, app, api, esc, human, plural, toast, icon, busy, EXCLUDED, TOKEN } from "./core.js";
import { loadLibrary, scrollToSystem } from "./games.js";
import { artMax, pngData, pickImage, confirmBox } from "./art-images.js";
import { compose, imageUrl, scrapeLook, STYLES } from "./art-scrape.js";
import { consoleIcon } from "./consoles.js";
import { openFreeScummvm } from "./free-scummvm.js";
import { openPortMaster } from "./ports.js";

const NOT_GAMES = new Set(["xml", "txt", "db", "ini", "cfg", "json", "png", "jpg", "jpeg", "gif", "webp", "nfo", "srm", "sav",
  "state", "log", "bak", "dat", "md5", "sha1", "url"]);
const BAD_CHARS = /[\\/:*?"<>|\u0000-\u001f]/;
const KINDS = [["box", "Box"], ["snap", "Screenshot"], ["title", "Title screen"]];

const A = { items: [], sel: 0, seq: 0, adding: false, stop: false, xhr: null, finished: null, platOpen: false, platQ: "", indexed: true, dragging: 0 };
const pending = [];
let running = 0;

const extOf = (name) => (name.lastIndexOf(".") > 0 ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");
const stemOf = (name) => (name.lastIndexOf(".") > 0 ? name.slice(0, name.lastIndexOf(".")) : name);
const finalName = (it) => `${it.stem.trim()}.${it.ext}`;
const selected = () => A.items.find((it) => it.id === A.sel) || null;
const sysOf = (code) => app.data?.systems.find((s) => s.code === code) || null;
const sysName = (code) => sysOf(code)?.name || code;
const validStem = (stem) => !!stem.trim() && !stem.trim().startsWith(".") && !BAD_CHARS.test(stem) && stem.trim().length <= 200;

/** "Legend of Zelda, The (USA)" -> "The Legend of Zelda", like the library shows titles. */
function titleOf(stem) {
  let t = stem.replace(/\s*[([][^)\]]*[)\]]/g, "").trim() || stem;
  const m = /^(.*?), (The|A|An)(\s+-\s+.*|:\s+.*)?$/.exec(t);
  if (m) t = `${m[2]} ${m[1]}${m[3] || ""}`;
  return t;
}
/** The server's title key (games/systems.ts norm). */
const titleKey = (t) => t.toLowerCase().replace(/\s*[([][^)\]]*[)\]]/g, "").replaceAll("&", " and ").trim()
  .replace(/^(the|a|an)\s+/, "").replace(/,\s*(the|a|an)\b/g, "").replace(/[^a-z0-9]+/g, "");

function exists(it) {
  const name = finalName(it).toLowerCase();
  return !!sysOf(it.code)?.games.some((g) => g.f.toLowerCase() === name);
}

function status(it) {
  if (it.state === "uploading") return ["busy", it.size ? `${Math.floor((it.sent / it.size) * 100)}%` : "Copying"];
  if (it.state === "done") return [it.warnings.length ? "warn" : "ok", it.warnings.length ? "Added, with warnings" : "Added"];
  if (it.state === "failed") return ["bad", it.error];
  if (!it.det) return ["busy", "Detecting\u2026"];
  if (!it.code) return ["warn", "Choose a platform"];
  if (it.data && it.code !== "SCUMMVM") return ["bad", "Game folders need ScummVM"];
  if (!validStem(it.stem)) return ["bad", "Fix the file name"];
  if (exists(it) && !it.replace) return ["warn", "Already in the library"];
  return ["ok", "Ready"];
}
const ready = (it) => it.state === "new" && status(it)[0] === "ok";

// ---------------------------------------------------------------- files in

/** Entry names in a zip, read from its central directory without unpacking; null for zip64 or broken files. */
async function zipEntries(file) {
  const tail = Math.min(file.size, 66_000);
  const end = new DataView(await file.slice(file.size - tail).arrayBuffer());
  let at = -1;
  for (let i = tail - 22; i >= 0; i--) if (end.getUint32(i, true) === 0x06054b50) { at = i; break; }
  if (at < 0) return null;
  const count = end.getUint16(at + 10, true), size = end.getUint32(at + 12, true), offset = end.getUint32(at + 16, true);
  if (offset === 0xffffffff || size > 4_000_000 || offset + size > file.size) return null;
  const dir = new DataView(await file.slice(offset, offset + size).arrayBuffer());
  const text = new TextDecoder();
  const names = [];
  for (let p = 0, n = 0; n < count && p + 46 <= dir.byteLength && names.length < 200; n++) {
    if (dir.getUint32(p, true) !== 0x02014b50) break;
    const len = dir.getUint16(p + 28, true), extra = dir.getUint16(p + 30, true), note = dir.getUint16(p + 32, true);
    const name = text.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, len));
    if (!name.endsWith("/")) names.push(name);
    p += 46 + len + extra + note;
  }
  return names;
}

function newItem(file, extra = [], data = null) {
  const ext = extOf(file.name);
  return {
    id: ++A.seq, file, extra, data, name: file.name, ext, stem: stemOf(file.name),
    size: file.size + extra.reduce((n, f) => n + f.size, 0) + (data || []).reduce((n, d) => n + d.file.size, 0),
    det: null, code: "", how: "", replace: false, state: "new", sent: 0, error: "", warnings: [],
    desc: { mode: "db", status: "idle", q: titleOf(stemOf(file.name)), results: null, pick: "", text: "", error: "" },
    art: { mode: "find", status: "idle", picks: null, style: scrapeLook().style, url: "", canvas: null, own: null, ownUrl: "", error: "" },
  };
}

const JUNK = /^(\.DS_Store|Thumbs\.db|desktop\.ini|\._.*)$/i;

/** A ScummVM game from a folder: an empty "<folder>.scummvm" plus the folder's files ([{file, rel}], rel below the folder). */
function addFolders(folders) {
  if (A.adding) return;
  if (A.finished) reset();
  const queued = new Set(A.items.map((it) => it.name.toLowerCase()));
  const fresh = [];
  for (const { name, files } of folders) {
    const data = files.filter((d) => !d.rel.split("/").some((p) => JUNK.test(p)));
    if (!data.length) continue;
    const it = newItem(new File([], `${name}.scummvm`), [], data);
    if (!queued.has(it.name.toLowerCase())) fresh.push(it);
  }
  if (!fresh.length) { toast(folders.length ? "Those folders are empty or already in the list" : "Nothing to add"); return; }
  A.items.push(...fresh);
  if (!selected()) A.sel = fresh[0].id;
  render();
  detect(fresh);
}

/** Every file below a dropped folder entry, with paths relative to it. */
async function readFolder(entry, prefix = "") {
  if (entry.isFile) return [{ file: await new Promise((ok, bad) => entry.file(ok, bad)), rel: prefix + entry.name }];
  const reader = entry.createReader(), out = [];
  for (;;) {
    const batch = await new Promise((ok, bad) => reader.readEntries(ok, bad));
    if (!batch.length) break;
    for (const child of batch) out.push(...await readFolder(child, `${prefix}${entry.name}/`));
  }
  return out;
}

/** Files from a folder picker grouped into one game per chosen folder. */
function pickedFolders(list) {
  const groups = new Map();
  for (const file of list) {
    const [top, ...rest] = (file.webkitRelativePath || file.name).split("/");
    if (!rest.length) continue;
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top).push({ file, rel: rest.join("/") });
  }
  return [...groups].map(([name, files]) => ({ name, files }));
}

/** Turns dropped or chosen files into queue items; .bin tracks ride along with their .cue (or .gdi) sheet. */
function addFiles(list) {
  if (A.adding) return;
  if (A.finished) reset();
  const files = [...list];
  const skipped = files.filter((f) => !extOf(f.name) || NOT_GAMES.has(extOf(f.name)) || f.name.startsWith("."));
  let games = files.filter((f) => !skipped.includes(f));
  const taken = new Set();
  const items = [];
  for (const sheet of games.filter((f) => ["cue", "ccd", "gdi"].includes(extOf(f.name)))) {
    const stem = stemOf(sheet.name).toLowerCase();
    const tracks = games.filter((f) => f !== sheet && !taken.has(f) && ["bin", "img", "sub", "raw"].includes(extOf(f.name))
      && (f.name.toLowerCase().startsWith(stem) || (extOf(sheet.name) === "gdi" && /^track\d+/i.test(f.name))));
    tracks.forEach((f) => taken.add(f));
    taken.add(sheet);
    items.push(newItem(sheet, tracks));
  }
  for (const f of games) if (!taken.has(f)) items.push(newItem(f));
  items.sort((a, b) => games.indexOf(a.file) - games.indexOf(b.file));
  const queued = new Set(A.items.map((it) => it.name.toLowerCase()));
  const fresh = items.filter((it) => !queued.has(it.name.toLowerCase()));
  if (skipped.length) toast(`Skipped ${plural(skipped.length, "file")} that ${skipped.length === 1 ? "isn't a game" : "aren't games"} (images, text, saves\u2026)`, 3200);
  if (!fresh.length) { if (items.length) toast("Those files are already in the list"); return; }
  A.items.push(...fresh);
  if (!selected()) A.sel = fresh[0].id;
  render();
  detect(fresh);
}

async function detect(items) {
  try {
    const files = await Promise.all(items.map(async (it) => it.data ? { name: it.stem, size: it.size, folder: true } : {
      name: it.name, size: it.size, inner: it.ext === "zip" ? await zipEntries(it.file).catch(() => null) : null,
    }));
    const r = await api("games/add/detect", { files });
    A.indexed = r.indexed;
    items.forEach((it, i) => {
      it.det = r.files[i];
      it.desc.q = it.det.title || it.desc.q;
      if (!it.code && it.det.pick) { it.code = it.det.pick; it.how = "auto"; autoFill(it); }
    });
  } catch (error) {
    items.forEach((it) => { it.det = { candidates: [], confidence: "none", error: error.message, title: titleOf(it.stem) }; });
  }
  render();
}

// ---------------------------------------------------------------- description and artwork lookups

function enqueue(task) {
  pending.push(task);
  pump();
}
function pump() {
  while (running < 2 && pending.length) {
    const task = pending.shift();
    running++;
    task().finally(() => { running--; pump(); });
  }
}

function autoFill(it) {
  if (it.desc.mode === "db") enqueue(() => searchDesc(it, true));
  if (it.art.mode === "find") enqueue(() => findArt(it));
}

function setPlatform(it, code, how = "user") {
  if (it.code === code) return;
  it.code = code;
  it.how = how;
  it.desc.results = null; it.desc.pick = "";
  if (it.desc.mode === "db") it.desc.text = "";
  it.art.picks = null; it.art.url = ""; it.art.canvas = null;
  if (it.art.status !== "idle") it.art.status = "idle";
  autoFill(it);
}

async function searchDesc(it, auto = false) {
  const code = it.code;
  if (!code) return;
  it.desc.status = "busy"; it.desc.error = "";
  draw(it);
  try {
    const { results } = await api("games/add/describe", { code, q: it.desc.q || titleOf(it.stem) });
    if (it.code !== code) return;
    it.desc.results = results;
    it.desc.status = "done";
    const exact = results.find((r) => r.exact);
    if (auto && exact && it.desc.mode === "db" && !it.desc.pick) choose(it, exact.id);
  } catch (error) {
    if (it.code !== code) return;
    it.desc.status = "error"; it.desc.error = error.message; it.desc.results = null;
  }
  draw(it);
}

function choose(it, id) {
  const r = it.desc.results?.find((x) => x.id === id);
  if (!r) return;
  it.desc.pick = id;
  it.desc.text = r.d || "";
  it.desc.mode = "db";
}

async function findArt(it) {
  const code = it.code;
  if (!code) return;
  it.art.status = "busy"; it.art.error = "";
  draw(it);
  try {
    const picked = it.desc.results?.find((r) => r.id === it.desc.pick)?.name;
    const names = [it.det?.arcade, it.stem, it.det?.stem, picked, titleOf(it.stem)].filter(Boolean);
    const picks = await api("games/add/artwork", { code, names });
    if (it.code !== code) return;
    it.art.picks = picks;
    it.art.status = picks.box || picks.snap || picks.title ? "done" : "none";
    await renderPreview(it);
  } catch (error) {
    if (it.code !== code) return;
    it.art.status = "error"; it.art.error = error.message;
  }
  draw(it);
}

async function renderPreview(it) {
  it.art.canvas = it.art.picks ? await compose(it.art.picks, it.art.style, scrapeLook().size) : null;
  it.art.url = it.art.canvas ? it.art.canvas.toDataURL("image/png") : "";
}

/** The description to write to Roms/<SYS>/Text, or "" when there is none or the library would find the same one by name. */
function descToSave(it) {
  if (it.desc.mode === "none") return "";
  const text = it.desc.text.trim();
  if (!text) return "";
  if (it.desc.mode === "db") {
    const r = it.desc.results?.find((x) => x.id === it.desc.pick);
    const sameName = titleKey(r?.name || "") === titleKey(titleOf(it.stem))
      || (!!it.det?.arcade && it.stem.trim() === it.det.stem && titleKey(r?.name || "") === titleKey(it.det.title));
    if (r && r.exact && sameName && text === (r.d || "").trim()) return "";
  }
  return text;
}

async function artData(it) {
  if (it.art.mode === "own" && it.art.own) return pngData(it.art.own, artMax.get());
  if (it.art.mode === "find" && it.art.canvas) {
    const blob = await new Promise((resolve) => it.art.canvas.toBlob(resolve, "image/png"));
    return pngData(blob, 0);
  }
  return null;
}

// ---------------------------------------------------------------- adding

function upload(file, system, name, replace, onProgress, dir = "") {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    A.xhr = xhr;
    xhr.open("PUT", `/api/games/upload?system=${encodeURIComponent(system)}&name=${encodeURIComponent(name)}${dir ? `&dir=${encodeURIComponent(dir)}` : ""}${replace ? "&replace=1" : ""}`);
    xhr.setRequestHeader("X-Manager-Token", TOKEN);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status === 200) resolve(body); else reject(new Error(body.error || `Copy failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("The copy was interrupted."));
    xhr.onabort = () => reject(new Error("Stopped."));
    xhr.send(file);
  });
}

async function addAll() {
  const list = A.items.filter(ready);
  if (!list.length || busy()) return;
  A.adding = true; A.stop = false;
  list.forEach((it) => { it.state = "queued"; });
  render();
  for (const it of list) {
    if (A.stop) { it.state = "new"; continue; }
    it.state = "uploading"; it.sent = 0; it.warnings = [];
    draw(it);
    try {
      let before = 0;
      const folder = `.${it.stem.trim()}`;
      const data = (it.data || []).map(({ file, rel }) => {
        const parts = rel.split("/");
        return [file, parts.pop(), [folder, ...parts].join("/")];
      });
      for (const [file, name, dir] of [...it.extra.map((f) => [f, f.name, ""]), ...data, [it.file, finalName(it), ""]]) {
        if (A.stop) throw new Error("Stopped.");
        await upload(file, it.code, name, it.replace, (n) => { it.sent = before + n; drawProgress(it); }, dir);
        before += file.size;
      }
      try {
        const png = await artData(it);
        if (png) await api("artwork/local/put", { system: it.code, stem: it.stem.trim(), data: png.data });
      } catch (error) { it.warnings.push(`Artwork not saved: ${error.message}`); }
      try {
        const text = descToSave(it);
        if (text) await api("games/description", { system: it.code, stem: it.stem.trim(), text });
      } catch (error) { it.warnings.push(`Description not saved: ${error.message}`); }
      it.state = "done";
    } catch (error) {
      it.state = A.stop ? "new" : "failed";
      it.error = error.message;
    }
    draw(it);
  }
  A.xhr = null;
  try { await api("games/rescan", {}); await loadLibrary(); } catch {}
  A.adding = false;
  const done = A.items.filter((it) => it.state === "done");
  if (done.length) A.finished = { done, failed: A.items.filter((it) => it.state === "failed") };
  render();
}

function reset() {
  for (const it of A.items) if (it.art.ownUrl) URL.revokeObjectURL(it.art.ownUrl);
  pending.length = 0;
  Object.assign(A, { items: [], sel: 0, finished: null, platOpen: false, platQ: "" });
}

// ---------------------------------------------------------------- drawing

function render() {
  const main = $("ag-main");
  if (!main) return;
  $("addgames").classList.toggle("has-items", !!A.items.length && !A.finished);
  if (A.finished) main.innerHTML = finishedView();
  else if (!A.items.length) main.innerHTML = emptyView();
  else {
    main.innerHTML = `<div class="ag-split"><div class="ag-list" id="ag-list"></div><section class="ag-detail" id="ag-detail"></section></div>`;
    lastList = "";
    renderList();
    renderDetail();
  }
  renderFoot();
}

/** Redraws what one item changes: its row, the footer, and the detail pane when it is the one shown. */
function draw(it) {
  if (A.finished || !A.items.length) return;
  renderList();
  if (it.id === A.sel) renderDetail();
  renderFoot();
}

function drawProgress(it) {
  const row = document.querySelector(`.ag-row[data-id="${it.id}"]`);
  if (row) {
    const pct = it.size ? Math.min(100, (it.sent / it.size) * 100) : 0;
    row.querySelector(".ag-row-bar i")?.style.setProperty("width", `${pct.toFixed(1)}%`);
    const s = row.querySelector(".ag-row-state");
    if (s) s.textContent = `${Math.floor(pct)}%`;
  }
  renderFoot();
}

function emptyView() {
  return `<div class="ag-empty ag-dropzone">
    <div class="ag-drop-art">${icon("upload")}</div>
    <h3>Drop game files here</h3>
    <p>ROMs, zipped games and disc images (a .cue with its .bin tracks, .chd, .iso), or a ScummVM game's folder. The platform is detected from each file, and you can change it.</p>
    <div class="ag-empty-btns"><button class="btn primary" data-ag="browse">${icon("file")}Choose files&hellip;</button>
      <button class="btn" data-ag="browse-folder">${icon("folder")}Choose a ScummVM game folder&hellip;</button>
      <button class="btn ghost" data-ag="free-scummvm">${icon("download")}Free ScummVM games&hellip;</button></div>
    <ol class="ag-how">
      <li><b>1</b><span>Add files</span></li>
      <li><b>2</b><span>Check the platform, description and artwork</span></li>
      <li><b>3</b><span>Copy them into Roms/</span></li>
    </ol>
  </div>`;
}

/** The list markup last drawn; redrawing identical markup would swallow a click that lands mid-redraw. */
let lastList = "";

function renderList() {
  const box = $("ag-list");
  if (!box) return;
  const rows = A.items.map((it) => {
    const [cls, text] = status(it);
    const sys = sysOf(it.code);
    const pct = it.size ? Math.min(100, (it.sent / it.size) * 100) : 0;
    const mark = cls === "busy" ? `<span class="spinner sm"></span>` : icon(cls === "ok" ? "check" : cls === "bad" ? "x" : "alert");
    return `<div class="ag-row st-${cls}${it.id === A.sel ? " on" : ""}${it.state === "uploading" ? " moving" : ""}" data-id="${it.id}" style="--accent:${sys?.accent || "var(--faint)"}">
      <button class="ag-row-main" data-ag="select" data-id="${it.id}">
        <span class="ag-ico">${it.code ? consoleIcon(it.code, "ag-svg") : icon("file")}</span>
        <span class="ag-row-text"><b title="${esc(finalName(it))}">${esc(finalName(it))}</b>
          <small>${it.code ? esc(it.code) : "No platform"} &middot; ${human(it.size)}${it.extra.length ? ` &middot; +${plural(it.extra.length, "track")}` : ""}${it.data ? ` &middot; ${plural(it.data.length, "file")}` : ""}</small></span>
        <span class="ag-row-state" title="${esc(text)}">${it.state === "uploading" ? `${Math.floor(pct)}%` : mark}</span>
      </button>
      ${A.adding || it.state === "done" ? "" : `<button class="ag-row-x" data-ag="remove" data-id="${it.id}" title="Remove from the list">${icon("x")}</button>`}
      ${it.state === "uploading" ? `<span class="ag-row-bar"><i style="width:${pct.toFixed(1)}%"></i></span>` : ""}
    </div>`;
  }).join("");
  const html = `<div class="ag-list-head"><b>${plural(A.items.length, "file")}</b><small>${human(A.items.reduce((n, it) => n + it.size, 0))}</small></div>
    <div class="ag-rows">${rows}</div>
    ${A.adding ? "" : `<button class="ag-more ag-dropzone" data-ag="browse">${icon("plus")}<span>Add more files<small>or drop them anywhere</small></span></button>`}`;
  if (html === lastList) return;
  lastList = html;
  box.innerHTML = html;
}

/** Redraws the detail pane, keeping the caret and scroll where they were. */
function renderDetail() {
  const box = $("ag-detail"), it = selected();
  if (!box) return;
  const active = document.activeElement, focusId = box.contains(active) ? active.id : "";
  const caret = focusId && "selectionStart" in active ? [active.selectionStart, active.selectionEnd] : null;
  const top = box.scrollTop;
  box.innerHTML = it ? detailView(it) : `<div class="ag-pick-one">Choose a file on the left.</div>`;
  box.scrollTop = top;
  if (focusId) {
    const el = $(focusId);
    if (el) { el.focus({ preventScroll: true }); if (caret) try { el.setSelectionRange(...caret); } catch {} }
  }
}

const section = (n, title, state, aside, body) => `<section class="ag-sec">
  <header class="ag-sec-head"><span class="ag-num ${state}">${state === "done" ? icon("check") : n}</span><h3>${title}</h3>${aside}</header>
  ${body}</section>`;

const seg = (name, value, options) => `<div class="segmented ag-seg">${options.map(([v, label]) =>
  `<button type="button" class="${value === v ? "on" : ""}" data-ag="${name}" data-v="${v}" ${A.adding ? "disabled" : ""}>${label}</button>`).join("")}</div>`;

function detailView(it) {
  const locked = A.adding || it.state !== "new";
  return `<div class="ag-detail-in${locked ? " locked" : ""}">
    ${gameSection(it)}
    ${descSection(it)}
    ${artSection(it)}
  </div>`;
}

function gameSection(it) {
  const sys = sysOf(it.code), det = it.det;
  const top = det?.candidates?.[0];
  let why = "";
  if (!det) why = `<div class="ag-why busy"><span class="spinner sm"></span>Working out the platform&hellip;</div>`;
  else if (it.how === "user") why = `<div class="ag-why">${icon("check")}You chose ${esc(sysName(it.code))}.</div>`;
  else if (it.code && det.confidence === "sure") why = `<div class="ag-why ok">${icon("check")}Detected: ${esc(top.why[0])}.</div>`;
  else if (it.code) why = `<div class="ag-why warn">${icon("info")}Probably ${esc(sysName(it.code))}: ${esc(top.why[0])}. Check it's right.</div>`;
  else why = `<div class="ag-why bad">${icon("alert")}${det.error ? esc(det.error) : det.candidates.length ? "Several systems use this kind of file. Choose the right one." : "Couldn't tell which system this file is for. Choose one."}</div>`;
  const others = (det?.candidates || []).filter((c) => c.code !== it.code);
  const chips = others.length ? `<div class="ag-cands"><small>${it.code ? "Other matches" : "Possible"}</small>${others.map((c) =>
    `<button class="ag-cand" data-ag="plat-set" data-code="${esc(c.code)}" title="${esc(c.why.join("; "))}" style="--accent:${sysOf(c.code)?.accent || "var(--faint)"}">${consoleIcon(c.code, "ag-svg")}<span>${esc(sysName(c.code))}</span></button>`).join("")}</div>` : "";
  const missing = A.items.filter((x) => sameKind(x, it)).length;
  const bulk = it.code && missing ? `<button class="link-btn ag-bulk" data-ag="plat-all">Use ${esc(sysName(it.code))} for the ${plural(missing, `other .${it.ext} file`)} without a platform</button>` : "";
  const dup = it.code && exists(it);
  const lower = finalName(it).toLowerCase();
  const elsewhere = (app.data?.systems || []).filter((x) => x.code !== it.code && x.games.some((g) => g.f.toLowerCase() === lower)).map((x) => x.code);
  const nameOk = validStem(it.stem);
  return section(1, "Game", it.code && nameOk && (!dup || it.replace) ? "done" : "", `<span class="ag-aside">${human(it.size)}</span>`, `
    <div class="ag-grid2">
      <div class="ag-field">
        <label for="ag-stem">File name</label>
        <div class="ag-name${nameOk ? "" : " bad"}"><input id="ag-stem" value="${esc(it.stem)}" spellcheck="false" autocomplete="off" ${A.adding ? "disabled" : ""}><span>.${esc(it.ext)}</span></div>
        <small class="${nameOk ? "" : "bad-text"}">${nameOk ? "muOS shows the file name as the game's title." : 'Names can\'t be empty, start with a dot, or use \\ / : * ? " < > |.'}</small>
      </div>
      <div class="ag-field">
        <label>Platform</label>
        <div class="ag-plat${A.platOpen ? " open" : ""}">
          <button class="ag-plat-cur${it.code ? "" : " empty"}" data-ag="plat" style="--accent:${sys?.accent || "var(--faint)"}" ${A.adding ? "disabled" : ""}>
            <span class="ag-ico">${it.code ? consoleIcon(it.code, "ag-svg") : icon("search")}</span>
            <span class="ag-plat-text"><b>${it.code ? esc(sysName(it.code)) : "Choose a platform"}</b><small>${it.code ? `Roms/${esc(it.code)}` : "Required"}</small></span>
            ${icon("down", "ag-chev")}
          </button>
          ${A.platOpen ? platMenu(it) : ""}
        </div>
      </div>
    </div>
    ${why}${chips}${bulk}
    <div class="ag-path">${icon("folder")}<code>Roms/<b>${esc(it.code || "?")}</b>/${esc(finalName(it))}</code>${it.extra.length ? `<small>+ ${it.extra.map((f) => esc(f.name)).join(", ")}</small>` : ""}${it.data ? `<small>+ the game files in Roms/${esc(it.code || "?")}/.${esc(it.stem.trim())}/ (${plural(it.data.length, "file")})</small>` : ""}</div>
    ${it.data ? `<div class="ag-muted">${icon("info")}ScummVM works out which game this is the first time it starts on the handheld.</div>` : ""}
    ${elsewhere.length ? `<div class="ag-muted">${icon("info")}Your library already has a file with this name in ${elsewhere.map(esc).join(", ")}.</div>` : ""}
    ${dup ? `<div class="notice warn ag-dup">${icon("alert")}<div>Roms/${esc(it.code)} already has <b>${esc(finalName(it))}</b>. Rename this one, or
      <label class="check-row"><input type="checkbox" data-ag="replace" ${it.replace ? "checked" : ""}> replace it (the old file goes to the Trash)</label></div></div>` : ""}`);
}

function platMenu(it) {
  return `<div class="ag-plat-menu">
    <label class="ag-plat-search">${icon("search")}<input id="ag-plat-q" placeholder="Search systems" value="${esc(A.platQ)}" autocomplete="off" spellcheck="false"></label>
    <div class="ag-plat-list" id="ag-plat-list">${platList(it)}</div>
  </div>`;
}

function platList(it) {
  const q = A.platQ.trim().toLowerCase();
  const systems = (app.data?.systems || []).filter((s) => !EXCLUDED.has(s.code) && (!q || `${s.name} ${s.code} ${s.maker} ${s.cat}`.toLowerCase().includes(q)));
  const cats = app.data?.categories || [];
  const groups = cats.map((c) => [c, systems.filter((s) => s.cat === c)]).filter(([, list]) => list.length);
  if (!groups.length) return `<div class="ag-plat-none">No system matches &ldquo;${esc(A.platQ)}&rdquo;.</div>`;
  return groups.map(([cat, list]) => `<div class="ag-plat-group"><small>${esc(cat)}</small>${list.map((s) =>
    `<button class="ag-plat-opt${s.code === it.code ? " on" : ""}" data-ag="plat-set" data-code="${esc(s.code)}" style="--accent:${s.accent}">
      ${consoleIcon(s.code, "ag-svg")}<span><b>${esc(s.name)}</b><small>${esc(s.code)}</small></span></button>`).join("")}</div>`).join("");
}

function descSection(it) {
  const d = it.desc;
  let body = "";
  if (!it.code) body = `<p class="ag-muted">Choose the platform first; descriptions come from the LaunchBox Games Database for that system.</p>`;
  else if (d.mode === "db") {
    const results = d.results;
    let list = "";
    if (d.status === "busy") list = `<div class="ag-wait"><span class="spinner sm"></span>Searching LaunchBox&hellip;</div>`;
    else if (d.status === "error") list = `<div class="ag-muted ag-err">${icon("info")}${esc(d.error)}</div>`;
    else if (results && !results.length) list = `<div class="ag-muted">No matches. Try another name, or write your own.</div>`;
    else if (results) list = `<div class="ag-results">${results.map((r) => `<button class="ag-res${r.id === d.pick ? " on" : ""}" data-ag="desc-pick" data-id="${esc(r.id)}" ${A.adding ? "disabled" : ""}>
        <span class="ag-radio"></span><span class="ag-res-text"><b>${esc(r.name)}</b><small>${esc([r.year, r.pub || r.dev, r.genre].filter(Boolean).join(" \u00b7 ") || "No details")}</small></span>
        ${r.exact ? `<span class="pill ok">Same name</span>` : ""}${r.d ? "" : `<span class="pill">No text</span>`}</button>`).join("")}</div>`;
    const picked = results?.find((r) => r.id === d.pick);
    const rename = picked && titleKey(picked.name) !== titleKey(titleOf(it.stem))
      ? `<button class="link-btn ag-rename" data-ag="rename">${icon("refresh")}Rename the file to &ldquo;${esc(cleanName(picked.name))}${esc(tagsOf(it.stem))}&rdquo;</button>` : "";
    body = `<div class="field-row ag-search-row">
        <label class="ag-q">${icon("search")}<input id="ag-q" value="${esc(d.q)}" placeholder="Game name" autocomplete="off" spellcheck="false" ${A.adding ? "disabled" : ""}></label>
        <button class="btn" data-ag="desc-search" ${A.adding ? "disabled" : ""}>Search</button>
      </div>
      ${list}
      ${picked ? `<textarea class="control ag-text" id="ag-text" rows="6" ${A.adding ? "disabled" : ""}>${esc(d.text)}</textarea>
        <small class="ag-muted">From LaunchBox. Editing it turns it into your own description.</small>${rename}` : ""}`;
  } else if (d.mode === "own") {
    body = `<textarea class="control ag-text" id="ag-text" rows="7" placeholder="What is this game about? A sentence or two is plenty." ${A.adding ? "disabled" : ""}>${esc(d.text)}</textarea>
      <small class="ag-muted" id="ag-count">${d.text.trim().length.toLocaleString()} / 8,000 characters &middot; saved as Roms/${esc(it.code)}/Text/${esc(it.stem.trim())}.txt</small>`;
  } else {
    body = `<p class="ag-muted">No description. You can add one later the same way.</p>`;
  }
  const done = d.mode === "none" || !!d.text.trim();
  return section(2, "Description", it.code && done ? "done" : "", seg("desc-mode", d.mode, [["db", "LaunchBox"], ["own", "Write my own"], ["none", "None"]]), body);
}

function artSection(it) {
  const a = it.art;
  const [W, H] = scrapeLook().size;
  let frame = `<span class="ag-frame-empty">${icon("image")}<small>No artwork</small></span>`;
  if (a.mode === "own" && a.ownUrl) frame = `<img src="${a.ownUrl}" alt="">`;
  else if (a.mode === "find" && a.status === "busy") frame = `<span class="ag-frame-empty"><span class="spinner"></span><small>Looking on libretro&hellip;</small></span>`;
  else if (a.mode === "find" && a.url) frame = `<img src="${a.url}" alt="">`;
  let side = "";
  if (!it.code && a.mode === "find") side = `<p class="ag-muted">Choose the platform first; artwork is looked up on thumbnails.libretro.com for that system.</p>`;
  else if (a.mode === "find") {
    const p = a.picks;
    const tiles = p ? `<div class="ag-tiles">${KINDS.map(([k, label]) => `<div class="ag-tile${p[k] ? "" : " missing"}">
        ${p[k] ? `<img src="${imageUrl(p[k], k)}" alt="" loading="lazy">` : `<span>${icon("x")}</span>`}<small>${label}</small></div>`).join("")}</div>` : "";
    const close = p && KINDS.some(([k]) => p[k]?.close) ? `<small class="ag-muted">${icon("info")}Close match: &ldquo;${esc((p.box || p.snap || p.title).name)}&rdquo;</small>` : "";
    side = `${a.status === "error" ? `<div class="ag-muted ag-err">${icon("info")}${esc(a.error)}</div>` : ""}
      ${a.status === "none" ? `<div class="ag-muted">Nothing found for this name. Rename the file to its No-Intro name, or use your own image.</div>` : ""}
      ${tiles}${close}
      ${p && a.status === "done" ? `<div class="ag-styles">${STYLES.map(([v, label]) => `<button class="ag-style${a.style === v ? " on" : ""}" data-ag="art-style" data-v="${v}" ${A.adding ? "disabled" : ""}>${esc(label)}</button>`).join("")}</div>` : ""}
      <button class="link-btn" data-ag="art-find" ${A.adding || a.status === "busy" ? "disabled" : ""}>${icon("refresh")}Look again with the current name</button>`;
  } else if (a.mode === "own") {
    side = `<button class="ag-art-drop ag-dropzone-art" data-ag="art-pick" ${A.adding ? "disabled" : ""}>${icon("upload")}<span><b>${a.own ? "Choose another image" : "Drop an image here"}</b><small>${a.own ? `${esc(a.own.name)} &middot; ${human(a.own.size)}` : "or click to choose a PNG, JPEG or WebP"}</small></span></button>
      <small class="ag-muted">Saved as PNG${artMax.get() ? `, scaled down to ${artMax.get()} px` : ""} (Settings &gt; Uploaded artwork size).</small>`;
  } else {
    side = `<p class="ag-muted">No artwork. Artwork &gt; Scrape can find it later.</p>`;
  }
  const done = a.mode === "none" || (a.mode === "own" && a.own) || (a.mode === "find" && a.url);
  return section(3, "Artwork", it.code && done ? "done" : "", seg("art-mode", a.mode, [["find", "Find online"], ["own", "My image"], ["none", "None"]]), `
    <div class="ag-art">
      <div class="ag-frame ag-dropzone-art${a.mode === "own" ? " own" : ""}" style="aspect-ratio:${W} / ${H}">${frame}</div>
      <div class="ag-art-side">${side}</div>
    </div>`);
}

/** Another queued file of the same type that still needs a platform. */
const sameKind = (x, it) => x !== it && !x.code && x.det && x.state === "new" && x.ext === it.ext;
const tagsOf = (stem) => (/(\s*[([][^)\]]*[)\]])+\s*$/.exec(stem) || [""])[0];
const cleanName = (name) => name.replace(/:\s*/g, " - ").replace(/[\\/*?"<>|]/g, "").replace(/\s+/g, " ").trim();

function renderFoot() {
  const foot = $("ag-foot");
  if (!foot) return;
  if (A.finished) {
    foot.innerHTML = `<span class="ag-foot-sum"></span><button class="btn" data-ag="again">${icon("plus")}Add more games</button>
      <button class="btn primary" data-ag="show">${icon("arrow")}Show in the library</button>`;
    return;
  }
  if (A.adding) {
    const list = A.items.filter((it) => ["queued", "uploading", "done", "failed"].includes(it.state));
    const total = list.reduce((n, it) => n + it.size, 0);
    const sent = list.reduce((n, it) => n + (it.state === "done" || it.state === "failed" ? it.size : it.state === "uploading" ? it.sent : 0), 0);
    const pct = total ? (sent / total) * 100 : 0;
    const at = list.findIndex((it) => it.state === "uploading");
    foot.innerHTML = `<div class="ag-progress"><div class="ag-progress-top"><b>${at >= 0 ? `Copying ${at + 1} of ${list.length}` : "Finishing up"}</b><span>${human(sent)} of ${human(total)}</span></div>
      <div class="sn-bar"><i style="width:${pct.toFixed(1)}%"></i></div></div>
      <button class="btn danger" data-ag="stop" ${A.stop ? "disabled" : ""}>${icon("stop")}${A.stop ? "Stopping\u2026" : "Stop"}</button>`;
    return;
  }
  const counts = { ready: 0, platform: 0, dup: 0, other: 0 };
  for (const it of A.items) {
    if (it.state !== "new") continue;
    const [cls, text] = status(it);
    if (cls === "ok") counts.ready++;
    else if (text === "Choose a platform") counts.platform++;
    else if (text === "Already in the library") counts.dup++;
    else counts.other++;
  }
  const parts = [
    counts.ready ? `<span class="ok">${icon("check")}${counts.ready} ready</span>` : "",
    counts.platform ? `<span class="warn">${icon("alert")}${counts.platform} need${counts.platform === 1 ? "s" : ""} a platform</span>` : "",
    counts.dup ? `<span class="warn">${icon("alert")}${counts.dup} already in the library</span>` : "",
    counts.other ? `<span class="bad">${icon("x")}${counts.other} to fix</span>` : "",
  ].filter(Boolean).join("");
  const blocked = busy();
  foot.innerHTML = `<span class="ag-foot-sum">${A.items.length ? parts : `<span class="ag-muted">Files are copied into Roms/; the originals stay where they are.</span>`}${blocked ? `<span class="warn">${icon("info")}Waiting for the transfer to finish</span>` : ""}</span>
    <button class="btn" data-ag="cancel">Cancel</button>
    <button class="btn primary" data-ag="add" ${counts.ready && !blocked ? "" : "disabled"}>${icon("plus")}${counts.ready > 1 ? `Add ${counts.ready} games` : "Add game"}</button>`;
}

function finishedView() {
  const { done, failed } = A.finished;
  const row = (it, bad) => `<li class="${bad ? "bad" : it.warnings.length ? "warn" : ""}" style="--accent:${sysOf(it.code)?.accent || "var(--faint)"}">
    <span class="ag-ico">${consoleIcon(it.code, "ag-svg")}</span>
    <span><b>${esc(finalName(it))}</b><small>${bad ? esc(it.error) : it.warnings.length ? esc(it.warnings.join(" ")) : `Roms/${esc(it.code)}/${esc(finalName(it))}${it.art.mode !== "none" && (it.art.own || it.art.canvas) ? " \u00b7 artwork" : ""}${descToSave(it) || it.desc.pick ? " \u00b7 description" : ""}`}</small></span>
    ${icon(bad ? "x" : it.warnings.length ? "alert" : "check", "ag-done-mark")}</li>`;
  return `<div class="ag-finished">
    <div class="ag-finished-head"><span class="ag-big-check">${icon("check")}</span>
      <div><h3>${plural(done.length, "game")} added to Roms/</h3><p>${failed.length ? `${plural(failed.length, "file")} could not be copied.` : "They're in the library now. Transfer them to the handheld from Games."}</p></div></div>
    <ul class="ag-done-list">${done.map((it) => row(it, false)).join("")}${failed.map((it) => row(it, true)).join("")}</ul>
  </div>`;
}

// ---------------------------------------------------------------- events

export function openAddGames() {
  const dialog = $("addgames");
  if (!dialog.open) dialog.showModal();
  render();
}

async function close() {
  if (A.adding) { toast("Stop the copy first, or wait for it to finish"); return; }
  const left = A.items.filter((it) => it.state === "new").length;
  if (left && !A.finished) {
    const ok = await confirmBox({ title: "Discard the list?", html: `<p>${plural(left, "file")} ${left === 1 ? "hasn't" : "haven't"} been added yet.</p>`, ok: "Discard", danger: true });
    if (!ok) return;
  }
  reset();
  $("addgames").close();
}

function browse() {
  const input = $("ag-files");
  input.value = "";
  input.click();
}

async function setOwnArt(it, file) {
  if (!file || !file.type.startsWith("image/")) { toast("That isn't an image"); return; }
  if (it.art.ownUrl) URL.revokeObjectURL(it.art.ownUrl);
  it.art.own = file;
  it.art.ownUrl = URL.createObjectURL(file);
  it.art.mode = "own";
  draw(it);
}

async function act(el) {
  const what = el.dataset.ag, it = selected();
  if (what === "browse") return browse();
  if (what === "free-scummvm") { openFreeScummvm(); return; }
  if (what === "browse-folder") { const input = $("ag-folder"); input.value = ""; input.click(); return; }
  if (what === "cancel") return close();
  if (what === "add") return addAll();
  if (what === "stop") { A.stop = true; A.xhr?.abort(); renderFoot(); return; }
  if (what === "again") { reset(); render(); return; }
  if (what === "show") {
    const code = A.finished?.done[0]?.code;
    reset();
    $("addgames").close();
    if (code) setTimeout(() => scrollToSystem(code), 60);
    return;
  }
  if (what === "select") { A.sel = +el.dataset.id; A.platOpen = false; renderList(); renderDetail(); return; }
  if (what === "remove") {
    const id = +el.dataset.id, idx = A.items.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const [gone] = A.items.splice(idx, 1);
    if (gone.art.ownUrl) URL.revokeObjectURL(gone.art.ownUrl);
    if (A.sel === id) A.sel = A.items[Math.min(idx, A.items.length - 1)]?.id || 0;
    render();
    return;
  }
  if (!it || A.adding) return;
  if (what === "plat") {
    A.platOpen = !A.platOpen; A.platQ = "";
    renderDetail();
    if (A.platOpen) $("ag-plat-q")?.focus();
    return;
  }
  if (what === "plat-set") { A.platOpen = false; setPlatform(it, el.dataset.code); draw(it); return; }
  if (what === "plat-all") {
    for (const x of A.items) if (sameKind(x, it)) setPlatform(x, it.code);
    render();
    return;
  }
  if (what === "replace") { it.replace = el.checked; draw(it); return; }
  if (what === "desc-mode") {
    const mode = el.dataset.v;
    if (mode === "own" && it.desc.mode === "db" && !it.desc.text) it.desc.text = "";
    if (mode === "db" && !it.desc.results && it.code) { it.desc.mode = mode; searchDesc(it); return; }
    if (mode === "db" && it.desc.pick) it.desc.text = it.desc.results?.find((r) => r.id === it.desc.pick)?.d || "";
    it.desc.mode = mode;
    draw(it);
    if (mode === "own") $("ag-text")?.focus();
    return;
  }
  if (what === "desc-search") { searchDesc(it); return; }
  if (what === "desc-pick") { choose(it, el.dataset.id); draw(it); return; }
  if (what === "rename") {
    const r = it.desc.results?.find((x) => x.id === it.desc.pick);
    if (r) { it.stem = cleanName(r.name) + tagsOf(it.stem); draw(it); }
    return;
  }
  if (what === "art-mode") {
    it.art.mode = el.dataset.v;
    if (it.art.mode === "find" && !it.art.picks && it.code && it.art.status !== "busy") { findArt(it); return; }
    if (it.art.mode === "own" && !it.art.own) {
      draw(it);
      const file = await pickImage();
      if (file) setOwnArt(it, file);
      return;
    }
    draw(it);
    return;
  }
  if (what === "art-find") { findArt(it); return; }
  if (what === "art-style") {
    it.art.style = el.dataset.v;
    try {
      await renderPreview(it);
    } catch (error) {
      it.art.status = "error";
      it.art.error = error.message;
    }
    draw(it);
    return;
  }
  if (what === "art-pick") { const file = await pickImage(); if (file) setOwnArt(it, file); }
}

const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");

export function bindAddGames() {
  const dialog = $("addgames");
  document.addEventListener("click", (e) => {
    if (e.target.closest("#add-games")) openAddGames();
    else if (e.target.closest("#open-ports")) openPortMaster();
  });
  dialog.addEventListener("click", (e) => {
    const el = e.target.closest("[data-ag]");
    if (el && !el.disabled && el.type !== "checkbox") { act(el); return; }
    if (A.platOpen && !e.target.closest(".ag-plat")) { A.platOpen = false; renderDetail(); }
  });
  dialog.addEventListener("change", (e) => {
    if (e.target.dataset.ag === "replace") act(e.target);
  });
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    if (A.platOpen) { A.platOpen = false; renderDetail(); return; }
    close();
  });
  $("ag-close").addEventListener("click", close);
  $("ag-files").addEventListener("change", (e) => addFiles(e.target.files));
  $("ag-folder").addEventListener("change", (e) => addFolders(pickedFolders(e.target.files)));
  dialog.addEventListener("input", (e) => {
    const it = selected(), id = e.target.id;
    if (!it) return;
    if (id === "ag-stem") { it.stem = e.target.value; renderList(); renderFoot(); renderGamePartsLater(it); }
    else if (id === "ag-q") it.desc.q = e.target.value;
    else if (id === "ag-text") {
      it.desc.text = e.target.value;
      if (it.desc.mode === "db") { it.desc.mode = "own"; it.desc.pick = ""; renderDetail(); }
      const count = $("ag-count");
      if (count) count.firstChild.textContent = `${it.desc.text.trim().length.toLocaleString()} / 8,000 characters \u00b7 saved as Roms/${it.code}/Text/${it.stem.trim()}.txt`;
      renderList();
    } else if (id === "ag-plat-q") { A.platQ = e.target.value; $("ag-plat-list").innerHTML = platList(it); }
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "ag-q") { e.preventDefault(); act({ dataset: { ag: "desc-search" } }); }
    if (e.key === "Enter" && e.target.id === "ag-plat-q") {
      const first = $("ag-plat-list")?.querySelector("[data-code]");
      if (first) { e.preventDefault(); act(first); }
    }
  });
  dialog.addEventListener("dragenter", (e) => { if (hasFiles(e)) { A.dragging++; dialog.classList.add("dragging"); } });
  dialog.addEventListener("dragleave", () => { if (--A.dragging <= 0) { A.dragging = 0; dialog.classList.remove("dragging"); } });
  dialog.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const art = e.target.closest(".ag-dropzone-art");
    dialog.querySelectorAll(".ag-dropzone-art.hot").forEach((x) => x !== art && x.classList.remove("hot"));
    art?.classList.add("hot");
    dialog.classList.toggle("drag-art", !!art);
  });
  dialog.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    A.dragging = 0;
    dialog.classList.remove("dragging", "drag-art");
    dialog.querySelectorAll(".ag-dropzone-art.hot").forEach((x) => x.classList.remove("hot"));
    const files = [...e.dataTransfer.files];
    const it = selected();
    if (e.target.closest(".ag-dropzone-art") && it && !A.adding) {
      const image = files.find((f) => f.type.startsWith("image/"));
      if (image) { setOwnArt(it, image); return; }
    }
    const entries = [...e.dataTransfer.items].map((x) => x.webkitGetAsEntry?.()).filter(Boolean);
    const dirs = entries.filter((x) => x.isDirectory);
    if (dirs.length) {
      const plain = new Set(entries.filter((x) => x.isFile).map((x) => x.name));
      Promise.all(dirs.map(async (d) => ({ name: d.name, files: (await readFolder(d)).map((f) => ({ ...f, rel: f.rel.slice(d.name.length + 1) })) })))
        .then(addFolders, (error) => toast(`Could not read the folder: ${error.message}`, 3200));
      const rest = files.filter((f) => plain.has(f.name) && (f.size > 0 || f.type));
      if (rest.length) addFiles(rest);
      return;
    }
    if (!files.length) return;
    addFiles(files.filter((f) => f.size > 0 || f.type));
  });
}

/** Typing a name redraws the path, duplicate and step marks a moment later, without stealing the caret. */
let nameTimer = 0;
function renderGamePartsLater(it) {
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => { if (selected() === it) renderDetail(); }, 250);
}

export const addingGames = () => A.adding;
