// Settings > Behaviour > Idle jobs: run a recipe pack (or a library rescan) by itself while the manager is open,
// when the handheld is online, Syncthing on it is idle and the cooldown has passed. The server keeps the setting.

import { api, esc, icon, toast } from "./core.js";
import { panel } from "./layout.js";

const J = { data: null, error: "", saving: false };

const when = (ms) => (ms ? new Date(ms).toLocaleString() : "");

function options(d) {
  const c = d.config;
  const current = c.recipePackId ? `pack:${c.recipePackId}` : c.libraryRecipeTrigger ? `lib:${c.libraryRecipeTrigger}` : "";
  const packs = d.packs.map((p) => `<option value="pack:${esc(p.id)}"${current === `pack:${p.id}` ? " selected" : ""}>${esc(p.name)}</option>`).join("");
  const libs = d.libraryTriggers.map((l) => `<option value="lib:${esc(l.id)}"${current === `lib:${l.id}` ? " selected" : ""}>${esc(l.name)}</option>`).join("");
  return `<option value=""${current ? "" : " selected"}>Choose what to run&hellip;</option>`
    + (packs ? `<optgroup label="Recipe packs">${packs}</optgroup>` : "")
    + (libs ? `<optgroup label="Library">${libs}</optgroup>` : "");
}

function body() {
  if (J.error) return `<div class="notice err">${esc(J.error)}</div>`;
  const d = J.data;
  if (!d) return `<p class="muted-note"><span class="spinner sm"></span> Loading&hellip;</p>`;
  const c = d.config, off = J.saving ? " disabled" : "";
  const last = c.lastRunAt ? `Last run ${esc(when(c.lastRunAt))}${c.lastResult ? ` &middot; ${esc(c.lastResult)}` : ""}.` : "Has not run yet.";
  const next = c.enabled && c.lastRunAt ? ` Next run possible after ${esc(when(d.nextAt))}.` : "";
  return `<label class="set-row set-toggle"><span><b>Run jobs when idle</b>
      <small>Checked every minute while the manager is open. Needs Wi-Fi with SSH. Runs only when the handheld is online, Syncthing on it is idle and no copy is running.</small></span>
      <span class="switch"><input type="checkbox" role="switch" data-idle-enable${c.enabled ? " checked" : ""}${off}><span class="switch-track"></span></span></label>
    <div class="set-row"><span><b>What to run</b><small>A recipe pack runs on the handheld, step by step, and stops at the first problem.</small></span>
      <select class="control" data-idle-job${off}>${options(d)}</select></div>
    <div class="set-row"><span><b>Cooldown</b><small>Minutes to wait after a run before the next one (${d.minCooldownMinutes} to ${d.maxCooldownMinutes}).</small></span>
      <input class="control" type="number" min="${d.minCooldownMinutes}" max="${d.maxCooldownMinutes}" step="5" data-idle-cooldown value="${c.cooldownMinutes}"${off}></div>
    <p class="muted-note">${d.running ? `<span class="spinner sm"></span> Running now. ` : ""}${last}${next}</p>`;
}

export function idleJobsPanelHtml() {
  if (!J.data && !J.error) queueMicrotask(load);
  return panel("half", `${icon("clock")} Idle jobs`, `<div id="idle-jobs-box">${body()}</div>`);
}

function paint() {
  const el = document.getElementById("idle-jobs-box");
  if (el) el.innerHTML = body();
}

async function load() {
  try {
    J.data = await api("idle-jobs");
    J.error = "";
  } catch (error) {
    J.error = error.message;
  }
  paint();
}

async function save(patch, done) {
  J.saving = true;
  paint();
  try {
    J.data = await api("idle-jobs", patch);
    J.error = "";
    toast(done, 2200);
  } catch (error) {
    toast(error.message, 5000);
  }
  J.saving = false;
  paint();
}

export function bindIdleJobs(root) {
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.idleEnable !== undefined) {
      save({ enabled: t.checked }, t.checked ? "Idle jobs on" : "Idle jobs off");
    } else if (t.dataset.idleJob !== undefined) {
      const [kind, id = ""] = (t.value || ":").split(/:(.*)/s);
      save(kind === "lib" ? { libraryRecipeTrigger: id, recipePackId: "" } : { recipePackId: id, libraryRecipeTrigger: "" }, "Saved");
    } else if (t.dataset.idleCooldown !== undefined) {
      save({ cooldownMinutes: Number(t.value) }, "Cooldown saved");
    }
  });
}
