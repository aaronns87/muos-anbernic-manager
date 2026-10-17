// The library game viewer's details: facts, the game's state on the handheld, its file, library check, BIOS
// and related games, in tabs. Handheld data is read in the background and kept for a while across games.

import { $, api, app, clock, esc, formatDate, formatTime, human, icon, plural, store, toast, canCopy, devName, handheldMode, keyOf, onCardState } from "./core.js";
import { artMax, droppedImage, pickImage, pngData } from "./art-images.js";
import { noteKind, systemNote, useCore, useSystem } from "./system-notes.js";

const TABS = [["about", "About"], ["details", "Details"], ["handheld", "Handheld"], ["related", "Related"]];
const DEVICE_TTL = 120_000;
const enc = encodeURIComponent;
const stemOf = (f) => String(f).replace(/\.[^.]+$/, "");
const baseOf = (p) => String(p).split("/").pop() || "";

const V = {
  tab: store.get("viewerTab", "about"), cur: null, back: [], nav: false, editing: false, video: false, expanded: false, fixing: false, saving: false,
  details: new Map(), dataRef: null, rel: [], dev: { key: "", at: 0, seq: 0 },
};
let hooks = { open: () => {}, reload: async () => {} };

// ---------------------------------------------------------------- formatting

const when = (s) => {
  if (!s) return "";
  const d = new Date(s * 1000), days = Math.floor((Date.now() - d) / 86400000);
  if (days < 1 && new Date().getDate() === d.getDate()) return `today ${formatTime(d)}`;
  if (days < 2) return `yesterday ${formatTime(d)}`;
  return days < 7 ? `${d.toLocaleDateString(undefined, { weekday: "long" })} ${formatTime(d)}` : formatDate(d, "long");
};
const dl = (rows) => `<dl class="v-dl">${rows.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
const sec = (title, ico, body, aside = "") => `<section class="v-sec"><h3>${icon(ico)}<span>${title}</span>${aside ? `<span class="grow"></span>${aside}` : ""}</h3>${body}</section>`;
const chip = (cls, text, ico = "") => `<span class="set-chip ${cls}">${ico ? icon(ico) : ""}${text}</span>`;
const note = (html) => `<p class="v-note">${html}</p>`;
const loading = (text) => `<p class="v-note"><span class="spinner sm"></span> ${text}</p>`;
const go = (where, label) => `<button class="link-btn" data-vgo="${where}">${label}</button>`;
const youtube = (url) => /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([\w-]{11})/.exec(String(url || ""))?.[1] || "";
const fileManager = () => (/Mac/i.test(navigator.platform) ? "Finder" : /Win/i.test(navigator.platform) ? "Explorer" : "");

// ---------------------------------------------------------------- data

function details() {
  if (V.dataRef !== app.data) { V.details.clear(); V.dataRef = app.data; }
  return V.details.get(V.cur.key);
}

function loadDetails() {
  const { key, sys, g } = V.cur;
  if (details() !== undefined) return;
  V.details.set(key, null);
  api(`game?code=${enc(sys.code)}&file=${enc(g.f)}`).then(
    (d) => { V.details.set(key, d); if (V.cur?.key === key) paint("details"); },
    (e) => { V.details.set(key, { error: e.message }); if (V.cur?.key === key) paint("details"); },
  );
}

/** play, cols, cores, saves: undefined while reading, null when not available, { error } or the answer. */
function loadDevice(force = false) {
  const d = V.dev;
  const target = app.device.target?.id || "", wifi = !!app.device.wifi?.reachable;
  const key = `${target}|${wifi}`;
  if (!force && d.key === key && Date.now() - d.at < DEVICE_TTL) return;
  const seq = ++d.seq;
  Object.assign(d, { key, at: Date.now(), play: undefined, cols: undefined, cores: undefined, saves: undefined });
  const set = (k) => (v) => { if (seq === d.seq) { d[k] = v; paint("device"); } };
  const fail = (k) => (e) => { if (seq === d.seq) { d[k] = { error: e.message }; paint("device"); } };
  if (target && handheldMode()) {
    api(`play?volume=${enc(target)}`).then(set("play"), fail("play"));
    api(`collections?volume=${enc(target)}`).then(set("cols"), fail("cols"));
  } else d.play = d.cols = null;
  if (wifi) {
    api("cores").then((r) => set("cores")(r.reachable ? r : null), fail("cores"));
    api("saves").then((r) => set("saves")(r.device?.reachable ? r.device : null), fail("saves"));
  } else d.cores = d.saves = null;
}

const deviceKnown = () => handheldMode() || !!app.device.wifi?.reachable;
const sameRom = (system, file) => String(system).toUpperCase() === V.cur.sys.code.toUpperCase() && file === V.cur.g.f;

function playOf() {
  const p = V.dev.play;
  if (p === undefined || p === null || p.error) return p;
  if (!p.available) return { unavailable: p.reason };
  return { game: p.games.find((x) => sameRom(x.system, x.file)) || null, recent: p.recent.findIndex((r) => r.name === stemOf(V.cur.g.f)) };
}

function collectionsOf() {
  const c = V.dev.cols;
  if (!c || c.error || !c.available) return c && !c.error && !c.available ? [] : c;
  return c.collections.filter((col) => col.items.some((i) => sameRom(i.system, baseOf(i.path)))).map((col) => col.path || "Collections");
}

function coreOf() {
  const c = V.dev.cores;
  if (!c || c.error) return c;
  const { sys, g } = V.cur;
  const folder = c.folders.find((f) => f.name.toUpperCase() === sys.code.toUpperCase());
  if (!folder) return { folder: null };
  const own = folder.overrides.find((o) => o.file === g.f || o.name === stemOf(g.f)) || null;
  const name = own?.system || folder.folder?.system || folder.auto;
  const system = name ? c.systems.find((s) => s.name === name) : null;
  const key = own?.key || folder.folder?.key || system?.defaultCore || "";
  const core = system?.cores.find((x) => x.key === key);
  return { folder, own, system, core: core?.name || key, set: !!folder.folder };
}

function savesOf() {
  const s = V.dev.saves;
  if (!s || s.error) return s;
  const stem = stemOf(V.cur.g.f);
  const files = s.files.filter((f) => { const b = baseOf(f.path); return b === stem || b.startsWith(`${stem}.`); });
  const states = files.filter((f) => /(^|\/)state\//.test(f.path) && !/\.png$/i.test(f.path));
  const saves = files.filter((f) => !/(^|\/)state\//.test(f.path));
  return { files, states, saves, latest: files.reduce((n, f) => Math.max(n, f.mtime), 0) };
}

// ---------------------------------------------------------------- header

function factsHtml(m) {
  if (!m) return "";
  const rating = m.r ? `<span class="stars" title="LaunchBox community rating from ${m.rc.toLocaleString()} votes">&#9733; ${m.r.toFixed(1)} / 5 <small>(${m.rc.toLocaleString()})</small></span>` : "";
  const facts = [
    m.y ? `<span>${esc(m.y)}</span>` : "",
    ...String(m.g || "").split(/,\s*/).filter(Boolean).slice(0, 3).map((x) => `<span>${esc(x)}</span>`),
    m.pl ? `<span>${icon("users")}${esc(m.pl)} player${m.pl === "1" ? "" : "s"}</span>` : "",
    rating,
  ].join("");
  return facts ? `<div class="facts">${facts}</div>` : "";
}

function tagsHtml() {
  const { g } = V.cur, d = details();
  const out = g.g.map((t) => `<span>${esc(t)}</span>`);
  const c = d && !d.error ? d.check : null;
  if (c?.state === "ok") out.push(`<span class="t-ok" title="Matches the No-Intro list${c.as ? ` as ${esc(c.as)}` : ""}">${icon("check")}Verified</span>`);
  else if (c?.state === "bad") out.push(`<span class="t-bad" title="${esc(c.note)}">${icon("alert")}Bad dump</span>`);
  else if (c?.state === "modified") out.push(`<span class="t-warn" title="A hack, translation or patched copy">Modified</span>`);
  if (c?.disc?.state === "bad") out.push(`<span class="t-bad" title="${esc(c.disc.note)}">${icon("alert")}Disc layout</span>`);
  if (d?.bios?.required && d.bios.files.some((f) => f.state !== "ok")) out.push(`<span class="t-warn" title="This system's default core needs a BIOS file you don't have">${icon("shield")}BIOS missing</span>`);
  if (c?.copies.length) out.push(`<span title="Other versions of this game in your library">${plural(c.copies.length + 1, "version")}</span>`);
  if (g.c) out.push(`<span title="A MAME clone of ${esc(g.c)}">Clone</span>`);
  return out.join("");
}

function backHtml() {
  const last = V.back[V.back.length - 1];
  const g = last !== undefined ? app.visible[last]?.[1] : null;
  return g ? `&lsaquo; Back to ${esc(g.t)}` : "";
}

// ---------------------------------------------------------------- status cards

function card(state, ico, label, value, sub = "", action = "") {
  return `<div class="v-card ${state}" data-vtab="handheld" role="button" tabindex="0">
    <span class="v-card-ico">${state === "loading" ? `<span class="spinner sm"></span>` : icon(ico)}</span>
    <span class="v-card-text"><small>${label}</small><b>${value}</b>${sub ? `<em>${sub}</em>` : ""}</span>${action}</div>`;
}

function fixButton(small = true) {
  const s = useSystem(V.cur.sys.code), c = V.dev.cores;
  if (!s || !c?.systems?.some((x) => x.name === s)) return "";
  return `<button class="btn ${small ? "small " : ""}primary" data-vfix${V.fixing ? " disabled" : ""}>${V.fixing ? `<span class="spinner sm"></span>` : ""}Use ${esc(s)}</button>`;
}

function coreCard() {
  const c = coreOf();
  if (c === undefined) return card("loading", "chip", "Starts with", "Checking&hellip;");
  if (c === null) return card("muted", "chip", "Starts with", "Unknown", "Needs Wi-Fi with SSH on");
  if (c.error) return card("muted", "chip", "Starts with", "Unknown", esc(c.error));
  if (!c.folder) return card("muted", "chip", "Starts with", "No folder yet", `No ${esc(V.cur.sys.code)} folder on the handheld`);
  if (c.system) return card("ok", "chip", "Starts with", esc(c.core), `${esc(c.system.name)}${c.own ? " &middot; its own core" : c.set ? "" : " &middot; automatic"}`);
  const kind = noteKind(V.cur.sys.code);
  if (kind === "use") return card("warn", "alert", "Starts with", "Nothing yet", `Set the folder to ${esc(useSystem(V.cur.sys.code))}`, fixButton());
  if (kind === "extra") return card("warn", "alert", "Starts with", "Not supported", "Needs an extra core");
  if (kind === "none") return card("bad", "alert", "Starts with", "Not supported", "No MustardOS core runs it");
  return card("warn", "alert", "Starts with", "Nothing yet", "The folder needs a system in Cores");
}

function playCard() {
  const p = playOf();
  if (p === undefined) return card("loading", "clock", "Played", "Reading&hellip;");
  if (p === null || p.error || p.unavailable) return card("muted", "clock", "Played", "Unknown", esc(p?.error || p?.unavailable || "Connect the handheld"));
  if (!p.game) return card("muted", "clock", "Played", "Not yet", p.recent >= 0 ? "In the recently played list" : "");
  const g = p.game;
  return card("ok", "clock", "Played", clock(g.total), `${g.launches.toLocaleString()} ${g.launches === 1 ? "launch" : "launches"}${g.last ? ` &middot; ${esc(when(g.last))}` : ""}`);
}

function savesCard() {
  const s = savesOf();
  if (s === undefined) return card("loading", "save", "Saves", "Reading&hellip;");
  if (s === null || s.error) return card("muted", "save", "Saves", "Unknown", esc(s?.error || "Needs Wi-Fi with SSH on"));
  if (!s.files.length) return card("muted", "save", "Saves", "None yet");
  const parts = [s.saves.length ? plural(s.saves.length, "save") : "", s.states.length ? plural(s.states.length, "state") : ""].filter(Boolean).join(", ");
  return card("ok", "save", "Saves", parts || plural(s.files.length, "file"), s.latest ? `Updated ${esc(when(s.latest))}` : "");
}

function transferCard() {
  const { sys, g } = V.cur;
  const st = onCardState(sys, g);
  const name = esc(devName());
  if (st === "same") return card("ok", "check", `On ${name}`, "Transferred");
  if (st === "check") return card("ok", "check", `On ${name}`, "Transferred", "The file date differs");
  if (st === "changed") return card("warn", "alert", `On ${name}`, "Different copy", "Transfer again to replace it");
  return card("muted", "transfer", `On ${name}`, "Not yet", "Use Transfer below");
}

function cardsHtml() {
  const { sys } = V.cur;
  const cards = [];
  if (canCopy(sys)) cards.push(transferCard());
  if (deviceKnown()) cards.push(coreCard(), playCard(), savesCard());
  if (!cards.length) return `<p class="v-hint">${icon("info")}<span>Connect the handheld to see whether this game is on it, the core it starts with, play time and saves.</span></p>`;
  return cards.join("");
}

// ---------------------------------------------------------------- tabs

const metaOf = (x) => (x.lb ? app.data.meta[x.lb] : null);
const yearOf = (x) => parseInt(metaOf(x)?.y, 10) || 0;
const rateOf = (x) => metaOf(x)?.r || 0;
const genresOf = (x) => String(metaOf(x)?.g || "").split(/,\s*/).filter(Boolean);

function relatedGroups() {
  const { sys, g, m, si } = V.cur, d = details();
  const seen = new Set([g]), groups = [];
  const add = (title, list, limit = 12) => {
    const items = list.filter(([, x]) => !seen.has(x)).slice(0, limit);
    items.forEach(([, x]) => seen.add(x));
    if (items.length) groups.push([title, items]);
  };
  const copies = d && !d.error ? d.check.copies.map((c) => sys.games.find((x) => x.f === c.f)).filter(Boolean).map((x) => [si, x]) : [];
  add("Other versions in your library", copies, 20);
  if (g.a) {
    const root = g.c || g.a;
    add("Arcade family", sys.games.filter((x) => x.a === root || x.c === root).map((x) => [si, x]), 20);
  }
  const all = [];
  app.data.systems.forEach((s, i) => s.games.forEach((x) => all.push([i, x])));
  const words = (t) => String(t).toLowerCase().replace(/^(the|a|an)\s+/, "").split(/[^a-z0-9]+/).filter(Boolean).slice(0, 2);
  const mine = words(g.t);
  const sameSeries = (t) => {
    const w = words(t), n = Math.min(w.length, mine.length);
    return n > 0 && (n > 1 || mine[0].length >= 5) && w.slice(0, n).every((x, i) => x === mine[i]);
  };
  if (mine.length) add("Same series", all.filter(([, x]) => sameSeries(x.t)).sort((a, b) => (yearOf(a[1]) || 9999) - (yearOf(b[1]) || 9999)));
  const dev = String(m?.dev || "").split(/,\s*/)[0];
  if (dev) add(`More from ${esc(dev)}`, all.filter(([, x]) => String(metaOf(x)?.dev || "").split(/,\s*/)[0] === dev).sort((a, b) => rateOf(b[1]) - rateOf(a[1])));
  const genre = genresOf(g)[0];
  if (genre) add(`More ${esc(genre)} on ${esc(sys.name)}`, sys.games.filter((x) => genresOf(x).includes(genre)).map((x) => [si, x]).sort((a, b) => rateOf(b[1]) - rateOf(a[1])), 8);
  return groups;
}

function tabsHtml(relCount) {
  return TABS.map(([id, label]) => {
    const count = id === "related" && relCount ? ` <small>${relCount}</small>` : "";
    return `<button role="tab" data-vtab="${id}" class="${V.tab === id ? "on" : ""}" aria-selected="${V.tab === id}">${label}${count}</button>`;
  }).join("");
}

function aboutPane() {
  const { m, g } = V.cur;
  if (V.editing) {
    return `<div class="v-edit">
      <label for="v-edit-text">Description</label>
      <textarea class="control" id="v-edit-text" rows="10" placeholder="What the game is about">${esc(m?.d || "")}</textarea>
      <p class="v-note">Saved as <code>Roms/${esc(V.cur.sys.code)}/Text/${esc(stemOf(g.f))}.txt</code>, used instead of the database text.</p>
      <div class="v-edit-actions">
        ${m?.u ? `<button class="btn ghost" data-vedit="remove"${V.saving ? " disabled" : ""}>Use the database text</button>` : ""}
        <span class="grow"></span>
        <button class="btn" data-vedit="cancel"${V.saving ? " disabled" : ""}>Cancel</button>
        <button class="btn primary" data-vedit="save"${V.saving ? " disabled" : ""}>${V.saving ? `<span class="spinner sm"></span>` : icon("check")}<span>Save</span></button>
      </div>
    </div>`;
  }
  const paragraphs = String(m?.d || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const links = m ? [
    m.id ? `<a href="https://gamesdb.launchbox-app.com/games/details/${enc(m.id)}" target="_blank" rel="noopener">LaunchBox</a>` : "",
    /^https?:\/\//.test(m.w || "") ? `<a href="${esc(m.w)}" target="_blank" rel="noopener">Wikipedia</a>` : "",
    /^https?:\/\//.test(m.v || "") && !youtube(m.v) ? `<a href="${esc(m.v)}" target="_blank" rel="noopener">Video</a>` : "",
  ].filter(Boolean).join(" &middot; ") : "";
  const source = !m ? "" : m.u ? `Your own description${m.id ? `, with LaunchBox details for &ldquo;${esc(m.n)}&rdquo;` : ""}`
    : m.id ? `Matched as &ldquo;${esc(m.n)}&rdquo; in the LaunchBox Games Database` : "Details from the MAME arcade list";
  const vid = youtube(m?.v);
  const video = !vid ? "" : V.video
    ? `<div class="v-video"><iframe src="https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&rel=0" title="Video of ${esc(g.t)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
    : `<button class="v-video v-video-off" data-vvideo><span class="v-play">${icon("play")}</span><span>Watch the video</span><small>Plays from YouTube</small></button>`;
  return `${paragraphs ? `<div class="desc${V.expanded ? "" : " clamp"}" id="v-desc">${paragraphs}</div>${V.expanded ? "" : `<button class="link-btn" id="v-more">Read more</button>`}`
      : `<div class="no-desc">No description found for this game.</div>`}
    <div class="source">${[source, links].filter(Boolean).join(" &middot; ")}${source || links ? " &middot; " : ""}<button class="link-btn" data-vedit="open">${icon("pencil")}${m?.u ? "Edit description" : "Write your own"}</button></div>
    ${video}`;
}

function detailsPane() {
  const { g, m, sys } = V.cur, d = details();
  const rating = m?.r ? `&#9733; ${m.r.toFixed(1)} / 5 from ${plural(m.rc, "vote")}` : "";
  const game = dl([
    m?.n && m.n !== g.t ? ["Database title", esc(m.n)] : null,
    m?.dev ? ["Developer", esc(m.dev)] : null,
    m?.pub ? ["Publisher", esc(m.pub)] : null,
    m?.y ? ["Released", esc(m.y)] : null,
    m?.g ? ["Genre", esc(m.g)] : null,
    m?.pl ? ["Players", esc(m.pl)] : null,
    rating ? ["Rating", rating] : null,
    g.g.length ? ["Version", esc(g.g.join(", "))] : null,
    ["System", `${esc(sys.name)} <span class="muted">${esc(sys.maker)}${sys.year ? ` &middot; ${sys.year}` : ""}</span>`],
  ]);
  const crc = d === null || d === undefined ? `<span class="spinner sm"></span>` : d.error ? "&ndash;" : d.check.crc ? `<code>${esc(d.check.crc)}</code>` : `<span class="muted">Worked out by a library check</span>`;
  const file = dl([
    ["File", `<code>${esc(g.f)}</code>`],
    ["Type", esc(g.x.toUpperCase() || "-")],
    ["Size", `${human(g.s)}${g.n ? ` <span class="muted">with ${plural(g.n, "data file")}</span>` : ""}`],
    ["Modified", esc(`${formatDate(new Date(g.m * 1000), "long")} ${formatTime(new Date(g.m * 1000))}`)],
    ["CRC32", crc],
    ["Artwork", g.i ? "Yes" : `<span class="app-bad">Missing</span> ${go("art", "Find artwork")}`],
    ["Path", `<code>${esc(g.p)}</code>`],
  ]);
  return [sec("Game", "handheld", game), sec("File", "file", file), checkSection(d), discSection(d), biosSection(d), arcadeSection()].join("");
}

function checkSection(d) {
  if (d === null || d === undefined) return sec("Library check", "hash", loading("Reading&hellip;"));
  if (d.error) return sec("Library check", "hash", note(esc(d.error)));
  const c = d.check, run = go("checks", "Run a library check");
  if (!c.supported) return sec("Library check", "hash", note(`The No-Intro lists don't cover ${esc(V.cur.sys.name)}, so its games can't be verified.`));
  if (!c.checked) return sec("Library check", "hash", note(`Not checked yet. ${run} to compare it with the No-Intro list.`));
  const lists = c.dats.map((x) => `${esc(x.name)}${x.version ? ` ${esc(x.version)}` : ""}`).join(", ");
  const state = {
    ok: [chip("ok", c.as ? "Good dump, listed under another name" : "Good dump", "check"), c.as ? `No-Intro calls it <b>${esc(c.as)}</b>.` : "Matches the No-Intro list exactly."],
    bad: [chip("bad", "Bad dump", "alert"), `${esc(c.note)}${c.like ? `. The good dump is <b>${esc(c.like)}</b>.` : "."}`],
    modified: [chip("warn", "Modified"), "A hack, translation or patched copy, so it isn't in the No-Intro list."],
    unknown: [chip("", "Not in the list"), "No-Intro has no game with this name or checksum."],
    unchecked: [chip("", "Not checked"), esc(c.note || "This file could not be read.")],
    "": [chip("", "Not checked"), `Added after the last check. ${run}`],
  }[c.state] || [chip("", "Not checked"), ""];
  return sec("Library check", "hash", `<div class="v-state">${state[0]}<span>${state[1]}</span></div>
    <p class="v-note">Checked ${esc(c.checked)}${lists ? ` against ${lists}` : ""}.</p>`, run);
}

function discSection(d) {
  if (d === null || d === undefined || d.error) return "";
  const disc = d.check?.disc;
  if (!disc) return "";
  const open = go("disc", "Open Disc layouts");
  if (disc.state === "bad") {
    return sec("Disc layout", "layers", `<div class="v-state">${chip("bad", "Problem", "alert")}<span>${esc(disc.note)}</span></div>
      <p class="v-note">Archives (.zip / .7z) and incomplete .bin/.cue sets often boot to a black screen. Use ${open} and <b>Fix&hellip;</b> to extract or convert to .chd.</p>`);
  }
  if (disc.state === "tip") {
    return sec("Disc layout", "layers", `<div class="v-state">${chip("warn", "Works", "info")}<span>${esc(disc.note)}</span></div>
      <p class="v-note">Convert complete .cue sheets to .chd under ${open}.</p>`);
  }
  return sec("Disc layout", "layers", `<div class="v-state">${chip("ok", "OK", "check")}<span>${esc(disc.note || "Disc layout looks fine.")}</span></div>`, open);
}

function biosSection(d) {
  if (d === null || d === undefined || d.error) return "";
  const b = d.bios;
  if (!b) return sec("BIOS", "shield", note(`Open ${go("bios", "Emulation &rsaquo; BIOS")} once with the handheld connected over Wi-Fi to see whether this system needs a BIOS file.`));
  if (!b.system || !b.files.length) return sec("BIOS", "shield", note("No BIOS file needed."));
  const who = b.required ? "The default core needs these files." : b.requiredBy.length ? `Only some cores need them: ${esc(b.requiredBy.join(", "))}.` : "Optional: games may run better with them.";
  const rows = b.files.map((f) => `<li>${f.state === "ok" ? chip("ok", "Have it", "check") : f.state === "unknown" ? chip("warn", "Unknown version") : chip(b.required ? "bad" : "", "Missing")}
    <span class="v-file-meta"><code>${esc(f.path)}</code>${f.desc ? `<small>${esc(f.desc)}</small>` : ""}</span></li>`).join("");
  return sec("BIOS", "shield", `${note(who)}<ul class="v-files">${rows}</ul>`, go("bios", "Open BIOS"));
}

function arcadeSection() {
  const { g, sys } = V.cur;
  if (!g.a) return "";
  const parent = g.c ? sys.games.find((x) => x.a === g.c) : null;
  const clones = sys.games.filter((x) => x.c === g.a).length;
  const rows = dl([
    ["Arcade set", `<code>${esc(g.a)}</code>`],
    g.c ? ["Clone of", parent ? `${esc(parent.t)} <code>${esc(g.c)}</code>` : `<code>${esc(g.c)}</code> <span class="muted">not in your library</span>`] : ["Type", "Parent set"],
    clones ? ["Clones here", plural(clones, "game")] : null,
  ]);
  const warn = g.c && !parent ? note(`If it doesn't start: split ROM sets also need the parent <code>${esc(g.c)}.zip</code> in <code>Roms/${esc(sys.code)}</code>.`) : "";
  return sec("Arcade", "chip", rows + warn);
}

function handheldPane() {
  const out = [];
  const { sys, g } = V.cur;
  if (canCopy(sys)) {
    const st = onCardState(sys, g);
    out.push(sec(`On ${esc(devName())}`, "transfer", note({ same: "Transferred.", check: "Transferred; the file date on the handheld differs from this computer's.", changed: "The handheld has a different copy. Transfer it again to replace it." }[st] || "Not transferred yet.")));
  }
  if (!deviceKnown()) {
    out.push(note("Connect the handheld over USB or Wi-Fi to see the core it starts with, play time, collections and saves."));
    return out.join("");
  }
  out.push(coreSection(), playSection(), collectionsSection(), savesSection());
  return out.join("") + `<p class="v-note">Read from the handheld ${V.dev.at ? esc(formatTime(new Date(V.dev.at))) : ""}. <button class="link-btn" data-vrefresh>Read again</button></p>`;
}

function coreSection() {
  const c = coreOf(), code = V.cur.sys.code, cores = go("cores", "Open Cores");
  if (c === undefined) return sec("Core", "chip", loading("Asking the handheld&hellip;"));
  if (c === null) return sec("Core", "chip", note("Connect over Wi-Fi with Configuration &rsaquo; Web Services &rsaquo; Secure Shell on to see the core it starts with."));
  if (c.error) return sec("Core", "chip", note(esc(c.error)));
  if (!c.folder) return sec("Core", "chip", note(`The handheld has no ${esc(code)} folder yet. Transfer a game to create it.`));
  if (c.system) {
    return sec("Core", "chip", dl([
      ["System", esc(c.system.name)],
      ["Core", `${esc(c.core)}${c.own ? ` ${chip("", "This game only")}` : ""}`],
      ["Set by", c.own ? "Its own core assignment" : c.set ? "The folder's core assignment" : "MustardOS, from the folder name"],
      ["Other cores", plural(Math.max(0, c.system.cores.length - 1), "core")],
    ]), cores);
  }
  return sec("Core", "chip", `<div class="v-state">${chip("warn", "Needs a system", "alert")}<span>${systemNote(code, V.cur.sys.name, false)}</span></div>${fixButton(false) ? `<div class="v-row-actions">${fixButton(false)}</div>` : ""}`, cores);
}

function playSection() {
  const p = playOf(), link = go("play", "Open Play");
  if (p === undefined) return sec("Play time", "clock", loading("Reading the play tracker&hellip;"));
  if (p === null || p.error || p.unavailable) return sec("Play time", "clock", note(esc(p?.error || p?.unavailable || "Not available.")));
  if (!p.game) return sec("Play time", "clock", note(`Not played on the handheld yet${p.recent >= 0 ? ", but it is in the recently played list" : ""}.`), link);
  const g = p.game;
  const cores = Object.entries(g.cores || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(k)} <span class="muted">&times;${n}</span>`).join(", ");
  return sec("Play time", "clock", dl([
    ["Total", clock(g.total)],
    ["Launches", g.launches.toLocaleString()],
    ["Average session", clock(g.avg || (g.launches ? g.total / g.launches : 0))],
    g.started ? ["First played", esc(when(g.started))] : null,
    g.last ? ["Last played", esc(when(g.last))] : null,
    cores ? ["Cores used", cores] : null,
  ]), link);
}

function collectionsSection() {
  const c = collectionsOf();
  if (c === undefined) return sec("Collections", "star", loading("Reading collections&hellip;"));
  if (c === null || c.error) return c?.error ? sec("Collections", "star", note(esc(c.error))) : "";
  return sec("Collections", "star", c.length ? `<div class="tags v-cols">${c.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : note("Not in any collection."), go("play", "Open Collections"));
}

function savesSection() {
  const s = savesOf(), link = go("saves", "Open Saves");
  if (s === undefined) return sec("Saves", "save", loading("Listing saves&hellip;"));
  if (s === null || s.error) return sec("Saves", "save", note(esc(s?.error || "Connect over Wi-Fi with SSH on to see save files.")));
  if (!s.files.length) return sec("Saves", "save", note("No save files or save states on the handheld."), link);
  const rows = [...s.files].sort((a, b) => b.mtime - a.mtime).map((f) => {
    const parts = f.path.split("/");
    const kind = /(^|\/)state\//.test(f.path) ? (/\.png$/i.test(f.path) ? "State picture" : "Save state") : "Save";
    return `<li>${chip(kind === "Save" ? "ok" : "", kind)}<span class="v-file-meta"><code>${esc(parts[parts.length - 1])}</code><small>${esc(parts.slice(2, -1).join(" / ") || parts[1] || "")} &middot; ${human(f.size)} &middot; ${esc(when(f.mtime))}</small></span></li>`;
  }).join("");
  return sec("Saves", "save", `<ul class="v-files">${rows}</ul>`, link);
}

function relatedPane(groups) {
  V.rel = [];
  if (!groups.length) return note("No related games in your library.");
  return groups.map(([title, items]) => `<section class="v-sec"><h3><span>${title}</span><small>${items.length}</small></h3><div class="v-rel-grid">${items.map(([si, x]) => {
    const i = V.rel.push([si, x]) - 1, s = app.data.systems[si];
    return `<button class="v-rel" data-vrel="${i}" title="${esc(x.t)} (${esc(s.code)}/${esc(x.f)})">
      <span class="v-rel-art">${x.i ? `<img loading="lazy" src="${x.i}" alt="">` : `<span class="ph">${esc(x.t[0] || "?")}</span>`}</span>
      <b>${esc(x.t)}</b><small>${esc(s.code)}${yearOf(x) ? ` &middot; ${yearOf(x)}` : ""}${x.g.length ? ` &middot; ${esc(x.g[0])}` : ""}</small></button>`;
  }).join("")}</div></section>`).join("");
}

// ---------------------------------------------------------------- painting

function fitDesc() {
  const more = $("v-more"), desc = $("v-desc");
  if (!more || !desc) return;
  if (desc.scrollHeight <= desc.clientHeight + 4) { desc.classList.remove("clamp"); more.remove(); }
}

/** Redraws the parts that depend on what changed: "all", "details" or "device". */
function paint(what = "all") {
  if (!V.cur || !$("viewer").open) return;
  const groups = relatedGroups();
  $("v-tags").innerHTML = tagsHtml();
  $("v-cards").innerHTML = cardsHtml();
  $("v-tabs").innerHTML = tabsHtml(groups.reduce((n, [, items]) => n + items.length, 0));
  const panes = { about: ["all"], details: ["all", "details"], handheld: ["all", "device"], related: ["all", "details"] }[V.tab];
  if (!panes.includes(what)) return;
  const pane = $("v-pane");
  pane.innerHTML = V.tab === "about" ? aboutPane() : V.tab === "details" ? detailsPane() : V.tab === "handheld" ? handheldPane() : relatedPane(groups);
  if (V.tab === "about") fitDesc();
}

// ---------------------------------------------------------------- entry points

/** The open game viewer, for the assistant and other panels. */
export function openViewerGame() {
  if (!V.cur || !$("viewer")?.open) return null;
  return { code: V.cur.sys.code, file: V.cur.g.f, title: V.cur.g.t };
}

/** Fills the viewer for the game at app.visible[index]; called by openViewer. */
export function enrichViewer(index) {
  const [si, g] = app.visible[index];
  const sys = app.data.systems[si];
  if (!V.nav) V.back = [];
  V.nav = false;
  V.cur = { index, si, g, sys, m: g.lb ? app.data.meta[g.lb] : null, key: keyOf(sys, g) };
  V.editing = V.video = V.expanded = false;
  $("v-facts").innerHTML = factsHtml(V.cur.m);
  $("v-back").innerHTML = backHtml();
  $("v-back").hidden = !V.back.length;
  const fm = fileManager();
  $("v-reveal-label").textContent = fm ? `Show in ${fm}` : "Open folder";
  V.devSig = `${app.device.target?.id || ""}|${!!app.device.wifi?.reachable}|${canCopy(sys)}|${devName()}`;
  loadDetails();
  loadDevice();
  paint();
  $("v-pane").scrollTop = 0;
}

/** Refreshes the handheld parts of an open viewer when the connection changes. */
export function viewerDeviceChanged() {
  if (!V.cur || !$("viewer").open) return;
  const { sys } = V.cur;
  const sig = `${app.device.target?.id || ""}|${!!app.device.wifi?.reachable}|${canCopy(sys)}|${devName()}`;
  if (sig === V.devSig) return;
  V.devSig = sig;
  $("v-transfer").hidden = !canCopy(sys);
  $("v-transfer-label").textContent = `Transfer to ${devName()}`;
  loadDevice();
  paint("device");
}

function openAt(index) {
  V.nav = true;
  hooks.open(index);
}

function openRelated(i) {
  const [si, x] = V.rel[i] || [];
  if (!x) return;
  V.back.push(V.cur.index);
  let idx = app.visible.findIndex(([, y]) => y === x);
  if (idx < 0) idx = app.visible.push([si, x]) - 1;
  openAt(idx);
}

function goTo(where) {
  if (where === "disc") {
    store.set("emuTab", "checks");
    store.set("checkView", "disc");
    $("viewer").close();
    location.hash = "#emulation";
    return;
  }
  const emu = { cores: "cores", checks: "checks", bios: "bios", saves: "saves" }[where];
  if (emu) store.set("emuTab", emu);
  $("viewer").close();
  location.hash = emu ? "#emulation" : where === "art" ? "#artwork" : `#${where}`;
}

async function fixCore() {
  const code = V.cur.sys.code, c = V.dev.cores, info = coreOf();
  const name = useSystem(code), system = c?.systems?.find((s) => s.name === name);
  if (!system || !info?.folder) return;
  const core = useCore(code, system.cores) || system.defaultCore;
  V.fixing = true;
  paint("device");
  try {
    V.dev.cores = await api("cores/folder", { folder: info.folder.name, system: name, core, keepGames: true });
    toast(`${info.folder.name} now starts with ${system.cores.find((x) => x.key === core)?.name || core}`, 2800);
  } catch (error) {
    toast(error.message, 4000);
  }
  V.fixing = false;
  paint("device");
}

async function saveDescription(remove) {
  const { sys, g, key } = V.cur;
  const text = remove ? "" : $("v-edit-text")?.value || "";
  V.saving = true;
  paint();
  try {
    await api("games/description", { system: sys.code, stem: stemOf(g.f), text });
    V.editing = false;
    await hooks.reload(key);
    toast(remove ? "Using the database description" : "Description saved", 2200);
  } catch (error) {
    toast(error.message, 4000);
  }
  V.saving = false;
  paint();
}

async function replaceArt(file) {
  if (!file || !V.cur) return;
  const { sys, g, key } = V.cur;
  $("v-art-wrap").classList.add("busy");
  try {
    const png = await pngData(file, artMax.get());
    await api("artwork/local/put", { system: sys.code, stem: stemOf(g.f), data: png.data });
    await hooks.reload(key);
    const img = $("v-art").querySelector("img");
    if (img) img.src = `${img.src.split("?")[0]}?v=${Date.now()}`;
    toast("Artwork saved", 2200);
  } catch (error) {
    toast(error.message, 4000);
  }
  $("v-art-wrap").classList.remove("busy");
}

/** open(index) shows a game; reload(key) rescans the library and reopens the game with that key. */
export function bindGameView(h) {
  hooks = h;
  const viewer = $("viewer");
  viewer.addEventListener("close", () => { if (V.video) { V.video = false; if (V.tab === "about") $("v-pane").innerHTML = aboutPane(); } });
  viewer.addEventListener("click", (e) => {
    const t = e.target.closest("[data-vtab], [data-vrel], [data-vgo], [data-vfix], [data-vedit], [data-vvideo], [data-vrefresh], #v-more, #v-back, #v-reveal, #v-art-replace");
    if (!t || t.disabled) return;
    if (t.matches("[data-vfix]")) { e.stopPropagation(); fixCore(); }
    else if (t.matches("[data-vtab]")) { V.tab = t.dataset.vtab; store.set("viewerTab", V.tab); paint(); }
    else if (t.matches("[data-vrel]")) openRelated(+t.dataset.vrel);
    else if (t.matches("[data-vgo]")) goTo(t.dataset.vgo);
    else if (t.matches("[data-vvideo]")) { V.video = true; paint(); }
    else if (t.matches("[data-vrefresh]")) { loadDevice(true); paint("device"); }
    else if (t.id === "v-more") { V.expanded = true; $("v-desc")?.classList.remove("clamp"); t.remove(); }
    else if (t.id === "v-back") { const idx = V.back.pop(); if (idx !== undefined) openAt(idx); }
    else if (t.id === "v-reveal") api("game/reveal", { code: V.cur.sys.code, file: V.cur.g.f }).catch((err) => toast(err.message, 4000));
    else if (t.id === "v-art-replace") pickImage().then(replaceArt);
    else if (t.dataset.vedit === "open") { V.editing = true; V.tab = "about"; paint(); $("v-edit-text")?.focus(); }
    else if (t.dataset.vedit === "cancel") { V.editing = false; paint(); }
    else if (t.dataset.vedit === "save") saveDescription(false);
    else if (t.dataset.vedit === "remove") saveDescription(true);
  });
  viewer.addEventListener("keydown", (e) => {
    const c = e.target.closest?.(".v-card[data-vtab]");
    if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); c.click(); }
  });
  const wrap = $("v-art-wrap");
  wrap.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.type.startsWith("image/"))) { e.preventDefault(); wrap.classList.add("drop"); } });
  wrap.addEventListener("dragleave", () => wrap.classList.remove("drop"));
  wrap.addEventListener("drop", (e) => { e.preventDefault(); wrap.classList.remove("drop"); replaceArt(droppedImage(e)); });
}
