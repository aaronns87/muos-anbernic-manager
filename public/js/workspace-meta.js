// Settings > Data > Workspace metadata: an encrypted backup of settings, device profiles, recipe packs and small
// caches (never ROMs, BIOS files or artwork), and restoring one. The passphrase never leaves this computer unencrypted
// and is not stored; the server seals the file with it.

import { api, esc, human, icon, store, toast } from "./core.js";
import { panel } from "./layout.js";
import { confirmBox } from "./art-images.js";

const M = { list: null, folder: "", error: "", busy: "", note: "", pass: "", restorePass: "", pick: "" };

function listHtml() {
  if (M.error) return `<div class="notice err">${esc(M.error)}</div>`;
  if (!M.list) return `<p class="muted-note"><span class="spinner sm"></span> Looking for backups&hellip;</p>`;
  if (!M.list.length) return `<p class="muted-note">No metadata backups in the backups folder yet.</p>`;
  const picked = M.list.some((b) => b.name === M.pick) ? M.pick : M.list[0].name;
  return `<select class="control" data-meta-pick>${M.list.map((b) =>
    `<option value="${esc(b.name)}"${b.name === picked ? " selected" : ""}>${esc(b.name)} &middot; ${human(b.bytes)} &middot; ${esc(new Date(b.mtime).toLocaleString())}</option>`).join("")}</select>`;
}

function body() {
  const off = M.busy ? " disabled" : "";
  const spin = (what) => (M.busy === what ? `<span class="spinner"></span>` : icon(what === "backup" ? "save" : "restore"));
  return `<p class="muted-note">Saves settings, device profiles, recipe packs, idle jobs, MCP switches and small caches into one encrypted file in the backups folder.
      No games, BIOS files or artwork, and no MCP tokens. Keep the passphrase safe: without it the file cannot be opened.</p>
    <div class="set-row"><span><b>Backup metadata</b><small>At least 8 characters. Not stored anywhere.</small></span>
      <span class="set-prompt-actions meta-actions">
        <input class="control" type="password" autocomplete="new-password" spellcheck="false" placeholder="Passphrase" data-meta-pass value="${esc(M.pass)}"${off}>
        <button class="btn" data-meta-backup type="button"${off}>${spin("backup")}<span>Back up</span></button></span></div>
    <div class="set-row"><span><b>Restore metadata</b><small>Replaces settings, profiles and recipe packs on this computer. Folder locations and MCP tokens stay.</small></span>
      <span class="set-prompt-actions meta-actions">${listHtml()}
        <input class="control" type="password" autocomplete="off" spellcheck="false" placeholder="Passphrase" data-meta-restore-pass value="${esc(M.restorePass)}"${off}>
        <button class="btn" data-meta-restore type="button"${off}>${spin("restore")}<span>Restore</span></button></span></div>
    ${M.note ? `<p class="muted-note">${esc(M.note)}</p>` : ""}`;
}

export function metaPanelHtml() {
  if (!M.list && !M.error) queueMicrotask(loadList);
  return panel("half", `${icon("lock")} Workspace metadata`, `<div id="meta-box">${body()}</div>`);
}

function paint() {
  const el = document.getElementById("meta-box");
  if (el) el.innerHTML = body();
}

async function loadList() {
  try {
    const r = await api("workspace/meta-backups");
    M.list = r.backups;
    M.folder = r.folder;
    M.error = "";
  } catch (error) {
    M.error = error.message;
  }
  paint();
}

async function backup() {
  if (M.busy) return;
  M.busy = "backup";
  paint();
  try {
    const r = await api("workspace/backup-meta", { passphrase: M.pass, libraryRecipes: store.get("libraryRecipes", {}) });
    M.pass = "";
    M.note = `Saved ${r.name} (${human(r.bytes)}, ${r.files.length} files) in ${M.folder || "the backups folder"}.`;
    toast("Metadata backup saved", 2800);
    await loadList();
  } catch (error) {
    toast(error.message, 6000);
  }
  M.busy = "";
  paint();
}

async function restore() {
  if (M.busy) return;
  const file = M.pick || M.list?.[0]?.name || "";
  if (!file) { toast("There is no backup to restore", 3000); return; }
  const ok = await confirmBox({
    title: "Restore metadata?",
    html: `<p>This replaces your settings, device profiles and imported recipe packs with the ones in <b>${esc(file)}</b>. Games and artwork are not touched.</p>`,
    ok: "Restore", danger: true,
  });
  if (!ok) return;
  M.busy = "restore";
  paint();
  try {
    const r = await api("workspace/restore-meta", { file, passphrase: M.restorePass, confirm: true });
    M.restorePass = "";
    if (r.libraryRecipes) store.set("libraryRecipes", r.libraryRecipes);
    M.note = `Restored: ${r.restored.join(", ") || "nothing"}. ${r.notes.join(" ")} Reload the page to see everything.`;
    toast("Metadata restored", 3200);
  } catch (error) {
    toast(error.message, 6000);
  }
  M.busy = "";
  paint();
}

export function bindMeta(root) {
  root.addEventListener("input", (e) => {
    if (e.target.dataset.metaPass !== undefined) M.pass = e.target.value;
    else if (e.target.dataset.metaRestorePass !== undefined) M.restorePass = e.target.value;
  });
  root.addEventListener("change", (e) => {
    if (e.target.dataset.metaPick !== undefined) M.pick = e.target.value;
  });
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-meta-backup]")) backup();
    else if (e.target.closest("[data-meta-restore]")) restore();
  });
}
