// Rich hover tab for the collapsed sidebar icon rail (replaces native title tooltips).

import { $, esc, icon } from "./core.js";
import { libraryTotals } from "./games.js";

const BLURB = {
  overview: "Connection, storage and what needs attention",
  wiki: "Help for every page, glossary and troubleshooting",
  games: "Browse and copy your Roms/ library",
  play: "Play time, recent games and collections",
  artwork: "Box art on this computer and the handheld",
  os: "MustardOS images ready to install",
  apps: "Packages, market and installs",
  handheld: "MustardOS settings, Controls and Benchmark",
  themes: "Browse, design, install and apply themes",
  emulation: "Saves, BIOS, cores and library checks",
  files: "Browse this computer and the handheld",
  tuning: "Per-game options, cheats and governor",
  system: "Install MustardOS, set up or wipe cards",
  ssh: "Command line on the handheld over SSH",
  settings: "Folders, behaviour, appearance and data",
  logs: "Application diagnostics in the logs folder",
};

const ICONS = {
  overview: "grid", wiki: "book", games: "handheld", play: "clock", artwork: "image", os: "sd",
  apps: "package", handheld: "sliders", themes: "palette", emulation: "gamepad", files: "folder",
  tuning: "gauge", system: "sd", ssh: "chip", settings: "wrench", logs: "list",
};

let bound = false;
let hideTimer = 0;
let canHover = false;

/** True for mouse / trackpad; false for pure touch (collapsed rail is a desktop pattern). */
const hoverOk = () => {
  try {
    if (matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches) return false;
  } catch { /* older engines */ }
  return true;
};

function panel() {
  let el = $("side-flyout");
  if (el) return el;
  el = document.createElement("div");
  el.id = "side-flyout";
  el.className = "side-flyout";
  el.hidden = true;
  el.setAttribute("role", "tooltip");
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
  return el;
}

function countText(id) {
  const t = $(id)?.textContent?.trim();
  return t || "";
}

function metaFor(section) {
  if (section === "games") {
    const t = libraryTotals();
    if (t) {
      const sys = t.filled ? `${t.filled} system${t.filled === 1 ? "" : "s"} with games` : "";
      return [t.games.toLocaleString() + (t.games === 1 ? " game" : " games"), sys].filter(Boolean).join(" · ");
    }
    const n = countText("games-count");
    return n ? `${n} games` : BLURB.games;
  }
  if (section === "artwork") {
    const pct = countText("art-count");
    return pct ? `${pct} with artwork` : BLURB.artwork;
  }
  if (section === "os") {
    const n = countText("os-count");
    if (!n) return BLURB.os;
    return `${n} image${n === "1" ? "" : "s"} in the OS folder`;
  }
  if (section === "apps") {
    const n = countText("apps-count");
    if (!n) return BLURB.apps;
    return `${n} package${n === "1" ? "" : "s"} in the apps folder`;
  }
  if (section === "system") {
    const n = countText("sys-count");
    if (!n) return BLURB.system;
    return `${n} card${n === "1" ? "" : "s"} in the reader`;
  }
  return BLURB[section] || "";
}

function paint(el, { ico, title, meta }) {
  el.innerHTML = `
    <span class="side-flyout-ico" aria-hidden="true">${icon(ico)}</span>
    <span class="side-flyout-copy">
      <span class="side-flyout-title">${esc(title)}</span>
      ${meta ? `<span class="side-flyout-meta">${esc(meta)}</span>` : ""}
    </span>`;
}

function place(el, anchor) {
  const r = anchor.getBoundingClientRect();
  const aside = document.querySelector(".app > aside");
  const left = (aside?.getBoundingClientRect().right ?? r.right) + 8;
  el.hidden = false;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = "0px";
  el.style.visibility = "hidden";
  const h = el.offsetHeight || 56;
  let top = r.top + r.height / 2 - h / 2;
  top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
  el.style.top = `${Math.round(top)}px`;
  el.style.visibility = "";
  el.setAttribute("aria-hidden", "false");
}

function showForLink(link) {
  if (!document.body.classList.contains("side-min") || !canHover) return;
  clearTimeout(hideTimer);
  const section = link.dataset.section;
  if (!section) return;
  const label = link.getAttribute("aria-label") || link.querySelector(".nav-label")?.textContent?.trim() || section;
  const el = panel();
  paint(el, {
    ico: ICONS[section] || "dot",
    title: label,
    meta: metaFor(section),
  });
  place(el, link);
}

function showForToggle(btn) {
  if (!document.body.classList.contains("side-min") || !canHover) return;
  clearTimeout(hideTimer);
  const el = panel();
  const expanding = document.body.classList.contains("side-min");
  paint(el, {
    ico: "arrow",
    title: expanding ? "Expand sidebar" : "Collapse sidebar",
    meta: "Show labels and the device card again",
  });
  place(el, btn);
}

export function hideSideFlyout() {
  clearTimeout(hideTimer);
  const el = $("side-flyout");
  if (!el || el.hidden) return;
  el.hidden = true;
  el.setAttribute("aria-hidden", "true");
  el.style.visibility = "";
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideSideFlyout, 40);
}

/** Call when the rail collapses or expands so a stale flyout cannot linger. */
export function syncSideFlyout() {
  canHover = hoverOk();
  if (!document.body.classList.contains("side-min")) hideSideFlyout();
}

export function bindSideFlyout() {
  if (bound) return;
  bound = true;
  canHover = hoverOk();
  const nav = document.querySelector(".sections");
  nav?.addEventListener("pointerover", (e) => {
    const link = e.target.closest?.(".section-link");
    if (link && nav.contains(link)) showForLink(link);
  });
  nav?.addEventListener("pointerout", (e) => {
    const link = e.target.closest?.(".section-link");
    if (!link || !nav.contains(link)) return;
    const next = e.relatedTarget instanceof Element ? e.relatedTarget : null;
    if (next && link.contains(next)) return;
    scheduleHide();
  });
  const toggle = $("side-toggle");
  toggle?.addEventListener("pointerover", () => showForToggle(toggle));
  toggle?.addEventListener("pointerout", scheduleHide);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideSideFlyout();
  });
  window.addEventListener("scroll", hideSideFlyout, { passive: true, capture: true });
  nav?.addEventListener("scroll", hideSideFlyout, { passive: true });
  window.addEventListener("hashchange", hideSideFlyout);
  try {
    matchMedia("(pointer: coarse)").addEventListener("change", () => {
      canHover = hoverOk();
      if (!canHover) hideSideFlyout();
    });
  } catch { /* older engines */ }
}
