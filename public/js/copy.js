// Copying games to the device, and the progress dock every job reports to.

import { $, app, api, esc, human, clock, plural, toast, icon, usbMode, slowHint, devName, busy } from "./core.js";
import { renderDevice, refreshDevice, renderStatusbar } from "./device.js";
import { loadLibrary, resetListing } from "./games.js";
import { resetOverview } from "./overview.js";

let pending = null;
let pollTimer = null;

export async function startPlan(targets, label, { onStart = null } = {}) {
  if (!app.device.target) { toast("Insert TF2 or connect the handheld first"); return; }
  if (busy()) { toast("A job is already running"); return; }
  if ($("viewer").open) $("viewer").close();
  pending = { targets, label, plan: null, onStart };
  $("t-title").textContent = `Transfer to ${devName()}`;
  $("t-scope").textContent = label;
  $("t-plan").innerHTML = `<div class="planning"><span class="spinner"></span> Comparing with what is already on ${esc(devName())}&hellip;${slowHint()}</div>`;
  $("t-start").hidden = true;
  $("t-cancel").textContent = "Cancel";
  if (!$("transfer").open) $("transfer").showModal();
  try {
    pending.plan = await api("games/plan", { volume: app.device.target.id, targets });
    renderPlan();
  } catch (error) {
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
  if (plan.skipped.length) {
    parts.push(`<small style="color:var(--muted)">Skipped ${plan.skipped.map(esc).join(", ")}: stock Anbernic firmware files that MustardOS does not run.</small>`);
  }
  if (plan.too_big.length) {
    parts.push(`<div class="notice err">${esc(plan.too_big[0])} is 4 GB or larger, which FAT32 cannot store. Reformat TF2 as exFAT with setup-device.sh.</div>`);
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
    $("t-space").innerHTML = plan.different.count
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
  start.innerHTML = `${icon("transfer")}<span>Transfer ${count.toLocaleString()} file${count === 1 ? "" : "s"}</span>`;
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

/** Call with the job a POST returned; the dock follows it from there. */
export function jobStarted(job) {
  app.job = job;
  renderDock();
  renderDevice();
  poll();
}

async function jobFinished(job) {
  dispatchEvent(new CustomEvent("job-finished", { detail: job }));
  if (job.kind === "apps") { renderDevice(); return; }
  resetOverview();
  if (job.kind === "art") {
    if (job.copied) {
      await loadLibrary().catch(() => {});
      if (job.state === "done" && !job.failed_count) toast(`Copied ${job.copied.toLocaleString()} image${job.copied === 1 ? "" : "s"} into Roms/`, 3000);
    }
    renderDevice();
    return;
  }
  resetListing();
  refreshDevice();
}

export async function poll() {
  clearTimeout(pollTimer);
  try {
    const result = await api("job");
    const wasRunning = busy();
    if (!result.job || (result.job.state !== "running" && !wasRunning)) return;
    app.job = result.job;
    renderDock();
    renderStatusbar();
    if (busy()) pollTimer = setTimeout(poll, 600);
    else if (wasRunning) jobFinished(app.job);
  } catch {
    pollTimer = setTimeout(poll, 2000);
  }
}

function renderDock() {
  const dock = $("dock"), job = app.job;
  if (!job) { dock.hidden = true; return; }
  dock.hidden = false;
  const pct = job.total_bytes ? Math.min(100, Math.floor((job.done_bytes / job.total_bytes) * 100)) : 100;
  if (job.kind === "art" || job.kind === "artsend") return renderArtDock(job, pct);
  if (job.state === "running") {
    dock.innerHTML = `<div class="dock-head"><span class="spinner"></span><b>Transferring to ${esc(job.target)} &middot; ${esc(job.label)}</b>
        <button class="btn small" data-dock="stop">${icon("stop")}<span>Stop</span></button></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="dock-meta"><span>${pct}% &middot; file ${job.index.toLocaleString()} of ${job.count.toLocaleString()} &middot; ${human(job.done_bytes)} of ${human(job.total_bytes)}</span>
        <span>${job.speed ? `${human(job.speed)}/s &middot; ${clock(job.eta)} left` : "starting"}</span></div>
      <div class="dock-file">${esc(job.current)}</div>`;
    return;
  }
  const title = {
    done: job.failed_count ? `${job.copied.toLocaleString()} transferred, ${job.failed_count} failed` : `Transferred ${plural(job.copied, "file")} (${human(job.done_bytes)}) to ${job.target}`,
    cancelled: `Stopped after ${plural(job.copied, "file")}. The unfinished file was removed.`,
    failed: `Transfer failed: ${job.error}`
  }[job.state];
  const failed = job.failed.length ? `<ul>${job.failed.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>${job.error && job.state === "done" ? `<div class="dock-file">${esc(job.error)}</div>` : ""}` : "";
  dock.innerHTML = `<div class="dock-head"><b>${esc(title)}</b><button class="btn icon small ghost" data-dock="close" title="Close" aria-label="Close">${icon("x")}</button></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="dock-meta"><span>${esc(job.label)}</span><span>${clock(job.elapsed)}</span></div>${failed}`;
}

function renderArtDock(job, pct) {
  const dock = $("dock");
  const images = (n) => plural(n, "image");
  if (job.state === "running" && job.phase === "rebuild") {
    dock.innerHTML = `<div class="dock-head"><span class="spinner"></span><b>Rescanning Roms/ with the new artwork&hellip;</b></div>
      <div class="bar"><i style="width:100%"></i></div>
      <div class="dock-meta"><span>${images(job.copied)} copied into Roms/</span><span>${clock(job.elapsed)}</span></div>`;
    return;
  }
  if (job.state === "running") {
    dock.innerHTML = `<div class="dock-head"><span class="spinner"></span><b>${esc(job.label)}</b>
        <button class="btn small" data-dock="stop">${icon("stop")}<span>Stop</span></button></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="dock-meta"><span>${pct}% &middot; image ${job.index.toLocaleString()} of ${job.count.toLocaleString()} &middot; ${human(job.done_bytes)} of ${human(job.total_bytes)}</span>
        <span>${job.speed ? `${clock(job.eta)} left` : "starting"}</span></div>
      <div class="dock-file">${esc(job.current)}</div>`;
    return;
  }
  const send = job.kind === "artsend";
  const title = {
    done: job.failed_count ? `${images(job.copied)} copied, ${job.failed_count} failed` : send ? `Sent ${images(job.copied)} to ${job.target}` : `Copied ${images(job.copied)} into Roms/`,
    cancelled: `Stopped after ${images(job.copied)}.`,
    failed: `Artwork ${send ? "send" : "sync"} failed: ${job.error}`
  }[job.state];
  const failed = job.failed.length ? `<ul>${job.failed.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : "";
  dock.innerHTML = `<div class="dock-head"><b>${esc(title)}</b><button class="btn icon small ghost" data-dock="close" title="Close" aria-label="Close">${icon("x")}</button></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="dock-meta"><span>${esc(job.label)}</span><span>${clock(job.elapsed)}</span></div>${failed}`;
}

export function bindCopy() {
  $("t-cancel").addEventListener("click", () => $("transfer").close());
  $("t-start").addEventListener("click", startTransfer);
  $("dock").addEventListener("click", async (e) => {
    const action = e.target.closest("[data-dock]")?.dataset.dock;
    if (action === "stop") { await api("job/cancel", {}).catch(() => {}); poll(); }
    if (action === "close") { app.job = null; renderDock(); renderDevice(); }
  });
}
