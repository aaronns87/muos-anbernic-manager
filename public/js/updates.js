// Updates panel in Apps: MustardOS releases against the handheld and the os folder, and app releases on GitHub.

import { $, api, esc, formatDate, human, icon, model, toast } from "./core.js";

const U = { data: null, error: "", loading: false, getting: "", changes: false, bound: false, onDownload: null };

const slug = () => model().name.toLowerCase().replace(/\s+/g, "-");

/** Shows the panel; onDownload runs after a package lands in the apps folder. */
export function showUpdates(onDownload) {
  U.onDownload = onDownload;
  if (!U.bound) bind();
  if (!U.data && !U.loading) check(false);
  render();
}

async function check(refresh) {
  U.loading = true;
  render();
  try {
    U.data = await api(`updates?device=${encodeURIComponent(slug())}${refresh ? "&refresh=1" : ""}`);
    U.error = "";
  } catch (error) {
    U.error = error.message;
  }
  U.loading = false;
  render();
}

const day = (d) => formatDate(new Date(d), "long");

function osBlock(o) {
  const cur = o.current;
  if (!cur) return `<p class="muted-note">The MustardOS release list could not be read.</p>`;
  const img = o.local.find((l) => l.official) || o.local[0];
  const imgNote = !img ? `No MustardOS ${esc(cur.ver)} image in the os folder.`
    : img.official && img.verified ? `${icon("check")}<span><b>${esc(img.name)}</b> in the os folder matches the official download.</span>`
    : img.official && img.verified === false ? `${icon("alert")}<span><b>${esc(img.name)}</b> does not match the official checksum; download it again.</span>`
    : `The os folder has <b>${esc(img.name)}</b>${img.version && img.version !== cur.ver ? ` (${esc(img.version)})` : ""}.`;
  const links = (l) => Object.entries(l).map(([k, v]) => `<a class="btn small" href="${esc(v)}" target="_blank" rel="noopener">${icon("external")}<span>${esc(k === "gofile" ? "GoFile" : k === "mega" ? "MEGA" : k)}</span></a>`).join("");
  let status;
  if (!o.runningVer) status = `<span class="set-chip">Connect over Wi-Fi with SSH on to compare with the handheld</span>`;
  else if (o.update) status = `<span class="set-chip warn">${icon("download")}${esc(cur.ver)} ${esc(cur.code)} is out; the handheld runs ${esc(o.runningVer)}</span>`;
  else status = `<span class="set-chip ok">${icon("check")}The handheld runs the current release (${esc(o.running)})</span>`;
  return `<div class="upd-block">
    <div class="upd-head">${icon("sd")}<div><b>MustardOS ${esc(cur.ver)} ${esc(cur.code)}</b><small>Current release${o.next ? ` &middot; ${esc(o.next.ver)} ${esc(o.next.code)} is in progress` : ""}</small></div></div>
    <div class="dev-chips">${status}</div>
    ${o.update ? `<div class="upd-ways">
      ${o.archiveFits && Object.keys(cur.updateLinks).length ? `<div><b>Update in place</b><p class="muted-note">An Archive Manager update made for ${esc(cur.updateFrom.join(", "))}, which your handheld runs. Download it, add it here with <b>Add packages</b>, then send and install it. Saves and settings stay.</p><div class="upd-links">${links(cur.updateLinks)}</div></div>` : ""}
      <div><b>Fresh install</b><p class="muted-note">Write the full image to SD1 in <a href="#system">System Tools</a>. Back up your saves first; SD1 is erased.</p>
        ${o.image ? `<div class="upd-links">${links(o.image.links)}</div>` : ""}</div>
    </div>` : ""}
    <p class="muted-note upd-img">${imgNote}</p>
    ${cur.notes.length ? `<div class="notice">${cur.notes.map(esc).join("<br>")}</div>` : ""}
    <button class="link-btn" data-up="changes">${U.changes ? "Hide the changes" : `What changed in ${esc(cur.ver)} (${cur.changes.length})`}</button>
    ${U.changes ? `<ul class="upd-changes">${cur.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
  </div>`;
}

function appRow(a) {
  const l = a.latest;
  const state = {
    update: `<span class="set-chip warn">${icon("download")}${esc(l?.tag || "")} is newer than your ${esc(a.local)}</span>`,
    current: `<span class="set-chip ok">${icon("check")}Up to date (${esc(a.local)})</span>`,
    ahead: `<span class="set-chip" title="Your package is newer than the latest release on ${esc(a.repo)}">Your ${esc(a.local)} is newer than GitHub's ${esc(l?.tag || "")}</span>`,
    none: `<span class="set-chip">Not in the apps folder</span>`,
    unknown: `<span class="set-chip warn">${esc(a.error || "Not checked")}</span>`,
  }[a.state];
  const get = l && (a.state === "update" || a.state === "none") ? l.assets.map((x) => x.have
    ? `<span class="set-chip ok">${icon("check")}${esc(x.name)}</span>`
    : `<button class="btn small" data-up="get" data-repo="${esc(a.repo)}" data-asset="${esc(x.name)}"${U.getting ? " disabled" : ""}>${U.getting === x.name ? `<span class="spinner sm"></span><span>Downloading&hellip;</span>` : `${icon("download")}<span>${esc(x.name)}</span>`}<small>${human(x.size)}</small></button>`).join("") : "";
  return `<div class="upd-app">
    <div class="upd-app-name"><b>${esc(a.name)}</b><small>${l ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(a.repo)}</a> &middot; ${esc(l.tag)}, ${esc(day(l.date))}` : esc(a.repo)}</small></div>
    <div class="upd-app-chips">${state}${get}</div>
  </div>`;
}

function render() {
  const box = $("apps-updates");
  if (!box) return;
  const d = U.data;
  const head = `<h2>${icon("refresh")}Updates<span class="grow"></span>
    ${d?.checked ? `<span class="muted-note">Checked ${esc(day(d.checked))}</span>` : ""}
    <button class="btn small" data-up="check"${d?.checked ? ` title="Checked ${esc(day(d.checked))}"` : ""}${U.loading ? " disabled" : ""}>${U.loading ? `<span class="spinner sm"></span><span>Checking&hellip;</span>` : `${icon("refresh")}<span>Check now</span>`}</button></h2>`;
  if (!d) {
    box.innerHTML = `<section class="panel upd-panel">${head}${U.error ? `<div class="notice err">${esc(U.error)}</div>` : `<div class="planning"><span class="spinner"></span> Checking mustardos.github.io and GitHub&hellip;</div>`}</section>`;
    return;
  }
  box.innerHTML = `<section class="panel upd-panel">${head}
    ${d.error || U.error ? `<div class="notice err">${esc(d.error || U.error)}${d.checked ? " Showing the last check." : ""}</div>` : ""}
    <div class="upd-grid">${osBlock(d.os)}<div class="upd-block"><div class="upd-head">${icon("package")}<div><b>Apps</b><small>Latest releases on GitHub</small></div></div>
      ${d.apps.map(appRow).join("")}</div></div>
  </section>`;
}

async function download(repo, asset) {
  U.getting = asset;
  render();
  try {
    await api("updates/download", { repo, asset });
    toast(`${asset} is in the apps folder`, 2600);
    await check(false);
    U.onDownload?.();
  } catch (error) {
    toast(error.message, 4000);
  }
  U.getting = "";
  render();
}

function bind() {
  U.bound = true;
  $("apps-updates").addEventListener("click", (e) => {
    const el = e.target.closest("[data-up]");
    if (!el || el.disabled) return;
    if (el.dataset.up === "check") check(true);
    else if (el.dataset.up === "changes") { U.changes = !U.changes; render(); }
    else if (el.dataset.up === "get") download(el.dataset.repo, el.dataset.asset);
  });
}
