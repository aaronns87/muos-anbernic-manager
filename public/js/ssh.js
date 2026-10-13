// SSH: terminal tabs on the handheld, live system stats, quick commands and the connection settings.

import { $, api, esc, human, clock, store, toast, TOKEN, copyText, osVersion, section } from "./core.js";
import { confirmBox } from "./art-images.js";

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "\u2318" : "Ctrl+Shift+";
const enc = new TextEncoder();

const SNIPPETS = [
  ["System", [
    ["Processes", "htop"],
    ["Disk space", "df -h"],
    ["Memory", "free -m"],
    ["Network", "ip -br addr 2>/dev/null || ip addr"],
    ["Wi-Fi signal", "cat /proc/net/wireless"],
    ["Kernel log", "dmesg | tail -n 40"],
  ]],
  ["MustardOS", [
    ["Version", "cat /opt/muos/config/system/version"],
    ["Systems on TF2", "ls /mnt/sdcard/ROMS"],
    ["ROM folder sizes", "du -sh /mnt/sdcard/ROMS/* 2>/dev/null"],
    ["Latest logs", "ls -lt /opt/muos/log | head -n 15"],
    ["Web services", "ps | grep -E 'sshd|sftpgo|ttyd|syncthing' | grep -v grep"],
  ]],
];

const THEMES = {
  dark: {
    background: "#0c0a09", foreground: "#e8e8e8", cursor: "#cbaa0f", cursorAccent: "#0c0a09", selectionBackground: "#cbaa0f55",
    black: "#1b222b", red: "#ff6b7a", green: "#5fd38d", yellow: "#f5c518", blue: "#7c9cff", magenta: "#c792ea", cyan: "#4fd1e8", white: "#c9d1d9",
    brightBlack: "#5c6773", brightRed: "#ff8f9b", brightGreen: "#86e5a8", brightYellow: "#ffd95a", brightBlue: "#a3b8ff",
    brightMagenta: "#dab2ff", brightCyan: "#7fe3f2", brightWhite: "#ffffff",
  },
  light: {
    background: "#fbfcfe", foreground: "#1b2430", cursor: "#8a6d00", cursorAccent: "#ffffff", selectionBackground: "#cbaa0f40",
    black: "#1b2430", red: "#d1344a", green: "#1f8f4e", yellow: "#a87a00", blue: "#3b5bdb", magenta: "#9c36b5", cyan: "#0b8a9e", white: "#8a96a4",
    brightBlack: "#5d6a7a", brightRed: "#e5485d", brightGreen: "#2b9a5c", brightYellow: "#c08f00", brightBlue: "#4f6bed",
    brightMagenta: "#ae3ec9", brightCyan: "#1098ad", brightWhite: "#1b2430",
  },
};

const I = (d, w = 15) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  term: I(`<rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="m6 9 3.5 3L6 15M12 15h6"/>`, 18),
  plus: I(`<path d="M12 5v14M5 12h14"/>`),
  find: I(`<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>`),
  copy: I(`<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>`),
  paste: I(`<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>`),
  clear: I(`<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>`),
  save: I(`<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>`),
  broadcast: I(`<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5"/>`),
  full: I(`<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>`),
  exit: I(`<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>`),
  power: I(`<path d="M12 3v9"/><path d="M6.4 6.4a8 8 0 1 0 11.2 0"/>`, 14),
  reboot: I(`<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>`, 14),
  run: I(`<path d="m7 5 11 7-11 7z"/>`, 12),
  insert: I(`<path d="M4 12h12M12 6l6 6-6 6"/>`, 12),
  ext: I(`<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>`, 13),
};

const ssh = {
  status: null, statusError: "",
  stats: null, statsError: "", statsBusy: false,
  tabs: [], active: null, seq: 0,
  font: store.get("ssh.font", 13), broadcast: false,
  find: { caseSensitive: false, regex: false },
  custom: store.get("ssh.snippets", []),
  inited: false, autoOpened: false,
};

let X = null;
async function xterm() {
  if (X) return X;
  const [core, fit, search, links, uni] = await Promise.all([
    import("/vendor/xterm/xterm/lib/xterm.mjs"), import("/vendor/xterm/addon-fit/lib/addon-fit.mjs"),
    import("/vendor/xterm/addon-search/lib/addon-search.mjs"), import("/vendor/xterm/addon-web-links/lib/addon-web-links.mjs"),
    import("/vendor/xterm/addon-unicode11/lib/addon-unicode11.mjs"),
  ]);
  X = { Terminal: core.Terminal, FitAddon: fit.FitAddon, SearchAddon: search.SearchAddon, WebLinksAddon: links.WebLinksAddon, Unicode11Addon: uni.Unicode11Addon };
  return X;
}

const themeName = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
const current = () => ssh.tabs.find((t) => t.id === ssh.active) || null;
const dim = (s) => `\r\n\x1b[2m${s}\x1b[0m\r\n`;
const red = (s) => `\r\n\x1b[31m${s}\x1b[0m\r\n`;
const where = () => (ssh.status ? `${ssh.status.user}@${ssh.status.host || "?"}` : "");

// ---------------------------------------------------------------- layout

function build() {
  $("ssh").innerHTML = `<div class="ssh-layout">
    <section class="term-pane" id="term-pane">
      <div class="term-bar">
        <div class="term-tabs" id="term-tabs" role="tablist" aria-label="Terminal tabs"></div>
        <button class="term-tool" data-term="new" title="New tab (Ctrl+Shift+T)" aria-label="New tab">${ICON.plus}</button>
        <div class="term-tools">
          <button class="term-tool" data-term="find" title="Find (${MOD}F)" aria-label="Find">${ICON.find}</button>
          <span class="term-font"><button class="term-tool" data-term="font-down" title="Smaller text (${MOD}-)" aria-label="Smaller text">A&minus;</button><span id="term-font-size"></span><button class="term-tool" data-term="font-up" title="Larger text (${MOD}+)" aria-label="Larger text">A+</button></span>
          <button class="term-tool" data-term="copy" title="Copy the selection" aria-label="Copy">${ICON.copy}</button>
          <button class="term-tool" data-term="paste" title="Paste" aria-label="Paste">${ICON.paste}</button>
          <button class="term-tool" data-term="clear" title="Clear the scrollback (${MOD}K)" aria-label="Clear">${ICON.clear}</button>
          <button class="term-tool" data-term="save" title="Save the scrollback as a text file" aria-label="Save scrollback">${ICON.save}</button>
          <button class="term-tool" data-term="broadcast" id="term-broadcast" title="Type into every open tab at once" aria-label="Type into every tab">${ICON.broadcast}</button>
          <button class="term-tool" data-term="full" id="term-full" title="Full screen" aria-label="Full screen">${ICON.full}</button>
        </div>
      </div>
      <div class="term-find" id="term-find" hidden>
        ${ICON.find}
        <input id="find-q" type="text" placeholder="Find in the scrollback" spellcheck="false" autocomplete="off">
        <button class="term-tool toggle" data-term="find-case" title="Match case">Aa</button>
        <button class="term-tool toggle" data-term="find-regex" title="Regular expression">.*</button>
        <span class="find-count" id="find-count"></span>
        <button class="term-tool" data-term="find-prev" title="Previous (Shift+Enter)" aria-label="Previous match">&#8593;</button>
        <button class="term-tool" data-term="find-next" title="Next (Enter)" aria-label="Next match">&#8595;</button>
        <button class="term-tool" data-term="find-close" title="Close (Esc)" aria-label="Close find">&times;</button>
      </div>
      <div class="term-alert" id="term-alert" hidden></div>
      <div class="term-stage" id="term-stage"><div class="term-empty" id="term-empty"></div></div>
      <div class="term-status" id="term-status"></div>
    </section>
    <div class="ssh-side">
      <div id="ssh-stats"></div>
      <div id="ssh-snippets"></div>
      <div id="ssh-conn"></div>
    </div>
  </div>`;

  $("view-ssh").addEventListener("click", onClick);
  $("view-ssh").addEventListener("submit", onSubmit);
  $("term-tabs").addEventListener("keydown", (e) => {
    const tabEl = e.target.closest("[data-tab]");
    if (!tabEl || e.target !== tabEl) return;
    const i = ssh.tabs.findIndex((x) => x.id === +tabEl.dataset.tab);
    const to = e.key === "Enter" || e.key === " " ? i : e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : -1;
    if (to < 0 || to >= ssh.tabs.length) return;
    e.preventDefault();
    activate(ssh.tabs[to]);
    $("term-tabs").querySelector(`[data-tab="${ssh.tabs[to].id}"]`)?.focus();
  });
  $("find-q").addEventListener("input", () => runFind(true));
  $("find-q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); runFind(!e.shiftKey, true); }
    if (e.key === "Escape") { e.preventDefault(); closeFind(); }
  });
  new ResizeObserver(() => fitSoon()).observe($("term-stage"));
  document.addEventListener("fullscreenchange", () => {
    const on = document.fullscreenElement === $("term-pane");
    $("term-full").innerHTML = on ? ICON.exit : ICON.full;
    $("term-full").title = on ? "Leave full screen" : "Full screen";
    fitSoon();
  });
  new MutationObserver(() => {
    for (const t of ssh.tabs) t.term.options.theme = THEMES[themeName()];
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  setInterval(tick, 5000);
  setInterval(renderStatusBar, 15000);
}

let fitFrame = 0;
function fitSoon() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    const t = current();
    if (t && t.el.offsetParent) try { t.fit.fit(); } catch {}
  });
}

// ---------------------------------------------------------------- tabs

async function newTab(pending = "") {
  await xterm();
  const id = ++ssh.seq;
  const el = document.createElement("div");
  el.className = "term-host";
  $("term-stage").appendChild(el);
  const term = new X.Terminal({
    fontFamily: '"SF Mono", SFMono-Regular, Menlo, "JetBrains Mono", Consolas, monospace',
    fontSize: ssh.font, lineHeight: 1.12, cursorBlink: true, scrollback: 10000, allowProposedApi: true,
    macOptionIsMeta: true, macOptionClickForcesSelection: true, rightClickSelectsWord: true, theme: THEMES[themeName()],
  });
  const fit = new X.FitAddon(), search = new X.SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new X.WebLinksAddon((e, uri) => window.open(uri, "_blank", "noopener")));
  term.loadAddon(new X.Unicode11Addon());
  term.unicode.activeVersion = "11";
  const tab = { id, n: id, term, fit, search, el, ws: null, state: "idle", title: "", info: null, started: 0, error: null, exit: null, pending };
  ssh.tabs.push(tab);
  term.open(el);
  term.attachCustomKeyEventHandler((e) => keys(e, tab));
  term.onData((d) => input(tab, d, false));
  term.onBinary((d) => input(tab, d, true));
  term.onResize(({ cols, rows }) => {
    if (tab.ws?.readyState === 1) tab.ws.send(JSON.stringify({ t: "resize", cols, rows }));
    if (tab.id === ssh.active) renderStatusBar();
  });
  term.onTitleChange((title) => { tab.title = title; renderTabs(); });
  search.onDidChangeResults(({ resultIndex, resultCount }) => {
    if (tab.id === ssh.active) $("find-count").textContent = resultCount ? `${resultIndex + 1} of ${resultCount}` : $("find-q").value ? "No matches" : "";
  });
  activate(tab);
  connectTab(tab);
  return tab;
}

function activate(tab) {
  ssh.active = tab ? tab.id : null;
  for (const t of ssh.tabs) t.el.classList.toggle("on", t === tab);
  $("term-empty").hidden = !!tab;
  renderTabs();
  renderStatusBar();
  renderAlert();
  if (tab) requestAnimationFrame(() => { try { tab.fit.fit(); } catch {} tab.term.focus(); });
  if (!$("term-find").hidden) runFind(true);
}

function closeTab(tab) {
  if (tab.ws) { tab.ws.onclose = null; tab.ws.close(); }
  tab.term.dispose();
  tab.el.remove();
  const i = ssh.tabs.indexOf(tab);
  ssh.tabs.splice(i, 1);
  if (ssh.active === tab.id) activate(ssh.tabs[Math.min(i, ssh.tabs.length - 1)] || null);
  else renderTabs();
  if (!ssh.tabs.length) renderEmpty();
  renderHead();
}

function connectTab(tab) {
  if (tab.ws) { tab.ws.onclose = null; tab.ws.close(); }
  const { cols, rows } = tab.term;
  const ws = new WebSocket(`ws://${location.host}/api/ssh/socket?token=${encodeURIComponent(TOKEN)}&cols=${cols}&rows=${rows}`);
  ws.binaryType = "arraybuffer";
  Object.assign(tab, { ws, state: "connecting", error: null, exit: null });
  ws.onmessage = (e) => {
    if (typeof e.data !== "string") return tab.term.write(new Uint8Array(e.data));
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === "status") {
      tab.info = m;
      tab.term.write(`\x1b[2mConnecting to ${m.user}@${m.host}:${m.port}\u2026\x1b[0m\r\n`);
    } else if (m.t === "ready") {
      Object.assign(tab, { state: "ready", started: Date.now(), info: { ...tab.info, ...m } });
      if (m.trustedNow) toast(`Trusted the handheld's host key ${m.fingerprint.slice(0, 20)}\u2026`, 3000);
      if (tab.pending) { const cmd = tab.pending; tab.pending = ""; setTimeout(() => sendLine(tab, cmd), 350); }
      loadStatus();
    } else if (m.t === "error") {
      Object.assign(tab, { state: "error", error: m });
      tab.term.write(red(m.message));
    } else if (m.t === "exit") {
      tab.exit = m;
    }
    renderTabs(); renderStatusBar(); renderAlert(); renderHead();
  };
  ws.onclose = () => {
    if (tab.ws !== ws) return;
    if (tab.state === "connecting" && !tab.error) {
      Object.assign(tab, { state: "error", error: { message: "The manager server refused the terminal connection. Reload the page." } });
      tab.term.write(red(tab.error.message));
    } else if (tab.state !== "error") {
      tab.state = "closed";
      const why = tab.exit?.lost ? "Connection lost." : tab.exit?.code ? `Shell exited with code ${tab.exit.code}.` : "Session ended.";
      tab.term.write(dim(`${why} Press Enter to reconnect.`));
    }
    renderTabs(); renderStatusBar(); renderAlert(); renderHead();
  };
}

function input(tab, data, binary) {
  if (tab.state === "closed" || tab.state === "error") {
    if (data === "\r") connectTab(tab);
    return;
  }
  const bytes = binary ? Uint8Array.from(data, (c) => c.charCodeAt(0) & 255) : enc.encode(data);
  const targets = ssh.broadcast ? ssh.tabs.filter((t) => t.state === "ready") : [tab];
  for (const t of targets) if (t.ws?.readyState === 1) t.ws.send(bytes);
}

function sendLine(tab, text, run = true) {
  input(tab, text + (run ? "\r" : ""), false);
  tab.term.focus();
}

/** Shortcuts inside the terminal; returning false keeps the key away from the shell. */
function keys(e, tab) {
  if (e.type !== "keydown") return true;
  const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey;
  const k = e.key.toLowerCase();
  const take = (fn) => { e.preventDefault(); fn(); return false; };
  if (mod && k === "f") return take(openFind);
  if (mod && k === "k") return take(() => tab.term.clear());
  if (mod && (k === "=" || k === "+")) return take(() => setFont(ssh.font + 1));
  if (mod && k === "-") return take(() => setFont(ssh.font - 1));
  if (mod && k === "0") return take(() => setFont(13));
  if (!IS_MAC && mod && k === "c") return take(() => copySelection(tab));
  if (!IS_MAC && mod && k === "v") return take(() => pasteInto(tab));
  if (e.ctrlKey && e.shiftKey && k === "t") return take(() => newTab());
  if (e.ctrlKey && e.shiftKey && k === "w") return take(() => closeTab(tab));
  if (e.ctrlKey && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    return take(() => {
      const i = ssh.tabs.indexOf(tab), n = ssh.tabs.length;
      activate(ssh.tabs[(i + (e.key === "ArrowLeft" ? n - 1 : 1)) % n]);
    });
  }
  return true;
}

function setFont(size) {
  ssh.font = Math.min(24, Math.max(9, size));
  store.set("ssh.font", ssh.font);
  for (const t of ssh.tabs) t.term.options.fontSize = ssh.font;
  $("term-font-size").textContent = ssh.font;
  fitSoon();
}

async function copySelection(tab) {
  const text = tab.term.getSelection();
  if (!text) return toast("Select some text first");
  if (await copyText(text)) toast("Copied");
  tab.term.focus();
}

async function pasteInto(tab) {
  try {
    tab.term.paste(await navigator.clipboard.readText());
  } catch {
    toast(`Allow clipboard access, or press ${IS_MAC ? "\u2318V" : "Ctrl+Shift+V"} in the terminal`, 3000);
  }
  tab.term.focus();
}

function saveLog(tab) {
  const buf = tab.term.buffer.active, lines = [];
  for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? "");
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/plain" }));
  a.download = `${(tab.info?.host || "handheld").replace(/[^\w.-]/g, "_")}-ssh-${stamp}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- find

function openFind() {
  $("term-find").hidden = false;
  $("find-q").focus();
  $("find-q").select();
  fitSoon();
}

function closeFind() {
  $("term-find").hidden = true;
  current()?.search.clearDecorations();
  $("find-count").textContent = "";
  fitSoon();
  current()?.term.focus();
}

function runFind(forward, step = false) {
  const t = current(), q = $("find-q").value;
  if (!t) return;
  if (!q) { t.search.clearDecorations(); $("find-count").textContent = ""; return; }
  const opts = {
    caseSensitive: ssh.find.caseSensitive, regex: ssh.find.regex, incremental: !step && forward,
    decorations: { matchBackground: "#cbaa0f33", matchBorder: "#cbaa0f88", matchOverviewRuler: "#cbaa0f", activeMatchBackground: "#f5c518aa", activeMatchColorOverviewRuler: "#f5c518" },
  };
  try {
    (forward ? t.search.findNext(q, opts) : t.search.findPrevious(q, opts)) || ($("find-count").textContent = "No matches");
  } catch {
    $("find-count").textContent = "Invalid pattern";
  }
}

// ---------------------------------------------------------------- rendering

const STATE_TEXT = { idle: "Starting", connecting: "Connecting", ready: "Connected", closed: "Disconnected", error: "Failed" };

function renderTabs() {
  if (!$("term-tabs")) return;
  $("term-tabs").innerHTML = ssh.tabs.map((t, i) => {
    const label = t.title || (t.info ? `${t.info.user}@${t.info.host}` : "Terminal");
    return `<div class="term-tab${t.id === ssh.active ? " on" : ""} ${t.state}" role="tab" tabindex="${t.id === ssh.active ? 0 : -1}" aria-selected="${t.id === ssh.active}" data-tab="${t.id}" title="${esc(label)} \u00b7 ${STATE_TEXT[t.state]}">
      <i class="dot"></i><b class="tn">${i + 1}</b><span class="tt">${esc(label)}</span><button class="tx" data-close="${t.id}" title="Close tab (Ctrl+Shift+W)" aria-label="Close tab">&times;</button></div>`;
  }).join("");
  $("term-font-size").textContent = ssh.font;
  $("term-broadcast").classList.toggle("on", ssh.broadcast);
}

function renderStatusBar() {
  if (!$("term-status")) return;
  const t = current();
  if (!t) { $("term-status").innerHTML = ""; return; }
  const parts = [`<span class="st ${t.state}"><i class="dot"></i>${STATE_TEXT[t.state]}</span>`];
  if (t.info) parts.push(`<span><code>${esc(`${t.info.user}@${t.info.host}`)}</code></span>`);
  if (t.state === "ready") {
    parts.push(`<span>${t.info?.shell === "sh" ? "sh" : "bash"} \u00b7 xterm-256color</span>`);
    parts.push(`<span title="Session length">${clock((Date.now() - t.started) / 1000)}</span>`);
  }
  parts.push(`<span class="grow"></span><span title="Columns \u00d7 rows">${t.term.cols} \u00d7 ${t.term.rows}</span>`);
  if (ssh.broadcast) parts.push(`<span class="bc">Typing into ${ssh.tabs.filter((x) => x.state === "ready").length} tabs</span>`);
  if (t.state === "closed" || t.state === "error") parts.push(`<button class="link-btn" data-term="reconnect">Reconnect</button>`);
  $("term-status").innerHTML = parts.join("");
}

function renderAlert() {
  const box = $("term-alert"), t = current();
  if (!box) return;
  if (!t || t.state !== "error" || !t.error) { box.hidden = true; box.innerHTML = ""; fitSoon(); return; }
  const e = t.error;
  let actions = `<button class="btn sm" data-term="reconnect">Try again</button>`;
  if (e.code === "hostkey") {
    actions = `<button class="btn sm primary" data-term="trust">Trust the new key and connect</button>`;
  } else if (e.code === "auth") {
    actions = `<button class="btn sm primary" data-term="settings">Change the user or password</button>` + actions;
  } else if (e.code === "setup") {
    actions = `<button class="btn sm primary" data-term="settings">Enter the address</button><a class="btn sm" href="#overview">Set up Wi-Fi</a>`;
  }
  box.innerHTML = `<div class="notice err"><div>${esc(e.message)}${e.fingerprint ? `<br><small>New key: <code>${esc(e.fingerprint)}</code></small>` : ""}</div><div class="alert-actions">${actions}</div></div>`;
  box.hidden = false;
  fitSoon();
}

function renderEmpty() {
  const s = ssh.status;
  let body;
  if (!s && ssh.statusError) body = `<div class="notice err">${esc(ssh.statusError)}</div>
    <div class="empty-actions"><button class="btn" data-term="status">Try again</button></div>`;
  else if (!s) body = `<p><span class="spinner"></span> Checking the handheld&hellip;</p>`;
  else if (!s.configured) body = `<h3>Where is the handheld?</h3><p>Enter its address in the connection settings, or set up Wi-Fi in Overview.</p>
    <div class="empty-actions"><button class="btn primary" data-term="settings">Connection settings</button><a class="btn" href="#overview">Overview</a></div>`;
  else if (!s.reachable) body = `<h3>Nothing answers on ${esc(`${s.host}:${s.port}`)}</h3>
    <p>On the handheld, turn on <b>Configuration &rsaquo; Web Services &rsaquo; Secure Shell</b> and check that it is awake and on this Wi-Fi network.</p>
    <div class="empty-actions"><button class="btn primary" data-term="new">Try to connect</button><button class="btn" data-term="settings">Connection settings</button></div>`;
  else body = `<h3>${esc(where())}</h3><p>${esc(s.server.replace(/^SSH-2\.0-/, "").replace(/_/g, " "))} is ready on port ${s.port}.</p>
    <div class="empty-actions"><button class="btn primary" data-term="new">${ICON.term} Open a terminal</button></div>`;
  $("term-empty").innerHTML = `<div class="term-empty-icon">${ICON.term}</div>${body}`;
}

function renderHead() {
  const s = ssh.status, open = ssh.tabs.filter((t) => t.state === "ready").length;
  const server = s?.server ? s.server.replace(/^SSH-2\.0-/, "").replace(/_/g, " ") : "";
  $("ssh-sub").textContent = !s ? "A shell on the handheld over Wi-Fi"
    : !s.configured ? "Set the handheld's address to connect"
    : `${where()}:${s.port}${server ? ` \u00b7 ${server}` : s.reachable ? "" : " \u00b7 not answering"}${open ? ` \u00b7 ${open} open session${open === 1 ? "" : "s"}` : ""}`;
  const chip = !s ? "" : `<span class="ssh-chip ${s.reachable ? "ok" : s.configured ? "err" : "warn"}"><i class="dot"></i>${s.reachable ? "Reachable" : s.configured ? "Not answering" : "No address"}</span>`;
  const vt = s?.host ? `<a class="btn" href="http://${esc(s.host)}:${s.vt}/" target="_blank" rel="noopener" title="MustardOS Virtual Terminal (ttyd) in the browser">Virtual Terminal ${ICON.ext}</a>` : "";
  $("ssh-actions").innerHTML = `${chip}${vt}<button class="btn primary" data-term="new">${ICON.plus} New terminal</button>`;
}

const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const level = (p, warn, hot) => (p >= hot ? "hot" : p >= warn ? "warn" : "ok");
function gauge(label, value, sub, pct, cls) {
  return `<div class="gauge ${cls}"><div class="g-top"><span>${label}</span><b>${value}</b></div>
    <div class="meter"><i style="width:${Math.max(2, Math.min(100, pct))}%"></i></div><small>${sub}</small></div>`;
}

function cmdName(command) {
  const parts = command.replace(/^\{[^}]*\}\s*/, "").split(/\s+/);
  parts[0] = parts[0].split("/").pop();
  return parts.join(" ");
}

function renderStats() {
  const box = $("ssh-stats");
  if (!box) return;
  const s = ssh.stats;
  const head = `<h2>System ${ssh.statsBusy ? `<span class="spinner"></span>` : s ? `<span class="live-dot" title="Refreshes every 5 seconds"></span>` : ""}
    <button class="link-btn" data-term="stats" title="Refresh now">Refresh</button></h2>`;
  if (!s) {
    const note = ssh.statsError ? `<div class="notice err">${esc(ssh.statsError)}</div>`
      : ssh.status && !ssh.status.reachable ? `<div class="muted-note">Live stats appear once the handheld answers on SSH.</div>`
      : `<div class="muted-note"><span class="spinner"></span> Reading the handheld&hellip;</div>`;
    box.innerHTML = `<section class="panel ssh-panel">${head}${note}</section>`;
    return;
  }
  const m = s.memory, used = m.total - m.available;
  const temp = (n) => s.temps.find((t) => t.name === n);
  const cpuT = temp("cpu") || s.temps[0];
  const others = s.temps.filter((t) => t !== cpuT).map((t) => `${t.name.toUpperCase()} ${Math.round(t.c)}\u00b0`).join(" \u00b7 ");
  const bat = s.battery;
  const charging = bat && /charging/i.test(bat.status) && !/dis/i.test(bat.status);
  box.innerHTML = `<section class="panel ssh-panel">${head}
    ${ssh.statsError ? `<div class="notice err">${esc(ssh.statsError)}</div>` : ""}
    <div class="sys-id"><b>${esc(s.hostname || "handheld")}</b><span>${esc(["MustardOS " + osVersion(s.version), "Linux " + s.kernel].filter((x) => !/ $/.test(x)).join(" \u00b7 "))}</span>
      <span>${s.ip ? `<code>${esc(s.ip)}</code> \u00b7 ` : ""}up ${esc(clock(s.uptime))}</span></div>
    <div class="gauges">
      ${gauge("CPU", s.cpu === null ? "\u2013" : `${s.cpu}%`, `${s.mhz ? `${s.mhz} MHz` : ""}${s.governor ? ` \u00b7 ${esc(s.governor)}` : ""}`, s.cpu ?? 0, level(s.cpu ?? 0, 60, 85))}
      ${gauge("Memory", `${pctOf(used, m.total)}%`, `${human(used)} of ${human(m.total)}`, pctOf(used, m.total), level(pctOf(used, m.total), 75, 90))}
      ${bat ? gauge("Battery", `${bat.percent}%`, `${charging ? "\u26a1 " : ""}${esc(bat.status || "")}`, bat.percent, bat.percent <= 15 ? "hot" : bat.percent <= 30 ? "warn" : "ok") : ""}
      ${cpuT ? gauge("Temperature", `${Math.round(cpuT.c)}\u00b0C`, esc(others || "CPU"), (cpuT.c / 95) * 100, level(cpuT.c, 65, 80)) : ""}
    </div>
    <div class="load-line"><span>Load</span><b>${s.load.map((n) => n.toFixed(2)).join(" \u00b7 ")}</b><span>${s.cores} cores${s.maxMhz ? `, up to ${s.maxMhz} MHz` : ""}</span></div>
    <h2>Storage</h2>
    <div class="stores">${s.storage.map((d) => `<div class="store"><div class="store-line"><b>${esc(d.name)}</b><span>${human(d.free)} free of ${human(d.total)}</span></div>
      <div class="meter"><i style="width:${pctOf(d.used, d.total)}%"></i></div></div>`).join("")}</div>
    <h2>Busiest processes</h2>
    <table class="procs"><tbody>${s.processes.map((p) => `<tr><td class="pid">${p.pid}</td><td class="cpu">${p.cpu}%</td>
      <td class="cmd" title="${esc(p.command)}">${esc(cmdName(p.command))}</td></tr>`).join("") || `<tr><td class="muted-note">No process list.</td></tr>`}</tbody></table>
    <div class="power-row">
      <button class="btn sm" data-term="reboot">${ICON.reboot} Reboot</button>
      <button class="btn sm danger" data-term="poweroff">${ICON.power} Shut down</button>
    </div>
  </section>`;
}

function renderSnippets() {
  const box = $("ssh-snippets");
  if (!box) return;
  const row = (label, cmd, key, custom) => `<div class="snip">
    <button class="snip-run" data-snip="${key}" title="Run in the current tab:\n${esc(cmd)}"><span>${ICON.run}</span><b>${esc(label)}</b><code>${esc(cmd)}</code></button>
    <button class="snip-side" data-snip-type="${key}" title="Type it without running">${ICON.insert}</button>
    ${custom ? `<button class="snip-side del" data-snip-del="${key}" title="Remove">&times;</button>` : ""}</div>`;
  const groups = SNIPPETS.map(([g, list], gi) => `<div class="snip-group">${esc(g)}</div>${list.map(([l, c], i) => row(l, c, `${gi}:${i}`, false)).join("")}`);
  if (ssh.custom.length) groups.push(`<div class="snip-group">Yours</div>${ssh.custom.map((s, i) => row(s.label, s.cmd, `c:${i}`, true)).join("")}`);
  const open = !!box.querySelector(".snip-add[open]");
  box.innerHTML = `<section class="panel ssh-panel"><h2>Quick commands</h2>
    <div class="snips">${groups.join("")}</div>
    <details class="snip-add"${open ? " open" : ""}><summary>Add your own</summary>
      <form class="snip-form" data-form="snippet">
        <input class="control" name="label" placeholder="Name, e.g. Restart Wi-Fi" maxlength="40" required>
        <input class="control mono" name="cmd" placeholder="Command" required spellcheck="false" autocomplete="off">
        <button class="btn sm primary">Add</button>
      </form>
    </details></section>`;
}

function renderConn() {
  const box = $("ssh-conn");
  if (!box) return;
  const s = ssh.status;
  if (!s) {
    box.innerHTML = `<section class="panel ssh-panel"><h2>Connection</h2>${ssh.statusError
      ? `<div class="notice err">${esc(ssh.statusError)}</div><button class="btn sm" data-term="status">Try again</button>`
      : `<div class="muted-note"><span class="spinner"></span> Checking&hellip;</div>`}</section>`;
    return;
  }
  const form = box.querySelector(".ssh-form");
  const typed = form ? Object.fromEntries([...form.elements].filter((el) => el.name).map((el) => [el.name, el.value])) : null;
  const open = !!box.querySelector(".ssh-settings[open]") || (!s.configured && !form);
  const cli = s.host ? `ssh ${s.port !== 22 ? `-p ${s.port} ` : ""}${s.user}@${s.host}` : "";
  const rows = [
    ["Status", s.reachable ? `<span class="ok-text">Answering</span> <span class="nil">${esc(s.server.replace(/^SSH-2\.0-/, ""))}</span>` : s.configured ? `<span class="err-text">Not answering</span>` : "No address yet"],
    ["Address", s.host ? `<code>${esc(`${s.user}@${s.host}:${s.port}`)}</code>${s.followsWifi ? ` <span class="nil">(Wi-Fi address)</span>` : ""}` : "\u2013"],
    ["Sign-in", s.usesAgent ? "SSH agent keys" : "Password"],
    ["Host key", s.fingerprint ? `<code class="fp" title="${esc(s.fingerprint)}">${esc(s.fingerprint)}</code> <button class="link-btn" data-term="forget" title="Forget this key; the next connection trusts whatever key the handheld shows">Forget</button>` : `<span class="nil">Trusted on first connection</span>`],
    cli ? ["Command line", `<code>${esc(cli)}</code> <button class="link-btn" data-term="copy-cli" data-cli="${esc(cli)}">Copy</button>`] : null,
    s.host ? ["Web terminal", `<a href="http://${esc(s.host)}:${s.vt}/" target="_blank" rel="noopener">http://${esc(s.host)}:${s.vt}</a>`] : null,
  ].filter(Boolean);
  box.innerHTML = `<section class="panel ssh-panel"><h2>Connection</h2>
    <dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    <details class="ssh-settings"${open ? " open" : ""}><summary>Settings</summary>
      <form class="ssh-form" data-form="settings">
        <label class="span2">Address<input class="control" name="host" value="${esc(s.hostSetting)}" placeholder="${esc(s.followsWifi && s.host ? `Same as Wi-Fi (${s.host})` : "192.168.0.32")}" spellcheck="false" autocomplete="off"></label>
        <label>Port<input class="control" name="port" value="${s.port}" inputmode="numeric"></label>
        <label>User<input class="control" name="user" value="${esc(s.user)}" spellcheck="false" autocomplete="off"></label>
        <label>Sign in with<select class="control" name="auth"><option value="password"${s.usesAgent ? "" : " selected"}>Password</option><option value="agent"${s.usesAgent ? " selected" : ""}>SSH agent keys</option></select></label>
        <label>Password<input class="control" name="password" type="password" placeholder="${s.usesAgent ? "Not used" : "Unchanged"}" autocomplete="new-password"></label>
        <label>Shell<select class="control" name="shell"><option value="bash"${s.shell === "bash" ? " selected" : ""}>bash</option><option value="sh"${s.shell === "sh" ? " selected" : ""}>Login shell (sh)</option></select></label>
        <div class="form-end"><button class="btn sm primary">Save</button></div>
      </form>
      <div class="muted-note">MustardOS signs in as root / root. Settings apply to new tabs.</div>
    </details></section>`;
  if (typed) {
    const f = box.querySelector(".ssh-form");
    for (const [name, value] of Object.entries(typed)) if (f.elements[name]) f.elements[name].value = value;
  }
}

// ---------------------------------------------------------------- data

async function loadStatus() {
  try {
    ssh.status = await api("ssh/status");
    ssh.statusError = "";
  } catch (error) {
    ssh.statusError = error.message;
  }
  renderHead();
  renderConn();
  if (!ssh.tabs.length) renderEmpty();
  if (!ssh.autoOpened && ssh.status?.reachable && !ssh.tabs.length && section() === "ssh") {
    ssh.autoOpened = true;
    newTab();
  }
}

async function loadStats() {
  if (ssh.statsBusy || !ssh.status?.reachable) { renderStats(); return; }
  ssh.statsBusy = true;
  renderStats();
  try {
    ssh.stats = await api("ssh/stats");
    ssh.statsError = "";
  } catch (error) {
    ssh.statsError = error.message;
  }
  ssh.statsBusy = false;
  renderStats();
}

let ticks = 0;
function tick() {
  if (section() !== "ssh" || document.hidden) return;
  if (++ticks % 2 === 0 || !ssh.status?.reachable) loadStatus().then(loadStats);
  else loadStats();
}

// ---------------------------------------------------------------- actions

function snippetAt(key) {
  if (key.startsWith("c:")) return ssh.custom[+key.slice(2)]?.cmd;
  const [g, i] = key.split(":").map(Number);
  return SNIPPETS[g]?.[1][i]?.[1];
}

async function runSnippet(cmd, run) {
  const t = current();
  if (t && t.state === "ready") return sendLine(t, cmd, run);
  if (t && t.state === "connecting") { t.pending = cmd; return; }
  await newTab(run ? cmd : "");
}

async function power(action) {
  const reboot = action === "reboot";
  const ok = await confirmBox({
    title: reboot ? "Reboot the handheld?" : "Shut down the handheld?",
    html: `<p>MustardOS closes any running game the same way its own menu does${reboot ? ", then starts again" : ""}. Open terminal tabs disconnect.</p>`,
    ok: reboot ? "Reboot" : "Shut down", danger: !reboot,
  });
  if (!ok) return;
  try {
    await api("ssh/power", { action });
    toast(reboot ? "Rebooting the handheld\u2026" : "Shutting down the handheld\u2026", 3000);
    ssh.stats = null;
    setTimeout(loadStatus, 4000);
  } catch (error) {
    toast(error.message, 4000);
  }
}

async function onClick(e) {
  const close = e.target.closest("[data-close]");
  if (close) {
    e.stopPropagation();
    const t = ssh.tabs.find((x) => x.id === +close.dataset.close);
    if (t) closeTab(t);
    return;
  }
  const tabEl = e.target.closest("[data-tab]");
  if (tabEl) return activate(ssh.tabs.find((x) => x.id === +tabEl.dataset.tab));
  const snip = e.target.closest("[data-snip], [data-snip-type], [data-snip-del]");
  if (snip) {
    if (snip.dataset.snipDel !== undefined) {
      ssh.custom.splice(+snip.dataset.snipDel.slice(2), 1);
      store.set("ssh.snippets", ssh.custom);
      return renderSnippets();
    }
    const key = snip.dataset.snip ?? snip.dataset.snipType;
    return runSnippet(snippetAt(key), snip.dataset.snip !== undefined);
  }
  const el = e.target.closest("[data-term]");
  if (!el || el.disabled) return;
  const t = current(), act = el.dataset.term;
  const refocus = () => t?.term.focus();
  switch (act) {
    case "new": return newTab();
    case "reconnect": if (t) connectTab(t); return refocus();
    case "find": return $("term-find").hidden ? openFind() : closeFind();
    case "find-close": return closeFind();
    case "find-next": return runFind(true, true);
    case "find-prev": return runFind(false, true);
    case "find-case": case "find-regex": {
      const k = act === "find-case" ? "caseSensitive" : "regex";
      ssh.find[k] = !ssh.find[k];
      el.classList.toggle("on", ssh.find[k]);
      return runFind(true);
    }
    case "font-up": setFont(ssh.font + 1); return refocus();
    case "font-down": setFont(ssh.font - 1); return refocus();
    case "copy": return t && copySelection(t);
    case "paste": return t && pasteInto(t);
    case "clear": t?.term.clear(); return refocus();
    case "save": return t ? saveLog(t) : toast("Open a terminal first");
    case "broadcast":
      ssh.broadcast = !ssh.broadcast;
      toast(ssh.broadcast ? "Typing goes to every open tab" : "Typing goes to the current tab only", 2200);
      renderTabs(); renderStatusBar();
      return refocus();
    case "full":
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $("term-pane").requestFullscreen().catch(() => toast("Full screen is not available here"));
      return refocus();
    case "stats": return loadStats();
    case "status": ssh.statusError = ""; renderConn(); if (!ssh.tabs.length) renderEmpty(); return loadStatus();
    case "reboot": case "poweroff": return power(act);
    case "settings": {
      const d = $("ssh-conn").querySelector(".ssh-settings");
      if (d) { d.open = true; d.scrollIntoView({ block: "nearest", behavior: "smooth" }); d.querySelector("input")?.focus(); }
      return;
    }
    case "forget": case "trust": {
      if (act === "forget" && !(await confirmBox({
        title: "Forget the host key?",
        html: "<p>The next connection trusts whatever key answers on that address. Only do this after reinstalling MustardOS.</p>",
        ok: "Forget", danger: true,
      }))) return;
      try {
        ssh.status = await api("ssh/forget-key", {});
        renderConn();
        if (act === "trust" && t) connectTab(t);
        else toast("Forgot the host key. The next connection trusts the key it sees.", 3000);
      } catch (error) { toast(error.message, 4000); }
      return;
    }
    case "copy-cli": if (await copyText(el.dataset.cli)) toast("Copied"); return;
  }
}

async function onSubmit(e) {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  if (form.dataset.form === "snippet") {
    ssh.custom.push({ label: f.label.trim(), cmd: f.cmd.trim() });
    store.set("ssh.snippets", ssh.custom);
    form.reset();
    return renderSnippets();
  }
  const body = { host: f.host, port: f.port, user: f.user, shell: f.shell };
  if (f.auth === "agent") body.password = "";
  else if (f.password) body.password = f.password;
  else if (ssh.status?.usesAgent) return toast("Enter the password", 2500);
  try {
    ssh.status = await api("ssh/settings", body);
    form.closest("details").open = false;
    form.remove();
    toast("Saved. New tabs use these settings.", 2500);
    renderHead(); renderConn();
    if (!ssh.tabs.length) renderEmpty();
    loadStats();
  } catch (error) {
    toast(error.message, 4000);
  }
}

// ---------------------------------------------------------------- entry

/** Called whenever the SSH section is shown. */
export function showSsh() {
  if (!ssh.inited) {
    ssh.inited = true;
    build();
    renderEmpty();
    renderTabs();
    renderSnippets();
  }
  renderHead();
  renderConn();
  renderStats();
  loadStatus().then(loadStats);
  fitSoon();
  setTimeout(() => current()?.term.focus(), 50);
}
