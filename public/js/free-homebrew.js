// Free and homebrew catalogues (freeware, public domain, open source): legal ROMs downloaded into Roms/<system>/.

import { $, api, esc, human, icon, ICONS, toast } from "./core.js";
import { loadLibrary } from "./games.js";

const F = { data: null, error: "", poll: 0, bound: false, catalogue: "all" };
const active = () => ["download", "unpack"].includes(F.data?.task?.phase);

export async function openFreeHomebrew() {
  if (!F.bound) bind();
  render();
  if (!$("hbfree").open) $("hbfree").showModal();
  await load();
}

async function load() {
  try {
    F.data = await api(`homebrew/free?catalogue=${encodeURIComponent(F.catalogue)}`);
    F.error = "";
  } catch (error) { F.error = error.message; }
  render();
  if (active()) watch();
}

function watch() {
  clearTimeout(F.poll);
  F.poll = setTimeout(async () => {
    const was = F.data?.task;
    await load();
    const t = F.data?.task;
    if (was && t && t.id === was.id && !active()) {
      toast(t.phase === "done" ? `${t.title} is in Roms/. Scrape its box art from Artwork if you like.` : `${t.title} did not download: ${t.error}`, 6000);
      if (t.phase === "done") loadLibrary().catch(() => {});
    }
  }, 1500);
}

function progress(t) {
  if (t.phase === "unpack") return `${ICONS.spin} Unpacking&hellip;`;
  const pct = t.total ? Math.min(100, Math.floor((t.done / t.total) * 100)) : 0;
  return `${ICONS.spin} ${human(t.done)} of ${human(t.total)} <span class="meter"><i style="width:${pct}%"></i></span>`;
}

function render() {
  const body = $("hbf-body");
  if ($("hbfree").open && !F.data && !F.error) body.innerHTML = `<div class="planning"><span class="spinner"></span> Loading&hellip;</div>`;
  if (F.error) body.innerHTML = `<div class="notice err">${esc(F.error)}</div>`;
  if (!F.data) return;
  const t = F.data.task;
  renderCatalogues();
  body.innerHTML = `<div class="svf-list">${F.data.games.map((g) => {
    const mine = t && t.id === g.id;
    const state = mine && active() ? `<span class="svf-prog">${progress(t)}</span>`
      : g.have ? `<span class="pill ok">${icon("check")} In Roms/${esc(g.system)}</span>`
      : `<button class="btn small primary" data-hbf="get" data-id="${esc(g.id)}"${active() ? " disabled" : ""}>${icon("download")}<span>Download</span></button>`;
    return `<article class="svf-row">
      <div class="svf-text"><b>${esc(g.title)}</b><small>${esc(g.year)} &middot; ${esc(g.maker)} &middot; Roms/${esc(g.system)} &middot; ${human(g.size)}${g.license ? ` &middot; ${esc(g.license)}` : ""}</small><p>${esc(g.about)}</p>
        ${mine && t.phase === "failed" ? `<p class="svf-err">${esc(t.error)}</p>` : ""}</div>
      <div class="svf-act">${state}</div>
    </article>`;
  }).join("")}</div>`;
  const cat = F.data.catalogues.find((c) => c.id === F.catalogue);
  $("hbf-note").innerHTML = esc([cat?.description, F.data.note || "Legal downloads only. Transfer games like any other ROM."].filter(Boolean).join(" "));
}

/** The switcher: All plus one tab per catalogue file. Hidden when there is only one catalogue. */
function renderCatalogues() {
  const list = F.data.catalogues || [];
  const bar = $("hbf-cats");
  bar.hidden = list.length < 2;
  const total = list.reduce((n, c) => n + c.count, 0);
  const tab = (id, title, count) => `<button type="button" class="${F.catalogue === id ? "on" : ""}" data-hbf="cat" data-cat="${esc(id)}" aria-pressed="${F.catalogue === id}">${esc(title)} <small>${count}</small></button>`;
  bar.innerHTML = tab("all", "All", total) + list.map((c) => tab(c.id, c.title, c.count)).join("");
}

function bind() {
  F.bound = true;
  $("hbfree").addEventListener("click", async (e) => {
    const el = e.target.closest("[data-hbf]");
    if (!el || el.disabled) return;
    if (el.dataset.hbf === "close") return $("hbfree").close();
    if (el.dataset.hbf === "cat") {
      F.catalogue = el.dataset.cat;
      F.data = null;
      render();
      return load();
    }
    try {
      F.data = await api("homebrew/free/install", { id: el.dataset.id, catalogue: F.catalogue });
      render();
      watch();
    } catch (error) { toast(error.message, 5000); }
  });
  $("hbf-close").addEventListener("click", () => $("hbfree").close());
}