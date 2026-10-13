// App market in Apps: popular MustardOS apps that publish packages on GitHub, with screenshots, release notes and what
// suits the chosen handheld. Getting an app downloads its package into the apps folder; sending and installing reuse Apps.

import { $, api, esc, formatDate, human, icon, ICONS, plural, store, toast, TOKEN, model } from "./core.js";
import { appsForMarket, reloadApps, sendFromMarket } from "./apps.js";
import { managerInfo } from "./manager-update.js";

const M = { data: null, loading: false, error: "", model: "", q: "", cat: "all", sort: "popular", fit: store.get("marketFit", true), view: "", img: 0, getting: "", bound: false };
const SORTS = [["popular", "Most stars"], ["updated", "Recently released"], ["title", "Title A-Z"]];
const STAR = "\u2605";

const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
const imageUrl = (a, n = 0) => `/api/market/image?${qs({ repo: a.repo, n, token: TOKEN })}`;
const apps = () => M.data?.apps || [];
const byRepo = (repo) => apps().find((a) => a.repo === repo) || null;
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const day = (d) => (d ? formatDate(new Date(d), "long") : "");

/** The package of this app already in the apps folder, preferring the recommended one. */
function local(a) {
  const names = new Set(appsForMarket().packages.map((p) => p.name.toLowerCase()));
  const assets = a.release?.assets || [];
  return assets.find((x) => x.name === a.pick && names.has(x.name.toLowerCase()))?.name || assets.find((x) => names.has(x.name.toLowerCase()))?.name || "";
}

/** Installed on the handheld: true, false, or null when the handheld cannot be asked. */
function installed(a) {
  const st = appsForMarket();
  if (!st.deviceApps) return null;
  const folders = new Set(st.deviceApps.map(norm));
  const fromPackage = st.packages.find((p) => p.name === local(a))?.apps || [];
  return [a.folder, a.title, a.repo.split("/")[1], ...fromPackage].filter(Boolean).some((n) => folders.has(norm(n)));
}

async function load(refresh = false) {
  if (M.loading) return;
  M.loading = true;
  M.error = "";
  render();
  try {
    M.model = model().id;
    M.data = await api(`market?model=${encodeURIComponent(M.model)}${refresh ? "&refresh=1" : ""}`);
  } catch (error) {
    M.error = error.message;
  }
  M.loading = false;
  render();
}

export function openAppMarket() {
  if (!M.bound) bind();
  if ((!M.data || M.model !== model().id) && !M.loading) load();
  renderMarket();
  if (!$("appmarket").open) $("appmarket").showModal();
}

function render() {
  if ($("appmarket").open) renderMarket();
  if ($("appview").open && M.view) renderView();
}

// ---------------------------------------------------------------- the list

function badges(a, compact = false) {
  const on = installed(a), have = local(a);
  return [
    on ? `<span class="th-badge ok">Installed</span>` : have ? `<span class="th-badge ok" title="${esc(have)}">In the apps folder</span>` : "",
    a.fit !== "yes" ? `<span class="th-badge warn" title="${esc(a.why.join(". "))}">${esc(a.why[0] || "Check first")}</span>` : "",
    a.release?.pre ? `<span class="th-badge warn">Pre-release</span>` : "",
    `<span class="th-badge">${esc(a.category)}</span>`,
    a.stars ? `<span class="th-badge" title="Stars on GitHub">${STAR} ${a.stars.toLocaleString()}</span>` : "",
    !compact && a.release ? `<span class="th-badge">${esc(a.release.tag)}</span>` : "",
  ].join("");
}

const shot = (a, cls = "") => a.images
  ? `<img loading="lazy" src="${imageUrl(a)}" alt="" class="am-img${cls}">`
  : `<span class="th-none">${icon("package")}</span>`;

function mainButton(a, small = true) {
  const sz = small ? " small" : "";
  if (M.getting && a.release?.assets.some((x) => x.name === M.getting)) return `<button class="btn${sz}" disabled>${ICONS.spin}<span>Downloading&hellip;</span></button>`;
  if (installed(a)) return "";
  const have = local(a), st = appsForMarket();
  if (have) return `<button class="btn${sz} primary" data-am="send" data-repo="${esc(a.repo)}"${st.canSend ? "" : ` disabled title="${esc(st.target)}"`}>${icon("upload")}<span>Send</span></button>`;
  if (!a.pick) return `<button class="btn${sz}" data-am="view" data-repo="${esc(a.repo)}" title="${esc(a.why.join(". "))}">Choose&hellip;</button>`;
  return `<button class="btn${sz} primary" data-am="get" data-repo="${esc(a.repo)}" data-asset="${esc(a.pick)}"${M.getting || a.fit === "no" ? " disabled" : ""} title="Download ${esc(a.pick)} into the apps folder">${icon("download")}<span>Get</span></button>`;
}

const SELF = { title: "muOS Anbernic Manager", repo: "aaronns87/muos-anbernic-manager", desc: "You are using it. Games, artwork, apps, themes and saves for your handheld, all from this computer." };

function selfCard() {
  const q = M.q.trim().toLowerCase();
  if (M.cat !== "all" || (q && !`${SELF.title} ${SELF.desc} ${SELF.repo}`.toLowerCase().includes(q))) return "";
  const info = managerInfo(), home = info?.home || `https://github.com/${SELF.repo}`;
  return `<article class="th-card pm-card am-self">
    <a class="th-shot" href="${esc(home)}" target="_blank" rel="noopener" title="${SELF.title} on GitHub"><img src="/assets/favicon.svg" alt=""></a>
    <div class="th-meta"><b>${SELF.title}</b><small class="am-desc">${esc(SELF.desc)}</small>
      <span><span class="th-badge ok">Installed</span>${info?.version ? `<span class="th-badge">v${esc(info.version)}</span>` : ""}<span class="th-badge">Tools</span></span></div>
    <div class="th-acts"><a class="btn small primary" href="${esc(home)}" target="_blank" rel="noopener" title="A star helps other handheld owners find it">${icon("star")}<span>Star on GitHub</span></a></div>
  </article>`;
}

function listed() {
  const q = M.q.trim().toLowerCase();
  const list = apps().filter((a) => (!M.fit || a.fit !== "no") && (M.cat === "all" || a.category === M.cat)
    && (!q || `${a.title} ${a.desc} ${a.repo}`.toLowerCase().includes(q)));
  if (M.sort === "popular") list.sort((a, b) => b.stars - a.stars || a.title.localeCompare(b.title));
  else if (M.sort === "updated") list.sort((a, b) => (b.release?.date || "").localeCompare(a.release?.date || ""));
  else list.sort((a, b) => a.title.localeCompare(b.title));
  return list;
}

export function renderMarket() {
  if (!M.bound) return;
  const main = $("am-main"), foot = $("am-foot");
  const st = appsForMarket();
  foot.innerHTML = `<div class="ag-foot-sum"><span${st.canSend ? "" : ` class="warn"`}>${icon("handheld")} ${esc(st.target)}</span></div>
    <button class="btn" data-am="refresh"${M.loading ? " disabled" : ""} title="Check GitHub for new releases">${M.loading ? ICONS.spin : icon("refresh")}<span>Refresh</span></button>
    <button class="btn" data-am="close">Close</button>`;
  if (M.error && !M.data) return void (main.innerHTML = `<div class="notice err">${esc(M.error)}</div>`);
  if (!M.data) return void (main.innerHTML = `<div class="planning"><span class="spinner"></span> Checking the apps on GitHub&hellip;</div>`);
  const cats = [...new Set(apps().map((a) => a.category))].sort();
  const list = listed();
  const keep = main.querySelector(".pm-scroll")?.scrollTop || 0;
  main.innerHTML = `<div class="pm-scroll">
    ${M.data.error || M.error ? `<div class="notice">${esc(M.data.error || M.error)}</div>` : ""}
    <div class="th-bar">
      <label class="search small">${icon("search")}<input type="search" data-am-q placeholder="Search ${apps().length} apps" value="${esc(M.q)}" aria-label="Search apps"></label>
      <select class="control" data-am-cat aria-label="Category"><option value="all">Every category</option>${cats.map((c) => `<option value="${esc(c)}"${c === M.cat ? " selected" : ""}>${esc(c)} (${apps().filter((a) => a.category === c).length})</option>`).join("")}</select>
      <select class="control" data-am-sort aria-label="Sort">${SORTS.map(([v, l]) => `<option value="${v}"${v === M.sort ? " selected" : ""}>${l}</option>`).join("")}</select>
      <label class="switch" title="Hide apps that cannot run on the ${esc(M.data.model.name)}"><input type="checkbox" data-am-fit role="switch"${M.fit ? " checked" : ""}><span class="switch-track"></span>Runs on the ${esc(M.data.model.name)}</label>
      <span class="muted-note">${list.length === apps().length ? plural(list.length, "app") : `${list.length} of ${apps().length}`}</span>
    </div>
    ${list.length ? `<div class="th-grid pm-grid">${selfCard()}${list.map((a) => `<article class="th-card pm-card${installed(a) ? " have" : ""}">
        <button class="th-shot" data-am="view" data-repo="${esc(a.repo)}" title="About ${esc(a.title)}">${shot(a)}</button>
        <div class="th-meta"><b title="${esc(a.title)}">${esc(a.title)}</b><small class="am-desc">${esc(a.desc)}</small><span>${badges(a, true)}</span></div>
        <div class="th-acts">${mainButton(a)}<button class="btn small ghost" data-am="view" data-repo="${esc(a.repo)}">About</button></div>
      </article>`).join("")}</div>` : `<div class="empty-state">${icon("package")}<b>No apps match</b><p>Try another search or category.</p></div>`}
    <p class="muted-note">Apps come from their makers' GitHub releases, listed by the manager and the community App Downloader list.
      They are not checked by MustardOS; read an app's page before installing it.
      ${M.data.codename ? `The handheld runs MustardOS ${esc(M.data.codename)}.` : "Connect the handheld over SSH to match packages to its MustardOS release."}
      ${M.data.fetched ? `Checked ${esc(day(M.data.fetched))}.` : ""}</p></div>`;
  main.querySelector(".pm-scroll").scrollTop = keep;
}

// ---------------------------------------------------------------- one app

function openView(repo) {
  M.view = repo;
  M.img = 0;
  renderView();
  if (!$("appview").open) $("appview").showModal();
}

function renderView() {
  const a = byRepo(M.view);
  if (!a) return;
  const r = a.release, have = local(a), on = installed(a), st = appsForMarket();
  $("amv-title").textContent = a.title;
  $("amv-sub").innerHTML = [`by ${esc(a.repo.split("/")[0])}`, esc(a.category), a.stars ? `${STAR} ${a.stars.toLocaleString()} on GitHub` : "", a.license ? esc(a.license) : ""].filter(Boolean).join(" &middot; ");
  const pick = r?.assets.find((x) => x.name === a.pick);
  const facts = [
    ["Version", r ? `${esc(r.tag)}${r.pre ? " (pre-release)" : ""}` : "No MustardOS package"],
    ["Released", esc(day(r?.date))],
    ["Package", pick ? `${esc(pick.name)}${pick.size ? `, about ${human(pick.size)}` : ""}` : ""],
    ["Needs", a.needs.includes("wifi") ? "Wi-Fi" : ""],
    ["On the handheld", on === null ? "Connect over SSH to check" : on ? "Installed" : "Not installed"],
    ["Apps folder", have ? esc(have) : "Not downloaded"],
    ["Last change", esc(day(a.pushed))],
  ].filter(([, v]) => v);
  const strip = a.images > 1 ? `<div class="thv-strip am-strip">${Array.from({ length: a.images }, (_, n) =>
    `<button class="thv-thumb${n === M.img ? " on" : ""}" data-am="img" data-n="${n}" aria-label="Screenshot ${n + 1}"><img loading="lazy" src="${imageUrl(a, n)}" alt="" class="am-img"></button>`).join("")}</div>` : "";
  const links = [
    [`https://github.com/${a.repo}/releases`, "Releases"], [`https://github.com/${a.repo}`, "GitHub page"], [a.homepage, "Website"],
  ].filter(([u]) => u).map(([u, l]) => `<a class="btn small" href="${esc(u)}" target="_blank" rel="noopener">${icon("external")}<span>${l}</span></a>`).join("");
  const assets = (r?.assets || []).map((x) => {
    const there = st.packages.some((p) => p.name.toLowerCase() === x.name.toLowerCase());
    return `<div class="am-asset${x.fit === "other" ? " dim" : ""}">
      <div><b>${esc(x.name)}</b><small>${[x.size ? `about ${human(x.size)}` : "", x.fit === "best" && r.assets.length > 1 ? "Recommended" : "", esc(x.why)].filter(Boolean).join(" &middot; ")}</small></div>
      ${there ? `<span class="th-badge ok">In the apps folder</span>`
        : M.getting === x.name ? `<button class="btn small" disabled>${ICONS.spin}<span>Downloading&hellip;</span></button>`
        : `<button class="btn small${x.name === a.pick ? " primary" : ""}" data-am="get" data-repo="${esc(a.repo)}" data-asset="${esc(x.name)}"${M.getting ? " disabled" : ""}>${icon("download")}<span>Download</span></button>`}
    </div>`;
  }).join("");
  $("amv-body").innerHTML = `<div class="pmv-top">
      <div class="am-gallery"><div class="thv-stage pmv-stage">${a.images ? `<img class="thv-main pmv-img am-img" src="${imageUrl(a, M.img)}" alt="Screenshot of ${esc(a.title)}">` : `<span class="th-none">${icon("package")}</span>`}</div>${strip}</div>
      <div class="pmv-text">
        <span class="pmv-badges">${badges(a)}</span>
        ${a.desc ? `<p>${esc(a.desc)}</p>` : ""}
        ${a.why.length ? `<div class="notice${a.fit === "no" ? " err" : ""}">${a.why.map(esc).join(". ")}.</div>` : ""}
        <dl class="pmv-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
        <p class="pmv-store">${links}</p>
      </div></div>
    ${r?.notes ? `<section class="am-notes"><b>What's new in ${esc(r.tag)}</b><pre>${esc(r.notes)}</pre></section>` : ""}
    ${assets ? `<section class="am-assets"><b>Packages in this release</b>${assets}</section>` : ""}`;
  const status = on ? (have && st.canInstall ? "Installed on the handheld. Reinstall replaces it with the package in the apps folder." : "Installed on the handheld.") : have ? "In the apps folder. Send it to the handheld to install it."
    : a.fit === "no" ? esc(a.why[0] || "") : "Get downloads the package into the apps folder.";
  $("amv-foot").innerHTML = `<span class="muted-note pmv-status">${status}</span><span class="grow"></span>
    ${have && st.canInstall ? `<button class="btn small" data-am="send-install" data-repo="${esc(a.repo)}"${st.canSend ? "" : " disabled"} title="${on ? "Send it, then install it over the app on the handheld" : "Send it, then install it on the handheld"}">${icon("bolt")}<span>${on ? "Reinstall" : "Send and install"}</span></button>` : ""}
    ${mainButton(a)}
    <button class="btn" data-am="close-view">Close</button>`;
}

// ---------------------------------------------------------------- actions

async function get(repo, asset) {
  const a = byRepo(repo);
  if (!a || M.getting) return;
  M.getting = asset;
  render();
  try {
    const r = await api("market/download", { repo, asset });
    toast(`${r.name} is in the apps folder${r.size ? ` (${human(r.size)})` : ""}`, 3000);
  } catch (error) {
    toast(error.message, 5000);
  }
  M.getting = "";
  await reloadApps();
  render();
}

async function send(repo, thenInstall) {
  const a = byRepo(repo), name = a && local(a);
  if (!name) return;
  if (await sendFromMarket(name, thenInstall)) {
    $("appview").close();
    $("appmarket").close();
  }
}

function bind() {
  M.bound = true;
  const click = (e) => {
    const el = e.target.closest("[data-am]");
    if (!el || el.disabled) return;
    const { am, repo, asset } = el.dataset;
    if (am === "view") openView(repo);
    else if (am === "get") get(repo, asset);
    else if (am === "send") send(repo, false);
    else if (am === "send-install") send(repo, true);
    else if (am === "img") { M.img = Number(el.dataset.n) || 0; renderView(); }
    else if (am === "refresh") load(true);
    else if (am === "close") $("appmarket").close();
    else if (am === "close-view") $("appview").close();
  };
  $("appmarket").addEventListener("click", click);
  $("appview").addEventListener("click", click);
  $("am-close").addEventListener("click", () => $("appmarket").close());
  $("amv-close").addEventListener("click", () => $("appview").close());
  $("appview").addEventListener("close", () => { M.view = ""; });
  const noShot = (e) => {
    if (e.target.matches?.("img.am-img")) e.target.replaceWith(Object.assign(document.createElement("span"), { className: "th-none", innerHTML: icon("package") }));
  };
  for (const el of [$("appmarket"), $("appview")]) el.addEventListener("error", noShot, true);
  $("appmarket").addEventListener("input", (e) => {
    if (!e.target.matches("[data-am-q]")) return;
    M.q = e.target.value;
    const at = e.target.selectionStart;
    renderMarket();
    const input = $("appmarket").querySelector("[data-am-q]");
    input.focus();
    input.setSelectionRange(at, at);
  });
  $("appmarket").addEventListener("change", (e) => {
    if (e.target.matches("[data-am-fit]")) store.set("marketFit", (M.fit = e.target.checked));
    else if (e.target.matches("[data-am-cat]")) M.cat = e.target.value;
    else if (e.target.matches("[data-am-sort]")) M.sort = e.target.value;
    else return;
    renderMarket();
  });
}
