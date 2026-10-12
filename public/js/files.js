// Files: this computer and the handheld side by side. Browse, copy between them, rename, delete, preview and edit.

import { $, api, app, esc, formatDate, human, icon, plural, toast, TOKEN } from "./core.js";
import { confirmBox } from "./art-images.js";
import { jobStarted } from "./copy.js";

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const TEXT = new Set(["txt", "ini", "cfg", "conf", "json", "log", "xml", "opt", "rac", "gov", "con", "md", "yml", "yaml", "sh", "lua", "csv",
  "dat", "m3u", "cue", "glslp", "slangp", "info", "nfo"]);
const SIDES = { local: "This computer", device: "Handheld" };

const pane = () => ({ root: "", path: [], entries: null, loading: false, error: "", sel: new Set() });
const F = { roots: null, volume: "", local: pane(), device: pane(), busy: false, bound: false, view: null };

const ext = (n) => (n.includes(".") ? n.split(".").pop().toLowerCase() : "");
const kindOf = (e) => (e.folder ? "folder" : IMAGE.has(ext(e.name)) ? "image" : TEXT.has(ext(e.name)) || !ext(e.name) ? "text" : "");
const volume = () => app.device.target?.id || "";
const other = (side) => (side === "local" ? "device" : "local");
const query = (side, extra = {}) => new URLSearchParams({ side, root: F[side].root, path: F[side].path.join("/"), volume: volume(), ...extra }).toString();
/** MustardOS's own files on SD1; changing them can stop the handheld from starting. */
const system = (side, names = []) => side === "device" && F.device.root === "SD1" && (F.device.path[0]?.toUpperCase() === "MUOS" || (!F.device.path.length && names.some((n) => n.toUpperCase() === "MUOS")));
const canRename = () => !!F.roots?.device.find((r) => r.id === F.device.root)?.rename;
const where = (side) => `${side === "local" ? F.roots?.local.find((r) => r.id === F.local.root)?.label || "" : F.device.root}/${F[side].path.join("/")}`;

export function showFiles() {
  if (!F.bound) bind();
  if (!F.roots || F.volume !== volume()) return loadRoots();
  load("local");
  if (F.device.root) load("device");
}

/** Redraws when the connection changes. */
export function renderFiles() {
  if ($("view-files").hidden) return;
  if (F.volume !== volume()) loadRoots();
  else render();
}

async function loadRoots() {
  F.volume = volume();
  F.device = pane();
  render();
  try {
    F.roots = await api(`files/roots?volume=${encodeURIComponent(F.volume)}`);
  } catch (error) {
    toast(error.message, 4000);
    return;
  }
  if (!F.roots.local.some((r) => r.id === F.local.root)) { F.local = pane(); F.local.root = F.roots.local[0]?.id || ""; }
  F.device.root = F.roots.device.find((r) => r.id === "TF2")?.id || F.roots.device[0]?.id || "";
  load("local");
  if (F.device.root) load("device");
  else render();
}

async function load(side) {
  const p = F[side];
  if (!p.root) return;
  p.loading = true;
  render();
  try {
    p.entries = (await api(`files/list?${query(side)}`)).entries;
    p.error = "";
    const names = new Set(p.entries.map((e) => e.name));
    for (const n of [...p.sel]) if (!names.has(n)) p.sel.delete(n);
  } catch (error) {
    p.entries = null;
    p.error = error.message;
  }
  p.loading = false;
  render();
}

function go(side, path) {
  const p = F[side];
  p.path = path;
  p.sel.clear();
  load(side);
}

// ---------------------------------------------------------------- rendering

function render() {
  const root = $("files");
  if (!root || $("view-files").hidden) return;
  if (!F.roots) { root.innerHTML = `<div class="planning"><span class="spinner"></span> Reading folders&hellip;</div>`; return; }
  root.innerHTML = `<div class="fx">${paneHtml("local")}${paneHtml("device")}</div>`;
}

function paneHtml(side) {
  const p = F[side], roots = side === "local" ? F.roots.local : F.roots.device;
  const head = `<div class="fx-head">
    <h2>${icon(side === "local" ? "folder" : "handheld")}${SIDES[side]}</h2>
    ${roots.length ? `<select class="control fx-root" data-fx-root="${side}" aria-label="${SIDES[side]} location">${roots.map((r) =>
      `<option value="${esc(r.id)}"${r.id === p.root ? " selected" : ""}${r.dir ? ` title="${esc(r.dir)}"` : ""}>${esc(r.label)}</option>`).join("")}</select>` : ""}
  </div>`;
  if (side === "device" && !roots.length) {
    const why = F.roots.deviceError || (volume() ? "The handheld shows no storage." : "Connect the handheld over USB or Wi-Fi, or put a card in a card reader.");
    return `<section class="panel fx-pane" data-side="device">${head}<div class="fx-empty"><div class="notice">${esc(why)}</div><a class="btn small" href="#overview">Connection</a></div></section>`;
  }
  const n = p.sel.size, busy = F.busy || p.loading;
  const tools = `<div class="fx-tools">
    <button class="btn icon small" data-fx="up" data-side="${side}" title="Up one folder"${p.path.length && !busy ? "" : " disabled"}>${icon("down", "fx-up")}</button>
    <button class="btn icon small" data-fx="refresh" data-side="${side}" title="Read the folder again"${busy ? " disabled" : ""}>${icon("refresh")}</button>
    <button class="btn icon small" data-fx="mkdir" data-side="${side}" title="New folder"${busy ? " disabled" : ""}>${icon("plus")}</button>
    <button class="btn icon small" data-fx="rename" data-side="${side}" title="${side === "device" && !canRename() ? "Renaming is not possible over USB" : "Rename"}"${n === 1 && !busy && (side === "local" || canRename()) ? "" : " disabled"}>${icon("file")}</button>
    <button class="btn icon small danger" data-fx="delete" data-side="${side}" title="${side === "local" ? "Move to the Trash" : "Delete from the handheld"}"${n && !busy ? "" : " disabled"}>${icon("trash")}</button>
    <span class="grow"></span>
    <button class="btn small${n ? " primary" : ""}" data-fx="copy" data-side="${side}"${n && !busy && F.roots.device.length && F[other(side)].root ? "" : " disabled"}>
      ${side === "local" ? `<span>Copy to handheld</span>${icon("arrow")}` : `${icon("arrow", "fx-back")}<span>Copy to computer</span>`}</button>
  </div>`;
  const label = roots.find((r) => r.id === p.root)?.label || p.root;
  const crumbs = `<nav class="fx-crumbs" aria-label="Folder">${[label, ...p.path].map((part, i) =>
    i === p.path.length ? `<b>${esc(part)}</b>` : `<button class="link-btn" data-fx="crumb" data-side="${side}" data-depth="${i}">${esc(part)}</button>`).join(`<span>/</span>`)}</nav>`;
  let list;
  if (p.error) list = `<div class="fx-empty"><div class="notice err">${esc(p.error)}</div></div>`;
  else if (!p.entries) list = `<div class="planning"><span class="spinner"></span> Reading&hellip;</div>`;
  else if (!p.entries.length) list = `<div class="fx-empty muted-note">This folder is empty.</div>`;
  else list = p.entries.map((e) => row(side, e)).join("");
  const all = p.entries?.length && n === p.entries.length;
  const foot = p.entries ? `<div class="fx-foot">
    <label class="fx-all"><input type="checkbox" data-fx="all" data-side="${side}"${all ? " checked" : ""}${p.entries.length ? "" : " disabled"}> ${n ? `${n} of ${plural(p.entries.length, "item")} picked` : plural(p.entries.length, "item")}</label>
    ${p.loading ? `<span class="spinner sm"></span>` : ""}
    ${system(side) ? `<span class="fx-warn">${icon("alert")}MustardOS's own files</span>` : ""}
  </div>` : "";
  return `<section class="panel fx-pane" data-side="${side}">${head}${crumbs}${tools}<div class="fx-list" role="list">${list}</div>${foot}</section>`;
}

function row(side, e) {
  const on = F[side].sel.has(e.name), kind = kindOf(e);
  const ico = icon(kind === "folder" ? "folder" : kind === "image" ? "image" : "file");
  const name = e.folder || kind
    ? `<button class="fx-name" data-fx="open" title="${e.folder ? "Open" : "Preview"} ${esc(e.name)}">${ico}<span>${esc(e.name)}</span></button>`
    : `<span class="fx-name plain" title="${esc(e.name)}">${ico}<span>${esc(e.name)}</span></span>`;
  const date = e.mtime ? formatDate(new Date(e.mtime * 1000), "iso") : "";
  return `<div class="fx-row${on ? " on" : ""}${e.folder ? " dir" : ""}" role="listitem" data-name="${esc(e.name)}" data-side="${side}">
    <input type="checkbox" data-fx="pick" aria-label="Pick ${esc(e.name)}"${on ? " checked" : ""}>
    ${name}
    <span class="fx-size">${e.folder ? "" : human(e.size)}</span>
    <span class="fx-date">${date}</span>
  </div>`;
}

// ---------------------------------------------------------------- actions

async function askName(title, value, ok) {
  const answer = confirmBox({ title, html: `<input class="control fx-input" id="fx-name" value="${esc(value)}" spellcheck="false" autocomplete="off">`, ok });
  const input = $("fx-name");
  input.focus();
  const dot = value.lastIndexOf(".");
  input.setSelectionRange(0, dot > 0 ? dot : value.length);
  input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("c-ok").click(); } };
  return (await answer) ? input.value.trim() : "";
}

async function run(fn) {
  F.busy = true;
  render();
  try { await fn(); } catch (error) { toast(error.message, 4500); }
  F.busy = false;
  render();
}

const body = (side, extra) => ({ side, root: F[side].root, path: F[side].path.join("/"), volume: volume(), ...extra });

async function mkdir(side) {
  const name = await askName("New folder", "", "Create");
  if (!name) return;
  await run(async () => {
    await api("files/mkdir", body(side, { name }));
    await load(side);
    toast(`Created ${name}`);
  });
}

async function rename(side) {
  const [from] = F[side].sel;
  const to = await askName(`Rename ${from}`, from, "Rename");
  if (!to || to === from) return;
  if (system(side, [from]) && !(await confirmBox({ title: "Rename a MustardOS file?", html: `<p>${esc(from)} belongs to MustardOS. Renaming it can stop the handheld from starting or break a feature.</p>`, ok: "Rename anyway", danger: true }))) return;
  await run(async () => {
    await api("files/rename", body(side, { from, to }));
    F[side].sel = new Set([to]);
    await load(side);
    toast(`Renamed to ${to}`);
  });
}

async function remove(side) {
  const names = [...F[side].sel], local = side === "local";
  const what = names.length === 1 ? esc(names[0]) : plural(names.length, "item");
  const folders = F[side].entries.filter((e) => e.folder && F[side].sel.has(e.name)).length;
  const ok = await confirmBox({
    title: local ? `Move ${names.length === 1 ? names[0] : plural(names.length, "item")} to the Trash?` : `Delete ${names.length === 1 ? names[0] : plural(names.length, "item")} from the handheld?`,
    html: `<p>${local ? `${what} ${names.length === 1 ? "goes" : "go"} to the Trash on this computer; you can put ${names.length === 1 ? "it" : "them"} back from there.`
      : `${what} ${names.length === 1 ? "is" : "are"} deleted from ${esc(F.device.root)} for good${folders ? `, including everything inside ${folders === 1 ? "the folder" : "the folders"}` : ""}. This cannot be undone.`}</p>
      ${system(side, names) ? `<div class="notice err">These are MustardOS's own files. Deleting them can stop the handheld from starting.</div>` : ""}`,
    ok: local ? "Move to Trash" : "Delete", danger: !local,
  });
  if (!ok) return;
  await run(async () => {
    const r = await api("files/delete", body(side, { names }));
    F[side].sel.clear();
    await load(side);
    if (r.failed.length) toast(`Could not delete ${r.failed.join("; ")}`, 6000);
    else toast(local ? `Moved ${plural(r.deleted, "item")} to the Trash` : `Deleted ${plural(r.deleted, "item")}`, 2600);
  });
}

async function copy(side) {
  const to = other(side), names = [...F[side].sel];
  const req = { from: side, src: { root: F[side].root, path: F[side].path.join("/"), names }, dest: { root: F[to].root, path: F[to].path.join("/") }, volume: volume() };
  let plan;
  F.busy = true;
  render();
  try { plan = await api("files/copy", { ...req, check: true }); } catch (error) { toast(error.message, 4500); }
  F.busy = false;
  render();
  if (!plan) return;
  const short = plan.free && plan.bytes > plan.free;
  const ok = await confirmBox({
    title: side === "local" ? "Copy to the handheld?" : "Copy to this computer?",
    html: `<p>${plural(plan.files, "file")} (${human(plan.bytes)}) from <b>${esc(where(side))}</b> to <b>${esc(where(to))}</b>.</p>
      ${plan.free ? `<p class="muted-note">${human(plan.free)} free there.</p>` : ""}
      ${short ? `<div class="notice err">There is not enough free space.</div>` : ""}
      ${plan.existing.length ? `<div class="notice">${plural(plan.existing.length, "item")} already ${plan.existing.length === 1 ? "exists" : "exist"} there: ${esc(plan.existing.slice(0, 6).join(", "))}${plan.existing.length > 6 ? ", &hellip;" : ""}</div>
        <label class="chk-bulk"><input type="checkbox" id="fx-replace"> Replace ${plan.existing.length === 1 ? "it" : "them"}; otherwise ${plan.existing.length === 1 ? "it is" : "they are"} skipped</label>` : ""}`,
    ok: "Copy",
  });
  if (!ok || short) return;
  const replace = !!$("fx-replace")?.checked;
  try {
    const r = await api("files/copy", { ...req, replace });
    F[side].sel.clear();
    jobStarted(r.job);
    render();
  } catch (error) {
    toast(error.message, 4500);
  }
}

// ---------------------------------------------------------------- preview and editing

const V = { side: "", path: [], text: "", dirty: false, saving: false };

async function preview(side, name) {
  const dialog = $("fileview"), parts = [...F[side].path, name], kind = kindOf({ name });
  Object.assign(V, { side, path: parts, text: "", dirty: false, saving: false, editable: false });
  $("fv-title").textContent = name;
  $("fv-where").textContent = `${SIDES[side]} \u00b7 ${where(side)}`;
  $("fv-save").hidden = true;
  $("fv-note").textContent = "";
  const box = $("fv-body");
  if (kind === "image") {
    box.innerHTML = `<div class="fv-img"><img alt="${esc(name)}" src="/api/files/read?${query(side, { path: parts.join("/"), token: TOKEN })}"></div>`;
    box.querySelector("img").onerror = () => { box.innerHTML = `<div class="notice err">The image could not be read.</div>`; };
    dialog.showModal();
    return;
  }
  box.innerHTML = `<div class="planning"><span class="spinner"></span> Reading&hellip;</div>`;
  dialog.showModal();
  try {
    const r = await api(`files/read?${query(side, { path: parts.join("/") })}`);
    V.text = r.text;
    V.editable = r.editable;
    box.innerHTML = `${system(side) ? `<div class="notice">This is a MustardOS file. A mistake here can stop the handheld from starting.</div>` : ""}
      <textarea class="fv-text" id="fv-text" spellcheck="false"${r.editable ? "" : " readonly"}></textarea>`;
    $("fv-text").value = r.text;
    $("fv-note").textContent = human(r.size);
    $("fv-save").hidden = !r.editable;
    $("fv-save").disabled = true;
  } catch (error) {
    box.innerHTML = `<div class="notice err">${esc(error.message)}</div>`;
  }
}

async function saveFile() {
  const text = $("fv-text").value;
  V.saving = true;
  $("fv-save").disabled = true;
  $("fv-note").textContent = "Saving\u2026";
  try {
    await api("files/write", { side: V.side, root: F[V.side].root, path: V.path.join("/"), volume: volume(), text });
    V.text = text;
    V.dirty = false;
    $("fv-note").textContent = `Saved \u00b7 ${human(new Blob([text]).size)}`;
    load(V.side);
  } catch (error) {
    $("fv-note").textContent = "";
    $("fv-save").disabled = false;
    toast(error.message, 4500);
  }
  V.saving = false;
}

async function closePreview() {
  if (V.dirty && !(await confirmBox({ title: "Throw away your changes?", html: `<p>${esc(V.path.at(-1))} has changes that are not saved.</p>`, ok: "Throw away", danger: true }))) return;
  V.dirty = false;
  $("fileview").close();
}

// ---------------------------------------------------------------- events

function bind() {
  F.bound = true;
  const view = $("view-files");
  view.addEventListener("click", (e) => {
    const el = e.target.closest("[data-fx]");
    const rowEl = e.target.closest(".fx-row");
    if (!el && rowEl && !e.target.closest("button, input, a")) {
      const p = F[rowEl.dataset.side], n = rowEl.dataset.name;
      if (p.sel.has(n)) p.sel.delete(n); else p.sel.add(n);
      return render();
    }
    if (!el || el.disabled) return;
    const side = el.dataset.side || rowEl?.dataset.side, act = el.dataset.fx;
    if (act === "pick") {
      const p = F[side], n = rowEl.dataset.name;
      if (el.checked) p.sel.add(n); else p.sel.delete(n);
      return render();
    }
    if (act === "all") {
      const p = F[side];
      p.sel = el.checked ? new Set(p.entries.map((x) => x.name)) : new Set();
      return render();
    }
    if (act === "open") {
      const entry = F[side].entries.find((x) => x.name === rowEl.dataset.name);
      if (entry?.folder) go(side, [...F[side].path, entry.name]);
      else if (entry) preview(side, entry.name);
      return;
    }
    if (act === "up") go(side, F[side].path.slice(0, -1));
    else if (act === "crumb") go(side, F[side].path.slice(0, +el.dataset.depth));
    else if (act === "refresh") load(side);
    else if (act === "mkdir") mkdir(side);
    else if (act === "rename") rename(side);
    else if (act === "delete") remove(side);
    else if (act === "copy") copy(side);
  });
  view.addEventListener("change", (e) => {
    const side = e.target.dataset?.fxRoot;
    if (!side) return;
    F[side].root = e.target.value;
    go(side, []);
  });
  $("fv-close").addEventListener("click", closePreview);
  $("fv-done").addEventListener("click", closePreview);
  $("fv-save").addEventListener("click", saveFile);
  $("fileview").addEventListener("cancel", (e) => { if (V.dirty) { e.preventDefault(); closePreview(); } });
  $("fileview").addEventListener("input", (e) => {
    if (e.target.id !== "fv-text") return;
    V.dirty = e.target.value !== V.text;
    $("fv-save").disabled = !V.dirty || V.saving;
    if (V.dirty) $("fv-note").textContent = "Not saved";
  });
  $("fileview").addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && !$("fv-save").hidden) { e.preventDefault(); if (!$("fv-save").disabled) saveFile(); }
  });
  addEventListener("job-finished", (e) => {
    if (e.detail?.kind !== "files") return;
    load("local");
    if (F.device.root) load("device");
  });
}
