// OS library: MustardOS release folders under os/, with add/remove, notes, and a link into System Tools install.

import { $, api, esc, human, icon, model, plural, store, toast } from "./core.js";
import { confirmBox } from "./art-images.js";

const O = {
  data: null,
  error: "",
  selected: "",
  bound: false,
  importing: false,
};

const HEX = /^[0-9a-f]{64}$/;

export function showOs() {
  if (!O.bound) bindOs();
  load();
}

export function countOs() {
  api(`os?device=${encodeURIComponent(model())}`).then((d) => {
    if (!O.data) O.data = d;
    paintCount(d);
  }).catch(() => {});
}

export function reloadOs() {
  O.data = null;
  if ($("view-os") && !$("view-os").hidden) load();
  else countOs();
}

function paintCount(d = O.data) {
  const n = d?.releases?.filter((r) => !r.unsorted).length ?? 0;
  if ($("os-count")) $("os-count").textContent = n ? String(n) : "";
}

async function load(refresh = false) {
  try {
    O.data = await api(`os?device=${encodeURIComponent(model())}${refresh ? "&refresh=1" : ""}`);
    O.error = "";
    if (O.selected && !O.data.releases.some((r) => r.id === O.selected)) O.selected = "";
    if (!O.selected && O.data.releases.length) O.selected = O.data.releases[0].id;
  } catch (error) {
    O.error = error.message;
  }
  render();
}

function selected() {
  return O.data?.releases.find((r) => r.id === O.selected) || null;
}

function render() {
  const root = $("os");
  if (!root) return;
  paintCount();
  $("os-actions").innerHTML = `
    <button class="btn" data-os="refresh" title="Read the OS images folder again">${icon("refresh")}<span>Refresh</span></button>
    ${O.data?.available ? `<button class="btn" data-os="reveal-folder">${icon("external")}<span>Show OS folder</span></button>` : ""}
    <button class="btn primary" data-os="add"${O.importing ? " disabled" : ""}>${icon("plus")}<span>Add image&hellip;</span></button>`;

  if (!O.data) {
    root.innerHTML = O.error
      ? `<div class="notice err">${esc(O.error)}</div>`
      : `<div class="planning"><span class="spinner"></span> Reading the OS images folder&hellip;</div>`;
    return;
  }

  const n = O.data.releases.filter((r) => !r.unsorted).length;
  const imgs = O.data.releases.reduce((c, r) => c + r.images.length, 0);
  $("os-sub").textContent = n || imgs
    ? `${plural(n || imgs, n ? "release" : "image")} in the OS images folder.`
    : "MustardOS disk images you keep for installs live here.";

  if (!O.data.releases.length) {
    root.innerHTML = `<div class="empty-state os-empty">${icon("sd")}
      <p><b>No MustardOS images yet.</b> Add a downloaded <code>.img</code> or <code>.img.gz</code> with its SHA256;
        the manager stores it under <code>os/mustardos_&lt;version&gt;/</code>.</p>
      <div class="panel-actions"><button class="btn primary" data-os="add">${icon("plus")}<span>Add MustardOS image&hellip;</span></button></div>
    </div>`;
    return;
  }

  const rel = selected();
  root.innerHTML = `<div class="os-layout">
    <section class="panel os-list"><h2>${icon("sd")}Releases <small>${O.data.releases.length}</small></h2>
      <div class="os-cards">${O.data.releases.map(card).join("")}</div></section>
    <section class="panel os-detail">${rel ? detail(rel) : `<div class="empty-state"><p>Pick a release.</p></div>`}</section>
  </div>`;
}

function card(r) {
  const on = r.id === O.selected;
  const title = r.unsorted ? "Unsorted" : r.version;
  const sub = r.unsorted
    ? `${plural(r.images.length, "image")} at the folder root`
    : [r.code, plural(r.images.length, "image"), human(r.totalSize)].filter(Boolean).join(" · ");
  return `<button type="button" class="os-card${on ? " on" : ""}" data-os="select" data-id="${esc(r.id)}" aria-pressed="${on}">
    <span class="os-card-top"><b>${esc(title)}</b>
      ${r.running ? `<span class="os-badge ok">On handheld</span>` : ""}
      ${r.type === "current" ? `<span class="os-badge">Current</span>` : ""}
      ${r.type === "progress" ? `<span class="os-badge warn">Progress</span>` : ""}
    </span>
    <small>${esc(sub)}</small>
  </button>`;
}

function detail(r) {
  const title = r.unsorted ? "Unsorted images" : `MustardOS ${esc(r.version)}${r.code ? ` · ${esc(r.code)}` : ""}`;
  const rows = r.images.map((img) => {
    const hash = img.hashOk === true
      ? `<span class="set-chip ok">${icon("check")}Checksum</span>`
      : img.hashOk === false
        ? `<span class="set-chip warn">${icon("alert")}No checksum</span>`
        : `<span class="set-chip">No hash.txt</span>`;
    return `<div class="os-img-row">
      <span class="os-ico">${icon("sd")}</span>
      <div class="os-img-main">
        <b title="${esc(img.name)}">${esc(img.name)}</b>
        <small>${img.deviceName ? esc(img.deviceName) + " · " : ""}${human(img.size)}</small>
        <div class="os-img-status">${hash}</div>
      </div>
      <div class="os-img-acts">
        <button class="btn small" data-os="install" data-path="${esc(img.path)}" title="Open System Tools with this image">${icon("download")}<span>Install</span></button>
        <button class="btn icon small ghost" data-os="reveal" data-path="${esc(img.path)}" title="Show in Finder" aria-label="Show ${esc(img.name)}">${icon("external")}</button>
        <button class="btn icon small ghost" data-os="remove-image" data-path="${esc(img.path)}" data-name="${esc(img.name)}" title="Move to the Trash" aria-label="Remove ${esc(img.name)}">${icon("trash")}</button>
      </div>
    </div>`;
  }).join("");

  const notes = r.notes
    ? `<div class="os-notes">
        ${r.notes.important ? `<p class="os-important">${esc(r.notes.important)}</p>` : ""}
        ${r.notes.changes?.length ? `<h3>Changes</h3><ul class="os-note-list">${r.notes.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
        ${r.notes.notes?.length ? `<h3>Notes</h3><ul class="os-note-list">${r.notes.notes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
      </div>`
    : `<p class="muted-note">No published notes for this folder.</p>`;

  const downloads = Object.entries(r.downloads || {});
  const dl = downloads.length
    ? `<div class="os-downloads"><h3>Official download</h3>
        <div class="panel-actions">${downloads.map(([k, url]) =>
          `<a class="btn small" href="${esc(url)}" target="_blank" rel="noopener">${icon("external")}<span>${esc(labelLink(k))}</span></a>`).join("")}</div>
        <p class="muted-note">Opens the host site (GoFile, Mega, &hellip;). Download there, then use Add image.</p></div>`
    : "";

  return `
    <div class="os-detail-head">
      <div><h2>${icon("sd")}${title}</h2>
        <p class="muted-note">${r.unsorted ? esc(r.path) : `<code>${esc(r.folder)}</code> · ${human(r.totalSize)}`}</p></div>
      <div class="os-detail-acts">
        <button class="btn small" data-os="add"${O.importing ? " disabled" : ""}>${icon("plus")}<span>Add image</span></button>
        ${r.unsorted ? "" : `<button class="btn small" data-os="reveal" data-path="${esc(r.path)}">${icon("external")}<span>Show folder</span></button>
        <button class="btn small" data-os="remove-release" data-path="${esc(r.path)}" data-name="${esc(r.folder)}">${icon("trash")}<span>Remove release</span></button>`}
      </div>
    </div>
    <div class="os-img-list">${rows || `<p class="muted-note">No images in this folder.</p>`}</div>
    <div class="os-notes-wrap"><h3>Release notes</h3>${notes}</div>
    ${dl}
    ${r.images[0] ? `<div class="os-footer"><a class="link-btn" href="#system/install" data-os="install" data-path="${esc(r.images[0].path)}">Install this image&hellip;</a></div>` : ""}`;
}

function labelLink(k) {
  const map = { gofile: "GoFile", mega: "Mega", torrent: "Torrent", archive: "Archive", github: "GitHub" };
  return map[String(k).toLowerCase()] || k;
}

async function addImage() {
  if (O.importing) return;
  try {
    const picked = await api("system/pick", { kind: "image", start: O.data?.folder || "" });
    if (!picked.path) return;
    let hash = "", hashFile = "";
    const hashPick = await api("system/pick", { kind: "hash", start: picked.path });
    if (hashPick.path) {
      const found = await api("system/hash-file", { path: hashPick.path, image: picked.path });
      hash = found.value;
      hashFile = hashPick.path;
    }
    if (!HEX.test(String(hash || "").toLowerCase())) {
      toast("A SHA256 is required (pick the matching hash.txt or .sha256 file)", 3600);
      return;
    }
    const name = picked.path.split(/[\\/]/).pop();
    const ok = await confirmBox({
      title: "Add image to OS folder?",
      html: `<p>Saves <b>${esc(name)}</b> into <code>os/mustardos_&lt;version&gt;/</code> with a <code>hash.txt</code> entry.</p>`,
      ok: "Add image",
    });
    if (!ok) return;
    O.importing = true;
    render();
    const saved = await api("os/import", { image: picked.path, hash, hashFile: hashFile || undefined });
    toast(`Saved in os/${saved.folder}/`, 2800);
    await afterOsChange();
    O.selected = String(saved.folder || "").toLowerCase();
    await load();
  } catch (error) {
    toast(error.message, 4000);
  }
  O.importing = false;
  render();
}

async function afterOsChange() {
  try {
    const { forgetImages } = await import("./system.js");
    forgetImages();
  } catch { /* System Tools not loaded yet */ }
}

function openInstall(path) {
  if (!path) return;
  store.set("sysTab", "install");
  store.set("sysPendingImage", path);
  location.hash = "#system/install";
}

async function remove(kind, path, name) {
  const release = kind === "release";
  const ok = await confirmBox({
    title: release ? "Remove this release?" : "Remove this image?",
    html: release
      ? `<p>Moves the whole <code>${esc(name)}</code> folder to the Trash, including every image and <code>hash.txt</code>.</p>`
      : `<p>Moves <b>${esc(name)}</b> to the Trash.</p>`,
    ok: release ? "Remove release" : "Remove image",
    danger: true,
  });
  if (!ok) return;
  try {
    await api("os/remove", { kind, path });
    toast(release ? "Release moved to the Trash" : "Image moved to the Trash", 2400);
    await afterOsChange();
    if (release) O.selected = "";
    await load();
  } catch (error) {
    toast(error.message, 4000);
  }
}

export function bindOs() {
  if (O.bound) return;
  O.bound = true;
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-os]");
    if (!el || el.disabled) return;
    const what = el.dataset.os;
    try {
      if (what === "select") { O.selected = el.dataset.id; render(); return; }
      if (what === "refresh") { el.disabled = true; await load(true); return; }
      if (what === "add") { addImage(); return; }
      if (what === "reveal-folder") { await api("os/reveal", { which: "os" }); return; }
      if (what === "reveal") { await api("os/reveal", { path: el.dataset.path }); return; }
      if (what === "remove-image") { remove("image", el.dataset.path, el.dataset.name); return; }
      if (what === "remove-release") { remove("release", el.dataset.path, el.dataset.name); return; }
      if (what === "install") {
        e.preventDefault();
        openInstall(el.dataset.path);
        return;
      }
    } catch (error) {
      toast(error.message, 4000);
    }
  });
}
