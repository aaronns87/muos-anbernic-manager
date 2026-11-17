// Hints & Tips carousel: walks through important features on startup (optional) and from Help / Settings.

import { $, esc, icon, store } from "./core.js";

/** Curated walkthrough steps. `go` is an optional hash deep-link into that section. */
export const TIPS = [
  {
    id: "welcome",
    icon: "star",
    title: "Welcome to the manager",
    body: "This browser tab looks after your MustardOS handheld: games in Roms/, artwork, apps, themes, saves and settings. Keep the terminal that started it open while you work.",
  },
  {
    id: "connect",
    icon: "plug",
    title: "Connect how you like",
    body: "Use a card reader for fast copies and System Tools, USB (MTP) for the cable, or Wi-Fi for apps, themes and Device settings. The top-bar chip opens the connection panel for paths and web services.",
    go: "#overview",
    goLabel: "Open Overview",
  },
  {
    id: "games",
    icon: "handheld",
    title: "Your Roms/ library",
    body: "Games lists every system with search, filters and grid or list views. Add titles, see what is already on the handheld, and transfer what is missing in one go.",
    go: "#games",
    goLabel: "Open Games",
  },
  {
    id: "artwork",
    icon: "image",
    title: "Box art and descriptions",
    body: "Artwork scrapes missing covers and notes from online databases, sized for your handheld's screen, then syncs them to the device when you are connected.",
    go: "#artwork",
    goLabel: "Open Artwork",
  },
  {
    id: "os",
    icon: "sd",
    title: "MustardOS images",
    body: "OS keeps local mustardos_<version> folders, shows release notes, and opens the OS market for official downloads. Install hands the image to System Tools.",
    go: "#os",
    goLabel: "Open OS",
  },
  {
    id: "apps",
    icon: "package",
    title: "App market",
    body: "Browse popular MustardOS packages with screenshots and notes, pick the build for your handheld and MustardOS release, then send and install over Wi-Fi.",
    go: "#apps",
    goLabel: "Open Apps",
  },
  {
    id: "device",
    icon: "sliders",
    title: "Device settings and Controls",
    body: "Change MustardOS options from this computer over SSH, calibrate analogs with live sticks, and run short benchmarks when the handheld is reachable.",
    go: "#handheld",
    goLabel: "Open Device",
  },
  {
    id: "themes",
    icon: "palette",
    title: "Themes and the Designer",
    body: "Browse community themes for your screen, or build your own in the Designer with live previews, then export a .muxthm or install and apply over Wi-Fi.",
    go: "#themes",
    goLabel: "Open Themes",
  },
  {
    id: "emulation",
    icon: "gamepad",
    title: "Emulation and library checks",
    body: "Back up saves, fix BIOS names, choose cores, edit RetroArch options, and run health checks (dumps, duplicates, disc layouts) with Fix and CHD helpers when tools are installed.",
    go: "#emulation",
    goLabel: "Open Emulation",
  },
  {
    id: "files",
    icon: "folder",
    title: "Files side by side",
    body: "Browse this computer and the handheld together: copy, rename, delete, preview and edit configs without leaving the manager.",
    go: "#files",
    goLabel: "Open Files",
  },
  {
    id: "tuning",
    icon: "gauge",
    title: "Game Tuning and cheats",
    body: "Per-game RetroArch options and CPU governor with Fastest, Balanced and Best looking presets, plus cheats from the libretro database or MustardOS PPSSPP files.",
    go: "#tuning",
    goLabel: "Open Game Tuning",
  },
  {
    id: "appearance",
    icon: "wand",
    title: "Make it yours",
    body: "Settings → Appearance picks colour schemes (including custom), Softer style, zoom, compact layout and a digital or analog clock. Choices stay in this browser.",
    go: "#settings/appearance",
    goLabel: "Open Appearance",
  },
  {
    id: "logs",
    icon: "list",
    title: "Application logs",
    body: "Logs records errors, warnings and manager actions into daily files under logs/. Search, filter, export or clear them when something goes wrong.",
    go: "#logs",
    goLabel: "Open Logs",
  },
  {
    id: "help",
    icon: "book",
    title: "Wiki and Assistant",
    body: "The Wiki under Overview (or ?) explains every page. After you save a free API key under Settings → Assistant, the mustard chat button answers with your library and this guide.",
    go: "#wiki",
    goLabel: "Open Wiki",
  },
];

const KEY = "tipsOnStartup";

/** Whether the carousel opens after wizard / What's new. Default on. */
export function tipsOnStartup() {
  return store.get(KEY, true) !== false;
}

export function setTipsOnStartup(on) {
  store.set(KEY, !!on);
}

let bound = false;
let index = 0;

function paint() {
  const tip = TIPS[index];
  if (!tip) return;
  const n = TIPS.length;
  const last = index >= n - 1;
  $("tips-title").textContent = tip.title;
  $("tips-sub").textContent = `Tip ${index + 1} of ${n}`;
  $("tips-stage").innerHTML = `
    <div class="tips-hero" aria-hidden="true">${icon(tip.icon)}</div>
    <div class="tips-copy">
      <h3>${esc(tip.title)}</h3>
      <p>${esc(tip.body)}</p>
      ${tip.go ? `<button type="button" class="btn" data-tips="go" data-go="${esc(tip.go)}">${icon("arrow")}<span>${esc(tip.goLabel || "Open")}</span></button>` : ""}
    </div>`;
  $("tips-dots").innerHTML = TIPS.map((_, i) =>
    `<button type="button" class="tips-dot${i === index ? " on" : ""}" data-tips="dot" data-i="${i}" aria-label="Tip ${i + 1}" aria-current="${i === index ? "step" : "false"}"></button>`
  ).join("");
  const back = $("tips-back"), next = $("tips-next");
  if (back) back.disabled = index === 0;
  if (next) next.textContent = last ? "Done" : "Next";
  const box = $("tips-startup");
  if (box) box.checked = tipsOnStartup();
}

function saveStartupFromUi() {
  const box = $("tips-startup");
  if (box) setTipsOnStartup(box.checked);
}

function closeTips() {
  saveStartupFromUi();
  $("tips")?.close();
}

function step(delta) {
  const next = index + delta;
  if (next < 0 || next >= TIPS.length) return;
  index = next;
  paint();
}

/** Open the carousel. Pass `{ force: true }` from Help / Settings to ignore the startup preference. */
export function openTips({ force = false } = {}) {
  if (!force && !tipsOnStartup()) return;
  index = 0;
  paint();
  const dlg = $("tips");
  if (dlg && !dlg.open) dlg.showModal();
}

/** After wizard / What's new: show tips when enabled and nothing else is open. */
export function checkTips() {
  if ($("wizard")?.open || $("whats-new")?.open || $("tips")?.open) return;
  if (!tipsOnStartup()) return;
  openTips();
}

export function bindTips() {
  if (bound) return;
  bound = true;
  const dlg = $("tips");
  if (!dlg) return;
  dlg.addEventListener("click", (e) => {
    const el = e.target.closest("[data-tips]");
    if (!el) {
      if (e.target === dlg) closeTips();
      return;
    }
    const act = el.dataset.tips;
    if (act === "close") { closeTips(); return; }
    if (act === "back") { step(-1); return; }
    if (act === "next") {
      if (index >= TIPS.length - 1) closeTips();
      else step(1);
      return;
    }
    if (act === "dot") {
      index = Math.max(0, Math.min(TIPS.length - 1, Number(el.dataset.i) || 0));
      paint();
      return;
    }
    if (act === "go") {
      const hash = el.dataset.go || "";
      closeTips();
      if (hash) location.hash = hash;
    }
  });
  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeTips();
  });
  dlg.addEventListener("keydown", (e) => {
    if (!$("tips")?.open) return;
    if (e.key === "ArrowRight") { e.preventDefault(); if (index >= TIPS.length - 1) closeTips(); else step(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
  });
  $("tips-startup")?.addEventListener("change", () => saveStartupFromUi());
}
