// Settings: the Roms folder (with a folder browser), what copying does, startup, appearance, game data and caches.

import { $, app, api, esc, human, plural, store, toast, busy, icon, model, section, DATE_FORMATS, formatDate, formatTime, handheldVolume, setTabRoute } from "./core.js";
import { panel, notice, loading, loadingInline, sectionHead } from "./layout.js";
import { renderStatusbar } from "./device.js";
import { applyView, loadLibrary } from "./games.js";
import { invalidateLocal } from "./art-local.js";
import { artMax, confirmBox, maxSides } from "./art-images.js";
import { screenText } from "./devices.js";
import { forgetImages } from "./system.js";
import { reloadOs } from "./os.js";
import { openWizard } from "./wizard.js";
import { openTips, setTipsOnStartup, tipsOnStartup } from "./tips.js";
import { checkManager } from "./manager-update.js";
import { forgetActivity } from "./activity.js";
import { forgetPlay } from "./play.js";
import { chatConfiguredChanged, mdHtml } from "./chat.js";
import { mcpStatusChanged } from "./mcp.js";
import {
  ZOOM_LEVELS, SCHEME_ROLES, defaultRoles, loadCustomSchemes, saveCustomSchemes, schemeChips,
  rolesToVars, applyVars, newSchemeId, resolveSchemeId,
} from "./appearance.js";
import { recipesPanelHtml, bindRecipes } from "./recipes.js";

const FOLDER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`;
const PLACE_ICONS = {
  roms: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="11" r="1"/><circle cx="18" cy="13" r="1"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10"/></svg>`,
  drive: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5 13 7 5h10l2 8"/><circle cx="17" cy="16.5" r="1"/></svg>`,
  folder: FOLDER,
};

const s = {
  data: null, chat: null, mcp: null, mcpTools: null, mcpToken: "", mcpReveal: false,
  mcpClients: null, mcpCopyOpen: false, mcpToolQ: "", mcpToolGroup: "all",
  mcpAgents: null, mcpAgentReviewId: "", mcpInstallOpen: "", mcpInstallAllOpen: false, mcpAgentBound: false,
  error: "", loading: false, working: "", browse: null, bound: false,
  chatKey: "", promptBound: false, knowledgeBound: false, knowledgeMd: "",
  schemeEdit: null, schemeBound: false,
};

const SETTINGS_TABS = [
  ["folders", "folder", "Folders", "Where the manager finds games, apps, OS images, BIOS, backups, themes and logs"],
  ["behaviour", "sliders", "Behaviour", "Copying, library recipes, startup, updates and uploaded artwork size"],
  ["appearance", "palette", "Appearance", "Theme, colour scheme, zoom, softer style, compact layout, clock and date"],
  ["assistant", "chat", "Assistant", "Bring-your-own-key chat, model, context, system prompt and knowledge base"],
  ["data", "layers", "Data", "Refresh library metadata and clear downloaded caches"],
  ["resets", "trash", "Resets", "Clear logs and preferences on this computer, play history on the handheld, or start over"],
];

const MCP_SUB = "Local MCP server for Cursor, Claude Desktop and the in-app Assistant";

/** Named colour schemes: preview chips are fixed so the picker stays readable on every active scheme. */
const SCHEMES = [
  ["mustard", "Mustard", ["#111315", "#1a1d21", "#e2bd46", "#f0f2f5"]],
  ["ocean", "Ocean", ["#0e1418", "#172028", "#3db8c5", "#e8f0f4"]],
  ["forest", "Forest", ["#101412", "#1a211c", "#5cb87a", "#eaf2ec"]],
  ["berry", "Berry", ["#151116", "#211c24", "#d45a9a", "#f4eef2"]],
  ["slate", "Slate", ["#101318", "#1a1e26", "#8fa3b8", "#eef1f5"]],
  ["ember", "Ember", ["#14110e", "#211c16", "#e07a3a", "#f4efe8"]],
];
const APPEARANCE_DEFAULTS = {
  theme: "dark", scheme: "mustard", zoom: 100, soft: false, compact: false,
  clockStyle: "digital", clock: "24", dateFormat: "weekday",
};

const settingsTab = () => {
  let id = store.get("settingsTab", "folders");
  if (id === "mcp") {
    id = "folders";
    store.set("settingsTab", id);
  }
  return SETTINGS_TABS.find((t) => t[0] === id) || SETTINGS_TABS[0];
};

/** Reads the settings again the next time the section opens, after the setup wizard changed them. */
export function forgetSettings() {
  s.data = null;
  if (section() === "settings") showSettings();
  else if (section() === "mcp") showMcp();
}

export function showSettings() {
  if (!s.bound) bind();
  if (!s.data && !s.loading) load();
  render();
}

/** Opens the Tools → MCP page (server, clients, agents, tools). */
export function showMcp() {
  if (!s.bound) bind();
  if (!s.mcp && !s.loading) load();
  render();
}

async function load() {
  s.loading = true;
  try {
    const [data, chat, mcp, tools, agents] = await Promise.all([
      api("settings"),
      api("chat/settings"),
      api("mcp/settings"),
      api("mcp/tools").catch(() => ({ count: 0, groups: {}, tools: [] })),
      api("mcp/agents").catch(() => ({ root: "", packs: [] })),
    ]);
    s.data = data;
    s.chat = chat;
    s.mcp = mcp;
    s.mcpTools = tools;
    s.mcpAgents = agents;
    s.chatKey = "";
    s.mcpToken = "";
    s.mcpReveal = false;
    s.error = "";
  } catch (error) {
    s.error = error.message;
  }
  s.loading = false;
  render();
}

// ---------------------------------------------------------------- rendering

const toggle = (key, on, label, note) => `<label class="set-row set-toggle">
    <span><b>${label}</b><small>${note}</small></span>
    <span class="switch"><input type="checkbox" role="switch" data-set-toggle="${key}"${on ? " checked" : ""}><span class="switch-track"></span></span>
  </label>`;

function paintTabs() {
  const tabs = $("settings-tabs");
  if (!tabs) return;
  const [id] = settingsTab();
  tabs.innerHTML = SETTINGS_TABS.map(([t, ico, label]) =>
    `<button role="tab" data-settings-tab="${t}" class="${t === id ? "on" : ""}" aria-selected="${t === id}">${icon(ico)}<span>${label}</span></button>`).join("");
}

function render() {
  if (section() === "mcp") return renderMcp();
  if (!$("settings")) return;
  paintTabs();
  if (!s.data) {
    $("settings-sub").textContent = settingsTab()[3];
    $("settings").innerHTML = s.error
      ? notice("err", esc(s.error))
      : loading("Reading settings&hellip;");
    return;
  }
  const d = s.data, [tab, , , sub] = settingsTab();
  $("settings-sub").textContent = sub;
  const body = tab === "folders" ? `${romsPanel(d)}${otherFoldersPanel(d)}`
    : tab === "behaviour" ? `${copyPanel(d)}${recipesPanelHtml()}${imagesPanel()}`
    : tab === "appearance" ? appearancePanels()
    : tab === "assistant" ? assistantPanel()
    : tab === "data" ? `${dataPanel(d)}${cachePanel(d)}`
    : `${historyPanel(d)}${resetPanel()}`;
  $("settings").innerHTML = `<div class="ov-grid">${body}</div>`;
}

function renderMcp() {
  const host = $("mcp");
  if (!host) return;
  const sub = $("mcp-sub");
  if (sub) sub.textContent = MCP_SUB;
  if (!s.mcp) {
    host.innerHTML = s.error
      ? notice("err", esc(s.error))
      : loading("Reading MCP settings&hellip;");
    return;
  }
  host.innerHTML = `<div class="ov-grid">${mcpPanel()}</div>`;
  if (s.mcpCopyOpen || s.mcpInstallOpen || s.mcpInstallAllOpen) {
    requestAnimationFrame(() => positionMcpMenus());
  }
}

function assistantPanel() {
  const c = s.chat;
  if (!c) return panel("full", "Assistant", loadingInline("Loading assistant settings&hellip;"));
  const prov = c.providers.find((p) => p.id === c.provider) || c.providers[0];
  const models = (prov?.models || []).map((m) => `<option value="${esc(m.id)}"${c.model === m.id ? " selected" : ""}>${esc(m.label)}</option>`).join("");
  const providers = c.providers.map((p) => `<option value="${esc(p.id)}"${c.provider === p.id ? " selected" : ""}>${esc(p.label)}</option>`).join("");
  const help = c.help?.[c.provider] || "";
  const status = c.configured
    ? `<span class="set-chip ok">Key saved${c.keyHint ? ` (${esc(c.keyHint)})` : ""}</span>`
    : `<span class="set-chip warn">No key — chat stays hidden</span>`;
  const promptChip = c.systemPromptCustom
    ? `<span class="set-chip warn">Custom</span>`
    : `<span class="set-chip ok">Default</span>`;
  const promptWarn = c.systemPromptCustom
    ? notice("warn", `${icon("alert")}<span><b>Custom system prompt.</b> Answers may ignore knowledge-base grounding, walkthrough refusal or other built-in limits.
        <button type="button" class="link-btn" data-set="chat-prompt">Edit</button> or revert from the editor.</span>`)
    : "";
  const needsBase = c.provider === "custom" || !!prov?.needsBaseUrl;
  const modelList = prov?.models || [];
  const modelKnown = modelList.some((m) => m.id === c.model);
  const modelOptions = modelList.length
    ? `${models}<option value="__custom__"${modelKnown ? "" : " selected"}>Custom&hellip;</option>`
    : `<option value="__custom__" selected>Custom&hellip;</option>`;
  return panel("full", `${icon("chat")} Assistant`, `
    <p class="muted-note">Optional help chat with <b>bring your own key</b> (BYOK). The key stays in the manager cache on this
      computer and is sent only to the provider you choose. Without a key, the chat button stays hidden.</p>
    ${promptWarn}
    <div class="set-row"><span><b>Status</b><small>After you save a key, open chat from the mustard chat button in the bottom-right corner, or <b>Assistant</b> in the top bar.</small></span>${status}</div>
    <div class="set-row"><span><b>Provider</b><small>${esc(help)}</small></span>
      <select class="control" id="chat-provider">${providers}</select></div>
    <div class="set-row" id="chat-base-row"${needsBase ? "" : " hidden"}><span><b>API base URL</b><small>OpenAI-compatible host, e.g. <code>https://host/v1</code>. Required for Custom.</small></span>
      <input class="control mono" id="chat-base" spellcheck="false" placeholder="https://example.com/v1" value="${esc(c.baseUrl || "")}"></div>
    <div class="set-row"><span><b>API key</b><small>Leave blank to keep the saved key. Clear removes it.</small></span>
      <input class="control mono" id="chat-key" type="password" autocomplete="off" spellcheck="false" placeholder="${c.configured ? "Saved — type a new key to replace" : "Paste your API key"}" value="${esc(s.chatKey)}"></div>
    <div class="set-row"><span><b>Model</b><small>Or type a custom model id for this provider.</small></span>
      <select class="control" id="chat-model">${modelOptions}</select></div>
    <div class="set-row" id="chat-custom-row"${modelKnown && modelList.length ? " hidden" : ""}><span><b>Custom model id</b><small>Used when the model list is set to Custom&hellip;</small></span>
      <input class="control mono" id="chat-custom" spellcheck="false" ${modelKnown && modelList.length ? "disabled " : ""}value="${esc(modelKnown ? "" : c.model)}"></div>
    <div class="set-row"><span><b>Temperature</b><small>Lower is more factual (0–1).</small></span>
      <input class="control" id="chat-temp" type="number" min="0" max="1" step="0.1" value="${c.temperature}"></div>
    <div class="set-row"><span><b>Max reply tokens</b><small>Caps length (and spend on paid providers).</small></span>
      <input class="control" id="chat-maxtok" type="number" min="256" max="8192" step="128" value="${c.maxTokens}"></div>
    <label class="set-row set-toggle"><span><b>Include library context</b><small>Search your Roms/ library and LaunchBox descriptions when answering.</small></span>
      <span class="switch"><input type="checkbox" role="switch" id="chat-library"${c.includeLibrary ? " checked" : ""}><span class="switch-track"></span></span></label>
    <label class="set-row set-toggle"><span><b>Include connection context</b><small>Send Wi-Fi/SSH/card status (never passwords) with each question.</small></span>
      <span class="switch"><input type="checkbox" role="switch" id="chat-connection"${c.includeConnection ? " checked" : ""}><span class="switch-track"></span></span></label>
    <div class="set-row"><span><b>System prompt</b><small>Instructions sent with every message before live context. Editable even before you add a key.</small></span>
      <span class="set-prompt-actions">${promptChip}<button class="btn" data-set="chat-prompt"${s.working ? " disabled" : ""}>${icon("pencil")}<span>Edit prompt</span></button></span></div>
    <div class="set-row"><span><b>Knowledge base</b><small>Read-only guide the assistant uses for manager UI and limits (not the in-app Wiki).</small></span>
      <button class="btn" data-set="chat-knowledge"${s.working ? " disabled" : ""}>${icon("book")}<span>View knowledge base</span></button></div>
    <div class="panel-actions set-actions">
      <button class="btn primary" data-set="chat-save"${s.working === "chat" ? " disabled" : ""}>${s.working === "chat" ? `<span class="spinner"></span>` : icon("check")}<span>Save assistant</span></button>
      <button class="btn danger" data-set="chat-clear"${!c.configured || s.working ? " disabled" : ""}>${icon("trash")}<span>Clear key</span></button>
    </div>
    ${notice("", `${icon("info")}<span><b>Keys.</b>
      Free: <a href="https://console.groq.com" target="_blank" rel="noopener">Groq</a>,
      <a href="https://aistudio.google.com" target="_blank" rel="noopener">Google AI Studio</a> (Gemini),
      <a href="https://openrouter.ai" target="_blank" rel="noopener">OpenRouter</a> (<code>:free</code>).
      Paid BYOK: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">OpenAI</a>,
      <a href="https://console.x.ai" target="_blank" rel="noopener">xAI Grok</a>,
      or <b>Custom</b> for any OpenAI-compatible <code>/v1</code> host.
      Cursor does not offer a public chat API for other apps — use OpenAI, xAI, or Custom with a proxy.
      See the Wiki article <b>Assistant</b>.</span>`)}
    `);
}

function mcpStatusChip(m) {
  if (m.enabled && m.listening) return `<span class="set-chip ok"><span class="live-dot"></span>Listening</span>`;
  if (m.enabled) return `<span class="set-chip warn">Enabled</span>`;
  return `<span class="set-chip warn">Off</span>`;
}

function mcpSkillTargets() {
  return (s.mcpClients?.clients || []).filter((c) => c.skillsSupported && c.installed);
}

function mcpCopyMenu() {
  const clients = s.mcpClients?.clients || [];
  const items = (clients.length ? clients : [
    { id: "cursor", label: "Cursor" },
    { id: "claude-desktop", label: "Claude Desktop" },
    { id: "claude-code", label: "Claude Code" },
    { id: "codex", label: "Codex" },
    { id: "windsurf", label: "Windsurf" },
  ]).map((c) =>
    `<button type="button" role="menuitem" data-set="mcp-copy-client" data-id="${esc(c.id)}">${esc(c.label)}</button>`).join("");
  return `<div class="mcp-copy-wrap">
    <button type="button" class="btn" data-set="mcp-copy-toggle" aria-expanded="${s.mcpCopyOpen}" aria-haspopup="menu">
      ${icon("copy")}<span>Copy config</span>${icon("down")}</button>
    <div class="mcp-copy-menu" role="menu"${s.mcpCopyOpen ? "" : " hidden"}>${items}</div>
  </div>`;
}

function mcpInstallMenuItems(packId) {
  const targets = mcpSkillTargets();
  if (!targets.length) {
    return `<span class="muted-note mcp-install-empty">Scan for IDEs first (Cursor, Claude Code, Codex).</span>`;
  }
  if (packId === "*") {
    return targets.map((c) =>
      `<button type="button" role="menuitem" data-set="mcp-agent-install-all" data-client="${esc(c.id)}">${esc(c.label)}</button>`).join("");
  }
  return targets.map((c) =>
    `<button type="button" role="menuitem" data-set="mcp-agent-install" data-id="${esc(packId)}" data-client="${esc(c.id)}">${esc(c.label)}</button>`).join("");
}

function mcpClientCards() {
  const scan = s.mcpClients;
  if (!scan) {
    return `<div class="mcp-scan-hero">
      <div class="mcp-scan-hero-copy">
        <b>Scan for IDEs</b>
        <p class="muted-note">Find Cursor, Claude Desktop, Claude Code, Codex and Windsurf on this Mac, then write the MCP entry or install skills automatically.</p>
      </div>
      <button class="btn primary" data-set="mcp-scan"${s.working === "mcp-scan" ? " disabled" : ""}>
        ${s.working === "mcp-scan" ? `<span class="spinner"></span>` : icon("search")}<span>Scan for IDEs</span></button>
    </div>`;
  }
  const found = (scan.clients || []).filter((c) => c.installed);
  const others = (scan.clients || []).filter((c) => !c.installed);
  const card = (c) => {
    const badge = c.configured
      ? `<span class="set-chip ok">Configured</span>`
      : c.installed
        ? `<span class="set-chip warn">Found</span>`
        : `<span class="set-chip">Not found</span>`;
    return `<article class="mcp-client-card${c.installed ? " on" : ""}" data-mcp-client="${esc(c.id)}">
      <div class="mcp-client-top">
        <div><b>${esc(c.label)}</b><small>${esc(c.blurb)}</small></div>
        ${badge}
      </div>
      <code class="mcp-client-path" title="${esc(c.configPath)}">${esc(c.configPath)}</code>
      <div class="mcp-client-actions">
        <button type="button" class="btn primary small" data-set="mcp-setup" data-id="${esc(c.id)}"
          ${s.working === `mcp-setup-${c.id}` ? " disabled" : ""}>
          ${s.working === `mcp-setup-${c.id}` ? `<span class="spinner"></span>` : icon("check")}
          <span>${c.configured ? "Update" : "Set up"}</span></button>
        <button type="button" class="btn small" data-set="mcp-copy-client" data-id="${esc(c.id)}">${icon("copy")}<span>Copy</span></button>
      </div>
    </article>`;
  };
  return `
    <div class="mcp-clients-toolbar">
      <span class="muted-note">${found.length
        ? `Found ${found.length} installed client${found.length === 1 ? "" : "s"}`
        : "No matching IDEs detected — you can still copy a config."}</span>
      <button class="btn small" data-set="mcp-scan"${s.working === "mcp-scan" ? " disabled" : ""}>
        ${s.working === "mcp-scan" ? `<span class="spinner"></span>` : icon("refresh")}<span>Scan again</span></button>
    </div>
    <div class="mcp-client-grid">${[...found, ...others].map(card).join("")}</div>`;
}

function mcpAgentsSection() {
  const packs = s.mcpAgents?.packs || [];
  if (!packs.length) {
    return `<div class="mcp-clients-empty">
      <p class="muted-note">No agent packs found under <code>mcp/agents/</code>. They ship with the manager for MCP clients.</p>
    </div>`;
  }
  const cards = packs.map((p) => {
    const kind = p.kind === "expert" ? "Expert" : "Skill";
    const menuOpen = s.mcpInstallOpen === p.id;
    return `<article class="mcp-agent-card">
      <div class="mcp-client-top">
        <div>
          <div class="mcp-agent-title"><span class="mcp-tool-group">${esc(kind)}</span><b>${esc(p.name || p.id)}</b></div>
          <small>${esc(p.description || "")}</small>
        </div>
      </div>
      <code class="mcp-client-path" title="${esc(p.path || "")}">${esc(p.id)}</code>
      <div class="mcp-client-actions">
        <button type="button" class="btn small" data-set="mcp-agent-review" data-id="${esc(p.id)}">${icon("book")}<span>Review</span></button>
        <button type="button" class="btn small icon" data-set="mcp-agent-copy" data-id="${esc(p.id)}" title="Copy" aria-label="Copy">${icon("copy")}</button>
        <div class="mcp-copy-wrap">
          <button type="button" class="btn small primary" data-set="mcp-agent-install-toggle" data-id="${esc(p.id)}"
            aria-expanded="${menuOpen}" aria-haspopup="menu">${icon("download")}<span>Install</span>${icon("down")}</button>
          <div class="mcp-copy-menu" role="menu"${menuOpen ? "" : " hidden"}>${mcpInstallMenuItems(p.id)}</div>
        </div>
      </div>
    </article>`;
  }).join("");
  const allOpen = !!s.mcpInstallAllOpen;
  return `
    <div class="mcp-agents-toolbar">
      <span class="muted-note">${packs.length} pack${packs.length === 1 ? "" : "s"} · install into Cursor / Claude Code / Codex skill folders</span>
      <div class="mcp-copy-wrap">
        <button type="button" class="btn small primary" data-set="mcp-agent-install-all-toggle"
          aria-expanded="${allOpen}" aria-haspopup="menu">${icon("download")}<span>Install all</span>${icon("down")}</button>
        <div class="mcp-copy-menu" role="menu"${allOpen ? "" : " hidden"}>${mcpInstallMenuItems("*")}</div>
      </div>
    </div>
    <div class="mcp-client-grid">${cards}</div>`;
}

function mcpClientsAndAgentsSection() {
  return `
    <section class="panel full mcp-section">
      ${sectionHead({
        title: "Clients &amp; agents",
        note: "Connect agentic IDEs to this MCP server, then install skills and experts into their skill folders.",
        actions: mcpCopyMenu(),
      })}
      ${mcpClientCards()}
      <div class="mcp-subsection">
        <h3>Skills &amp; experts</h3>
        <p class="muted-note">MCP-only packs under <code>mcp/agents/</code> (not the repo developer docs). Review, copy, or install after a scan.</p>
        ${mcpAgentsSection()}
      </div>
      ${notice("", `${icon("info")}<span>Authorization uses <code>Bearer &lt;token&gt;</code>. After auto-setup or skill install, restart the client if it was already open.
        LAN / Tailscale expose is not available yet.</span>`)}
    </section>`;
}

function mcpToolsTable() {
  const tools = s.mcpTools?.tools || [];
  const groups = [...new Set(tools.map((t) => t.group))].sort();
  const q = (s.mcpToolQ || "").trim().toLowerCase();
  const group = s.mcpToolGroup || "all";
  const filtered = tools.filter((t) => {
    if (group !== "all" && t.group !== group) return false;
    if (!q) return true;
    return `${t.group} ${t.name} ${t.description} ${t.detail || ""}`.toLowerCase().includes(q);
  });
  const groupOpts = [`<option value="all"${group === "all" ? " selected" : ""}>All collections</option>`]
    .concat(groups.map((g) => `<option value="${esc(g)}"${group === g ? " selected" : ""}>${esc(g)}</option>`)).join("");
  const rows = filtered.map((t) => {
    const detail = t.detail && t.detail !== t.description ? t.detail : t.description;
    return `
    <tr>
      <td><span class="mcp-tool-group">${esc(t.group)}</span></td>
      <td><code>${esc(t.name)}</code></td>
      <td class="mcp-tool-desc">
        <div class="mcp-tool-desc-short">${esc(t.description)}</div>
        ${detail !== t.description ? `<div class="mcp-tool-desc-detail">${esc(detail)}</div>` : ""}
      </td>
    </tr>`;
  }).join("")
    || `<tr><td colspan="3" class="muted">No tools match this filter.</td></tr>`;
  return `
    <div class="mcp-tools-bar">
      <label class="mcp-tools-search">${icon("search")}
        <input class="control" id="mcp-tool-q" type="search" placeholder="Filter tools&hellip;" value="${esc(s.mcpToolQ || "")}" autocomplete="off"></label>
      <select class="control" id="mcp-tool-group">${groupOpts}</select>
      <span class="muted-note">${filtered.length} of ${tools.length}</span>
    </div>
    <div class="mcp-tools-list">
      <table class="mcp-tools-table">
        <thead><tr><th>Collection</th><th>Tool</th><th>Description</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function positionMcpMenus() {
  document.querySelectorAll(".mcp-copy-menu:not([hidden])").forEach((menu) => {
    const wrap = menu.closest(".mcp-copy-wrap");
    const btn = wrap?.querySelector("button[aria-haspopup='menu']");
    if (!btn) return;
    menu.classList.add("mcp-copy-menu-fixed");
    const r = btn.getBoundingClientRect();
    const mw = Math.max(menu.offsetWidth || 0, 200);
    let left = r.right - mw;
    if (left < 8) left = 8;
    if (left + mw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - mw - 8);
    let top = r.bottom + 6;
    const mh = menu.offsetHeight || 160;
    if (top + mh > window.innerHeight - 8 && r.top > mh + 8) top = r.top - mh - 6;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.right = "auto";
    menu.style.minWidth = `${Math.round(Math.max(mw, r.width))}px`;
  });
}

function mcpPanel() {
  const m = s.mcp;
  if (!m) return panel("full", "MCP", `<p class="muted-note">Loading MCP settings&hellip;</p>`);
  const tokenVal = s.mcpReveal && (s.mcpToken || m.token) ? esc(s.mcpToken || m.token) : "";
  return `
    <section class="panel full mcp-hero">
      <div class="mcp-hero-top">
        <div class="mcp-hero-title">
          <span class="mcp-hero-ico">${icon("mcp")}</span>
          <div>
            <h2>MCP server</h2>
            <p class="muted-note">Streamable HTTP on this computer only. Clients use a persistent bearer token; the Assistant can share the same tools. IDE configs register the server as <code>MuAnMCP</code>.</p>
          </div>
        </div>
        ${mcpStatusChip(m)}
      </div>
      <div class="mcp-hero-meta">
        <div><small>Endpoint</small><code>${esc(m.url || "")}</code></div>
        <div><small>Bind</small><span>${esc(m.bind || "127.0.0.1")}</span></div>
        <div><small>Tools</small><span>${s.mcpTools?.count ?? 0}</span></div>
      </div>
    </section>

    <section class="panel full mcp-section">
      <h2>Server</h2>
      ${toggle("mcp-enabled", !!m.enabled, "Enable MCP server", "Starts with the manager. Turn off to stop /mcp.")}
      ${toggle("mcp-assistant", !!m.assistantUsesTools, "Assistant uses MCP tools", "When on, in-app chat may call manager tools (reads and writes).")}
      <div class="set-row mcp-url-row"><span><b>URL</b><small>Always localhost in this version</small></span>
        <code class="mono set-path">${esc(m.url || "")}</code>
        <button class="btn" data-set="mcp-copy-url"${s.working ? " disabled" : ""}>${icon("copy")}<span>Copy</span></button></div>
      <div class="set-row mcp-token-row"><span><b>Bearer token</b><small>${m.tokenHint ? `Hint ${esc(m.tokenHint)}` : "Generated on first boot"} · .cache/mcp.json</small></span>
        <input class="control mono" id="mcp-token" type="${s.mcpReveal ? "text" : "password"}" readonly autocomplete="off" spellcheck="false"
          value="${tokenVal}" placeholder="${s.mcpReveal ? "" : "Reveal to show full token"}">
        <div class="mcp-token-actions">
          <button class="btn" data-set="mcp-reveal"${s.working ? " disabled" : ""}>${icon("eye")}<span>${s.mcpReveal ? "Hide" : "Reveal"}</span></button>
          <button class="btn" data-set="mcp-copy-token"${s.working ? " disabled" : ""}>${icon("copy")}<span>Copy</span></button>
          <button class="btn danger" data-set="mcp-rotate"${s.working === "mcp-rotate" ? " disabled" : ""}>${s.working === "mcp-rotate" ? `<span class="spinner"></span>` : icon("refresh")}<span>Rotate</span></button>
        </div>
      </div>
      <div class="panel-actions set-actions">
        <button class="btn primary" data-set="mcp-save"${s.working === "mcp" ? " disabled" : ""}>${s.working === "mcp" ? `<span class="spinner"></span>` : icon("check")}<span>Save</span></button>
      </div>
    </section>

    ${mcpClientsAndAgentsSection()}

    <section class="panel full mcp-section">
      ${sectionHead({
        title: "Tools",
        note: `${s.mcpTools?.count ?? 0} registered tools · see Wiki → MCP. Destructive tools run without a second confirm; calls are audited.`,
      })}
      ${mcpToolsTable()}
    </section>`;
}


const KINDS = {
  roms: { name: "Roms folder", workspace: "Roms" },
  apps: { name: "apps folder", workspace: "apps" },
  os: { name: "OS images folder", workspace: "os", unit: "image" },
  bios: { name: "BIOS folder", workspace: "bios", unit: "file" },
  backups: { name: "backups folder", workspace: "backups", unit: "backup" },
  themes: { name: "themes folder", workspace: "themes", unit: "theme" },
  logs: { name: "logs folder", workspace: "logs", unit: "log" },
};
KINDS.apps.unit = "package";

function folderState(which, f) {
  if (!f.available) return f.custom || which === "roms" ? `<span class="set-chip bad">Folder missing</span>` : `<span class="set-chip">Not created yet</span>`;
  if (which === "roms") return f.count ? `<span class="set-chip ok">${plural(f.count, "system folder")}</span>` : `<span class="set-chip warn">No system folders</span>`;
  const unit = KINDS[which].unit;
  return f.count ? `<span class="set-chip ok">${plural(f.count, unit)}</span>` : `<span class="set-chip">No ${unit}s yet</span>`;
}

/** The path, its state and the buttons to change it, plus the folder browser while choosing. */
function folderBox(d, which) {
  const f = d.folders[which];
  const working = s.working === `folder-${which}`;
  const choosing = s.browse?.which === which;
  const attrs = (extra = "") => ` data-which="${which}"${s.working.startsWith("folder-") || extra ? " disabled" : ""}`;
  return `<div class="set-path">
      <span class="set-path-icon">${FOLDER}</span>
      <code title="${esc(f.path)}">${esc(f.path.split(/[\\/]/).filter(Boolean).slice(-2).join(" / ") || f.path)}</code>
      <span class="set-chip">${f.custom ? "Custom" : "Default"}</span>${folderState(which, f)}
    </div>
    <div class="panel-actions set-actions">
      <button class="btn" data-set="browse"${attrs(s.browse ? "x" : "")}>${FOLDER} Change&hellip;</button>
      ${d.pickFolder ? `<button class="btn" data-set="pick"${attrs()}>${icon("search")}<span>Browse in ${esc(d.fileManager)}</span></button>` : ""}
      ${f.available ? `<button class="btn" data-set="reveal" data-which="${which}">${icon("external")}<span>Show folder</span></button>` : ""}
      ${f.custom ? `<button class="btn ghost" data-set="default"${attrs()} title="${esc(f.default)}">${icon("refresh")}<span>Use default</span></button>` : ""}
      ${working ? `<span class="muted-note set-working"><span class="spinner"></span> ${which === "roms" ? "Scanning the new folder" : "Saving"}&hellip;</span>` : ""}
    </div>
    <details class="set-folder-location"><summary>Full path</summary><code>${esc(f.path)}</code><button class="btn small ghost" data-set="copy-path" data-which="${which}">${icon("copy")} Copy path</button></details>
    ${choosing ? browser(d) : ""}`;
}

function romsPanel(d) {
  return panel("full", "Roms folder", `<p class="muted-note">The games library, artwork, scraper and transfers all read this folder. It holds one folder per system
      (MD, GBA, PS&hellip;), each with its games and an Imgs folder for artwork.</p>${folderBox(d, "roms")}`);
}

function otherFoldersPanel(d) {
  const block = (which, title, note) => `<div class="set-folder"><div class="set-folder-head"><b>${title}</b><small>${note}</small></div>${folderBox(d, which)}</div>`;
  return panel("full", "Other folders", `<div class="set-folders-grid">` +
    block("apps", "Apps", "MustardOS apps and updates (.muxapp, .muxupd, .muxzip) waiting to go to the handheld. ")
    + block("os", "OS images", "MustardOS card images (.img, .img.gz) for System Tools. Images one folder down are found too. ")
    + block("bios", "BIOS", "BIOS files the emulators need (PlayStation, Sega CD, Neo Geo&hellip;), ready to send to the handheld. ")
    + block("backups", "Save backups", "Backups of the handheld's saves and save states. ")
    + block("themes", "Themes", "Themes you make in Themes &rsaquo; Designer, one folder per theme. ")
    + block("logs", "Logs", "Application diagnostic logs written by the manager (JSONL by day). Also browsable under Logs. ") + `</div>`);
}

function crumbs(b) {
  const parts = b.path.split(b.sep).filter(Boolean);
  const root = b.sep === "/" ? "/" : "";
  const out = [];
  let acc = root;
  out.push(`<button class="crumb" data-browse="${esc(root || parts[0] + b.sep)}">${root ? "/" : esc(parts[0])}</button>`);
  for (const [i, part] of parts.entries()) {
    if (!root && i === 0) { acc = part + b.sep; continue; }
    acc = acc.endsWith(b.sep) ? acc + part : acc + b.sep + part;
    out.push(`<span class="crumb-sep">&rsaquo;</span><button class="crumb" data-browse="${esc(acc)}">${esc(part)}</button>`);
  }
  return out.join("");
}

function browser(d) {
  const b = s.browse;
  if (!b.path) return `<div class="set-browser"><div class="planning"><span class="spinner"></span> Opening&hellip;</div></div>`;
  const places = b.places.map((p) => `<button class="place${b.path === p.path ? " on" : ""}" data-browse="${esc(p.path)}" title="${esc(p.path)}">
      ${PLACE_ICONS[p.kind] || FOLDER}<span>${esc(p.name)}</span></button>`).join("");
  const rows = b.dirs.length
    ? b.dirs.map((x) => `<button class="dir${x.system ? " sys" : ""}" data-browse="${esc(x.path)}">${FOLDER}<span>${esc(x.name)}</span>${x.system ? `<em>system</em>` : ""}</button>`).join("")
    : `<div class="muted-note dir-empty">No folders in here.</div>`;
  const verdict = b.which === "bios" || b.which === "backups" || b.which === "themes" || b.which === "logs"
    ? `<span class="set-chip">Any folder</span> ${b.which === "bios" ? "Put BIOS files directly in it, or in subfolders like dc/ as on the handheld." : b.which === "themes" ? "Each theme is a folder in it, the same layout as MUOS/theme on the handheld." : b.which === "logs" ? "Daily manager-YYYY-MM-DD.jsonl files land here." : "Each backup is one .tar.gz file."}`
    : b.which === "apps"
    ? b.apps
      ? `<span class="set-chip ok">${plural(b.apps, "app")}</span> Has MustardOS apps or updates.`
      : `<span class="set-chip">No apps here</span> Apps are .muxapp, .muxupd or .muxzip files. You can add them later.`
    : b.which === "os"
      ? b.images
        ? `<span class="set-chip ok">${plural(b.images, "image")}</span> Has MustardOS images.`
        : `<span class="set-chip">No images here</span> Images are .img or .img.gz files, here or one folder down.`
      : b.systems
        ? `<span class="set-chip ok">${plural(b.systems, "system folder")}</span> Looks like a Roms folder.`
        : `<span class="set-chip warn">No system folders</span> A Roms folder holds folders such as MD, GBA or PS.`;
  const same = b.path === d.folders[b.which].path;
  return `<div class="set-browser">
    <aside class="set-places">${places}</aside>
    <div class="set-files">
      <div class="set-nav">
        <button class="btn icon" data-browse="${esc(b.parent)}" title="Up one folder" aria-label="Up one folder"${b.parent ? "" : " disabled"}>${icon("arrow", "up")}</button>
        <div class="crumbs">${crumbs(b)}</div>
      </div>
      <form class="set-go" data-set-form="go">
        <input class="control" id="set-browse-path" value="${esc(b.input ?? b.path)}" spellcheck="false" autocomplete="off" aria-label="Folder path">
        <button class="btn" type="submit">Go</button>
      </form>
      <div class="set-dirs${b.loading ? " loading" : ""}">${rows}</div>
      <div class="set-verdict">${verdict}</div>
      <div class="set-foot">
        <button class="btn ghost" data-set="cancel">Cancel</button>
        <button class="btn primary" data-set="use"${same ? ` disabled title="This is already the ${KINDS[b.which].name}"` : ""}>${icon("check")}<span>Use this folder</span></button>
      </div>
    </div>
  </div>`;
}

function copyPanel(d) {
  return panel("half", "Transfers, startup and updates",
    `<p class="muted-note">How copying to the handheld behaves, what happens when the manager starts, and whether it looks for newer versions on GitHub.</p>`
    + toggle("copyArt", d.settings.copyArt, "Send box art with games",
      "Transferring a game also puts its Roms/ image in the device's artwork catalogue, unless the device has box art for it already.")
    + toggle("openBrowser", d.settings.openBrowser, "Open the browser at start",
      "Starting the manager opens this page. Off: it only prints the link. A restart reuses the open tab either way.")
    + `<div class="set-row"><span><b>Show tips at start</b><small>After the setup wizard and What's new, open the Hints and tips walkthrough. You can also turn this off in the tips dialog.</small></span>
      <span class="switch"><input type="checkbox" role="switch" data-set-tips${tipsOnStartup() ? " checked" : ""}><span class="switch-track"></span></span></div>`
    + `<div class="set-row"><span><b>Hints and tips</b><small>Walk through the manager's main features again.</small></span>
      <button class="btn" data-set="tips">${icon("star")}<span>Open tips</span></button></div>`
    + toggle("checkUpdates", d.settings.checkUpdates, "Check for manager updates",
      "Every few hours the manager reads the version number on GitHub and shows Update in the top bar when there is a newer one. Nothing else is sent.")
    + shortcutRow(d.shortcut, "set", s.working === "shortcut", !!s.working));
}

/** Shared with the setup wizard. */
export const shortcutRow = (sc, attr, working, busy) => `<div class="set-row"><span><b>App shortcut</b>
    <small>${sc.exists ? `In ${esc(sc.place)}` : `Adds the manager to ${esc(sc.place)} with its icon`}. It opens a terminal window that runs the manager and this page; closing the window stops it.</small></span>
  <button class="btn" data-${attr}="shortcut"${busy ? " disabled" : ""} title="${esc(sc.path)}">${working ? `<span class="spinner"></span>` : icon(sc.exists ? "refresh" : "plus")}<span>${sc.exists ? "Create again" : "Add"}</span></button></div>`;

function imagesPanel() {
  const sizes = maxSides().map(([v, l]) => `<option value="${v}"${artMax.get() === v ? " selected" : ""}>${l}</option>`).join("");
  return panel("half", "Images", `
    <p class="muted-note">How large uploaded box art is saved when you send or shrink pictures.</p>
    <div class="set-row"><span><b>Uploaded artwork size</b><small>Longest side for images you upload or shrink. The ${esc(model().name)}'s screen is ${esc(screenText(model()))}.</small></span>
      <select class="control" data-set-artmax>${sizes}</select></div>`);
}

function schemeCard(id, label, chips, custom = false) {
  const swatch = chips.map((c) => `<i style="background:${c}"></i>`).join("");
  const tools = custom
    ? `<span class="set-scheme-tools">
        <button type="button" class="btn icon small ghost" data-scheme-edit="${esc(id)}" title="Edit scheme" aria-label="Edit ${esc(label)}">${icon("sliders")}</button>
        <button type="button" class="btn icon small ghost" data-scheme-del="${esc(id)}" title="Delete scheme" aria-label="Delete ${esc(label)}">${icon("trash")}</button>
      </span>`
    : "";
  return `<div class="set-scheme${app.ui.scheme === id ? " on" : ""}">
    <button type="button" class="set-scheme-pick" data-set-scheme="${esc(id)}" aria-pressed="${app.ui.scheme === id}">
      <b>${esc(label)}</b><span class="set-swatch" aria-hidden="true">${swatch}</span></button>${tools}</div>`;
}

function appearancePanels() {
  const theme = app.ui.theme;
  const themeSeg = [["dark", "Dark"], ["light", "Light"], ["system", "Match system"]]
    .map(([v, l]) => `<button type="button" data-set-theme="${v}" aria-pressed="${theme === v}" class="${theme === v ? "on" : ""}">${l}</button>`).join("");
  const customs = loadCustomSchemes();
  const schemes = SCHEMES.map(([id, label, chips]) => schemeCard(id, label, chips)).join("")
    + customs.map((c) => schemeCard(c.id, c.name, schemeChips(c), true)).join("")
    + `<button type="button" class="set-scheme set-scheme-new" data-set="scheme-new" title="Create a custom colour scheme">
        <b>${icon("plus")} Create new</b><span class="muted-note">Your own accent and surfaces</span></button>`;
  const zoomSeg = ZOOM_LEVELS.map((v) =>
    `<button type="button" data-set-zoom="${v}" aria-pressed="${app.ui.zoom === v}" class="${app.ui.zoom === v ? "on" : ""}">${v}%</button>`).join("");
  const now = new Date();
  const style = app.ui.clockStyle === "analog" ? "analog" : "digital";
  const styleSeg = [["digital", "Digital"], ["analog", "Analog"]]
    .map(([v, l]) => `<button type="button" data-set-clock-style="${v}" aria-pressed="${style === v}" class="${style === v ? "on" : ""}">${l}</button>`).join("");
  const clockSeg = [["24", "24-hour"], ["12", "12-hour"]]
    .map(([v, l]) => `<button type="button" data-set-clock="${v}" aria-pressed="${app.ui.clock === v}" class="${app.ui.clock === v ? "on" : ""}" title="${esc(formatTime(now, v))}"${style === "analog" ? " disabled" : ""}>${l}</button>`).join("");
  const dates = DATE_FORMATS.map(([v, l]) => `<option value="${v}"${app.ui.dateFormat === v ? " selected" : ""}>${v === "none" ? l : `${esc(formatDate(now, v))} \u00b7 ${l}`}</option>`).join("");
  return `${panel("full", `${icon("palette")} Colours and style`, `
    <p class="muted-note">Dark or light mode, and a colour scheme for accents and surfaces. Changes apply at once and stay on this computer.</p>
    <div class="set-row"><span><b>Theme</b><small>Dark matches the MustardOS look on the handheld.</small></span>
      <div class="segmented">${themeSeg}</div></div>
    <div class="set-scheme-block"><span><b>Colour scheme</b><small>Accent and background colours together. Create new opens an editor with a live preview.</small></span>
      <div class="set-schemes">${schemes}</div></div>
    <label class="set-row set-toggle"><span><b>Softer style</b><small>Pastel accents, rounder corners and airier spacing. Selected controls stay the same accent fill as default.</small></span>
      <span class="switch"><input type="checkbox" role="switch" data-set-soft${app.ui.soft ? " checked" : ""}><span class="switch-track"></span></span></label>
`)
  }${panel("half", "Density", `
    <p class="muted-note">Choose how much fits on screen. These settings work with every colour scheme and style.</p>
    <div class="set-row"><span><b>Zoom</b><small>Scales the whole manager window.</small></span>
      <div class="segmented">${zoomSeg}</div></div>
    <label class="set-row set-toggle"><span><b>Compact layout</b><small>Smaller padding, bars and controls. Game card size stays on the Games toolbar.</small></span>
      <span class="switch"><input type="checkbox" role="switch" data-set-compact${app.ui.compact ? " checked" : ""}><span class="switch-track"></span></span></label>`)
  }${panel("half", "Clock", `
    <p class="muted-note">Time and date in the top bar. Analog shows a small clock face; digital uses numbers.</p>
    <div class="set-row"><span><b>Style</b><small>${style === "analog" ? "Small clock face in the top bar." : `Digits in the top bar: ${esc(formatTime(now))}.`}</small></span>
      <div class="segmented">${styleSeg}</div></div>
    <div class="set-row"><span><b>Format</b><small>${style === "analog" ? "Used when Style is Digital." : "12-hour or 24-hour digits."}</small></span>
      <div class="segmented">${clockSeg}</div></div>
    <div class="set-row"><span><b>Date</b><small>Shown next to the clock.</small></span>
      <select class="control" data-set-date>${dates}</select></div>`)
  }${panel("full", "Reset", `
    <p class="muted-note">Put theme, colour scheme, zoom, softer style, compact layout, clock and date back to the defaults. Sorting, open tabs and connection stay.</p>
    <div class="set-row"><span><b>Appearance</b><small>Only the choices on this tab.</small></span>
      <button class="btn" data-set="appearance-reset">${icon("refresh")}<span>Reset to default</span></button></div>`)}`;
}

function dataRow(label, note, size, action, button, title = "") {
  const working = s.working === action;
  return `<div class="set-row"><span><b>${label}</b><small>${note}${size !== null ? ` &middot; ${size ? human(size) : "not downloaded"}` : ""}</small></span>
    <button class="btn" data-set-refresh="${action}"${s.working ? " disabled" : ""}${title ? ` title="${title}"` : ""}>${working ? `<span class="spinner"></span> Working&hellip;` : button}</button></div>`;
}

function dataPanel(d) {
  return panel("half", "Game data",
    `<p class="muted-note">Rescan the library or download descriptions and arcade names again. The setup wizard walks through folders and connection from scratch.</p>
    <div class="set-row"><span><b>Setup wizard</b><small>Walk through the handheld, folders, connection and downloads again</small></span>
      <button class="btn" data-set="wizard">${icon("star")}<span>Run setup</span></button></div>` +
    dataRow("Roms folder scan", "Reads every system folder again, as at start", null, "rescan", "Rescan now")
    + dataRow("Game descriptions", "Text, genres, ratings and years from the LaunchBox Games Database", d.cache.descriptions, "descriptions", "Download again", "About 110 MB; takes a minute or two")
    + dataRow("Arcade titles", "Full names for MAME and FinalBurn Neo ROMs", d.cache.names, "names", "Download again"));
}

const clearButton = (attr, what, enabled, label = "Clear") => {
  const working = s.working === `${attr}-${what}`;
  return `<button class="btn danger" data-${attr}="${what}"${!enabled || s.working ? " disabled" : ""}>${working ? `<span class="spinner"></span>` : icon("trash")}<span>${label}</span></button>`;
};

function cachePanel(d) {
  const row = (label, note, size, what) => `<div class="set-row"><span><b>${label}</b><small>${note} &middot; ${size ? human(size) : "empty"}</small></span>
    ${clearButton("set-clear", what, size)}</div>`;
  return panel("half", "Cache",
    `<p class="muted-note">Clear downloaded lists and previews. They are fetched again when you need them.</p>`
    + row("Scraper file lists", "What the libretro thumbnail project has, kept for 14 days", d.cache.thumbnails, "thumbnails")
    + row("Device artwork previews", "Pictures already read from the handheld", d.cache.deviceArt, "deviceArt")
    + row("Online catalogues", "PortMaster, app market, theme and MustardOS update lists with their previews; downloaded again when needed", d.cache.catalogues, "catalogues")
    + row("ROM check results", "Verify results, ROM checksums and No-Intro lists", d.cache.checks, "checks")
    + `<p class="muted-note set-cache-path">Kept in <code>${esc(d.cache.folder)}</code></p>`);
}

const PREF_KEEP = new Set(["mode", "model", "cardModels", "ssh.snippets"]);
const prefKeys = () => {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i), m = /^(manager|library)\.(.+)$/.exec(k || "");
    if (m && !PREF_KEEP.has(m[2])) out.push(k);
  }
  return out;
};

const handheldReady = () => app.ui.mode !== "card" && !!app.device.target;

/** Redraws Settings when the handheld comes or goes, so its reset buttons follow the connection. */
export function settingsDeviceChanged() {
  if (section() === "settings" && s.data && s.handheld !== handheldReady()) render();
}

function historyPanel(d) {
  const handheld = s.handheld = handheldReady();
  const away = handheld ? "" : " &middot; connect over USB or Wi-Fi first";
  const row = (label, note, button) => `<div class="set-row"><span><b>${label}</b><small>${note}</small></span>${button}</div>`;
  let prefs = 0;
  try { prefs = prefKeys().length; } catch {}
  return panel("full", "History and resets", `<p class="muted-note">Clear the activity log or browser layout prefs here, or reset play history on the handheld when it is connected over USB or Wi-Fi.</p>
    <div class="set-cols">
    <div><h3>On this computer</h3>
      ${row("Activity log", `Everything the manager changed, shown on Overview &middot; ${d.cache.activity ? `${d.cache.activity.toLocaleString()} ${d.cache.activity === 1 ? "entry" : "entries"}` : "empty"}`, clearButton("set-clear", "activity", d.cache.activity))}
      ${row("View preferences", "Sorting, layout, open tabs, theme, colour scheme, zoom, clock and scraper choices this browser remembers. Keeps the connection, handheld model and SSH snippets", clearButton("set-reset", "prefs", prefs, "Reset"))}
    </div>
    <div><h3>On the handheld</h3>
      ${row("Play time", `Launches and time played per game, shown in Play${away}`, clearButton("set-play", "time", handheld, "Reset"))}
      ${row("Recently played", `The History list in the MustardOS menu${away}`, clearButton("set-play", "history", handheld))}
    </div></div>`);
}

function resetPanel() {
  const working = s.working === "reset";
  return panel("full set-danger", `${icon("alert")} Factory reset`, `<div class="set-row"><span><b>Start over from scratch</b>
      <small>Moves your games and every other workspace folder (Roms, apps, OS images, BIOS, backups, themes, logs), plus all of the manager's settings,
        Wi-Fi and SSH logins, downloads and history, to the Trash. The manager then creates empty workspace folders and restarts with the setup wizard, as on its first run.
        Nothing on the handheld or its cards is changed.</small></span>
    <button class="btn danger-solid" data-set="reset"${s.working || busy() ? " disabled" : ""}>${working ? `<span class="spinner"></span>` : icon("trash")}<span>${working ? "Resetting&hellip;" : "Factory reset&hellip;"}</span></button></div>`);
}

const RESET_FOLDERS = [["roms", "Roms", "your game library"], ["apps", "apps", "app packages"], ["os", "os", "MustardOS images"], ["bios", "bios", "BIOS files"], ["backups", "backups", "save backups from the handheld"], ["themes", "themes", "themes you designed"], ["logs", "logs", "application diagnostic logs"]];

async function factoryReset() {
  const folders = RESET_FOLDERS.filter(([k]) => s.data.folders[k]?.available);
  const rows = folders.map(([k, name, what]) => {
    const f = s.data.folders[k], count = k === "roms" ? plural(app.all.length, "game") : plural(f.count, "file");
    return `<label class="set-reset-row"><input type="checkbox" data-reset-folder="${k}" checked>
      <span><b>${esc(name)}</b> &middot; ${esc(what)} &middot; ${count}<code><bdi>${esc(f.path)}</bdi></code></span></label>`;
  }).join("");
  const answer = confirmBox({
    title: "Factory reset the manager?",
    html: `<div class="notice err">${icon("alert")} <span>This removes your game library and everything else ticked below from this computer, and signs the manager
        out of the handheld. It all goes to the Trash, so you can get it back until you empty the Trash.</span></div>
      ${rows ? `<p><b>Folders to move to the Trash</b></p><div class="set-reset-list">${rows}</div>` : ""}
      <p>Always moved to the Trash: the manager's settings, Wi-Fi and SSH logins, downloaded game data and catalogues, ROM check results and the
        activity log. This browser forgets its view preferences too. Nothing on the handheld or its cards is changed.</p>
      <p>Type <b>RESET</b> to confirm.</p>
      <input class="control fx-input" id="reset-word" aria-label="Type RESET to confirm" autocomplete="off" spellcheck="false" placeholder="RESET">`,
    ok: "Factory reset",
    danger: true,
  });
  const ok = $("c-ok"), input = $("reset-word");
  ok.disabled = true;
  input.oninput = () => { ok.disabled = input.value.trim() !== "RESET"; };
  input.onkeydown = (e) => { if (e.key === "Enter" && !ok.disabled) { e.preventDefault(); ok.click(); } };
  input.focus();
  const confirmed = await answer;
  ok.disabled = false;
  if (!confirmed || input.value.trim() !== "RESET") return;
  const chosen = [...document.querySelectorAll("[data-reset-folder]:checked")].map((i) => i.dataset.resetFolder);

  s.working = "reset";
  render();
  let res;
  try {
    res = await api("settings/factory-reset", { confirm: "RESET", folders: chosen });
  } catch (error) {
    s.working = "";
    render();
    toast(error.message, 6000);
    return;
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (/^(manager|library)\./.test(k || "")) localStorage.removeItem(k);
    }
  } catch {}
  if (res.kept.length) toast(`Left on their own drive: ${res.kept.join(", ")}`, 8000);
  if (!res.restart) {
    $("settings").innerHTML = `<div class="notice ok">${icon("check")} <span>Factory reset done and the manager stopped. Start it again from the app shortcut,
      <code>run.sh</code> or <code>run.cmd</code>; it opens the setup wizard.</span></div>`;
    return;
  }
  toast("Factory reset done. Restarting the manager\u2026", 6000);
  const until = Date.now() + 3 * 60 * 1000;
  await new Promise((r) => setTimeout(r, 1500));
  while (Date.now() < until) {
    try {
      const d = await api("manager");
      if (d.started !== res.started) { location.reload(); return; }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  s.working = "";
  toast("The manager did not come back. Start it again with the app shortcut or run.sh.", 8000);
}

// ---------------------------------------------------------------- actions

async function browse(path, which = s.browse?.which || "roms") {
  if (s.browse && s.browse.which !== which) s.browse = null;
  const b = s.browse || (s.browse = { path: "", dirs: [], places: [], which });
  b.loading = true;
  b.input = undefined;
  const seq = b.seq = (b.seq || 0) + 1;
  render();
  try {
    const found = await api(`settings/folders?path=${encodeURIComponent(path || "")}`);
    if (s.browse !== b || b.seq !== seq) return;
    Object.assign(b, found);
  } catch (error) {
    if (s.browse !== b || b.seq !== seq) return;
    toast(error.message, 4000);
    if (!b.path) s.browse = null;
  }
  b.loading = false;
  render();
}

async function useOtherFolder(which, target) {
  s.working = `folder-${which}`;
  render();
  try {
    s.data = await api("settings", { [which]: target });
    s.browse = null;
    app.overview.workspace = null;
    if (which === "os") { forgetImages(); reloadOs(); }
    const f = s.data.folders[which];
    const k = KINDS[which];
    toast(`${k.name[0].toUpperCase() + k.name.slice(1)} set: ${plural(f.count, k.unit)}`, 2600);
  } catch (error) {
    toast(error.message, 3500);
  }
  s.working = "";
  render();
}

async function useFolder(path, which = "roms") {
  const target = path ?? "";
  if (which !== "roms") return useOtherFolder(which, target);
  if (busy()) { toast("Wait for the copy to finish first"); return; }
  if (target && s.browse && s.browse.path === target && !s.browse.systems) {
    const ok = await confirmBox({
      title: "Use this folder?",
      html: `<p><code>${esc(target)}</code> has no system folders such as MD, GBA or PS, so the library will be empty until you add some.</p>`,
      ok: "Use it anyway",
    });
    if (!ok) return;
  }
  s.working = "folder-roms";
  render();
  try {
    s.data = await api("settings", { roms: target });
    s.browse = null;
    invalidateLocal();
    await loadLibrary();
    toast(`${app.all.length.toLocaleString()} games in the new Roms folder`, 2600);
  } catch (error) {
    toast(error.message, 3500);
  }
  s.working = "";
  render();
}

async function saveToggle(key, value) {
  if (key === "mcp-enabled" || key === "mcp-assistant") {
    await saveMcp({
      enabled: key === "mcp-enabled" ? value : undefined,
      assistantUsesTools: key === "mcp-assistant" ? value : undefined,
    });
    return;
  }
  try {
    s.data = await api("settings", { [key]: value });
    toast("Saved");
    if (key === "checkUpdates") checkManager(value);
  } catch (error) {
    toast(error.message, 3000);
  }
  render();
}

async function saveMcp(partial = null) {
  s.working = "mcp";
  render();
  try {
    const body = partial || {
      enabled: !!document.querySelector('[data-set-toggle="mcp-enabled"]')?.checked,
      assistantUsesTools: !!document.querySelector('[data-set-toggle="mcp-assistant"]')?.checked,
    };
    // Drop undefined keys so we only patch what changed.
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
    s.mcp = await api("mcp/settings", body);
    mcpStatusChanged(s.mcp);
    toast("MCP settings saved", 2200);
  } catch (error) {
    toast(error.message, 4000);
  }
  s.working = "";
  render();
}

async function revealMcpToken() {
  if (s.mcpReveal) {
    s.mcpReveal = false;
    s.mcpToken = "";
    render();
    return;
  }
  try {
    const m = await api("mcp/settings?reveal=1");
    s.mcp = { ...s.mcp, ...m, token: undefined };
    s.mcpToken = m.token || "";
    s.mcpReveal = true;
    render();
  } catch (error) {
    toast(error.message, 3500);
  }
}

async function rotateMcpToken() {
  const ok = await confirmBox({
    title: "Rotate the MCP token?",
    html: "<p>Existing Cursor / Claude configs stop working until you paste the new token. Active MCP sessions will need to reconnect.</p>",
    ok: "Rotate token",
    danger: true,
  });
  if (!ok) return;
  s.working = "mcp-rotate";
  render();
  try {
    const m = await api("mcp/token/rotate", {});
    s.mcp = { ...m, token: undefined };
    s.mcpToken = m.token || "";
    s.mcpReveal = true;
    mcpStatusChanged(s.mcp);
    toast("MCP token rotated — copy it into your clients", 3200);
  } catch (error) {
    toast(error.message, 4000);
  }
  s.working = "";
  render();
}

async function copyMcpText(kind) {
  try {
    if (kind === "url") {
      await navigator.clipboard.writeText(s.mcp?.url || "");
      toast("MCP URL copied", 2000);
      return;
    }
    if (kind === "token") {
      let token = s.mcpToken;
      if (!token) {
        const m = await api("mcp/settings?reveal=1");
        token = m.token || "";
        s.mcpToken = token;
        s.mcpReveal = true;
        render();
      }
      if (!token) throw new Error("No token yet");
      await navigator.clipboard.writeText(token);
      toast("MCP token copied", 2000);
      return;
    }
  } catch (error) {
    toast(error.message || "Could not copy", 3500);
  }
}

async function scanMcpClients() {
  s.working = "mcp-scan";
  s.mcpCopyOpen = false;
  s.mcpInstallOpen = "";
  s.mcpInstallAllOpen = false;
  render();
  try {
    s.mcpClients = await api("mcp/clients");
    const n = (s.mcpClients.clients || []).filter((c) => c.installed).length;
    toast(n ? `Found ${n} installed client${n === 1 ? "" : "s"}` : "No matching IDEs found — copy a config instead", 2800);
  } catch (error) {
    toast(error.message, 4000);
  }
  s.working = "";
  render();
}

async function setupMcpClient(id) {
  if (!id) return;
  const client = (s.mcpClients?.clients || []).find((c) => c.id === id);
  const label = client?.label || id;
  const ok = await confirmBox({
    title: `Set up ${label}?`,
    html: `<p>The manager will merge <code>MuAnMCP</code> into:</p>
      <p><code>${esc(client?.configPath || "")}</code></p>
      <p>Other MCP servers in that file stay. Restart ${esc(label)} if it is already open.</p>`,
    ok: client?.configured ? "Update config" : "Write config",
  });
  if (!ok) return;
  s.working = `mcp-setup-${id}`;
  render();
  try {
    const r = await api("mcp/clients/install", { id, force: !client?.installed });
    toast(r.message || `Configured ${label}`, 3200);
    s.mcpClients = await api("mcp/clients");
  } catch (error) {
    toast(error.message, 4000);
  }
  s.working = "";
  render();
}

async function reviewMcpAgent(id) {
  if (!id) return;
  s.working = `mcp-agent-${id}`;
  try {
    const pack = await api(`mcp/agents/content?id=${encodeURIComponent(id)}`);
    s.mcpAgentReviewId = id;
    const dialog = $("mcp-agent-review");
    const title = $("mcp-agent-review-title");
    const sub = $("mcp-agent-review-sub");
    const body = $("mcp-agent-review-body");
    if (title) title.textContent = pack.name || id;
    if (sub) {
      sub.textContent = `${pack.kind === "expert" ? "Expert" : "Skill"} · ${id}${pack.description ? ` — ${pack.description}` : ""}`;
    }
    if (body) body.innerHTML = mdHtml(pack.markdown || "");
    if (dialog && !dialog.open) dialog.showModal();
  } catch (error) {
    toast(error.message, 4000);
  }
  s.working = "";
}

async function copyMcpAgent(id) {
  try {
    const pack = await api(`mcp/agents/content?id=${encodeURIComponent(id)}`);
    await navigator.clipboard.writeText(pack.markdown || "");
    toast(`${pack.name || id} copied`, 2200);
  } catch (error) {
    toast(error.message || "Could not copy", 3500);
  }
}

async function installMcpAgent(id, clientId) {
  if (!id || !clientId) return;
  const pack = (s.mcpAgents?.packs || []).find((p) => p.id === id);
  const client = (s.mcpClients?.clients || []).find((c) => c.id === clientId);
  const ok = await confirmBox({
    title: `Install ${pack?.name || id}?`,
    html: `<p>Write <code>SKILL.md</code> into:</p>
      <p><code>${esc(client?.skillsDir || "")}/${esc(id)}/</code></p>
      <p>Overwrites the same pack id if it already exists. Restart ${esc(client?.label || "the IDE")} if it is open.</p>`,
    ok: "Install",
  });
  if (!ok) return;
  s.working = `mcp-agent-install-${id}`;
  s.mcpInstallOpen = "";
  s.mcpInstallAllOpen = false;
  render();
  try {
    const r = await api("mcp/agents/install", { id, clientId });
    toast(r.message || "Installed", 3200);
  } catch (error) {
    toast(error.message, 4000);
  }
  s.working = "";
  render();
}

async function installAllMcpAgents(clientId) {
  if (!clientId) return;
  const packs = s.mcpAgents?.packs || [];
  const client = (s.mcpClients?.clients || []).find((c) => c.id === clientId);
  if (!packs.length) {
    toast("No agent packs to install", 2500);
    return;
  }
  const ok = await confirmBox({
    title: `Install all ${packs.length} packs?`,
    html: `<p>Write every skill and expert into:</p>
      <p><code>${esc(client?.skillsDir || "")}/&lt;pack-id&gt;/</code></p>
      <p>Overwrites the same pack ids if they already exist. Restart ${esc(client?.label || "the IDE")} if it is open.</p>`,
    ok: "Install all",
  });
  if (!ok) return;
  s.working = "mcp-agent-install-all";
  s.mcpInstallOpen = "";
  s.mcpInstallAllOpen = false;
  render();
  try {
    const r = await api("mcp/agents/install-all", { clientId });
    toast(r.message || `Installed ${r.count || packs.length} packs`, 3200);
  } catch (error) {
    toast(error.message, 4000);
  }
  s.working = "";
  render();
}

async function copyMcpClientConfig(id) {
  try {
    let client = (s.mcpClients?.clients || []).find((c) => c.id === id);
    if (!client?.snippet) {
      const cfg = await api("mcp/configs");
      client = (cfg.clients || []).find((c) => c.id === id);
      if (!client?.snippet && id === "cursor" && cfg.cursor) client = { id, label: "Cursor", snippet: cfg.cursor };
      if (!client?.snippet && (id === "claude-desktop" || id === "claude") && cfg.claudeDesktop) {
        client = { id: "claude-desktop", label: "Claude Desktop", snippet: cfg.claudeDesktop };
      }
    }
    if (!client?.snippet) throw new Error("No config snippet for that client");
    await navigator.clipboard.writeText(client.snippet);
    toast(`${client.label || id} config copied`, 2200);
    s.mcpCopyOpen = false;
    render();
  } catch (error) {
    toast(error.message || "Could not copy", 3500);
  }
}

async function refresh(what) {
  s.working = what;
  render();
  try {
    s.data = await api("settings/refresh", { what });
    await loadLibrary();
    toast(what === "rescan" ? `Found ${app.all.length.toLocaleString()} games` : "Downloaded and applied", 2400);
  } catch (error) {
    toast(error.message, 3500);
  }
  s.working = "";
  render();
}

const CLEAR_CONFIRM = {
  checks: { title: "Clear ROM check results?", html: "<p>Checks forgets what it verified. The next check reads every ROM again, which takes a while for a big library.</p>" },
  activity: { title: "Clear the activity log?", html: "<p>Everything under Recent activity is removed. This cannot be undone.</p>" },
};

async function clear(what) {
  const ask = CLEAR_CONFIRM[what];
  if (ask && !(await confirmBox({ ...ask, ok: "Clear", danger: true }))) return;
  s.working = `set-clear-${what}`;
  render();
  try {
    s.data = await api("settings/clear-cache", { what });
    if (what === "activity") forgetActivity();
    toast("Cleared");
  } catch (error) {
    toast(error.message, 3000);
  }
  s.working = "";
  render();
}

async function resetPlay(what) {
  const time = what === "time";
  const ok = await confirmBox({
    title: time ? "Reset play time on the handheld?" : "Clear the handheld's history?",
    html: time
      ? "<p>MustardOS forgets how often and how long you played every game. This changes the handheld and cannot be undone.</p>"
      : "<p>Every game leaves the History list in the MustardOS menu; the games themselves stay. This changes the handheld and cannot be undone.</p>",
    ok: time ? "Reset play time" : "Clear history",
    danger: true,
  });
  if (!ok) return;
  s.working = `set-play-${what}`;
  render();
  try {
    const r = await api("play/reset", { volume: handheldVolume(), what });
    forgetPlay();
    forgetActivity();
    toast(time ? "Play time reset" : r.removed ? `Removed ${plural(r.removed, "game")} from the history` : "The history was already empty", 2600);
  } catch (error) {
    toast(error.message, 3500);
  }
  s.working = "";
  render();
}

async function makeShortcut() {
  s.working = "shortcut";
  render();
  try {
    s.data = await api("settings/shortcut", {});
    toast(`Added to ${s.data.shortcut.place}`, 2600);
  } catch (error) {
    toast(error.message, 4000);
  }
  s.working = "";
  render();
}

async function saveAssistant(clear) {
  if (!s.chat) return;
  if (clear) {
    const ok = await confirmBox({
      title: "Clear the assistant key?",
      html: "<p>The chat button disappears until you paste a key again. Conversation history in the panel is not kept on the server.</p>",
      ok: "Clear key",
      danger: true,
    });
    if (!ok) return;
  }
  s.working = "chat";
  render();
  try {
    const modelSel = $("chat-model")?.value;
    const model = modelSel === "__custom__" ? ($("chat-custom")?.value || "").trim() : modelSel;
    s.chat = await api("chat/settings", {
      provider: $("chat-provider")?.value || s.chat.provider,
      apiKey: clear ? "" : ($("chat-key")?.value ?? s.chatKey),
      clearKey: !!clear,
      model,
      baseUrl: $("chat-base")?.value ?? s.chat.baseUrl ?? "",
      temperature: Number($("chat-temp")?.value),
      maxTokens: Number($("chat-maxtok")?.value),
      includeLibrary: !!$("chat-library")?.checked,
      includeConnection: !!$("chat-connection")?.checked,
    });
    s.chatKey = "";
    chatConfiguredChanged(s.chat.configured, s.chat);
    toast(clear ? "Assistant key cleared" : s.chat.configured ? "Assistant saved" : "Saved — add a key to enable chat", 2600);
  } catch (error) {
    toast(error.message, 4000);
  }
  s.working = "";
  render();
}

function syncPromptReset() {
  const c = s.chat, text = $("chat-prompt-text"), reset = $("chat-prompt-reset");
  if (!c || !text || !reset) return;
  const trimmed = text.value.trim();
  const isDefault = !trimmed || trimmed === (c.defaultSystemPrompt || "").trim();
  reset.disabled = isDefault || s.working === "prompt";
}

function openPromptEditor() {
  if (!s.chat) return;
  const dialog = $("chat-prompt"), text = $("chat-prompt-text");
  if (!dialog || !text) return;
  text.value = s.chat.systemPrompt || s.chat.defaultSystemPrompt || "";
  syncPromptReset();
  if (!dialog.open) dialog.showModal();
  text.focus();
}

function closePromptEditor() {
  $("chat-prompt")?.close();
}

async function savePrompt({ reset = false } = {}) {
  if (!s.chat) return;
  s.working = "prompt";
  syncPromptReset();
  const saveBtn = $("chat-prompt-save"), resetBtn = $("chat-prompt-reset");
  if (saveBtn) saveBtn.disabled = true;
  if (resetBtn) resetBtn.disabled = true;
  try {
    const body = reset ? { resetSystemPrompt: true } : { systemPrompt: $("chat-prompt-text")?.value ?? "" };
    s.chat = await api("chat/settings", body);
    toast(s.chat.systemPromptCustom ? "Custom system prompt saved" : "Using the default system prompt", 2600);
    closePromptEditor();
    render();
  } catch (error) {
    toast(error.message, 4000);
  }
  s.working = "";
  if (saveBtn) saveBtn.disabled = false;
  syncPromptReset();
}

function bindPromptDialog() {
  if (s.promptBound) return;
  const dialog = $("chat-prompt");
  if (!dialog) return;
  s.promptBound = true;
  $("chat-prompt-cancel")?.addEventListener("click", closePromptEditor);
  $("chat-prompt-save")?.addEventListener("click", () => savePrompt());
  $("chat-prompt-reset")?.addEventListener("click", () => {
    const text = $("chat-prompt-text");
    if (text && s.chat) text.value = s.chat.defaultSystemPrompt || "";
    syncPromptReset();
    savePrompt({ reset: true });
  });
  $("chat-prompt-text")?.addEventListener("input", syncPromptReset);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) closePromptEditor(); });
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); closePromptEditor(); });
}

function closeKnowledgeViewer() {
  $("chat-knowledge")?.close();
}

async function openKnowledgeViewer() {
  const dialog = $("chat-knowledge"), body = $("chat-knowledge-body");
  if (!dialog || !body) return;
  body.innerHTML = `<p class="muted-note"><span class="spinner sm"></span> Loading&hellip;</p>`;
  if (!dialog.open) dialog.showModal();
  try {
    if (!s.knowledgeMd) {
      const res = await api("chat/knowledge");
      s.knowledgeMd = res.markdown || "";
    }
    body.innerHTML = s.knowledgeMd
      ? mdHtml(s.knowledgeMd)
      : `<p class="muted-note">Knowledge base file is missing.</p>`;
  } catch (error) {
    body.innerHTML = `<p class="muted-note">${esc(error.message)}</p>`;
  }
  body.focus();
}

function bindKnowledgeDialog() {
  if (s.knowledgeBound) return;
  const dialog = $("chat-knowledge");
  if (!dialog) return;
  s.knowledgeBound = true;
  $("chat-knowledge-close")?.addEventListener("click", closeKnowledgeViewer);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) closeKnowledgeViewer(); });
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); closeKnowledgeViewer(); });
}

function closeMcpAgentReview() {
  $("mcp-agent-review")?.close();
  s.mcpAgentReviewId = "";
}

function bindMcpAgentReview() {
  if (s.mcpAgentBound) return;
  const dialog = $("mcp-agent-review");
  if (!dialog) return;
  s.mcpAgentBound = true;
  $("mcp-agent-review-close")?.addEventListener("click", closeMcpAgentReview);
  $("mcp-agent-review-copy")?.addEventListener("click", () => {
    if (s.mcpAgentReviewId) void copyMcpAgent(s.mcpAgentReviewId);
  });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) closeMcpAgentReview(); });
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); closeMcpAgentReview(); });
}

async function resetPrefs() {
  const ok = await confirmBox({
    title: "Reset view preferences?",
    html: "<p>Sorting, layout, open tabs, theme, colour scheme, zoom, clock and scraper choices go back to their defaults and the page reloads. The connection, handheld model and SSH snippets stay.</p>",
    ok: "Reset and reload",
    danger: true,
  });
  if (!ok) return;
  try { for (const k of prefKeys()) localStorage.removeItem(k); } catch {}
  location.reload();
}

async function resetAppearance() {
  const ok = await confirmBox({
    title: "Reset appearance?",
    html: "<p>Theme, colour scheme, zoom, softer style, compact layout, clock style, format and date go back to their defaults. Custom schemes you created stay. Sorting, open tabs and connection stay.</p>",
    ok: "Reset to default",
  });
  if (!ok) return;
  Object.assign(app.ui, APPEARANCE_DEFAULTS);
  for (const [key, value] of Object.entries(APPEARANCE_DEFAULTS)) store.set(key, value);
  applyView();
  renderStatusbar();
  render();
  toast("Appearance reset", 2200);
}

function openSchemeEditor(existing = null) {
  if (!s.schemeBound) bindSchemeEditor();
  s.schemeEdit = existing
    ? { id: existing.id, name: existing.name, mode: "dark", dark: { ...defaultRoles("dark"), ...existing.dark }, light: { ...defaultRoles("light"), ...existing.light } }
    : { id: "", name: "", mode: "dark", dark: defaultRoles("dark"), light: defaultRoles("light") };
  $("scheme-edit-title").textContent = existing ? "Edit colour scheme" : "New colour scheme";
  $("scheme-edit-name").value = s.schemeEdit.name;
  $("scheme-edit-save").textContent = existing ? "Save changes" : "Save scheme";
  paintSchemeEditor();
  $("scheme-edit").showModal();
  $("scheme-edit-name").focus();
}

function closeSchemeEditor() {
  const dialog = $("scheme-edit");
  if (dialog?.open) dialog.close();
  s.schemeEdit = null;
}

function schemeContrast() {
  const ed = s.schemeEdit;
  if (!ed) return;
  const luminance = (hex) => {
    const rgb = hex.match(/[a-f0-9]{2}/gi).map((v) => parseInt(v, 16) / 255)
      .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const failures = [];
  for (const mode of ["dark", "light"]) {
    const roles = ed[mode];
    for (const [fg, bg, label] of [["text", "bg", "page text"], ["text", "panel", "panel text"], ["muted", "panel", "secondary text"], ["onAccent", "accent", "button text"]]) {
      const a = luminance(roles[fg]), b = luminance(roles[bg]);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < 4.5) failures.push(`${mode} ${label} (${ratio.toFixed(1)}:1)`);
    }
  }
  let note = $("scheme-contrast");
  if (!note) {
    note = document.createElement("p"); note.id = "scheme-contrast";
    note.setAttribute("role", "status");
    $("scheme-edit-preview").after(note);
  }
  note.className = `muted-note set-contrast${failures.length ? " warn" : ""}`;
  note.textContent = failures.length
    ? `Low text contrast: ${failures.join(", ")}. Aim for at least 4.5:1 for easier reading. You can still save this scheme.`
    : "Text contrast is at least 4.5:1 in both modes.";
}

function paintSchemeEditor() {
  const ed = s.schemeEdit;
  if (!ed) return;
  const mode = ed.mode === "light" ? "light" : "dark";
  const roles = ed[mode];
  $("scheme-edit-mode").innerHTML = [["dark", "Dark"], ["light", "Light"]]
    .map(([v, l]) => `<button type="button" data-scheme-mode="${v}" aria-pressed="${mode === v}" class="${mode === v ? "on" : ""}">${l}</button>`).join("");
  $("scheme-edit-colors").innerHTML = SCHEME_ROLES.map(([key, label, note]) => `
    <label class="scheme-edit-role"><span><b>${esc(label)}</b><small>${esc(note)}</small></span>
      <input type="color" data-scheme-role="${key}" value="${esc(roles[key] || defaultRoles(mode)[key])}" aria-label="${esc(label)}"></label>`).join("");
  applyVars($("scheme-edit-preview"), rolesToVars(roles, mode));
  schemeContrast();
}

function saveSchemeEditor() {
  const ed = s.schemeEdit;
  if (!ed) return;
  const name = ($("scheme-edit-name").value || "").trim().slice(0, 40) || "Custom scheme";
  const list = loadCustomSchemes();
  const next = { id: ed.id || newSchemeId(), name, dark: { ...ed.dark }, light: { ...ed.light } };
  const i = list.findIndex((c) => c.id === next.id);
  if (i >= 0) list[i] = next;
  else list.push(next);
  saveCustomSchemes(list);
  app.ui.scheme = next.id;
  store.set("scheme", next.id);
  closeSchemeEditor();
  applyView();
  render();
  toast(ed.id ? "Scheme saved" : "Scheme created", 2200);
}

async function deleteCustomScheme(id) {
  const list = loadCustomSchemes();
  const scheme = list.find((c) => c.id === id);
  if (!scheme) return;
  const ok = await confirmBox({
    title: "Delete colour scheme?",
    html: `<p>Remove <b>${esc(scheme.name)}</b>? This cannot be undone.</p>`,
    ok: "Delete",
    danger: true,
  });
  if (!ok) return;
  saveCustomSchemes(list.filter((c) => c.id !== id));
  if (app.ui.scheme === id) {
    app.ui.scheme = "mustard";
    store.set("scheme", "mustard");
    applyView();
  }
  render();
  toast("Scheme deleted", 2200);
}

function bindSchemeEditor() {
  s.schemeBound = true;
  const dialog = $("scheme-edit");
  if (!dialog) return;
  $("scheme-edit-cancel")?.addEventListener("click", closeSchemeEditor);
  $("scheme-edit-save")?.addEventListener("click", saveSchemeEditor);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) closeSchemeEditor(); });
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); closeSchemeEditor(); });
  dialog.addEventListener("click", (e) => {
    const mode = e.target.closest("[data-scheme-mode]");
    if (!mode || !s.schemeEdit) return;
    s.schemeEdit.mode = mode.dataset.schemeMode === "light" ? "light" : "dark";
    paintSchemeEditor();
  });
  dialog.addEventListener("input", (e) => {
    const t = e.target;
    if (!s.schemeEdit) return;
    if (t.id === "scheme-edit-name") s.schemeEdit.name = t.value;
    if (t.dataset.schemeRole) {
      const mode = s.schemeEdit.mode === "light" ? "light" : "dark";
      s.schemeEdit[mode][t.dataset.schemeRole] = t.value;
      applyVars($("scheme-edit-preview"), rolesToVars(s.schemeEdit[mode], mode));
      schemeContrast();
    }
  });
}

function handleMcpAction(action, el) {
  if (action === "mcp-save") return saveMcp();
  if (action === "mcp-reveal") return revealMcpToken();
  if (action === "mcp-rotate") return rotateMcpToken();
  if (action === "mcp-copy-url") return copyMcpText("url");
  if (action === "mcp-copy-token") return copyMcpText("token");
  if (action === "mcp-scan") return scanMcpClients();
  if (action === "mcp-setup") return setupMcpClient(el.dataset.id);
  if (action === "mcp-copy-client") return copyMcpClientConfig(el.dataset.id);
  if (action === "mcp-copy-toggle") {
    s.mcpCopyOpen = !s.mcpCopyOpen;
    s.mcpInstallOpen = "";
    s.mcpInstallAllOpen = false;
    render();
    return true;
  }
  if (action === "mcp-agent-review") return reviewMcpAgent(el.dataset.id);
  if (action === "mcp-agent-copy") return copyMcpAgent(el.dataset.id);
  if (action === "mcp-agent-install-toggle") {
    const id = el.dataset.id || "";
    s.mcpInstallOpen = s.mcpInstallOpen === id ? "" : id;
    s.mcpInstallAllOpen = false;
    s.mcpCopyOpen = false;
    render();
    return true;
  }
  if (action === "mcp-agent-install-all-toggle") {
    s.mcpInstallAllOpen = !s.mcpInstallAllOpen;
    s.mcpInstallOpen = "";
    s.mcpCopyOpen = false;
    render();
    return true;
  }
  if (action === "mcp-agent-install") return installMcpAgent(el.dataset.id, el.dataset.client);
  if (action === "mcp-agent-install-all") return installAllMcpAgents(el.dataset.client);
  return false;
}

function bindMcpPage(root) {
  root.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-set]");
    if (!el || el.disabled || !el.dataset.set?.startsWith("mcp-")) return;
    await handleMcpAction(el.dataset.set, el);
  });
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "mcp-tool-group") {
      s.mcpToolGroup = t.value || "all";
      render();
      return;
    }
    if (t.dataset.setToggle) saveToggle(t.dataset.setToggle, t.checked);
  });
  root.addEventListener("input", (e) => {
    if (e.target.id !== "mcp-tool-q") return;
    s.mcpToolQ = e.target.value;
    const sel = document.activeElement === e.target;
    const start = e.target.selectionStart;
    render();
    if (sel) {
      const again = $("mcp-tool-q");
      again?.focus();
      if (again && typeof start === "number") again.setSelectionRange(start, start);
    }
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || (!s.mcpCopyOpen && !s.mcpInstallOpen && !s.mcpInstallAllOpen)) return;
    s.mcpCopyOpen = false;
    s.mcpInstallOpen = "";
    s.mcpInstallAllOpen = false;
    render();
  });
}

function bind() {
  s.bound = true;
  bindPromptDialog();
  bindKnowledgeDialog();
  bindMcpAgentReview();
  bindSchemeEditor();
  const root = $("view-settings");
  const mcpRoot = $("view-mcp");
  bindRecipes(root);
  if (mcpRoot) bindMcpPage(mcpRoot);
  $("settings-tabs")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-settings-tab]");
    if (!b || b.classList.contains("on")) return;
    store.set("settingsTab", b.dataset.settingsTab);
    setTabRoute("settings", b.dataset.settingsTab);
    s.browse = null;
    render();
  });
  root.addEventListener("click", async (e) => {
    const edit = e.target.closest("[data-scheme-edit]");
    if (edit) {
      const scheme = loadCustomSchemes().find((c) => c.id === edit.dataset.schemeEdit);
      if (scheme) openSchemeEditor(scheme);
      return;
    }
    const del = e.target.closest("[data-scheme-del]");
    if (del) { deleteCustomScheme(del.dataset.schemeDel); return; }
    const el = e.target.closest("[data-set], [data-browse], [data-set-theme], [data-set-scheme], [data-set-zoom], [data-set-clock-style], [data-set-clock], [data-set-refresh], [data-set-clear], [data-set-play], [data-set-reset]");
    if (!el || el.disabled) return;
    if (el.dataset.browse !== undefined) { if (el.dataset.browse) browse(el.dataset.browse); return; }
    if (el.dataset.setTheme) {
      app.ui.theme = el.dataset.setTheme;
      store.set("theme", app.ui.theme);
      applyView();
      render();
      return;
    }
    if (el.dataset.setScheme) {
      app.ui.scheme = resolveSchemeId(el.dataset.setScheme);
      store.set("scheme", app.ui.scheme);
      applyView();
      render();
      return;
    }
    if (el.dataset.setZoom) {
      const zoom = Number(el.dataset.setZoom);
      if (!ZOOM_LEVELS.includes(zoom)) return;
      app.ui.zoom = zoom;
      store.set("zoom", zoom);
      applyView();
      render();
      return;
    }
    if (el.dataset.setClockStyle) {
      app.ui.clockStyle = el.dataset.setClockStyle === "analog" ? "analog" : "digital";
      store.set("clockStyle", app.ui.clockStyle);
      renderStatusbar();
      render();
      return;
    }
    if (el.dataset.setClock) {
      app.ui.clock = el.dataset.setClock;
      store.set("clock", app.ui.clock);
      renderStatusbar();
      render();
      return;
    }
    if (el.dataset.setRefresh) { refresh(el.dataset.setRefresh); return; }
    if (el.dataset.setClear) { clear(el.dataset.setClear); return; }
    if (el.dataset.setPlay) { resetPlay(el.dataset.setPlay); return; }
    if (el.dataset.setReset) { resetPrefs(); return; }
    const action = el.dataset.set;
    if (action?.startsWith("mcp-")) {
      await handleMcpAction(action, el);
      return;
    }
    const which = el.dataset.which || "roms";
    if (action === "browse") browse(s.data.folders[which].path, which);
    else if (action === "cancel") { s.browse = null; render(); }
    else if (action === "wizard") openWizard();
    else if (action === "tips") openTips({ force: true });
    else if (action === "shortcut") makeShortcut();
    else if (action === "reset") factoryReset();
    else if (action === "appearance-reset") resetAppearance();
    else if (action === "scheme-new") openSchemeEditor();
    else if (action === "chat-save") saveAssistant(false);
    else if (action === "chat-clear") saveAssistant(true);
    else if (action === "chat-prompt") openPromptEditor();
    else if (action === "chat-knowledge") openKnowledgeViewer();
    else if (action === "use") useFolder(s.browse.path, s.browse.which);
    else if (action === "default") useFolder("", which);
    else if (action === "copy-path") {
      try { await navigator.clipboard.writeText(s.data.folders[which].path); toast("Folder path copied", 2000); }
      catch { toast("Could not copy. Select the full path and copy it manually.", 4000); }
    }
    else if (action === "reveal") api("settings/reveal", { which }).catch((error) => toast(error.message, 3000));
    else if (action === "pick") {
      try {
        toast(`Choose the folder in the ${s.data.fileManager} window`, 2600);
        const { path } = await api("settings/pick-folder", { which });
        if (path) browse(path, which);
      } catch (error) {
        toast(error.message, 3000);
      }
    }
  });
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.setToggle) saveToggle(t.dataset.setToggle, t.checked);
    else if (t.dataset.setSoft !== undefined) {
      app.ui.soft = t.checked;
      store.set("soft", app.ui.soft);
      applyView();
    }
    else if (t.dataset.setCompact !== undefined) {
      app.ui.compact = t.checked;
      store.set("compact", app.ui.compact);
      applyView();
    }
    else if (t.dataset.setTips !== undefined) {
      setTipsOnStartup(t.checked);
      toast(t.checked ? "Tips will show at start" : "Tips will not show at start", 2200);
    }
    else if (t.dataset.setArtmax !== undefined) { artMax.set(t.value); toast("Saved"); }
    else if (t.dataset.setDate !== undefined) { app.ui.dateFormat = t.value; store.set("dateFormat", t.value); renderStatusbar(); }
    else if (t.id === "chat-provider" && s.chat) {
      s.chat.provider = t.value;
      const p = s.chat.providers.find((x) => x.id === t.value);
      if (p) s.chat.model = p.defaultModel;
      render();
    } else if (t.id === "chat-model") {
      const custom = t.value === "__custom__";
      const row = $("chat-custom-row"), input = $("chat-custom");
      if (row) row.hidden = !custom;
      if (input) { input.disabled = !custom; if (custom) input.focus(); }
      const baseRow = $("chat-base-row");
      if (baseRow && s.chat) baseRow.hidden = s.chat.provider !== "custom";
    }
  });
  root.addEventListener("input", (e) => {
    if (e.target.id === "set-browse-path" && s.browse) s.browse.input = e.target.value;
    if (e.target.id === "chat-key") s.chatKey = e.target.value;
    if (e.target.id === "chat-base" && s.chat) s.chat.baseUrl = e.target.value;
  });
  root.addEventListener("submit", (e) => {
    if (e.target.dataset.setForm !== "go") return;
    e.preventDefault();
    browse($("set-browse-path").value.trim());
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && s.browse && !document.querySelector("dialog[open]")) { s.browse = null; render(); }
  });
  document.addEventListener("click", (e) => {
    if (!s.mcpCopyOpen && !s.mcpInstallOpen && !s.mcpInstallAllOpen) return;
    if (e.target.closest(".mcp-copy-wrap")) return;
    s.mcpCopyOpen = false;
    s.mcpInstallOpen = "";
    s.mcpInstallAllOpen = false;
    if (section() === "mcp") render();
  });
  window.addEventListener("resize", () => {
    if (s.mcpCopyOpen || s.mcpInstallOpen || s.mcpInstallAllOpen) positionMcpMenus();
  });
}
