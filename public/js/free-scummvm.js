// Free ScummVM games: the freeware games from scummvm.org, downloaded straight into Roms/SCUMMVM with their data folder.

import { $, api, esc, human, icon, ICONS, toast } from "./core.js";
import { loadLibrary } from "./games.js";

const F = { data: null, error: "", poll: 0, bound: false };
const active = () => ["download", "unpack"].includes(F.data?.task?.phase);

export async function openFreeScummvm() {
  if (!F.bound) bind();
  render();
  if (!$("svmfree").open) $("svmfree").showModal();
  await load();
}

async function load() {
  try {
    F.data = await api("scummvm/free");
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
      toast(t.phase === "done" ? `${t.title} is in Roms/SCUMMVM. Transfer it like any other game.` : `${t.title} did not download: ${t.error}`, 6000);
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
  const body = $("svf-body");
  if ($("svmfree").open && !F.data && !F.error) body.innerHTML = `<div class="planning"><span class="spinner"></span> Loading&hellip;</div>`;
  if (F.error) body.innerHTML = `<div class="notice err">${esc(F.error)}</div>`;
  if (!F.data) return;
  const t = F.data.task;
  body.innerHTML = `<div class="svf-list">${F.data.games.map((g) => {
    const mine = t && t.id === g.id;
    const state = mine && active() ? `<span class="svf-prog">${progress(t)}</span>`
      : g.have ? `<span class="pill ok">${icon("check")} In Roms/</span>`
      : `<button class="btn small primary" data-svf="get" data-id="${esc(g.id)}"${active() ? " disabled" : ""}>${icon("download")}<span>Download</span></button>`;
    return `<article class="svf-row">
      <div class="svf-text"><b>${esc(g.title)}</b><small>${esc(g.year)} &middot; ${esc(g.maker)} &middot; ${human(g.size)}</small><p>${esc(g.about)}</p>
        ${mine && t.phase === "failed" ? `<p class="svf-err">${esc(t.error)}</p>` : ""}</div>
      <div class="svf-act">${state}</div>
    </article>`;
  }).join("")}</div>`;
  $("svf-note").innerHTML = `Freeware releases from <a href="${esc(F.data.source)}" target="_blank" rel="noopener">scummvm.org</a>. Each lands in Roms/SCUMMVM as an empty .scummvm file with its data folder; the handheld's ScummVM detects the game on first start.`;
}

function bind() {
  F.bound = true;
  $("svmfree").addEventListener("click", async (e) => {
    const el = e.target.closest("[data-svf]");
    if (!el || el.disabled) return;
    if (el.dataset.svf === "close") return $("svmfree").close();
    try {
      F.data = await api("scummvm/free/install", { id: el.dataset.id });
      render();
      watch();
    } catch (error) { toast(error.message, 5000); }
  });
  $("svf-close").addEventListener("click", () => $("svmfree").close());
}
