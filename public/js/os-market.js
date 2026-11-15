// OS market: MustardOS catalogue releases for the selected handheld. Download opens GoFile/Mega/Filen;
// after that, Add image imports the finished file into os/.

import { $, api, esc, formatDate, icon, ICONS, model, plural } from "./core.js";
import { startAddImage } from "./os.js";

const M = {
  data: null,
  loading: false,
  error: "",
  device: "",
  helper: "",
  expanded: "",
  bound: false,
};

const HOST_ORDER = ["gofile", "mega", "filen"];
const hostLabel = (k) => ({ gofile: "GoFile", mega: "Mega", filen: "Filen", torrent: "Torrent", archive: "Archive", github: "GitHub" }[String(k).toLowerCase()] || k);
const deviceId = () => model()?.id || "";
const deviceLabel = () => {
  const d = model();
  return d ? `${d.maker} ${String(d.name || "").replace(/^TrimUI /, "")}` : "Handheld";
};

function hostButtons(links, preferred = false) {
  const entries = Object.entries(links || {}).filter(([, url]) => /^https?:/i.test(url));
  entries.sort((a, b) => {
    const ia = HOST_ORDER.indexOf(a[0].toLowerCase());
    const ib = HOST_ORDER.indexOf(b[0].toLowerCase());
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
  });
  return entries.map(([k, url], i) =>
    `<a class="btn small${preferred && i === 0 ? " primary" : ""}" data-om="open" href="${esc(url)}" target="_blank" rel="noopener">${icon("external")}<span>${esc(hostLabel(k))}</span></a>`).join("");
}

async function load(refresh = false) {
  if (M.loading) return;
  M.loading = true;
  M.error = "";
  renderOsMarket();
  try {
    const id = deviceId();
    M.device = id;
    M.data = await api(`os/market?device=${encodeURIComponent(id)}${refresh ? "&refresh=1" : ""}`);
  } catch (error) {
    M.error = error.message;
  }
  M.loading = false;
  renderOsMarket();
}

export function openOsMarket() {
  if (!M.bound) bind();
  if ((!M.data || M.device !== deviceId()) && !M.loading) load();
  renderOsMarket();
  if (!$("osmarket").open) $("osmarket").showModal();
}

export function renderOsMarket() {
  if (!M.bound) return;
  const main = $("om-main"), foot = $("om-foot");
  const name = M.data?.deviceName || deviceLabel();
  foot.innerHTML = `<div class="ag-foot-sum"><span>${icon("handheld")} ${esc(name)}</span></div>
    <button class="btn" data-om="refresh"${M.loading ? " disabled" : ""} title="Check mustardos.github.io again">${M.loading ? ICONS.spin : icon("refresh")}<span>Refresh</span></button>
    <button class="btn" data-om="close">Close</button>`;

  if (M.error && !M.data) {
    main.innerHTML = `<div class="notice err">${esc(M.error)}</div>`;
    return;
  }
  if (!M.data) {
    main.innerHTML = `<div class="planning"><span class="spinner"></span> Checking MustardOS releases&hellip;</div>`;
    return;
  }

  const keep = main.querySelector(".pm-scroll")?.scrollTop || 0;
  const list = M.data.releases || [];
  const helper = M.helper
    ? `<div class="os-market-help notice">
        <div><b>Download started in your browser.</b>
          <p class="muted-note" style="margin:4px 0 0">When the <code>.img</code> / <code>.img.gz</code> (and its hash file) finishes on GoFile, Mega or Filen,
          use <b>Add image</b> so the manager stores it under <code>os/mustardos_&lt;version&gt;/</code>.</p></div>
        <div class="panel-actions"><button class="btn primary" data-om="add">${icon("plus")}<span>Add image&hellip;</span></button>
          <button class="btn ghost" data-om="dismiss-help">Dismiss</button></div>
      </div>`
    : "";

  const cards = list.map((r) => {
    const links = r.deviceMatch && Object.keys(r.deviceLinks || {}).length ? r.deviceLinks : r.links;
    const open = M.expanded === r.ver;
    const badges = [
      r.type === "current" ? `<span class="th-badge ok">Current</span>` : "",
      r.type === "progress" ? `<span class="th-badge warn">In progress</span>` : "",
      r.local ? `<span class="th-badge ok">In OS folder</span>` : "",
      r.deviceMatch ? `<span class="th-badge">For this handheld</span>` : "",
    ].join("");
    const notes = [
      ...(r.important ? [r.important] : []),
      ...(r.notes || []).slice(0, 3),
      ...(r.changes || []).slice(0, 4),
    ];
    return `<article class="th-card pm-card os-market-card${r.local ? " have" : ""}">
      <div class="os-market-shot th-shot th-none">${icon("sd")}</div>
      <div class="th-meta">
        <b>MustardOS ${esc(r.ver)}${r.code ? ` · ${esc(r.code)}` : ""}</b>
        <small class="am-desc">${r.deviceMatch && r.deviceImage
          ? esc(r.deviceImage.name)
          : r.deviceMatch ? "Official image for this handheld"
            : "Open the release folder and pick this handheld's image"}</small>
        <span>${badges}</span>
      </div>
      <div class="th-acts">
        ${hostButtons(links, !!r.deviceMatch) || `<span class="muted-note">No download links</span>`}
        <button class="btn small ghost" data-om="notes" data-ver="${esc(r.ver)}">${open ? "Hide notes" : "Notes"}</button>
      </div>
      ${open && notes.length ? `<div class="os-market-notes"><ul class="os-note-list">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
    </article>`;
  }).join("");

  main.innerHTML = `<div class="pm-scroll">
    ${M.data.error ? `<div class="notice">${esc(M.data.error)}</div>` : ""}
    ${helper}
    <div class="th-bar">
      <span class="muted-note">${list.length ? plural(list.length, "release") : "No releases"} for ${esc(name)}.
        Downloads open GoFile, Mega or Filen — the manager does not fetch multi‑gigabyte images itself.</span>
    </div>
    ${list.length
      ? `<div class="th-grid pm-grid">${cards}</div>`
      : `<div class="empty-state">${icon("sd")}<b>No catalogue releases</b><p>Refresh to check mustardos.github.io, or Add image if you already have a file.</p>
          <div class="panel-actions"><button class="btn primary" data-om="add">${icon("plus")}<span>Add image&hellip;</span></button></div></div>`}
    <p class="muted-note">${M.data.checked ? `Checked ${esc(formatDate(new Date(M.data.checked), "long"))}.` : ""}
      Prefer the host marked for this handheld when the current release matches; older releases open the shared release folder.</p>
  </div>`;
  main.querySelector(".pm-scroll").scrollTop = keep;
}

function bind() {
  M.bound = true;
  const click = async (e) => {
    const el = e.target.closest("[data-om]");
    if (!el || el.disabled) return;
    const what = el.dataset.om;
    if (what === "close") { $("osmarket").close(); return; }
    if (what === "refresh") { load(true); return; }
    if (what === "dismiss-help") { M.helper = ""; renderOsMarket(); return; }
    if (what === "notes") {
      M.expanded = M.expanded === el.dataset.ver ? "" : el.dataset.ver;
      renderOsMarket();
      return;
    }
    if (what === "open") {
      M.helper = "download";
      renderOsMarket();
      return;
    }
    if (what === "add") {
      $("osmarket").close();
      await startAddImage();
    }
  };
  $("osmarket").addEventListener("click", click);
  $("om-close").addEventListener("click", () => $("osmarket").close());
  $("osmarket").addEventListener("close", () => { /* keep helper until next open or dismiss */ });
}
