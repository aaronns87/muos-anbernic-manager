// Activity log: what the manager did and when, on Overview and in a searchable dialog.

import { $, api, esc, formatDate, formatTime, icon, section } from "./core.js";

const A = { recent: null, at: 0, loading: false, q: "", level: "", list: [], total: 0, all: 0, bound: false };
const LEVELS = [["", "Everything"], ["done", "Done"], ["warn", "Warnings"], ["error", "Errors"], ["info", "Info"]];
const ICON = { done: "check", warn: "alert", error: "x", info: "info" };

const entries = (n) => `${n.toLocaleString()} ${n === 1 ? "entry" : "entries"}`;

const stamp = (t) => {
  const d = new Date(t), today = new Date().toDateString() === d.toDateString();
  return today ? formatTime(d) : `${formatDate(d, "short")} ${formatTime(d)}`;
};

const entry = (e) => `<li class="act-row ${esc(e.level)}" title="${esc(new Date(e.t).toLocaleString())}">
  <span class="act-ico">${icon(ICON[e.level] || "dot")}</span>
  <span class="act-text"><b>${esc(e.tag.toLowerCase())}</b> ${esc(e.text)}</span>
  <time>${stamp(e.t)}</time></li>`;

/** The Overview panel: the last few things the manager did. */
export function activityPanel() {
  if (Date.now() - A.at > 5000 && !A.loading) loadRecent();
  const body = !A.recent ? `<div class="muted-note"><span class="spinner sm"></span> Loading&hellip;</div>`
    : A.recent.length ? `<ul class="act-list">${A.recent.map(entry).join("")}</ul>`
    : `<div class="muted-note">Nothing yet. Copies, saves, installs and deletes show up here.</div>`;
  return `<section class="panel full act-panel"><h2>${icon("list")}Recent activity${A.all ? ` <small>${A.all.toLocaleString()}</small>` : ""}</h2>${body}
    ${A.recent?.length ? `<div class="panel-actions"><button class="btn" data-go="activity">${icon("search")}<span>Show all</span></button></div>` : ""}</section>`;
}

async function loadRecent() {
  A.loading = true;
  try {
    const r = await api("activity?limit=6");
    A.recent = r.entries;
    A.all = r.all;
  } catch {
    A.recent = A.recent || [];
  }
  A.at = Date.now();
  A.loading = false;
  if (section() === "overview" && $("overview")?.querySelector(".act-panel")) $("overview").querySelector(".act-panel").outerHTML = activityPanel();
}

async function search(more = false) {
  const params = new URLSearchParams({ q: A.q, level: A.level, limit: "100", offset: String(more ? A.list.length : 0) });
  try {
    const r = await api(`activity?${params}`);
    A.list = more ? [...A.list, ...r.entries] : r.entries;
    A.total = r.total;
    A.all = r.all;
  } catch (error) {
    $("act-list").innerHTML = `<li class="notice err">${esc(error.message)}</li>`;
    return;
  }
  renderDialog();
}

function renderDialog() {
  $("act-list").innerHTML = A.list.length ? A.list.map(entry).join("") : `<li class="muted-note act-none">${A.q || A.level ? "Nothing matches." : "Nothing recorded yet."}</li>`;
  $("act-count").textContent = A.q || A.level ? `${entries(A.total)} of ${A.all.toLocaleString()}` : entries(A.all);
  $("act-more").hidden = A.list.length >= A.total;
}

export function openActivity() {
  if (!A.bound) {
    A.bound = true;
    $("act-level").innerHTML = LEVELS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    let timer = 0;
    $("act-q").addEventListener("input", (e) => { A.q = e.target.value; clearTimeout(timer); timer = setTimeout(() => search(), 200); });
    $("act-level").addEventListener("change", (e) => { A.level = e.target.value; search(); });
    $("act-more").addEventListener("click", () => search(true));
    $("act-close").addEventListener("click", () => $("activity").close());
  }
  $("act-q").value = A.q;
  $("act-level").value = A.level;
  $("act-list").innerHTML = `<li class="planning"><span class="spinner"></span> Loading&hellip;</li>`;
  $("activity").showModal();
  search();
}
