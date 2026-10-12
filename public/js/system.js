// System section: the SD card in a card reader, and the jobs that rewrite it (install MustardOS, set up TF2, reset).

import { $, app, api, clock, esc, human, icon, plural, section, store, toast, model } from "./core.js";
import { imageDevice } from "./devices.js";
import { renderStatusbar } from "./device.js";
import { confirmBox } from "./art-images.js";

const TABS = [
  ["install", "Install MustardOS", "download", "Write the OS image to an SD1 card"],
  ["tf2", "Set up TF2", "sd", "Format a games card with the ROMS folders"],
  ["reset", "Reset card", "eraser", "Wipe to one empty FAT32 or exFAT volume"],
];
const OPS = {
  install: { name: "Install MustardOS", short: "Installing", button: "Install MustardOS", icon: "download" },
  tf2: { name: "Set up TF2", short: "Setting up TF2", button: "Set up TF2", icon: "sd" },
  reset: { name: "Reset card", short: "Erasing", button: "Erase card", icon: "eraser" },
};
/** Share of the whole job each stage stands for, so the big ring moves evenly. */
const WEIGHTS = { check: 22, auth: 1, write: 45, verify: 30, eject: 2, erase: 80, mount: 10, folders: 10 };
const HEX = /^[0-9a-f]{64}$/;
const NAME = /^[A-Z0-9_-][A-Z0-9 _-]*$/;

const S = {
  cards: null, error: "", disk: "", tab: store.get("sysTab", "install"),
  images: null, tf2: null,
  path: "", image: null, imageError: "", inspecting: false,
  hash: "", hashSource: "", hashError: "", unchecked: false,
  name: "SD_CARD", fs: "FAT32",
  confirm: "", starting: false, sig: "", timer: 0, jobTimer: 0,
};

const card = () => S.cards?.find((c) => c.id === S.disk) || S.cards?.[0] || null;
const running = () => app.sysJob?.state === "running";
const cleanHash = () => S.hash.toLowerCase().replace(/\s+/g, "");
const cleanName = () => S.name.trim().toUpperCase();
const nameMax = () => (S.fs === "FAT32" ? 11 : 15);

/** The capacity printed on the card (64 GB) from the byte count diskutil reports. */
function nominal(bytes) {
  for (const gb of [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]) {
    if (bytes <= gb * 1e9 * 1.02 && bytes >= gb * 1e9 * 0.86) return gb >= 1024 ? `${gb / 1024} TB` : `${gb} GB`;
  }
  return human(bytes);
}

const sdArt = (cls = "") => `<svg class="sd-art ${cls}" viewBox="0 0 64 82" aria-hidden="true">
  <path class="sd-body" d="M14 2h40a8 8 0 0 1 8 8v64a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6V22l4-4V14Z"/>
  <path class="sd-pins" d="M17 7h5v12h-5zM25 7h5v12h-5zM33 7h5v12h-5zM41 7h5v12h-5zM49 7h5v12h-5z"/>
  <rect class="sd-label" x="9" y="30" width="46" height="40" rx="4"/></svg>`;

/** "boot" / ext4 / FAT colour for a partition, matching the bar and the table swatches. */
function partKind(p) {
  const text = `${p.content} ${p.name}`.toLowerCase();
  if (p.fs === "exfat") return "exfat";
  if (p.fs === "msdos" || /fat|boot/.test(text)) return "fat";
  if (/linux|rootfs|ext/.test(text)) return "linux";
  return "other";
}
const fsName = (p) => p.fsLabel || (partKind(p) === "linux" ? "Linux (ext4)" : p.fs || "—");

function partBar(parts, total, extra = "") {
  const used = parts.reduce((n, p) => n + p.size, 0);
  const free = total - used;
  const segs = parts.map((p) => {
    const pct = (p.size / total) * 100;
    const label = p.volume || p.name || p.id || "";
    return `<i class="seg-${partKind(p)}" style="flex:${Math.max(pct, 0.6)}" title="${esc(`${label} · ${human(p.size)}`)}">${pct > 11 ? `<b>${esc(label)}</b><small>${human(p.size)}</small>` : ""}</i>`;
  });
  if (free / total > 0.01) segs.push(`<i class="seg-free" style="flex:${(free / total) * 100}" title="Unallocated · ${human(free)}">${free / total > 0.11 ? `<b>Unallocated</b><small>${human(free)}</small>` : ""}</i>`);
  return `<div class="pbar ${extra}">${segs.join("") || `<i class="seg-free" style="flex:1"><b>No partitions</b></i>`}</div>`;
}

// ---------------------------------------------------------------- card panel

function renderCard() {
  const box = $("sys-card");
  if (!box) return;
  $("sys-count").textContent = S.cards?.length ? S.cards.length : "";
  if (!S.cards) {
    box.innerHTML = `<section class="panel sc sc-wait"><span class="spinner"></span>Looking for SD cards&hellip;</section>`;
    return;
  }
  if (!S.cards.length) {
    box.innerHTML = `<section class="panel sc sc-empty">
      <div class="slot" aria-hidden="true">${sdArt("slot-card")}<span class="slot-mouth"></span></div>
      <div class="sc-empty-text">
        <h3>Insert an SD card</h3>
        <p>Put the card in a card reader on this Mac. Installing, TF2 setup and reset unlock once it shows up here. Internal disks are never listed.</p>
        <span class="sc-watch"><i></i>Watching for cards</span>
        ${S.error ? `<div class="notice err">${esc(S.error)}</div>` : ""}
      </div></section>`;
    return;
  }
  const c = card(), parts = c.partitions, busyNow = running();
  const chips = S.cards.length > 1
    ? `<div class="sc-chips" role="tablist" aria-label="Cards">${S.cards.map((x) => `<button class="${x.id === c.id ? "on" : ""}" role="tab" aria-selected="${x.id === c.id}" data-sys="disk" data-disk="${esc(x.id)}" ${busyNow ? "disabled" : ""}>${icon("sd")}<b>${esc(x.id)}</b><small>${nominal(x.size)} · ${esc(x.role.label)}</small></button>`).join("")}</div>`
    : "";
  const rows = parts.map((p) => `<tr>
      <td class="num">${p.index}</td>
      <td><span class="swatch seg-${partKind(p)}"></span><b>${esc(p.volume || p.name || "—")}</b>${p.volume && p.name && p.name !== p.volume ? `<small>${esc(p.name)}</small>` : ""}</td>
      <td>${esc(p.content || "—")}</td>
      <td>${esc(fsName(p))}</td>
      <td class="num">${human(p.size)}</td>
      <td>${p.mount ? `<code>${esc(p.mount)}</code><small>${human(p.free)} free</small>` : `<span class="muted">Not mounted</span>`}</td>
      <td class="code-cell"><code>${esc(p.id)}</code></td></tr>`).join("");
  box.innerHTML = `${chips}<section class="panel sc role-${c.role.kind}${busyNow ? " in-use" : ""}">
    <div class="sc-top">
      <div class="sc-art">${sdArt()}<b>${nominal(c.size)}</b></div>
      <div class="sc-main">
        <div class="sc-title"><h3>${esc(c.media || "SD card")}</h3>${busyNow ? `<span class="pill warn busy-pill"><i></i>In use</span>` : `<span class="pill role">${esc(c.role.label)}</span>`}</div>
        <p>${busyNow ? `${esc(OPS[app.sysJob.op].short)} &mdash; the layout below is from before the job and refreshes when it ends.` : esc(c.role.detail)}</p>
        <div class="facts sc-facts">
          ${fact("chip", "Device", `/dev/${c.id}`, "Whole disk")}
          ${fact("sd", "Capacity", nominal(c.size), `${(c.size / 1e9).toFixed(1)} GB usable`)}
          ${fact("layers", "Partition map", c.scheme || "None", c.scheme === "MBR" ? "DOS style" : c.scheme === "GPT" ? "GUID table" : "Not partitioned")}
          ${fact("grid", "Partitions", String(parts.length), parts.filter((p) => p.mount).length ? `${parts.filter((p) => p.mount).length} mounted` : "None mounted")}
          ${fact("usb", "Connection", c.protocol || "—", "Card reader")}
        </div>
      </div>
      <div class="sc-actions">
        <button class="btn icon small" data-sys="refresh" title="Look again">${icon("refresh")}</button>
        <button class="btn small" data-sys="eject" ${busyNow ? "disabled" : ""}>${icon("eject")}Eject</button>
      </div>
    </div>
    ${partBar(parts, c.size)}
    ${parts.length && !busyNow ? `<div class="pt-wrap"><table class="ptable"><thead><tr><th class="num">#</th><th>Name</th><th>Type</th><th>Filesystem</th><th class="num">Size</th><th>Mounted</th><th>Node</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
  </section>`;
}

const fact = (ico, label, value, sub) => `<div class="fact">${icon(ico)}<div><small>${esc(label)}</small><b>${esc(value)}</b><span>${esc(sub)}</span></div></div>`;

// ---------------------------------------------------------------- tabs and forms

function renderBody() {
  const box = $("sys-body");
  if (!box) return;
  if (app.sysJob) { box.innerHTML = jobView(app.sysJob); return; }
  const tabs = `<div class="sys-tabs" role="tablist">${TABS.map(([id, label, ico, sub]) => `<button class="${S.tab === id ? "on" : ""}" role="tab" aria-selected="${S.tab === id}" data-sys="tab" data-tab="${id}">
      <span class="st-ico">${icon(ico)}</span><span><b>${label}</b><small>${sub}</small></span></button>`).join("")}</div>`;
  const left = S.tab === "install" ? installForm() : S.tab === "tf2" ? tf2Form() : resetForm();
  box.innerHTML = `${tabs}<div class="sys-grid"><div class="sys-steps">${left}</div>${goPanel()}</div>`;
}

const step = (n, title, state, aside, body) => `<section class="panel sys-step ${state}">
  <header class="ss-head"><span class="ss-num">${state === "done" ? icon("check") : n}</span><h3>${title}</h3>${aside || ""}</header>
  <div class="ss-body">${body}</div></section>`;

/** MustardOS images are built per model ("MustardOS_RG40XX-H_..."); one for another handheld will not boot. */
function modelNotice(file) {
  const built = imageDevice(file), m = model();
  if (!built) return "";
  return built.id === m.id
    ? `<div class="notice ok">Built for the ${esc(built.name)}, the model picked.</div>`
    : `<div class="notice warn">${icon("alert")}This image is for the ${esc(built.name)}, but the model picked is the ${esc(m.name)}. It only boots on the handheld it is built for. Pick the right image, or change the model under the logo.</div>`;
}

function installForm() {
  const c = card(), im = S.image;
  const list = S.images?.length
    ? `<div class="img-list">${S.images.map((x) => `<button class="img-opt${S.path === x.path ? " on" : ""}" data-sys="use-image" data-path="${esc(x.path)}">
        <span class="img-badge">${x.name.toLowerCase().endsWith(".gz") ? "GZ" : "IMG"}</span>
        <span class="img-text"><b>${esc(x.name)}</b><small>${human(x.size)} · ${esc(x.path.replace(/\/[^/]*$/, "").replace(/^.*\/(os(\/|$))/, "$1"))}${x.hash ? " · checksum file found" : ""}</small></span>
        ${S.path === x.path ? icon("check", "img-check") : ""}</button>`).join("")}</div>`
    : S.images ? `<p class="hint">No images in the OS images folder (set in Settings). Choose one anywhere on this Mac.</p>` : "";
  let status = "";
  if (S.inspecting) status = `<div class="img-wait"><span class="spinner sm"></span>Reading the image header&hellip;</div>`;
  else if (S.imageError) status = `<div class="notice err">${esc(S.imageError)}</div>`;
  else if (im) {
    const fits = !c || im.bytes <= c.size;
    status = `<div class="img-sum">
      <div class="img-sum-top"><span class="img-badge big">${im.kind === "gz" ? "GZ" : "IMG"}</span>
        <div><b>${esc(im.name)}</b><small>${im.kind === "gz" ? `${human(im.fileSize)} compressed, ${human(im.bytes)} on the card` : `${human(im.bytes)} raw image`}</small></div>
        <span class="pill ok">${icon("shield")}GPT valid</span></div>
      ${partBar(im.parts.map((p) => ({ ...p, volume: p.name, content: p.name })), im.bytes, "mini")}
      <div class="img-parts">${im.parts.map((p) => `<span><i class="swatch seg-${partKind({ ...p, content: p.name, fs: "" })}"></i>${esc(p.name)} <small>${human(p.size)}</small></span>`).join("")}</div>
      ${c ? `<div class="notice ${fits ? "ok" : "err"}">${fits
        ? `Fits on ${esc(c.id)} (${nominal(c.size)}) with ${human(c.size - im.bytes)} to spare. MustardOS takes over the rest of the card on first boot.`
        : `Needs ${human(im.bytes)}, but ${esc(c.id)} holds ${human(c.size)}. Use a larger card.`}</div>` : ""}
      ${modelNotice(im.name)}
    </div>`;
  }
  const imageStep = step(1, "Disk image", im && !S.imageError ? "done" : "", im ? `<span class="ss-aside">${im.kind === "gz" ? ".img.gz" : ".img"}</span>` : "", `
    ${list}
    <div class="field-row">
      <input class="control mono grow" id="sys-path" placeholder="/path/to/MustardOS_….img.gz" value="${esc(S.path)}" spellcheck="false" autocomplete="off">
      <button class="btn" data-sys="pick-image">${icon("folder")}Choose&hellip;</button>
      <button class="btn" data-sys="check-image" ${S.inspecting ? "disabled" : ""}>Check</button>
    </div>
    <p class="hint">A MustardOS <code>.img</code> or <code>.img.gz</code>. Compressed images unpack while writing, no extra disk space needed.</p>
    ${status}`);
  const h = hashState();
  const hashStep = step(2, "Checksum", h.cls === "ok" ? "done" : "", `<span class="ss-aside">SHA256</span>`, `
    <div class="field-row">
      <label class="hash-field ${h.cls}">${icon("hash")}
        <input class="mono" id="sys-hash" placeholder="Paste the SHA256 (64 hex characters)" value="${esc(S.hash)}" spellcheck="false" autocomplete="off"></label>
      <button class="btn" data-sys="pick-hash" ${im ? "" : "disabled"} title="${im ? "Read the SHA256 from a .sha256, hash.txt or SHA256SUMS file" : "Pick the image first"}">${icon("file")}Hash file&hellip;</button>
    </div>
    <div id="sys-hash-state">${hashNote(h)}</div>`);
  return imageStep + hashStep;
}

function hashState() {
  const v = cleanHash(), gz = S.image?.kind === "gz";
  if (S.hashError) return { cls: "bad", text: S.hashError };
  if (!v) return gz ? { cls: "warn", text: "No checksum. A damaged download can't be caught before writing." } : { cls: "", text: "Optional for a raw .img. The card is read back and compared with the image either way." };
  if (!HEX.test(v)) return { cls: "bad", text: `A SHA256 is 64 hex characters (0-9, a-f); this has ${v.length}.` };
  const from = S.hashSource ? `From ${S.hashSource}.` : "Entered by hand.";
  return { cls: "ok", text: `${from} The image is hashed before writing and must match.` };
}

function hashNote(h) {
  const gz = S.image?.kind === "gz" && !HEX.test(cleanHash());
  return `<div class="hash-note ${h.cls}">${icon(h.cls === "ok" ? "shield" : h.cls === "bad" ? "x" : "info")}<span>${esc(h.text)}</span></div>
    ${gz ? `<label class="check-row"><input type="checkbox" id="sys-unchecked" ${S.unchecked ? "checked" : ""}> Install without a checksum</label>` : ""}`;
}

function tf2Form() {
  const top = S.tf2?.top || ["ARCHIVE", "BACKUP", "ports", "ROMS"], systems = S.tf2?.systems || [];
  return step(1, "What the card gets", "", `<span class="ss-aside">MBR · exFAT · TF2</span>`, `
    <div class="tree">
      <div class="tree-root">${icon("sd")}<b>TF2</b><small>one exFAT volume, the whole card</small></div>
      <ul class="tree-top">${top.map((f) => `<li class="${f === "ROMS" ? "open" : ""}">${icon("folder")}<span>${esc(f)}</span>${f === "ROMS" ? `<small>${plural(systems.length, "system folder")}</small>` : ""}</li>`).join("")}</ul>
      <div class="tree-roms">${systems.map((s) => `<span>${esc(s)}</span>`).join("")}</div>
    </div>
    <p class="hint">On the handheld this card mounts at <code>/mnt/sdcard</code>, and muOS looks for games in <code>ROMS/&lt;system&gt;</code>. Once it's set up, switch the manager to Card reader and copy games straight onto it.</p>`);
}

function resetForm() {
  const n = cleanName(), ok = n && n.length <= nameMax() && NAME.test(n);
  const c = card();
  const fsCard = (id, title, text) => `<button class="fs-opt${S.fs === id ? " on" : ""}" data-sys="fs" data-fs="${id}" role="radio" aria-checked="${S.fs === id}">
      <span class="fs-radio"></span><span><b>${title}</b><small>${text}</small></span></button>`;
  return step(1, "Format", ok ? "done" : "", "", `
    <div class="fs-opts" role="radiogroup" aria-label="Filesystem">
      ${fsCard("FAT32", "FAT32", "Works with every device and camera. Single files up to 4 GB.")}
      ${fsCard("ExFAT", "exFAT", "Large files such as disc images. muOS reads it on TF2.")}
    </div>
    <label class="field"><span>Volume name</span>
      <input class="control mono" id="sys-name" maxlength="${nameMax()}" value="${esc(S.name)}" spellcheck="false" autocomplete="off"></label>
    <p class="hint" id="sys-name-hint">${ok ? `Up to ${nameMax()} characters: A–Z, 0–9, space, _ and -. Lowercase becomes uppercase.` : `<span class="bad-text">Use up to ${nameMax()} letters, numbers, spaces, _ or -.</span>`}</p>
    <div class="sub-head">After reset</div>
    <div class="pbar"><i class="seg-${S.fs === "FAT32" ? "fat" : "exfat"}" style="flex:1"><b>${esc(n || "NO NAME")}</b><small>${S.fs === "FAT32" ? "FAT32" : "exFAT"} &middot; ${c ? human(c.size) : "the whole card"}</small></i></div>
    <p class="hint">MBR partition map with one ${S.fs === "FAT32" ? "FAT32" : "exFAT"} volume, mounted on this Mac when done.</p>`);
}

/** Checklist that gates the start button. */
function checks() {
  const c = card(), list = [{ ok: !!c, text: c ? `SD card ${c.id} detected` : "Insert an SD card" }];
  if (S.tab === "install") {
    const im = S.image, v = cleanHash();
    list.push({ ok: !!im && !S.imageError, text: im ? "Image layout is valid" : "Pick a disk image" });
    list.push({ ok: !!im && !!c && im.bytes <= c.size, text: "Image fits on the card" });
    const hashOk = HEX.test(v) || (!v && (S.image?.kind === "raw" || S.unchecked));
    list.push({ ok: hashOk && !S.hashError, text: HEX.test(v) ? "Checksum ready" : v ? "Fix the checksum" : S.image?.kind === "gz" ? "Add a checksum or skip it" : "Checksum (optional)" });
  }
  if (S.tab === "reset") {
    const n = cleanName();
    list.push({ ok: !!n && n.length <= nameMax() && NAME.test(n), text: "Volume name is valid" });
  }
  list.push({ ok: !!c && S.confirm.trim() === c.id, text: c ? `Type ${c.id} to confirm` : "Confirm the card" });
  return list;
}

function goPanel() {
  const c = card(), op = OPS[S.tab];
  const src = S.tab === "install"
    ? S.image ? [icon("file"), S.image.name, human(S.image.bytes)] : [icon("file"), "Disk image", "Not picked yet"]
    : S.tab === "tf2" ? [icon("folder"), "TF2 layout", `exFAT · ${(S.tf2?.systems.length || 54)} systems`]
    : [icon("eraser"), cleanName() || "NO NAME", S.fs === "FAT32" ? "FAT32" : "exFAT"];
  const loses = c ? c.partitions.length ? `${plural(c.partitions.length, "partition")}${c.partitions.some((p) => p.volume) ? ` (${c.partitions.filter((p) => p.volume).map((p) => p.volume).join(", ")})` : ""}` : "everything on it" : "";
  return `<aside class="panel sys-go">
    <h2>${icon(op.icon)}${op.name}</h2>
    <div class="go-flow">
      <div class="go-node">${src[0]}<b title="${esc(src[1])}">${esc(src[1])}</b><small>${esc(src[2])}</small></div>
      <span class="go-arrow">${icon("arrow")}</span>
      <div class="go-node target${c ? "" : " missing"}">${sdArt()}<b>${c ? esc(c.id) : "No card"}</b><small>${c ? `${nominal(c.size)} · ${esc(c.role.label)}` : "Insert one"}</small></div>
    </div>
    <ul class="go-checks" id="sys-checks">${checkList()}</ul>
    ${c ? `<div class="notice err go-warn">${icon("alert")}<span><b>Erases ${esc(c.id)} completely.</b> ${c.role.kind === "tf2" ? "This is a TF2 games card; its ROMS go too. " : c.role.kind === "muos" ? "The MustardOS install and its saves go too. " : ""}Loses ${esc(loses)}.</span></div>` : ""}
    <label class="confirm-field"><span>Type <code>${c ? esc(c.id) : "the disk"}</code> to confirm</span>
      <input class="control mono" id="sys-confirm" value="${esc(S.confirm)}" placeholder="${c ? esc(c.id) : ""}" ${c ? "" : "disabled"} spellcheck="false" autocomplete="off"></label>
    <button class="btn danger-solid go-btn" id="sys-go" data-sys="start" ${ready() ? "" : "disabled"}>${S.starting ? `<span class="spinner sm"></span>Starting` : `${icon(op.icon)}${op.button}`}</button>
    <p class="hint go-hint">${S.tab === "install" ? `${icon("lock")}macOS asks for your password before writing.` : `${icon("info")}Uses diskutil; takes under a minute.`}</p>
  </aside>`;
}

const checkList = () => checks().map((x) => `<li class="${x.ok ? "ok" : ""}">${icon(x.ok ? "check" : "dot")}<span>${esc(x.text)}</span></li>`).join("");
const ready = () => !S.starting && !running() && checks().every((x) => x.ok);

/** Typing updates the checklist and the start button without redrawing the form under the cursor. */
function refreshGo() {
  const list = $("sys-checks"), btn = $("sys-go");
  if (list) list.innerHTML = checkList();
  if (btn) btn.disabled = !ready();
}

// ---------------------------------------------------------------- job view

function decorate(job) {
  const total = job.stages.reduce((n, s) => n + (WEIGHTS[s.id] || 5), 0);
  const done = job.stages.reduce((n, s) => {
    const part = s.state === "done" ? 1 : s.state === "skip" ? 0 : s.total ? Math.min(1, s.done / s.total) : 0;
    return n + (WEIGHTS[s.id] || 5) * part;
  }, 0);
  const percent = job.state === "done" ? 100 : Math.min(99, Math.floor((done / total) * 100));
  return { ...job, percent, short: OPS[job.op]?.short || "Working" };
}

function jobView(j) {
  const op = OPS[j.op], cur = j.stages.find((s) => s.state === "run") || j.stages.find((s) => s.state === "fail");
  const stateText = { running: "Working", done: "Done", failed: "Failed", cancelled: "Cancelled" }[j.state];
  const elapsed = ((j.finished || Date.now()) - j.started) / 1000;
  const stepper = j.stages.map((s, i) => {
    const ico = s.state === "done" ? icon("check") : s.state === "fail" ? icon("x") : s.state === "run" ? `<span class="spinner sm"></span>` : s.state === "skip" ? "–" : String(i + 1);
    return `<li class="sp-${s.state}"><span class="sp-dot">${ico}</span><span class="sp-text"><b>${esc(s.label)}</b><small>${s.state === "done" ? clock(s.elapsed) : s.state === "run" ? "Now" : s.state === "skip" ? "Skipped" : s.state === "fail" ? "Stopped" : "Waiting"}</small></span></li>`;
  }).join("");
  let now = "";
  if (cur && j.state === "running") {
    const pct = cur.total ? Math.min(100, (cur.done / cur.total) * 100) : 0;
    const bytes = cur.total > 1000;
    now = `<div class="stage-now">
      <div class="sn-head"><b>${esc(cur.label)}</b><span>${esc(cur.detail || "")}</span></div>
      <div class="sn-bar${cur.total ? "" : " indeterminate"}"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="sn-meta">
        <span>${cur.total ? bytes ? `${human(cur.done)} of ${human(cur.total)}` : `${cur.done} of ${cur.total}` : "Working"}</span>
        ${cur.speed ? `<span>${human(cur.speed)}/s</span>` : ""}
        ${cur.eta ? `<span>${clock(cur.eta)} left</span>` : ""}
      </div></div>`;
  }
  let outcome = "";
  if (j.state === "done") outcome = `<div class="job-result ok">${icon("check")}<div>${doneText(j)}</div></div>`;
  if (j.state === "failed") outcome = `<div class="job-result bad">${icon("alert")}<div><b>${esc(cur ? `${cur.label} failed` : "Failed")}</b><p>${esc(j.error || "Something went wrong.")}</p>${j.op === "install" ? "<p>The card may be half written. Run the install again, or reset it before using it.</p>" : ""}</div></div>`;
  if (j.state === "cancelled") outcome = `<div class="job-result warn">${icon("stop")}<div><b>Stopped</b><p>${esc(j.error || "Cancelled before finishing.")}</p>${j.op === "install" ? "<p>The card is only partly written and won't boot. Install again or reset it.</p>" : ""}</div></div>`;
  const cancellable = j.state === "running" && j.op === "install" && ["check", "auth", "write", "verify"].includes(cur?.id);
  const actions = j.state === "running"
    ? cancellable ? `<button class="btn danger" data-sys="cancel">${icon("stop")}Cancel</button>` : `<span class="hint">Erasing can't be stopped halfway.</span>`
    : `<button class="btn primary" data-sys="dismiss">${icon("check")}${j.state === "done" ? "Done" : "Back"}</button>`;
  return `<section class="panel sys-job st-${j.state}">
    <div class="job-top">
      <div class="ring job-ring" style="--p:${j.percent}"><b>${j.percent}%</b><small>${stateText}</small></div>
      <div class="job-info">
        <span class="eyebrow">${icon(op.icon)}${esc(op.name)}</span>
        <h3>${esc(j.title)}</h3>
        <p>${esc(j.disk)} · ${esc(j.media || "SD card")} · ${nominal(j.size)} · ${clock(elapsed)} elapsed</p>
      </div>
      <div class="job-actions">${actions}</div>
    </div>
    <ol class="stepper">${stepper}</ol>
    ${now}${outcome}
  </section>`;
}

function doneText(j) {
  const r = j.result || {};
  if (j.op === "install") return `<b>MustardOS is on ${esc(j.disk)}${r.verified ? " and verified" : ""}.</b>
    <p>The card was read back and matches the image${r.hashSource ? `, and the image matched ${esc(r.hashSource)}` : ""}. It's ejected and safe to pull out.</p>
    <ol class="job-next"><li>Put it in the handheld's <b>TF1</b> slot, the one muOS boots from.</li><li>Turn it on. The first boot sets up the card and can sit on <i>Factory Reset</i> for 5–10 minutes.</li><li>Then come back to Overview and connect over Wi-Fi.</li></ol>`;
  if (j.op === "tf2") return `<b>TF2 is ready at <code>${esc(r.mount || "/Volumes/TF2")}</code>.</b><p>${plural(r.systems || 0, "system folder")} under ROMS. Switch the manager to Card reader to copy games to it, then eject and put it in the TF2 slot.</p>`;
  return `<b>${esc(j.disk)} is now an empty volume${r.name ? ` named ${esc(r.name)}` : ""}.</b><p>${r.mount ? `Mounted at <code>${esc(r.mount)}</code>.` : "Ready to use."}</p>`;
}

// ---------------------------------------------------------------- data

async function loadCards() {
  try {
    const r = await api("system/cards");
    S.error = "";
    S.cards = r.cards;
    setJob(r.job);
  } catch (error) {
    S.error = error.message;
    S.cards ||= [];
  }
  if (S.disk && !S.cards.some((c) => c.id === S.disk)) S.disk = "";
  const sig = JSON.stringify(S.cards.map((c) => [c.id, c.size, c.scheme, c.role.kind, c.partitions.map((p) => [p.id, p.mount])]));
  renderCard();
  if (sig !== S.sig) {
    if (S.sig) S.confirm = "";
    S.sig = sig;
    renderBody();
  }
}

async function loadImages() {
  try {
    const r = await api("system/images");
    S.images = r.images;
    S.tf2 = r.tf2;
    const mine = r.images.find((x) => imageDevice(x.name)?.id === model().id) || r.images[0];
    if (!S.path && mine) await useImage(mine.path, false);
    else renderBody();
  } catch (error) {
    S.images = [];
    toast(error.message, 3000);
  }
}

async function useImage(path, draw = true) {
  path = path.trim();
  S.path = path;
  S.image = null;
  S.imageError = "";
  S.hashError = "";
  if (!path) { renderBody(); return; }
  S.inspecting = true;
  if (draw) renderBody();
  try {
    const info = await api("system/inspect", { path });
    if (S.path !== path) return;
    S.image = info;
    if (info.hash) { S.hash = info.hash.value; S.hashSource = info.hash.source; }
    else if (S.hashSource) { S.hash = ""; S.hashSource = ""; }
  } catch (error) {
    if (S.path === path) S.imageError = error.message;
  }
  S.inspecting = false;
  renderBody();
}

function setJob(job) {
  const before = app.sysJob;
  app.sysJob = job ? decorate(job) : null;
  if (job?.state === "running") watchJob();
  if (before?.state === "running" && job && job.state !== "running") {
    toast(job.state === "done" ? `${OPS[job.op].name}: done` : `${OPS[job.op].name}: ${job.state}`, 3000);
    setTimeout(loadCards, 600);
  }
  renderStatusbar();
  if (section() === "system" && (job || before)) { renderBody(); if (!!before !== !!job || before?.state !== job?.state) renderCard(); }
}

function watchJob() {
  if (S.jobTimer) return;
  S.jobTimer = setTimeout(async function tick() {
    try {
      const r = await api("system/job");
      setJob(r.job);
    } catch { /* the next tick tries again */ }
    S.jobTimer = running() ? setTimeout(tick, 700) : 0;
  }, 700);
}

/** Picks up a job another tab started, or one still running after a reload. */
export async function watchSystemJob() {
  try { setJob((await api("system/job")).job); } catch { /* server not ready */ }
}

function schedule() {
  clearTimeout(S.timer);
  S.timer = setTimeout(async () => {
    if (section() !== "system") return;
    if (document.visibilityState === "visible" && !running()) await loadCards();
    schedule();
  }, 3000);
}

/** The OS images folder changed: read its images again next time. */
export function forgetImages() {
  S.images = null;
}

export function showSystem() {
  renderCard();
  renderBody();
  loadCards();
  if (!S.images) loadImages();
  schedule();
}

// ---------------------------------------------------------------- actions

async function start() {
  const c = card();
  if (!c || !ready()) return;
  const op = OPS[S.tab];
  const body = { op: S.tab, disk: c.id, confirm: S.confirm.trim() };
  if (S.tab === "install") Object.assign(body, { image: S.image.path, hash: cleanHash(), hashSource: S.hashSource, allowUnchecked: S.unchecked });
  if (S.tab === "reset") Object.assign(body, { name: cleanName(), fs: S.fs });
  const ok = await confirmBox({
    title: `${op.button}?`,
    html: `<p>Everything on <b>${esc(c.id)}</b> (${esc(c.media || "SD card")}, ${nominal(c.size)}) is erased. This can't be undone.</p>`,
    ok: op.button, danger: true,
  });
  if (!ok) return;
  S.starting = true;
  refreshGo();
  try {
    setJob(await api("system/start", body));
    S.confirm = "";
  } catch (error) {
    toast(error.message, 4000);
  }
  S.starting = false;
  renderBody();
}

async function act(el) {
  const what = el.dataset.sys;
  if (what === "tab") { S.tab = el.dataset.tab; S.confirm = ""; store.set("sysTab", S.tab); renderBody(); return; }
  if (what === "disk") { S.disk = el.dataset.disk; S.confirm = ""; renderCard(); renderBody(); return; }
  if (what === "refresh") { el.disabled = true; await loadCards(); return; }
  if (what === "use-image") { if (el.dataset.path !== S.path) useImage(el.dataset.path); return; }
  if (what === "check-image") { useImage($("sys-path").value); return; }
  if (what === "fs") {
    S.fs = el.dataset.fs;
    renderBody();
    return;
  }
  if (what === "start") { start(); return; }
  try {
    if (what === "pick-image" || what === "pick-hash") {
      el.disabled = true;
      const hash = what === "pick-hash";
      const r = await api("system/pick", { kind: hash ? "hash" : "image", start: S.image?.path || S.path });
      el.disabled = false;
      if (!r.path) return;
      if (!hash) { useImage(r.path); return; }
      const found = await api("system/hash-file", { path: r.path, image: S.image.path });
      S.hash = found.value;
      S.hashSource = found.source;
      S.hashError = "";
      renderBody();
    } else if (what === "eject") {
      el.disabled = true;
      await api("system/eject", { disk: card().id });
      toast(`${card().id} ejected`, 2000);
      await loadCards();
    } else if (what === "cancel") {
      el.disabled = true;
      await api("system/cancel", {});
    } else if (what === "dismiss") {
      await api("system/dismiss", {});
      app.sysJob = null;
      renderStatusbar();
      renderBody();
      loadCards();
    }
  } catch (error) {
    el.disabled = false;
    toast(error.message, 4000);
  }
}

export function bindSystem() {
  const view = $("view-system");
  view.addEventListener("click", (e) => {
    const el = e.target.closest("[data-sys]");
    if (el && !el.disabled) act(el);
  });
  view.addEventListener("input", (e) => {
    const id = e.target.id;
    if (id === "sys-confirm") S.confirm = e.target.value;
    else if (id === "sys-path") S.path = e.target.value;
    else if (id === "sys-hash") {
      S.hash = e.target.value;
      S.hashSource = "";
      S.hashError = "";
      const h = hashState();
      e.target.closest(".hash-field").className = `hash-field ${h.cls}`;
      $("sys-hash-state").innerHTML = hashNote(h);
    } else if (id === "sys-name") {
      S.name = e.target.value;
      const n = cleanName(), ok = n && n.length <= nameMax() && NAME.test(n);
      $("sys-name-hint").innerHTML = ok ? `Up to ${nameMax()} characters: A–Z, 0–9, space, _ and -. Lowercase becomes uppercase.` : `<span class="bad-text">Use up to ${nameMax()} letters, numbers, spaces, _ or -.</span>`;
      const label = view.querySelector(".sys-steps .pbar b");
      if (label) label.textContent = n || "NO NAME";
      const src = view.querySelector(".go-node b");
      if (src) src.textContent = n || "NO NAME";
    } else return;
    refreshGo();
  });
  view.addEventListener("change", (e) => {
    if (e.target.id === "sys-unchecked") { S.unchecked = e.target.checked; refreshGo(); }
  });
  view.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "sys-path") useImage(e.target.value);
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && section() === "system") loadCards(); });
}
