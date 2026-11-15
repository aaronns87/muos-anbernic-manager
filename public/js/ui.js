// Shared keyboard tabs, responsive filters, skip navigation and measured sticky-header spacing.

import { $, store } from "./core.js";

const narrow = matchMedia("(max-width: 720px)");
let filtersOpen = store.get("filtersOpen", false);

export function syncGameFilters() {
  const toggle = $("filters-toggle"), filters = $("games-filters");
  const options = document.querySelector(".toolbar .tool-end");
  const optionsHost = narrow.matches ? filters : document.querySelector(".toolbar > .tool-row");
  if (options.parentElement !== optionsHost) optionsHost.append(options);
  const count = [...filters.querySelectorAll("select")].filter((s) => s.id !== "sort" && !s.hidden && s.selectedIndex > 0).length;
  toggle.hidden = !narrow.matches;
  filters.hidden = narrow.matches && !filtersOpen;
  toggle.setAttribute("aria-expanded", String(!filters.hidden));
  toggle.classList.toggle("on", count > 0);
  toggle.querySelector("span").textContent = count ? `Filters (${count})` : "Filters";
  toggle.setAttribute("aria-label", `${filters.hidden ? "Show" : "Hide"} filters${count ? `, ${count} active` : ""}`);
}

function bindNavigation() {
  const phone = matchMedia("(max-width: 980px)");
  const nav = $("app-navigation"), main = $("main-content");
  const open = document.querySelector("[data-nav-open]"), backdrop = document.querySelector(".nav-backdrop");
  let shown = false;
  const setOpen = (value, restore = true) => {
    shown = value && phone.matches;
    document.body.classList.toggle("nav-visible", shown);
    open.setAttribute("aria-expanded", String(shown));
    backdrop.hidden = !shown;
    nav.inert = phone.matches && !shown;
    main.inert = shown;
    if (shown) nav.querySelector("[data-nav-close]").focus();
    else if (restore && phone.matches) open.focus();
  };
  open.addEventListener("click", () => setOpen(true));
  document.querySelectorAll("[data-nav-close]").forEach(b => b.addEventListener("click", () => setOpen(false)));
  nav.addEventListener("click", e => { if (e.target.closest("a[href]")) setOpen(false); });
  document.addEventListener("keydown", e => {
    if (!shown) return;
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    if (e.key !== "Tab") return;
    const focusable = [...nav.querySelectorAll('a[href], button, input, select, [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  phone.addEventListener("change", () => setOpen(false, false));
  window.addEventListener("hashchange", () => setOpen(false, false));
  setOpen(false, false);
}

export function bindUi() {
  bindNavigation();
  const toggle = $("filters-toggle"), filters = $("games-filters");
  toggle.addEventListener("click", () => {
    filtersOpen = !filtersOpen;
    store.set("filtersOpen", filtersOpen);
    syncGameFilters();
  });
  narrow.addEventListener("change", syncGameFilters);
  filters.addEventListener("change", syncGameFilters);
  syncGameFilters();

  let tabListId = 0;
  const tabs = (list) => [...list.querySelectorAll('[role="tab"]')].filter((t) => !t.disabled && !t.hidden && t.getAttribute("aria-disabled") !== "true");
  const syncTabs = (list) => {
    if (!list.id) list.id = `ui-tabs-${++tabListId}`;
    const items = tabs(list), active = items.find((t) => t.getAttribute("aria-selected") === "true") || items[0];
    const panels = {
      "settings-tabs": "settings", "emu-tabs": "emu-body", "th-tabs": "themes",
      "play-tabs": "play-body", "art-tabs": "artwork", "v-tabs": "v-pane",
      "sys-tabs": "sys-task-panel", "dz-screen-tabs": "dz-preview-panel",
    };
    for (const [index, item] of items.entries()) {
      item.tabIndex = item === active ? 0 : -1;
      if (!item.id) item.id = `${list.id || "tabs"}-tab-${index}`;
      const panelId = list.id === "hh-tabs" ? ({settings:"handheld", controls:"hh-controls", benchmark:"hh-bench"})[item.dataset.hhTab] : panels[list.id];
      const panel = $(panelId);
      if (!panel) continue;
      item.setAttribute("aria-controls", panel.id);
      panel.setAttribute("role", "tabpanel");
      panel.tabIndex = 0;
      if (item === active || list.id === "hh-tabs") panel.setAttribute("aria-labelledby", item.id);
    }
  };
  const syncChoices = () => {
    for (const group of document.querySelectorAll(".segmented")) {
      if (group.getAttribute("role") === "tablist") continue;
      for (const button of group.querySelectorAll("button")) {
        const pressed = String(button.classList.contains("on"));
        if (button.getAttribute("aria-pressed") !== pressed) button.setAttribute("aria-pressed", pressed);
      }
    }
  };
  const observer = new MutationObserver((records) => {
    const lists = new Set();
    for (const record of records) {
      const parent = record.target instanceof Element && record.target.closest('[role="tablist"]');
      if (parent) lists.add(parent);
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('[role="tablist"]')) lists.add(node);
        node.querySelectorAll('[role="tablist"]').forEach((list) => lists.add(list));
      }
    }
    lists.forEach(syncTabs);
    syncChoices();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected", "class"] });
  document.querySelectorAll('[role="tablist"]').forEach(syncTabs);
  syncChoices();

  document.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tab = e.target instanceof Element ? e.target.closest('[role="tab"]') : null;
    const list = tab?.closest('[role="tablist"]');
    if (!list || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const items = tabs(list), index = items.indexOf(tab);
    if (index < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1
      : (index + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    items[next].click();
    requestAnimationFrame(() => {
      const active = tabs(list).find((t) => t.getAttribute("aria-selected") === "true");
      if (!active) return;
      active.focus({ preventScroll: true });
      if (list.scrollWidth > list.clientWidth) list.scrollLeft += active.getBoundingClientRect().left - list.getBoundingClientRect().left - (list.clientWidth - active.offsetWidth) / 2;
    });
  });
  document.querySelector("[data-skip-content]").addEventListener("click", (e) => {
    e.preventDefault();
    $("main-content").focus();
  });

  const header = document.querySelector(".statusbar");
  const measureHeader = () => document.documentElement.style.setProperty("--sb", `${Math.ceil(header.getBoundingClientRect().height)}px`);
  new ResizeObserver(measureHeader).observe(header);
  measureHeader();
}
