// Starts the manager: sections, shared buttons, keyboard, and the first loads.

import { $, app, esc, icon, section, sectionForKey, store, toast, TOKEN, SECTIONS } from "./core.js";
import { deviceAction, handleArtButton, refreshDevice, renderDevice, renderStatusbar, watchDevices } from "./device.js";
import { bindModelPicker } from "./model-pick.js";
import { checkWizard } from "./wizard.js";
import { startManagerChecks } from "./manager-update.js";
import { bindWhatsNew, checkWhatsNew } from "./whats-new.js";
import {
  applyView, autoRescan, bindGames, clearFilters, openViewer, render, rescan, scrollToSystem, selectAllShown,
  setSelecting, setWhere, showMissing, showNotOnDevice, showSearch, startLibraryLoad
} from "./games.js";
import { bindArtworkView, showArtTab } from "./artwork-view.js";
import { bindCopy, poll } from "./copy.js";
import { bindArtwork } from "./artwork.js";
import { showSsh } from "./ssh.js";
import { showSettings } from "./settings.js";
import { bindSystem, showSystem, watchSystemJob } from "./system.js";
import { bindAddGames } from "./add-games.js";
import { showHandheld } from "./handheld.js";
import { showApps, countApps } from "./apps.js";
import { showEmulation } from "./emulation.js";
import { openHelp, showWiki } from "./wiki.js";
import { showFiles } from "./files.js";
import { showTuning } from "./tuning.js";
import { showPlay } from "./play.js";
import { showThemes } from "./themes.js";
import { openActivity } from "./activity.js";
import { renderOverview } from "./overview.js";
import { bindChat, loadChatConfig, onChatConfigured } from "./chat.js";
import "./combo.js";

const TITLES = {
  overview: ["Overview", "grid"], games: ["Games", "handheld"], play: ["Play", "clock"], artwork: ["Artwork", "image"], apps: ["Apps", "package"],
  handheld: ["Device Settings", "sliders"], themes: ["Themes", "palette"], emulation: ["Emulation", "gamepad"], files: ["Files", "folder"], tuning: ["Game Tuning", "gauge"], system: ["System Tools", "sd"],
  ssh: ["SSH", "chip"], settings: ["Settings", "wrench"], wiki: ["Wiki", "book"],
};

function showSection() {
  const s = section();
  for (const name of SECTIONS) $("view-" + name).hidden = s !== name;
  document.body.classList.toggle("in-ssh", s === "ssh");
  document.querySelectorAll(".section-link").forEach((a) => a.classList.toggle("on", a.dataset.section === s));
  const nav = document.querySelector(".sections"), on = nav.querySelector(".on");
  if (on && nav.scrollWidth > nav.clientWidth) nav.scrollLeft += on.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - on.offsetWidth) / 2;
  const [title, ico] = TITLES[s];
  $("sb-title").innerHTML = `${icon(ico)}<span>${esc(title)}</span>`;
  document.title = `${title} \u00b7 muOS Anbernic Manager`;
  if (s !== "games" && app.selecting) setSelecting(false);
  renderDevice();
  if (s === "games") { render(); autoRescan(); }
  if (s === "handheld") showHandheld();
  if (s === "emulation") showEmulation();
  if (s === "apps") showApps();
  if (s === "play") showPlay();
  if (s === "files") showFiles();
  if (s === "tuning") showTuning();
  if (s === "themes") showThemes();
  if (s === "system") showSystem();
  if (s === "ssh") showSsh();
  if (s === "settings") showSettings();
  if (s === "wiki") showWiki();
  scrollTo({ top: 0 });
}

/** Collapses the sidebar to an icon rail; remembered across visits. */
function setSideMin(min, animate = true) {
  const shell = document.querySelector(".app");
  if (!animate) shell.style.transition = "none";
  document.body.classList.toggle("side-min", min);
  if (!animate) { void shell.offsetWidth; shell.style.transition = ""; }
  store.set("sideMin", min);
  const t = $("side-toggle"), label = min ? "Expand sidebar" : "Collapse sidebar";
  t.title = `${label} ([)`;
  t.setAttribute("aria-label", label);
  t.setAttribute("aria-expanded", String(!min));
}

function go(el) {
  const to = el.dataset.go;
  if (to === "rescan") return rescan();
  if (to === "missing") return showMissing(el.dataset.code);
  if (to === "not-on-device") return showNotOnDevice();
  if (to === "search") return showSearch(el.dataset.q || "");
  if (to === "art-scrape") return showArtTab("scrape");
  if (to === "activity") return openActivity();
  if (to === "workspace-retry") {
    app.overview.workspace = null;
    return renderOverview();
  }
  if (to === "system") {
    clearFilters(false);
    setWhere("library", false);
    if (section() !== "games") location.hash = "#games"; else render();
    return setTimeout(() => scrollToSystem(el.dataset.code), 80);
  }
  if (to === "games") {
    setWhere("library", false);
    if (section() === "games") showSection(); else location.hash = "#games";
  }
}

function bindShared() {
  $("side-toggle").addEventListener("click", () => setSideMin(!document.body.classList.contains("side-min")));
  $("side-device").addEventListener("click", (e) => {
    const rail = document.body.classList.contains("side-min");
    if (!rail && e.target.closest(".sd-toggle")) {
      store.set("sdOpen", !store.get("sdOpen", false));
      renderDevice();
      $("side-device").querySelector(".sd-toggle")?.focus();
      return;
    }
    if (rail && (e.target.closest(".sd-toggle") || !e.target.closest("button, select, a"))) location.hash = "#overview";
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-help]")) return openHelp(section());
    const el = e.target.closest("[data-device], [data-art], [data-go]");
    if (!el || el.disabled || el.tagName === "SELECT") return;
    if (el.dataset.device) deviceAction(el.dataset.device, el);
    else if (el.dataset.art) handleArtButton(el.dataset.art);
    else if (el.dataset.go) go(el);
  });
  document.addEventListener("change", (e) => {
    if (e.target.dataset?.device === "pick") deviceAction("pick", e.target);
  });
  document.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]:not(#viewer)")) return;
    if ($("viewer").open) {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
      if (e.key === "ArrowLeft") openViewer(app.current - 1);
      if (e.key === "ArrowRight") openViewer(app.current + 1);
      return;
    }
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
    const plain = !typing && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (plain && /^[0-9]$/.test(e.key) && !document.querySelector("dialog[open]")) {
      location.hash = "#" + sectionForKey(e.key);
      return;
    }
    if (plain && e.key === "[") { setSideMin(!document.body.classList.contains("side-min")); return; }
    if (plain && e.key === "?" && !document.querySelector("dialog[open]")) { openHelp(section()); return; }
    if (section() !== "games") return;
    const q = $("q");
    if (e.key === "/" && document.activeElement !== q && !typing) {
      e.preventDefault(); q.focus(); q.select();
      return;
    }
    if (plain && e.key.toLowerCase() === "s") { setSelecting(!app.selecting); return; }
    if (!typing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && app.selecting) { e.preventDefault(); selectAllShown(); return; }
    if (e.key === "Escape") {
      if (document.activeElement === q) { q.value = ""; app.ui.q = ""; q.blur(); render(); }
      else if (app.selecting) setSelecting(false);
    }
  });
  window.addEventListener("scroll", () => $("top").classList.toggle("show", scrollY > 900), { passive: true });
  $("top").addEventListener("click", () => scrollTo({ top: 0 }));
  window.addEventListener("hashchange", showSection);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && section() === "games") autoRescan(); });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (app.ui.theme === "system") applyView(); });
  (function tick() {
    renderStatusbar();
    setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
  })();
}

applyView();
setSideMin(store.get("sideMin", false), false);
onChatConfigured(() => renderStatusbar());
bindShared();
bindModelPicker();
bindGames();
bindCopy();
bindChat();
bindWhatsNew();
bindArtwork();
bindArtworkView();
bindSystem();
bindAddGames();
showSection();

if (!TOKEN) {
  app.device.status = "offline";
  app.device.error = "Open the manager with ./muos-anbernic-manager/run.sh; it opens this page with an access key.";
  renderDevice();
  $("games-list").innerHTML = `<div class="dev-note"><div class="notice err">${esc(app.device.error)}</div></div>`;
} else {
  startLibraryLoad();
  refreshDevice();
  loadChatConfig();
  checkWizard().then(() => checkWhatsNew());
  startManagerChecks();
  if (section() !== "apps") countApps();
  poll();
  watchSystemJob();
  setTimeout(watchDevices, 5000);
}
