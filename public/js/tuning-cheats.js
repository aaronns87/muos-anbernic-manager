// Cheats panel of Game Tuning: cheats from the libretro database or the game's file on the handheld, switched on per game.

import { api, esc, icon, toast } from "./core.js";
import { confirmBox } from "./art-images.js";

const C = {
  key: "", data: null, error: "", loading: false, emu: "",
  source: "", list: null, listLoading: false, listError: "",
  on: new Set(), start: new Set(), startSource: "", q: "", activate: true, saving: false, bound: false,
};
let redraw = () => {};

const keyOf = (g) => `${g.folder}/${g.file}/${g.discId || ""}`;
const noteText = (s) => s.replace(/^[\s_]+|[\s_]+$/g, "");
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/** Loads the game's cheats once per game (and disc ID); fresh reads the handheld again. */
export async function loadCheats(g, emu, fresh = false) {
  const key = keyOf(g);
  C.emu = emu;
  if (!fresh && C.key === key && (C.data || C.loading)) return;
  Object.assign(C, { key, data: null, error: "", loading: true, source: "", list: null, listError: "", q: "", activate: true });
  redraw();
  try {
    const d = await api(`cheats/game?${new URLSearchParams({ folder: g.folder, file: g.file, discId: g.discId || "" })}`);
    if (C.key !== key) return;
    C.data = d;
    C.loading = false;
    if (d.own) useOwn(true);
    else {
      C.start = new Set();
      C.startSource = "";
      if (d.candidates.length) await pickSource(d.candidates[0].path);
    }
  } catch (error) {
    if (C.key === key) C.error = error.message;
  }
  if (C.key === key) C.loading = false;
  redraw();
}

function useOwn(start) {
  C.source = "handheld";
  C.list = C.data.own;
  C.listError = "";
  C.on = new Set(C.list.flatMap((c, i) => (c.on && !c.note ? [i] : [])));
  if (start) { C.start = new Set(C.on); C.startSource = "handheld"; }
}

async function pickSource(source) {
  if (source === "handheld") { useOwn(false); refresh(); return; }
  const key = C.key;
  Object.assign(C, { source, list: null, listLoading: true, listError: "", on: new Set() });
  refresh();
  try {
    const { cheats } = await api(`cheats/file?${new URLSearchParams({ path: source })}`);
    if (C.key === key && C.source === source) C.list = cheats;
  } catch (error) {
    if (C.key === key) C.listError = error.message;
  }
  C.listLoading = false;
  refresh();
}

function dirty() {
  if (C.source !== C.startSource) return C.startSource ? true : C.on.size > 0;
  return !sameSet(C.on, C.start);
}

const needsActivate = () => !!C.data?.kind && !C.data.active;

// ---------------------------------------------------------------- rendering

function rows() {
  const q = C.q.trim().toLowerCase();
  const out = C.list.map((c, i) => [c, i]).filter(([c]) => !q || c.desc.toLowerCase().includes(q)).map(([c, i]) => c.note
    ? (noteText(c.desc) ? `<div class="cheat-note">${esc(noteText(c.desc))}</div>` : "")
    : `<label class="cheat-row${C.on.has(i) ? " on" : ""}"><input type="checkbox" data-cheat-i="${i}"${C.on.has(i) ? " checked" : ""}${C.saving ? " disabled" : ""}><span>${esc(c.desc)}</span></label>`).join("");
  return out || `<p class="muted-note">No cheat matches.</p>`;
}

function sourcePicker() {
  const d = C.data, own = d.own;
  const opts = [];
  if (own) opts.push(`<option value="handheld"${C.source === "handheld" ? " selected" : ""}>On the handheld: ${own.filter((c) => !c.note).length} cheats, ${own.filter((c) => c.on && !c.note).length} on</option>`);
  for (const c of d.candidates) opts.push(`<option value="${esc(c.path)}"${C.source === c.path ? " selected" : ""}>${esc(c.name)}</option>`);
  if (!opts.length) return "";
  return `<label class="cheat-source"><span>Cheats from</span><select class="control" data-cheat-src aria-label="Cheat file"${C.saving ? " disabled" : ""}>
    ${own && d.candidates.length ? `<optgroup label="This game">${opts[0]}</optgroup><optgroup label="libretro cheat database">${opts.slice(1).join("")}</optgroup>` : opts.join("")}
  </select></label>`;
}

function body() {
  if (C.loading) return `<div class="planning"><span class="spinner"></span> Looking for cheats&hellip;</div>`;
  if (C.error) return `<div class="notice err">${esc(C.error)}</div>`;
  const d = C.data;
  if (!d) return "";
  if (!d.kind) {
    return `<p class="muted-note">${esc(C.emu)} does not load cheat files. RetroArch cores and PPSSPP do: give the game a RetroArch core in
      <a href="#emulation">Emulation &rsaquo; Cores</a> to use cheats.</p>`;
  }
  if (d.kind === "ppsspp" && !d.discId) return `<p class="muted-note">PPSSPP files cheats under the game's disc ID. Type it above to see them.</p>`;
  const parts = [];
  if (!d.own && !d.candidates.length) {
    parts.push(`<p class="muted-note">${d.dbError ? esc(d.dbError) : "The libretro cheat database has no cheats for this game. It matches by the file name, so a No-Intro or Redump name (like <code>Super Mario World (USA)</code>) finds the most."}</p>`);
    return parts.join("");
  }
  parts.push(sourcePicker());
  if (C.source !== "handheld" && d.own) parts.push(`<div class="notice">Saving replaces the game's cheat file on the handheld with this one.</div>`);
  if (C.listLoading) parts.push(`<div class="planning"><span class="spinner"></span> Downloading the cheats&hellip;</div>`);
  else if (C.listError) parts.push(`<div class="notice err">${esc(C.listError)}</div>`);
  else if (C.list) {
    const count = C.list.filter((c) => !c.note).length;
    if (count > 10) parts.push(`<label class="search small cheat-filter">${icon("search")}<input type="search" data-cheat-q placeholder="Filter ${count} cheats" value="${esc(C.q)}" aria-label="Filter cheats"></label>`);
    parts.push(count ? `<div class="cheat-list">${rows()}</div>` : `<p class="muted-note">This file has no cheats to switch on.</p>`);
  }
  if (needsActivate()) {
    const what = d.kind === "retroarch"
      ? `Turn on <b>Apply cheats after game load</b> in RetroArch. It is off on your handheld, so saved cheats would wait in the Quick Menu until applied by hand. Games without cheats are not affected.`
      : `Turn on cheats in PPSSPP. They are off on your handheld, so saved cheats would do nothing.`;
    parts.push(`<label class="check cheat-activate"><input type="checkbox" data-cheat-activate${C.activate ? " checked" : ""}${C.saving ? " disabled" : ""}><span>${what}</span></label>`);
  }
  return parts.join("");
}

function footer() {
  const d = C.data;
  if (!d?.kind || C.loading || C.error || (d.kind === "ppsspp" && !d.discId) || (!d.own && !d.candidates.length)) return "";
  const can = dirty() || (needsActivate() && C.activate && C.on.size > 0);
  return `<div class="tune-actions cheat-actions">
    ${d.kind === "retroarch" && d.own ? `<button class="btn ghost" data-cheat="remove"${C.saving ? " disabled" : ""} title="Remove the game's cheat file from the handheld">${icon("trash")}<span>Remove cheats</span></button>` : ""}
    <span class="grow"></span>
    <span class="muted-note">${C.on.size} on${dirty() ? ", not saved" : ""}</span>
    <button class="btn primary" data-cheat="save"${can && !C.saving && C.list ? "" : " disabled"}>${C.saving ? `<span class="spinner sm"></span><span>Saving&hellip;</span>` : `${icon("check")}<span>Save cheats</span>`}</button>
  </div>`;
}

export function cheatsPanel() {
  if (!C.key) return "";
  return `<section class="panel tune-cheats">
    <h2>${icon("wand")}Cheats</h2>
    ${body()}
    ${C.data?.kind ? `<p class="muted-note">They apply the next time the game starts. Cheats can upset saves and game logic: switch them off again if a game misbehaves, and close the game on the handheld before saving.</p>` : ""}
    ${footer()}
  </section>`;
}

/** Redraws only the panel, keeping the list's scroll position. */
function refresh() {
  const el = document.querySelector(".tune-cheats");
  if (!el) { redraw(); return; }
  const scroll = el.querySelector(".cheat-list")?.scrollTop || 0;
  el.outerHTML = cheatsPanel();
  const list = document.querySelector(".tune-cheats .cheat-list");
  if (list) list.scrollTop = scroll;
}

// ---------------------------------------------------------------- actions

async function save() {
  const d = C.data;
  C.saving = true;
  refresh();
  try {
    await api("cheats/save", { folder: d.folder, file: d.file, discId: d.discId, source: C.source, on: [...C.on], activate: needsActivate() && C.activate });
    toast(`Cheats saved: ${C.on.size} on. They apply the next time the game starts.`, 3200);
    C.saving = false;
    await loadCheats(d, C.emu, true);
  } catch (error) {
    C.saving = false;
    toast(error.message, 4500);
    refresh();
  }
}

async function remove() {
  const d = C.data;
  const ok = await confirmBox({
    title: "Remove this game's cheats?",
    html: `<p>The game's cheat file is removed from the handheld, so no cheats load when it starts. You can add them again at any time.</p>`,
    ok: "Remove", danger: true,
  });
  if (!ok) return;
  C.saving = true;
  refresh();
  try {
    await api("cheats/remove", { folder: d.folder, file: d.file });
    toast("Cheats removed", 2400);
    C.saving = false;
    await loadCheats(d, C.emu, true);
  } catch (error) {
    C.saving = false;
    toast(error.message, 4500);
    refresh();
  }
}

export function bindCheats(view, rerender) {
  redraw = rerender;
  if (C.bound) return;
  C.bound = true;
  view.addEventListener("click", (e) => {
    const el = e.target.closest("[data-cheat]");
    if (!el || el.disabled) return;
    if (el.dataset.cheat === "save") save();
    else if (el.dataset.cheat === "remove") remove();
  });
  view.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.cheatI !== undefined) {
      const i = Number(t.dataset.cheatI);
      if (t.checked) C.on.add(i); else C.on.delete(i);
      refresh();
    } else if (t.dataset.cheatSrc !== undefined) {
      C.q = "";
      pickSource(t.value);
    } else if (t.dataset.cheatActivate !== undefined) {
      C.activate = t.checked;
      refresh();
    }
  });
  view.addEventListener("input", (e) => {
    if (e.target.dataset.cheatQ === undefined) return;
    C.q = e.target.value;
    const list = document.querySelector(".tune-cheats .cheat-list");
    if (list) list.innerHTML = rows();
  });
}
