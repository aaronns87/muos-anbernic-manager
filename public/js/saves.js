// Saves tab: back up the handheld's saves and save states over SSH, and put them back from a backup.

import { $, api, esc, formatDate, formatTime, human, icon, plural, toast } from "./core.js";
import { confirmBox } from "./art-images.js";

const S = { data: null, error: "", loading: false, work: "", open: "", contents: {}, picked: new Set(), wifi: undefined };
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
    S.data = await api("saves");
    S.error = "";
    if (S.open && !S.data.backups.some((b) => b.name === S.open)) S.open = "";
    const newest = S.data.backups.find((b) => !b.error);
    if (newest) await contents(newest.name);
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
  $("emu-sub").innerHTML = `${plural(d.backups.length, "save backup")} in <code title="${esc(d.folder)}">${esc(d.folder)}</code> &middot; change it in Settings`;
  root.innerHTML = `<div class="apps-layout">${backupsPanel()}${devicePanel()}</div>`;
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
        into one file in <code>${esc(S.data.folder)}</code>.</p></div></section>`;
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
  return `<section class="panel apps-main"><h2>${icon("save")}Backups <small>${list.length}</small></h2>
    <p class="muted-note">Restoring puts a backup's files back on the handheld. Files that are not in the backup stay as they are, and the handheld's
      current saves are backed up first.</p>
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
  const head = `<h2>${icon("handheld")}On the handheld${d?.reachable ? ` <small>${esc(d.host)}</small>` : ""}<span class="grow"></span>
    ${S.loading ? `<span class="spinner sm"></span>` : ""}</h2>`;
  if (S.data.deviceError) return `<section class="panel apps-side">${head}<div class="notice err">${esc(S.data.deviceError)}</div>
    <div class="panel-actions"><button class="btn small" data-sv="refresh">${icon("refresh")}<span>Try again</span></button><a class="btn small ghost" href="#ssh">SSH settings</a></div></section>`;
  if (!d.reachable) {
    return `<section class="panel apps-side">${head}
      <div class="notice">Backing up and restoring saves needs SSH over Wi-Fi. On the handheld turn on <b>Configuration &rsaquo; Web Services &rsaquo; Secure Shell</b>, then check the <a href="#ssh">SSH</a> section.</div></section>`;
  }
  if (!d.files.length) {
    return `<section class="panel apps-side">${head}
      <p class="muted-note">No saves yet. Save in a game, or make a save state from the RetroArch menu, and it shows up here.</p></section>`;
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
    <div class="dev-apps">${[...groups].sort((a, b) => b[1].newest - a[1].newest).map(([name, g]) => `<div class="dev-app">
      <div><b>${esc(name)}</b><small>${[g.saves && plural(g.saves, "save"), g.states && plural(g.states, "state"), g.other && plural(g.other, "file")].filter(Boolean).join(" \u00b7 ")}
        &middot; ${esc(formatDate(new Date(g.newest * 1000), "long"))}</small></div></div>`).join("")}</div>
  </section>`;
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
    const { sv, name } = el.dataset;
    if (sv === "refresh") load();
    else if (sv === "reveal") api("settings/reveal", { which: "backups" }).catch((error) => toast(error.message, 3000));
    else if (sv === "backup") backup();
    else if (sv === "toggle") toggle(name);
    else if (sv === "restore") restore(name, false);
    else if (sv === "restore-picked") restore(name, true);
    else if (sv === "trash") trash(name);
    else if (sv === "all") { for (const f of S.contents[name] || []) S.picked.add(f.path); render(); }
    else if (sv === "none") { S.picked.clear(); render(); }
  });
  view.addEventListener("change", (e) => {
    const p = e.target.dataset?.svPick;
    if (p === undefined) return;
    if (e.target.checked) S.picked.add(p); else S.picked.delete(p);
    render();
  });
}
