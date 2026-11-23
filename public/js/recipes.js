// Library recipes: short automations that chain existing manager APIs (scrape, copy, rescan).

import { api, app, esc, icon, store, toast, canQueue, ready, plural, busy } from "./core.js";
import { isLive, connection } from "./device.js";
import { jobStarted } from "./copy.js";
import { recipeScrapeMissing } from "./art-scrape.js";
import { loadLibrary } from "./games.js";

const STORAGE = "libraryRecipes";

export const STEP_DEFS = {
  scrape_missing_added: { label: "Scrape missing art for added games", short: "Scrape added" },
  scrape_missing_all: { label: "Scrape all missing box art", short: "Scrape missing" },
  queue_copy_added: { label: "Queue copy of added games", short: "Copy added" },
  queue_copy_missing: { label: "Queue copy of games missing on device", short: "Copy missing" },
  rescan_library: { label: "Rescan Roms/", short: "Rescan" },
  // Steps of shareable recipe packs (src/recipes.ts). They run on the handheld over SSH, not in the library editor.
  core_folder: { label: "Set folder core", short: "Folder core", pack: true },
  core_game: { label: "Set game core", short: "Game core", pack: true },
  core_game_reset: { label: "Reset game core", short: "Reset core", pack: true },
  cheats_apply: { label: "Apply cheats", short: "Cheats", pack: true },
  cheats_remove: { label: "Remove cheats", short: "No cheats", pack: true },
  governor_set: { label: "Set CPU governor", short: "Governor", pack: true },
  tuning_apply: { label: "Apply game tuning", short: "Tuning", pack: true },
};

export const PRESETS = [
  {
    id: "after-add",
    name: "After add games",
    about: "Scrape missing box art for the games you added, then queue a copy when a link is live.",
    triggers: ["after-add"],
    steps: ["scrape_missing_added", "queue_copy_added"],
  },
  {
    id: "after-scrape",
    name: "After scrape saves",
    about: "When Scrape finishes saving images, queue a copy of games still missing on the handheld.",
    triggers: ["after-scrape"],
    steps: ["queue_copy_missing"],
  },
  {
    id: "add-transfer",
    name: "Add and transfer",
    about: "Only queue a copy of newly added games (no scrape).",
    triggers: ["after-add"],
    steps: ["queue_copy_added"],
    defaultOff: true,
  },
  {
    id: "rescan",
    name: "Quick rescan",
    about: "Rescan Roms/ after files changed outside the manager.",
    triggers: ["manual"],
    steps: ["rescan_library"],
  },
];

const TRIGGER_LABEL = { "after-add": "After add games", "after-scrape": "After scrape", manual: "Manual only" };

function loadCfg() {
  const raw = store.get(STORAGE, {});
  return raw && typeof raw === "object" ? raw : {};
}

function saveCfg(cfg) {
  store.set(STORAGE, cfg);
}

function presetOf(id) {
  return PRESETS.find((p) => p.id === id);
}

export function recipeEnabled(id) {
  const p = presetOf(id);
  const row = loadCfg()[id];
  if (row?.enabled === false) return false;
  if (p?.defaultOff) return row?.enabled === true;
  return row?.enabled !== false;
}

export function recipeSteps(id) {
  const custom = loadCfg()[id]?.steps;
  if (Array.isArray(custom) && custom.length) {
    return custom.filter((s) => STEP_DEFS[s]);
  }
  return presetOf(id)?.steps || [];
}

function setRecipe(id, patch) {
  const cfg = loadCfg();
  cfg[id] = { ...(cfg[id] || {}), ...patch };
  saveCfg(cfg);
}

let running = false;

export async function fireRecipes(trigger, context = {}) {
  if (running || busy()) return;
  const list = PRESETS.filter((p) => p.triggers.includes(trigger) && recipeEnabled(p.id));
  if (!list.length) return;
  running = true;
  try {
    for (const preset of list) {
      await runRecipe(preset.id, context);
    }
  } finally {
    running = false;
  }
}

/** Manual run from Settings. */
export async function runRecipe(id, context = {}) {
  const preset = presetOf(id);
  if (!preset) { toast("Unknown recipe"); return; }
  const steps = recipeSteps(id);
  if (!steps.length) { toast("This recipe has no steps"); return; }
  for (const step of steps) {
    if (busy() && (step.startsWith("queue_copy") || step.startsWith("scrape"))) {
      toast("Recipe paused: wait for the current transfer to finish", 3500);
      break;
    }
    await runStep(step, context);
  }
}

async function runStep(step, context) {
  if (step === "rescan_library") {
    await api("games/rescan", {});
    await loadLibrary();
    toast("Library rescanned", 2200);
    return;
  }
  if (step === "scrape_missing_added") {
    const added = context.added || [];
    const codes = [...new Set(added.map((g) => g.code).filter(Boolean))];
    if (!added.length) return;
    const match = (item) => added.some((g) => g.code === item.code && (g.stem === item.stem || g.file === item.file));
    const r = await recipeScrapeMissing({ systems: codes, match, max: added.length + 20 });
    if (r.saved) toast(`Recipe saved ${plural(r.saved, "image")} to Roms/`, 3500);
    return;
  }
  if (step === "scrape_missing_all") {
    const r = await recipeScrapeMissing({ max: 120 });
    if (r.saved) toast(`Recipe saved ${plural(r.saved, "image")} to Roms/`, 3500);
    return;
  }
  if (step === "queue_copy_added") {
    const paths = (context.added || []).map((g) => `${g.code}/${g.file || g.stem}`).filter((p) => p.includes("/"));
    if (!paths.length) return;
    await queueCopy(paths, "Added games");
    return;
  }
  if (step === "queue_copy_missing") {
    const paths = missingOnDevice();
    if (!paths.length) return;
    await queueCopy(paths, "Games missing on device");
  }
}

function missingOnDevice() {
  if (!app.data?.systems) return [];
  const paths = [];
  for (const sys of app.data.systems) {
    for (const g of sys.games || []) {
      const key = `${sys.code}/${g.f}`;
      const st = app.device.files?.[key];
      if (st !== "same" && st !== "check") paths.push(key);
    }
  }
  return paths;
}

async function queueCopy(targets, label) {
  if (!ready() || !isLive(connection())) {
    toast("Recipe skipped copy: connect the handheld or card first", 3500);
    return;
  }
  if (!canQueue()) {
    toast("Recipe skipped copy: over USB, wait for the current transfer", 4000);
    return;
  }
  if (store.get("waitSyncthingIdle", false) === true) {
    try {
      const gate = await api("ssh/syncthing-idle/wait");
      if (gate.waited) toast("Waited for Syncthing to finish syncing", 3000);
    } catch { /* non-fatal */ }
  }
  try {
    const result = await api("games/copy", {
      volume: app.device.target.id,
      targets,
      label: label.slice(0, 120),
      replace: false,
    });
    jobStarted(result.job);
    toast("Recipe queued a transfer", 2500);
  } catch (error) {
    if (/nothing to copy/i.test(error.message)) return;
    toast(error.message, 5000);
  }
}

export function recipesPanelHtml() {
  const cfg = loadCfg();
  const rows = PRESETS.map((p) => {
    const on = recipeEnabled(p.id);
    const steps = recipeSteps(p.id);
    const triggers = p.triggers.map((t) => TRIGGER_LABEL[t] || t).join(", ");
    const stepChips = steps.map((s) => STEP_DEFS[s]?.short || s).join(" \u2192 ") || "No steps";
    const stepOpts = Object.entries(STEP_DEFS).filter(([, d]) => !d.pack).map(([id, d]) => {
      const picked = steps.includes(id);
      return `<label class="recipe-step"><input type="checkbox" data-recipe-step="${esc(p.id)}" data-step="${esc(id)}"${picked ? " checked" : ""}${on ? "" : " disabled"}>
        <span>${esc(d.label)}</span></label>`;
    }).join("");
    return `<article class="recipe-row">
      <div class="recipe-head">
        <label class="set-row set-toggle recipe-toggle">
          <span><b>${esc(p.name)}</b><small>${esc(p.about)}</small></span>
          <span class="switch"><input type="checkbox" role="switch" data-recipe-enable="${esc(p.id)}"${on ? " checked" : ""}><span class="switch-track"></span></span>
        </label>
        <span class="set-chip">${esc(triggers)}</span>
      </div>
      <p class="muted-note recipe-flow"><span aria-hidden="true">&rarr;</span><span>${esc(stepChips)}</span></p>
      <details class="recipe-steps"${on ? "" : " hidden"}><summary>Edit steps</summary>${stepOpts}</details>
      ${p.triggers.includes("manual") || on ? `<button class="btn small" data-recipe-run="${esc(p.id)}" type="button">${icon("play")}<span>Run now</span></button>` : ""}
    </article>`;
  }).join("");
  return `<section class="panel full recipe-panel"><h2>${icon("layers")} Library recipes</h2>
    <p class="muted-note">Small automations that call scrape, copy and rescan for you. Over USB only one transfer runs at a time; extra copies wait in Transfers.
      Toggle Syncthing wait under Connection when large copies should wait for sync to settle.</p>
    <div class="recipe-list">${rows}</div>${packsHtml()}</section>`;
}

// ---------------------------------------------------------------- shareable packs

const PK = { list: null, error: "", busy: "" };

function stepLine(s) {
  const bits = [s.folder, s.file || s.name, s.core || s.gov].filter(Boolean).join(" \u00b7 ");
  return `${STEP_DEFS[s.type]?.short || s.label || s.type}${bits ? `: ${bits}` : ""}`;
}

function packsHtml() {
  if (!PK.list && !PK.error) queueMicrotask(loadPacks);
  return `<section class="recipe-packs"><h3>Recipe packs</h3>
    <p class="muted-note">Shareable JSON files that set a core, apply cheats or choose a CPU governor on the handheld.
      They need Wi-Fi with SSH. Import a pack from a friend, or export one to share. Steps run in order and stop at the first problem.</p>
    <div class="recipe-pack-bar">
      <button class="btn small" data-pack-import type="button">${icon("upload")}<span>Import pack</span></button>
      <input type="file" id="recipe-pack-file" accept=".json,application/json" hidden>
    </div>
    <div id="recipe-pack-list">${packListHtml()}</div></section>`;
}

function packListHtml() {
  if (PK.error) return `<div class="notice err">${esc(PK.error)}</div>`;
  if (!PK.list) return `<p class="muted-note"><span class="spinner sm"></span> Loading packs&hellip;</p>`;
  if (!PK.list.length) return `<p class="muted-note">No packs yet. Import one to get started.</p>`;
  return PK.list.map((p) => {
    const off = PK.busy ? " disabled" : "";
    return `<article class="recipe-row recipe-pack">
      <div class="recipe-head">
        <span class="recipe-toggle"><b>${esc(p.name)}</b>${p.builtin ? ` <span class="set-chip">Built in</span>` : ""}<small class="muted-note">${esc(p.about)}</small></span>
        <span class="recipe-pack-actions">
          <button class="btn small primary" data-pack-run="${esc(p.id)}" type="button"${off}>${PK.busy === p.id ? `<span class="spinner sm"></span>` : icon("play")}<span>Run</span></button>
          <button class="btn small ghost" data-pack-export="${esc(p.id)}" type="button"${off}>${icon("download")}<span>Export</span></button>
          ${p.builtin ? "" : `<button class="btn small ghost" data-pack-delete="${esc(p.id)}" type="button"${off}>${icon("trash")}<span>Remove</span></button>`}
        </span>
      </div>
      <ol class="muted-note recipe-pack-steps">${p.steps.map((s) => `<li>${esc(stepLine(s))}</li>`).join("")}</ol>
    </article>`;
  }).join("");
}

function paintPacks() {
  const el = document.getElementById("recipe-pack-list");
  if (el) el.innerHTML = packListHtml();
}

async function loadPacks() {
  try {
    PK.list = (await api("recipes")).packs;
    PK.error = "";
  } catch (error) {
    PK.error = error.message;
  }
  paintPacks();
}

async function importFile(file) {
  if (!file) return;
  if (file.size > 512 * 1024) { toast("That file is too big to be a recipe pack", 4000); return; }
  try {
    const r = await api("recipes/import", { json: await file.text() });
    PK.list = r.packs;
    paintPacks();
    toast(r.replaced ? "Recipe pack updated" : "Recipe pack imported", 2600);
  } catch (error) {
    toast(error.message, 5000);
  }
}

async function exportPackFile(id) {
  try {
    const { pack, name } = await api(`recipes/export?${new URLSearchParams({ id })}`);
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(pack, null, 2)}\n`], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (error) {
    toast(error.message, 5000);
  }
}

async function runPackById(id) {
  if (PK.busy) return;
  PK.busy = id;
  paintPacks();
  try {
    const r = await api("recipes/run", { id });
    if (r.ok) toast(`${r.name}: ${r.done} of ${r.total} steps done`, 3500);
    else toast(`${r.name} stopped after ${r.done} of ${r.total} steps: ${r.results.find((x) => !x.ok)?.error || "a step failed"}`, 7000);
  } catch (error) {
    toast(error.message, 5000);
  }
  PK.busy = "";
  paintPacks();
}

async function deletePackById(id) {
  try {
    PK.list = (await api("recipes/delete", { id })).packs;
    paintPacks();
    toast("Recipe pack removed", 2400);
  } catch (error) {
    toast(error.message, 5000);
  }
}

export function bindRecipes(root) {
  root.addEventListener("change", (e) => {
    const en = e.target.closest("[data-recipe-enable]");
    if (en) {
      setRecipe(en.dataset.recipeEnable, { enabled: en.checked });
      return;
    }
    const st = e.target.closest("[data-recipe-step]");
    if (!st) return;
    const id = st.dataset.recipeStep;
    const checks = [...root.querySelectorAll(`[data-recipe-step="${id}"]`)];
    const steps = checks.filter((c) => c.checked).map((c) => c.dataset.step).filter((s) => STEP_DEFS[s]);
    if (!steps.length) {
      st.checked = true;
      toast("Keep at least one step", 2500);
      return;
    }
    setRecipe(id, { steps });
  });
  root.addEventListener("change", (e) => {
    if (e.target.id !== "recipe-pack-file") return;
    importFile(e.target.files[0]);
    e.target.value = "";
  });
  root.addEventListener("click", (e) => {
    const pk = e.target.closest("[data-pack-import],[data-pack-run],[data-pack-export],[data-pack-delete]");
    if (pk && !pk.disabled) {
      const d = pk.dataset;
      if (d.packImport !== undefined) root.querySelector("#recipe-pack-file")?.click();
      else if (d.packRun) runPackById(d.packRun);
      else if (d.packExport) exportPackFile(d.packExport);
      else if (d.packDelete) deletePackById(d.packDelete);
      return;
    }
    const run = e.target.closest("[data-recipe-run]");
    if (!run || run.disabled) return;
    runRecipe(run.dataset.recipeRun).catch((err) => toast(err.message, 5000));
  });
}
