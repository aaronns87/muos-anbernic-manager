// MCP status chip + floating stats panel (header), and shared enabled flag for Settings.

import { $, api, esc, icon, formatTime } from "./core.js";

const M = {
  ready: false,
  enabled: false,
  listening: false,
  assistantUsesTools: true,
  url: "",
  tokenHint: "",
  toolCount: 0,
  stats: null,
  panelOpen: false,
};

const changeListeners = [];

export function onMcpChanged(fn) {
  if (typeof fn === "function") changeListeners.push(fn);
}

function notifyChanged() {
  for (const fn of changeListeners) {
    try { fn(); } catch { /* ignore listener errors */ }
  }
}

export const mcpListening = () => M.enabled && M.listening;

/** True when in-app Assistant may call the shared MCP tool catalogue. */
export const assistantUsesMcp = () => M.enabled && M.assistantUsesTools;

export function mcpState() {
  return M;
}

export async function loadMcpStatus() {
  try {
    const [settings, tools] = await Promise.all([
      api("mcp/settings"),
      api("mcp/tools").catch(() => ({ count: 0 })),
    ]);
    M.enabled = !!settings.enabled;
    M.listening = !!settings.listening && M.enabled;
    M.assistantUsesTools = settings.assistantUsesTools !== false;
    M.url = settings.url || "";
    M.tokenHint = settings.tokenHint || "";
    M.toolCount = tools.count || 0;
    M.ready = true;
  } catch {
    M.enabled = false;
    M.listening = false;
    M.assistantUsesTools = false;
    M.ready = true;
  }
  notifyChanged();
  if (M.panelOpen) void paintMcpPanel();
}

export function mcpStatusChanged(settings) {
  if (!settings) return;
  M.enabled = !!settings.enabled;
  M.listening = !!settings.listening && M.enabled;
  if ("assistantUsesTools" in settings) M.assistantUsesTools = settings.assistantUsesTools !== false;
  M.url = settings.url || M.url;
  M.tokenHint = settings.tokenHint || M.tokenHint;
  notifyChanged();
  if (!M.enabled) closeMcpPanel(false);
  else if (M.panelOpen) void paintMcpPanel();
}

function ensurePanel() {
  let el = $("sb-mcp-panel");
  if (el) return el;
  el = document.createElement("div");
  el.id = "sb-mcp-panel";
  el.className = "sb-conn-panel sb-mcp-panel";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "MCP server");
  document.body.appendChild(el);
  return el;
}

function positionPanel() {
  const btn = document.querySelector("[data-mcp-panel]");
  const panel = $("sb-mcp-panel");
  if (!btn || !panel || panel.hidden) return;
  const r = btn.getBoundingClientRect();
  const width = Math.min(440, window.innerWidth - 16);
  let left = r.right - width;
  if (left < 8) left = 8;
  panel.style.top = `${Math.round(r.bottom + 6)}px`;
  panel.style.left = `${Math.round(left)}px`;
  panel.style.width = `${width}px`;
}

function ago(at) {
  const ms = Date.now() - at;
  if (ms < 60_000) return "just now";
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return formatTime(new Date(at));
}

function hostLabel(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url || "127.0.0.1/mcp";
  }
}

async function paintMcpPanel() {
  const panel = ensurePanel();
  if (!M.panelOpen) {
    panel.hidden = true;
    document.querySelector("[data-mcp-panel]")?.setAttribute("aria-expanded", "false");
    return;
  }
  let stats = M.stats;
  try {
    stats = await api("mcp/stats");
    M.stats = stats;
  } catch (error) {
    panel.innerHTML = `<div class="sb-mcp-inner">
      <div class="sb-mcp-head">
        <div class="sb-mcp-title"><span class="sb-mcp-live off"></span><b>MCP</b></div>
        <button type="button" class="btn icon small ghost" data-mcp-close aria-label="Close">${icon("x")}</button>
      </div>
      <p class="muted-note">${esc(error.message || "Could not load MCP stats.")}</p>
    </div>`;
    panel.hidden = false;
    positionPanel();
    return;
  }

  const sessionCount = (stats.sessions || []).length;
  const sessions = (stats.sessions || []).map((s) => `
    <div class="sb-mcp-row">
      <span class="sb-mcp-row-main"><code>${esc(s.id.slice(0, 8))}…</code><small>${esc(s.client)}</small></span>
      <span class="sb-mcp-row-meta">${esc(ago(s.lastActive))}</span>
    </div>`).join("")
    || `<div class="sb-mcp-empty">No clients connected right now</div>`;

  const recent = (stats.recent || []).slice(0, 8).map((r) => `
    <div class="sb-mcp-row${r.ok ? "" : " err"}">
      <span class="sb-mcp-row-main"><b>${esc(r.tool)}</b><small>${esc(r.client)}${r.ok ? "" : ` · ${esc(r.error || "error")}`}</small></span>
      <span class="sb-mcp-row-meta">${esc(ago(r.at))}</span>
    </div>`).join("")
    || `<div class="sb-mcp-empty">No tool calls yet this run</div>`;

  panel.innerHTML = `<div class="sb-mcp-inner">
    <div class="sb-mcp-head">
      <div class="sb-mcp-title">
        <span class="sb-mcp-live" title="Listening"></span>
        <div>
          <b>MCP server</b>
          <small>MuAnMCP · localhost · ${M.toolCount || "?"} tools</small>
        </div>
      </div>
      <button type="button" class="btn icon small ghost" data-mcp-close aria-label="Close">${icon("x")}</button>
    </div>

    <div class="sb-mcp-endpoint" title="${esc(M.url || "")}">
      <span class="sb-mcp-endpoint-ico">${icon("mcp")}</span>
      <div>
        <code>${esc(hostLabel(M.url))}</code>
        ${M.tokenHint ? `<small>Token ${esc(M.tokenHint)}</small>` : `<small>Bearer token in Settings</small>`}
      </div>
    </div>

    <div class="sb-mcp-stats" role="group" aria-label="Usage">
      <div><b>${stats.callsToday ?? 0}</b><small>Today</small></div>
      <div><b>${stats.callsSession ?? 0}</b><small>This run</small></div>
      <div><b>${sessionCount}</b><small>Sessions</small></div>
    </div>

    <section class="sb-mcp-block">
      <header><span>Sessions</span><span class="sb-mcp-count">${sessionCount}</span></header>
      <div class="sb-mcp-rows">${sessions}</div>
    </section>

    <section class="sb-mcp-block">
      <header><span>Recent calls</span></header>
      <div class="sb-mcp-rows">${recent}</div>
    </section>

    <p class="sb-mcp-footer muted-note">More configuration under
      <a href="#mcp" data-mcp-settings>Tools → MCP</a></p>
  </div>`;
  panel.hidden = false;
  document.querySelector("[data-mcp-panel]")?.setAttribute("aria-expanded", "true");
  positionPanel();
}

export function closeMcpPanel(restore = true) {
  if (!M.panelOpen) return;
  M.panelOpen = false;
  void paintMcpPanel();
  if (restore) document.querySelector("[data-mcp-panel]")?.focus();
}

export function toggleMcpPanel(trigger) {
  if (M.panelOpen) closeMcpPanel();
  else {
    M.panelOpen = true;
    void paintMcpPanel();
    $("sb-mcp-panel")?.querySelector("[data-mcp-close]")?.focus();
  }
  trigger?.setAttribute?.("aria-expanded", M.panelOpen ? "true" : "false");
}

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-mcp-close]")) { closeMcpPanel(); return; }
  if (e.target.closest("[data-mcp-panel]")) {
    e.preventDefault();
    toggleMcpPanel(e.target.closest("[data-mcp-panel]"));
    return;
  }
  if (e.target.closest("[data-mcp-settings]")) {
    closeMcpPanel(false);
    return;
  }
  if (M.panelOpen && !e.target.closest("#sb-mcp-panel") && !e.target.closest("[data-mcp-panel]")) {
    closeMcpPanel(false);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && M.panelOpen) {
    e.preventDefault();
    e.stopImmediatePropagation();
    closeMcpPanel();
  }
});

window.addEventListener("hashchange", () => closeMcpPanel(false));
window.addEventListener("resize", () => { if (M.panelOpen) positionPanel(); });
