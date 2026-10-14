// Filterable dropdowns. <input data-combo="key"> suggests from comboItems(key, items) while typing; <select data-combo>
// opens a list with a filter field instead of the native menu. Picks are reported with the usual input and change events,
// so the page's own handlers keep working. The menu lives in <body> with fixed positioning, so panels never clip it.

import { esc, icon } from "./core.js";

const LIMIT = 200;
const lists = new Map();
let M = null;
let picked = 0;

/** Choices for <input data-combo="key">: strings, or { value, label, sub } objects. */
export function comboItems(key, items) {
  lists.set(key, items.map((i) => (typeof i === "string" ? { value: i, label: i } : { label: i.value, ...i })));
}

function itemsOf(el) {
  if (el.tagName !== "SELECT") return lists.get(el.dataset.combo) || [];
  return [...el.options].map((o) => ({ value: o.value, label: o.textContent.trim(), sub: o.dataset.sub || "", group: o.parentElement.tagName === "OPTGROUP" ? o.parentElement.label : "", disabled: o.disabled }));
}

function matches() {
  const all = itemsOf(M.el);
  const raw = (M.q ? M.q.value : M.el.value).trim().toLowerCase();
  const q = M.q || !all.some((i) => i.value.toLowerCase() === raw) ? raw : "";
  return q ? all.filter((i) => `${i.label} ${i.sub || ""}`.toLowerCase().includes(q)) : all;
}

function paint() {
  const list = M.menu.querySelector(".combo-list");
  M.shown = matches();
  M.hi = Math.min(Math.max(M.hi, 0), Math.max(0, M.shown.length - 1));
  const cur = M.el.value;
  let group = null;
  list.innerHTML = M.shown.length
    ? M.shown.slice(0, LIMIT).map((i, n) => {
      const head = i.group && i.group !== group ? `<div class="mp-group">${esc(i.group)}</div>` : "";
      group = i.group;
      const on = i.value === cur;
      return `${head}<div class="combo-opt${on ? " on" : ""}${n === M.hi ? " hi" : ""}${i.disabled ? " off" : ""}" role="option" id="combo-${n}" data-n="${n}" aria-selected="${on}">
        <span><b>${esc(i.label)}</b>${i.sub ? `<small>${esc(i.sub)}</small>` : ""}</span>${on ? icon("check") : ""}</div>`;
    }).join("") + (M.shown.length > LIMIT ? `<p class="muted-note combo-none">${(M.shown.length - LIMIT).toLocaleString()} more. Keep typing to narrow it down.</p>` : "")
    : `<p class="muted-note combo-none">Nothing matches.</p>`;
  (M.q || M.el).setAttribute("aria-activedescendant", `combo-${M.hi}`);
  list.querySelector(".hi")?.scrollIntoView({ block: "nearest" });
}

function place() {
  if (!M.el.isConnected) return close();
  const r = M.el.getBoundingClientRect(), gap = 6, edge = 8;
  const below = innerHeight - r.bottom - gap - edge, above = r.top - gap - edge;
  const up = below < 220 && above > below;
  const width = Math.min(Math.max(r.width, 240), innerWidth - 2 * edge);
  Object.assign(M.menu.style, {
    left: `${Math.max(edge, Math.min(r.left, innerWidth - width - edge))}px`, width: `${width}px`,
    top: up ? "" : `${r.bottom + gap}px`, bottom: up ? `${innerHeight - r.top + gap}px` : "",
  });
  M.menu.querySelector(".combo-list").style.maxHeight = `${Math.max(120, Math.min(380, up ? above : below) - (M.q ? 52 : 16))}px`;
}

function open(el, seed = "") {
  if (M?.el === el) return;
  close();
  const menu = document.createElement("div");
  menu.className = "combo-menu";
  const select = el.tagName === "SELECT";
  menu.innerHTML = `${select ? `<label class="search small">${icon("search")}<input type="search" class="combo-q" placeholder="Type to filter" aria-label="Filter"
    role="combobox" aria-expanded="true" aria-controls="combo-list" aria-autocomplete="list"></label>` : ""}<div class="combo-list" id="combo-list" role="listbox"></div>`;
  document.body.append(menu);
  M = { el, menu, q: menu.querySelector(".combo-q"), hi: 0, shown: [] };
  el.setAttribute("aria-expanded", "true");
  M.hi = Math.max(0, matches().findIndex((i) => i.value === el.value));
  if (M.q) { M.q.value = seed; if (seed) M.hi = 0; }
  paint();
  place();
  M.q?.focus();
}

function close(refocus = false) {
  if (!M) return;
  const { el, menu } = M;
  M = null;
  menu.remove();
  el.setAttribute("aria-expanded", "false");
  if (refocus && el.isConnected) el.focus();
}

function pick(n) {
  const item = M?.shown[n];
  if (!item || item.disabled) return;
  const { el } = M;
  picked = Date.now();
  close(el.tagName === "SELECT");
  if (el.value !== item.value || el.tagName !== "SELECT") {
    el.value = item.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function move(by) {
  if (!M.shown.length) return;
  M.hi = (M.hi + by + Math.min(M.shown.length, LIMIT)) % Math.min(M.shown.length, LIMIT);
  paint();
}

const comboOf = (t) => (t instanceof Element ? t.closest("[data-combo]") : null);

document.addEventListener("mousedown", (e) => {
  const opt = e.target.closest?.(".combo-opt");
  if (opt) { e.preventDefault(); return pick(+opt.dataset.n); }
  if (M && M.menu.contains(e.target)) return;
  const el = comboOf(e.target);
  if (el?.tagName === "SELECT" && !el.disabled) {
    e.preventDefault();
    if (M?.el === el) return close(true);
    el.focus();
    return open(el);
  }
  if (M && e.target !== M.el) close();
  if (!M && el?.tagName === "INPUT" && !el.disabled && document.activeElement === el && (lists.get(el.dataset.combo) || []).length) open(el);
}, true);

document.addEventListener("focusin", (e) => {
  const el = comboOf(e.target);
  if (el?.tagName === "INPUT" && !el.disabled && Date.now() - picked > 400 && (lists.get(el.dataset.combo) || []).length) open(el);
});

document.addEventListener("focusout", () => setTimeout(() => {
  if (M && document.activeElement !== M.el && !M.menu.contains(document.activeElement)) close();
}));

document.addEventListener("input", (e) => {
  if (M && (e.target === M.q || e.target === M.el)) { M.hi = 0; paint(); return; }
  const el = comboOf(e.target);
  if (el?.tagName === "INPUT" && !M && Date.now() - picked > 400) open(el);
});

document.addEventListener("keydown", (e) => {
  const el = comboOf(e.target);
  if (!M && el?.tagName === "SELECT" && !el.disabled) {
    const typed = e.key.length === 1 && e.key !== " " && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (typed || ["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); open(el, typed ? e.key : ""); }
    return;
  }
  if (!M && el?.tagName === "INPUT" && !el.disabled && (e.key === "ArrowDown" || e.key === "ArrowUp") && (lists.get(el.dataset.combo) || []).length) {
    e.preventDefault();
    return open(el);
  }
  if (!M || (e.target !== M.el && e.target !== M.q)) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1); }
  else if (e.key === "Enter") { if (M.shown.length) { e.preventDefault(); pick(M.hi); } }
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
  else if (e.key === "Tab") close();
}, true);

addEventListener("resize", () => M && place());
document.addEventListener("scroll", (e) => { if (M && !M.menu.contains(e.target)) place(); }, true);
