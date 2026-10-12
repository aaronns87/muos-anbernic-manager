// Ports: the PortMaster platform in Games. Browse the PortMaster library, install and remove ports with the handheld's own
// PortMaster over Wi-Fi, and copy your own game files into ports that need them.

import { $, api, esc, human, icon, ICONS, plural, store, toast, TOKEN } from "./core.js";
import { confirmBox } from "./art-images.js";
import { consoleIcon } from "./consoles.js";
import { renderCurrent } from "./views.js";

const P = {
  data: null, loading: false, error: "", q: "", fit: store.get("portFit", true), rtr: store.get("portRtr", false),
  genre: "all", sort: "title", limit: 60, bound: false, poll: 0, view: "", upload: null, busy: false,
};

const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
const shotUrl = (name) => `/api/ports/shot?${qs({ name, token: TOKEN })}`;
const device = () => P.data?.device || null;
const ports = () => P.data?.catalogue.ports || [];
const byName = (name) => ports().find((p) => p.name.toLowerCase() === String(name).toLowerCase()) || null;
const installed = (name) => device()?.installed.find((p) => p.name.toLowerCase() === String(name).toLowerCase()) || null;
const task = () => P.data?.task || null;
const running = () => task()?.state === "running";
const blocked = () => !device() || running() || !!P.upload || P.busy;

async function load(refresh = false) {
  if (P.loading) return;
  P.loading = true;
  P.error = "";
  redraw();
  try {
    P.data = await api(`ports${refresh ? "?refresh=1" : ""}`);
    if (running()) watch();
  } catch (error) {
    P.error = error.message;
  }
  P.loading = false;
  redraw();
}

function redraw() {
  renderCurrent();
  if ($("portmaster").open) renderBrowser();
  if ($("portview").open && P.view) renderView();
}

// ---------------------------------------------------------------- the Ports section in Games

const shot = (p, cls = "") => p?.shot
  ? `<img loading="lazy" src="${shotUrl(p.name)}" alt="" class="pm-img${cls}">`
  : `<span class="th-none">${consoleIcon("PORTS")}</span>`;

function taskBar() {
  const t = task();
  if (!t || (t.state !== "running" && Date.now() - t.started > 10 * 60_000)) return "";
  const cls = t.state === "failed" ? " err" : t.state === "done" ? " ok" : "";
  const what = t.state === "running" ? `${ICONS.spin} Installing <b>${esc(t.title)}</b>` : t.state === "done" ? `${icon("check")} <b>${esc(t.title)}</b> is installed` : `<b>${esc(t.title)}</b> did not install`;
  const line = t.state === "failed" ? t.error : t.state === "running" ? t.line : "";
  return `<div class="notice pm-task${cls}">${what}${line ? `<span class="pm-line">${esc(line)}</span>` : ""}</div>`;
}

/** The Ports system in Games: the ports installed on the handheld, from PortMaster. */
export function portsSection({ accent, collapsed, chevron, q = "", localFiles = 0 }) {
  if (!P.bound) bind();
  if (!P.data && !P.loading && !P.error) load();
  const dev = device(), list = (dev?.installed || []).filter((p) => !q || p.title.toLowerCase().includes(q) || p.name.includes(q));
  if (q && !list.length) return "";
  const known = new Set((dev?.installed || []).flatMap((p) => p.items.map((i) => i.toLowerCase())));
  const others = (dev?.scripts || []).filter((s) => !known.has(s.toLowerCase()));
  let body;
  if (P.error) body = `<div class="notice err">${esc(P.error)}</div>`;
  else if (!P.data) body = `<div class="empty-note"><span class="spinner"></span> Checking PortMaster on the handheld&hellip;</div>`;
  else if (!P.data.reachable) body = `<div class="empty-note">Connect the handheld over Wi-Fi with <b>Secure Shell</b> on (see <a href="#ssh">SSH</a>) to see and install ports. You can browse PortMaster now.</div>`;
  else if (P.data.deviceError) body = `<div class="notice err">${esc(P.data.deviceError)}</div>`;
  else if (!list.length) body = `<div class="empty-note">No ports on the handheld yet. <button class="btn small primary" data-pm="browse">${icon("web")}<span>Browse PortMaster</span></button></div>`;
  else body = `<div class="th-grid pm-grid">${list.map((p) => {
    const c = byName(p.name);
    return `<article class="th-card pm-card">
      <button class="th-shot" data-pm="view" data-name="${esc(p.name)}" title="About ${esc(p.title)}">${shot(c)}</button>
      <div class="th-meta"><b title="${esc(p.title)}">${esc(p.title)}</b><span><span class="th-badge">${human(p.kb * 1024)}</span>${c && !c.rtr ? `<span class="th-badge warn">Needs game files</span>` : ""}</span></div>
      <div class="th-acts">${c && !c.rtr ? `<button class="btn small" data-pm="view" data-name="${esc(p.name)}" data-files="1">${icon("upload")}<span>Add game files</span></button>` : `<button class="btn small" data-pm="view" data-name="${esc(p.name)}">About</button>`}
        <button class="btn small ghost danger" data-pm="uninstall" data-name="${esc(p.name)}"${blocked() ? " disabled" : ""} title="Remove it from the handheld">${icon("trash")}</button></div>
    </article>`;
  }).join("")}</div>`;
  const notes = [
    others.length ? `Also in ROMS/Ports, not from PortMaster: ${others.map(esc).join(", ")}` : "",
    localFiles ? `${plural(localFiles, "file")} in Roms/PORTS ${localFiles === 1 ? "is" : "are"} not copied; MustardOS installs ports with PortMaster.` : "",
    dev ? `On ${esc(dev.portsDir.startsWith("/mnt/sdcard") ? "TF2" : "TF1")} (${esc(dev.portsDir)}) &middot; ${human(dev.freeKb * 1024)} free` : "",
  ].filter(Boolean);
  const size = (dev?.installed || []).reduce((a, p) => a + p.kb * 1024, 0);
  return `<section class="system pm-sec${collapsed ? " collapsed" : ""}" id="sys-PORTS" data-code="PORTS" style="--accent:${accent}">
    <header class="system-head">
      <div class="sys-ico">${consoleIcon("PORTS")}</div>
      <div class="system-title"><h2>Ports <span class="code">PortMaster</span></h2><p>Native PC game ports &middot; installed on the handheld by PortMaster over Wi-Fi</p></div>
      <div class="system-stats">
        <div><b>${dev ? dev.installed.length : "&ndash;"}</b>installed</div>
        <div><b>${dev ? human(size) : "&ndash;"}</b>size</div>
        <div><b>${P.data ? ports().filter((p) => p.fits).length.toLocaleString() : "&ndash;"}</b>in PortMaster</div>
      </div>
      <button class="btn small primary pm-browse" data-pm="browse" title="Browse and install ports from PortMaster">${icon("web")}<span>Browse</span></button>
      ${chevron}
    </header>
    <div class="pm-body">${taskBar()}${body}${notes.length ? `<p class="muted-note pm-notes">${notes.join("<br>")}</p>` : ""}</div>
  </section>`;
}

// ---------------------------------------------------------------- the PortMaster browser

const SORTS = [["title", "Title A-Z"], ["new", "Newest first"], ["updated", "Recently updated"], ["small", "Smallest first"]];

function genres() {
  const count = new Map();
  for (const p of ports()) for (const g of p.genres) count.set(g, (count.get(g) || 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1]);
}

function browseList() {
  const q = P.q.trim().toLowerCase();
  const list = ports().filter((p) => (!P.fit || p.fits) && (!P.rtr || p.rtr) && (P.genre === "all" || p.genres.includes(P.genre))
    && (!q || p.title.toLowerCase().includes(q) || p.name.includes(q) || p.porter.some((x) => x.toLowerCase().includes(q))));
  if (P.sort === "new") list.sort((a, b) => b.added.localeCompare(a.added));
  else if (P.sort === "updated") list.sort((a, b) => b.updated.localeCompare(a.updated));
  else if (P.sort === "small") list.sort((a, b) => a.size - b.size);
  return list;
}

function badges(p) {
  return [
    installed(p.name) ? `<span class="th-badge ok">Installed</span>` : "",
    p.rtr ? `<span class="th-badge ok">Ready to run</span>` : `<span class="th-badge warn" title="Needs files from your own copy of the game">Needs game files</span>`,
    p.fits ? "" : `<span class="th-badge warn" title="PortMaster does not offer it for this handheld">${esc(p.why)}</span>`,
    p.genres[0] ? `<span class="th-badge">${esc(p.genres[0])}</span>` : "",
    p.size ? `<span class="th-badge">${human(p.size)}</span>` : "",
  ].join("");
}

function installButton(p, compact = false) {
  const t = task();
  if (t?.state === "running" && t.name === p.name) return `<button class="btn small" disabled>${ICONS.spin}<span>Installing&hellip;</span></button>`;
  if (installed(p.name)) return compact ? `<span class="pill ok">${icon("check")} Installed</span>`
    : `<button class="btn small ghost" data-pm="install" data-name="${esc(p.name)}"${blocked() ? " disabled" : ""} title="Install it again with PortMaster">${icon("refresh")}<span>Reinstall</span></button>`;
  return `<button class="btn small primary" data-pm="install" data-name="${esc(p.name)}"${blocked() || !p.fits ? " disabled" : ""} title="${p.fits ? "Install it on the handheld with PortMaster" : esc(p.why)}">${icon("download")}<span>Install</span></button>`;
}

export function openPortMaster() {
  if (!P.bound) bind();
  if (!P.data && !P.loading) load();
  renderBrowser();
  if (!$("portmaster").open) $("portmaster").showModal();
}

function renderBrowser() {
  const main = $("pm-main"), foot = $("pm-foot");
  const dev = device();
  foot.innerHTML = `<div class="ag-foot-sum">${P.data ? (dev ? `<span>${icon("handheld")} ${plural(dev.installed.length, "port")} on the handheld &middot; ${human(dev.freeKb * 1024)} free</span>`
    : `<span class="warn">${icon("handheld")} ${P.data.reachable ? esc(P.data.deviceError || "Handheld not ready") : "Connect the handheld over Wi-Fi with SSH to install"}</span>`) : ""}</div>
    <button class="btn" data-pm="refresh"${P.loading ? " disabled" : ""} title="Load the PortMaster list and the handheld again">${P.loading ? ICONS.spin : icon("refresh")}<span>Refresh</span></button>
    <button class="btn" data-pm="close-browser">Close</button>`;
  if (P.error) return void (main.innerHTML = `<div class="notice err">${esc(P.error)}</div>`);
  if (!P.data) return void (main.innerHTML = `<div class="planning"><span class="spinner"></span> Loading the PortMaster list&hellip;</div>`);
  const c = P.data.catalogue;
  if (!c.ports.length) return void (main.innerHTML = `<div class="notice${c.error ? " err" : ""}">${esc(c.error || "The PortMaster list is empty.")}</div>`);
  const list = browseList(), shown = list.slice(0, P.limit);
  const keep = main.querySelector(".pm-scroll")?.scrollTop || 0;
  main.innerHTML = `<div class="pm-scroll">${taskBar()}
    ${c.error ? `<div class="notice">${esc(c.error)} Showing the list from ${esc(new Date(c.fetched).toLocaleDateString())}.</div>` : ""}
    <div class="th-bar">
      <label class="search small">${icon("search")}<input type="search" data-pm-q placeholder="Search ${c.ports.length.toLocaleString()} ports or porters" value="${esc(P.q)}" aria-label="Search ports"></label>
      <select class="control" data-pm-genre aria-label="Genre"><option value="all">Any genre</option>${genres().map(([g, n]) => `<option value="${esc(g)}"${g === P.genre ? " selected" : ""}>${esc(g[0].toUpperCase() + g.slice(1))} (${n})</option>`).join("")}</select>
      <select class="control" data-pm-sort aria-label="Sort">${SORTS.map(([v, l]) => `<option value="${v}"${v === P.sort ? " selected" : ""}>${l}</option>`).join("")}</select>
      <label class="switch" title="Only ports that come with everything they need"><input type="checkbox" data-pm-rtr role="switch"${P.rtr ? " checked" : ""}><span class="switch-track"></span>Ready to run</label>
      <label class="switch" title="Only ports PortMaster offers for this handheld"><input type="checkbox" data-pm-fit role="switch"${P.fit ? " checked" : ""}><span class="switch-track"></span>Runs on this handheld</label>
      <span class="muted-note">${list.length === c.ports.length ? plural(list.length, "port") : `${list.length.toLocaleString()} of ${c.ports.length.toLocaleString()}`}</span>
    </div>
    ${shown.length ? `<div class="th-grid pm-grid">${shown.map((p) => `<article class="th-card pm-card${installed(p.name) ? " have" : ""}">
        <button class="th-shot" data-pm="view" data-name="${esc(p.name)}" title="About ${esc(p.title)}">${shot(p)}</button>
        <div class="th-meta"><b title="${esc(p.title)}">${esc(p.title)}</b><span>${badges(p)}</span></div>
        <div class="th-acts">${installButton(p, true)}<button class="btn small ghost" data-pm="view" data-name="${esc(p.name)}">About</button></div>
      </article>`).join("")}</div>` : `<div class="empty-state">${consoleIcon("PORTS")}<b>No ports match</b><p>Try another search or genre.</p></div>`}
    ${list.length > shown.length ? `<div class="th-more"><button class="btn" data-pm="more">Show ${Math.min(60, list.length - shown.length)} more</button></div>` : ""}
    <p class="muted-note">Ports come from the PortMaster library (portmaster.games), the same list as the PortMaster app on the handheld.
      Installing has the handheld download the port and any runtime it needs, so it needs internet access over Wi-Fi.</p></div>`;
  main.querySelector(".pm-scroll").scrollTop = keep;
}

// ---------------------------------------------------------------- one port

function guessFolder(p, dir) {
  const m = new RegExp(`(?:^|[\\s/"'])${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([\\w./-]+)`, "i").exec(p?.inst || "");
  return m ? m[1].replace(/[./]+$/, "") : "";
}

function openView(name, files = false) {
  P.view = name;
  renderView();
  if (!$("portview").open) $("portview").showModal();
  if (files) $("pmv-body").querySelector(".pm-files")?.scrollIntoView({ block: "nearest" });
}

function renderView() {
  const p = byName(P.view), have = installed(P.view);
  const title = p?.title || have?.title || P.view;
  $("pmv-title").textContent = title;
  $("pmv-sub").innerHTML = p ? [p.porter.length ? `Ported by ${esc(p.porter.join(", "))}` : "", p.genres.map(esc).join(", ")].filter(Boolean).join(" &middot; ") : "Not in the PortMaster list";
  const facts = p ? [
    ["Download", p.size ? human(p.size) : ""], ["Runtime", p.runtime.map((r) => r.replace(/\.squashfs$/, "")).join(", ")],
    ["Game", p.avail === "paid" ? "Bought separately" : p.avail === "free" ? "Free game files" : p.avail === "full" ? "Included" : p.avail === "demo" ? "Demo included" : p.rtr ? "Included" : ""],
    ["Added", p.added], ["Updated", p.updated !== p.added ? p.updated : ""],
    ["On the handheld", have ? `${esc(have.dir)}, ${human(have.kb * 1024)}` : ""],
  ].filter(([, v]) => v) : have ? [["On the handheld", `${esc(have.dir)}, ${human(have.kb * 1024)}`]] : [];
  const keep = $("pmv-body").querySelector("[data-pm-sub]")?.value;
  const sub = keep ?? guessFolder(p, have?.dir || "");
  const up = P.upload;
  $("pmv-body").innerHTML = `<div class="pmv-top">
      <div class="thv-stage pmv-stage">${p?.shot ? `<img class="thv-main pmv-img" src="${shotUrl(p.name)}" alt="Screenshot of ${esc(title)}">` : `<span class="th-none">${consoleIcon("PORTS")}</span>`}</div>
      <div class="pmv-text">
        ${p ? `<span class="pmv-badges">${badges(p)}</span>` : ""}
        ${p?.desc ? `<p>${esc(p.desc)}</p>` : ""}
        <dl class="pmv-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
        ${p?.store.length ? `<p class="pmv-store">${p.store.map((s) => `<a class="btn small" href="${esc(s.url)}" target="_blank" rel="noopener">${icon("web")}<span>${esc(s.name)}</span></a>`).join("")}</p>` : ""}
      </div></div>
    ${p?.inst ? `<div class="notice pmv-inst"><b>${p.rtr ? "Notes" : "Game files"}</b><span>${esc(p.inst)}</span></div>` : ""}
    ${have && p && !p.rtr ? `<section class="panel pm-files">
      <b>Add game files</b>
      <p class="muted-note">Copies files from your own copy of the game into the port's folder on the handheld, over Wi-Fi. Files with the same name are replaced.</p>
      <div class="pm-files-row"><code>${esc(device().portsDir)}/${esc(have.dir)}/</code><input class="control" data-pm-sub value="${esc(sub)}" placeholder="folder inside the port (empty for the top)" aria-label="Folder inside the port" spellcheck="false"${up ? " disabled" : ""}></div>
      <div class="pm-files-row">
        <button class="btn small primary" data-pm="pick-files"${up || running() ? " disabled" : ""}>${icon("upload")}<span>Choose files&hellip;</span></button>
        <button class="btn small" data-pm="pick-folder"${up || running() ? " disabled" : ""}>${icon("folder")}<span>Choose a folder&hellip;</span></button>
        ${up ? `<span class="pm-up">${ICONS.spin} ${up.done} of ${plural(up.total, "file")} &middot; ${human(up.bytes)} of ${human(up.size)}${up.stop ? "" : ` <button class="btn small ghost" data-pm="stop-upload">Stop</button>`}</span>` : ""}
      </div></section>` : ""}`;
  const t = task();
  const status = t?.state === "running" && t.name === p?.name ? `${ICONS.spin} ${esc(t.line || "Installing")}`
    : !device() ? "Connect the handheld over SSH to install." : have ? "Installed on the handheld." : p && !p.fits ? esc(p.why) : "Not on the handheld yet.";
  $("pmv-foot").innerHTML = `<span class="muted-note pmv-status">${status}</span><span class="grow"></span>
    ${p ? installButton(p) : ""}
    ${have ? `<button class="btn small ghost danger" data-pm="uninstall" data-name="${esc(have.name)}"${blocked() ? " disabled" : ""} title="Remove it from the handheld">${icon("trash")}<span>Remove</span></button>` : ""}
    <button class="btn" data-pm="close-view">Close</button>`;
}

// ---------------------------------------------------------------- install, remove, game files

function watch() {
  clearTimeout(P.poll);
  P.poll = setTimeout(async () => {
    try {
      const { task: t } = await api("ports/task");
      const was = task();
      P.data.task = t;
      if (t?.state === "running") return watch(), redraw();
      if (was?.state === "running") {
        toast(t?.state === "done" ? `${t.title} is installed. Find it in Ports on the handheld.` : `${t?.title || "The port"} did not install: ${t?.error || "unknown error"}`, 6000);
        return load();
      }
    } catch { watch(); }
    redraw();
  }, 2500);
}

async function install(name) {
  const p = byName(name), again = !!installed(name);
  if (!p) return;
  const needs = p.rtr ? "" : `<p><b>This port needs files from your own copy of the game.</b> ${esc(p.inst || "")}</p><p>Copy them afterwards with <b>Add game files</b> in its details.</p>`;
  if (!(await confirmBox({
    title: `${again ? "Reinstall" : "Install"} ${p.title}?`,
    html: `<p>The handheld's PortMaster downloads ${esc(p.title)}${p.size ? ` (${human(p.size)})` : ""} and installs it${p.runtime.length ? `, with the ${esc(p.runtime.map((r) => r.replace(/\.squashfs$/, "")).join(" and "))} runtime if it is missing` : ""}. The handheld needs internet access over Wi-Fi.</p>${needs}`,
    ok: again ? "Reinstall" : "Install",
  }))) return;
  try {
    const r = await api("ports/install", { name });
    P.data.task = r.task;
    toast(`Installing ${p.title} on the handheld.`, 2500);
    watch();
  } catch (error) { toast(error.message, 5000); }
  redraw();
}

async function uninstall(name) {
  const have = installed(name);
  if (!have) return;
  if (!(await confirmBox({
    title: `Remove ${have.title}?`,
    html: `<p>PortMaster removes ${esc(have.title)} from the handheld: the ${esc(have.dir)} folder (${human(have.kb * 1024)}), its launch script and artwork. Game files you copied into it go too. There is no Trash on the handheld.</p>`,
    ok: "Remove", danger: true,
  }))) return;
  P.busy = true;
  redraw();
  try {
    P.data = await api("ports/uninstall", { name: have.name });
    toast(`${have.title} is removed from the handheld.`, 3000);
    if (P.view && !byName(P.view) && $("portview").open) $("portview").close();
  } catch (error) { toast(error.message, 5000); }
  P.busy = false;
  redraw();
}

function putFile(file, dir, rel, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    P.upload.xhr = xhr;
    xhr.open("PUT", `/api/ports/upload?${qs({ dir, path: rel })}`);
    xhr.setRequestHeader("X-Manager-Token", TOKEN);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status === 200) resolve(body); else reject(new Error(body.error || `Copy failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("The copy was interrupted."));
    xhr.onabort = () => reject(new Error("Stopped."));
    xhr.send(file);
  });
}

const JUNK = /^(\.ds_store|thumbs\.db|desktop\.ini)$|^\._/i;

async function sendFiles(files) {
  const have = installed(P.view);
  if (!have || !files.length || P.upload) return;
  const sub = ($("pmv-body").querySelector("[data-pm-sub]")?.value || "").trim().replace(/^\/+|\/+$/g, "");
  if (sub.split("/").some((s) => s === ".." || s === ".")) return toast("Use a folder inside the port.", 4000);
  const list = files.filter((f) => !JUNK.test(f.name)).map((f) => [f, [sub, f.webkitRelativePath || f.name].filter(Boolean).join("/")]);
  if (!list.length) return;
  const size = list.reduce((a, [f]) => a + f.size, 0);
  if (!(await confirmBox({ title: `Copy ${plural(list.length, "file")} to ${have.title}?`, html: `<p>${human(size)} goes into <code>${esc(have.dir)}/${esc(sub)}</code> on the handheld, over Wi-Fi. Files with the same name are replaced.</p>`, ok: "Copy" }))) return;
  P.upload = { done: 0, total: list.length, bytes: 0, size, stop: false, xhr: null };
  renderView();
  let sent = 0, failed = "";
  for (const [file, rel] of list) {
    if (P.upload.stop) break;
    try {
      await putFile(file, have.dir, rel, (n) => { P.upload.bytes = sent + n; updateUpload(); });
      sent += file.size;
      P.upload.done++;
      updateUpload();
    } catch (error) { failed = error.message; break; }
  }
  const done = P.upload.done;
  P.upload = null;
  toast(failed ? `Copied ${done} of ${plural(list.length, "file")}. ${failed}` : `Copied ${plural(done, "file")} to ${have.title}.`, failed ? 6000 : 3500);
  load();
}

let uploadFrame = 0;
function updateUpload() {
  if (uploadFrame) return;
  uploadFrame = requestAnimationFrame(() => { uploadFrame = 0; if ($("portview").open && P.upload) renderView(); });
}

// ---------------------------------------------------------------- events

function bind() {
  P.bound = true;
  const click = (e) => {
    const el = e.target.closest("[data-pm]");
    if (!el || el.disabled) return;
    e.stopPropagation();
    const { pm, name } = el.dataset;
    if (pm === "browse") openPortMaster();
    else if (pm === "view") openView(name, el.dataset.files === "1");
    else if (pm === "install") install(name);
    else if (pm === "uninstall") uninstall(name);
    else if (pm === "refresh") load(true);
    else if (pm === "more") { P.limit += 60; renderBrowser(); }
    else if (pm === "close-browser") $("portmaster").close();
    else if (pm === "close-view") $("portview").close();
    else if (pm === "pick-files") $("pm-files").click();
    else if (pm === "pick-folder") $("pm-folder").click();
    else if (pm === "stop-upload" && P.upload) { P.upload.stop = true; P.upload.xhr?.abort(); }
  };
  $("games-list").addEventListener("click", click, true);
  $("portmaster").addEventListener("click", click);
  $("portview").addEventListener("click", click);
  $("pm-close").addEventListener("click", () => $("portmaster").close());
  $("pmv-close").addEventListener("click", () => $("portview").close());
  $("portview").addEventListener("close", () => { if (!P.upload) P.view = ""; });
  $("portview").addEventListener("cancel", (e) => { if (P.upload) e.preventDefault(); });
  for (const id of ["pm-files", "pm-folder"]) {
    $(id).addEventListener("change", (e) => { const files = [...e.target.files]; e.target.value = ""; sendFiles(files); });
  }
  const noShot = (e) => {
    if (e.target.matches?.("img.pm-img, img.pmv-img")) e.target.replaceWith(Object.assign(document.createElement("span"), { className: "th-none", innerHTML: consoleIcon("PORTS") }));
  };
  for (const el of [$("games-list"), $("portmaster"), $("portview")]) el.addEventListener("error", noShot, true);
  $("portmaster").addEventListener("input", (e) => {
    if (!e.target.matches("[data-pm-q]")) return;
    P.q = e.target.value;
    P.limit = 60;
    const at = e.target.selectionStart;
    renderBrowser();
    const input = $("portmaster").querySelector("[data-pm-q]");
    input.focus();
    input.setSelectionRange(at, at);
  });
  $("portmaster").addEventListener("change", (e) => {
    if (e.target.matches("[data-pm-fit]")) store.set("portFit", (P.fit = e.target.checked));
    else if (e.target.matches("[data-pm-rtr]")) store.set("portRtr", (P.rtr = e.target.checked));
    else if (e.target.matches("[data-pm-genre]")) P.genre = e.target.value;
    else if (e.target.matches("[data-pm-sort]")) P.sort = e.target.value;
    else return;
    P.limit = 60;
    renderBrowser();
  });
}
