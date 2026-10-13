// Device Settings: the MustardOS options from the handheld's own Settings screens, changed over SSH. Edits are
// collected on the page and written together; each save can be undone.

import { $, api, esc, icon, osVersion, plural, toast } from "./core.js";
import { confirmBox } from "./art-images.js";

const H = { data: null, error: "", loading: false, saving: false, edits: {}, q: "", advanced: false, result: null, bound: false, active: "" };

const WHEN = {
  bright: ["now", "Applies right away"], volume: ["now", "Applies right away"], tweak: ["now", "Applies right away"],
  services: ["now", "Starts or stops right away"], live: ["now", "Used right away"], menu: ["menu", "Shows when a menu screen next loads"],
  network: ["menu", "Used the next time Wi-Fi connects"], boot: ["boot", "Used the next time the handheld starts"],
  reboot: ["boot", "Shows after a restart"],
};
const WHEN_SHORT = { now: "Instant", menu: "Next screen", boot: "Next start" };

export function showHandheld() {
  if (!H.bound) bind();
  if (!H.data && !H.loading) load();
  render();
}

async function load() {
  H.loading = true;
  H.error = "";
  render();
  try {
    H.data = await api("handheld/settings");
  } catch (error) {
    H.error = error.message;
  }
  H.loading = false;
  render();
}

const items = () => (H.data?.groups || []).flatMap((g) => g.items);
const itemOf = (key) => items().find((s) => s.key === key);
const valueOf = (s) => (s.key in H.edits ? H.edits[s.key] : s.value);
const changedKeys = () => Object.keys(H.edits).filter((k) => itemOf(k) && H.edits[k] !== itemOf(k).value);
const labelOf = (s, v) => s.options?.find(([o]) => o === v)?.[1] ?? `${v}${s.unit || ""}`;

// ---------------------------------------------------------------- rendering

function render() {
  const box = $("handheld");
  if (!box) return;
  renderHead();
  if (!H.data) {
    box.innerHTML = H.error
      ? `<div class="hh-empty">${icon("unplug")}<h3>Can't reach the handheld</h3><p>${esc(H.error)}</p>
          <p class="hh-hint">The handheld needs Wi-Fi and Configuration &rsaquo; Web Services &rsaquo; Secure Shell turned on.</p>
          <div class="hh-empty-actions"><button class="btn primary" data-hh="reload">${icon("refresh")}Try again</button>
          <a class="btn" href="#ssh">${icon("chip")}SSH settings</a></div></div>`
      : `<div class="planning"><span class="spinner"></span> Reading settings from the handheld&hellip;</div>`;
    renderBar();
    return;
  }
  const q = H.q.trim().toLowerCase();
  const groups = H.data.groups.map((g) => ({
    ...g, shown: g.items.filter((s) => !q || `${s.label} ${s.help} ${g.title}`.toLowerCase().includes(q)),
  }));
  const hits = groups.reduce((n, g) => n + g.shown.length, 0);
  const nav = H.data.groups.map((g) => {
    const n = g.items.filter((s) => changedKeys().includes(s.key)).length;
    return `<a class="hh-nav-link${H.active === g.id ? " on" : ""}${g.advanced ? " adv" : ""}" href="#hh-${g.id}" data-hh-nav="${g.id}">
      ${icon(g.icon)}<span>${esc(g.title)}</span>${n ? `<b class="hh-dot" title="${plural(n, "unsaved change")}">${n}</b>` : ""}</a>`;
  }).join("");
  const panels = groups.filter((g) => g.shown.length).map((g) => panel(g, q)).join("");
  box.innerHTML = `${resultHtml()}
    <div class="hh">
      <nav class="hh-nav" aria-label="Setting groups">
        <label class="hh-search">${icon("search")}<input id="hh-q" type="search" placeholder="Find a setting" aria-label="Find a setting" value="${esc(H.q)}" autocomplete="off" spellcheck="false"></label>
        ${nav}
        <p class="hh-nav-note">Same options as Configuration &rsaquo; General Settings, Power, Interface and Customisation on the handheld.</p>
      </nav>
      <div class="hh-main">${panels || `<div class="hh-none">No setting matches &ldquo;${esc(H.q)}&rdquo;.</div>`}
        ${q && hits ? `<p class="hh-count">${plural(hits, "setting")} found</p>` : ""}</div>
    </div>`;
  renderBar();
}

function renderHead() {
  const sub = $("hh-sub"), actions = $("hh-actions");
  if (!sub) return;
  const d = H.data;
  sub.innerHTML = d ? `MustardOS ${esc(osVersion(d.version))} on ${esc(d.host)} &middot; changed over SSH` : "MustardOS settings on the handheld, changed over SSH";
  actions.innerHTML = `${d?.undo ? `<button class="btn" data-hh="undo" title="Put back: ${esc(d.undo.labels.join(", "))}">${icon("refresh")}Undo last save</button>` : ""}
    <button class="btn" data-hh="reload" ${H.loading || H.saving ? "disabled" : ""}>${H.loading ? `<span class="spinner"></span>` : icon("download")}Reload from handheld</button>`;
}

function panel(g, q) {
  const collapsed = g.advanced && !H.advanced && !q && !g.items.some((s) => changedKeys().includes(s.key));
  return `<section class="panel hh-panel${g.advanced ? " adv" : ""}" id="hh-${g.id}" data-group="${g.id}">
    <header class="hh-panel-head"><span class="hh-panel-ico">${icon(g.icon)}</span><div><h2>${esc(g.title)}</h2><p>${esc(g.intro)}</p></div></header>
    ${collapsed
      ? `<div class="hh-adv-gate">${icon("alert")}<span>These can make the handheld misbehave if set wrong.</span><button class="btn small" data-hh="advanced">Show ${plural(g.items.length, "option")}</button></div>`
      : `${g.advanced ? `<div class="notice hh-adv-note">${icon("alert")}Change these only if you know what they do. Every save can be undone.</div>` : ""}
         <div class="hh-rows">${g.shown.map(row).join("")}</div>`}
  </section>`;
}

function row(s) {
  const v = valueOf(s), changed = s.key in H.edits && H.edits[s.key] !== s.value;
  const [when, whenText] = WHEN[s.apply] || ["menu", ""];
  return `<div class="hh-row${changed ? " changed" : ""}" data-key="${esc(s.key)}">
    <div class="hh-row-text">
      <b>${esc(s.label)}<span class="hh-when ${when}" title="${esc(whenText)}">${WHEN_SHORT[when]}</span></b>
      <small>${esc(s.help)}${changed ? ` <span class="hh-was">On the handheld: ${esc(labelOf(s, s.value))}</span>` : ""}</small>
    </div>
    <div class="hh-ctl">${control(s, v)}
      <button class="hh-revert" data-hh="revert" data-key="${esc(s.key)}" title="Keep the handheld's value" ${changed ? "" : "hidden"}>${icon("x")}</button>
    </div>
  </div>`;
}

const id = (s) => "hh-" + s.key.replace(/[^a-z0-9]+/gi, "-");

function control(s, v) {
  const dis = H.saving ? " disabled" : "";
  if (s.kind === "toggle") {
    const on = v === "1";
    return `<label class="switch"><span class="hh-switch-text">${on ? "On" : "Off"}</span><input type="checkbox" role="switch" id="${id(s)}" data-hh-key="${esc(s.key)}"${on ? " checked" : ""}${dis} aria-label="${esc(s.label)}"><span class="switch-track"></span></label>`;
  }
  if (s.kind === "range") {
    return `<div class="hh-range"><input type="range" id="${id(s)}" min="${s.min}" max="${s.max}" step="${s.step || 1}" value="${esc(v)}" data-hh-key="${esc(s.key)}"${dis} aria-label="${esc(s.label)}" style="--p:${(((Number(v) - s.min) / (s.max - s.min || 1)) * 100).toFixed(1)}%">
      <span class="hh-range-val"><input class="control" type="number" min="${s.min}" max="${s.max}" value="${esc(v)}" data-hh-num="${esc(s.key)}"${dis} aria-label="${esc(s.label)} value"><i>${esc(s.unit || "")}</i></span></div>`;
  }
  if (s.kind === "text") {
    return `<input class="control hh-text" id="${id(s)}" value="${esc(v)}" data-hh-key="${esc(s.key)}" pattern="${esc(s.pattern || ".*")}" spellcheck="false" autocomplete="off"${dis} aria-label="${esc(s.label)}">`;
  }
  const opts = s.options || [];
  if (opts.length <= 3 && opts.reduce((n, [, l]) => n + l.length, 0) <= 30) {
    return `<div class="segmented hh-seg" role="radiogroup" aria-label="${esc(s.label)}">${opts.map(([o, l]) =>
      `<button type="button" role="radio" aria-checked="${o === v}" class="${o === v ? "on" : ""}" data-hh-pick="${esc(s.key)}" data-v="${esc(o)}"${dis}>${esc(l)}</button>`).join("")}</div>`;
  }
  return `<select class="control hh-select" id="${id(s)}" data-hh-key="${esc(s.key)}"${dis} aria-label="${esc(s.label)}">${opts.map(([o, l]) =>
    `<option value="${esc(o)}"${o === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
}

function resultHtml() {
  const r = H.result;
  if (!r) return "";
  if (r.error) return `<div class="notice err hh-result">${icon("alert")}<div><b>Nothing was changed.</b> ${esc(r.error)}</div><button class="hh-result-x" data-hh="dismiss" aria-label="Dismiss">${icon("x")}</button></div>`;
  const lines = [];
  if (r.now.length) lines.push(`<li>${icon("check")}<span><b>Applied now:</b> ${esc(r.now.join(", "))}</span></li>`);
  if (r.menu.length) lines.push(`<li>${icon("eye")}<span><b>Shows when a menu screen next loads:</b> ${esc(r.menu.join(", "))}</span></li>`);
  if (r.boot.length) lines.push(`<li>${icon("power")}<span><b>Used from the next start:</b> ${esc(r.boot.join(", "))}</span></li>`);
  return `<div class="notice ok hh-result">${icon("check")}<div><b>${r.undo ? "Put back the earlier values" : `Saved ${plural(r.count, "change")} to the handheld`}.</b>
    <ul>${lines.join("")}</ul>
    ${r.restart ? `<div class="hh-result-actions"><span>${esc(r.restart.join(", "))} ${r.restart.length === 1 ? "shows" : "show"} after a restart.</span><button class="btn small" data-hh="reboot">${icon("power")}Restart the handheld</button></div>` : ""}
    </div><button class="hh-result-x" data-hh="dismiss" aria-label="Dismiss">${icon("x")}</button></div>`;
}

function renderBar() {
  const bar = $("hh-bar");
  if (!bar) return;
  const keys = changedKeys();
  document.body.classList.toggle("has-hh-bar", !!keys.length);
  bar.hidden = !keys.length;
  if (!keys.length) { bar.innerHTML = ""; return; }
  const chips = keys.slice(0, 4).map((k) => `<span class="hh-chip">${esc(itemOf(k).label)}</span>`).join("") + (keys.length > 4 ? `<span class="hh-chip more">+${keys.length - 4}</span>` : "");
  bar.innerHTML = `<div class="hh-bar-text"><b>${plural(keys.length, "unsaved change")}</b><span class="hh-chips">${chips}</span></div>
    <button class="btn" data-hh="discard" ${H.saving ? "disabled" : ""}>Discard</button>
    <button class="btn primary" data-hh="save" ${H.saving ? "disabled" : ""}>${H.saving ? `<span class="spinner"></span>Saving&hellip;` : `${icon("upload")}Save to handheld`}</button>`;
}

/** Redraws one row and the bits that count changes, without rebuilding the page under the pointer. */
function refreshRow(key) {
  const s = itemOf(key), el = document.querySelector(`.hh-row[data-key="${CSS.escape(key)}"]`);
  if (!s || !el) return render();
  const changed = key in H.edits && H.edits[key] !== s.value;
  el.classList.toggle("changed", changed);
  el.querySelector(".hh-revert").hidden = !changed;
  const small = el.querySelector(".hh-row-text small");
  small.innerHTML = `${esc(s.help)}${changed ? ` <span class="hh-was">On the handheld: ${esc(labelOf(s, s.value))}</span>` : ""}`;
  const sw = el.querySelector(".hh-switch-text");
  if (sw) sw.textContent = valueOf(s) === "1" ? "On" : "Off";
  el.querySelectorAll("[data-hh-pick]").forEach((b) => { const on = b.dataset.v === valueOf(s); b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
  document.querySelectorAll("[data-hh-nav]").forEach((a) => {
    const g = H.data.groups.find((x) => x.id === a.dataset.hhNav);
    const n = g.items.filter((x) => changedKeys().includes(x.key)).length;
    a.querySelector(".hh-dot")?.remove();
    if (n) a.insertAdjacentHTML("beforeend", `<b class="hh-dot" title="${plural(n, "unsaved change")}">${n}</b>`);
  });
  renderBar();
}

function setEdit(key, value) {
  const s = itemOf(key);
  if (!s) return;
  if (value === s.value) delete H.edits[key]; else H.edits[key] = value;
  refreshRow(key);
}

// ---------------------------------------------------------------- saving

function summarize(applied, keys, undo) {
  const by = (kinds) => keys.filter((k) => kinds.includes(itemOf(k)?.apply)).map((k) => itemOf(k).label);
  return {
    undo, count: keys.length,
    now: by(["bright", "volume", "tweak", "services", "live"]),
    menu: by(["menu", "network"]),
    boot: by(["boot"]),
    restart: by(["reboot"]).length ? by(["reboot"]) : null,
  };
}

async function save() {
  const keys = changedKeys();
  if (!keys.length || H.saving) return;
  const warnings = keys.map(itemOf).filter((s) => s.warn && (s.kind !== "toggle" || H.edits[s.key] === "0")
    && !(s.key.endsWith("usb_function") && H.edits[s.key] === "2"));
  if (warnings.length) {
    const ok = await confirmBox({
      title: warnings.length === 1 ? `Change ${warnings[0].label}?` : "Change these settings?",
      html: warnings.map((s) => `<p><b>${esc(s.label)}:</b> ${esc(s.warn)}</p>`).join(""),
      ok: "Save anyway", danger: true,
    });
    if (!ok) return;
  }
  H.saving = true;
  H.result = null;
  render();
  try {
    const changes = Object.fromEntries(keys.map((k) => [k, H.edits[k]]));
    const seen = Object.fromEntries(keys.map((k) => [k, itemOf(k).value]));
    const r = await api("handheld/settings", { changes, seen });
    H.result = summarize(r.applied, keys, false);
    H.edits = {};
    if (r.settings) H.data = r.settings; else load();
    toast(`Saved ${plural(keys.length, "change")}`);
  } catch (error) {
    H.result = { error: error.message };
  }
  H.saving = false;
  render();
}

async function undo() {
  const u = H.data?.undo;
  if (!u) return;
  const ok = await confirmBox({
    title: "Undo the last save?",
    html: `<p>Puts back the values these had before: <b>${esc(u.labels.join(", "))}</b>.</p>`,
    ok: "Undo",
  });
  if (!ok) return;
  H.saving = true;
  render();
  try {
    const keysBefore = items().map((s) => [s.key, s.value]);
    const r = await api("handheld/settings/undo", {});
    if (r.settings) H.data = r.settings;
    const now = new Map(items().map((s) => [s.key, s.value]));
    const keys = keysBefore.filter(([k, v]) => now.has(k) && now.get(k) !== v).map(([k]) => k);
    H.result = summarize(r.applied, keys, true);
    H.edits = {};
  } catch (error) {
    H.result = { error: error.message };
  }
  H.saving = false;
  render();
}

async function act(el) {
  const what = el.dataset.hh;
  if (what === "reload") {
    if (changedKeys().length && !(await confirmBox({ title: "Discard your changes?", html: `<p>Reloading drops ${plural(changedKeys().length, "unsaved change")}.</p>`, ok: "Discard and reload", danger: true }))) return;
    H.edits = {};
    H.result = null;
    return load();
  }
  if (what === "save") return save();
  if (what === "undo") return undo();
  if (what === "discard") { H.edits = {}; render(); return; }
  if (what === "dismiss") { H.result = null; render(); return; }
  if (what === "advanced") { H.advanced = true; render(); return; }
  if (what === "revert") { delete H.edits[el.dataset.key]; render(); return; }
  if (what === "reboot") {
    const ok = await confirmBox({ title: "Restart the handheld?", html: "<p>A game that is running is closed without saving.</p>", ok: "Restart", danger: true });
    if (!ok) return;
    try {
      await api("ssh/power", { action: "reboot" });
      toast("The handheld is restarting", 2600);
      H.result = null;
      H.data = null;
      render();
      setTimeout(() => { if (!H.data) load(); }, 45_000);
    } catch (error) { toast(error.message, 3200); }
  }
}

function bind() {
  H.bound = true;
  const view = $("view-handheld");
  view.addEventListener("click", (e) => {
    const el = e.target.closest("[data-hh]");
    if (el && !el.disabled) { e.preventDefault(); act(el); return; }
    const pick = e.target.closest("[data-hh-pick]");
    if (pick && !pick.disabled) { setEdit(pick.dataset.hhPick, pick.dataset.v); return; }
    const nav = e.target.closest("[data-hh-nav]");
    if (nav) {
      e.preventDefault();
      const g = H.data?.groups.find((x) => x.id === nav.dataset.hhNav);
      if (g?.advanced) H.advanced = true;
      if (H.q) { H.q = ""; }
      render();
      $("hh-" + nav.dataset.hhNav)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  view.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "hh-q") {
      H.q = t.value;
      const caret = t.selectionStart;
      render();
      const q = $("hh-q");
      q.focus();
      q.setSelectionRange(caret, caret);
      return;
    }
    if (t.type === "range" && t.dataset.hhKey) {
      const s = itemOf(t.dataset.hhKey);
      t.style.setProperty("--p", `${(((Number(t.value) - s.min) / (s.max - s.min || 1)) * 100).toFixed(1)}%`);
      const num = t.closest(".hh-range").querySelector("[data-hh-num]");
      num.value = t.value;
      setEdit(s.key, t.value);
      return;
    }
    if (t.dataset.hhNum) {
      const s = itemOf(t.dataset.hhNum), n = Math.round(Number(t.value));
      if (t.value === "" || !Number.isFinite(n) || n < s.min || n > s.max) { t.classList.add("bad"); return; }
      t.classList.remove("bad");
      const slider = t.closest(".hh-range").querySelector("input[type=range]");
      slider.value = String(n);
      slider.style.setProperty("--p", `${(((n - s.min) / (s.max - s.min || 1)) * 100).toFixed(1)}%`);
      setEdit(s.key, String(n));
      return;
    }
    if (t.classList.contains("hh-text")) {
      const ok = new RegExp(t.pattern).test(t.value.trim());
      t.classList.toggle("bad", !ok);
      if (ok) setEdit(t.dataset.hhKey, t.value.trim()); else delete H.edits[t.dataset.hhKey];
      if (!ok) refreshRow(t.dataset.hhKey);
    }
  });
  view.addEventListener("change", (e) => {
    const t = e.target;
    if (t.type === "checkbox" && t.dataset.hhKey) setEdit(t.dataset.hhKey, t.checked ? "1" : "0");
    else if (t.tagName === "SELECT" && t.dataset.hhKey) setEdit(t.dataset.hhKey, t.value);
    else if (t.dataset.hhNum) t.value = valueOf(itemOf(t.dataset.hhNum));
  });
  addEventListener("scroll", () => {
    if (location.hash !== "#handheld" || !H.data) return;
    let current = H.data.groups[0]?.id || "";
    const panels = [...document.querySelectorAll(".hh-panel")];
    for (const p of panels) if (p.getBoundingClientRect().top < Math.max(140, innerHeight / 3)) current = p.dataset.group;
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4 && panels.length) current = panels.at(-1).dataset.group;
    if (current !== H.active) {
      H.active = current;
      document.querySelectorAll("[data-hh-nav]").forEach((a) => a.classList.toggle("on", a.dataset.hhNav === current));
    }
  }, { passive: true });
  addEventListener("beforeunload", (e) => { if (changedKeys().length) e.preventDefault(); });
}

export const handheldDirty = () => changedKeys().length > 0;
