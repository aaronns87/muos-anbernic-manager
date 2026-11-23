// Saves tab: back up the handheld's saves and save states over SSH, and put them back from a backup.
// On Andromeda, also list / create / download / restore .muxbak device backups in ARCHIVE.

import { $, api, esc, formatDate, formatTime, human, icon, plural, setKeepingScroll, store, toast } from "./core.js";
import { confirmBox } from "./art-images.js";
import { openViewerGame } from "./game-view.js";
import { conflictsBlockHtml, ensureConflicts } from "./sync-conflicts.js";

const S = {
  data: null, error: "", loading: false, work: "", open: "", contents: {}, picked: new Set(), wifi: undefined,
  muxbak: null, muxSections: null, muxDest: "SD1", muxMerge: true, muxPoll: 0,
  browse: {
    code: store.get("svGameCode", ""), file: store.get("svGameFile", ""), data: null, picked: new Set(),
    keep: Number(store.get("svKeepStates", 5)) || 5, loading: false,
  },
};
const KINDS = { file: "Saves", state: "Save states", drastic: "DraStic (NDS)", "drastic-legacy": "DraStic (NDS)", game: "Game data", pico8: "PICO-8" };

export function showSaves() {
  load();
  render();
}

export function renderSaves(wifi) {
  if (S.wifi !== undefined && wifi !== S.wifi && !S.loading) load();
  S.wifi = wifi;
  render();
}

async function load() {
  S.loading = true;
  render();
  try {
    const [saves, mux] = await Promise.all([api("saves"), api("muxbak").catch(() => null)]);
    S.data = saves;
    S.muxbak = mux;
    if (mux?.destinations?.length && !mux.destinations.includes(S.muxDest)) S.muxDest = mux.destinations[0];
    if (mux?.sections && S.muxSections === null) S.muxSections = new Set(mux.sections.map(([id]) => id));
    S.error = "";
    if (S.open && !S.data.backups.some((b) => b.name === S.open)) S.open = "";
    const newest = S.data.backups.find((b) => !b.error);
    if (newest) await contents(newest.name);
    if (mux?.creating || mux?.restoring?.running) pollMux();
  } catch (error) {
    S.error = error.message;
  }
  S.loading = false;
  render();
}

async function contents(name) {
  if (S.contents[name]) return S.contents[name];
  const { files } = await api(`saves/backup?name=${encodeURIComponent(name)}`);
  return (S.contents[name] = files);
}

// ---------------------------------------------------------------- helpers

const dev = () => S.data?.device;
const ready = () => !!dev()?.reachable && !S.work;
const when = (ms) => { const d = new Date(ms); return `${formatDate(d, "long")}, ${formatTime(d)}`; };
const label = (name) => (/-before-restore\.tar\.gz$/.test(name) ? "Before a restore" : "");

function parts(p) {
  const [, kind = "", ...rest] = p.split("/");
  return { kind, core: rest.length > 1 ? rest[0] : "", name: rest.length > 1 ? rest.slice(1).join("/") : rest.join("/") };
}

/** How a backed-up file compares with the handheld's copy. */
function compare(f, onDevice) {
  const d = onDevice.get(f.path);
  if (!d) return "missing";
  if (d.size === f.size && d.mtime === f.mtime) return "same";
  return d.mtime > f.mtime ? "newer" : "older";
}

const STATE = {
  same: ["", "Same as the handheld"],
  missing: ["", "Not on the handheld"],
  newer: [" warn", "Newer on the handheld"],
  older: ["", "Older on the handheld"],
};

const deviceMap = () => new Map((dev()?.files || []).map((f) => [f.path, f]));

function changedSince(files) {
  const backed = new Map(files.map((f) => [f.path, f]));
  return (dev()?.files || []).filter((f) => { const b = backed.get(f.path); return !b || b.size !== f.size || b.mtime !== f.mtime; }).length;
}

// ---------------------------------------------------------------- rendering

function render() {
  const root = $("emu-body");
  if (!root || $("view-emulation").hidden || !$("emu-tabs").querySelector('[data-tab="saves"].on')) return;
  const d = S.data;
  $("emu-actions").innerHTML = `
    <button class="btn" data-sv="refresh" title="Read the backups folder and the handheld again"${S.loading ? " disabled" : ""}>${icon("refresh")}<span>Refresh</span></button>
    ${d?.available ? `<button class="btn" data-sv="reveal">${icon("external")}<span>Show folder</span></button>` : ""}
    <button class="btn primary" data-sv="backup"${ready() && dev().files.length ? "" : ` disabled title="${esc(backupHint())}"`}>${S.work === "backup" ? `<span class="spinner sm"></span><span>Backing up&hellip;</span>` : `${icon("download")}<span>Back up now</span>`}</button>`;
  if (!d) {
    root.innerHTML = S.error ? `<div class="notice err">${esc(S.error)}</div>` : `<div class="planning"><span class="spinner"></span> Reading the backups and asking the handheld&hellip;</div>`;
    return;
  }
  const muxNote = S.muxbak?.supported ? " Device backups (.muxbak) use ARCHIVE on Andromeda." : "";
  $("emu-sub").textContent = `${plural(d.backups.length, "save backup")} on this computer (save games only).${muxNote}`;
  const locationOpen = root.querySelector(".sv-location")?.open;
  setKeepingScroll(root, `<details class="sv-location"${locationOpen ? " open" : ""}><summary>Backup folder</summary><code>${esc(d.folder)}</code><a href="#settings/folders">Change in Settings</a></details>${muxbakPanel()}${gameBrowsePanel()}<div class="apps-layout">${backupsPanel()}${devicePanel()}</div>`, ".sv-file-list");
}

function backupHint() {
  if (S.work) return "Wait for the current job to finish";
  if (!dev()?.reachable) return "Connect the handheld over Wi-Fi with SSH on";
  if (!dev().files.length) return "There are no saves on the handheld yet";
  return "";
}

function backupsPanel() {
  const list = S.data.backups;
  if (!list.length) {
    return `<section class="panel apps-main"><h2>${icon("save")}Backups</h2>
      <div class="empty-state apps-empty">${icon("save")}<p><b>No backups yet.</b> <b>Back up now</b> copies every save and save state from the handheld
        into a backup on this computer.</p></div></section>`;
  }
  const onDevice = deviceMap(), latest = list.find((b) => !b.error);
  const rows = list.map((b) => {
    const open = S.open === b.name, files = S.contents[b.name];
    const states = files && dev()?.reachable ? files.map((f) => compare(f, onDevice)) : null;
    const diff = !states ? -1 : states.every((s) => s === "missing") ? -2 : states.filter((s) => s !== "same").length;
    const chips = [
      b === latest ? `<span class="set-chip ok">${icon("check")}Latest</span>` : "",
      label(b.name) ? `<span class="set-chip">${label(b.name)}</span>` : "",
      diff === 0 ? `<span class="set-chip">Matches the handheld</span>` : diff === -2 ? `<span class="set-chip">Not on the handheld</span>` : diff > 0 ? `<span class="set-chip">${plural(diff, "file")} differ from the handheld</span>` : "",
    ].join("");
    return `<div class="sv-backup${open ? " open" : ""}">
      <div class="app-row">
        <span class="app-ico t-app">${icon("save")}</span>
        <div class="app-main">
          <b title="${esc(b.name)}">${esc(when(b.created))}</b>
          <small>${b.error ? `<span class="app-bad">${esc(b.error)}</span>` : `${plural(b.files, "file")} &middot; ${human(b.bytes)}${b.size < b.bytes * 0.8 ? ` (${human(b.size)} packed)` : ""}${b.newest ? ` &middot; newest save ${esc(formatDate(new Date(b.newest * 1000), "long"))}` : ""}`}</small>
          <div class="app-status">${chips}</div>
        </div>
        <div class="app-actions">
          ${b.error ? "" : `<button class="btn small ghost" data-sv="toggle" data-name="${esc(b.name)}" aria-expanded="${open}">${icon(open ? "down" : "right")}<span>Files</span></button>
          <button class="btn small${b === latest ? " primary" : ""}" data-sv="restore" data-name="${esc(b.name)}"${ready() ? "" : ` disabled title="${esc(S.work ? "Wait for the current job to finish" : "Connect the handheld over Wi-Fi with SSH on")}"`}>${S.work === "restore:" + b.name ? `<span class="spinner sm"></span><span>Restoring&hellip;</span>` : `${icon("restore")}<span>Restore</span>`}</button>`}
          <button class="btn icon small ghost" data-sv="trash" data-name="${esc(b.name)}" title="Move to the Trash" aria-label="Move ${esc(b.name)} to the Trash"${S.work ? " disabled" : ""}>${icon("trash")}</button>
        </div>
      </div>
      ${open ? fileList(b, files, onDevice) : ""}
    </div>`;
  }).join("");
  return `<section class="panel apps-main"><h2>${icon("save")}Save games <small>${list.length}</small></h2>
    <p class="muted-note">Tar.gz copies of saves and save states on this computer. Restoring puts those files back on the handheld; other files stay,
      and the handheld's current saves are backed up first.</p>
    <div class="app-list">${rows}</div></section>`;
}

function fileList(b, files, onDevice) {
  if (!files) return `<div class="sv-files"><div class="planning"><span class="spinner sm"></span> Reading the backup&hellip;</div></div>`;
  if (!files.length) return `<div class="sv-files"><p class="muted-note">This backup is empty.</p></div>`;
  const live = !!dev()?.reachable;
  const all = files.every((f) => S.picked.has(f.path));
  const rows = files.map((f) => {
    const p = parts(f.path), st = live ? compare(f, onDevice) : "";
    return `<label class="sv-file">
      <input type="checkbox" data-sv-pick="${esc(f.path)}"${S.picked.has(f.path) ? " checked" : ""}>
      <span class="sv-name"><b title="${esc(f.path)}">${esc(p.name)}</b><small>${esc([KINDS[p.kind] || p.kind, p.core].filter(Boolean).join(" \u00b7 "))}</small></span>
      <span class="sv-meta">${human(f.size)}<small>${esc(formatDate(new Date(f.mtime * 1000), "iso"))} ${esc(formatTime(new Date(f.mtime * 1000)))}</small></span>
      ${st ? `<span class="set-chip${STATE[st][0]}">${STATE[st][1]}</span>` : ""}
    </label>`;
  }).join("");
  const n = files.filter((f) => S.picked.has(f.path)).length;
  return `<div class="sv-files">
    <div class="sv-files-head"><span class="muted-note">${plural(files.length, "file")}${n ? `, ${n} selected` : ""}</span><span class="grow"></span>
      <button class="link-btn" data-sv="${all ? "none" : "all"}" data-name="${esc(b.name)}">${all ? "Select none" : "Select all"}</button>
      ${n ? `<button class="btn small primary" data-sv="restore-picked" data-name="${esc(b.name)}"${ready() ? "" : " disabled"}>${icon("restore")}<span>Restore ${n === 1 ? "it" : n}</span></button>` : ""}</div>
    <div class="sv-file-list">${rows}</div>
  </div>`;
}

function devicePanel() {
  const d = dev();
  if (d?.reachable) queueMicrotask(ensureConflicts);
  const head = `<h2>${icon("handheld")}On the handheld${d?.reachable ? ` <small>${esc(d.host)}</small>` : ""}<span class="grow"></span>
    ${S.loading ? `<span class="spinner sm"></span>` : ""}</h2>`;
  if (S.data.deviceError) return `<section class="panel apps-side">${head}<div class="notice err">${esc(S.data.deviceError)}</div>
    <div class="panel-actions"><button class="btn small" data-sv="refresh">${icon("refresh")}<span>Try again</span></button><button class="btn small ghost" data-connect="ssh">Connection settings</button></div></section>`;
  if (!d.reachable) {
    return `<section class="panel apps-side">${head}
      <p class="muted-note">Connect remote controls over Wi-Fi to back up and restore saves. Your existing backups remain available on this computer.</p>
      <div class="panel-actions"><button class="btn" data-connect="ssh">Set up remote controls</button></div></section>`;
  }
  if (!d.files.length) {
    return `<section class="panel apps-side">${head}
      <p class="muted-note">No saves yet. Save in a game, or make a save state from the RetroArch menu, and it shows up here.</p>
      ${conflictsBlockHtml()}</section>`;
  }
  const groups = new Map();
  for (const f of d.files) {
    const p = parts(f.path), key = p.core || KINDS[p.kind] || p.kind;
    const g = groups.get(key) || { saves: 0, states: 0, other: 0, newest: 0 };
    if (p.kind === "state") g.states++; else if (p.kind === "file") g.saves++; else g.other++;
    g.newest = Math.max(g.newest, f.mtime);
    groups.set(key, g);
  }
  const latest = S.data.backups.find((b) => !b.error);
  const changed = latest && S.contents[latest.name] ? changedSince(S.contents[latest.name]) : -1;
  const status = !latest ? `<div class="notice">Nothing is backed up yet.</div>`
    : changed > 0 ? `<div class="notice">${plural(changed, "file")} changed since the last backup.</div>`
    : changed === 0 ? `<p class="muted-note sv-ok">${icon("check")}Everything is in the last backup.</p>` : "";
  const bytes = d.files.reduce((s, f) => s + f.size, 0);
  return `<section class="panel apps-side">${head}
    ${d.frontend ? "" : `<div class="notice">A game is open on the handheld. Close it and go back to the menu before restoring.</div>`}
    <p class="muted-note">${plural(d.files.length, "file")} &middot; ${human(bytes)}</p>
    ${status}
    ${conflictsBlockHtml()}
    <div class="dev-apps">${[...groups].sort((a, b) => b[1].newest - a[1].newest).map(([name, g]) => `<div class="dev-app">
      <div><b>${esc(name)}</b><small>${[g.saves && plural(g.saves, "save"), g.states && plural(g.states, "state"), g.other && plural(g.other, "file")].filter(Boolean).join(" \u00b7 ")}
        &middot; ${esc(formatDate(new Date(g.newest * 1000), "long"))}</small></div></div>`).join("")}</div>
    <p class="muted-note">Use <b>Save browser</b> above to work with one game&rsquo;s files; this summary is every save on the device.</p>
  </section>`;
}

// ---------------------------------------------------------------- per-game save browser

function saveKind(path) {
  if (/\.png$/i.test(path)) return "screenshot";
  if (/(^|\/)state\//.test(path)) return "state";
  return "save";
}

function gameBrowsePanel() {
  const b = S.browse, d = dev(), busy = S.work.startsWith("game-") || b.loading;
  const picked = b.data?.files?.filter((f) => b.picked.has(f.path)).length || 0;
  const form = `<div class="sv-game-pick">
      <label class="field"><span>System</span><input class="control" data-sv="game-code" value="${esc(b.code)}" placeholder="PS" autocomplete="off"${busy ? " disabled" : ""}></label>
      <label class="field"><span>ROM file</span><input class="control" data-sv="game-file" value="${esc(b.file)}" placeholder="Final Fantasy VII (Disc 1).chd" autocomplete="off"${busy ? " disabled" : ""}></label>
      <button class="btn small primary" data-sv="game-load"${busy || !b.code || !b.file ? " disabled" : ""}>${b.loading ? `<span class="spinner sm"></span>` : icon("search")}<span>Load</span></button>
      <button class="btn small ghost" data-sv="game-viewer"${busy ? " disabled" : ""}>${icon("layers")}<span>Use open game</span></button>
    </div>`;
  let body = `<p class="muted-note">List .srm and save states for one game over SSH. Pull copies into <code>backups/saves-pulled/</code>; push puts them back. Full-device tar.gz backups above are unchanged.</p>${form}`;
  if (!d?.reachable && !b.data) {
    body += `<p class="muted-note">Connect the handheld over Wi-Fi with SSH on to browse saves per game.</p>`;
    return `<section class="panel sv-game-panel">${body}</section>`;
  }
  if (b.data?.error) body += `<div class="notice err">${esc(b.data.error)}</div>`;
  else if (b.data && !b.data.files.length) body += `<p class="muted-note">No save files on the handheld for this ROM yet.</p>`;
  else if (b.data?.files?.length) {
    const rows = [...b.data.files].sort((a, b) => b.mtime - a.mtime).map((f) => {
      const p = parts(f.path), kind = saveKind(f.path);
      const pulled = b.data.pulled?.find((x) => x.path === f.path)?.local;
      return `<label class="sv-file">
        <input type="checkbox" data-sv-game-pick="${esc(f.path)}"${b.picked.has(f.path) ? " checked" : ""}>
        <span class="sv-name"><b title="${esc(f.path)}">${esc(p.name)}</b><small>${kind === "screenshot" ? "State picture" : kind === "state" ? "Save state" : "Save"} &middot; ${esc([KINDS[p.kind] || p.kind, p.core].filter(Boolean).join(" \u00b7 "))}</small></span>
        <span class="sv-meta">${human(f.size)}<small>${esc(formatDate(new Date(f.mtime * 1000), "iso"))}</small></span>
        ${pulled ? `<span class="set-chip ok">${icon("check")}Pulled</span>` : ""}
      </label>`;
    }).join("");
    body += `<div class="sv-files"><div class="sv-files-head"><span class="muted-note">${plural(b.data.files.length, "file")}${picked ? `, ${picked} selected` : ""}</span>
        <span class="grow"></span>
        <label class="field inline"><span>Keep states</span><input class="control sv-keep" type="number" min="1" max="99" data-sv="game-keep" value="${b.keep}"${busy ? " disabled" : ""}></label>
        <button class="btn small" data-sv="game-pull"${picked && !busy ? "" : " disabled"}>${icon("download")}<span>Pull</span></button>
        <button class="btn small" data-sv="game-push"${picked && !busy ? "" : " disabled"}>${icon("upload")}<span>Push</span></button>
        <button class="btn small danger" data-sv="game-delete"${picked && !busy ? "" : " disabled"}>${icon("trash")}<span>Delete</span></button>
        <button class="btn small" data-sv="game-prune"${!busy && b.data.files.some((f) => saveKind(f.path) === "state") ? "" : " disabled"}>${icon("wrench")}<span>Prune states</span></button>
        <button class="link-btn" data-sv="reveal-pulled">Show pulled folder</button>
      </div><div class="sv-file-list">${rows}</div></div>`;
  }
  return `<section class="panel sv-game-panel"><h2>${icon("game")}Save browser</h2>${body}</section>`;
}

async function loadGameBrowse(fromViewer = false) {
  if (fromViewer) {
    const g = openViewerGame();
    if (!g) { toast("Open a game in Games first", 3000); return; }
    S.browse.code = g.code;
    S.browse.file = g.file;
    store.set("svGameCode", g.code);
    store.set("svGameFile", g.file);
  } else {
    const code = document.querySelector("[data-sv='game-code']")?.value?.trim() || S.browse.code;
    const file = document.querySelector("[data-sv='game-file']")?.value?.trim() || S.browse.file;
    if (!code || !file) { toast("Enter the system folder and ROM file name", 3000); return; }
    S.browse.code = code;
    S.browse.file = file;
    store.set("svGameCode", code);
    store.set("svGameFile", file);
  }
  S.browse.loading = true;
  S.browse.picked.clear();
  render();
  try {
    S.browse.data = await api(`saves/game?code=${encodeURIComponent(S.browse.code)}&file=${encodeURIComponent(S.browse.file)}`);
  } catch (error) {
    S.browse.data = { error: error.message, files: [] };
  }
  S.browse.loading = false;
  render();
}

async function gamePathsAction(kind) {
  const b = S.browse;
  const paths = [...b.picked];
  if (!paths.length && kind !== "prune") return;
  const body = { code: b.code, file: b.file, paths };
  if (kind === "delete") {
    const ok = await confirmBox({
      title: paths.length === 1 ? "Delete this save file?" : `Delete ${paths.length} save files?`,
      html: `<p>Removes them from the handheld permanently. Pull them first if you want a copy on this computer.</p>`,
      ok: "Delete on handheld", danger: true,
    });
    if (!ok) return;
  } else if (kind === "prune") {
    const states = b.data?.files?.filter((f) => saveKind(f.path) === "state").length || 0;
    const ok = await confirmBox({
      title: "Prune old save states?",
      html: `<p>Keeps the <b>${b.keep}</b> newest save states for this game and deletes older ones on the handheld.</p>
        <p class="muted-note">${states} state file${states === 1 ? "" : "s"} listed now.</p>`,
      ok: "Prune", danger: true,
    });
    if (!ok) return;
  }
  S.work = `game-${kind}`;
  render();
  try {
    const route = { pull: "saves/game/pull", push: "saves/game/push", delete: "saves/game/delete", prune: "saves/game/prune" }[kind];
    const payload = kind === "prune" ? { code: b.code, file: b.file, keep: b.keep } : body;
    const res = await api(route, payload);
    b.data = res;
    if (kind !== "prune") b.picked.clear();
    const msg = { pull: "Pulled to backups", push: "Pushed to handheld", delete: "Deleted on handheld", prune: `Pruned${res.pruned ? ` (${res.pruned} removed)` : ""}` }[kind];
    toast(msg, 2800);
    if (kind === "delete" || kind === "prune") {
      S.data = await api("saves");
    }
  } catch (error) {
    toast(error.message, 4500);
  }
  S.work = "";
  render();
}

// ---------------------------------------------------------------- Andromeda .muxbak

function muxbakPanel() {
  const m = S.muxbak;
  if (!m?.supported) return "";
  const busy = S.work.startsWith("mux") || m.creating || m.restoring?.running;
  const destOpts = (m.destinations || []).map((d) => `<option value="${esc(d)}"${d === S.muxDest ? " selected" : ""}>${d === "SD2" ? "SD2 (TF2)" : d}</option>`).join("");
  const sections = (m.sections || []).map(([id, label]) => {
    const on = S.muxSections?.has(id);
    return `<label class="sv-file mux-sec"><input type="checkbox" data-mux-sec="${esc(id)}"${on ? " checked" : ""}><span class="sv-name"><b>${esc(label)}</b></span></label>`;
  }).join("");
  const rows = (m.files || []).map((f) => `<div class="app-row">
      <span class="app-ico t-app">${icon("package")}</span>
      <div class="app-main">
        <b title="${esc(f.path)}">${esc(f.name)}</b>
        <small>${human(f.size)} &middot; ${esc(f.storage || "?")} &middot; ${esc(when(f.mtime * 1000))}</small>
      </div>
      <div class="app-actions">
        <button class="btn small" data-sv="mux-dl" data-path="${esc(f.path)}"${busy ? " disabled" : ""}>${S.work === "mux-dl:" + f.path ? `<span class="spinner sm"></span>` : icon("download")}<span>Download</span></button>
        <button class="btn small" data-sv="mux-restore" data-path="${esc(f.path)}"${busy ? " disabled" : ""}>${S.work === "mux-restore:" + f.path ? `<span class="spinner sm"></span><span>Restoring&hellip;</span>` : `${icon("restore")}<span>Restore</span>`}</button>
      </div>
    </div>`).join("");
  const status = m.creating || S.work === "mux-create" ? `<div class="notice"><span class="spinner sm"></span> Creating device backup on the handheld&hellip;</div>`
    : m.restoring?.running || S.work.startsWith("mux-restore") ? `<div class="notice"><span class="spinner sm"></span> Restoring ${esc(m.restoring?.name || "backup")} on the handheld&hellip;</div>` : "";
  return `<section class="panel" style="margin-bottom:1rem">
    <h2>${icon("package")}Device backups <small>.muxbak</small></h2>
    <p class="muted-note">Andromeda backups live in <code>ARCHIVE</code> on the handheld (same as Archive Manager). Restoring replaces the matching sections on the device.
      Save-game tar.gz backups below stay on this computer and only cover saves.</p>
    ${status}
    <div class="mux-create" style="margin:0.75rem 0">
      <div class="sub-head">Create on the handheld</div>
      <label class="field"><span>Destination</span>
        <select class="control" data-sv="mux-dest"${busy ? " disabled" : ""}>${destOpts || `<option value="SD1">SD1</option>`}</select></label>
      <label class="field" style="margin-top:0.4rem"><span><input type="checkbox" data-sv="mux-merge"${S.muxMerge ? " checked" : ""}${busy ? " disabled" : ""}> One merged .muxbak</span></label>
      <div class="sv-file-list" style="max-height:12rem;margin:0.5rem 0">${sections}</div>
      <button class="btn primary" data-sv="mux-create"${busy ? " disabled" : ""}>${S.work === "mux-create" ? `<span class="spinner sm"></span><span>Starting&hellip;</span>` : `${icon("download")}<span>Create .muxbak</span>`}</button>
    </div>
    <div class="app-list">${rows || `<p class="muted-note">No .muxbak files in ARCHIVE yet.</p>`}</div>
  </section>`;
}

function pollMux() {
  clearTimeout(S.muxPoll);
  S.muxPoll = setTimeout(async () => {
    try {
      const m = await api("muxbak");
      S.muxbak = m;
      render();
      if (m.creating || m.restoring?.running) pollMux();
      else if (S.work.startsWith("mux")) { S.work = ""; render(); }
    } catch { /* keep last */ }
  }, 2000);
}

async function muxCreate() {
  const sections = [...(S.muxSections || [])];
  if (!sections.length) { toast("Pick at least one section", 3000); return; }
  const ok = await confirmBox({
    title: "Create a device backup?",
    html: `<p>Runs MustardOS Backup on the handheld and writes a <code>.muxbak</code> into <code>ARCHIVE</code> on <b>${esc(S.muxDest === "SD2" ? "SD2 (TF2)" : S.muxDest)}</b>.
      The menu may close briefly while it runs.</p>
      <p>${plural(sections.length, "section")}${S.muxMerge ? ", merged into one file" : ", one file each"}.</p>`,
    ok: "Create backup",
  });
  if (!ok) return;
  S.work = "mux-create";
  render();
  try {
    await api("muxbak/create", { destination: S.muxDest, merge: S.muxMerge, sections });
    toast("Backup started on the handheld", 2600);
    pollMux();
  } catch (error) {
    toast(error.message, 4500);
    S.work = "";
  }
  render();
}

async function muxDownload(filePath) {
  S.work = "mux-dl:" + filePath;
  render();
  try {
    const r = await api("muxbak/download", { path: filePath });
    toast(`Downloaded ${r.name}`, 2600);
  } catch (error) {
    toast(error.message, 4500);
  }
  S.work = "";
  render();
}

async function muxRestore(filePath) {
  const name = filePath.split("/").pop();
  const ok = await confirmBox({
    title: "Restore this device backup?",
    html: `<p>Restores <b>${esc(name)}</b> through Archive Manager on the handheld. Matching sections on the device are <b>replaced</b>.
      This is not the same as restoring a save-game tar.gz on this computer.</p>`,
    ok: "Restore on handheld", danger: true,
  });
  if (!ok) return;
  S.work = "mux-restore:" + filePath;
  render();
  try {
    await api("muxbak/restore", { path: filePath });
    toast("Restore started on the handheld", 2600);
    pollMux();
  } catch (error) {
    toast(error.message, 4500);
    S.work = "";
  }
  render();
}

// ---------------------------------------------------------------- actions

async function backup() {
  S.work = "backup";
  render();
  try {
    const r = await api("saves/backup", {});
    S.data = r;
    await contents(r.name);
    toast("Saves backed up", 2400);
  } catch (error) {
    toast(error.message, 4000);
  }
  S.work = "";
  render();
}

async function restore(name, only) {
  let files;
  try { files = await contents(name); } catch (error) { toast(error.message, 3500); return; }
  const chosen = only ? files.filter((f) => S.picked.has(f.path)) : files;
  const onDevice = deviceMap();
  const newer = chosen.filter((f) => compare(f, onDevice) === "newer");
  const b = S.data.backups.find((x) => x.name === name);
  const ok = await confirmBox({
    title: only ? `Restore ${plural(chosen.length, "file")}?` : "Restore this backup?",
    html: `<p>Puts ${only ? "the selected files" : `all ${plural(chosen.length, "file")}`} from the backup of <b>${esc(when(b.created))}</b> back on the handheld.
        Files on the handheld that are not in it stay.</p>
      ${newer.length ? `<p><b>${plural(newer.length, "file")} on the handheld ${newer.length === 1 ? "is" : "are"} newer</b> than in the backup; the newer progress is replaced.</p>` : ""}
      ${dev().files.length ? `<p>The handheld's current saves are backed up first, so you can go back.</p>` : ""}
      ${only && chosen.length <= 8 ? `<ul>${chosen.map((f) => `<li>${esc(parts(f.path).name)}</li>`).join("")}</ul>` : ""}`,
    ok: "Restore", danger: newer.length > 0,
  });
  if (!ok) return;
  S.work = "restore:" + name;
  render();
  try {
    const r = await api("saves/restore", only ? { name, files: chosen.map((f) => f.path) } : { name });
    S.data = r;
    S.picked.clear();
    toast(`Restored ${plural(r.restored, "file")}`, 2600);
  } catch (error) {
    toast(error.message, 4500);
  }
  S.work = "";
  render();
}

async function trash(name) {
  const b = S.data.backups.find((x) => x.name === name);
  const ok = await confirmBox({ title: "Move this backup to the Trash?", html: `<p>The backup of <b>${esc(when(b.created))}</b> leaves the backups folder. The handheld is not touched.</p>`, ok: "Move to Trash", danger: true });
  if (!ok) return;
  try {
    S.data = await api("saves/trash", { name });
    delete S.contents[name];
    if (S.open === name) { S.open = ""; S.picked.clear(); }
    toast("Moved to the Trash");
  } catch (error) {
    toast(error.message, 3500);
  }
  render();
}

async function toggle(name) {
  S.picked.clear();
  S.open = S.open === name ? "" : name;
  render();
  if (!S.open) return;
  try { await contents(name); } catch (error) { toast(error.message, 3500); S.open = ""; }
  render();
}

export function bindSaves(view) {
  view.addEventListener("click", (e) => {
    const el = e.target.closest("[data-sv]");
    if (!el || el.disabled) return;
    const { sv, name, path: filePath } = el.dataset;
    if (sv === "refresh") load();
    else if (sv === "reveal") api("settings/reveal", { which: "backups" }).catch((error) => toast(error.message, 3000));
    else if (sv === "backup") backup();
    else if (sv === "toggle") toggle(name);
    else if (sv === "restore") restore(name, false);
    else if (sv === "restore-picked") restore(name, true);
    else if (sv === "trash") trash(name);
    else if (sv === "all") { for (const f of S.contents[name] || []) S.picked.add(f.path); render(); }
    else if (sv === "none") { S.picked.clear(); render(); }
    else if (sv === "mux-create") muxCreate();
    else if (sv === "mux-dl") muxDownload(filePath);
    else if (sv === "mux-restore") muxRestore(filePath);
    else if (sv === "reveal-pulled") api("saves/game/reveal-pulled", {}).catch((error) => toast(error.message, 3000));
    else if (sv === "game-load") loadGameBrowse(false);
    else if (sv === "game-viewer") loadGameBrowse(true);
    else if (sv === "game-pull") gamePathsAction("pull");
    else if (sv === "game-push") gamePathsAction("push");
    else if (sv === "game-delete") gamePathsAction("delete");
    else if (sv === "game-prune") gamePathsAction("prune");
  });
  view.addEventListener("change", (e) => {
    const t = e.target;
    const gp = t.dataset?.svGamePick;
    if (gp !== undefined) {
      if (t.checked) S.browse.picked.add(gp); else S.browse.picked.delete(gp);
      render();
      return;
    }
    if (t.dataset?.sv === "game-keep") {
      S.browse.keep = Math.max(1, Math.min(99, Number(t.value) || 5));
      store.set("svKeepStates", S.browse.keep);
      return;
    }
    const p = t.dataset?.svPick;
    if (p !== undefined) {
      if (t.checked) S.picked.add(p); else S.picked.delete(p);
      render();
      return;
    }
    const sec = t.dataset?.muxSec;
    if (sec !== undefined) {
      if (!S.muxSections) S.muxSections = new Set();
      if (t.checked) S.muxSections.add(sec); else S.muxSections.delete(sec);
      return;
    }
    if (t.dataset?.sv === "mux-dest") { S.muxDest = t.value; return; }
    if (t.dataset?.sv === "mux-merge") { S.muxMerge = t.checked; }
  });
}
