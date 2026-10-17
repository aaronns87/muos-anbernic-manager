// Modal wizard: inspect PlayStation archives, check tools, extract / convert to CHD.

import { $, api, esc, icon, plural, toast } from "./core.js";

const W = {
  open: false,
  step: 1,
  code: "PS",
  files: [],
  batch: false,
  inspect: null,
  tools: null,
  preferChd: true,
  trashArchive: true,
  busy: false,
  error: "",
  status: "",
  result: null,
  timer: 0,
  onDone: null,
};

const STEPS = ["Review", "Tools", "Options", "Working", "Done"];
const PHASE_PCT = { start: 8, extract: 28, convert: 58, place: 78, trash: 92 };

function dialog() {
  return $("discfix");
}

function paintSteps() {
  const el = $("dfx-steps");
  if (!el) return;
  el.innerHTML = STEPS.map((name, i) => {
    const n = i + 1;
    const cls = n < W.step ? "past" : n === W.step ? "on" : "";
    return `<li class="${cls}"${n === W.step ? ` aria-current="step"` : ""}><span>${n}</span>${esc(name)}</li>`;
  }).join("");
}

function paint() {
  const d = dialog();
  if (!d?.open) return;
  d.setAttribute("aria-busy", W.busy && W.step === 4 ? "true" : "false");
  $("dfx-title").textContent = W.batch
    ? `Fix ${W.files.length} PlayStation archives`
    : `Fix ${W.files[0] || "disc"}`;
  paintSteps();
  $("dfx-body").innerHTML = body();
  const back = $("dfx-back"), next = $("dfx-next"), cancel = $("dfx-cancel");
  back.hidden = W.step === 1 || W.step >= 4;
  back.disabled = W.busy;
  cancel.hidden = W.step === 5;
  cancel.disabled = W.step === 4;
  cancel.textContent = "Cancel";
  if (W.step === 5) {
    next.hidden = false;
    next.disabled = false;
    next.textContent = "Done";
    next.classList.toggle("primary", true);
  } else if (W.step === 4) {
    next.hidden = true;
    next.disabled = true;
  } else if (W.step === 2) {
    next.hidden = false;
    next.disabled = W.busy || !toolsReady();
    next.textContent = "Continue";
  } else if (W.step === 3) {
    next.hidden = false;
    next.disabled = W.busy;
    next.textContent = W.batch ? `Fix ${W.files.length}` : "Start fix";
  } else {
    next.hidden = false;
    next.disabled = W.busy || (W.step === 1 && !W.inspect && !W.batch);
    next.textContent = "Continue";
  }
}

function toolsReady() {
  const t = W.tools;
  if (!t) return false;
  if (W.batch) return true;
  const needs = W.inspect?.needs || {};
  if (needs.p7zip && !t.p7zip?.present) return false;
  return true;
}

function body() {
  if (W.step === 1) return stepReview();
  if (W.step === 2) return stepTools();
  if (W.step === 3) return stepOptions();
  if (W.step === 4) return stepWork();
  return stepDone();
}

function stepReview() {
  if (W.batch) {
    return `<p>These archives are not playable on the handheld as-is. The wizard unpacks each one and places a
      <code>.chd</code> (or <code>.cue</code> + tracks) in <code>Roms/PS</code>.</p>
      <ul class="chk-confirm">${W.files.slice(0, 12).map((f) => `<li><code>${esc(f)}</code></li>`).join("")}
        ${W.files.length > 12 ? `<li>and ${W.files.length - 12} more</li>` : ""}</ul>`;
  }
  if (W.busy && !W.inspect) {
    return `<div class="dfx-wait"><span class="spinner"></span><div><b>Looking inside the archive</b>
      <small class="muted-note">Checking format and disc sheets&hellip;</small></div></div>`;
  }
  if (W.error && !W.inspect) return `<div class="notice err">${esc(W.error)}</div>`;
  const i = W.inspect;
  if (!i) return `<p class="muted-note">Nothing to review.</p>`;
  const members = (i.members || []).slice(0, 8).map((m) => `<li><code>${esc(m)}</code></li>`).join("");
  const kind = i.plan?.kind || "";
  const blocked = kind === "orphanBin" || kind === "unsupported" || kind === "empty";
  return `<div class="dfx-card">
      <div class="dfx-card-head">
        <b title="${esc(i.file)}">${esc(i.file)}</b>
        <span class="set-chip ${blocked ? "bad" : "ok"}">${icon(blocked ? "alert" : "check")}.${esc(i.archive || "?")}</span>
      </div>
      <p>${esc(i.plan?.summary || "")}</p>
      ${i.outputHint ? `<p class="muted-note">${esc(i.outputHint)}</p>` : ""}
    </div>
    ${members ? `<details class="dfx-details"><summary>Files inside (${i.members.length}${i.members.length >= 40 ? "+" : ""})</summary>
      <ul class="chk-confirm">${members}</ul></details>` : ""}
    ${blocked ? `<div class="notice err">This archive cannot be fixed automatically.</div>` : ""}`;
}

function stepTools() {
  const t = W.tools;
  if (!t) {
    return `<div class="dfx-wait"><span class="spinner"></span><div><b>Checking tools</b>
      <small class="muted-note">Looking for p7zip and chdman on your PATH&hellip;</small></div></div>`;
  }
  const need7 = W.batch || W.inspect?.needs?.p7zip || W.inspect?.archive === "7z";
  const needChd = W.preferChd && (W.batch || W.inspect?.needs?.chdman || W.inspect?.plan?.kind === "cueSet");
  const row = (label, tool, install, required) => {
    if (!required && !tool.present) return "";
    const ok = tool.present;
    return `<div class="dfx-tool${ok ? "" : " missing"}">
      <div class="dfx-tool-head">
        <span class="set-chip ${ok ? "ok" : "warn"}">${ok ? icon("check") : icon("alert")}${esc(label)}${tool.version ? ` ${esc(tool.version)}` : ""}</span>
        ${required && !ok ? `<span class="muted-note">Required</span>` : !required && !ok ? `<span class="muted-note">Optional</span>` : ""}
      </div>
      ${ok ? `<small class="muted-note">${esc(tool.path)}</small>` : `<div class="notice">${esc(install.summary)}
        <ol class="chk-confirm">${install.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>`}
    </div>`;
  };
  return `<p class="muted-note">Tools on this computer for unpacking and converting. Nothing is installed automatically.</p>
    ${row("p7zip (7zz/7z)", t.p7zip, t.install.p7zip, need7)}
    ${row("chdman", t.chdman, t.install.chdman, needChd)}
    ${!need7 && !needChd ? `<p class="muted-note">No extra tools required for this archive (zip extract is built in).</p>` : ""}
    <p><button class="link-btn" data-dfx="refresh-tools"${W.busy ? " disabled" : ""}>Refresh tooling</button></p>
    ${need7 && !t.p7zip.present ? `<div class="notice err">Install p7zip before continuing.</div>` : ""}
    ${needChd && !t.chdman.present ? `<p class="muted-note">Without chdman, cue sheets extract as .cue + .bin (still playable). Prefer <code>brew install rom-tools</code> for .chd.</p>` : ""}`;
}

function stepOptions() {
  return `<div class="dfx-opts">
      <label class="chk-check dfx-opt"><input type="checkbox" id="dfx-chd"${W.preferChd ? " checked" : ""}>
        <span><b>Prefer <code>.chd</code></b><small>When chdman is available; otherwise keep .cue + tracks.</small></span></label>
      <label class="chk-check dfx-opt"><input type="checkbox" id="dfx-trash"${W.trashArchive ? " checked" : ""}>
        <span><b>Move archive to the Trash</b><small>Only after a successful fix. You can restore it from Trash.</small></span></label>
    </div>
    <p class="muted-note">The handheld is not changed. Copy the new files from Games when you are ready.</p>`;
}

function stepWork() {
  const run = W.result?.run;
  const phase = run?.phase || (W.status.includes(":") ? W.status.split(":")[0] : "");
  const pct = W.busy ? (PHASE_PCT[phase] || 35) : 100;
  const label = W.busy ? (W.status || "Working...") : "Finishing...";
  return `<div class="dfx-work">
      <div class="chk-progress"><div class="meter"><i style="width:${pct}%"></i></div>
        <small>${W.busy ? `<span class="spinner sm"></span> ` : ""}${esc(label)}</small></div>
      <p class="muted-note">Large discs can take several minutes. Leave this window open; Cancel is disabled until it finishes.</p>
    </div>`;
}

function stepDone() {
  const written = W.result?.written || [];
  const failed = !!(W.error && !written.length);
  if (failed) {
    return `<div class="notice err">${esc(W.error)}</div>
      <p class="muted-note">The library was not changed for failed items. Fix the issue and try again.</p>`;
  }
  return `<div class="notice">${icon("check")}<span><b>Done.</b>
    ${written.length ? ` Wrote ${plural(written.length, "file")}: ${written.slice(0, 6).map((f) => `<code>${esc(f)}</code>`).join(", ")}${written.length > 6 ? "..." : ""}.` : ""}
    ${W.result?.trashedArchive ? " Original archive moved to the Trash." : ""}</span></div>
    <p class="muted-note">Refresh Library check to see the new entries. Copy them to the handheld from Games.
      If a .chd opens then quits on the handheld, try <b>SwanStation</b> under Emulation &rsaquo; Cores.</p>
    ${W.error && written.length ? `<div class="notice">${icon("info")}<span>Finished with a note: ${esc(W.error)}</span></div>` : ""}`;
}

async function loadTools() {
  W.busy = true;
  paint();
  try {
    const fix = await api("disc-fix");
    W.tools = fix.tools;
  } catch (e) {
    W.error = e.message;
  }
  W.busy = false;
  paint();
}

async function loadInspect() {
  if (W.batch) return;
  W.busy = true;
  W.inspect = null;
  W.error = "";
  paint();
  try {
    W.inspect = await api("disc-fix/inspect", { code: W.code, file: W.files[0] });
    if (W.inspect.plan?.kind === "orphanBin" || W.inspect.plan?.kind === "unsupported" || W.inspect.plan?.kind === "empty") {
      W.error = W.inspect.plan.summary;
    }
  } catch (e) {
    W.error = e.message;
  }
  W.busy = false;
  paint();
}

async function startFix() {
  if (W.busy || W.step >= 4) return;
  W.step = 4;
  W.busy = true;
  W.error = "";
  W.status = "Starting...";
  W.result = null;
  paint();
  try {
    const body = { code: W.code, trashArchive: W.trashArchive, preferChd: W.preferChd };
    const res = W.batch
      ? await api("disc-fix/batch", { ...body, files: W.files })
      : await api("disc-fix/start", { ...body, file: W.files[0] });
    W.tools = res.tools;
    await waitForRun();
  } catch (e) {
    W.error = e.message;
    W.status = "";
    W.busy = false;
    W.step = 5;
    paint();
  }
}

async function waitForRun() {
  clearTimeout(W.timer);
  const poll = async () => {
    try {
      const fix = await api("disc-fix");
      W.tools = fix.tools;
      const run = fix.run;
      if (run.running) {
        W.status = run.phase ? `${run.phase}: ${run.current || ""}` : run.current || "Working...";
        W.result = { run };
        paint();
        W.timer = setTimeout(poll, 900);
        return;
      }
      W.result = { written: run.written || [], trashedArchive: !!run.trashedArchive, run };
      // Never keep the last phase label (e.g. "convert: Game.cue") as an error after success.
      W.error = run.error || "";
      W.status = "";
      W.busy = false;
      W.step = 5;
      paint();
      W.onDone?.();
    } catch (e) {
      W.error = e.message;
      W.status = "";
      W.busy = false;
      W.step = 5;
      paint();
    }
  };
  W.timer = setTimeout(poll, 600);
}

function readOptions() {
  W.preferChd = $("dfx-chd")?.checked ?? W.preferChd;
  W.trashArchive = $("dfx-trash")?.checked ?? W.trashArchive;
}

async function goNext() {
  if (W.busy && W.step < 5) return;
  if (W.step === 5) { close(); return; }
  if (W.step >= 4) return;
  if (W.step === 1) {
    if (!W.batch && (W.inspect?.plan?.kind === "orphanBin" || W.inspect?.plan?.kind === "unsupported" || W.inspect?.plan?.kind === "empty")) {
      toast(W.inspect.plan.summary, 4000);
      return;
    }
    W.step = 2;
    if (!W.tools) await loadTools();
    else paint();
    return;
  }
  if (W.step === 2) {
    if (!toolsReady()) {
      toast("Install the required tools, then Refresh tooling", 3500);
      return;
    }
    W.step = 3;
    paint();
    return;
  }
  if (W.step === 3) {
    readOptions();
    await startFix();
  }
}

function goBack() {
  if (W.busy || W.step <= 1 || W.step >= 4) return;
  W.step -= 1;
  paint();
}

function close() {
  if (W.step === 4) return;
  clearTimeout(W.timer);
  W.open = false;
  dialog()?.close();
}

export function openDiscFixWizard({ code = "PS", files = [], onDone = null } = {}) {
  const list = [...new Set(files.map(String).filter(Boolean))];
  if (!list.length) return;
  W.open = true;
  W.step = 1;
  W.code = code;
  W.files = list;
  W.batch = list.length > 1;
  W.inspect = null;
  W.tools = null;
  W.preferChd = true;
  W.trashArchive = true;
  W.busy = false;
  W.error = "";
  W.status = "";
  W.result = null;
  W.onDone = onDone;
  const d = dialog();
  if (!d) return;
  if (!d.dataset.bound) {
    d.dataset.bound = "1";
    $("dfx-cancel").onclick = () => close();
    $("dfx-back").onclick = () => goBack();
    $("dfx-next").onclick = () => goNext();
    d.addEventListener("cancel", (e) => {
      if (W.step === 4) e.preventDefault();
    });
    d.addEventListener("click", (e) => {
      if (e.target === d && W.step !== 4 && W.step !== 5) close();
      const el = e.target.closest("[data-dfx]");
      if (el?.dataset.dfx === "refresh-tools") loadTools();
    });
    d.addEventListener("change", (e) => {
      if (e.target.id === "dfx-chd") W.preferChd = e.target.checked;
      if (e.target.id === "dfx-trash") W.trashArchive = e.target.checked;
    });
  }
  d.showModal();
  paint();
  loadTools();
  if (!W.batch) loadInspect();
}
