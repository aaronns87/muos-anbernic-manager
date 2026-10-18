// Assistant chat dock: opens only when a BYOK API key is configured in Settings.

import { $, api, esc, formatTime, icon, section, syncSpinnerPhase, toast } from "./core.js";
import { openViewerGame } from "./game-view.js";

let onConfigured = () => {};

const C = {
  configured: false,
  shown: false,
  min: false,
  sending: false,
  tips: false,
  messages: [],
  ready: false,
  providerLabel: "",
};

const TIPS = [
  ["Keyboard", "Enter sends; Shift+Enter starts a new line."],
  ["What to ask", "Help with the manager, your library, or a retro game."],
  ["Walkthroughs", "Ask where to look online (GameFAQs, StrategyWiki, and so on)."],
  ["Clear", "The Clear button next to Send wipes this conversation."],
];

function mdInline(s) {
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

function mdTableHtml(block) {
  const lines = block.replace(/^\n+|\n+$/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return "";
  const isRow = (l) => /^\|?.+\|/.test(l) && l.includes("|");
  const isSep = (l) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(l);
  if (!isRow(lines[0]) || !isSep(lines[1])) return "";
  const cells = (line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const align = (spec) => {
    const t = spec.replace(/\s/g, "");
    if (/^:-+:$/.test(t)) return "center";
    if (/^-+:$/.test(t)) return "right";
    if (/^:-+$/.test(t)) return "left";
    return "";
  };
  const heads = cells(lines[0]);
  const aligns = cells(lines[1]).map(align);
  const body = lines.slice(2).filter(isRow).map(cells);
  if (!heads.length || body.some((r) => r.length !== heads.length && r.length < 2)) {
    /* still render; pad short rows */
  }
  const th = heads.map((h, i) => {
    const a = aligns[i] ? ` style="text-align:${aligns[i]}"` : "";
    return `<th${a}>${mdInline(h)}</th>`;
  }).join("");
  const trs = body.map((row) => {
    const tds = heads.map((_, i) => {
      const a = aligns[i] ? ` style="text-align:${aligns[i]}"` : "";
      return `<td${a}>${mdInline(row[i] ?? "")}</td>`;
    }).join("");
    return `<tr>${tds}</tr>`;
  }).join("");
  return `<div class="chat-table"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

/** Safe subset of Markdown for assistant replies and the knowledge-base viewer. */
export function mdHtml(src) {
  const slots = [];
  const park = (html) => {
    slots.push(html);
    return `\u0000${slots.length - 1}\u0000`;
  };
  let s = esc(String(src || "")).replace(/\r\n?/g, "\n");
  s = s.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    park(`<pre class="chat-pre"${lang ? ` data-lang="${esc(lang)}"` : ""}><code>${code.replace(/^\n|\n$/g, "")}</code></pre>`));
  s = s.replace(/`([^`\n]+)`/g, (_, code) => park(`<code class="chat-code">${code}</code>`));
  s = s.replace(/^#{1,2}\s+(.+)$/gm, "<h3>$1</h3>");
  s = s.replace(/^#{3,6}\s+(.+)$/gm, "<h4>$1</h4>");
  s = s.replace(/((?:^|\n)(?:\|.+\|(?:\n|$))+)/g, (block) => {
    const html = mdTableHtml(block);
    return html ? `\n${park(html)}\n` : block;
  });
  s = mdInline(s);
  s = s.replace(/((?:^|\n)(?:[-*•]\s+.+(?:\n|$))+)/g, (block) => {
    const lines = block.replace(/^\n/, "").trimEnd().split("\n");
    if (!lines.every((l) => /^[-*•]\s+/.test(l))) return block;
    return `\n<ul>${lines.map((l) => `<li>${l.replace(/^[-*•]\s+/, "")}</li>`).join("")}</ul>\n`;
  });
  s = s.replace(/((?:^|\n)(?:\d+\.\s+.+(?:\n|$))+)/g, (block) => {
    const lines = block.replace(/^\n/, "").trimEnd().split("\n");
    if (!lines.every((l) => /^\d+\.\s+/.test(l))) return block;
    return `\n<ol>${lines.map((l) => `<li>${l.replace(/^\d+\.\s+/, "")}</li>`).join("")}</ol>\n`;
  });
  s = s.split(/\n{2,}/).map((block) => {
    const t = block.trim();
    if (!t) return "";
    if (/^<(?:ul|ol|pre|h[34]|div)[\s>]/i.test(t) || t.startsWith("\u0000")) return t;
    return `<p>${t.replace(/\n/g, "<br>")}</p>`;
  }).join("");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)] || "");
}

function stampLabel(at) {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return formatTime(d);
}

/** Avoid a device.js <-> chat.js import cycle: app.js registers statusbar refresh here. */
export function onChatConfigured(fn) {
  onConfigured = fn || (() => {});
}

/** Called from Settings after save/clear, and once at startup. */
export function chatConfiguredChanged(on, settings) {
  C.configured = !!on;
  if (!C.configured) {
    C.shown = false;
    C.tips = false;
    C.messages = [];
    C.providerLabel = "";
  } else if (settings) {
    C.providerLabel = providerName(settings);
  }
  renderChat();
  onConfigured();
}

export async function loadChatConfig() {
  try {
    const s = await api("chat/settings");
    C.configured = !!s.configured;
    C.providerLabel = s.configured ? providerName(s) : "";
    C.ready = true;
  } catch {
    C.configured = false;
    C.providerLabel = "";
    C.ready = true;
  }
  renderChat();
  onConfigured();
}

function providerName(s) {
  const id = s.provider || "";
  if (id === "groq") return "Groq";
  if (id === "gemini") return "Gemini";
  if (id === "openrouter") return "OpenRouter";
  return id ? id : "BYOK";
}

export const chatConfigured = () => C.configured;

export function toggleChat() {
  if (!C.configured) {
    toast("Add a free API key under Settings > Assistant first", 3500);
    location.hash = "#settings";
    return;
  }
  C.shown = !C.shown;
  if (C.shown) C.min = false;
  renderChat();
}

function gameKey() {
  const g = openViewerGame();
  return g ? `${g.code}|${g.file}` : "";
}

function emptyState() {
  return `<div class="chat-empty">
      <div class="chat-empty-ico">${icon("chat")}</div>
      <b>Ask the assistant</b>
      <p>Help with the manager, your library, or a retro game. For walkthroughs, ask where to look online.</p>
    </div>`;
}

function paintMessages() {
  const box = $("chat-log");
  if (!box) return;
  if (!C.messages.length) {
    box.innerHTML = emptyState();
    return;
  }
  box.innerHTML = C.messages.map((m) => {
    const who = m.role === "user" ? "You" : "Assistant";
    const when = stampLabel(m.at);
    const body = m.role === "assistant" ? mdHtml(m.content) : esc(m.content).replace(/\n/g, "<br>");
    return `<div class="chat-bubble ${m.role}">
      <span class="chat-meta"><span class="chat-who">${who}</span>${when ? `<time datetime="${esc(new Date(m.at).toISOString())}">${esc(when)}</time>` : ""}</span>
      <div class="chat-text">${body}</div>
    </div>`;
  }).join("");
  box.scrollTop = box.scrollHeight;
}

function ensureShell(dock) {
  if (dock.firstChild) return;
  dock.innerHTML = `<div class="dock-head" id="chat-head"></div>
      <div class="dock-body chat-body" id="chat-body">
        <div class="chat-log" id="chat-log"></div>
        <form class="chat-compose" id="chat-form">
          <label class="chat-field">
            <textarea class="control" id="chat-input" rows="2" placeholder="Ask about the manager or your games&hellip;" maxlength="2000" aria-label="Message"></textarea>
          </label>
          <div class="chat-actions">
            <button type="button" class="btn small ghost chat-clear" id="chat-clear" data-chat="clear" hidden title="Clear this conversation">${icon("eraser")}<span>Clear</span></button>
            <button type="submit" class="btn small primary" id="chat-send">${icon("send")}<span>Send</span></button>
          </div>
        </form>
      </div>`;
}

function paintFab() {
  let fab = $("chat-fab");
  if (!fab) return;
  const show = C.configured && !C.shown;
  fab.hidden = !show;
  fab.setAttribute("aria-expanded", C.shown ? "true" : "false");
  document.body.classList.toggle("has-chat-fab", show);
}

export function renderChat() {
  const dock = $("chat-dock");
  if (!dock) return;
  syncSpinnerPhase();
  if (!C.configured) {
    dock.hidden = true;
    document.body.classList.remove("has-chat");
    paintFab();
    return;
  }
  ensureShell(dock);
  dock.hidden = !C.shown;
  document.body.classList.toggle("has-chat", C.shown);
  dock.classList.toggle("min", C.min);
  const sub = C.sending ? "Thinking&hellip;" : esc(C.providerLabel || "Ready");
  if (C.min) C.tips = false;
  const tipList = TIPS.map(([k, v]) => `<li><b>${esc(k)}</b><span>${esc(v)}</span></li>`).join("");
  $("chat-head").innerHTML = `<button class="dock-toggle" data-chat="min" aria-expanded="${!C.min}" aria-controls="chat-body">
      <span class="tx-ico">${icon("chat")}</span>
      <span class="dock-title"><b>Assistant</b><small>${sub}</small></span></button>
    <span class="chat-tips-wrap">
      <button type="button" class="btn icon small ghost chat-tips${C.tips ? " on" : ""}" data-chat="tips" aria-expanded="${C.tips}" aria-controls="chat-tips" title="Tips" aria-label="Tips for using the assistant">${icon("help")}</button>
      <div class="chat-tips-pop" id="chat-tips" role="dialog" aria-label="Assistant tips"${C.tips ? "" : " hidden"}>
        <b>How to use</b>
        <ul>${tipList}</ul>
      </div>
    </span>
    <button class="btn icon small ghost dock-chev" data-chat="min" title="${C.min ? "Show chat" : "Minimise"}" aria-label="${C.min ? "Show chat" : "Minimise"}">${icon("down")}</button>
    <button class="btn icon small ghost" data-chat="close" title="Hide assistant" aria-label="Hide assistant">${icon("x")}</button>`;
  $("chat-body").hidden = C.min;
  paintMessages();
  const clear = $("chat-clear");
  if (clear) clear.hidden = !C.messages.length || C.sending;
  const send = $("chat-send");
  if (send) {
    send.disabled = C.sending;
    send.innerHTML = C.sending ? `<span class="spinner sm"></span><span>Sending</span>` : `${icon("send")}<span>Send</span>`;
  }
  document.body.style.setProperty("--chat-h", C.shown && !C.min ? `${dock.offsetHeight}px` : "0px");
  paintFab();
}

async function sendMessage(text, { aboutGame = false } = {}) {
  const content = String(text || "").trim();
  if (!content || C.sending || !C.configured) return;
  C.messages.push({ role: "user", content, at: Date.now() });
  C.sending = true;
  renderChat();
  try {
    const r = await api("chat", {
      messages: C.messages.map((m) => ({ role: m.role, content: m.content })),
      section: section(),
      gameKey: aboutGame || gameKey() ? gameKey() : "",
    });
    C.messages.push({ role: "assistant", content: r.reply, at: Date.now() });
  } catch (error) {
    C.messages.pop();
    toast(error.message, 5000);
  }
  C.sending = false;
  renderChat();
  $("chat-input")?.focus();
}

export function bindChat() {
  const dock = $("chat-dock");
  if (!dock) return;
  dock.addEventListener("click", (e) => {
    const el = e.target.closest("[data-chat]");
    if (!el) return;
    const a = el.dataset.chat;
    if (a === "min") { C.min = !C.min; C.tips = false; renderChat(); }
    else if (a === "close") { C.shown = false; C.tips = false; renderChat(); }
    else if (a === "clear") { C.messages = []; C.tips = false; renderChat(); }
    else if (a === "tips") { e.stopPropagation(); C.tips = !C.tips; renderChat(); }
  });
  dock.addEventListener("submit", (e) => {
    if (e.target.id !== "chat-form") return;
    e.preventDefault();
    const input = $("chat-input");
    const text = input?.value || "";
    if (input) input.value = "";
    sendMessage(text);
  });
  dock.addEventListener("keydown", (e) => {
    if (e.target.id === "chat-input" && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("chat-form")?.requestSubmit();
    }
    if (e.key === "Escape" && C.tips) {
      C.tips = false;
      renderChat();
    }
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-chat-open]")) toggleChat();
    else if (C.tips && !e.target.closest(".chat-tips-wrap")) {
      C.tips = false;
      renderChat();
    }
  });
}
