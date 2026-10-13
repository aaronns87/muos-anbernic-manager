// Systems tab: every system the games library knows, whether MustardOS on the handheld can run it, and why not.

import { $, api, esc, icon, model, plural } from "./core.js";
import { noteKind, systemNote, useSystem } from "./system-notes.js";

const Y = { data: null, error: "", loading: false, used: true, wifi: undefined };

const CATEGORY_ORDER = ["Arcade", "Nintendo", "Sega", "Sony", "SNK", "NEC", "Atari", "Bandai", "Computers", "Engines & Ports", "Other"];

export function showSystems() {
  load();
  render();
}

export function renderSystems(wifi) {
  if (Y.wifi !== undefined && wifi !== Y.wifi && !Y.loading) load();
  Y.wifi = wifi;
  render();
}

async function load() {
  Y.loading = true;
  render();
  try {
    Y.data = await api("cores");
    Y.error = "";
  } catch (error) {
    Y.error = error.message;
  }
  Y.loading = false;
  render();
}

/** Where a library system stands on the handheld: ready, pick (runs under another system), extra, none or missing. */
function status(entry) {
  const d = Y.data;
  if (!d.reachable) return { state: "unknown" };
  const folder = d.folders.find((f) => f.name.toUpperCase() === entry.code);
  const name = folder?.folder?.system || folder?.auto || entry.system;
  const sys = name && d.systems.find((s) => s.name === name);
  if (sys) return { state: "ready", sys, set: !!folder?.folder };
  const kind = noteKind(entry.code);
  return { state: kind === "use" ? "pick" : kind || "missing" };
}

const CHIPS = {
  ready: `<span class="set-chip ok">${icon("check")}On the handheld</span>`,
  pick: `<span class="set-chip warn">Pick its system</span>`,
  extra: `<span class="set-chip warn">Needs an extra core</span>`,
  none: `<span class="set-chip bad">No core</span>`,
  missing: `<span class="set-chip warn">Not on the handheld</span>`,
  unknown: "",
};

function row(entry) {
  const st = status(entry);
  const detail = st.state === "ready"
    ? `<span>${esc(st.sys.name)}${st.set ? " &middot; set in Cores" : ""}</span><b>${esc(st.sys.cores.find((c) => c.key === st.sys.defaultCore)?.name || st.sys.defaultCore || "")} <small>${plural(st.sys.cores.length, "core")}</small></b>`
    : st.state === "pick" ? `<span>Runs under</span><b>${esc(useSystem(entry.code))}</b>`
    : `<span>MustardOS system</span><b>${st.state === "unknown" ? "Not checked" : "None"}</b>`;
  const note = st.state === "ready" ? "" : st.state === "unknown" && !noteKind(entry.code) ? "" : systemNote(entry.code, entry.name, false);
  return `<div class="core-row sys-row">
    <div class="core-main sys-main">
      <div class="core-folder"><b>${esc(entry.code)}</b><small>${esc(entry.name)} &middot; ${entry.games ? plural(entry.games, "game") : "no games"}</small></div>
      <div class="core-now">${detail}</div>
      ${CHIPS[st.state]}
    </div>
    ${note ? `<p class="core-note">${icon("info")}<span>${note}</span></p>` : ""}
  </div>`;
}

function render() {
  const root = $("emu-body");
  if (!root || $("view-emulation").hidden || !$("emu-tabs").querySelector('[data-tab="systems"].on')) return;
  $("emu-actions").innerHTML = `<button class="btn" data-sy="refresh" title="Read the handheld again"${Y.loading ? " disabled" : ""}>${icon("refresh")}<span>Refresh</span></button>`;
  const d = Y.data;
  if (!d) {
    root.innerHTML = Y.error ? `<div class="notice err">${esc(Y.error)}</div>` : `<div class="planning"><span class="spinner"></span> Asking the handheld&hellip;</div>`;
    return;
  }
  const all = d.library || [];
  const list = Y.used ? all.filter((e) => e.games) : all;
  const states = all.map((e) => [e, status(e).state]);
  const runs = states.filter(([, s]) => s === "ready" || s === "pick").length;
  const missingUsed = states.filter(([e, s]) => e.games && s !== "ready" && s !== "unknown").length;
  const groups = CATEGORY_ORDER.map((cat) => [cat, list.filter((e) => e.category === cat)]).filter(([, items]) => items.length);
  const head = d.reachable
    ? `<p class="muted-note">MustardOS on <b>${esc(d.host)}</b> can run games for ${runs} of the ${all.length} systems the manager knows.${missingUsed ? ` ${plural(missingUsed, "system")} with games in your library ${missingUsed === 1 ? "needs" : "need"} attention below.` : ""}</p>`
    : `<div class="notice">Connect the ${esc(model().name)} over Wi-Fi with <b>Configuration &rsaquo; Web Services &rsaquo; Secure Shell</b> on to see which systems its MustardOS runs.
        Until then, the notes below show the systems MustardOS 2601 Jacaranda leaves out.</div>`;
  root.innerHTML = `<section class="panel cores-panel">
    <h2>${icon("layers")}Systems <small>${list.length}${list.length < all.length ? ` of ${all.length}` : ""}</small><span class="grow"></span>
      <button class="link-btn" data-sy="used">${Y.used ? "Show all systems" : "Only systems with games"}</button></h2>
    ${head}
    ${groups.length ? groups.map(([cat, items]) => `<h3 class="sys-cat">${esc(cat)}</h3><div class="cores-list">${items.map(row).join("")}</div>`).join("")
      : `<p class="muted-note">Your Roms/ library has no games yet.</p>`}
  </section>`;
}

export function bindSystems(view) {
  view.addEventListener("click", (e) => {
    const el = e.target.closest("[data-sy]");
    if (!el || el.disabled) return;
    if (el.dataset.sy === "refresh") load();
    else if (el.dataset.sy === "used") { Y.used = !Y.used; render(); }
  });
}
