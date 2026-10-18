// Game Tuning: pick a game, see which emulator runs it, and save per-game speed and looks settings on the handheld.

import { $, api, app, esc, icon, model, store, toast } from "./core.js";
import { confirmBox } from "./art-images.js";
import { bindCheats, cheatsPanel, loadCheats } from "./tuning-cheats.js";
import {
  catalogueDirty, draftFromOwn, effectiveOf, inheritedOf, optGroupsHtml, optionLabel, valuesPayload,
} from "./opt-editor.js";

const T = {
  data: null, error: "", loading: false, wifi: undefined, bound: false,
  sys: store.get("tuneSystem", ""), sysOpen: false, sysQ: "", sysHi: 0, q: "", pick: null,
  game: null, gameError: "", gameLoading: false, draft: null, gov: "", typedId: "", saving: false, optQ: "",
};
const LIMIT = 200;
const PRESETS = [["speed", "Fastest", "bolt"], ["balanced", "Balanced", "sliders"], ["quality", "Best looking", "image"]];
const FROM = { folder: "folder's RetroArch options", core: "core's RetroArch options", global: "PPSSPP settings on the handheld", defaults: "emulator's defaults" };

/** Pre-select a game before navigating to #tuning (e.g. from the game viewer). */
export function focusTuningGame(code, file) {
  T.sys = code;
  store.set("tuneSystem", code);
  T.pick = { code, file };
  T.game = null;
  T.gameError = "";
}

export function showTuning() {
  if (!T.bound) bind();
  if (!T.data && !T.loading) load();
  else if (T.pick && T.data?.reachable && (!T.game || T.game.folder !== T.pick.code || T.game.file !== T.pick.file) && !T.gameLoading) {
    openGame(T.pick.code, T.pick.file, "", true);
  }
  render();
}

export function renderTuning(wifi) {
  if (wifi !== undefined && T.wifi !== undefined && wifi !== T.wifi && !T.loading) load();
  if (wifi !== undefined) T.wifi = wifi;
  render();
}

async function load() {
  T.loading = true;
  render();
  try {
    T.data = await api("tuning");
    T.error = "";
    if (T.pick && T.data.reachable) openGame(T.pick.code, T.pick.file, "", true);
  } catch (error) {
    T.error = error.message;
  }
  T.loading = false;
  render();
}

// ---------------------------------------------------------------- helpers

const profileOf = (id) => T.data?.profiles.find((p) => p.id === id) || null;
const folderOf = (code) => T.data?.folders?.find((f) => f.name === code) || null;
const folderTunable = (f) => !!(f?.profile || f?.core);
const otherSub = (f) => (f?.core ? `Core options \u00b7 ${f.core}` : f?.so?.endsWith(".so") ? "Cheats and CPU governor" : "CPU governor only");
const emuName = (g) => profileOf(g.profile)?.name || g.core || g.so.replace(/^ext-/, "") || "Unknown";
const catalogue = () => T.game?.catalogue || [];

/** Games with their own settings file on the handheld, as "FOLDER/stem". */
function tunedSet() {
  const out = new Set();
  for (const [kind, rel] of T.data?.tuned || []) {
    const [dir, file] = rel.split("/");
    const name = file.replace(/\.(gov|opt)$/, "");
    if (kind === "gov" && name !== "core") out.add(`${dir}/${name}`);
    if (kind === "opt") for (const f of T.data.folders) if (f.core === dir && name !== f.name && name !== f.core) out.add(`${f.name}/${name}`);
  }
  return out;
}

const stemOf = (f) => (f.lastIndexOf(".") > 0 ? f.slice(0, f.lastIndexOf(".")) : f);

function systems() {
  const list = (app.data?.systems || []).filter((s) => s.games.length && s.code !== "PORTS");
  const tunable = (s) => folderTunable(folderOf(s.code));
  return list.sort((a, b) => tunable(b) - tunable(a) || a.name.localeCompare(b.name));
}

function matches() {
  const sys = systems(), q = T.q.trim().toLowerCase();
  const pickSys = T.sys ? sys.filter((s) => s.code === T.sys) : sys.filter((s) => !T.data?.reachable || folderTunable(folderOf(s.code)));
  const out = [];
  for (const s of pickSys) for (const g of s.games) if (!q || (g.search || g.t.toLowerCase()).includes(q)) out.push([s, g]);
  return out.sort((a, b) => a[1].k.localeCompare(b[1].k));
}

const inherited = (s) => inheritedOf(s, T.game?.base);
const effective = (s) => effectiveOf(s, T.draft, T.game?.base);

function recommendation() {
  const g = T.game, p = profileOf(g.profile);
  const title = currentGame()?.[1].t || g.stem;
  return T.data.recommendations.find((r) => r.profiles.includes(p?.id) && (!r.match || new RegExp(r.match, "i").test(title))) || null;
}

function currentGame() {
  if (!T.pick || !app.data) return null;
  const s = app.data.systems.find((x) => x.code === T.pick.code);
  const g = s?.games.find((x) => x.f === T.pick.file);
  return s && g ? [s, g] : null;
}

function settingsShown() {
  return catalogue();
}

function activePreset() {
  const p = profileOf(T.game.profile);
  if (!p) return "";
  const shown = settingsShown().filter((s) => s.curated);
  for (const [id] of PRESETS) {
    const want = p.presets[id];
    if (shown.every((s) => !(s.key in want) || effective(s) === want[s.key])) return id;
  }
  return "";
}

function draftFrom(values) {
  return draftFromOwn(catalogue(), values, T.game?.base);
}

function applyPreset(id, gov) {
  const p = profileOf(T.game.profile);
  if (!p) return;
  const cur = Object.fromEntries(settingsShown().map((s) => [s.key, effective(s)]));
  T.draft = draftFrom({ ...cur, ...p.presets[id] });
  const want = gov && T.data.governors[gov] ? gov : id === "speed" && T.data.governors.performance ? "performance" : "";
  if (want) T.gov = want === (T.game.gov.folder || T.game.gov.system) ? "" : want;
  render();
}

const dirty = () => {
  const g = T.game;
  if (!g || !T.draft) return false;
  return catalogueDirty(catalogue(), T.draft, g.own, g.base) || T.gov !== (g.gov.own || "");
};

// ---------------------------------------------------------------- rendering

function render() {
  const root = $("tune-body");
  if (!root || $("view-tuning").hidden) return;
  $("tune-actions").innerHTML = `<button class="btn" data-tune="refresh" title="Read the handheld again"${T.loading ? " disabled" : ""}>${icon("refresh")}<span>Refresh</span></button>`;
  if (!T.data) {
    root.innerHTML = T.error ? `<div class="notice err">${esc(T.error)}</div>` : `<div class="planning"><span class="spinner"></span> Asking the handheld&hellip;</div>`;
    return;
  }
  const scroll = root.querySelector(".tune-list")?.scrollTop || 0;
  root.innerHTML = `<div class="tune">
    <aside class="tune-pick panel">${picker()}</aside>
    <div class="tune-main">${editor()}</div>
  </div>`;
  const list = root.querySelector(".tune-list");
  if (list) list.scrollTop = scroll;
}

function picker() {
  if (!app.data) return `<div class="planning"><span class="spinner"></span> Loading the library&hellip;</div>`;
  return `<div class="tune-filter">
      ${systemPicker()}
      <label class="search small">${icon("search")}<input type="search" data-tune-q placeholder="Search games" value="${esc(T.q)}" aria-label="Search games"></label>
    </div>
    <div class="tune-results">${results()}</div>`;
}

/** The system choices: everything with tuning first, then each system with what it can change. */
function systemEntries() {
  const all = { code: "", name: T.data.reachable ? "Systems with tuning" : "All systems", sub: T.data.reachable ? "Every system with emulator settings" : "", group: "" };
  const list = systems().map((s) => {
    const f = folderOf(s.code), p = profileOf(f?.profile);
    const tunable = folderTunable(f);
    return {
      code: s.code, name: s.name,
      sub: p ? p.name : T.data.reachable ? otherSub(f) : "",
      group: tunable || !T.data.reachable ? "Emulator settings" : "Cheats and CPU governor",
    };
  });
  const q = T.sysQ.trim().toLowerCase();
  return [all, ...list].filter((e) => !q || `${e.name} ${e.code} ${e.sub}`.toLowerCase().includes(q));
}

function systemOptions() {
  const entries = systemEntries();
  if (!entries.length) return `<p class="muted-note tune-sys-none">No system matches.</p>`;
  let group = null;
  return entries.map((e, i) => {
    const head = e.group && e.group !== group && T.data.reachable ? `<div class="mp-group">${esc(e.group)}</div>` : "";
    group = e.group;
    const on = e.code === T.sys;
    return `${head}<button type="button" class="tune-sys-opt${on ? " on" : ""}${i === T.sysHi ? " hi" : ""}" role="option" id="tune-sys-${i}" aria-selected="${on}" data-tune="sys" data-code="${esc(e.code)}">
      <span><b>${esc(e.name)}</b>${e.sub ? `<small>${esc(e.sub)}</small>` : ""}</span>${on ? icon("check") : ""}</button>`;
  }).join("");
}

function systemPicker() {
  const cur = [{ code: "", name: T.data.reachable ? "Systems with tuning" : "All systems" }, ...systems()].find((s) => s.code === T.sys);
  const p = T.sys ? profileOf(folderOf(T.sys)?.profile) : null;
  const sub = T.sys ? (p ? p.name : T.data.reachable ? otherSub(folderOf(T.sys)) : "") : "";
  return `<div class="tune-sys${T.sysOpen ? " open" : ""}">
    <button type="button" class="control tune-sys-btn" data-tune="sys-toggle" aria-haspopup="listbox" aria-expanded="${T.sysOpen}" aria-label="System">
      <span><b>${esc(cur?.name || T.sys)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>${icon("down")}</button>
    ${T.sysOpen ? `<div class="tune-sys-menu">
      <label class="search small">${icon("search")}<input type="search" data-tune-sysq placeholder="Type to filter systems" value="${esc(T.sysQ)}"
        role="combobox" aria-expanded="true" aria-controls="tune-sys-list" aria-autocomplete="list" aria-activedescendant="tune-sys-${T.sysHi}" aria-label="Filter systems"></label>
      <div class="tune-sys-list" id="tune-sys-list" role="listbox" aria-label="Systems">${systemOptions()}</div>
    </div>` : ""}
  </div>`;
}

function openSystems(open) {
  T.sysOpen = open;
  T.sysQ = "";
  T.sysHi = Math.max(0, systemEntries().findIndex((e) => e.code === T.sys));
  render();
  const view = $("view-tuning");
  if (open) {
    view.querySelector("[data-tune-sysq]")?.focus();
    view.querySelector(".tune-sys-opt.hi")?.scrollIntoView({ block: "nearest" });
  } else view.querySelector(".tune-sys-btn")?.focus();
}

function pickSystem(code) {
  T.sys = code;
  store.set("tuneSystem", code);
  openSystems(false);
}

function refreshSystemList() {
  const view = $("view-tuning"), list = view.querySelector(".tune-sys-list"), input = view.querySelector("[data-tune-sysq]");
  if (!list) return;
  list.innerHTML = systemOptions();
  input?.setAttribute("aria-activedescendant", `tune-sys-${T.sysHi}`);
  list.querySelector(".tune-sys-opt.hi")?.scrollIntoView({ block: "nearest" });
}

function results() {
  const list = matches(), tuned = tunedSet();
  const rows = list.slice(0, LIMIT).map(([s, g]) => {
    const on = T.pick && T.pick.code === s.code && T.pick.file === g.f;
    const own = tuned.has(`${s.code}/${stemOf(g.f)}`);
    return `<button class="tune-game${on ? " on" : ""}" data-tune="game" data-code="${esc(s.code)}" data-file="${esc(g.f)}" aria-pressed="${on}">
      ${g.i ? `<img src="${esc(g.i)}" alt="" loading="lazy">` : `<span class="tune-ph">${esc(s.code.slice(0, 4))}</span>`}
      <span class="tune-name"><b>${esc(g.t)}</b><small>${esc(s.name)}</small></span>
      ${own ? `<span class="badge ok-badge" title="Has its own settings on the handheld">Tuned</span>` : ""}
    </button>`;
  }).join("");
  return `<div class="tune-list">${rows || `<p class="muted-note">No games match.</p>`}</div>
    ${list.length > LIMIT ? `<p class="muted-note">Showing ${LIMIT} of ${list.length.toLocaleString()}. Search to narrow it down.</p>` : ""}`;
}

function intro() {
  return `<section class="panel tune-intro">
    <h2>${icon("bolt")}Game Tuning</h2>
    <p>Pick a game to give it its own emulator settings: faster for heavy games, sharper for light ones, plus cheats. They are saved on the handheld and apply the next time the game starts.</p>
    <ul class="tune-points">
      <li><b>PSP</b> PPSSPP, standalone and RetroArch</li>
      <li><b>N64</b> Mupen64Plus-Next</li>
      <li><b>PlayStation</b> PCSX-ReARMed, SwanStation, DuckStation</li>
      <li><b>Dreamcast</b> Flycast</li>
      <li><b>Cheats</b> RetroArch cores and PPSSPP, from the libretro cheat database</li>
      <li><b>Every game</b> its own CPU governor</li>
    </ul>
  </section>`;
}

function editor() {
  if (!T.data.reachable) {
    return `<section class="panel"><h2>${icon("bolt")}Game Tuning</h2>
      <div class="notice">Game Tuning saves settings on the handheld. Connect it over Wi-Fi and turn on <b>Configuration &rsaquo; Web Services &rsaquo; Secure Shell</b>,
        then check the <a href="#ssh">SSH</a> section.</div></section>${intro()}`;
  }
  if (!T.pick) return intro();
  if (T.gameLoading && !T.game) return `<section class="panel"><div class="planning"><span class="spinner"></span> Reading the game's settings&hellip;</div></section>`;
  if (T.gameError) return `<section class="panel"><div class="notice err">${esc(T.gameError)}</div></section>`;
  if (!T.game) return intro();
  const g = T.game, p = profileOf(g.profile), cur = currentGame();
  const title = cur?.[1].t || g.stem;
  const emu = emuName(g);
  const head = `<section class="panel tune-head">
    ${cur?.[1].i ? `<img src="${esc(cur[1].i)}" alt="">` : ""}
    <div class="tune-title">
      <h3>${esc(title)}</h3>
      <div class="tune-tags">
        <span class="pill">${esc(cur?.[0].name || g.folder)}</span>
        <span class="pill${p ? " ok" : ""}" title="${esc(g.ownCore ? "This game has its own core" : `The core for ${g.folder}`)}">${icon("chip")}${esc(emu)}${g.ownCore ? " (own core)" : ""}</span>
        ${g.discId ? `<span class="pill" title="PSP disc ID">${esc(g.discId)}</span>` : ""}
        <span class="pill${g.onDevice ? " ok" : " warn"}">${g.onDevice ? "On the handheld" : "Not on the handheld yet"}</span>
        ${g.own || g.gov.own ? `<span class="pill ok">Tuned</span>` : ""}
      </div>
    </div>
  </section>`;
  const notes = [];
  if (!g.onDevice) notes.push(`<div class="notice">This game is not on the handheld yet. Settings saved now apply once you copy it.</div>`);
  if (g.profile === "ppsspp" && !g.discId) notes.push(discIdBox());
  const hasOpts = catalogue().length > 0 || g.core;
  if (!p && !g.core) {
    notes.push(g.so.startsWith("ext-")
      ? `<div class="notice">${esc(emu)} is a standalone emulator without per-game core options, so only the CPU governor is offered. For Menu+X-style options, give the game a RetroArch core in <a href="#emulation">Emulation &rsaquo; Cores</a>.</div>`
      : `<div class="muted-note">No RetroArch core for this game; CPU governor and cheats are offered.</div>`);
  }
  const canEditOpts = (g.kind === "ppsspp" ? !!g.discId : !!g.core) && (hasOpts || g.kind === "ppsspp" || g.core);
  const body = canEditOpts && (g.profile !== "ppsspp" || g.discId) ? settingsPanels() : "";
  return `${head}${notes.join("")}${body}${governorPanel()}${actions()}${cheatsPanel()}`;
}

function discIdBox() {
  return `<div class="notice tune-id">
    <span>PPSSPP keeps per-game settings under the game's disc ID, which could not be read from this file (CHD images do not show it).
      Type it to continue; PPSSPP shows it under <b>Game settings &rsaquo; Game info</b>, and it is printed on the disc, like <code>ULUS10391</code>.</span>
    <span class="tune-id-row"><input class="control" data-tune-id maxlength="10" placeholder="ULUS10391" value="${esc(T.typedId)}" aria-label="Disc ID">
      <button class="btn" data-tune="id"${/^[A-Z]{4}\d{5}$/.test(T.typedId) ? "" : " disabled"}>Use</button></span>
  </div>`;
}

function settingsPanels() {
  const p = profileOf(T.game.profile);
  const shown = settingsShown(), active = activePreset(), rec = p ? recommendation() : null, m = model();
  const presets = p ? `<section class="panel">
      <h2>${icon("sliders")}Presets</h2>
      ${rec ? `<div class="tune-rec">
      <span>${icon("bolt")}</span>
      <div><b>Recommended: ${esc(PRESETS.find(([id]) => id === rec.preset)[1])}${rec.gov && T.data.governors[rec.gov] ? ` with the ${esc(rec.gov)} governor` : ""}</b>
        <p>${esc(rec.note)}</p>
        ${m ? `<small>A starting point for ${esc(m.name)} (${esc(m.gpu || m.chip || "")}). Play a few minutes and adjust.</small>` : ""}</div>
      <button class="btn small" data-tune="rec"${T.saving ? " disabled" : ""}>Use this</button>
    </div>` : ""}
      <div class="segmented wide tune-presets" role="radiogroup" aria-label="Preset">${PRESETS.map(([id, label, ico]) =>
        `<button role="radio" data-tune="preset" data-preset="${id}" class="${active === id ? "on" : ""}" aria-checked="${active === id}"${T.saving ? " disabled" : ""}>${icon(ico)}<span>${label}</span></button>`).join("")}</div>
      <p class="muted-note">${Object.values(T.draft || {}).some(Boolean) ? (active ? "" : "Custom settings. ") : `Default means the game's current value, from the ${esc(FROM[T.game.baseFrom] || "defaults")}. `}Presets only fill curated settings; nothing is saved until you press Save.</p>
    </section>` : "";
  const filter = shown.length > 12
    ? `<label class="search small tune-opt-q">${icon("search")}<input type="search" data-tune-optq placeholder="Filter options" value="${esc(T.optQ)}" aria-label="Filter core options"></label>`
    : "";
  return `${presets}${filter ? `<div class="tune-opt-filter">${filter}<span class="muted-note">${shown.length} options</span></div>` : ""}
    ${optGroupsHtml(shown, T.draft, T.game.base, { q: T.optQ, disabled: T.saving, dataKey: "tune-key" })}`;
}

function governorPanel() {
  const g = T.game, govs = T.data.governors;
  const fallback = g.gov.folder || g.gov.system || "";
  const from = g.gov.folder ? `${g.folder} folder` : "system";
  return `<section class="panel"><h2>${icon("chip")}CPU governor</h2>
    <label class="tune-row${T.gov ? " set" : ""}">
      <span class="tune-row-text"><b>Governor <span class="badge ok-badge">Speed</span></b>
        <small>How fast the handheld's CPU runs while this game plays. Performance keeps it at full speed: smoother heavy games, shorter battery life.</small></span>
      <select class="control${T.gov ? " active" : ""}" data-tune-gov>
        <option value="">Default: ${esc(fallback || "unknown")} (${esc(from)})</option>
        ${Object.entries(govs).map(([k, label]) => `<option value="${esc(k)}"${T.gov === k ? " selected" : ""}>${esc(label)}</option>`).join("")}
        ${T.gov && !govs[T.gov] ? `<option value="${esc(T.gov)}" selected>${esc(T.gov)}</option>` : ""}
      </select>
    </label>
  </section>`;
}

function actions() {
  const g = T.game, has = !!(g.hasOwnFile || g.own || g.gov.own), d = dirty();
  return `<div class="tune-actions">
    <button class="btn ghost" data-tune="reset"${has && !T.saving ? "" : " disabled"} title="Remove this game's own settings from the handheld">${icon("refresh")}<span>Use folder settings</span></button>
    <span class="grow"></span>
    ${d ? `<span class="muted-note">Unsaved changes</span>` : ""}
    <button class="btn primary" data-tune="save"${d && !T.saving ? "" : " disabled"}>${T.saving ? `<span class="spinner sm"></span><span>Saving&hellip;</span>` : `${icon("check")}<span>Save to handheld</span>`}</button>
  </div>`;
}

// ---------------------------------------------------------------- actions

async function openGame(code, file, discId = "", fresh = false) {
  T.pick = { code, file };
  T.gameLoading = true;
  T.gameError = "";
  if (!discId) { T.game = null; T.typedId = ""; }
  render();
  try {
    const g = await api(`tuning/game?${new URLSearchParams({ folder: code, file, discId })}`);
    if (!T.pick || T.pick.code !== code || T.pick.file !== file) return;
    T.game = g;
    T.optQ = "";
    T.draft = draftFrom(g.own);
    T.gov = g.gov.own || "";
    loadCheats(g, emuName(g), fresh);
  } catch (error) {
    if (T.pick?.code === code && T.pick?.file === file) T.gameError = error.message;
  }
  T.gameLoading = false;
  render();
}

async function save() {
  const g = T.game, title = currentGame()?.[1].t || g.stem;
  T.saving = true;
  render();
  try {
    const values = valuesPayload(catalogue(), T.draft);
    await api("tuning/save", { folder: g.folder, file: g.file, values, gov: T.gov, discId: g.discId });
    toast(`Saved for ${title}. It applies the next time the game starts.`, 3200);
    T.saving = false;
    T.data = await api("tuning").catch(() => T.data);
    await openGame(g.folder, g.file, g.discId);
  } catch (error) {
    T.saving = false;
    toast(error.message, 4500);
    render();
  }
}

async function reset() {
  const g = T.game, title = currentGame()?.[1].t || g.stem;
  const ppsspp = g.profile === "ppsspp";
  const ok = await confirmBox({
    title: `Remove ${title}'s own settings?`,
    html: `<p>The game goes back to the settings of its ${esc(g.folder)} folder${g.gov.own ? " and its CPU governor" : ""}.</p>
      ${ppsspp ? "<p>This also removes settings made for this game in PPSSPP's own Game settings.</p>" : ""}<p>You can tune it again at any time.</p>`,
    ok: "Remove", danger: true,
  });
  if (!ok) return;
  T.saving = true;
  render();
  try {
    await api("tuning/reset", { folder: g.folder, file: g.file, discId: g.discId });
    toast(`${title} uses its folder's settings again`, 2600);
    T.saving = false;
    T.data = await api("tuning").catch(() => T.data);
    await openGame(g.folder, g.file, g.discId);
  } catch (error) {
    T.saving = false;
    toast(error.message, 4500);
    render();
  }
}

function bind() {
  T.bound = true;
  const view = $("view-tuning");
  bindCheats(view, render);
  view.addEventListener("keydown", (e) => {
    if (!T.sysOpen) return;
    if (e.key === "Escape") { e.preventDefault(); openSystems(false); return; }
    if (e.target.dataset?.tuneSysq === undefined) return;
    const n = systemEntries().length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (n) T.sysHi = (T.sysHi + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      refreshSystemList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = systemEntries()[T.sysHi];
      if (pick) pickSystem(pick.code);
    } else if (e.key === "Tab") {
      T.sysOpen = false;
      render();
    }
  });
  document.addEventListener("click", (e) => {
    if (T.sysOpen && !e.target.closest(".tune-sys")) { T.sysOpen = false; render(); }
  });
  view.addEventListener("click", (e) => {
    const el = e.target.closest("[data-tune]");
    if (!el || el.disabled) return;
    const what = el.dataset.tune;
    if (what === "refresh") load();
    else if (what === "sys-toggle") openSystems(!T.sysOpen);
    else if (what === "sys") pickSystem(el.dataset.code);
    else if (what === "game") openGame(el.dataset.code, el.dataset.file);
    else if (what === "preset") applyPreset(el.dataset.preset);
    else if (what === "rec") { const r = recommendation(); if (r) applyPreset(r.preset, r.gov); }
    else if (what === "save") save();
    else if (what === "reset") reset();
    else if (what === "id") openGame(T.pick.code, T.pick.file, T.typedId);
  });
  view.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.tuneKey) { T.draft[t.dataset.tuneKey] = t.value; render(); }
    else if (t.dataset.tuneGov !== undefined) { T.gov = t.value; render(); }
  });
  view.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.tuneKey && t.tagName === "INPUT") { T.draft[t.dataset.tuneKey] = t.value; return; }
    if (t.dataset.tuneSysq !== undefined) {
      T.sysQ = t.value;
      T.sysHi = 0;
      refreshSystemList();
    } else if (t.dataset.tuneQ !== undefined) {
      T.q = t.value;
      const box = view.querySelector(".tune-results");
      if (box) box.innerHTML = results();
    } else if (t.dataset.tuneOptq !== undefined) {
      T.optQ = t.value;
      render();
    } else if (t.dataset.tuneId !== undefined) {
      T.typedId = t.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const btn = view.querySelector('[data-tune="id"]');
      if (btn) btn.disabled = !/^[A-Z]{4}\d{5}$/.test(T.typedId);
    }
  });
}
