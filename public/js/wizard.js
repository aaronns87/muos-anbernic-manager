// First-run setup: the handheld model, the workspace folders, how to connect, and the game data download.
// Opens by itself after a start with a clean cache; Settings can run it again.

import { $, app, api, esc, human, icon, plural, store, toast, ICONS, model, modelInfo, setCardModel } from "./core.js";
import { screenText } from "./devices.js";
import { connection, isLive, setMode, wifiForm } from "./device.js";
import { modelGrid } from "./model-pick.js";
import { loadLibrary } from "./games.js";
import { forgetSettings, shortcutRow } from "./settings.js";
import { openAddGames } from "./add-games.js";
import { checkWhatsNew } from "./whats-new.js";

const STEPS = [["handheld", "Handheld"], ["folders", "Folders"], ["connect", "Connection"], ["data", "Extras"], ["done", "Done"]];
const W = { step: 0, data: null, working: "", model: "" };

const FOLDERS = [
  ["roms", "Roms", "Your games, one folder per system (GBA, MD, PS...), each with an Imgs folder for artwork."],
  ["apps", "apps", "MustardOS apps and updates (.muxapp, .muxupd) to send to the handheld."],
  ["os", "os", "MustardOS card images (.img.gz) for System Tools."],
  ["bios", "bios", "BIOS files the emulators need."],
  ["backups", "backups", "Backups of the handheld's saves."],
  ["themes", "themes", "Themes you make in the Theme Designer."],
];
const MODES = [
  ["usb", "cable", "USB cable", "Plug the handheld in with Configuration \u203a Advanced Settings \u203a USB Function set to MTP."],
  ["wifi", "wifi", "Wi-Fi", "Handheld and computer on the same network, with SFTP + Filebrowser on. Also needed for apps, themes, ports and settings."],
  ["card", "sd", "Card reader", "Take the games card out and put it in this computer. Fastest for many games, and needed for System Tools."],
];

/** Opens the wizard when the server says the first run is not finished yet. */
export async function checkWizard() {
  try {
    const data = await api("settings");
    if (data.wizard) openWizard(data);
  } catch {}
}

export async function openWizard(data = null) {
  W.data = data || (await api("settings").catch(() => null));
  if (!W.data) return;
  W.step = 0;
  W.model = model().id;
  render();
  if (!$("wizard").open) $("wizard").showModal();
}

/** Redraws the open wizard after the connection changed, keeping what was typed into the Wi-Fi form. */
export function renderWizard() {
  if (!$("wizard")?.open || STEPS[W.step][0] !== "connect") return;
  const typed = [...$("wizard").querySelectorAll(".wifi-form input")].map((i) => [i.id, i.value]);
  const focused = document.activeElement?.closest?.(".wifi-form") ? document.activeElement.id : "";
  render();
  for (const [id, value] of typed) if ($(id) && value) $(id).value = value;
  if (focused && $(focused)) $(focused).focus();
}

function render() {
  const [id, title] = STEPS[W.step];
  $("wiz-steps").innerHTML = STEPS.map(([, t], i) => `<li class="${i === W.step ? "on" : i < W.step ? "past" : ""}"><span>${i + 1}</span>${esc(t)}</li>`).join("");
  $("wiz-title").textContent = W.step === 0 ? "Welcome to the muOS Anbernic Manager" : title;
  $("wiz-body").innerHTML = ({ handheld: stepHandheld, folders: stepFolders, connect: stepConnect, data: stepData, done: stepDone })[id]();
  $("wiz-back").hidden = W.step === 0;
  $("wiz-skip").hidden = W.step === STEPS.length - 1;
  $("wiz-next").innerHTML = W.step === STEPS.length - 1 ? `${icon("check")}<span>Start using the manager</span>` : `<span>Next</span>${icon("arrow")}`;
  $("wiz-next").disabled = !!W.working;
}

// ---------------------------------------------------------------- steps

function stepHandheld() {
  const { via } = modelInfo(), live = via === "usb" || via === "wifi" || via === "ssh";
  return `<p class="wiz-lead">A few questions so the manager fits your handheld and finds your files. Everything here can be changed later in Settings.</p>
    <h3 class="wiz-q">Which handheld do you have?</h3>
    ${live ? `<div class="notice ok">${icon("check")} The connected handheld reports itself as the <b>${esc(model().name)}</b>.</div>` : ""}
    <p class="muted-note">The model sets the screen size for artwork and themes, which ports run, which settings exist, and the card names.
      Connected handhelds are recognised over USB and Wi-Fi.</p>
    ${modelGrid(W.model, "data-wiz-model")}`;
}

function folderRow([key, name, note]) {
  const f = W.data.folders[key];
  const state = !f.available ? `<span class="set-chip${key === "roms" ? " bad" : ""}">Missing</span>`
    : key === "roms" ? `<span class="set-chip ${f.count ? "ok" : "warn"}">${plural(f.count, "system folder")}</span>`
    : `<span class="set-chip ok">Ready</span>`;
  return `<div class="wiz-folder"><div><b>${esc(name)}</b><small>${esc(note)}</small></div><code title="${esc(f.path)}"><bdi>${esc(f.path)}</bdi></code>${state}</div>`;
}

function stepFolders() {
  const d = W.data, missing = FOLDERS.filter(([k]) => !d.folders[k].available).length;
  const noSystems = d.folders.roms.available && !d.folders.roms.count;
  return `<p class="wiz-lead">The manager keeps your games and MustardOS files in a workspace on this computer. It never moves or deletes files there without asking.</p>
    <div class="wiz-folders">${FOLDERS.map(folderRow).join("")}</div>
    <div class="panel-actions">
      <button class="btn${missing || noSystems ? " primary" : ""}" data-wiz="create"${missing || noSystems ? "" : " disabled"}>${W.working === "create" ? ICONS.spin : icon("folder")}<span>${missing || noSystems ? `Create ${missing ? "the missing folders" : "the system folders"}` : "Every folder is there"}</span></button>
      ${d.pickFolder ? `<button class="btn" data-wiz="pick-roms">${icon("search")}<span>Use another Roms folder&hellip;</span></button>` : ""}
    </div>
    <p class="muted-note">Already have a Roms folder elsewhere, on an external drive for example? ${d.pickFolder ? "Choose it above, or" : ""} change any folder in Settings.
      ${noSystems ? "Creating the system folders adds an empty folder for each system MustardOS knows." : ""}</p>`;
}

function stepConnect() {
  const conn = connection(), live = isLive(conn), m = model();
  const cards = MODES.map(([mode, ico, label, note]) => `<button type="button" class="wiz-mode${app.ui.mode === mode ? " on" : ""}" data-wiz-mode="${mode}"${mode === "wifi" && !m.wifi ? ` title="The ${esc(m.name)} has no Wi-Fi"` : ""}>
      ${icon(ico)}<span><b>${esc(label)}</b><small>${esc(mode === "wifi" && !m.wifi ? `The ${m.name} has no Wi-Fi.` : note)}</small></span></button>`).join("");
  const status = conn.state === "checking" ? `<div class="muted-note">${ICONS.spin} ${esc(conn.title)}&hellip;</div>`
    : `<div class="notice ${live ? "ok" : ""}">${live ? icon("check") : icon("info")} <b>${esc(conn.title)}</b>${conn.sub ? ` &middot; ${esc(conn.sub)}` : ""}</div>`;
  const extra = app.ui.mode === "wifi" && !live ? wifiForm()
    : app.ui.mode === "usb" && !live && app.device.platform === "darwin" ? `<p class="muted-note">USB needs libmtp: <code>brew install libmtp</code> (installer.sh offers it).</p>` : "";
  return `<p class="wiz-lead">How do you want to reach the handheld? You can switch any time at the top of the Overview. The handheld does not have to be connected now.</p>
    <div class="wiz-modes">${cards}</div>${status}${extra}`;
}

function stepData() {
  const d = W.data, has = d.cache.descriptions > 0;
  const toggle = (key, label, note) => `<label class="set-row set-toggle"><span><b>${label}</b><small>${note}</small></span>
    <span class="switch"><input type="checkbox" role="switch" data-wiz-toggle="${key}"${d.settings[key] ? " checked" : ""}><span class="switch-track"></span></span></label>`;
  return `<p class="wiz-lead">Optional extras. They can all wait; Settings has them too.</p>
    <div class="set-row"><span><b>Game descriptions</b><small>Text, genres, ratings and years for your games from the LaunchBox Games Database${has ? ` &middot; downloaded (${human(d.cache.descriptions)})` : " &middot; about 110 MB, a minute or two"}</small></span>
      <button class="btn${has ? "" : " primary"}" data-wiz="descriptions"${W.working ? " disabled" : ""}>${W.working === "descriptions" ? `${ICONS.spin}<span>Downloading&hellip;</span>` : `${icon("download")}<span>${has ? "Download again" : "Download now"}</span>`}</button></div>
    ${toggle("copyArt", "Send artwork with games", "Copying a game also sends its box art when the handheld has none.")}
    ${toggle("openBrowser", "Open the browser at start", "run.sh opens this page by itself.")}
    ${d.shortcut ? shortcutRow(d.shortcut, "wiz", W.working === "shortcut", !!W.working) : ""}`;
}

function stepDone() {
  const d = W.data, m = model(), conn = connection();
  return `<p class="wiz-lead">You are ready to go.</p>
    <ul class="wiz-sum">
      <li>${icon("handheld")}<span><b>${esc(m.name)}</b> &middot; ${esc(screenText(m))}${m.wifi ? "" : ", no Wi-Fi"}</span></li>
      <li>${icon("folder")}<span>Games in <code>${esc(d.folders.roms.path)}</code> &middot; ${plural(app.all.length, "game")}</span></li>
      <li>${icon(MODES.find(([k]) => k === app.ui.mode)[1])}<span>Connect with ${esc(MODES.find(([k]) => k === app.ui.mode)[2])} &middot; ${esc(conn.title)}</span></li>
    </ul>
    <h3 class="wiz-q">Next steps</h3>
    <div class="wiz-next">
      <button class="btn" data-wiz="add">${icon("plus")}<span>Add games</span></button>
      <a class="btn" href="#overview" data-wiz="go">${icon("grid")}<span>Overview</span></a>
      <a class="btn" href="#wiki" data-wiz="go">${icon("book")}<span>Read the Wiki</span></a>
    </div>`;
}

// ---------------------------------------------------------------- actions

async function finish(open = "") {
  W.data = await api("settings", { wizard: "done" }).catch(() => W.data);
  forgetSettings();
  $("wizard").close();
  if (open === "add") openAddGames();
  else checkWhatsNew();
}

async function run(what, fn) {
  W.working = what;
  render();
  try { await fn(); } catch (error) { toast(error.message, 4000); }
  W.working = "";
  render();
}

$("wizard")?.addEventListener("click", async (e) => {
  const pick = e.target.closest("[data-wiz-model]");
  if (pick) {
    W.model = pick.dataset.wizModel;
    const t = app.device.target;
    if (t && t.mode === "card") setCardModel(t, W.model); else store.set("model", W.model);
    render();
    return;
  }
  const mode = e.target.closest("[data-wiz-mode]");
  if (mode) {
    await setMode(mode.dataset.wizMode);
    render();
    return;
  }
  const el = e.target.closest("[data-wiz], #wiz-next, #wiz-back, #wiz-skip");
  if (!el || el.disabled) return;
  if (el.id === "wiz-next") return W.step === STEPS.length - 1 ? finish() : (W.step++, render());
  if (el.id === "wiz-back") { W.step = Math.max(0, W.step - 1); return render(); }
  if (el.id === "wiz-skip") return finish();
  const what = el.dataset.wiz;
  if (what === "create") {
    return run("create", async () => {
      const r = await api("settings/workspace", {});
      W.data = r;
      forgetSettings();
      await loadLibrary();
      toast(r.created.length ? `Created ${plural(r.created.length, "folder")}` : "Every folder is there");
    });
  }
  if (what === "pick-roms") {
    return run("pick", async () => {
      const { path } = await api("settings/pick-folder", { which: "roms" });
      if (!path) return;
      W.data = await api("settings", { roms: path });
      forgetSettings();
      await loadLibrary();
      toast(`${plural(app.all.length, "game")} in the new Roms folder`, 2600);
    });
  }
  if (what === "descriptions") {
    return run("descriptions", async () => {
      W.data = await api("settings/refresh", { what: "descriptions" });
      forgetSettings();
      await loadLibrary();
      toast("Game descriptions downloaded", 2400);
    });
  }
  if (what === "shortcut") {
    return run("shortcut", async () => {
      W.data = await api("settings/shortcut", {});
      forgetSettings();
      toast(`Added to ${W.data.shortcut.place}`, 2600);
    });
  }
  if (what === "add") return finish("add");
  if (what === "go") return finish();
});

$("wizard")?.addEventListener("change", async (e) => {
  const key = e.target.dataset.wizToggle;
  if (!key) return;
  try {
    W.data = await api("settings", { [key]: e.target.checked });
    forgetSettings();
  } catch (error) { toast(error.message, 3000); }
});

$("wizard")?.addEventListener("dblclick", (e) => { if (e.target.closest("[data-wiz-model]")) $("wiz-next").click(); });

