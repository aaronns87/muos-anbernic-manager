// Cores tab: which emulator core MustardOS starts for each ROM folder on the handheld, and for single games.

import { $, api, esc, icon, plural, toast } from "./core.js";
import { confirmBox } from "./art-images.js";
import { systemNote, useCore, useSystem } from "./system-notes.js";

const K = { data: null, error: "", loading: false, saving: "", edit: "", draft: null, games: {}, all: false, wifi: undefined };

export function showCores() {
  load();
  render();
}

export function renderCores(wifi) {
  if (K.wifi !== undefined && wifi !== K.wifi && !K.loading) load();
  K.wifi = wifi;
  render();
}

async function load() {
  K.loading = true;
  render();
  try {
    K.data = await api("cores");
    K.error = "";
  } catch (error) {
    K.error = error.message;
  }
  K.loading = false;
  render();
}

// ---------------------------------------------------------------- helpers

const system = (name) => K.data.systems.find((s) => s.name === name);
const coreName = (sys, key) => system(sys)?.cores.find((c) => c.key === key)?.name || key;
const libraryName = (folder) => K.data.library?.find((s) => s.code === folder.toUpperCase())?.name || "";
const current = (f) => (f.folder ? { system: f.folder.system, core: f.folder.key } : f.auto ? { system: f.auto, core: system(f.auto)?.defaultCore || "" } : { system: "", core: "" });

function coreOptions(sys, selected) {
  const s = system(sys);
  if (!s) return `<option value="">Pick a system first</option>`;
  return s.cores.map((c) => `<option value="${esc(c.key)}"${c.key === selected ? " selected" : ""}>${esc(c.name)}${c.key === s.defaultCore ? " (default)" : ""}</option>`).join("");
}

const systemOptions = (selected) => `${selected ? "" : `<option value="">Pick a system</option>`}${K.data.systems.map((s) =>
  `<option value="${esc(s.name)}"${s.name === selected ? " selected" : ""}>${esc(s.name)}</option>`).join("")}`;

// ---------------------------------------------------------------- rendering

function render() {
  const root = $("emu-body");
  if (!root || $("view-emulation").hidden || !$("emu-tabs").querySelector('[data-tab="cores"].on')) return;
  $("emu-actions").innerHTML = `<button class="btn" data-co="refresh" title="Read the handheld again"${K.loading ? " disabled" : ""}>${icon("refresh")}<span>Refresh</span></button>`;
  const d = K.data;
  if (!d) {
    root.innerHTML = K.error ? `<div class="notice err">${esc(K.error)}</div>` : `<div class="planning"><span class="spinner"></span> Asking the handheld&hellip;</div>`;
    return;
  }
  if (!d.reachable) {
    root.innerHTML = `<section class="panel"><h2>${icon("chip")}Cores</h2>
      <div class="notice">Core assignments live on the handheld. Connect it over Wi-Fi and turn on <b>Configuration &rsaquo; Web Services &rsaquo; Secure Shell</b>,
        then check the <a href="#ssh">SSH</a> section.</div></section>`;
    return;
  }
  $("emu-sub").innerHTML = `The core MustardOS starts for each ROM folder on <b>${esc(d.host)}</b>, and for single games`;
  const games = d.folders.reduce((n, f) => n + f.count, 0);
  const withGames = games ? d.folders.filter((f) => f.count > 0 || f.folder || f.overrides.length) : d.folders;
  const list = K.all ? d.folders : withGames;
  root.innerHTML = `<section class="panel cores-panel">
    <h2>${icon("chip")}ROM folders <small>${list.length}${list.length < d.folders.length ? ` of ${d.folders.length}` : ""}</small><span class="grow"></span>
      ${withGames.length && withGames.length < d.folders.length ? `<button class="link-btn" data-co="all">${K.all ? "Only folders in use" : "Show all folders"}</button>` : ""}</h2>
    ${games ? "" : `<div class="notice">The handheld shows no games right now. If they are on the TF2 card, put it in the handheld; the folders below are the ones on SD1.</div>`}
    <p class="muted-note">"Automatic" folders get the system's default core the first time you open them on the handheld. Changes apply the next time a game starts.</p>
    <div class="cores-list">${list.map(folderRow).join("")}</div>
  </section>`;
}

function folderRow(f) {
  const cur = current(f), editing = K.edit === f.name;
  const sys = cur.system ? esc(cur.system) : `<span class="app-bad">No system matched</span>`;
  const core = cur.core ? esc(coreName(cur.system, cur.core)) : "&ndash;";
  const chip = f.folder ? `<span class="set-chip ok">${icon("check")}Set</span>` : cur.system ? `<span class="set-chip">Automatic</span>` : `<span class="set-chip warn">Needs a system</span>`;
  return `<div class="core-row${editing ? " open" : ""}">
    <div class="core-main">
      <div class="core-folder"><b>${esc(f.name)}</b><small>${f.count ? plural(f.count, "file") : "Empty"}</small></div>
      <div class="core-now"><span>${sys}</span><b>${core}</b></div>
      ${chip}
      <button class="btn small${editing ? " ghost" : ""}" data-co="edit" data-folder="${esc(f.name)}"${K.saving ? " disabled" : ""}>${editing ? "Close" : "Change"}</button>
    </div>
    ${cur.system ? "" : `<p class="core-note">${icon("info")}<span>${systemNote(f.name, libraryName(f.name))}</span></p>`}
    ${f.overrides.length ? `<div class="core-games">${f.overrides.map((o) => `<div class="core-game">
        <span class="core-game-name" title="${esc(o.file || o.name)}">${esc(o.name)}</span>
        <span class="muted-note">${esc(coreName(o.system, o.key))}${o.system !== cur.system ? ` &middot; ${esc(o.system)}` : ""}</span>
        <button class="btn small ghost" data-co="reset-game" data-folder="${esc(f.name)}" data-name="${esc(o.name)}"${K.saving ? " disabled" : ""}>Use the folder's core</button>
      </div>`).join("")}</div>` : ""}
    ${editing ? editor(f) : ""}
  </div>`;
}

function editor(f) {
  const d = K.draft;
  const g = K.games[f.name];
  const same = f.folder && d.system === f.folder.system && d.core === f.folder.key;
  return `<div class="core-edit">
    <div class="core-edit-row">
      <label><span>System</span><select class="control" data-co-field="system">${systemOptions(d.system)}</select></label>
      <label><span>Core for the whole folder</span><select class="control" data-co-field="core">${coreOptions(d.system, d.core)}</select></label>
      <button class="btn primary" data-co="save-folder" data-folder="${esc(f.name)}"${d.system && d.core && !same && !K.saving ? "" : " disabled"}>${K.saving === "folder" ? `<span class="spinner sm"></span><span>Saving&hellip;</span>` : `${icon("check")}<span>Save</span>`}</button>
    </div>
    ${f.overrides.length ? `<label class="core-keep"><input type="checkbox" data-co-field="keep"${d.keep ? " checked" : ""}> Keep the ${plural(f.overrides.length, "game")} with their own core</label>` : ""}
    <div class="core-edit-row core-one">
      <label class="grow"><span>One game only</span>
        ${g?.games ? `<input class="control" list="core-games-list" data-co-field="file" value="${esc(d.file || "")}" placeholder="${g.games.length ? `Type to search ${plural(g.games.length, "game")}` : "No games in this folder"}"${g.games.length ? "" : " disabled"}>
          <datalist id="core-games-list">${g.games.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`
        : g?.error ? `<span class="app-bad">${esc(g.error)}</span>` : `<span class="muted-note"><span class="spinner sm"></span> Reading the folder&hellip;</span>`}
      </label>
      <label><span>Core</span><select class="control" data-co-field="gameCore">${coreOptions(d.system, d.gameCore)}</select></label>
      <button class="btn" data-co="save-game" data-folder="${esc(f.name)}"${g?.games?.includes(d.file) && d.gameCore && !K.saving ? "" : " disabled"}>${K.saving === "game" ? `<span class="spinner sm"></span><span>Saving&hellip;</span>` : "Set for this game"}</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- actions

async function openEditor(name) {
  if (K.edit === name) { K.edit = ""; render(); return; }
  const f = K.data.folders.find((x) => x.name === name);
  const cur = current(f);
  const sys = cur.system || (system(useSystem(name)) ? useSystem(name) : "");
  const core = cur.core || (cur.system ? "" : useCore(name, system(sys)?.cores)) || system(sys)?.defaultCore || "";
  K.edit = name;
  K.draft = { system: sys, core, keep: false, file: "", gameCore: core };
  render();
  if (!K.games[name]) {
    try { K.games[name] = await api(`cores/games?folder=${encodeURIComponent(name)}`); } catch (error) { K.games[name] = { error: error.message }; }
    render();
  }
}

async function save(kind, folder) {
  const d = K.draft, f = K.data.folders.find((x) => x.name === folder);
  if (kind === "folder" && f.overrides.length && !d.keep) {
    const ok = await confirmBox({
      title: `Change the core for ${folder}?`,
      html: `<p>${plural(f.overrides.length, "game")} in ${esc(folder)} ${f.overrides.length === 1 ? "has" : "have"} its own core. Saving sets ${f.overrides.length === 1 ? "it" : "them"} back to the folder's core.</p>
        <p>Tick <b>Keep the games with their own core</b> to leave them.</p>`,
      ok: "Save",
    });
    if (!ok) return;
  }
  K.saving = kind;
  render();
  try {
    K.data = kind === "folder"
      ? await api("cores/folder", { folder, system: d.system, core: d.core, keepGames: d.keep })
      : await api("cores/game", { folder, system: d.system, core: d.gameCore, file: d.file });
    toast(kind === "folder" ? `${folder} now starts with ${coreName(d.system, d.core)}` : `${d.file} now starts with ${coreName(d.system, d.gameCore)}`, 2800);
    if (kind === "folder") K.edit = "";
    else d.file = "";
  } catch (error) {
    toast(error.message, 4000);
  }
  K.saving = "";
  render();
}

async function resetGame(folder, name) {
  const ok = await confirmBox({ title: `Use the folder's core for ${name}?`, html: `<p>Its own core assignment is removed on the handheld; it starts with the core set for ${esc(folder)}.</p>`, ok: "Use the folder's core" });
  if (!ok) return;
  K.saving = "reset";
  render();
  try {
    K.data = await api("cores/game/reset", { folder, name });
    toast(`${name} follows ${folder} again`, 2600);
  } catch (error) {
    toast(error.message, 4000);
  }
  K.saving = "";
  render();
}

export function bindCores(view) {
  view.addEventListener("click", (e) => {
    const el = e.target.closest("[data-co]");
    if (!el || el.disabled) return;
    const { co, folder, name } = el.dataset;
    if (co === "refresh") load();
    else if (co === "all") { K.all = !K.all; render(); }
    else if (co === "edit") openEditor(folder);
    else if (co === "save-folder") save("folder", folder);
    else if (co === "save-game") save("game", folder);
    else if (co === "reset-game") resetGame(folder, name);
  });
  const field = (e) => {
    const t = e.target, f = t.dataset?.coField;
    if (!f || !K.draft) return;
    if (f === "keep") K.draft.keep = t.checked;
    else if (f === "file") { K.draft.file = t.value; if (e.type === "input") { const b = view.querySelector('[data-co="save-game"]'); if (b) b.disabled = !K.games[K.edit]?.games?.includes(t.value) || !K.draft.gameCore || !!K.saving; return; } }
    else if (f === "system") { K.draft.system = t.value; K.draft.core = system(t.value)?.defaultCore || ""; K.draft.gameCore = K.draft.core; }
    else K.draft[f] = t.value;
    render();
  };
  view.addEventListener("change", field);
  view.addEventListener("input", (e) => { if (e.target.dataset?.coField === "file") field(e); });
}
