// Apps: MustardOS packages (.muxapp, .muxupd, ...) in the apps folder. Add them, send them to ARCHIVE on the handheld,
// and install them there over SSH with the script Archive Manager runs.

import { $, app, api, esc, human, plural, toast, icon, busy, TOKEN } from "./core.js";
import { confirmBox } from "./art-images.js";
import { jobStarted } from "./copy.js";
import { showUpdates } from "./updates.js";

const A = {
  data: null, error: "", dev: null, devError: "", devLoading: false,
  picked: new Set(), uploads: [], queue: [], install: null, then: null, bound: false, timer: 0,
};
const PACKAGE = /\.(muxapp|muxupd|muxzip|muxthm|muxalt|muxcat|muxcfg|zip)$/i;
const TINT = { App: "t-app", "System update": "t-upd", Bundle: "t-zip", Theme: "t-thm", "Theme variant": "t-thm" };

export function showApps() {
  if (!A.bound) bind();
  load();
  loadDevice();
  render();
  showUpdates(load);
}

export function countApps() {
  api("apps").then((d) => { if (!A.data) A.data = d; render(); }).catch(() => {});
}

export function renderApps() {
  const wifi = !!app.device.wifi?.reachable;
  if (A.bound && A.wifi !== undefined && wifi !== A.wifi && !A.devLoading) loadDevice();
  A.wifi = wifi;
  render();
}

async function load() {
  try {
    A.data = await api("apps");
    A.error = "";
    for (const name of [...A.picked]) if (!A.data.packages.some((p) => p.name === name)) A.picked.delete(name);
  } catch (error) {
    A.error = error.message;
  }
  render();
}

async function loadDevice() {
  A.devLoading = true;
  render();
  try {
    A.dev = await api("apps/device");
    A.devError = "";
    if (A.dev.installing?.running && !A.install) { A.install = { ...A.dev.installing }; pollInstall(); }
  } catch (error) {
    A.devError = error.message;
  }
  A.devLoading = false;
  render();
}

// ---------------------------------------------------------------- state helpers

const target = () => app.device.target;
const canSend = () => !!target() && !busy();
const sshReady = () => !!A.dev?.reachable;
const broken = (p) => !!(p.error || p.unsafe);
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const onDevice = (p) => A.dev?.archive.find((a) => sameName(a.name, p.name)) || null;
const installedMark = (p) => !!A.dev?.installed.some((n) => sameName(n, p.name));
const sourceOf = (app) => A.data?.packages.find((p) => p.apps.some((a) => sameName(a, app))) || null;
const appsPresent = (p) => (A.dev ? p.apps.filter((t) => A.dev.apps.some((a) => sameName(a, t))) : []);

function targetText() {
  const t = target();
  if (!t) return "Connect the handheld (USB or Wi-Fi) or put the TF2 card in a card reader to send packages.";
  if (t.mode === "card") return "Sends to ARCHIVE on the TF2 card in the card reader. Put it back in the handheld to install.";
  return `Sends to ARCHIVE on ${t.name || "the handheld"} over ${t.mode === "usb" ? "USB" : "Wi-Fi"}.`;
}

function contents(p) {
  if (p.error) return `<span class="app-bad">${esc(p.error)}</span>`;
  if (p.unsafe) return `<span class="app-bad">Contains unsafe paths; MustardOS refuses to install it.</span>`;
  const list = (items) => esc(items.slice(0, 4).join(", ") + (items.length > 4 ? ` +${items.length - 4}` : ""));
  if (p.ext === "muxapp") return p.top.length ? `Installs <b>${list(p.top)}</b> in Applications` : "An application";
  if (p.ext === "muxupd") return `Updates system files${p.apps.length ? ` and adds <b>${list(p.apps)}</b>` : p.top.length ? ` (${list(p.top)})` : ""}`;
  if (p.ext === "muxzip") return p.top.length ? `Bundle of ${list(p.top)}` : "A bundle";
  if (!p.installs) return "Archive Manager cannot install plain .zip files";
  return esc(p.kind);
}

function status(p) {
  const a = onDevice(p), present = appsPresent(p), done = installedMark(p);
  const chips = [];
  if (done || present.length) chips.push(`<span class="set-chip ok">${icon("check")}Installed${present.length && !done ? ` (${esc(present.join(", "))})` : ""}</span>`);
  if (a) chips.push(`<span class="set-chip${a.size === p.size ? "" : " warn"}" title="${esc(a.path)}">In ${esc(a.storage)} ARCHIVE${a.size === p.size ? "" : ", different size"}</span>`);
  if (!chips.length && A.dev?.reachable) chips.push(`<span class="set-chip">Not on the handheld</span>`);
  return chips.join("");
}

// ---------------------------------------------------------------- rendering

function render() {
  const root = $("apps");
  if (!root) return;
  const count = A.data?.packages.length ?? 0;
  if ($("apps-count")) $("apps-count").textContent = count ? String(count) : "";
  $("apps-actions").innerHTML = `
    <button class="btn" data-ap="refresh" title="Read the apps folder and the handheld again">${icon("refresh")}<span>Refresh</span></button>
    ${A.data?.available ? `<button class="btn" data-ap="reveal">${icon("external")}<span>Show folder</span></button>` : ""}
    <button class="btn primary" data-ap="add">${icon("plus")}<span>Add packages&hellip;</span></button>`;
  if (!A.data) {
    root.innerHTML = A.error ? `<div class="notice err">${esc(A.error)}</div>` : `<div class="planning"><span class="spinner"></span> Reading the apps folder&hellip;</div>`;
    return;
  }
  $("apps-sub").innerHTML = `${plural(count, "package")} in <code title="${esc(A.data.folder)}">${esc(A.data.folder)}</code> &middot; change it in Settings`;
  root.innerHTML = `${installPanel()}<div class="apps-layout">${packagesPanel()}${devicePanel()}</div>`;
  const log = root.querySelector(".apps-log");
  if (log) log.scrollTop = log.scrollHeight;
}

function packagesPanel() {
  const d = A.data;
  const uploads = A.uploads.map((u) => `<div class="app-row up">
      <span class="app-ico">${u.error ? icon("alert") : `<span class="spinner sm"></span>`}</span>
      <div class="app-main"><b>${esc(u.name)}</b><small>${u.error ? `<span class="app-bad">${esc(u.error)}</span>` : `Adding&hellip; ${Math.floor((u.sent / u.size) * 100)}% of ${human(u.size)}`}</small>
        ${u.error ? "" : `<div class="meter"><i style="width:${Math.floor((u.sent / u.size) * 100)}%"></i></div>`}</div>
      ${u.error ? `<button class="btn icon small ghost" data-ap="dismiss" data-name="${esc(u.name)}" title="Dismiss" aria-label="Dismiss">${icon("x")}</button>` : ""}
    </div>`).join("");
  if (!d.packages.length && !A.uploads.length) {
    return `<section class="panel apps-main"><h2>${icon("package")}Packages</h2>
      <div class="empty-state apps-empty">${icon("package")}<p><b>No packages yet.</b> Drop .muxapp, .muxupd or .muxzip files here, or add them with the button.
        They are copied into <code>${esc(d.folder)}</code>.</p>
        <button class="btn primary" data-ap="add">${icon("plus")}<span>Add packages&hellip;</span></button></div></section>`;
  }
  const all = d.packages.length && d.packages.every((p) => A.picked.has(p.name));
  const rows = d.packages.map((p) => {
    const a = onDevice(p), picked = A.picked.has(p.name), bad = broken(p);
    const install = a && p.installs && !bad && sshReady()
      ? `<button class="btn small primary" data-ap="install" data-path="${esc(a.path)}" data-name="${esc(p.name)}"${A.install?.running ? " disabled" : ""}>${icon("download")}<span>Install</span></button>` : "";
    const send = `<button class="btn small${install ? "" : " primary"}" data-ap="send" data-name="${esc(p.name)}"${bad ? ` disabled title="This package is damaged or unsafe"` : canSend() ? "" : ` disabled title="${esc(targetText())}"`}>${icon("upload")}<span>${a ? "Send again" : "Send"}</span></button>`;
    const both = !a && p.installs && !bad && sshReady() && target() && target().mode !== "card"
      ? `<button class="btn small" data-ap="send-install" data-name="${esc(p.name)}"${canSend() && !A.install?.running ? "" : " disabled"} title="Send it, then install it on the handheld">${icon("bolt")}<span>Send and install</span></button>` : "";
    return `<div class="app-row${picked ? " picked" : ""}">
      <label class="app-check"><input type="checkbox" data-ap-pick="${esc(p.name)}"${picked ? " checked" : ""}${bad ? " disabled" : ""} aria-label="Select ${esc(p.name)}"></label>
      <span class="app-ico ${TINT[p.kind] || ""}">${icon("package")}</span>
      <div class="app-main">
        <b title="${esc(p.name)}">${esc(p.name)}</b>
        <small><span class="app-kind">${esc(p.kind)}</span> &middot; ${human(p.size)} &middot; ${contents(p)}</small>
        <div class="app-status">${status(p)}</div>
      </div>
      <div class="app-actions">${install}${both}${send}
        <button class="btn icon small ghost" data-ap="trash" data-name="${esc(p.name)}" title="Move to the Trash" aria-label="Move ${esc(p.name)} to the Trash">${icon("trash")}</button></div>
    </div>`;
  }).join("");
  const n = A.picked.size;
  const bulk = n ? `<div class="panel-actions apps-bulk"><span class="muted-note">${plural(n, "package")} selected</span><span class="grow"></span>
      ${sshReady() && target()?.mode !== "card" ? `<button class="btn" data-ap="send-install-picked"${canSend() && !A.install?.running ? "" : " disabled"}>${icon("bolt")}<span>Send and install</span></button>` : ""}
      <button class="btn primary" data-ap="send-picked"${canSend() ? "" : ` disabled title="${esc(targetText())}"`}>${icon("upload")}<span>Send ${n === 1 ? "it" : `all ${n}`}</span></button></div>` : "";
  return `<section class="panel apps-main">
    <h2>${icon("package")}Packages <small>${d.packages.length}</small><span class="grow"></span>
      <button class="link-btn" data-ap="${all ? "none" : "all"}">${all ? "Select none" : "Select all"}</button></h2>
    <p class="muted-note apps-target">${icon(target() ? "upload" : "alert")}${esc(targetText())}</p>
    <div class="app-list">${uploads}${rows}</div>${bulk}
  </section>`;
}

function devicePanel() {
  const head = `<h2>${icon("handheld")}On the handheld${A.dev?.reachable ? ` <small>${esc(A.dev.host)}</small>` : ""}<span class="grow"></span>
    ${A.devLoading ? `<span class="spinner sm"></span>` : ""}</h2>`;
  if (A.devError) return `<section class="panel apps-side">${head}<div class="notice err">${esc(A.devError)}</div>
    <div class="panel-actions"><button class="btn small" data-ap="refresh">${icon("refresh")}<span>Try again</span></button><a class="btn small ghost" href="#ssh">SSH settings</a></div></section>`;
  if (!A.dev) return `<section class="panel apps-side">${head}<div class="planning"><span class="spinner"></span> Asking the handheld&hellip;</div></section>`;
  if (!A.dev.reachable) {
    return `<section class="panel apps-side">${head}
      <div class="notice">Installing from here needs SSH over Wi-Fi. On the handheld turn on <b>Configuration &rsaquo; Web Services &rsaquo; Secure Shell</b>, then check the <a href="#ssh">SSH</a> section.</div>
      <p class="muted-note">You can still send packages over USB or with the card reader, then install them on the handheld from <b>Applications &rsaquo; Archive Manager</b>.</p></section>`;
  }
  const d = A.dev;
  const files = d.archive.length
    ? d.archive.map((a) => `<div class="dev-app">
        <div><b title="${esc(a.path)}">${esc(a.name)}</b><small>${esc(a.storage)} ARCHIVE &middot; ${human(a.size)}</small></div>
        <button class="btn small" data-ap="install" data-path="${esc(a.path)}" data-name="${esc(a.name)}"${A.install?.running ? " disabled" : ""}>${icon("download")}<span>Install</span></button>
        <button class="btn icon small ghost" data-ap="device-delete" data-path="${esc(a.path)}" data-name="${esc(a.name)}" title="Delete from the handheld" aria-label="Delete ${esc(a.name)} from the handheld">${icon("trash")}</button>
      </div>`).join("")
    : `<p class="muted-note">ARCHIVE is empty${d.archives.length ? ` on ${esc(d.archives.join(" and "))}` : ""}. Send a package to install it.</p>`;
  return `<section class="panel apps-side">${head}
    ${d.frontend ? "" : `<div class="notice">A game or app is open on the handheld. Close it and go back to the menu before installing or uninstalling.</div>`}
    <h3 class="sub-head">Waiting in ARCHIVE</h3>
    <div class="dev-apps">${files}</div>
    <h3 class="sub-head">Installed applications <small>${d.apps.length}</small></h3>
    <div class="dev-apps">${d.apps.map((n) => {
      const from = sourceOf(n);
      return `<div class="dev-app">
        <div><b>${esc(n)}</b><small${from ? ` title="${esc(from.name)}"` : ""}>${from ? `From ${esc(from.name)}` : "Applications"}</small></div>
        <button class="btn small ghost" data-ap="uninstall" data-name="${esc(n)}"${A.install?.running || A.removing ? " disabled" : ""} title="Delete ${esc(n)} from the handheld">${icon("trash")}<span>${A.removing === n ? "Removing&hellip;" : "Uninstall"}</span></button>
      </div>`;
    }).join("") || `<p class="muted-note">None</p>`}</div>
    <p class="muted-note">Installing runs the same script as Applications &rsaquo; Archive Manager. The handheld's menu closes while it works and comes back when it is done.</p>
  </section>`;
}

function installPanel() {
  const i = A.install;
  if (!i) return "";
  const ok = !i.running && i.code === 0, failed = !i.running && i.code !== null && i.code !== 0;
  const update = /\.muxupd$/i.test(i.name);
  const title = i.running ? `Installing ${esc(i.name)} on the handheld&hellip;` : ok ? `Installed ${esc(i.name)}` : failed ? `Installing ${esc(i.name)} failed (code ${i.code})` : `Installing ${esc(i.name)}`;
  const next = A.queue.length ? `<span class="muted-note">Next: ${esc(A.queue.map((q) => q.name).join(", "))}</span>` : "";
  return `<section class="panel apps-install${ok ? " ok" : failed ? " bad" : ""}">
    <h2>${i.running ? `<span class="spinner sm"></span>` : icon(ok ? "check" : "alert")}<span class="apps-install-title">${title}</span><span class="grow"></span>
      ${i.running ? "" : `<button class="btn icon small ghost" data-ap="close-install" title="Close" aria-label="Close">${icon("x")}</button>`}</h2>
    <pre class="apps-log">${esc(i.log || "Starting\u2026")}</pre>
    <div class="panel-actions">${next}<span class="grow"></span>
      ${ok && update ? `<span class="muted-note">System updates take effect after a restart.</span><button class="btn small primary" data-ap="reboot">${icon("refresh")}<span>Restart the handheld</span></button>` : ""}</div>
  </section>`;
}

// ---------------------------------------------------------------- actions

async function send(names, thenInstall) {
  if (busy()) { toast("Wait for the current transfer to finish"); return; }
  if (!target()) { toast(targetText(), 3000); return; }
  if (thenInstall && !(await confirmInstall(names))) return;
  try {
    const { job } = await api("apps/send", { volume: target().id, names });
    A.then = thenInstall ? names : null;
    jobStarted(job);
    render();
  } catch (error) {
    toast(error.message, 3500);
  }
}

async function confirmInstall(names) {
  const updates = names.filter((n) => /\.muxupd$/i.test(n));
  return confirmBox({
    title: names.length === 1 ? `Install ${names[0]}?` : `Install ${names.length} packages?`,
    html: `<p>The handheld's menu closes while ${names.length === 1 ? "it installs" : "they install"} and comes back when done.</p>
      ${updates.length ? `<p><b>${esc(updates.join(", "))}</b> ${updates.length === 1 ? "is a system update; it replaces" : "are system updates; they replace"} MustardOS files. Only install updates made for your MustardOS version.</p>` : ""}
      ${names.length > 1 ? `<ul>${names.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}`,
    ok: names.length === 1 ? "Install" : `Install ${names.length}`,
  });
}

async function onJobFinished(job) {
  if (job.kind !== "apps") return;
  const wanted = A.then;
  A.then = null;
  await loadDevice();
  if (job.state === "done" && !job.failed_count) toast(`Sent ${plural(job.copied, "package")} to ARCHIVE`, 2600);
  if (!wanted || job.state !== "done") return;
  const failed = new Set(job.failed);
  for (const name of wanted) {
    if (failed.has(name)) continue;
    const a = A.dev?.archive.find((x) => sameName(x.name, name));
    if (a) A.queue.push({ path: a.path, name: a.name });
  }
  nextInstall();
}

async function install(path, name, confirmed = false) {
  if (A.install?.running) { toast("Wait for the install to finish"); return; }
  if (!confirmed && !(await confirmInstall([name]))) return;
  try {
    A.install = { name, running: true, code: null, log: "" };
    render();
    A.install = await api("apps/install", { path });
    pollInstall();
  } catch (error) {
    A.install = { name, running: false, code: -1, log: error.message };
    A.queue = [];
  }
  render();
}

function nextInstall() {
  if (A.install?.running || !A.queue.length) return;
  const { path, name } = A.queue.shift();
  install(path, name, true);
}

function pollInstall() {
  clearTimeout(A.timer);
  A.timer = setTimeout(async () => {
    try {
      const status = await api("apps/install");
      A.install = status;
    } catch {
      A.timer = setTimeout(pollInstall, 2000);
      return;
    }
    if (A.install.running) {
      render();
      pollInstall();
      return;
    }
    toast(A.install.code === 0 ? `Installed ${A.install.name}` : `Installing ${A.install.name} failed`, 3000);
    if (A.install.code !== 0) A.queue = [];
    await loadDevice();
    nextInstall();
  }, 1000);
}

async function deleteOnDevice(path, name) {
  const ok = await confirmBox({
    title: `Delete ${name} from the handheld?`,
    html: `<p>It is removed from ARCHIVE on the handheld. There is no Trash on the device; the copy in your apps folder stays.</p>`,
    ok: "Delete", danger: true,
  });
  if (!ok) return;
  try {
    A.dev = await api("apps/device/delete", { path });
    toast("Deleted from the handheld");
  } catch (error) {
    toast(error.message, 3500);
  }
  render();
}

async function uninstall(name) {
  const from = sourceOf(name);
  const ok = await confirmBox({
    title: `Uninstall ${name}?`,
    html: `<p>Deletes the <b>${esc(name)}</b> folder from Applications on the handheld, with its settings and saved data. There is no Trash on the device.</p>
      ${from?.ext === "muxupd" ? `<p>It came with the system update <b>${esc(from.name)}</b>. Files that update put into MustardOS itself, such as its menu icon, stay behind; they are harmless.</p>` : ""}
      <p>To get it back, install its package again.</p>`,
    ok: "Uninstall", danger: true,
  });
  if (!ok) return;
  A.removing = name;
  render();
  try {
    A.dev = await api("apps/device/uninstall", { app: name });
    toast(`Uninstalled ${name}`, 2600);
  } catch (error) {
    toast(error.message, 4000);
  }
  A.removing = null;
  render();
}

async function trash(name) {
  const ok = await confirmBox({ title: `Move ${name} to the Trash?`, html: `<p>It leaves the apps folder. Anything already on the handheld stays there.</p>`, ok: "Move to Trash", danger: true });
  if (!ok) return;
  try {
    A.data = await api("apps/trash", { name });
    A.picked.delete(name);
    toast("Moved to the Trash");
  } catch (error) {
    toast(error.message, 3500);
  }
  render();
}

function upload(file, replace) {
  return new Promise((resolve, reject) => {
    const entry = { name: file.name, size: file.size || 1, sent: 0, error: "" };
    A.uploads.push(entry);
    render();
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/apps/upload?name=${encodeURIComponent(file.name)}${replace ? "&replace=1" : ""}`);
    xhr.setRequestHeader("X-Manager-Token", TOKEN);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    let drawn = 0;
    xhr.upload.onprogress = (e) => { entry.sent = e.loaded; if (Date.now() - drawn > 150) { drawn = Date.now(); render(); } };
    const fail = (message) => { entry.error = message; render(); reject(new Error(message)); };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status !== 200) return fail(body.error || `Adding failed (${xhr.status})`);
      A.uploads.splice(A.uploads.indexOf(entry), 1);
      resolve(body);
    };
    xhr.onerror = () => fail("The copy was interrupted.");
    xhr.send(file);
  });
}

async function addFiles(list) {
  const files = [...list];
  const usable = files.filter((f) => PACKAGE.test(f.name));
  const skipped = files.length - usable.length;
  if (skipped) toast(`${plural(skipped, "file")} skipped: not a MustardOS package`, 3000);
  let added = 0;
  for (const file of usable) {
    let replace = false;
    if (A.data?.packages.some((p) => sameName(p.name, file.name))) {
      replace = await confirmBox({ title: `Replace ${file.name}?`, html: `<p>The apps folder already has a package with this name. The old one goes to the Trash.</p>`, ok: "Replace" });
      if (!replace) continue;
    }
    try {
      await upload(file, replace);
      added++;
    } catch {}
  }
  if (added) toast(`Added ${plural(added, "package")}`, 2400);
  await load();
}

function bind() {
  A.bound = true;
  const view = $("view-apps");
  addEventListener("job-finished", (e) => onJobFinished(e.detail));
  view.addEventListener("click", (e) => {
    const el = e.target.closest("[data-ap]");
    if (!el || el.disabled) return;
    const { ap, name, path } = el.dataset;
    if (ap === "add") $("apps-files").click();
    else if (ap === "refresh") { load(); loadDevice(); }
    else if (ap === "reveal") api("settings/reveal", { which: "apps" }).catch((error) => toast(error.message, 3000));
    else if (ap === "send") send([name], false);
    else if (ap === "send-install") send([name], true);
    else if (ap === "send-picked") send([...A.picked], false);
    else if (ap === "send-install-picked") send([...A.picked].filter((n) => A.data.packages.find((p) => p.name === n)?.installs), true);
    else if (ap === "install") install(path, name);
    else if (ap === "device-delete") deleteOnDevice(path, name);
    else if (ap === "uninstall") uninstall(name);
    else if (ap === "trash") trash(name);
    else if (ap === "all") { for (const p of A.data.packages) if (!broken(p)) A.picked.add(p.name); render(); }
    else if (ap === "none") { A.picked.clear(); render(); }
    else if (ap === "dismiss") { A.uploads = A.uploads.filter((u) => u.name !== name || !u.error); render(); }
    else if (ap === "close-install") { A.install = null; render(); }
    else if (ap === "reboot") {
      confirmBox({ title: "Restart the handheld?", html: "<p>It restarts now. Unsaved game progress is lost.</p>", ok: "Restart" }).then((ok) => {
        if (ok) api("ssh/power", { action: "reboot" }).then(() => toast("Restarting the handheld", 2600), (error) => toast(error.message, 3500));
      });
    }
  });
  view.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "apps-files") { addFiles(t.files); t.value = ""; return; }
    if (t.dataset.apPick) { if (t.checked) A.picked.add(t.dataset.apPick); else A.picked.delete(t.dataset.apPick); render(); }
  });
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  view.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; view.classList.add("apps-drop"); });
  view.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  view.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; view.classList.remove("apps-drop"); } });
  view.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    view.classList.remove("apps-drop");
    addFiles(e.dataTransfer.files);
  });
}
