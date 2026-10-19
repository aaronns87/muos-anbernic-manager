// Shared keyboard tabs, responsive filters, skip navigation and measured sticky-header spacing.

import { $, store } from "./core.js";

const narrow = matchMedia("(max-width: 720px)");
let filtersOpen = store.get("filtersOpen", false);

export function syncGameFilters() {
  const toggle = $("filters-toggle"), filters = $("games-filters");
  const size = $("card-size").closest(".size-range");
  const sizeHost = narrow.matches ? filters : document.querySelector(".toolbar .tool-end");
  if (size.parentElement !== sizeHost) sizeHost.append(size);
  const count = [...filters.querySelectorAll("select")].filter((s) => s.id !== "sort" && !s.hidden && s.selectedIndex > 0).length;
  toggle.hidden = !narrow.matches;
  filters.hidden = narrow.matches && !filtersOpen;
  toggle.setAttribute("aria-expanded", String(!filters.hidden));
  toggle.classList.toggle("on", count > 0);
  toggle.querySelector("span").textContent = count ? `Filters (${count})` : "Filters";
  toggle.setAttribute("aria-label", `${filters.hidden ? "Show" : "Hide"} filters${count ? `, ${count} active` : ""}`);
}

export function bindUi() {
  const toggle = $("filters-toggle"), filters = $("games-filters");
  toggle.addEventListener("click", () => {
    filtersOpen = !filtersOpen;
    store.set("filtersOpen", filtersOpen);
    syncGameFilters();
  });
  narrow.addEventListener("change", syncGameFilters);
  filters.addEventListener("change", syncGameFilters);
  syncGameFilters();

  const tabs = (list) => [...list.querySelectorAll('[role="tab"]')].filter((t) => !t.disabled && !t.hidden && t.getAttribute("aria-disabled") !== "true");
  const syncTabs = (list) => {
    const items = tabs(list), active = items.find((t) => t.getAttribute("aria-selected") === "true") || items[0];
    for (const item of items) item.tabIndex = item === active ? 0 : -1;
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
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
  document.querySelectorAll('[role="tablist"]').forEach(syncTabs);

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
