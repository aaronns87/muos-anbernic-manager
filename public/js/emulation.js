// Emulation: what the emulators on the handheld keep and need, in tabs.

import { $, app, icon, store } from "./core.js";
import { bindBios, renderBios, showBios } from "./bios.js";
import { bindChecks, renderChecks, showChecks } from "./checks.js";
import { bindCores, renderCores, showCores } from "./cores.js";
import { bindSystems, renderSystems, showSystems } from "./emu-systems.js";
import { bindRetroarch, renderRetroarch, showRetroarch } from "./retroarch.js";
import { bindSaves, renderSaves, showSaves } from "./saves.js";

const TABS = [
  ["saves", "save", "Saves", showSaves, renderSaves, "Saves and save states on the handheld: back them up and restore them"],
  ["bios", "shield", "BIOS", showBios, renderBios, "BIOS files the emulators need, checked by MD5 and sent to the handheld"],
  ["cores", "chip", "Cores", showCores, renderCores, "The core MustardOS starts for each ROM folder, and for single games"],
  ["systems", "layers", "Systems", showSystems, renderSystems, "Which systems MustardOS on the handheld can run, and why some are missing"],
  ["retroarch", "sliders", "RetroArch", showRetroarch, renderRetroarch, "Picture and play options for each ROM folder, saved as RetroArch overrides"],
  ["checks", "hash", "Library check", showChecks, renderChecks, "Your Roms/ library checked against No-Intro, and games you have more than once"],
];
let bound = false;

const current = () => TABS.find((t) => t[0] === store.get("emuTab", "saves")) || TABS[0];

function tabs() {
  const [id] = current();
  $("emu-tabs").innerHTML = TABS.map(([t, ico, label]) =>
    `<button role="tab" data-tab="${t}" class="${t === id ? "on" : ""}" aria-selected="${t === id}">${icon(ico)}<span>${label}</span></button>`).join("");
}

export function showEmulation() {
  if (!bound) {
    bound = true;
    $("emu-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]");
      if (!b || b.classList.contains("on")) return;
      store.set("emuTab", b.dataset.tab);
      showEmulation();
    });
    bindSaves($("view-emulation"));
    bindBios($("view-emulation"));
    bindCores($("view-emulation"));
    bindSystems($("view-emulation"));
    bindRetroarch($("view-emulation"));
    bindChecks($("view-emulation"));
  }
  tabs();
  const tab = current();
  $("emu-sub").textContent = tab[5];
  $("emu-actions").innerHTML = "";
  $("emu-body").innerHTML = "";
  tab[3]();
}

/** Redraws the open tab when the connection changes. */
export function renderEmulation() {
  if (bound) current()[4](!!app.device.wifi?.reachable);
}
