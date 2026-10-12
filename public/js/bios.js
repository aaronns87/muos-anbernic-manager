// BIOS tab: the BIOS files the handheld's emulators know, checked by MD5 in the bios folder and on the handheld.

import { $, api, esc, formatDate, icon, plural, toast, TOKEN } from "./core.js";
import { confirmBox } from "./art-images.js";

const B = { data: null, error: "", loading: false, sending: "", open: new Set(), others: false, adding: 0, wifi: undefined };

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

function allSendable() {
  const seen = new Map();
  for (const s of B.data?.systems || []) for (const f of s.files) if (sendable(f)) seen.set(f.key, f);
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
  const d = B.data, todo = allSendable();
  $("emu-actions").innerHTML = `
    <button class="btn" data-bi="refresh" title="Check the bios folder and the handheld again"${B.loading ? " disabled" : ""}>${icon("refresh")}<span>Refresh</span></button>
    ${d?.available ? `<button class="btn" data-bi="reveal">${icon("external")}<span>Show folder</span></button>` : ""}
    <button class="btn${todo.length ? "" : " primary"}" data-bi="add">${icon("plus")}<span>${B.adding ? `Adding ${B.adding}&hellip;` : "Add BIOS files&hellip;"}</span></button>
    ${todo.length ? `<button class="btn primary" data-bi="send-all"${B.sending ? " disabled" : ""}>${B.sending === "*" ? `<span class="spinner sm"></span><span>Sending&hellip;</span>` : `${icon("upload")}<span>Send ${todo.length} to the handheld</span>`}</button>` : ""}`;
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
  root.innerHTML = `${statusPanel()}
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
  return `<div class="bios-sys">
    <div class="bios-head">
      <div><b>${esc(s.name)}</b><small>${s.folders.length ? `${esc(s.folders.join(", "))} &middot; ` : ""}runs with ${esc(s.defaultCore)}</small></div>
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
  const dev = !f.device ? ""
    : f.device.state === "ok" ? `<span class="set-chip ok">${icon("check")}On the handheld</span>`
    : f.device.state === "unknown" ? `<span class="set-chip warn" title="Its MD5 matches none of the known good copies">Different copy on the handheld</span>`
    : `<span class="set-chip">Not on the handheld</span>`;
  const send = sendable(f)
    ? `<button class="btn small" data-bi="send" data-key="${esc(f.key)}"${B.sending ? " disabled" : ""}>${B.sending === f.key ? `<span class="spinner sm"></span><span>Sending&hellip;</span>` : `${icon("upload")}<span>Send</span>`}</button>` : "";
  return `<div class="bios-file${f.main ? "" : " opt"}">
    <div class="bios-name"><b title="${esc(f.path)}">${esc(f.path)}</b><small>${esc(label(f) || (f.main ? "BIOS" : "Optional"))}${f.hashes ? "" : " &middot; no known MD5, any copy counts"}</small></div>
    <div class="dev-chips">${loc}${dev}</div>${send}
  </div>`;
}

// ---------------------------------------------------------------- actions

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
    else if (bi === "send") send([key]);
    else if (bi === "send-all") send(allSendable().map((f) => f.key));
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
