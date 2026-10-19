// Copying games to the device, and the Transfers panel every job reports to: running, waiting and finished jobs.

import { $, app, api, esc, human, clock, plural, toast, icon, usbMode, slowHint, devName, busy, canQueue, store, formatDate, formatTime, syncSpinnerPhase } from "./core.js";
import { renderDevice, refreshDevice, renderStatusbar } from "./device.js";
import { loadLibrary, resetListing } from "./games.js";
import { resetOverview } from "./overview.js";

let pending = null;
let pollTimer = null;

export async function startPlan(targets, label, { onStart = null } = {}) {
  if (!app.device.target) { toast("Insert TF2 or connect the handheld first"); return; }
  if (!canQueue()) { toast("Over USB the handheld handles one transfer at a time. Wait for the current one to finish."); return; }
  if ($("viewer").open) $("viewer").close();
  const mine = pending = { targets, label, plan: null, onStart };
  $("t-title").textContent = `Transfer to ${devName()}`;
  $("t-scope").textContent = label;
  $("t-plan").innerHTML = `<div class="planning"><span class="spinner"></span> Comparing with what is already on ${esc(devName())}&hellip;${slowHint()}</div>`;
  $("t-start").hidden = true;
  $("t-cancel").textContent = "Cancel";
  if (!$("transfer").open) $("transfer").showModal();
  try {
    const plan = await api("games/plan", { volume: app.device.target.id, targets });
    if (pending !== mine) return;
    mine.plan = plan;
    renderPlan();
  } catch (error) {
    if (pending !== mine) return;
    $("t-plan").innerHTML = `<div class="notice err">${esc(error.message)}</div>`;
    $("t-cancel").textContent = "Close";
  }
}

function renderPlan() {
  const plan = pending.plan;
  const names = Object.fromEntries(app.data.systems.map((s) => [s.code, s.name]));
  const diff = plan.different;
  const name = esc(devName());
  const parts = [`<div class="plan-grid">
    <div class="stat"><b>${plan.new.count.toLocaleString()}</b><span>new &middot; ${human(plan.new.bytes)}</span></div>
    <div class="stat"><b>${plan.identical.toLocaleString()}</b><span>already on ${name}</span></div>
    <div class="stat"><b>${diff.count.toLocaleString()}</b><span>different on ${name}</span></div>
  </div>`];
  if (diff.count) {
    parts.push(`<label class="check"><input type="checkbox" id="t-replace">
      <span>Replace the ${diff.count === 1 ? "file that differs" : `${diff.count} files that differ`} on ${name} (${human(diff.bytes)})<br>
      <small style="color:var(--muted)">Left unticked, the copies already on ${name} are kept.${usbMode() ? " Over USB the old copy is deleted before the new one is sent." : ""}</small></span></label>
      <details><summary>Show files that differ</summary><ul>${diff.files.map((f) => `<li>${esc(f)}</li>`).join("")}${diff.count > diff.files.length ? `<li>&hellip;and ${diff.count - diff.files.length} more</li>` : ""}</ul></details>`);
  }
  if (plan.systems.length > 1) {
    parts.push(`<div class="plan-table"><table><thead><tr><th>System</th><th class="num">New</th><th class="num">Differ</th><th class="num">Size</th></tr></thead><tbody>
      ${plan.systems.map((s) => `<tr><td>${esc(names[s.code] || s.code)} <span style="color:var(--muted)">${esc(s.code)}</span></td><td class="num">${s.new}</td><td class="num">${s.different || ""}</td><td class="num">${human(s.bytes + s.diff_bytes)}</td></tr>`).join("")}
    </tbody></table></div>`);
  }
  if (plan.queued) {
    parts.push(`<div class="notice">${plan.queued === 1 ? "One of these is" : `${plan.queued.toLocaleString()} of these are`} already waiting in Transfers.</div>`);
  }
  if (plan.skipped.length) {
    parts.push(`<small style="color:var(--muted)">Skipped ${plan.skipped.map(esc).join(", ")}: stock Anbernic firmware files that MustardOS does not run.</small>`);
  }
  if (plan.too_big.length) {
    parts.push(`<div class="notice err">${esc(plan.too_big[0])} is 4 GB or larger, which FAT32 cannot store. Use <a href="#system">System Tools</a> to set up TF2 as exFAT. Formatting erases the card; back up its files first.</div>`);
  }
  parts.push(`<div id="t-space"></div>`);
  $("t-plan").innerHTML = parts.join("");
  $("t-replace")?.addEventListener("change", updatePlanTotals);
  updatePlanTotals();
}

function updatePlanTotals() {
  const plan = pending.plan;
  const replace = $("t-replace")?.checked || false;
  const count = plan.new.count + (replace ? plan.different.count : 0);
  const bytes = plan.new.bytes + (replace ? plan.different.bytes : 0);
  const fits = bytes <= plan.card.free;
  const start = $("t-start");
  if (!count) {
    $("t-space").innerHTML = plan.queued && !plan.new.count && !plan.different.count ? ""
      : plan.different.count
      ? `<div class="notice">Nothing new to transfer. Tick the box above to replace the different copies on ${esc(devName())}.</div>`
      : `<div class="notice ok">Everything here is already on ${esc(devName())}. Nothing to transfer.</div>`;
    start.hidden = true;
    $("t-cancel").textContent = "Close";
    return;
  }
  $("t-space").innerHTML = `<div class="space-line"><span>Transferring <b>${human(bytes)}</b></span><span>${esc(devName())} has <b>${human(plan.card.free)}</b> free</span></div>
    ${fits ? "" : `<div class="notice err">Not enough space on ${esc(devName())}. Free up ${human(bytes - plan.card.free)} or pick fewer games.</div>`}`;
  start.hidden = false;
  start.disabled = !fits || plan.too_big.length > 0;
  start.innerHTML = `${icon("transfer")}<span>${busy() ? "Queue" : "Transfer"} ${count.toLocaleString()} file${count === 1 ? "" : "s"}</span>`;
  $("t-cancel").textContent = "Cancel";
}

async function startTransfer() {
  const start = $("t-start");
  start.disabled = true;
  start.innerHTML = `<span class="spinner"></span> Starting`;
  try {
    const result = await api("games/copy", {
      volume: app.device.target.id, targets: pending.targets, label: pending.label,
      replace: $("t-replace")?.checked || false
    });
    $("transfer").close();
    pending.onStart?.();
    jobStarted(result.job);
  } catch (error) {
    $("t-space").insertAdjacentHTML("beforeend", `<div class="notice err">${esc(error.message)}</div>`);
    start.disabled = false;
    start.textContent = "Try again";
  }
}

/** Call with the job a POST returned; the panel follows it from there. */
export function jobStarted(job) {
  T.active = [...T.active.filter((j) => j.id !== job.id), job];
  if (job.state === "running") app.job = job;
  else toast("Added to Transfers. It starts when the current one finishes.", 3000);
  T.shown = true;
  renderDock();
  renderDevice();
  poll();
}

async function jobFinished(job) {
  dispatchEvent(new CustomEvent("job-finished", { detail: job }));
  if (!T.shown || T.min) toast(pastSummary(job), 3500);
  if (job.kind === "apps") { renderDevice(); return; }
  resetOverview();
  if (job.kind === "art") {
    if (job.copied) await loadLibrary().catch(() => {});
    renderDevice();
    return;
  }
  resetListing();
  refreshDevice();
}

function apply(list) {
  const before = T.active.map((j) => j.id);
  T.active = list.active;
  T.history = list.history;
  app.job = T.active.find((j) => j.state === "running") || null;
  app.transfers = T;
  if (!T.ready) {
    T.ready = true;
    if (T.active.length) T.shown = true;
  }
  renderDock();
  renderStatusbar();
  for (const id of before) {
    if (T.active.some((j) => j.id === id)) continue;
    const job = T.history.find((j) => j.id === id);
    if (job) jobFinished(job);
  }
}

export async function poll() {
  clearTimeout(pollTimer);
  try {
    apply(await api("job"));
    if (T.active.length) pollTimer = setTimeout(poll, 600);
  } catch {
    pollTimer = setTimeout(poll, 2000);
  }
}

// ---------------------------------------------------------------- transfers panel

const T = {
  active: [], history: [], shown: false, ready: false, min: store.get("dockMin", false), pastSig: "", pressing: false,
  /** Job ids the user collapsed; multi-file lists start expanded. */
  closed: new Set(), files: new Map(), loading: new Set(),
};
app.transfers = T;

const KIND_ICON = { transfer: "transfer", files: "folder", apps: "package", art: "image", artsend: "image" };
const unit = (j) => (j.kind === "art" || j.kind === "artsend" ? "image" : "file");
const pctOf = (j) => (j.total_bytes ? Math.min(100, Math.floor((j.done_bytes / j.total_bytes) * 100)) : 100);
const where = (j) => ({ art: "into Roms/", apps: `to ARCHIVE on ${j.target}` })[j.kind] || `to ${j.target}`;
const kindIcon = (j) => `<span class="tx-ico">${icon(KIND_ICON[j.kind] || "transfer")}</span>`;
const dot = " &middot; ";

const FILE_ICON = { done: ["check", "ok"], failed: ["x", "err"], skipped: ["dot", "off"], waiting: ["clock", "off"] };

function fileRow(j, f) {
  let ic, side, bar = "";
  if (f.state === "running" && j.state === "running") {
    const pct = f.size ? Math.min(100, Math.floor(((j.file_done || 0) / f.size) * 100)) : 0;
    ic = `<span class="spinner sm"></span>`;
    side = `${pct}%${dot}${human(f.size)}`;
    bar = `<div class="bar thin"><i style="width:${pct}%"></i></div>`;
  } else {
    const [name, cls] = FILE_ICON[f.state] || FILE_ICON.waiting;
    ic = `<span class="tx-fi ${cls}">${icon(name)}</span>`;
    side = f.state === "done" ? [human(f.size), f.secs >= 1 ? clock(f.secs) : "", f.secs >= 1 ? `${human(f.size / f.secs)}/s` : ""].filter(Boolean).join(dot)
      : f.state === "failed" ? `<span class="tx-bad">Failed</span>`
      : f.state === "skipped" ? "Not copied" : human(f.size);
  }
  return `<li class="tx-f ${f.state}" title="${esc(f.rel)}">${ic}<span class="tx-fn">${esc(f.rel.split("/").pop())}</span><span class="tx-fs">${side}</span>${bar}
    ${f.error ? `<div class="tx-ferr">${esc(f.error)}</div>` : ""}</li>`;
}

function fileRows(j) {
  const got = T.files.get(j.id);
  if (!got) return `<div class="tx-files muted-note"><span class="spinner sm"></span> Loading the files&hellip;</div>`;
  const list = got.list.length ? got.list : (j.failed || []).map((rel) => ({ rel, size: 0, state: "failed" }));
  if (!list.length) return `<div class="tx-files muted-note">No file details were kept for this transfer.</div>`;
  const more = got.list.length >= 500 && j.count > got.list.length ? `<li class="tx-f more">The first ${got.list.length} of ${j.count.toLocaleString()} files</li>` : "";
  return `<ul class="tx-files">${list.map((f) => fileRow(j, f)).join("")}${more}</ul>`;
}

function filesOpen(j) {
  return j.count >= 2 && !T.closed.has(j.id);
}

function filesToggle(j) {
  if (j.count < 2) return "";
  const open = filesOpen(j);
  const label = open ? "Hide the files" : `Show the ${j.count.toLocaleString()} files${j.failed_count ? `${dot}${j.failed_count} failed` : ""}`;
  return `<button class="tx-more" data-dock="files" data-id="${j.id}" aria-expanded="${open}">${icon("down")}<span>${label}</span></button>${open ? fileRows(j) : ""}`;
}

/** Fetches a job's file list when it is shown and out of date: once for waiting and finished jobs, after each file for the running one. */
function wantFiles(j) {
  if (!filesOpen(j) || T.loading.has(j.id)) return;
  const got = T.files.get(j.id);
  if (got && got.index === j.index && got.state === j.state) return;
  T.loading.add(j.id);
  const keep = (list) => T.files.set(j.id, { list, index: j.index, state: j.state });
  api(`job/files?id=${j.id}`).then((r) => keep(r.files), () => keep([])).finally(() => {
    T.loading.delete(j.id);
    T.pastSig = "";
    renderDock();
  });
}

const stamp = (t) => {
  const d = new Date(t);
  return new Date().toDateString() === d.toDateString() ? formatTime(d) : `${formatDate(d, "short")} ${formatTime(d)}`;
};

function pastSummary(j) {
  const u = unit(j);
  if (j.state === "done") return j.failed_count ? `${j.copied.toLocaleString()} copied, ${j.failed_count} failed` : `${plural(j.copied, u)} ${where(j)}`;
  if (j.state === "cancelled") return j.started ? `Stopped after ${plural(j.copied, u)}` : "Removed from the queue before it started";
  return `Failed: ${j.error}`;
}

function runningItem(j) {
  const pct = pctOf(j), u = unit(j);
  const stop = `<button class="btn icon small ghost" data-dock="stop" data-id="${j.id}" title="Stop" aria-label="Stop ${esc(j.label)}">${icon("stop")}</button>`;
  const top = `<div class="tx-top">${kindIcon(j)}<div class="tx-name"><b title="${esc(j.label)}">${esc(j.label)}</b><small>${esc(where(j))}</small></div>`;
  if (j.phase === "rebuild") {
    return `<li class="tx run">${top}</div><div class="bar"><i style="width:100%"></i></div>
      <div class="tx-meta"><span>${plural(j.copied, "image")} copied into Roms/</span><span>Rescanning Roms/&hellip;</span></div></li>`;
  }
  return `<li class="tx run">${top}${stop}</div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="tx-meta"><span>${pct}%${dot}${human(j.done_bytes)} of ${human(j.total_bytes)}</span><span>${j.speed ? `${human(j.speed)}/s` : "Starting"}</span></div>
    <div class="tx-meta"><span>${u === "image" ? "Image" : "File"} ${j.index.toLocaleString()} of ${j.count.toLocaleString()}${j.failed_count ? `${dot}<em class="tx-bad">${j.failed_count} failed</em>` : ""}</span>
      <span>${j.speed && j.eta ? `${clock(j.eta)} left` : clock(j.elapsed)}</span></div>
    ${j.current ? `<div class="tx-file" title="${esc(j.current)}">${esc(j.current)}</div>` : ""}${filesToggle(j)}</li>`;
}

function waitingItem(j) {
  return `<li class="tx wait"><div class="tx-top">${kindIcon(j)}<div class="tx-name"><b title="${esc(j.label)}">${esc(j.label)}</b>
      <small>${plural(j.count, unit(j))}${dot}${human(j.total_bytes)}${dot}${esc(where(j))}</small></div>
    <button class="btn icon small ghost" data-dock="cancel" data-id="${j.id}" title="Remove from the queue" aria-label="Remove ${esc(j.label)} from the queue">${icon("x")}</button></div>${filesToggle(j)}</li>`;
}

const PAST = { done: ["check", "ok"], cancelled: ["stop", "off"], failed: ["x", "err"] };

function pastItem(j) {
  const [ic, cls] = j.state === "done" && j.failed_count ? ["alert", "warn"] : PAST[j.state] || PAST.failed;
  const took = j.started && j.finished ? clock((j.finished - j.started) / 1000) : "";
  const facts = [j.done_bytes ? human(j.done_bytes) : "", took, j.state === "done" && j.speed && j.done_bytes ? `${human(j.speed)}/s` : ""].filter(Boolean);
  const failed = j.count < 2 && j.failed_count && j.error ? `<div class="tx-ferr tx-indent">${esc(j.error)}</div>` : "";
  return `<li class="tx past ${cls}"><div class="tx-top"><span class="tx-ico ${cls}">${icon(ic)}</span>
      <div class="tx-name">
        <div class="tx-row"><b title="${esc(j.label)}">${esc(j.label)}</b>${j.finished ? `<time title="${esc(new Date(j.finished).toLocaleString())}">${stamp(j.finished)}</time>` : ""}</div>
        <div class="tx-row"><small title="${esc(pastSummary(j))}">${esc(pastSummary(j))}</small><span class="tx-facts">${facts.join(dot)}</span></div></div>
      <button class="btn icon small ghost tx-forget" data-dock="forget" data-id="${j.id}" title="Remove from the list" aria-label="Remove ${esc(j.label)} from the list">${icon("x")}</button></div>${failed}${filesToggle(j)}</li>`;
}

function headSummary() {
  const run = T.active.find((j) => j.state === "running"), waiting = T.active.length - (run ? 1 : 0);
  if (run) {
    const left = run.speed && run.eta ? `${dot}${clock(run.eta)} left` : "";
    return `${pctOf(run)}%${left}${waiting ? `${dot}${waiting} waiting` : ""}`;
  }
  if (waiting) return `${waiting} waiting`;
  const last = T.history[0];
  if (!last) return "Nothing yet";
  return last.state === "done" && !last.failed_count ? "All done" : esc(pastSummary(last));
}

function headIcon() {
  if (T.active.some((j) => j.state === "running")) return `<span class="spinner sm"></span>`;
  const last = T.history[0];
  const [ic, cls] = !last ? ["transfer", ""] : last.state === "done" && last.failed_count ? ["alert", "warn"] : PAST[last.state] || PAST.failed;
  return `<span class="tx-ico ${cls}">${icon(ic)}</span>`;
}

function renderDock() {
  const dock = $("dock");
  if (T.pressing) return;
  syncSpinnerPhase();
  if (!dock.firstChild) {
    dock.innerHTML = `<div class="dock-head" id="dock-head"></div><div class="bar thin dock-mini" id="dock-mini"><i></i></div>
      <div class="dock-body" id="dock-body"><div id="dock-active"></div><div id="dock-past"></div></div>`;
  }
  dock.hidden = !T.shown;
  document.body.classList.toggle("has-dock", T.shown);
  if (!T.shown) {
    T.pastSig = "";
    document.body.style.setProperty("--dock-h", "0px");
    return;
  }
  dock.classList.toggle("min", T.min);
  const run = T.active.find((j) => j.state === "running");
  const waiting = T.active.filter((j) => j !== run);
  $("dock-head").innerHTML = `<button class="dock-toggle" data-dock="min" aria-expanded="${!T.min}" aria-controls="dock-body">${headIcon()}
      <span class="dock-title"><b>Transfers</b><small>${headSummary()}</small></span></button>
    <button class="btn icon small ghost dock-chev" data-dock="min" title="${T.min ? "Show the list" : "Minimise"}" aria-label="${T.min ? "Show the list" : "Minimise"}">${icon("down")}</button>
    <button class="btn icon small ghost" data-dock="close" title="Hide. Transfers keep going; open them again from the top bar." aria-label="Hide transfers">${icon("x")}</button>`;
  $("dock-mini").hidden = !T.min || !run;
  if (run) $("dock-mini").firstChild.style.width = `${pctOf(run)}%`;
  $("dock-active").innerHTML = (run ? `<ul class="tx-list">${runningItem(run)}</ul>` : "") +
    (waiting.length ? `<h4 class="tx-group">Waiting <small>${waiting.length}</small></h4><ul class="tx-list">${waiting.map(waitingItem).join("")}</ul>` : "");
  const sig = `${T.history.map((j) => j.id).join(",")}|${new Date().toDateString()}`;
  if (sig !== T.pastSig) {
    T.pastSig = sig;
    $("dock-past").innerHTML = T.history.length
      ? `<h4 class="tx-group">Finished <small>${T.history.length}</small><button class="btn small ghost" data-dock="clear">Clear</button></h4>
        <ul class="tx-list">${T.history.map(pastItem).join("")}</ul>`
      : T.active.length ? "" : `<div class="muted-note tx-none">Transfers you start show up here.</div>`;
  }
  for (const j of [...T.active, ...T.history]) wantFiles(j);
  document.body.style.setProperty("--dock-h", `${dock.offsetHeight}px`);
}

/** Opens the panel, or hides it when it is already open. */
export function toggleDock() {
  T.shown = !T.shown;
  if (T.shown) T.min = false;
  store.set("dockMin", T.min);
  renderDock();
  renderStatusbar();
}

export function bindCopy() {
  $("t-cancel").addEventListener("click", () => $("transfer").close());
  $("t-start").addEventListener("click", startTransfer);
  document.addEventListener("click", (e) => { if (e.target.closest("[data-dock-open]")) toggleDock(); });
  // The panel redraws while jobs run; holding it still between press and release keeps clicks on its buttons.
  $("dock").addEventListener("pointerdown", () => { T.pressing = true; });
  addEventListener("pointerup", () => setTimeout(() => { if (T.pressing) { T.pressing = false; renderDock(); } }), true);
  addEventListener("pointercancel", () => { T.pressing = false; });
  $("dock").addEventListener("click", async (e) => {
    const el = e.target.closest("[data-dock]");
    if (!el) return;
    const action = el.dataset.dock, id = el.dataset.id ? Number(el.dataset.id) : undefined;
    if (action === "min") { T.min = !T.min; store.set("dockMin", T.min); renderDock(); return; }
    if (action === "close") { T.shown = false; renderDock(); renderStatusbar(); return; }
    if (action === "files") {
      if (!T.closed.delete(id)) T.closed.add(id);
      T.pastSig = "";
      renderDock();
      return;
    }
    el.disabled = true;
    try {
      if (action === "stop" || action === "cancel") apply(await api("job/cancel", { id }));
      if (action === "forget") apply(await api("job/forget", { id }));
      if (action === "clear") apply(await api("job/forget", {}));
      if (action === "stop") poll();
    } catch (error) {
      el.disabled = false;
      toast(error.message, 4000);
    }
  });
}
