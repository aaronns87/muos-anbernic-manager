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
  result: null,
  timer: 0,
  onDone: null,
};

const STEPS = ["Review", "Tools", "Options", "Working", "Done"];

function dialog() {
  return $("discfix");
}

function paint() {
  const d = dialog();
  if (!d?.open) return;
  $("dfx-title").textContent = W.batch
    ? `Fix ${W.files.length} PlayStation archives`
    : `Fix ${W.files[0] || "disc"}`;
  $("dfx-step").textContent = `Step ${W.step} of ${STEPS.length}: ${STEPS[W.step - 1]}`;
  $("dfx-body").innerHTML = body();
  const back = $("dfx-back"), next = $("dfx-next"), cancel = $("dfx-cancel");
  back.hidden = W.step === 1 || W.step >= 4;
  cancel.textContent = W.step === 5 ? "Close" : "Cancel";
  next.hidden = W.step === 5;
  if (W.step === 4) {
    next.hidden = true;
  } else if (W.step === 2) {
    next.disabled = W.busy || !toolsReady();
    next.textContent = "Continue";
  } else if (W.step === 3) {
    next.disabled = W.busy;
    next.textContent = W.batch ? `Fix ${W.files.length}` : "Start fix";
  } else {
    next.disabled = W.busy || (W.step === 1 && !W.inspect && !W.batch);
    next.textContent = "Continue";
  }
}

function toolsReady() {
  const t = W.tools;
  if (!t) return false;
  if (W.batch) {
    // Batch may mix zip/7z; require p7zip if any inspect needed - optimistic: require if tool missing only when we know
    return true; // checked per-file at start; UI shows warnings
  }
  const needs = W.inspect?.needs || {};
  if (needs.p7zip && !t.p7zip?.present) return false;
  // chdman optional - cue sets can extract without it
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
    return `<p>These archives are not playable on the handheld as-is. The wizard will unpack each one and place a
      <code>.chd</code> (or <code>.cue</code> + tracks) in <code>Roms/PS</code>.</p>
      <ul class="chk-confirm">${W.files.slice(0, 12).map((f) => `<li><code>${esc(f)}</code></li>`).join("")}
        ${W.files.length > 12 ? `<li>and ${W.files.length - 12} more</li>` : ""}</ul>`;
  }
  if (W.busy && !W.inspect) return `<p class="muted-note"><span class="spinner sm"></span> Looking inside the archive&hellip;</p>`;
  if (W.error && !W.inspect) return `<div class="notice err">${esc(W.error)}</div>`;
  const i = W.inspect;
  if (!i) return `<p class="muted-note">Nothing to review.</p>`;
  const members = (i.members || []).slice(0, 8).map((m) => `<li><code>${esc(m)}</code></li>`).join("");
  return `<p><b>${esc(i.file)}</b> is a <code>.${esc(i.archive || "?")}</code> archive - cores cannot boot it directly.</p>
    <p>${esc(i.plan?.summary || "")}</p>
    <p class="muted-note">${esc(i.outputHint || "")}</p>
    ${members ? `<details><summary>Files inside (${i.members.length}${i.members.length >= 40 ? "+" : ""})</summary><ul class="chk-confirm">${members}</ul></details>` : ""}
    ${i.plan?.kind === "orphanBin" || i.plan?.kind === "unsupported" || i.plan?.kind === "empty"
      ? `<div class="notice err">This archive cannot be fixed automatically.</div>` : ""}`;
}

function stepTools() {
  const t = W.tools;
  if (!t) return `<p class="muted-note"><span class="spinner sm"></span> Checking tools&hellip;</p>`;
  const need7 = W.batch || W.inspect?.needs?.p7zip || W.inspect?.archive === "7z";
  const needChd = W.preferChd && (W.batch || W.inspect?.needs?.chdman || W.inspect?.plan?.kind === "cueSet");
  const row = (label, tool, install, required) => {
    if (!required && !tool.present) return "";
    const ok = tool.present;
    return `<div class="dfx-tool">
      <span class="set-chip ${ok ? "ok" : "warn"}">${ok ? icon("check") : icon("alert")}${esc(label)}${tool.version ? ` ${esc(tool.version)}` : ""}</span>
      ${ok ? `<small class="muted-note">${esc(tool.path)}</small>` : `<div class="notice">${esc(install.summary)}
        <ol class="chk-confirm">${install.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>`}
    </div>`;
  };
  return `<p>Tools needed for this fix on your computer:</p>
    ${row("p7zip (7zz/7z)", t.p7zip, t.install.p7zip, need7)}
    ${row("chdman", t.chdman, t.install.chdman, needChd)}
    ${!need7 && !needChd ? `<p class="muted-note">No extra tools required for this archive (zip extract is built in).</p>` : ""}
    <p><button class="link-btn" data-dfx="refresh-tools"${W.busy ? " disabled" : ""}>Refresh tooling</button></p>
    ${need7 && !t.p7zip.present ? `<div class="notice err">Install p7zip before continuing.</div>` : ""}
    ${needChd && !t.chdman.present ? `<p class="muted-note">Without chdman, cue sheets will be extracted as .cue + .bin (still playable). Prefer installing rom-tools for .chd.</p>` : ""}`;
}

function stepOptions() {
  return `<label class="chk-check"><input type="checkbox" id="dfx-chd"${W.preferChd ? " checked" : ""}> Prefer <code>.chd</code> when chdman is available</label>
    <label class="chk-check"><input type="checkbox" id="dfx-trash"${W.trashArchive ? " checked" : ""}> Move the original archive to the Trash after success</label>
    <p class="muted-note">Nothing on the handheld is changed - re-send the new files from Games when you are ready.</p>`;
}

function stepWork() {
  const run = W.tools && (W.result?.run || null);
  // during work we poll fix from parent; show local phase text
  return `<div class="chk-progress"><div class="meter"><i style="width:${W.busy ? 40 : 100}%"></i></div>
    <small>${W.busy ? `<span class="spinner sm"></span> ${esc(W.error || "Working...")}` : "Finishing..."}</small></div>
    <p class="muted-note">Large discs can take several minutes. Leave this window open.</p>`;
}

function stepDone() {
  if (W.error && !(W.result?.written?.length)) {
    return `<div class="notice err">${esc(W.error)}</div><p class="muted-note">The library was not changed for failed items.</p>`;
  }
  const written = W.result?.written || [];
  return `<div class="notice">${icon("check")}<span><b>Done.</b>
    ${written.length ? ` Wrote ${plural(written.length, "file")}: ${written.slice(0, 6).map((f) => `<code>${esc(f)}</code>`).join(", ")}${written.length > 6 ? "..." : ""}.` : ""}
    ${W.result?.trashedArchive ? " Original archive moved to the Trash." : ""}</span></div>
    <p class="muted-note">Refresh Library check to see the new .chd / .cue entries. Copy them to the handheld from Games.</p>
    ${W.error ? `<div class="notice err">${esc(W.error)}</div>` : ""}`;
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
  W.step = 4;
  W.busy = true;
  W.error = "";
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
        W.error = run.phase ? `${run.phase}: ${run.current || ""}` : run.current || "Working...";
        paint();
        W.timer = setTimeout(poll, 900);
        return;
      }
      W.result = { written: run.written || [], trashedArchive: !!run.trashedArchive, run };
      if (run.error) W.error = run.error;
      W.busy = false;
      W.step = 5;
      paint();
      W.onDone?.();
    } catch (e) {
      W.error = e.message;
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
  if (W.step > 1 && W.step < 4) {
    W.step -= 1;
    paint();
  }
}

function close() {
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
  W.result = null;
  W.onDone = onDone;
  const d = dialog();
  if (!d) return;
  if (!d.dataset.bound) {
    d.dataset.bound = "1";
    $("dfx-cancel").onclick = () => close();
    $("dfx-back").onclick = () => goBack();
    $("dfx-next").onclick = () => goNext();
    d.addEventListener("click", (e) => {
      if (e.target === d && W.step !== 4) close();
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
