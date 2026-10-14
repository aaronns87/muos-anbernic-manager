// Artwork > Scrape: finds box art, screenshots and title screens on thumbnails.libretro.com, previews the image
// each game would get, and saves the chosen ones as PNG in Roms/<SYS>/Imgs. Sending them to the device is the Sync tab.

import { $, app, api, esc, store, plural, initial, busy, toast, TOKEN, icon } from "./core.js";
import { loadLibrary } from "./games.js";
import { pngData, confirmBox } from "./art-images.js";
import { invalidateLocal } from "./art-local.js";

export const STYLES = [
  ["mix", "Box + screenshot", "Like Scrappy: the screenshot with the box in front"],
  ["mixtitle", "Box + title screen", "The title screen with the box in front"],
  ["box", "Box art", "Just the box (arcade: the flyer)"],
  ["snap", "Screenshot", "Just a gameplay screenshot"],
  ["title", "Title screen", "Just the title screen"],
];
const SIZES = [["282x216", "282 \u00d7 216 (like Scrappy)"], ["400x300", "400 \u00d7 300"], ["560x420", "560 \u00d7 420"]];
const PAGE = 60;
const WORKERS = 4;

const state = {
  system: store.get("scrape.system", ""), only: store.get("scrape.only", "missing"),
  style: store.get("scrape.style", "mix"), size: store.get("scrape.size", "282x216"),
  status: "idle", error: "", plan: null, filter: "found", shown: PAGE, skip: new Set(),
  task: null, saved: 0,
};
let redraw = () => {};

export const scrapeWorking = () => !!state.task;
/** The style and size Artwork > Scrape uses, so added games match the rest. */
export const scrapeLook = () => ({ style: state.style, size: dims() });

const keyOf = (item) => `${item.code}/${item.stem}`;
const sysName = (code) => app.data?.systems.find((s) => s.code === code)?.name || code;
const dims = () => state.size.split("x").map(Number);
const blocked = () => busy() || !!state.task || state.status === "loading";
const dis = () => (blocked() ? " disabled" : "");
const panel = (cls, title, body, actions = "") =>
  `<section class="panel ${cls}"><h2>${title}</h2>${body}${actions ? `<div class="panel-actions">${actions}</div>` : ""}</section>`;

// ---------------------------------------------------------------- composing

export const imageUrl = (pick, kind) =>
  `/api/scrape/image?set=${encodeURIComponent(pick.set)}&kind=${kind}&name=${encodeURIComponent(pick.name)}&token=${encodeURIComponent(TOKEN)}`;

async function bitmap(pick, kind) {
  if (!pick) return null;
  const res = await fetch(imageUrl(pick, kind));
  if (!res.ok) return null;
  try { return await createImageBitmap(await res.blob()); } catch { return null; }
}

/** Which source images a style uses, with fallbacks: [background, box] for mixes, [single] otherwise. */
function sources(item, style) {
  const first = (...kinds) => kinds.find((k) => item[k]) || null;
  if (style === "mix" || style === "mixtitle") {
    const bg = style === "mix" ? first("snap", "title") : first("title", "snap");
    return { bg, box: item.box ? "box" : null };
  }
  const order = { box: ["box", "snap", "title"], snap: ["snap", "title", "box"], title: ["title", "snap", "box"] }[style];
  return { bg: first(...order), box: null };
}

const usable = (item, style = state.style) => { const s = sources(item, style); return !!(s.bg || s.box); };
/** The style's main image is missing, so a fallback is used. */
function fallback(item, style = state.style) {
  const s = sources(item, style);
  if (style === "mix") return !item.box || !item.snap;
  if (style === "mixtitle") return !item.box || !item.title;
  return s.bg !== style;
}

function contain(w, h, maxW, maxH) {
  const k = Math.min(maxW / w, maxH / h);
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** The final image for one game as a canvas, or null when nothing was found. */
export async function compose(item, style = state.style, size = dims()) {
  const [W, H] = size;
  const s = sources(item, style);
  const [bg, box] = await Promise.all([bitmap(item[s.bg], s.bg), bitmap(item[s.box], s.box)]);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  const single = bg && box ? null : bg || box;
  if (single) {
    [canvas.width, canvas.height] = contain(single.width, single.height, W, H);
    ctx.drawImage(single, 0, 0, canvas.width, canvas.height);
  } else if (bg && box) {
    canvas.width = W; canvas.height = H;
    const [bw, bh] = contain(bg.width, bg.height, W * 0.82, H * 0.84);
    const bx = W - bw, by = 0;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = Math.round(W / 60);
    ctx.drawImage(bg, bx, by, bw, bh);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = Math.max(1, W / 200);
    ctx.strokeRect(bx + ctx.lineWidth / 2, by + ctx.lineWidth / 2, bw - ctx.lineWidth, bh - ctx.lineWidth);
    const [cw, ch] = contain(box.width, box.height, W * 0.46, H * 0.95);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = Math.round(W / 40); ctx.shadowOffsetX = Math.round(W / 140);
    ctx.drawImage(box, 0, H - ch, cw, ch);
    ctx.restore();
  } else {
    return null;
  }
  bg?.close(); box?.close();
  return canvas;
}

async function save(item) {
  const canvas = await compose(item);
  if (!canvas) throw new Error(`No artwork found for ${item.name}`);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const png = await pngData(blob, 0);
  await api("artwork/local/put", { system: item.code, stem: item.stem, data: png.data, bulk: true });
}

// ---------------------------------------------------------------- panels

/** A tiny drawing of each style: background and box positions. */
const STYLE_ART = {
  mix: `<i class="bg"></i><i class="bx"></i>`, mixtitle: `<i class="bg t"></i><i class="bx"></i>`,
  box: `<i class="bx solo"></i>`, snap: `<i class="bg solo"></i>`, title: `<i class="bg t solo"></i>`,
};

function optionsPanel() {
  const systems = (app.data?.systems || []).filter((s) => s.games.length);
  const missing = (code) => systems.filter((s) => !code || s.code === code).reduce((n, s) => n + s.games.filter((g) => !g.i).length, 0);
  const games = (code) => systems.filter((s) => !code || s.code === code).reduce((n, s) => n + s.games.length, 0);
  return `<section class="panel sc-options"><h2>${icon("scrape")}Scrape artwork</h2>
    <label class="field">System<select class="control" data-combo data-sc="system">
        <option value="">All systems (${games("").toLocaleString()} games)</option>
        ${systems.map((s) => `<option value="${esc(s.code)}"${s.code === state.system ? " selected" : ""}>${esc(s.name)} (${s.games.length.toLocaleString()})</option>`).join("")}
      </select></label>
    <div class="field">Games<span class="segmented wide" data-sc-group="only">
        <button data-sc-only="missing" class="${state.only === "missing" ? "on" : ""}">Missing <small>${missing(state.system).toLocaleString()}</small></button>
        <button data-sc-only="all" class="${state.only === "all" ? "on" : ""}">All <small>${games(state.system).toLocaleString()}</small></button>
      </span></div>
    <div class="field">Style<div class="sc-styles">${STYLES.map(([v, label, tip]) => `<button class="sc-style${v === state.style ? " on" : ""}" data-sc-style="${v}" title="${esc(tip)}">
        <span class="sc-style-art">${STYLE_ART[v]}</span><span>${esc(label)}</span></button>`).join("")}</div></div>
    <label class="field">Size<select class="control" data-sc="size">${SIZES.map(([v, l]) => `<option value="${v}"${v === state.size ? " selected" : ""}>${l}</option>`).join("")}</select></label>
    <button class="btn primary wide" data-sc-act="find"${dis()}>${state.status === "loading" ? `<span class="spinner sm"></span><span>Looking&hellip;</span>` : `${icon("search")}<span>Find artwork</span>`}</button>
    <div class="muted-note">From the <a href="https://thumbnails.libretro.com" target="_blank" rel="noopener">libretro thumbnail project</a> (free, no account; names match No-Intro and MAME).
      Saved as PNG in Roms/&lt;system&gt;/Imgs, replacing what is there (the old image goes to the Trash). Arcade games use the flyer as their box.
      Send them to the handheld from the Sync tab.</div>
  </section>`;
}

/** From elsewhere (e.g. Coverage by system): scrape one system's missing artwork. */
export function scrapeSystem(code) {
  if (state.task) return;
  state.system = code;
  state.only = "missing";
  store.set("scrape.system", code);
  store.set("scrape.only", "missing");
  state.plan = null;
  state.status = "idle";
}

function shownItems() {
  const p = state.plan;
  if (!p) return [];
  return state.filter === "none" ? p.items.filter((i) => !usable(i)) : p.items.filter((i) => usable(i));
}

function card(item) {
  const key = keyOf(item), ok = usable(item), on = ok && !state.skip.has(key);
  const pick = item.box || item.snap || item.title;
  const badge = !ok ? `<span class="badge bad">Not found</span>`
    : pick.close ? `<span class="badge warn" title="Closest name on the server: ${esc(pick.name)}">Close match</span>`
    : `<span class="badge ok-badge">Exact name</span>`;
  const fb = ok && fallback(item) ? `<span class="badge" title="The style's first choice is missing, so another image stands in">Fallback</span>` : "";
  return `<div class="sc-card${on ? " selected" : ""}${ok ? "" : " none"}" data-sc-key="${esc(key)}">
    ${ok ? `<label class="ag-check" title="Save this one"><input type="checkbox" data-sc-pick="${esc(key)}"${on ? " checked" : ""}${state.task ? " disabled" : ""}></label>` : ""}
    <div class="sc-img" data-sc-preview="${esc(key)}">${ok ? `<span class="spinner"></span>` : `<span class="ph">${esc(initial(item.name))}</span>`}</div>
    <div class="sc-foot">
    <div class="ag-info"><b title="${esc(item.file)}">${esc(item.name)}</b>
      <small><span class="code">${esc(item.code)}</span> ${esc(item.file)}</small>
      <div class="ag-badges">${badge}${fb}</div>
      ${ok && pick.close ? `<small class="sc-src" title="${esc(pick.name)}">&rarr; ${esc(pick.name)}</small>` : ""}
    </div>
    ${item.has && item.image ? `<div class="sc-now" title="Current artwork, replaced when saved"><img loading="lazy" src="${esc(item.image)}" alt=""><span>Now</span></div>` : ""}
    </div>
  </div>`;
}

function resultsPanel() {
  const p = state.plan;
  if (state.status === "error") return panel("sc-results", "Results", `<div class="notice err">${esc(state.error)}</div>`);
  if (!p) return "";
  const found = p.items.filter((i) => usable(i));
  const picked = found.filter((i) => !state.skip.has(keyOf(i)));
  const exact = found.filter((i) => !(i.box || i.snap || i.title).close).length;
  const none = p.items.length - found.length;
  const shown = shownItems();
  const t = state.task;
  const unsupported = p.unsupported.length
    ? `<div class="muted-note">No libretro thumbnails for ${p.unsupported.map((u) => `${esc(sysName(u.code))} (${u.games})`).join(", ")}. Add those images by hand in the Roms/ library tab.</div>` : "";
  const progress = t ? `<div class="sc-progress"><div class="meter"><i style="width:${Math.round((t.done / t.total) * 100)}%"></i></div>
      <span><span class="spinner"></span> Saving ${t.done.toLocaleString()} of ${t.total.toLocaleString()}${t.failed ? ` (${t.failed} failed)` : ""}</span>
      <button class="btn small" data-sc-act="stop">${icon("stop")}<span>Stop</span></button></div>` : "";
  const done = !t && state.saved ? `<div class="notice ok sc-done"><span>Saved ${plural(state.saved, "image")} to Roms/. Send them to the handheld when you need them.</span>
      <button class="btn small primary" data-art="send">${icon("upload")}<span>Send to the device</span></button></div>` : "";
  return panel("sc-results", `Results <span class="grow"></span><span class="sc-count">${p.items.length.toLocaleString()} games checked</span>`, `
    <div class="numbers">
      <div class="stat"><b>${found.length.toLocaleString()}</b><span>found</span></div>
      <div class="stat"><b>${exact.toLocaleString()}</b><span>exact name</span></div>
      <div class="stat"><b>${(found.length - exact).toLocaleString()}</b><span>close match</span></div>
      <div class="stat${none ? " warn" : ""}"><b>${none.toLocaleString()}</b><span>not found</span></div>
    </div>
    ${unsupported}${progress}${done}
    <div class="art-tools">
      <div class="segmented">
        <button data-sc-filter="found" class="${state.filter === "found" ? "on" : ""}">Found <small>${found.length.toLocaleString()}</small></button>
        <button data-sc-filter="none" class="${state.filter === "none" ? "on" : ""}">Not found <small>${none.toLocaleString()}</small></button>
      </div>
      ${state.filter === "found" && found.length ? `<button class="link-btn" data-sc-act="all"${state.task ? " disabled" : ""}>Select all</button>
        <button class="link-btn" data-sc-act="none"${state.task ? " disabled" : ""}>Select none</button>
        <button class="link-btn" data-sc-act="exact"${state.task ? " disabled" : ""} title="Uncheck close matches, keep exact names">Only exact names</button>` : ""}
    </div>
    <div class="sc-grid" id="sc-grid">${shown.slice(0, state.shown).map(card).join("") || `<div class="muted-note">${state.filter === "none" ? "Everything was found." : "Nothing found."}</div>`}</div>
    ${shown.length > state.shown ? `<button class="btn wide" data-sc-act="more">Show ${Math.min(PAGE, shown.length - state.shown)} more of ${(shown.length - state.shown).toLocaleString()}</button>` : ""}`,
    found.length ? `<button class="btn primary" data-sc-act="save"${picked.length && !blocked() ? "" : " disabled"}>${icon("download")}<span>Save ${plural(picked.length, "image")} to Roms/</span></button>
      <span class="muted-note">${esc(STYLES.find((s) => s[0] === state.style)[1])}, ${esc(state.size.replace("x", " \u00d7 "))} at most</span>` : "");
}

export function scrapePanels(bindRedraw) {
  redraw = bindRedraw;
  const results = resultsPanel() || `<section class="panel sc-results"><div class="empty-state">${icon("scrape")}<p><b>Pick the games and a style</b>, then press Find artwork.
    You get a preview of every image before anything is saved.</p></div></section>`;
  return `<div class="sc-layout">${optionsPanel()}${results}</div>`;
}

// ---------------------------------------------------------------- previews

let observer = null;
const previewQueue = [];
let previewing = 0;

function pumpPreviews() {
  while (previewing < 6 && previewQueue.length) {
    const el = previewQueue.shift();
    if (!el.isConnected || el.dataset.done) continue;
    const item = state.plan?.items.find((i) => keyOf(i) === el.dataset.scPreview);
    if (!item) continue;
    previewing++;
    el.dataset.done = "1";
    compose(item).then((canvas) => {
      el.innerHTML = "";
      if (canvas) el.appendChild(canvas); else el.innerHTML = `<span class="ph">?</span>`;
    }).catch(() => { el.innerHTML = `<span class="ph">!</span>`; })
      .finally(() => { previewing--; pumpPreviews(); });
  }
}

export function afterScrapeDraw() {
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      observer.unobserve(e.target);
      previewQueue.push(e.target);
    }
    pumpPreviews();
  }, { rootMargin: "300px" });
  document.querySelectorAll("[data-sc-preview]").forEach((el) => { if (!el.querySelector(".ph")) observer.observe(el); });
}

// ---------------------------------------------------------------- actions

async function find() {
  if (blocked()) return;
  state.status = "loading";
  state.saved = 0;
  const want = `${state.system}|${state.only}`;
  redraw();
  try {
    const plan = await api("scrape/plan", { systems: state.system ? [state.system] : [], only: state.only });
    if (want !== `${state.system}|${state.only}`) {
      state.status = "idle";
      return redraw();
    }
    state.plan = plan;
    state.status = "ready";
    state.skip = new Set();
    state.shown = PAGE;
    state.filter = state.plan.items.some((i) => usable(i)) ? "found" : "none";
  } catch (error) {
    state.status = want === `${state.system}|${state.only}` ? "error" : "idle";
    state.error = error.message;
  }
  redraw();
}

async function saveAll() {
  const p = state.plan;
  if (!p || blocked()) return;
  const todo = p.items.filter((i) => usable(i) && !state.skip.has(keyOf(i)));
  if (!todo.length) return;
  const replacing = todo.filter((i) => i.has).length;
  const ok = await confirmBox({
    title: "Save scraped artwork",
    html: `<p>Save <b>${plural(todo.length, "image")}</b> to Roms/&lt;system&gt;/Imgs as ${esc(STYLES.find((s) => s[0] === state.style)[1].toLowerCase())}, at most ${esc(state.size.replace("x", " \u00d7 "))}.</p>
      ${replacing ? `<p><b>${plural(replacing, "game")}</b> already ${replacing === 1 ? "has" : "have"} artwork; the old images go to the Trash.</p>` : ""}
      <p class="muted-note">Nothing is sent to the handheld yet.</p>`,
    ok: `Save ${todo.length.toLocaleString()}`,
  });
  if (!ok) return;
  const task = state.task = { done: 0, total: todo.length, failed: 0, stop: false, error: "" };
  state.saved = 0;
  redraw();
  let next = 0, lastDraw = 0;
  const worker = async () => {
    while (!task.stop && next < todo.length) {
      const item = todo[next++];
      try {
        await save(item);
        item.has = true;
        state.saved++;
      } catch (error) {
        task.failed++;
        task.error = error.message;
      }
      task.done++;
      if (Date.now() - lastDraw > 400) { lastDraw = Date.now(); updateProgress(); }
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  state.task = null;
  toast(`Saved ${plural(state.saved, "image")}${task.failed ? `, ${task.failed} failed (${task.error})` : ""}${task.stop ? ", stopped" : ""}`, task.failed ? 6000 : 3000);
  invalidateLocal();
  try {
    await api("games/rescan", {});
    await loadLibrary();
  } catch {}
  redraw();
}

function updateProgress() {
  const t = state.task, box = document.querySelector(".sc-progress");
  if (!t || !box) return redraw();
  box.querySelector(".meter i").style.width = `${Math.round((t.done / t.total) * 100)}%`;
  box.querySelector("span").innerHTML = `<span class="spinner"></span> Saving ${t.done.toLocaleString()} of ${t.total.toLocaleString()}${t.failed ? ` (${t.failed} failed)` : ""}`;
}

function setAll(on, test = () => true) {
  for (const i of state.plan.items) {
    if (!usable(i)) continue;
    if (on && test(i)) state.skip.delete(keyOf(i)); else state.skip.add(keyOf(i));
  }
  redraw();
}

/** active() tells whether the Scrape tab is showing. */
export function bindScrape(root, active) {
  root.addEventListener("click", (e) => {
    if (!active()) return;
    const st = e.target.closest("[data-sc-style]");
    if (st) { state.style = st.dataset.scStyle; store.set("scrape.style", state.style); return redraw(); }
    const only = e.target.closest("[data-sc-only]");
    if (only) { state.only = only.dataset.scOnly; store.set("scrape.only", state.only); return redraw(); }
    const f = e.target.closest("[data-sc-filter]");
    if (f) { state.filter = f.dataset.scFilter; state.shown = PAGE; return redraw(); }
    const el = e.target.closest("[data-sc-act]");
    if (!el || el.disabled) return;
    const act = el.dataset.scAct;
    if (act === "find") return find();
    if (act === "save") return saveAll();
    if (act === "stop") { if (state.task) state.task.stop = true; return; }
    if (act === "more") { state.shown += PAGE; return redraw(); }
    if (act === "all") return setAll(true);
    if (act === "none") return setAll(false);
    if (act === "exact") return setAll(true, (i) => !(i.box || i.snap || i.title).close);
  });
  root.addEventListener("change", (e) => {
    if (!active()) return;
    const pick = e.target.closest("[data-sc-pick]");
    if (pick) {
      if (pick.checked) state.skip.delete(pick.dataset.scPick); else state.skip.add(pick.dataset.scPick);
      pick.closest(".sc-card")?.classList.toggle("selected", pick.checked);
      const btn = document.querySelector("[data-sc-act='save']");
      const n = state.plan.items.filter((i) => usable(i) && !state.skip.has(keyOf(i))).length;
      if (btn) { btn.innerHTML = `${icon("download")}<span>Save ${plural(n, "image")} to Roms/</span>`; btn.disabled = !n || blocked(); }
      return;
    }
    const sel = e.target.closest("[data-sc]");
    if (!sel) return;
    const k = sel.dataset.sc;
    state[k] = sel.value;
    store.set(`scrape.${k}`, sel.value);
    if (k === "system") state.plan = null;
    redraw();
  });
}
