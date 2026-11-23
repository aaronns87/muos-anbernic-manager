// Syncthing conflict copies on the handheld (.sync-conflict files in save/ and info/): list and resolve them.
// One shared block is used in Device web services and in the Saves panel; every [data-sc-root] repaints together.

import { api, esc, formatDate, human, icon, toast } from "./core.js";
import { confirmBox } from "./art-images.js";

const S = { status: "idle", data: null, error: "", busy: "" };

const name = (p) => p.split("/").pop();

function row(c) {
  const when = c.mtime ? formatDate(new Date(c.mtime * 1000), "long") : "";
  const keepDevice = c.originalExists
    ? `<button type="button" class="btn small" data-sc="keep-device" data-path="${esc(c.path)}">Keep handheld file</button>` : "";
  const keepConflict = `<button type="button" class="btn small ghost" data-sc="keep-conflict" data-path="${esc(c.path)}">${c.originalExists ? "Use conflict copy" : "Restore from copy"}</button>`;
  const del = `<button type="button" class="btn small ghost danger" data-sc="delete-conflict" data-path="${esc(c.path)}">Delete copy</button>`;
  return `<li>
    <span class="sc-text"><b title="${esc(c.path)}">${esc(name(c.original))}</b>
      <small>${esc(c.path)} &middot; ${esc(human(c.size))}${when ? ` &middot; ${esc(when)}` : ""}${c.originalExists ? "" : " &middot; original missing"}</small></span>
    <span class="sc-actions">${keepDevice}${keepConflict}${del}</span>
  </li>`;
}

function bodyHtml() {
  if (S.status === "loading") return `<p class="muted-note"><span class="spinner sm"></span> Looking for Syncthing conflicts&hellip;</p>`;
  if (S.status === "error") return `<div class="notice err">${esc(S.error)}</div>`;
  const d = S.data;
  if (!d) return "";
  if (!d.reachable) return `<p class="muted-note">Connect over Wi-Fi with SSH on to look for Syncthing conflicts.</p>`;
  if (!d.conflicts.length) return `<p class="muted-note">${icon("check")} No Syncthing conflicts in saves or settings.</p>`;
  return `<p class="muted-note">${d.conflicts.length} conflict${d.conflicts.length === 1 ? "" : "s"}: Syncthing kept two versions of these files.</p>
    <ul class="sc-list${S.busy ? " busy" : ""}">${d.conflicts.map(row).join("")}</ul>`;
}

/** Placeholder block; call ensureConflicts() after it is on the page. */
export function conflictsBlockHtml() {
  return `<div class="sync-conflicts" data-sc-root>${inner()}</div>`;
}

function inner() {
  return `<span class="mode-label">Syncthing conflicts</span>${bodyHtml()}
    <div class="panel-actions"><button type="button" class="btn small ghost" data-sc="scan"${S.status === "loading" || S.busy ? " disabled" : ""}>${icon("refresh")}<span>Check for conflicts</span></button></div>`;
}

function paint() {
  for (const el of document.querySelectorAll("[data-sc-root]")) el.innerHTML = inner();
}

export async function loadConflicts() {
  if (S.status === "loading") return;
  S.status = "loading";
  paint();
  try {
    S.data = await api("syncthing/conflicts");
    S.status = "ready";
    S.error = "";
  } catch (error) {
    S.status = "error";
    S.error = error.message;
  }
  paint();
}

/** Scans once per page load; later renders show the last result until Check for conflicts is pressed. */
export function ensureConflicts() {
  if (S.status === "idle") loadConflicts();
}

const LABELS = {
  "keep-device": ["Keep the handheld file?", "The conflict copy is deleted from the handheld. The current file stays as it is.", "Delete copy"],
  "keep-conflict": ["Use the conflict copy?", "The conflict copy replaces the current file on the handheld. The current file is overwritten and cannot be brought back.", "Replace file"],
  "delete-conflict": ["Delete the conflict copy?", "Only the conflict copy is removed from the handheld.", "Delete copy"],
};

async function resolve(action, path) {
  const [title, text, ok] = LABELS[action];
  const yes = await confirmBox({
    title, ok, danger: true,
    html: `<p>${esc(text)}</p><p class="muted-note">${esc(path)}</p>`,
  });
  if (!yes) return;
  S.busy = path;
  paint();
  try {
    const r = await api("syncthing/conflicts/resolve", { path, action });
    S.data = { reachable: r.reachable, host: r.host, conflicts: r.conflicts };
    S.status = "ready";
    toast(action === "keep-conflict" ? "Replaced with the conflict copy" : "Conflict copy removed", 2400);
  } catch (error) {
    toast(error.message, 4200);
  }
  S.busy = "";
  paint();
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-sc]");
  if (!btn || btn.disabled) return;
  if (btn.dataset.sc === "scan") loadConflicts();
  else if (LABELS[btn.dataset.sc]) resolve(btn.dataset.sc, btn.dataset.path);
});
