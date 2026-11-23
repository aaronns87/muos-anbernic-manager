// Ctrl/Cmd+K command palette: filterable list of sections and common actions (the "power user keys" setting).

import { $, esc, icon, section, store } from "./core.js";

export const powerKeysOn = () => store.get("powerUserKeys", true) !== false;

let items = [], shown = [], at = 0, bound = false;

/** Jumps to Games and focuses the search box, from any section. */
export function focusSearch() {
  const focus = () => { const q = $("q"); q.focus(); q.select(); };
  if (section() === "games" && !$("view-games").hidden) return focus();
  location.hash = "#games";
  let tries = 0;
  (function wait() {
    if (section() === "games" && !$("view-games").hidden) return void setTimeout(focus, 80);
    if (++tries < 30) setTimeout(wait, 50);
  })();
}

function score(item, words) {
  const label = item.label.toLowerCase(), hay = `${label} ${item.group.toLowerCase()} ${item.keys || ""}`;
  let total = 0;
  for (const w of words) {
    if (!hay.includes(w)) return -1;
    total += label.startsWith(w) ? 3 : label.includes(` ${w}`) ? 2 : 1;
  }
  return total;
}

function filter(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const live = items.filter((i) => !i.when || i.when());
  if (!words.length) return live;
  return live.map((i) => [i, score(i, words)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([i]) => i);
}

function renderList() {
  const list = $("palette-list");
  if (!shown.length) {
    list.innerHTML = `<li class="palette-none muted-note" role="presentation">Nothing matches. Try a section name such as Games or Settings.</li>`;
    $("palette-q").removeAttribute("aria-activedescendant");
    return;
  }
  let last = "";
  list.innerHTML = shown.map((it, n) => {
    const head = it.group !== last ? `<li class="palette-group" role="presentation">${esc(it.group)}</li>` : "";
    last = it.group;
    return `${head}<li role="option" id="palette-o${n}" class="palette-row${n === at ? " on" : ""}" data-n="${n}" aria-selected="${n === at}">
      ${icon(it.icon || "dot")}<span class="palette-label">${esc(it.label)}</span>${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ""}</li>`;
  }).join("");
  $("palette-q").setAttribute("aria-activedescendant", `palette-o${at}`);
  $(`palette-o${at}`)?.scrollIntoView({ block: "nearest" });
}

function update() {
  shown = filter($("palette-q").value);
  at = 0;
  renderList();
}

function move(delta) {
  if (!shown.length) return;
  at = (at + delta + shown.length) % shown.length;
  renderList();
}

function run(n) {
  const it = shown[n];
  if (!it) return;
  $("palette").close();
  setTimeout(() => it.run(), 30);
}

export function openPalette() {
  const d = $("palette");
  if (d.open) return;
  $("palette-q").value = "";
  update();
  d.showModal();
  $("palette-q").focus();
}

/** items: [{ group, label, icon, hint, keys, when, run }] */
export function bindCommandPalette(list) {
  items = list;
  if (bound) return;
  bound = true;
  const d = $("palette"), q = $("palette-q");
  q.addEventListener("input", update);
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Home" && shown.length) { e.preventDefault(); at = 0; renderList(); }
    else if (e.key === "End" && shown.length) { e.preventDefault(); at = shown.length - 1; renderList(); }
    else if (e.key === "Enter") { e.preventDefault(); run(at); }
  });
  $("palette-list").addEventListener("click", (e) => {
    const row = e.target.closest("[data-n]");
    if (row) run(+row.dataset.n);
  });
  $("palette-list").addEventListener("mousemove", (e) => {
    const row = e.target.closest("[data-n]");
    if (row && +row.dataset.n !== at) {
      at = +row.dataset.n;
      d.querySelectorAll(".palette-row").forEach((r) => {
        r.classList.toggle("on", r === row);
        r.setAttribute("aria-selected", String(r === row));
      });
      q.setAttribute("aria-activedescendant", row.id);
    }
  });
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  document.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "k") return;
    if (!powerKeysOn()) return;
    if (d.open) { e.preventDefault(); d.close(); return; }
    if (document.querySelector("dialog[open]")) return;
    e.preventDefault();
    openPalette();
  }, true);
}
