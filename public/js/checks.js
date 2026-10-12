// Library check tab: ROM dumps verified against No-Intro, and duplicate games with a suggested one to keep.

import { $, api, esc, formatDate, human, icon, plural, store, toast } from "./core.js";
import { confirmBox } from "./art-images.js";

const C = { data: null, error: "", loading: false, starting: false, trashing: false, timer: 0, pick: new Set(), seen: new Set(), open: new Set(), art: true, gone: new Set() };
const STATES = {
  bad: ["bad", "alert", "Bad dump", "Doesn't match the good dump No-Intro lists for this game: damaged, overdumped or modified"],
  unknown: ["warn", "info", "Not in No-Intro", "No game with this name or checksum: a homebrew, hack or unlicensed release, or a different naming scheme"],
  unchecked: ["", "info", "Not checked", ""],
  modified: ["", "wrench", "Translation or hack", "Patched games are not in No-Intro; that's expected"],
  ok: ["ok", "check", "Verified", "Matches No-Intro"],
};
const ORDER = ["bad", "unknown", "unchecked", "modified", "ok"];
const view = () => store.get("checkView", "verify");

export function showChecks() {
  load();
  render();
}

export function renderChecks() {
  render();
}

async function load() {
  C.loading = true;
  render();
  try {
    C.data = await api(`checks?prefer=${encodeURIComponent(store.get("dupPrefer", "usa"))}`);
    C.error = "";
    const listed = new Set((C.data.verify?.systems || []).flatMap((s) => s.games.map((g) => g.p)));
    for (const p of C.gone) if (!listed.has(p)) C.gone.delete(p);
    for (const g of C.data.dupes.groups) for (const r of g.games) {
      if (C.seen.has(r.p)) continue;
      C.seen.add(r.p);
      if (!r.keep) C.pick.add(r.p);
    }
  } catch (error) {
    C.error = error.message;
  }
  C.loading = false;
  render();
  clearTimeout(C.timer);
  if (C.data?.run.running) C.timer = setTimeout(() => { if (!$("view-emulation").hidden) load(); }, 900);
}

// ---------------------------------------------------------------- verify

const COUNTED = { ok: "verified", bad: ["bad dump", "bad dumps"], unknown: "not in No-Intro", unchecked: "not checked", modified: ["translation or hack", "translations or hacks"] };

function chip(state, n) {
  const [cls, ico, label] = STATES[state];
  const counted = COUNTED[state], word = Array.isArray(counted) ? counted[n === 1 ? 0 : 1] : counted;
  return `<span class="set-chip ${cls}">${icon(ico)}${n === undefined ? label : `${n.toLocaleString()} ${word}`}</span>`;
}

function gameRow(g) {
  const [, , , hint] = STATES[g.state];
  const name = g.as ? `No-Intro name: <b>${esc(g.as)}</b>` : g.like ? `Compared with <b>${esc(g.like)}</b>. ${esc(g.note || "")}` : esc(g.note || hint);
  return `<div class="chk-game"><div><b title="${esc(g.p)}">${esc(g.f)}</b><small>${name}</small></div>${chip(g.state)}
    <button class="btn icon small ghost chk-del" data-ck="trash-one" data-path="${esc(g.p)}" title="Move to the Trash" aria-label="Move ${esc(g.f)} to the Trash"${C.trashing ? " disabled" : ""}>${icon("trash")}</button></div>`;
}

function systemRow(s) {
  const issues = s.counts.bad + s.counts.unknown + s.counts.unchecked;
  const open = C.open.has(s.code);
  const summary = s.error ? `<span class="set-chip bad">${icon("alert")}List unavailable</span>`
    : `${chip("ok", s.counts.ok)}${["bad", "unknown", "unchecked", "modified"].filter((k) => s.counts[k]).map((k) => chip(k, s.counts[k])).join("")}`;
  const games = s.games.filter((g) => !C.gone.has(g.p)).sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.f.localeCompare(b.f));
  const bad = games.filter((g) => g.state === "bad").length;
  return `<div class="chk-sys${open ? " open" : ""}">
    <button class="chk-sys-head" data-ck="open" data-code="${esc(s.code)}" aria-expanded="${open}"${s.games.length || s.error ? "" : " disabled"}>
      <span class="chk-sys-name"><b>${esc(s.name)}</b><small>${esc(s.code)}${s.dats.length ? ` &middot; ${esc(s.dats.map((d) => d.name).join(", "))}` : ""}</small></span>
      <span class="chk-chips">${summary}</span>
      ${s.games.length || s.error ? icon(open ? "down" : "right") : `<span class="chk-spacer"></span>`}
    </button>
    ${open ? `<div class="chk-games">${s.error ? `<div class="notice err">${esc(s.error)}</div>` : ""}
      ${bad > 1 ? `<div class="chk-bulk"><span class="muted-note">Bad dumps may crash or glitch; keep them if they play fine.</span>
        <button class="btn small danger" data-ck="trash-bad" data-code="${esc(s.code)}"${C.trashing ? " disabled" : ""}>${icon("trash")}<span>Move ${bad} bad dumps to the Trash</span></button></div>` : ""}
      ${s.renamed ? `<p class="muted-note">${plural(s.renamed, "verified game")} ${s.renamed === 1 ? "has" : "have"} a different name in No-Intro; the game is fine, only the file name differs.</p>` : ""}
      ${issues || s.renamed ? games.map(gameRow).join("") : ""}</div>` : ""}
  </div>`;
}

function verifyPanel(d) {
  const r = d.run, v = d.verify;
  const games = d.supported.reduce((n, s) => n + s.games, 0);
  const sum = (k) => (v?.systems || []).reduce((n, s) => n + s.counts[k], 0);
  const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
  const head = `<h2>${icon("hash")}Verify dumps<span class="grow"></span>
    ${v ? `<span class="muted-note">Checked ${esc(formatDate(new Date(v.checked), "long"))}</span>` : ""}
    <button class="btn small${v ? "" : " primary"}" data-ck="verify"${r.running || C.starting || !games ? " disabled" : ""}>${r.running || C.starting ? `<span class="spinner sm"></span><span>Checking&hellip;</span>` : `${icon("check")}<span>${v ? "Check again" : `Check ${plural(games, "game")}`}</span>`}</button></h2>`;
  const intro = `<p class="muted-note">Compares each ROM's checksum with the No-Intro lists in libretro-database. Zip files are read without unpacking;
    nothing is changed. Arcade, disc and engine folders are not covered.</p>`;
  const progress = r.running ? `<div class="chk-progress"><div class="meter"><i style="width:${pct}%"></i></div>
    <small>${r.done.toLocaleString()} of ${r.total.toLocaleString()} &middot; ${esc(r.current || "Downloading the lists")}</small></div>` : "";
  if (!d.supported.length) return `<section class="panel chk-panel">${head}${intro}<div class="notice">None of your ROM folders can be checked against No-Intro.</div></section>`;
  const results = v ? `<div class="chk-summary">${chip("ok", sum("ok"))}${["bad", "unknown", "unchecked", "modified"].filter((k) => sum(k)).map((k) => chip(k, sum(k))).join("")}</div>
    <div class="chk-list">${v.systems.map(systemRow).join("")}
      ${d.supported.filter((s) => !v.systems.some((x) => x.code === s.code)).map((s) => `<div class="chk-sys"><div class="chk-sys-head static"><span class="chk-sys-name"><b>${esc(s.name)}</b><small>${esc(s.code)}</small></span><span class="chk-chips"><span class="set-chip">Not checked yet</span></span><span class="chk-spacer"></span></div></div>`).join("")}</div>`
    : `<div class="chk-empty">${icon("hash")}<div><b>${plural(games, "game")} in ${plural(d.supported.length, "folder")} can be checked</b>
        <small>${esc(d.supported.map((s) => s.name).join(", "))}</small></div></div>`;
  return `<section class="panel chk-panel">${head}${intro}${r.error ? `<div class="notice err">${esc(r.error)}</div>` : ""}${progress}${results}</section>`;
}

// ---------------------------------------------------------------- duplicates

function dupRow(g, r) {
  const picked = C.pick.has(r.p);
  const tags = r.tags.length ? r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("") : "";
  return `<label class="chk-dup${picked ? " picked" : ""}">
    <input type="checkbox" data-ck-pick="${esc(r.p)}"${picked ? " checked" : ""}${C.trashing ? " disabled" : ""}>
    <div><b>${esc(r.f)}</b><small>${human(r.s)}${tags ? ` ${tags}` : ""}</small></div>
    <span class="chk-chips">${r.keep ? `<span class="set-chip ok">${icon("star")}Suggested</span>` : ""}${r.copy ? `<span class="set-chip">${icon("copy")}Identical copy</span>` : ""}${r.state && r.state !== "ok" ? chip(r.state) : r.state === "ok" ? `<span class="set-chip ok">${icon("check")}Verified</span>` : ""}</span>
  </label>`;
}

function dupesPanel(d) {
  const { groups } = d.dupes;
  const pref = store.get("dupPrefer", "usa");
  const picked = groups.flatMap((g) => g.games).filter((r) => C.pick.has(r.p));
  const bytes = picked.reduce((n, r) => n + r.s, 0);
  const allGone = groups.filter((g) => g.games.every((r) => C.pick.has(r.p)));
  const bySystem = new Map();
  for (const g of groups) bySystem.set(g.code, [...(bySystem.get(g.code) || []), g]);
  const head = `<h2>${icon("copy")}Duplicates <small>${groups.length}</small><span class="grow"></span>
    <label class="chk-prefer"><span>Prefer</span><select class="control" data-ck-field="prefer"${C.loading ? " disabled" : ""}>
      ${[["usa", "USA first"], ["europe", "Europe first"], ["japan", "Japan first"]].map(([v, l]) => `<option value="${v}"${v === pref ? " selected" : ""}>${l}</option>`).join("")}
    </select></label></h2>`;
  if (!groups.length) return `<section class="panel chk-panel">${head}<div class="chk-empty">${icon("check")}<div><b>No duplicates</b><small>Every game is in your library once.</small></div></div></section>`;
  return `<section class="panel chk-panel">${head}
    <p class="muted-note">Games that are in a folder more than once: other regions, revisions or file formats. The suggested one is kept by your region,
      then good dumps over betas and prototypes, then the newest revision. Arcade folders are skipped because clones need their parent sets.</p>
    <div class="chk-bar">
      <span>${picked.length ? `<b>${plural(picked.length, "game")}</b> picked, ${human(bytes)}` : "Nothing picked"}</span>
      <button class="link-btn" data-ck="suggest">Pick the suggested</button>
      <button class="link-btn" data-ck="none">Pick none</button>
      <span class="grow"></span>
      <label class="chk-check"><input type="checkbox" data-ck-field="art"${C.art ? " checked" : ""}> With their artwork</label>
      <button class="btn small danger" data-ck="trash"${!picked.length || C.trashing ? " disabled" : ""}>${C.trashing ? `<span class="spinner sm"></span><span>Moving&hellip;</span>` : `${icon("trash")}<span>Move ${picked.length || ""} to the Trash</span>`}</button>
    </div>
    ${allGone.length ? `<div class="notice">Every version of ${allGone.length === 1 ? `<b>${esc(allGone[0].title)}</b>` : plural(allGone.length, "game")} is picked; ${allGone.length === 1 ? "it" : "they"} would be gone from your library.</div>` : ""}
    <div class="chk-list">${[...bySystem].map(([code, list]) => {
      const open = C.open.has(`d:${code}`) !== groups.length <= 12;
      const n = list.reduce((k, g) => k + g.games.filter((r) => C.pick.has(r.p)).length, 0);
      return `<div class="chk-sys${open ? " open" : ""}">
        <button class="chk-sys-head" data-ck="open" data-code="d:${esc(code)}" aria-expanded="${open}">
          <span class="chk-sys-name"><b>${esc(list[0].system)}</b><small>${plural(list.length, "game")} with several versions</small></span>
          <span class="chk-chips">${n ? `<span class="set-chip warn">${icon("trash")}${n} picked</span>` : ""}</span>${icon(open ? "down" : "right")}
        </button>
        ${open ? `<div class="chk-games">${list.map((g) => `<div class="chk-group"><h4>${esc(g.title)}</h4>${g.games.map((r) => dupRow(g, r)).join("")}</div>`).join("")}</div>` : ""}
      </div>`;
    }).join("")}</div>
  </section>`;
}

// ---------------------------------------------------------------- rendering

function render() {
  const root = $("emu-body");
  if (!root || $("view-emulation").hidden || !$("emu-tabs").querySelector('[data-tab="checks"].on')) return;
  $("emu-actions").innerHTML = `<button class="btn" data-ck="refresh" title="Read the library again"${C.loading ? " disabled" : ""}>${icon("refresh")}<span>Refresh</span></button>`;
  const d = C.data;
  if (!d) {
    root.innerHTML = C.error ? `<div class="notice err">${esc(C.error)}</div>` : `<div class="planning"><span class="spinner"></span> Reading the library&hellip;</div>`;
    return;
  }
  const v = view();
  const issues = (d.verify?.systems || []).reduce((n, s) => n + s.counts.bad, 0);
  root.innerHTML = `<div class="segmented chk-switch" role="group" aria-label="Check">
      <button data-ck="view" data-view="verify" class="${v === "verify" ? "on" : ""}">${icon("hash")}<span>Verify dumps</span>${issues ? `<small>${issues}</small>` : ""}</button>
      <button data-ck="view" data-view="dupes" class="${v === "dupes" ? "on" : ""}">${icon("copy")}<span>Duplicates</span>${d.dupes.groups.length ? `<small>${d.dupes.groups.length}</small>` : ""}</button>
    </div>
    ${C.error ? `<div class="notice err">${esc(C.error)}</div>` : ""}
    ${v === "dupes" ? dupesPanel(d) : verifyPanel(d)}`;
}

async function startVerify() {
  C.starting = true;
  render();
  try {
    await api("checks/verify", {});
  } catch (error) {
    toast(error.message, 4000);
  }
  C.starting = false;
  load();
}

async function trash() {
  const groups = C.data.dupes.groups;
  const picked = groups.flatMap((g) => g.games).filter((r) => C.pick.has(r.p));
  if (!picked.length) return;
  const bytes = picked.reduce((n, r) => n + r.s, 0);
  const allGone = groups.filter((g) => g.games.every((r) => C.pick.has(r.p)));
  const list = picked.slice(0, 8).map((r) => `<li>${esc(r.p.replace(/^Roms\//, ""))}</li>`).join("") + (picked.length > 8 ? `<li>and ${picked.length - 8} more</li>` : "");
  const ok = await confirmBox({
    title: `Move ${plural(picked.length, "game")} to the Trash?`,
    html: `<p>${human(bytes)} from your Roms/ library${C.art ? `, with ${picked.length === 1 ? "its" : "their"} artwork` : ""}. You can put them back from the Trash.</p><ul class="chk-confirm">${list}</ul>
      ${allGone.length ? `<p class="notice">Every version of ${plural(allGone.length, "game")} is picked.</p>` : ""}`,
    ok: "Move to the Trash",
    danger: true,
  });
  if (!ok) return;
  await moveToTrash(picked.map((r) => r.p), C.art);
}

/** Verify rows: one game, or every bad dump in a folder. */
async function trashChecked(rows) {
  const one = rows.length === 1, them = one ? "it" : "them";
  const list = rows.slice(0, 8).map((g) => `<li>${esc(g.p.replace(/^Roms\//, ""))}</li>`).join("") + (rows.length > 8 ? `<li>and ${rows.length - 8} more</li>` : "");
  const ok = await confirmBox({
    title: one ? "Move this game to the Trash?" : `Move ${rows.length} bad dumps to the Trash?`,
    html: `<p>From your Roms/ library on this computer. You can put ${them} back from the Trash; the handheld is not touched.</p><ul class="chk-confirm">${list}</ul>
      <label class="chk-check"><input type="checkbox" id="ck-art"${C.art ? " checked" : ""}> Also move ${one ? "its" : "their"} artwork</label>`,
    ok: "Move to the Trash",
    danger: true,
  });
  if (!ok) return;
  C.art = $("ck-art")?.checked ?? C.art;
  await moveToTrash(rows.map((g) => g.p), C.art);
}

async function moveToTrash(paths, art) {
  C.trashing = true;
  render();
  try {
    const res = await api("checks/trash", { paths, art });
    for (const p of paths) {
      C.pick.delete(p);
      if (!res.failed.some((f) => f.startsWith(`${p}: `))) C.gone.add(p);
    }
    toast(res.failed.length ? `${res.trashed} moved, ${res.failed.length} failed: ${res.failed[0]}` : `${plural(res.trashed, "game")} moved to the Trash (${human(res.size)})`, 4000);
  } catch (error) {
    toast(error.message, 4000);
  }
  C.trashing = false;
  setTimeout(load, 1500);
  render();
}

export function bindChecks(viewEl) {
  viewEl.addEventListener("click", (e) => {
    const el = e.target.closest("[data-ck]");
    if (!el || el.disabled) return;
    const { ck, code } = el.dataset;
    if (ck === "refresh") load();
    else if (ck === "view") { store.set("checkView", el.dataset.view); render(); }
    else if (ck === "verify") startVerify();
    else if (ck === "open") { C.open.has(code) ? C.open.delete(code) : C.open.add(code); render(); }
    else if (ck === "suggest") { C.pick = new Set(C.data.dupes.groups.flatMap((g) => g.games).filter((r) => !r.keep).map((r) => r.p)); render(); }
    else if (ck === "none") { C.pick.clear(); render(); }
    else if (ck === "trash") trash();
    else if (ck === "trash-one" || ck === "trash-bad") {
      const systems = (C.data?.verify?.systems || []).filter((s) => ck === "trash-one" || s.code === code);
      const games = systems.flatMap((s) => s.games).filter((g) => !C.gone.has(g.p));
      const rows = ck === "trash-one" ? games.filter((g) => g.p === el.dataset.path) : games.filter((g) => g.state === "bad");
      if (rows.length) trashChecked(rows);
    }
  });
  viewEl.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset?.ckPick) { t.checked ? C.pick.add(t.dataset.ckPick) : C.pick.delete(t.dataset.ckPick); render(); }
    else if (t.dataset?.ckField === "art") C.art = t.checked;
    else if (t.dataset?.ckField === "prefer") {
      store.set("dupPrefer", t.value);
      C.pick.clear();
      C.seen.clear();
      load();
    }
  });
}
