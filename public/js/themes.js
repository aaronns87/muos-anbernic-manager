// Themes: browse the MustardOS theme catalogue with previews, and install, apply and remove themes on the handheld.

import { $, api, esc, human, icon, ICONS, model, plural, store, toast, TOKEN } from "./core.js";
import { confirmBox } from "./art-images.js";

const TABS = [
  ["browse", "web", "Browse", "MustardOS themes from the community theme library, ready for the handheld"],
  ["device", "handheld", "On the handheld", "The themes installed on the handheld; apply one or remove the ones you do not use"],
];
const KINDS = [["all", "Any kind"], ["grid", "Grid menus"], ["language", "Language packs"], ["hdmi", "HDMI ready"]];
const T = { data: null, loading: false, error: "", q: "", fit: store.get("themeFit", true), kind: "all", sort: "name", busy: "", limit: 60, bound: false };

const tab = () => TABS.find((t) => t[0] === store.get("themesTab", "browse")) || TABS[0];
const res = () => T.data?.device?.res || model().screen.join("x");
const device = () => T.data?.device || null;
const installed = (name) => device()?.installed.find((t) => t.name === name) || null;
const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
const previewUrl = (name, kind = "png") => `/api/themes/preview?${qs({ name, res: res(), kind, token: TOKEN })}`;
const devicePreviewUrl = (name, n = "") => `/api/themes/device-preview?${qs({ name, res: res(), n, token: TOKEN })}`;

export function showThemes() {
  if (!T.bound) bind();
  if (!T.data && !T.loading) load();
  else render();
}

async function load(refresh = false) {
  T.loading = true;
  T.error = "";
  render();
  try {
    T.data = await api(`themes${refresh ? "?refresh=1" : ""}`);
  } catch (error) {
    T.error = error.message;
  }
  T.loading = false;
  render();
}

// ---------------------------------------------------------------- rendering

function render() {
  if ($("view-themes").hidden) return;
  const [id, , , sub] = tab();
  const d = device();
  $("th-tabs").innerHTML = TABS.map(([t, ico, label]) => `<button role="tab" data-th-tab="${t}" class="${t === id ? "on" : ""}" aria-selected="${t === id}">
    ${icon(ico)}<span>${label}</span>${t === "device" && d ? `<em class="tab-count">${d.installed.length}</em>` : ""}</button>`).join("");
  $("th-sub").textContent = sub;
  $("th-actions").innerHTML = `<button class="btn" data-th="refresh" title="Load the theme list and the handheld again"${T.loading || T.busy ? " disabled" : ""}>${T.loading ? ICONS.spin : icon("refresh")}<span>Refresh</span></button>`;
  const root = $("themes");
  if (T.error && !T.data) return void (root.innerHTML = `<div class="notice err">${esc(T.error)}</div>`);
  if (!T.data) return void (root.innerHTML = `<div class="planning"><span class="spinner"></span> Loading the theme list&hellip;</div>`);
  root.innerHTML = `${T.error ? `<div class="notice err">${esc(T.error)}</div>` : ""}${statusBar()}${id === "device" ? deviceTab() : browseTab()}`;
}

function statusBar() {
  const d = T.data, dev = device();
  if (!d.reachable) return `<div class="notice">Browse and preview freely. Installing and applying need the handheld over Wi-Fi with
    <b>Configuration &rsaquo; Web Services &rsaquo; Secure Shell</b> on; check the <a href="#ssh">SSH</a> section.</div>`;
  if (d.deviceError) return `<div class="notice err">${esc(d.deviceError)}</div>`;
  if (!dev) return "";
  const active = installed(dev.active);
  return `<section class="panel th-active">
    <button class="th-active-img" data-th="view" data-name="${esc(dev.active)}" data-where="device" title="Look closer">
      ${active ? `<img src="${devicePreviewUrl(dev.active)}" alt="" class="th-img">` : icon("palette")}</button>
    <div class="th-active-text"><small>Active on the handheld</small><b>${esc(dev.active || "None")}</b>
      <span>${active ? `${active.version ? `Made for ${esc(active.version)} &middot; ` : ""}${human(active.kb * 1024)}` : ""}${dev.res ? ` &middot; screen ${esc(dev.res)}` : ""} &middot; ${plural(dev.installed.length, "theme")} installed &middot; ${human(dev.freeKb * 1024)} free on SD1</span></div>
    ${T.busy ? `<span class="pill">${ICONS.spin} ${esc(T.busy)}</span>` : ""}
  </section>`;
}

function catalogueList() {
  const q = T.q.trim().toLowerCase();
  const list = T.data.catalogue.themes.filter((t) => (!T.fit || t.res.includes(res()))
    && (T.kind === "all" || t[T.kind]) && (!q || t.name.toLowerCase().includes(q)));
  if (T.sort === "installed") list.sort((a, b) => (installed(b.name) ? 1 : 0) - (installed(a.name) ? 1 : 0) || a.name.localeCompare(b.name));
  else list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function badges(t) {
  return [t.grid ? "Grid" : "", t.language ? "Language" : "", t.hdmi ? "HDMI" : ""].filter(Boolean).map((b) => `<span class="th-badge">${b}</span>`).join("");
}

function actions(name, inCatalogue, compact = false) {
  const dev = device(), have = installed(name), active = dev?.active === name, dis = !dev || T.busy ? " disabled" : "";
  const working = T.busy && T.busy.endsWith(name);
  if (working) return `<button class="btn small" disabled>${ICONS.spin}<span>${esc(T.busy.split(" ")[0])}&hellip;</span></button>`;
  const out = [];
  if (active) out.push(`<span class="pill ok">${icon("check")} Active</span>`);
  else if (have) out.push(`<button class="btn small primary" data-th="apply" data-name="${esc(name)}"${dis}>${icon("check")}<span>Apply</span></button>`);
  else if (inCatalogue) {
    out.push(`<button class="btn small primary" data-th="install" data-apply="1" data-name="${esc(name)}"${dis} title="Install it and make it the active theme">${icon("download")}<span>Install and apply</span></button>`);
    if (!compact) out.push(`<button class="btn small" data-th="install" data-name="${esc(name)}"${dis} title="Install it without changing the active theme">Install</button>`);
  }
  if (have && inCatalogue && !compact) out.push(`<button class="btn small ghost" data-th="install" data-reinstall="1" data-name="${esc(name)}"${dis} title="Download it again and replace the copy on the handheld">${icon("refresh")}<span>Reinstall</span></button>`);
  if (have && !active && !inCatalogue) out.push(`<button class="btn small ghost danger" data-th="delete" data-name="${esc(name)}"${dis} title="Delete it from the handheld">${icon("trash")}</button>`);
  return out.join("");
}

function browseTab() {
  const c = T.data.catalogue;
  if (!c.themes.length) return `<div class="notice${c.error ? " err" : ""}">${esc(c.error || "The theme list is empty.")}</div>`;
  const list = catalogueList(), shown = list.slice(0, T.limit);
  const fitting = c.themes.filter((t) => t.res.includes(res())).length;
  return `${c.error ? `<div class="notice">${esc(c.error)} Showing the list from ${esc(new Date(c.fetched).toLocaleDateString())}.</div>` : ""}
    <div class="th-bar">
      <label class="search small">${icon("search")}<input type="search" data-th-q placeholder="Search ${c.themes.length} themes" value="${esc(T.q)}" aria-label="Search themes"></label>
      <select class="control" data-th-fit aria-label="Screen size">
        <option value="1"${T.fit ? " selected" : ""}>Made for ${esc(model().name)} (${esc(res())}, ${fitting})</option>
        <option value="0"${T.fit ? "" : " selected"}>Every screen size (${c.themes.length})</option></select>
      <select class="control" data-th-kind aria-label="Kind">${KINDS.map(([v, l]) => `<option value="${v}"${v === T.kind ? " selected" : ""}>${l}</option>`).join("")}</select>
      <select class="control" data-th-sort aria-label="Sort"><option value="name"${T.sort === "name" ? " selected" : ""}>Name</option><option value="installed"${T.sort === "installed" ? " selected" : ""}>Installed first</option></select>
      <span class="muted-note">${list.length === c.themes.length ? plural(list.length, "theme") : `${list.length} of ${c.themes.length}`}</span>
    </div>
    ${shown.length ? `<div class="th-grid">${shown.map((t) => {
      const have = installed(t.name), active = device()?.active === t.name;
      return `<article class="th-card${active ? " active" : have ? " have" : ""}">
        <button class="th-shot" data-th="view" data-name="${esc(t.name)}" data-where="online" title="Preview ${esc(t.name)}">
          <img loading="lazy" src="${previewUrl(t.name)}" alt="" class="th-img"></button>
        <div class="th-meta"><b title="${esc(t.name)}">${esc(t.name)}</b><span>${badges(t)}${!t.res.includes(res()) ? `<span class="th-badge warn">${esc(t.res.join(", ") || "?")}</span>` : ""}${have && !active ? `<span class="th-badge ok">Installed</span>` : ""}</span></div>
        <div class="th-acts">${actions(t.name, true, true)}</div>
      </article>`;
    }).join("")}</div>` : `<div class="empty-state">${icon("palette")}<b>No themes match</b><p>Try another search or show every screen size.</p></div>`}
    ${list.length > shown.length ? `<div class="th-more"><button class="btn" data-th="more">Show ${Math.min(60, list.length - shown.length)} more</button></div>` : ""}
    <p class="muted-note">Themes come from the MustardOS theme library (theme.muos.dev), the same list as the handheld's Theme Download.</p>`;
}

function deviceTab() {
  const dev = device();
  if (!dev) return T.data.reachable ? "" : `<div class="empty-state">${icon("handheld")}<b>Handheld not connected</b></div>`;
  const known = new Set(T.data.catalogue.themes.map((t) => t.name));
  return `<div class="th-grid">${dev.installed.map((t) => `<article class="th-card${t.name === dev.active ? " active" : ""}">
      <button class="th-shot" data-th="view" data-name="${esc(t.name)}" data-where="device" title="Preview ${esc(t.name)}">
        <img loading="lazy" src="${devicePreviewUrl(t.name)}" alt="" class="th-img"></button>
      <div class="th-meta"><b title="${esc(t.name)}">${esc(t.name)}</b><span><span class="th-badge">${esc(t.version || "?")}</span><span class="th-badge">${human(t.kb * 1024)}</span>${known.has(t.name) ? `<span class="th-badge ok">In the library</span>` : ""}</span></div>
      <div class="th-acts">${actions(t.name, false)}</div>
    </article>`).join("")}</div>
    <p class="muted-note">Kept in MUOS/theme on SD1. Deleting a theme is permanent; there is no Trash on the handheld.</p>`;
}

// ---------------------------------------------------------------- the preview dialog

function openView(name, where) {
  const t = T.data.catalogue.themes.find((x) => x.name === name), have = installed(name);
  const fromDevice = where === "device" && have;
  $("thv-title").textContent = name;
  $("thv-sub").innerHTML = fromDevice ? `On the handheld${have.version ? ` &middot; made for ${esc(have.version)}` : ""} &middot; ${human(have.kb * 1024)}`
    : t ? `${esc(t.res.join(", ") || "Unknown screen size")}${t.grid ? " &middot; grid menus" : ""}${t.language ? " &middot; language pack" : ""}` : "";
  const shots = fromDevice ? ["", "0", "1"].map((n) => devicePreviewUrl(name, n)) : [previewUrl(name, "gif"), previewUrl(name)];
  $("thv-body").innerHTML = `<div class="thv-stage"><img class="thv-main" src="${shots[0]}" alt="Preview of ${esc(name)}"></div>
    ${fromDevice ? `<div class="thv-strip">${shots.map((s, i) => `<button class="thv-thumb${i ? "" : " on"}" data-src="${s}"><img src="${s}" alt=""></button>`).join("")}</div>` : ""}`;
  const main = $("thv-body").querySelector(".thv-main");
  main.onerror = () => {
    if (!fromDevice && main.src.includes("kind=gif")) main.src = shots[1];
    else main.replaceWith(Object.assign(document.createElement("div"), { className: "empty-state", innerHTML: `${icon("palette")}<b>No preview</b>` }));
  };
  $("thv-body").querySelectorAll(".thv-thumb img").forEach((img) => { img.onerror = () => img.closest(".thv-thumb").remove(); });
  footer(name, !!t);
  if (!$("themeview").open) $("themeview").showModal();
}

function footer(name, inCatalogue) {
  const have = installed(name);
  $("thv-foot").innerHTML = `<span class="muted-note">${device() ? (device().active === name ? "This is the active theme." : have ? "Installed on the handheld." : "Not on the handheld yet.") : "Connect the handheld over SSH to install."}</span>
    <span class="grow"></span>${actions(name, inCatalogue)}${have && inCatalogue && device()?.active !== name ? `<button class="btn small ghost danger" data-th="delete" data-name="${esc(name)}"${T.busy ? " disabled" : ""} title="Delete it from the handheld">${icon("trash")}</button>` : ""}
    <button class="btn" data-th="close">Close</button>`;
}

// ---------------------------------------------------------------- actions

async function run(label, fn) {
  T.busy = label;
  refresh();
  try { await fn(); } catch (error) { toast(error.message, 5000); }
  T.busy = "";
  refresh();
}

function refresh() {
  render();
  const name = $("thv-title").textContent;
  if ($("themeview").open && name) footer(name, T.data.catalogue.themes.some((t) => t.name === name));
}

const restartNote = `<p>The handheld's menu closes and comes back with the new theme a few seconds later, the same as picking it in
  <b>Configuration &rsaquo; Customisation &rsaquo; Theme Picker</b>. The boot logo changes with it.</p>`;

async function install(name, apply, reinstall) {
  if (apply && !(await confirmBox({ title: `Install and apply ${name}?`, html: `<p>The theme is downloaded, copied to MUOS/theme on SD1 and made the active theme.</p>${restartNote}`, ok: "Install and apply" }))) return;
  if (reinstall && !(await confirmBox({ title: `Reinstall ${name}?`, html: `<p>The copy on the handheld is replaced with a fresh download.${device()?.active === name ? " It is the active theme, so the menu restarts afterwards." : ""}</p>`, ok: "Reinstall" }))) return;
  run(`Installing ${name}`, async () => {
    const r = await api("themes/install", { name, apply: !!apply });
    T.data = r;
    toast(r.applied ? `${name} is installed. The handheld's menu restarts with it.` : `${name} is installed on the handheld.`, 4000);
    if (r.applied) setTimeout(() => { if (!T.busy) load(); }, 8000);
  });
}

async function apply(name) {
  if (!(await confirmBox({ title: `Apply ${name}?`, html: restartNote, ok: "Apply" }))) return;
  run(`Applying ${name}`, async () => {
    await api("themes/apply", { name });
    device().active = name;
    toast(`Applying ${name}. The handheld's menu restarts with it.`, 4000);
    setTimeout(() => { if (!T.busy) load(); }, 8000);
  });
}

async function remove(name) {
  if (!(await confirmBox({ title: `Delete ${name}?`, html: `<p>${esc(name)} is deleted from MUOS/theme on the handheld. This is permanent; you can install it again from Browse if it is in the library.</p>`, ok: "Delete", danger: true }))) return;
  run(`Deleting ${name}`, async () => {
    T.data = await api("themes/delete", { name });
    if ($("themeview").open && $("thv-title").textContent === name) $("themeview").close();
    toast(`${name} is deleted from the handheld.`, 3000);
  });
}

function bind() {
  T.bound = true;
  const view = $("view-themes"), dialog = $("themeview");
  const click = (e) => {
    const t = e.target.closest("[data-th-tab]");
    if (t) { store.set("themesTab", t.dataset.thTab); return render(); }
    const el = e.target.closest("[data-th]");
    if (!el || el.disabled) return;
    const { th, name } = el.dataset;
    if (th === "refresh") load(true);
    else if (th === "more") { T.limit += 60; render(); }
    else if (th === "view") openView(name, el.dataset.where);
    else if (th === "install") install(name, el.dataset.apply === "1", el.dataset.reinstall === "1");
    else if (th === "apply") apply(name);
    else if (th === "delete") remove(name);
    else if (th === "close") dialog.close();
  };
  view.addEventListener("click", click);
  dialog.addEventListener("click", (e) => {
    const thumb = e.target.closest(".thv-thumb");
    if (thumb) {
      dialog.querySelectorAll(".thv-thumb").forEach((b) => b.classList.toggle("on", b === thumb));
      dialog.querySelector(".thv-main").src = thumb.dataset.src;
      return;
    }
    click(e);
  });
  $("thv-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { $("thv-title").textContent = ""; });
  view.addEventListener("error", (e) => {
    if (e.target.matches?.("img.th-img")) e.target.replaceWith(Object.assign(document.createElement("span"), { className: "th-none", innerHTML: icon("palette") }));
  }, true);
  view.addEventListener("input", (e) => {
    if (!e.target.matches("[data-th-q]")) return;
    T.q = e.target.value;
    T.limit = 60;
    const at = e.target.selectionStart;
    render();
    const input = view.querySelector("[data-th-q]");
    input.focus();
    input.setSelectionRange(at, at);
  });
  view.addEventListener("change", (e) => {
    if (e.target.matches("[data-th-fit]")) { T.fit = e.target.value === "1"; store.set("themeFit", T.fit); }
    else if (e.target.matches("[data-th-kind]")) T.kind = e.target.value;
    else if (e.target.matches("[data-th-sort]")) T.sort = e.target.value;
    else return;
    T.limit = 60;
    render();
  });
}
