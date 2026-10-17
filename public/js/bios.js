// BIOS tab: the BIOS files the handheld's emulators know, checked by MD5 in the bios folder and on the handheld.

import { $, api, esc, formatDate, icon, plural, toast, TOKEN } from "./core.js";
import { confirmBox } from "./art-images.js";

const B = { data: null, error: "", loading: false, sending: "", fixing: false, deleting: "", open: new Set(), others: false, adding: 0, wifi: undefined };

export function showBios() {
  load();
  render();
}

export function renderBios(wifi) {
  if (B.wifi !== undefined && wifi !== B.wifi && !B.loading) load();
  B.wifi = wifi;
  render();
}

async function load(refresh = false) {
  B.loading = true;
  render();
  try {
    B.data = await api(`bios${refresh ? "?refresh=1" : ""}`);
    B.error = "";
  } catch (error) {
    B.error = error.message;
  }
  B.loading = false;
  render();
}

// ---------------------------------------------------------------- helpers

const live = () => !!B.data?.device.reachable && !B.data.device.error;
const sendable = (f) => live() && f.local.state === "ok" && f.device?.state !== "ok";
const label = (f) => {
  const m = /^\S+\s+\((.+)\)$/.exec(f.desc);
  return m ? m[1] : f.desc.replace(f.path, "").replace(/^[\s|]+/, "");
};

/** One-line what-this-is for common dumps; falls back to the catalogue note. */
const BLURBS = {
  "scph5500.bin": "Official PlayStation BIOS for Japanese (NTSC-J) consoles.",
  "scph5501.bin": "Official PlayStation BIOS for US (NTSC-U) consoles; the usual pick for US games.",
  "scph5502.bin": "Official PlayStation BIOS for European (PAL) consoles.",
  "psxonpsp660.bin": "PSP's built-in PlayStation emulator BIOS; some cores accept this instead of a console dump.",
  "scph1001.bin": "Earlier US PlayStation BIOS (SCPH-1001); works with many US games.",
  "scph101.bin": "Later US PlayStation BIOS revision used by some cores as an alternative.",
  "scph7001.bin": "PS one (slim) US BIOS; an alternative dump some cores list.",
  "ps1_rom.bin": "PlayStation BIOS extracted from a PS3; an alternative some cores can use.",
};

function blurb(f) {
  if (BLURBS[f.key]) return BLURBS[f.key];
  const short = label(f);
  if (short && !/^bios$/i.test(short)) return `${short} for this system's emulator cores.`;
  return f.main ? "BIOS dump this system's default core expects." : "Optional BIOS some cores for this system can also use.";
}

function hashLine(f) {
  const list = f.md5s || [];
  if (!list.length) return "No known MD5; any file with this name counts.";
  if (list.length === 1) return `MD5 ${list[0]}`;
  return `MD5 ${list[0]} (+${list.length - 1} other known)`;
}

function allSendable() {
  const seen = new Map();
  for (const s of B.data?.systems || []) for (const f of s.files) if (sendable(f)) seen.set(f.key, f);
  return [...seen.values()];
}

/** Recognised BIOS files stored under the wrong name or casing (e.g. SCPH5501.BIN). */
function misnamed() {
  const seen = new Map();
  for (const s of B.data?.systems || []) for (const f of s.files) {
    if (f.local.state === "ok" && f.local.source && f.local.source.toLowerCase() !== f.key) seen.set(f.key, f);
  }
  return [...seen.values()];
}

function summary(s) {
  const main = s.files.filter((f) => f.main);
  if (!live()) {
    const here = main.filter((f) => f.local.state === "ok").length;
    return main.length ? [here ? "ok" : "", `${here} of ${main.length} in the bios folder`] : ["", "No required BIOS"];
  }
  const on = main.filter((f) => f.device.state === "ok").length;
  if (s.needsBios && !on) return ["bad", `${s.defaultCore} needs a BIOS`];
  if (!main.length) return ["", "No required BIOS"];
  return [on ? "ok" : "", `${on} of ${main.length} on the handheld`];
}

// ---------------------------------------------------------------- rendering

function render() {
  const root = $("emu-body");
  if (!root || $("view-emulation").hidden || !$("emu-tabs").querySelector('[data-tab="bios"].on')) return;
  const d = B.data, todo = allSendable(), rename = misnamed();
  $("emu-actions").innerHTML = `
    <button class="btn" data-bi="refresh" title="Check the bios folder and the handheld again"${B.loading || B.fixing ? " disabled" : ""}>${icon("refresh")}<span>Refresh</span></button>
    <button class="btn" data-bi="reveal" title="Open the workspace bios folder">${icon("external")}<span>Show folder</span></button>
    <button class="btn${todo.length || rename.length ? "" : " primary"}" data-bi="add">${icon("plus")}<span>${B.adding ? `Adding ${B.adding}&hellip;` : "Add BIOS files&hellip;"}</span></button>
    ${rename.length ? `<button class="btn primary" data-bi="fix-names"${B.fixing || B.sending ? " disabled" : ""} title="Rename recognised BIOS files to the names the emulators look for (lowercase)">${B.fixing ? `<span class="spinner sm"></span><span>Fixing&hellip;</span>` : `${icon("wrench")}<span>Fix ${rename.length === 1 ? "name" : `${rename.length} names`}</span>`}</button>` : ""}
    ${todo.length ? `<button class="btn${rename.length ? "" : " primary"}" data-bi="send-all"${B.sending || B.fixing ? " disabled" : ""}>${B.sending === "*" ? `<span class="spinner sm"></span><span>Sending&hellip;</span>` : `${icon("upload")}<span>Send ${todo.length} to the handheld</span>`}</button>` : ""}`;
  if (!d) {
    root.innerHTML = B.error ? `<div class="notice err">${esc(B.error)}</div>` : `<div class="planning"><span class="spinner"></span> Checking the bios folder and the handheld&hellip;</div>`;
    return;
  }
  $("emu-sub").innerHTML = `BIOS files in <code title="${esc(d.folder)}">${esc(d.folder)}</code>, checked by MD5 against MustardOS's lists &middot; change the folder in Settings`;
  if (!d.catalog) {
    root.innerHTML = `<section class="panel"><h2>${icon("shield")}BIOS</h2>
      ${d.catalogError ? `<div class="notice err">${esc(d.catalogError)}</div>` : ""}
      <div class="notice">The list of BIOS files comes from MustardOS on the handheld. Connect it over Wi-Fi with SSH on once
        (<b>Configuration &rsaquo; Web Services &rsaquo; Secure Shell</b>, then the <a href="#ssh">SSH</a> section); after that the check also works offline.</div></section>`;
    return;
  }
  const weight = (s) => (s.files.some((f) => f.main) ? 0 : 1);
  const mine = d.systems.filter((s) => s.folders.length).sort((a, b) => weight(a) - weight(b)), rest = d.systems.filter((s) => !s.folders.length);
  const renameNote = rename.length ? `<div class="notice">${icon("alert")}<span><b>${plural(rename.length, "BIOS file")} ${rename.length === 1 ? "is" : "are"} named wrong.</b>
    Emulators expect lowercase names such as <code>scph5501.bin</code>. Use <b>Fix names</b> to rename ${rename.length === 1 ? "it" : "them"} in the bios folder
    (a common cause of a black screen on PlayStation games).</span></div>` : "";
  const needHere = (d.systems || []).some((s) => s.files.some((f) => f.main && f.local.state !== "ok"));
  const emptyNote = needHere && !(d.systems || []).some((s) => s.files.some((f) => f.local.state === "ok")) && !d.extra.length
    ? `<div class="notice">${icon("info")}<span>Put BIOS files in the workspace <code>bios</code> folder (<b>Show folder</b>), or use <b>Add BIOS files&hellip;</b>.
      Recognised files show as found here; then <b>Send</b> copies them to the handheld.</span></div>` : "";
  root.innerHTML = `${statusPanel()}${renameNote}${emptyNote}
    <section class="panel bios-panel"><h2>${icon("handheld")}Your systems <small>${mine.length}</small></h2>
      ${mine.length ? mine.map(system).join("") : `<p class="muted-note">None of your game folders use a system with BIOS files.</p>`}
    </section>
    ${rest.length ? `<section class="panel bios-panel"><h2>${icon("layers")}Other systems <small>${rest.length}</small><span class="grow"></span>
      <button class="link-btn" data-bi="others">${B.others ? "Hide" : "Show"}</button></h2>
      ${B.others ? rest.map(system).join("") : `<p class="muted-note">Systems the handheld can run that have no games in your library: ${esc(rest.map((s) => s.name).join(", "))}.</p>`}</section>` : ""}
    ${d.extra.length ? `<section class="panel bios-panel"><h2>${icon("info")}Not recognised <small>${d.extra.length}</small></h2>
      <p class="muted-note">These files in the bios folder do not match any BIOS MustardOS knows. They are not sent.</p>
      <div class="dev-chips">${d.extra.map((f) => `<span class="set-chip" title="${esc(f.path)}">${esc(f.path)}</span>`).join("")}</div></section>` : ""}`;
}

function statusPanel() {
  const d = B.data;
  const dev = d.device.error ? `<span class="app-bad">${esc(d.device.error)}</span>`
    : d.device.reachable ? `Compared with <b>${esc(d.device.host)}</b>`
    : `Connect the handheld over Wi-Fi with SSH on to compare and send (<a href="#ssh">SSH</a>)`;
  return `<p class="muted-note bios-status">${icon(d.device.reachable && !d.device.error ? "check" : "info")}<span>${dev} &middot;
    list of ${plural(d.catalog.files, "file")} from MustardOS ${esc(d.catalog.version || "")}, read ${esc(formatDate(new Date(d.catalog.fetched), "long"))}
    ${d.catalogError ? ` &middot; <span class="app-bad">${esc(d.catalogError)}</span>` : ""}</span></p>`;
}

function system(s) {
  const [tone, text] = summary(s);
  const open = B.open.has(s.name);
  const main = s.files.filter((f) => f.main), other = s.files.filter((f) => !f.main);
  const shown = open ? s.files : main;
  const deviceFolder = B.data?.deviceFolder || "/run/muos/storage/bios";
  return `<div class="bios-sys">
    <div class="bios-head">
      <div><b>${esc(s.name)}</b><small>${s.folders.length ? `${esc(s.folders.join(", "))} &middot; ` : ""}runs with ${esc(s.defaultCore)}
        &middot; on the handheld: <code title="MustardOS BIOS folder for every system">${esc(deviceFolder)}</code></small></div>
      <span class="set-chip${tone === "ok" ? " ok" : tone === "bad" ? " warn" : ""}">${tone === "ok" ? icon("check") : tone === "bad" ? icon("alert") : ""}${esc(text)}</span>
    </div>
    ${shown.length ? `<div class="bios-files">${shown.map(file).join("")}</div>` : ""}
    ${other.length ? `<button class="link-btn bios-more" data-bi="more" data-name="${esc(s.name)}">${open ? "Hide the optional files" : `${plural(other.length, "optional file")} the cores can also use`}</button>` : ""}
  </div>`;
}

function file(f) {
  const loc = f.local.state === "ok"
    ? `<span class="set-chip ok" title="${esc(f.local.source)}">${icon("check")}${f.local.source.toLowerCase() === f.key ? "In the bios folder" : `In the bios folder as ${esc(f.local.source)}`}</span>`
    : f.local.state === "unknown" ? `<span class="set-chip warn" title="Its MD5 matches none of the ${f.hashes} known good copies; it may not work">Unrecognised copy</span>`
    : `<span class="set-chip">Not in the bios folder</span>`;
  const md5Chip = f.local.state === "ok" && f.hashes
    ? `<span class="set-chip ok" title="${esc((f.md5s || []).join(", "))}">${icon("check")}MD5 matches</span>`
    : f.local.state === "unknown" && f.hashes
    ? `<span class="set-chip warn" title="Expected ${esc((f.md5s || []).join(" or "))}">MD5 mismatch</span>`
    : "";
  const dev = !f.device ? ""
    : f.device.state === "ok" ? `<span class="set-chip ok">${icon("check")}On the handheld</span>`
    : f.device.state === "unknown" ? `<span class="set-chip warn" title="Its MD5 matches none of the known good copies">Different copy on the handheld</span>`
    : `<span class="set-chip">Not on the handheld</span>`;
  const send = sendable(f)
    ? `<button class="btn small" data-bi="send" data-key="${esc(f.key)}"${B.sending || B.deleting ? " disabled" : ""}>${B.sending === f.key ? `<span class="spinner sm"></span><span>Sending&hellip;</span>` : `${icon("upload")}<span>Send</span>`}</button>` : "";
  const here = f.local.state === "ok" || f.local.state === "unknown";
  const onDevice = f.device?.state === "ok" || f.device?.state === "unknown";
  const del = here || onDevice
    ? `<button class="btn icon small ghost" data-bi="delete" data-key="${esc(f.key)}" title="Remove this BIOS file" aria-label="Remove ${esc(f.path)}"${B.sending || B.deleting ? " disabled" : ""}>${B.deleting === f.key ? `<span class="spinner sm"></span>` : icon("trash")}</button>`
    : "";
  return `<div class="bios-file${f.main ? "" : " opt"}">
    <div class="bios-name">
      <b title="${esc(f.path)}">${esc(f.path)}</b>
      <small class="bios-blurb">${esc(blurb(f))}</small>
      <small class="bios-hash" title="${esc((f.md5s || []).join("\n"))}">${esc(hashLine(f))}</small>
    </div>
    <div class="dev-chips">${loc}${md5Chip}${dev}</div>${send}${del}
  </div>`;
}

// ---------------------------------------------------------------- actions

async function fixNames() {
  const list = misnamed();
  if (!list.length) return;
  const ok = await confirmBox({
    title: list.length === 1 ? `Rename to ${list[0].path}?` : `Fix ${list.length} BIOS names?`,
    html: `<p>Recognised files in the bios folder are renamed to the names MustardOS and RetroArch look for
      (for example <code>SCPH5501.BIN</code> becomes <code>scph5501.bin</code>). Wrong names often cause a black screen on PlayStation games.</p>
      <ul>${list.slice(0, 12).map((f) => `<li><code>${esc(f.local.source)}</code> &rarr; <code>${esc(f.path)}</code></li>`).join("")}
        ${list.length > 12 ? `<li>&hellip;and ${list.length - 12} more</li>` : ""}</ul>`,
    ok: "Fix names",
  });
  if (!ok) return;
  B.fixing = true;
  render();
  try {
    const r = await api("bios/fix-names", {});
    B.data = r;
    toast(r.fixed?.length ? `Renamed ${plural(r.fixed.length, "BIOS file")}` : "Nothing needed renaming", 2800);
    if (r.skipped?.length) toast(`${plural(r.skipped.length, "file")} skipped: ${r.skipped[0].why}`, 4000);
  } catch (error) {
    toast(error.message, 4000);
  }
  B.fixing = false;
  render();
}

async function send(keys) {
  const files = allSendable().filter((f) => keys.includes(f.key));
  const replacing = files.filter((f) => f.device?.state === "unknown");
  if (keys.length > 1 || replacing.length) {
    const ok = await confirmBox({
      title: files.length === 1 ? `Send ${files[0].path}?` : `Send ${files.length} BIOS files?`,
      html: `<p>They are copied to the BIOS folder on the handheld and checked there.</p>
        ${replacing.length ? `<p>${esc(replacing.map((f) => f.path).join(", "))} ${replacing.length === 1 ? "replaces the copy" : "replace the copies"} on the handheld.</p>` : ""}
        ${files.length > 1 && files.length <= 10 ? `<ul>${files.map((f) => `<li>${esc(f.path)}</li>`).join("")}</ul>` : ""}`,
      ok: "Send",
    });
    if (!ok) return;
  }
  B.sending = keys.length > 1 ? "*" : keys[0];
  render();
  try {
    const r = await api("bios/send", { keys });
    B.data = r;
    toast(`Sent ${plural(r.sent, "BIOS file")}`, 2400);
  } catch (error) {
    toast(error.message, 4000);
  }
  B.sending = "";
  render();
}

async function removeBios(key) {
  const f = (B.data?.systems || []).flatMap((s) => s.files).find((x) => x.key === key);
  if (!f) return;
  const here = f.local.state === "ok" || f.local.state === "unknown";
  const onDevice = f.device?.state === "ok" || f.device?.state === "unknown";
  if (!here && !onDevice) return;
  const ok = await confirmBox({
    title: `Remove ${f.path}?`,
    html: `<p>Choose where to remove it. The bios folder copy goes to the Trash on this computer; deleting on the handheld is permanent.</p>
      ${here ? `<label class="chk-check"><input type="checkbox" id="bi-del-local" checked> Move from the bios folder to the Trash${f.local.source && f.local.source.toLowerCase() !== f.key ? ` (<code>${esc(f.local.source)}</code>)` : ""}</label>` : ""}
      ${onDevice ? `<label class="chk-check"><input type="checkbox" id="bi-del-device"${here ? "" : " checked"}> Delete from the handheld</label>` : !live() && here ? `<p class="muted-note">Connect over Wi-Fi with SSH on to delete a copy on the handheld.</p>` : ""}`,
    ok: "Remove",
    danger: true,
  });
  if (!ok) return;
  const local = here && ($("bi-del-local")?.checked ?? true);
  const device = onDevice && ($("bi-del-device")?.checked ?? !here);
  if (!local && !device) {
    toast("Nothing was selected to remove", 2500);
    return;
  }
  B.deleting = key;
  render();
  try {
    const r = await api("bios/delete", { key, local, device });
    B.data = r;
    const bits = [r.trashed && "Moved to the Trash", r.removedDevice && "Deleted on the handheld"].filter(Boolean);
    toast(bits.join(". ") || "Removed", 2800);
  } catch (error) {
    toast(error.message, 4000);
  }
  B.deleting = "";
  render();
}

async function addFiles(list) {
  const files = [...list];
  if (!files.length) return;
  const known = [], unknown = [];
  for (const f of files) {
    B.adding = files.length - known.length - unknown.length;
    render();
    try {
      const res = await fetch(`/api/bios/upload?name=${encodeURIComponent(f.name)}`, {
        method: "PUT", body: f, headers: { "X-Manager-Token": TOKEN, "Content-Type": "application/octet-stream" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Adding ${f.name} failed (${res.status})`);
      (body.known ? known : unknown).push(body);
    } catch (error) {
      toast(error.message, 3500);
    }
  }
  B.adding = 0;
  if (known.length || unknown.length) {
    const named = known.filter((k) => k.placed !== k.name).map((k) => `${k.name} as ${k.placed}`);
    toast([known.length && `Added ${plural(known.length, "BIOS file")}${named.length ? ` (${named.join(", ")})` : ""}`,
      unknown.length && `${plural(unknown.length, "file")} not recognised`].filter(Boolean).join(". "), 4000);
  }
  load();
}

export function bindBios(view) {
  view.addEventListener("click", (e) => {
    const el = e.target.closest("[data-bi]");
    if (!el || el.disabled) return;
    const { bi, key, name } = el.dataset;
    if (bi === "refresh") load(true);
    else if (bi === "reveal") api("settings/reveal", { which: "bios" }).catch((error) => toast(error.message, 3000));
    else if (bi === "add") $("bios-files").click();
    else if (bi === "fix-names") fixNames();
    else if (bi === "send") send([key]);
    else if (bi === "send-all") send(allSendable().map((f) => f.key));
    else if (bi === "delete") removeBios(key);
    else if (bi === "others") { B.others = !B.others; render(); }
    else if (bi === "more") { if (B.open.has(name)) B.open.delete(name); else B.open.add(name); render(); }
  });
  $("bios-files").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
  let depth = 0;
  const active = (e) => [...(e.dataTransfer?.types || [])].includes("Files") && !!$("emu-tabs").querySelector('[data-tab="bios"].on');
  view.addEventListener("dragenter", (e) => { if (!active(e)) return; e.preventDefault(); depth++; view.classList.add("bios-drop"); });
  view.addEventListener("dragover", (e) => { if (active(e)) e.preventDefault(); });
  view.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; view.classList.remove("bios-drop"); } });
  view.addEventListener("drop", (e) => {
    if (!active(e)) return;
    e.preventDefault();
    depth = 0;
    view.classList.remove("bios-drop");
    addFiles(e.dataTransfer.files);
  });
}
