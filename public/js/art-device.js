// Artwork > On device: checks the MustardOS catalogue for images whose game is gone, and deletes them.

import { $, app, api, esc, human, plural, busy, toast, icon, handheldMode, devName, TOKEN } from "./core.js";
import { confirmBox } from "./art-images.js";

const LIST_LIMIT = 500;
const BATCH = 200;
const state = { status: "idle", volume: "", data: null, error: "", show: "orphan", selected: new Set(), deleting: null };
let redraw = () => {};

const keyOf = (f) => `${f.catalogue}/${f.kind}/${f.name}`;
const panel = (cls, title, body, actions = "") =>
  `<section class="panel ${cls}"><h2>${title}</h2>${body}${actions ? `<div class="panel-actions">${actions}</div>` : ""}</section>`;
const imageUrl = (f) => `/api/device/image?${new URLSearchParams({ volume: state.volume, kind: f.kind, catalogue: f.catalogue, name: f.name, size: f.size, token: TOKEN })}`;
const shown = () => (state.data ? state.data.leftovers.filter((f) => f.reason === state.show) : []);

export const auditWorking = () => state.status === "loading" || !!state.deleting;

async function runAudit() {
  const volume = app.device.target.id;
  Object.assign(state, { status: "loading", volume, data: null, error: "", selected: new Set() });
  redraw();
  try {
    const data = await api("artwork/device/audit", { volume });
    if (state.volume !== volume) return;
    state.data = data;
    state.status = "ready";
    state.show = data.totals.orphans || !data.totals.nofolder ? "orphan" : "nofolder";
  } catch (error) {
    state.status = "error";
    state.error = error.message;
  }
  redraw();
}

function cataloguesTable(d) {
  const status = (c) => c.status === "unknown" ? `<small>Not a known system; not checked</small>`
    : c.status === "nofolder" ? `<small>No ROMS folder for ${esc(c.systems.join(", "))}</small>` : `<small>${esc(c.systems.join(", "))}</small>`;
  return `<details class="art-details"><summary>${plural(d.catalogues.length, "catalogue")} on ${esc(d.where)}</summary><div class="art-table"><table>
    <thead><tr><th>Catalogue</th><th>ROM folders</th><th class="num">Box</th><th class="num">Preview</th><th class="num">Splash</th><th class="num">Size</th><th class="num">Leftovers</th></tr></thead>
    <tbody>${d.catalogues.map((c) => `<tr>
      <td>${esc(c.name)}</td><td>${status(c)}</td>
      <td class="num">${c.box.toLocaleString()}</td><td class="num">${c.preview.toLocaleString()}</td><td class="num">${c.splash.toLocaleString()}</td>
      <td class="num">${human(c.bytes)}</td><td class="num">${c.orphans ? `<span class="flag">${c.orphans.toLocaleString()}</span>` : `<span class="nil">-</span>`}</td>
    </tr>`).join("")}</tbody></table></div></details>`;
}

function leftoverList() {
  const list = shown();
  if (!list.length) {
    return `<div class="muted-note">${state.show === "orphan" ? `Every image belongs to a game on ${esc(devName())}.` : "None."}</div>`;
  }
  const all = list.every((f) => state.selected.has(keyOf(f)));
  return `<div class="al-bulk"><label class="check"><input type="checkbox" data-da="all"${all ? " checked" : ""}><span>Select all ${list.length.toLocaleString()}</span></label></div>
    <div class="lo-list">${list.slice(0, LIST_LIMIT).map((f) => `<label class="lo-row">
      <input type="checkbox" data-da-pick="${esc(keyOf(f))}"${state.selected.has(keyOf(f)) ? " checked" : ""}>
      <span class="badge">${esc(f.kind)}</span>
      <span class="lo-name"><b>${esc(f.name)}</b><small>${esc(f.catalogue)}</small></span>
      <span class="lo-size">${human(f.size)}</span>
      <a class="btn icon small ghost" href="${esc(imageUrl(f))}" target="_blank" rel="noopener" title="View" aria-label="View">${icon("eye")}</a>
    </label>`).join("")}</div>
    ${list.length > LIST_LIMIT ? `<div class="muted-note">Listing ${LIST_LIMIT} of ${list.length.toLocaleString()}; Select all includes every one.</div>` : ""}`;
}

const deleteLabel = (n, bytes) => `Delete ${n ? `${plural(n, "image")} (${human(bytes)})` : "selected"} permanently`;

function updateSelection() {
  const button = $("da-delete");
  if (!button || !state.data) return;
  const picked = state.data.leftovers.filter((f) => state.selected.has(keyOf(f)));
  button.innerHTML = `${icon("trash")}<span>${deleteLabel(picked.length, picked.reduce((a, f) => a + f.size, 0))}</span>`;
  button.disabled = !picked.length || !!state.deleting || busy();
  const all = document.querySelector("[data-da='all']");
  if (all) all.checked = shown().every((f) => state.selected.has(keyOf(f)));
}

export function auditPanel(live, bindRedraw) {
  redraw = bindRedraw;
  const title = "Catalogue check";
  if (!live) return "";
  const c = app.device.target;
  if (!c.art) return "";
  if (state.volume !== c.id && state.status !== "loading") Object.assign(state, { status: "idle", volume: c.id, data: null, selected: new Set() });
  const intro = `Finds images in the catalogue on ${esc(c.art)} whose game is no longer on ${esc(devName())}, so you can free the space.`;
  if (state.status === "idle") {
    return panel("full", title, `<div class="muted-note">${intro}${handheldMode() ? " Over USB or Wi-Fi this reads every ROM folder and catalogue, which can take a few minutes." : ""}</div>`,
      `<button class="btn primary" data-da="run"${busy() ? " disabled" : ""}>${icon("search")}<span>Check the catalogue</span></button>`);
  }
  if (state.status === "loading") {
    return panel("full", title, `<div class="muted-note"><span class="spinner"></span> Comparing the catalogue on ${esc(c.art)} with the games on ${esc(devName())}&hellip;</div>`);
  }
  if (state.status === "error") {
    return panel("full", title, `<div class="notice err">${esc(state.error)}</div>`, `<button class="btn" data-da="run">${icon("refresh")}<span>Try again</span></button>`);
  }
  const d = state.data, t = d.totals;
  const n = state.selected.size;
  const bytes = d.leftovers.filter((f) => state.selected.has(keyOf(f))).reduce((a, f) => a + f.size, 0);
  const scope = `Compared with the ROMs on ${esc(d.checked.join(" and ") || "the device")}.` + (d.mode === "card"
    ? " Over the card reader only TF2 is visible: if you also keep games on SD1, their images show up here. Connect over USB or Wi-Fi to check both cards." : "");
  const dl = state.deleting;
  return panel("full", `${icon("layers")}${title}`, `<div class="numbers">
      <div class="stat"><b>${t.images.toLocaleString()}</b><span>images</span></div>
      <div class="stat"><b>${human(t.bytes)}</b><span>catalogue size</span></div>
      <div class="stat${t.orphans ? " warn" : ""}"><b>${t.orphans.toLocaleString()}</b><span>leftovers</span></div>
      <div class="stat"><b>${human(t.orphanBytes)}</b><span>to free</span></div>
    </div>
    <div class="muted-note">${scope}${d.truncated ? " The list is capped; delete these, then check again for more." : ""}</div>
    ${cataloguesTable(d)}
    <div class="segmented lo-tabs">
      <button data-da-show="orphan" class="${state.show === "orphan" ? "on" : ""}">Game not on ${esc(devName())} <small>${t.orphans.toLocaleString()}</small></button>
      <button data-da-show="nofolder" class="${state.show === "nofolder" ? "on" : ""}">No ROM folder for the system <small>${t.nofolder.toLocaleString()}</small></button>
    </div>
    ${state.show === "nofolder" ? `<div class="notice">These catalogues belong to systems with no ROMS folder on ${esc(devName())}. If you keep those games in a folder with another name, MustardOS may still use the images.</div>` : ""}
    ${leftoverList()}
    ${dl ? `<div class="muted-note"><span class="spinner"></span> Deleting: ${dl.done.toLocaleString()} of ${dl.total.toLocaleString()}</div>` : ""}`,
    `<button class="btn danger-solid" id="da-delete" data-da="delete"${n && !dl && !busy() ? "" : " disabled"}>${icon("trash")}<span>${deleteLabel(n, bytes)}</span></button>
     <span class="grow"></span><button class="btn" data-da="run"${dl || busy() ? " disabled" : ""}>${icon("refresh")}<span>Check again</span></button>`);
}

async function deleteSelected() {
  const d = state.data, c = app.device.target;
  const files = d.leftovers.filter((f) => state.selected.has(keyOf(f)));
  if (!files.length) return;
  const bytes = files.reduce((a, f) => a + f.size, 0);
  const ok = await confirmBox({
    title: `Delete from ${devName()}`,
    html: `<p>Permanently delete <b>${plural(files.length, "image")}</b> (${human(bytes)}) from the artwork catalogue on ${esc(c.art)}?
      There is no Trash on the device.</p>`,
    ok: "Delete permanently", danger: true
  });
  if (!ok) return;
  state.deleting = { done: 0, total: files.length };
  redraw();
  let deleted = 0, failed = 0;
  try {
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const result = await api("artwork/device/delete", { volume: state.volume, files: batch.map(({ catalogue, kind, name }) => ({ catalogue, kind, name })) });
      deleted += result.deleted;
      failed += result.failed;
      state.deleting.done = Math.min(files.length, i + BATCH);
      redraw();
    }
  } catch (error) {
    toast(error.message, 5000);
  }
  if (failed) {
    state.deleting = null;
    state.selected = new Set();
    toast(`Deleted ${plural(deleted, "image")} from ${devName()}; ${failed} could not be deleted`, 6000);
    return runAudit();
  }
  const gone = new Set(files.slice(0, state.deleting.done).map(keyOf));
  for (const f of d.leftovers.filter((x) => gone.has(keyOf(x)))) {
    const t = d.totals, row = d.catalogues.find((x) => x.name === f.catalogue);
    t.images--; t.bytes -= f.size;
    if (f.reason === "orphan") { t.orphans--; t.orphanBytes -= f.size; } else t.nofolder--;
    if (row) { row[f.kind]--; row.bytes -= f.size; row.orphans--; }
  }
  d.leftovers = d.leftovers.filter((f) => !gone.has(keyOf(f)));
  state.selected = new Set([...state.selected].filter((k) => !gone.has(k)));
  state.deleting = null;
  toast(`Deleted ${plural(deleted, "image")} from ${devName()}`, 3000);
  redraw();
}

export function bindDeviceTools(root, active) {
  root.addEventListener("click", (e) => {
    if (!active()) return;
    const show = e.target.closest("[data-da-show]");
    if (show) { state.show = show.dataset.daShow; return redraw(); }
    const el = e.target.closest("[data-da]");
    if (!el) return;
    if (el.dataset.da === "run") return runAudit();
    if (el.dataset.da === "delete") return deleteSelected();
    if (el.dataset.da === "all") {
      shown().forEach((f) => (el.checked ? state.selected.add(keyOf(f)) : state.selected.delete(keyOf(f))));
      document.querySelectorAll("[data-da-pick]").forEach((box) => { box.checked = state.selected.has(box.dataset.daPick); });
      return updateSelection();
    }
  });
  root.addEventListener("change", (e) => {
    if (!active()) return;
    const pick = e.target.closest("[data-da-pick]");
    if (!pick) return;
    if (pick.checked) state.selected.add(pick.dataset.daPick); else state.selected.delete(pick.dataset.daPick);
    updateSelection();
  });
}
