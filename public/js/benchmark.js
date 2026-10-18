// Device > Benchmark: connectivity, storage speed and a short CPU/thermal load over SSH.

import { $, api, esc, human, icon, toast } from "./core.js";
import { confirmBox } from "./art-images.js";

const TESTS = [
  ["connect", "Connectivity", "SSH reachability, latency, free space, uptime and battery"],
  ["storage", "Storage speed", `Timed write and read of a ${32} MB file on SD1 and TF2`],
  ["cpu", "CPU and thermal", "Short CPU load (up to 20 s) while sampling usage and temperature"],
];

const B = {
  run: null,
  selected: { connect: true, storage: true, cpu: true },
  bound: false,
  pollTimer: null,
  working: "",
};

const running = () => B.run?.state === "running";

function stopPoll() {
  clearTimeout(B.pollTimer);
  B.pollTimer = null;
}

async function refresh() {
  try {
    B.run = await api("handheld/benchmark");
  } catch (error) {
    toast(error.message, 3500);
  }
  renderBenchmark();
  if (running()) B.pollTimer = setTimeout(refresh, 800);
  else stopPoll();
}

export function showBenchmark() {
  if (!B.bound) bind();
  stopPoll();
  refresh();
}

export function renderBenchmark() {
  const box = $("hh-bench");
  if (!box || box.hidden) return;
  const run = B.run;
  const busy = running() || B.working;
  const checks = TESTS.map(([id, label, note]) => {
    const on = B.selected[id];
    return `<label class="hh-bench-check${on ? " on" : ""}">
      <input type="checkbox" data-bench-sel="${id}"${on ? " checked" : ""}${busy ? " disabled" : ""}>
      <span><b>${esc(label)}</b><small>${esc(note)}</small></span></label>`;
  }).join("");
  const actions = `<div class="hh-bench-actions">
    <button class="btn primary" data-bench="run-selected"${busy ? " disabled" : ""}>${icon("play")}<span>Run selected</span></button>
    <button class="btn" data-bench="run-all"${busy ? " disabled" : ""}>${icon("layers")}<span>Run all</span></button>
    <button class="btn danger" data-bench="stop"${running() ? "" : " disabled"}>${icon("stop")}<span>Stop</span></button>
    ${busy ? `<span class="muted-note"><span class="spinner sm"></span> Working...</span>` : ""}
  </div>`;
  box.innerHTML = `<div class="hh-bench">
    <section class="panel full">
      <h2>${icon("gauge")} Benchmark</h2>
      <p class="muted-note">Needs the handheld on Wi-Fi with Secure Shell on. Tests run on the handheld over SSH; storage uses a temporary
        file under <code>.muos-bench/</code> on SD1/TF2 and deletes it afterwards. The CPU test loads all cores for up to 20 seconds.</p>
      <div class="hh-bench-checks">${checks}</div>
      ${actions}
    </section>
    ${statusPanel(run)}
    ${resultsPanel(run)}
    ${logPanel(run)}
  </div>`;
}

function statusPanel(run) {
  if (!run || run.state === "idle") {
    return `<section class="panel full"><h2>Status</h2><p class="muted-note">Pick tests and press <b>Run selected</b> or <b>Run all</b>.</p></section>`;
  }
  const label = run.state === "running" ? `Running${run.current ? `  -  ${esc(run.current)}` : ""}`
    : run.state === "error" ? "Finished with errors"
    : "Finished";
  const pill = run.state === "running" ? "warn" : run.state === "error" ? "bad" : "ok";
  return `<section class="panel full"><h2>Status</h2>
    <div class="hh-bench-status"><span class="set-chip ${pill}">${esc(label)}</span>
      ${run.startedAt ? `<small>Started ${esc(new Date(run.startedAt).toLocaleTimeString())}</small>` : ""}
      ${run.finishedAt ? `<small>Ended ${esc(new Date(run.finishedAt).toLocaleTimeString())}</small>` : ""}</div>
    ${run.error ? `<div class="notice err">${esc(run.error)}</div>` : ""}
    <ul class="hh-bench-phases">${(run.phases || []).map(phaseRow).join("")}</ul>
  </section>`;
}

function phaseRow(p) {
  const title = TESTS.find(([id]) => id === p.id)?.[1] || p.id;
  return `<li class="hh-bench-phase ${esc(p.state)}"><b>${esc(title)}</b><span class="set-chip">${esc(p.state)}</span></li>`;
}

function resultsPanel(run) {
  if (!run?.phases?.length) return "";
  const blocks = run.phases.map((p) => {
    if (p.id === "connect" && p.connect) return connectHtml(p.connect);
    if (p.id === "storage" && p.storage) return storageHtml(p.storage);
    if (p.id === "cpu" && p.cpu) return cpuHtml(p.cpu);
    return "";
  }).filter(Boolean);
  if (!blocks.length) return "";
  return `<section class="panel full"><h2>Results</h2><div class="hh-bench-results">${blocks.join("")}</div></section>`;
}

function connectHtml(c) {
  if (!c.ok) return `<div class="hh-bench-card"><h3>Connectivity</h3><p class="notice err">${esc(c.error || "Failed")}</p></div>`;
  const stores = (c.storage || []).map((s) =>
    `<li><b>${esc(s.name)}</b> ${human(s.free)} free of ${human(s.total)}</li>`).join("") || "<li>No SD1/TF2 mounts reported</li>";
  const load = (c.load || []).map((n) => n.toFixed(2)).join(", ") || "-";
  const batt = c.battery ? `${c.battery.percent}% (${esc(c.battery.status)})` : "-";
  const up = c.uptime ? `${Math.floor(c.uptime / 3600)}h ${Math.floor((c.uptime % 3600) / 60)}m` : "-";
  return `<div class="hh-bench-card"><h3>Connectivity</h3>
    <dl class="kv">
      <dt>SSH latency</dt><dd>${c.latencyMs != null ? `${c.latencyMs} ms` : "-"}</dd>
      <dt>Host</dt><dd>${esc(c.host || "-")}${c.ip ? ` (${esc(c.ip)})` : ""}</dd>
      <dt>Hostname</dt><dd>${esc(c.hostname || "-")}</dd>
      <dt>Uptime</dt><dd>${esc(up)}</dd>
      <dt>Load</dt><dd>${esc(load)}</dd>
      <dt>Battery</dt><dd>${esc(batt)}</dd>
    </dl>
    <ul class="hh-bench-list">${stores}</ul></div>`;
}

function storageHtml(rows) {
  const body = rows.map((r) => {
    if (r.skipped) return `<tr><td>${esc(r.name)}</td><td colspan="2">${esc(r.skipped)}</td></tr>`;
    if (r.error) return `<tr><td>${esc(r.name)}</td><td colspan="2" class="err">${esc(r.error)}</td></tr>`;
    return `<tr><td>${esc(r.name)}</td><td>${r.writeMBps != null ? `${r.writeMBps} MB/s` : "-"}</td><td>${r.readMBps != null ? `${r.readMBps} MB/s` : "-"}</td></tr>`;
  }).join("");
  return `<div class="hh-bench-card"><h3>Storage speed</h3>
    <table class="hh-bench-table"><thead><tr><th>Card</th><th>Write</th><th>Read</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function cpuHtml(c) {
  if (c.error) return `<div class="hh-bench-card"><h3>CPU and thermal</h3><p class="notice err">${esc(c.error)}</p></div>`;
  return `<div class="hh-bench-card"><h3>CPU and thermal</h3>
    <dl class="kv">
      <dt>Duration</dt><dd>${(c.durationMs / 1000).toFixed(1)} s${c.stopped ? " (stopped)" : ""}</dd>
      <dt>Peak CPU</dt><dd>${c.peakCpu != null ? `${c.peakCpu}%` : "-"}</dd>
      <dt>Average CPU</dt><dd>${c.avgCpu != null ? `${c.avgCpu}%` : "-"}</dd>
      <dt>Peak temperature</dt><dd>${c.peakTemp != null ? `${c.peakTemp.toFixed(1)} C` : "-"}</dd>
      <dt>Samples</dt><dd>${(c.samples || []).length}</dd>
    </dl></div>`;
}

function logPanel(run) {
  const lines = run?.log || [];
  if (!lines.length) return "";
  return `<section class="panel full"><h2>Log</h2>
    <pre class="hh-bench-log">${lines.map((l) => esc(l)).join("\n")}</pre></section>`;
}

async function start(tests) {
  if (running()) return;
  if (tests.includes("cpu")) {
    const ok = await confirmBox({
      title: "Run the CPU load test?",
      html: "<p>This loads all CPU cores on the handheld for up to <b>20 seconds</b>. The handheld may get warm. You can stop it from the Benchmark tab.</p>",
      ok: "Run CPU test",
    });
    if (!ok) return;
  }
  B.working = "start";
  renderBenchmark();
  try {
    B.run = await api("handheld/benchmark", { tests });
    stopPoll();
    B.pollTimer = setTimeout(refresh, 400);
  } catch (error) {
    toast(error.message, 4000);
  }
  B.working = "";
  renderBenchmark();
}

async function stop() {
  try {
    B.run = await api("handheld/benchmark/stop", {});
    toast("Stopping...", 2000);
  } catch (error) {
    toast(error.message, 3500);
  }
  renderBenchmark();
}

function bind() {
  B.bound = true;
  const view = $("view-handheld");
  view.addEventListener("click", (e) => {
    const el = e.target.closest("[data-bench]");
    if (!el || el.disabled || $("hh-bench")?.hidden) return;
    const a = el.dataset.bench;
    if (a === "run-all") start(["connect", "storage", "cpu"]);
    else if (a === "run-selected") {
      const tests = TESTS.map(([id]) => id).filter((id) => B.selected[id]);
      if (!tests.length) { toast("Pick at least one test"); return; }
      start(tests);
    } else if (a === "stop") stop();
  });
  view.addEventListener("change", (e) => {
    const t = e.target;
    if (!t.dataset?.benchSel || $("hh-bench")?.hidden) return;
    B.selected[t.dataset.benchSel] = t.checked;
    renderBenchmark();
  });
}
