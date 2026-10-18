// Device section: Settings, Controls and Benchmark tabs.

import { $, icon, store } from "./core.js";
import { showHandheld, renderHandheld, clearHandheldBar } from "./handheld.js";
import { showBenchmark, renderBenchmark } from "./benchmark.js";
import { showControls, renderControls, hideControls } from "./controls.js";

const TABS = [
  ["settings", "sliders", "Settings", "MustardOS settings on the handheld, changed over SSH"],
  ["controls", "gamepad", "Controls", "Live sticks, analog calibration and system input settings over SSH"],
  ["benchmark", "gauge", "Benchmark", "Connectivity, storage speed and a short CPU load over Wi-Fi with SSH"],
];

let bound = false;

const current = () => TABS.find((t) => t[0] === store.get("handheldTab", "settings")) || TABS[0];

function tabs() {
  const [id] = current();
  $("hh-tabs").innerHTML = TABS.map(([t, ico, label]) =>
    `<button role="tab" data-hh-tab="${t}" class="${t === id ? "on" : ""}" aria-selected="${t === id}">${icon(ico)}<span>${label}</span></button>`).join("");
}

export function showDevice() {
  if (!bound) {
    bound = true;
    $("hh-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-hh-tab]");
      if (!b || b.classList.contains("on")) return;
      store.set("handheldTab", b.dataset.hhTab);
      showDevice();
    });
  }
  tabs();
  const [id, , , sub] = current();
  $("hh-sub").textContent = sub;
  $("hh-actions").innerHTML = "";
  const settings = id === "settings";
  const controls = id === "controls";
  $("handheld").hidden = !settings;
  $("hh-controls").hidden = !controls;
  $("hh-bench").hidden = id !== "benchmark";
  if (!settings) clearHandheldBar();
  if (!controls) hideControls();
  if (settings) showHandheld();
  else if (controls) showControls();
  else showBenchmark();
}

/** Redraws the open Device tab when the connection changes. */
export function renderDeviceSection() {
  if (!bound) return;
  const id = current()[0];
  if (id === "settings") renderHandheld();
  else if (id === "controls") renderControls();
  else renderBenchmark();
}
