// Logs section: searchable, filterable viewer for application diagnostic JSONL files.

import { $, api, esc, formatDate, formatTime, icon, section, store, TOKEN, toast } from "./core.js";
import { loadingInline, emptyState } from "./layout.js";
import { confirmBox } from "./art-images.js";

const L = {
  q: "", level: "", day: "", list: [], total: 0, all: 0, days: [], dir: "",
  hideRoutine: store.get("logsHideRoutine", true) !== false,
  loading: false, bound: false, seq: 0, poll: 0, openStacks: new Set(),
};

const LEVELS = [
  ["", "Everything"],
  ["error", "Errors"],
  ["warn", "Warnings"],
  ["info", "Info"],
  ["done", "Done"],
  ["debug", "Debug"],
];
const ICON = { error: "x", warn: "alert", info: "info", done: "check", debug: "dot" };

const entriesLabel = (n) => `${n.toLocaleString()} ${n === 1 ? "entry" : "entries"}`;

const stamp = (t) => {
  const d = new Date(t), today = new Date().toDateString() === d.toDateString();
  return today ? formatTime(d) : `${formatDate(d, "short")} ${formatTime(d)}`;
};

function row(e, i) {
  const key = `${e.t}-${i}`;
  const open = L.openStacks.has(key) && e.stack;
  const src = e.source && e.source !== "app" ? `<span class="logs-src">${esc(e.source)}</span>` : "";
  return `<li class="logs-row ${esc(e.level)}" data-logs-i="${i}" title="${esc(new Date(e.t).toLocaleString())}">
    <span class="logs-ico">${icon(ICON[e.level] || "dot")}</span>
    <div class="logs-body">
      <div class="logs-line">
        <b>${esc(e.tag)}</b>
        ${src}
        <span class="logs-text">${esc(e.text)}</span>
      </div>
      ${e.stack ? `<button type="button" class="logs-stack-toggle" data-logs-stack="${esc(key)}" aria-expanded="${open}">${open ? "Hide" : "Show"} stack</button>
        ${open ? `<pre class="logs-stack">${esc(e.stack)}</pre>` : ""}` : ""}
    </div>
    <time datetime="${esc(new Date(e.t).toISOString())}">${stamp(e.t)}</time></li>`;
}

function emptyNote() {
  if (L.q || L.level) return "Nothing matches.";
  if (L.hideRoutine && L.all > 0) {
    return "Only startup lines so far — copies, installs, connection changes and settings show up here. Uncheck Hide routine to see scans and restarts.";
  }
  return "Nothing recorded yet. Errors, warnings and manager actions appear here.";
}

function toolbar() {
  const days = L.days.length ? L.days : (L.day ? [L.day] : []);
  return `<div class="logs-bar">
    <label class="search small">${icon("search")}
      <input id="logs-q" type="search" placeholder="Search tag, text, stack&hellip;" value="${esc(L.q)}" autocomplete="off" aria-label="Search logs"></label>
    <select id="logs-level" class="control" aria-label="Level">${LEVELS.map(([v, l]) =>
      `<option value="${v}"${L.level === v ? " selected" : ""}>${l}</option>`).join("")}</select>
    <select id="logs-day" class="control" aria-label="Day"${days.length ? "" : " disabled"}>
      ${days.length ? days.map((d) => `<option value="${esc(d)}"${d === L.day ? " selected" : ""}>${esc(d)}</option>`).join("")
        : `<option value="">No log files yet</option>`}
    </select>
    <label class="logs-routine"><input type="checkbox" id="logs-routine"${L.hideRoutine ? " checked" : ""}> Hide routine</label>
    <span class="logs-count" id="logs-count"></span>
  </div>`;
}

function actions() {
  return `<button class="btn" data-logs="refresh" title="Refresh">${icon("refresh")}<span>Refresh</span></button>
    <button class="btn" data-logs="export" title="Download the current filter as a file"${L.list.length || L.total ? "" : " disabled"}>${icon("download")}<span>Export</span></button>
    <button class="btn" data-logs="support" title="Zip logs, VERSION, connection snapshot and recent activity">${icon("layers")}<span>Support pack</span></button>
    <button class="btn" data-logs="reveal" title="Show the logs folder">${icon("external")}<span>Show folder</span></button>
    <button class="btn ghost" data-logs="clear" title="Delete log files">${icon("trash")}<span>Clear logs</span></button>`;
}

function render() {
  const root = $("logs");
  if (!root) return;
  $("logs-actions").innerHTML = actions();
  const body = L.loading && !L.list.length
    ? `<div class="logs-empty">${loadingInline("Loading&hellip;")}</div>`
    : L.list.length
      ? `<ul class="logs-list">${L.list.map(row).join("")}</ul>
         ${L.list.length < L.total ? `<div class="logs-more"><button class="btn" data-logs="more">Show more</button></div>` : ""}`
      : emptyState({ className: "compact muted logs-empty", body: emptyNote() });
  root.innerHTML = `${toolbar()}<div class="logs-scroll" id="logs-scroll">${body}</div>`;
  const count = $("logs-count");
  if (count) {
    const filtered = L.q || L.level || L.hideRoutine;
    count.textContent = filtered ? `${entriesLabel(L.total)} of ${L.all.toLocaleString()}` : entriesLabel(L.all);
  }
  const q = $("logs-q");
  if (q && document.activeElement === q) {
    const pos = q.selectionStart;
    q.focus();
    if (typeof pos === "number") q.setSelectionRange(pos, pos);
  }
}

function queryParams(extra = {}) {
  const params = new URLSearchParams({
    q: L.q, level: L.level, limit: "200", offset: String(extra.offset ?? 0),
  });
  if (L.day) params.set("day", L.day);
  if (L.hideRoutine) params.set("routine", "0");
  if (extra.format) params.set("format", extra.format);
  return params;
}

async function load(more = false) {
  const params = queryParams({ offset: more ? L.list.length : 0 });
  const seq = ++L.seq;
  L.loading = true;
  if (!more) render();
  try {
    const r = await api(`logs?${params}`);
    if (seq !== L.seq) return;
    L.list = more ? [...L.list, ...r.entries] : r.entries;
    L.total = r.total;
    L.all = r.all;
    L.days = r.days || [];
    L.day = r.day || L.day;
    L.dir = r.dir || "";
    const sub = $("logs-sub");
    if (sub && L.dir) sub.textContent = `Application diagnostics in ${L.dir}`;
  } catch (error) {
    if (seq !== L.seq) return;
    toast(error.message, 5000);
    if (!more) L.list = [];
  }
  L.loading = false;
  render();
}

async function exportSupportPack() {
  const ok = await confirmBox({
    title: "Export support pack?",
    html: `<p>Creates a zip with today's filtered logs, VERSION, platform info, a connection snapshot, and recent activity.</p>
      <label class="check"><input type="checkbox" name="logs-redact" checked>
        <span><b>Redact IP addresses</b> in the connection snapshot (recommended for public posts).</span></label>`,
    ok: "Download zip",
  });
  if (!ok) return;
  const redactHosts = $("c-body")?.querySelector('[name="logs-redact"]')?.checked !== false;
  const params = queryParams();
  if (!redactHosts) params.set("redact", "0");
  try {
    const res = await fetch(`/api/logs/support-pack?${params}`, {
      cache: "no-store",
      headers: { "X-Manager-Token": TOKEN },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || res.statusText);
    }
    const blob = await res.blob();
    const name = (res.headers.get("Content-Disposition") || "").match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i)?.[1];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = decodeURIComponent(name || "muos-manager-support.zip");
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Support pack downloaded", 2500);
  } catch (error) {
    toast(error.message, 5000);
  }
}

async function exportLogs() {
  const params = queryParams({ format: "txt" });
  try {
    const res = await fetch(`/api/logs/download?${params}`, {
      cache: "no-store",
      headers: { "X-Manager-Token": TOKEN },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || res.statusText);
    }
    const blob = await res.blob();
    const name = (res.headers.get("Content-Disposition") || "").match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i)?.[1];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = decodeURIComponent(name || `manager-${L.day || "logs"}.txt`);
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Log exported", 2000);
  } catch (error) {
    toast(error.message, 5000);
  }
}

async function clearLogs() {
  const dayOnly = !!L.day;
  const ok = await confirmBox({
    title: dayOnly ? `Clear logs for ${L.day}?` : "Clear all logs?",
    html: dayOnly
      ? `<p>Deletes <code>manager-${esc(L.day)}.jsonl</code> from the logs folder. This cannot be undone.</p>`
      : `<p>Deletes every <code>manager-*.jsonl</code> file in the logs folder. This cannot be undone.</p>`,
    ok: "Clear logs",
    danger: true,
  });
  if (!ok) return;
  try {
    await api("logs/clear", dayOnly ? { day: L.day } : {});
    L.list = [];
    L.total = 0;
    L.all = 0;
    toast("Logs cleared", 2500);
    await load();
  } catch (error) {
    toast(error.message, 5000);
  }
}

function bind() {
  if (L.bound) return;
  L.bound = true;
  let timer = 0;
  $("logs").addEventListener("input", (e) => {
    if (e.target.id !== "logs-q") return;
    L.q = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => load(), 200);
  });
  $("logs").addEventListener("change", (e) => {
    if (e.target.id === "logs-level") { L.level = e.target.value; load(); }
    if (e.target.id === "logs-day") { L.day = e.target.value; load(); }
    if (e.target.id === "logs-routine") {
      L.hideRoutine = e.target.checked;
      store.set("logsHideRoutine", L.hideRoutine);
      load();
    }
  });
  $("logs").addEventListener("click", (e) => {
    const stack = e.target.closest("[data-logs-stack]");
    if (stack) {
      const key = stack.dataset.logsStack;
      if (L.openStacks.has(key)) L.openStacks.delete(key); else L.openStacks.add(key);
      render();
      return;
    }
  });
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-logs]");
    if (!btn || section() !== "logs") return;
    const action = btn.dataset.logs;
    if (action === "refresh") load();
    else if (action === "more") load(true);
    else if (action === "export") exportLogs();
    else if (action === "support") exportSupportPack();
    else if (action === "reveal") {
      try { await api("logs/reveal", {}); toast("Opened logs folder", 2000); }
      catch (error) { toast(error.message, 5000); }
    } else if (action === "clear") clearLogs();
  });
}

function startPoll() {
  stopPoll();
  L.poll = setInterval(() => {
    if (section() === "logs" && !L.loading && document.visibilityState === "visible") load();
  }, 3000);
}

function stopPoll() {
  if (L.poll) clearInterval(L.poll);
  L.poll = 0;
}

/** Fills the Logs section and keeps it refreshing while visible. */
export function showLogs() {
  bind();
  $("logs-sub").textContent = L.dir
    ? `Application diagnostics in ${L.dir}`
    : "Application diagnostics written to the logs folder";
  load();
  startPoll();
}

export function stopLogsPoll() {
  stopPoll();
}
