// Named Wi-Fi device profiles and a "since last connect" Overview digest.

import { api, app, esc, icon, store, toast } from "./core.js";
import { libraryTotals } from "./games.js";
import { openActivity } from "./activity.js";

const PROFILES_KEY = "deviceProfiles";
const ACTIVE_KEY = "deviceProfileId";
const SNAP_KEY = "connectSnapshot";

const uid = () => `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function listProfiles() {
  const list = store.get(PROFILES_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function activeProfileId() {
  return store.get(ACTIVE_KEY, "") || "";
}

export function setActiveProfileId(id) {
  store.set(ACTIVE_KEY, id || "");
}

function saveList(list) {
  store.set(PROFILES_KEY, list);
}

export function profileSwitcherHtml() {
  const list = listProfiles();
  const active = activeProfileId();
  if (!list.length) {
    return `<div class="profile-bar">
      <button type="button" class="btn small" data-profile="save">${icon("plus")}<span>Save as profile</span></button>
    </div>`;
  }
  return `<div class="profile-bar">
    <label class="profile-pick">Profile
      <select class="control" data-profile="pick" aria-label="Device profile">
        <option value="">Current settings</option>
        ${list.map((p) => `<option value="${esc(p.id)}"${p.id === active ? " selected" : ""}>${esc(p.label)}</option>`).join("")}
      </select>
    </label>
    <button type="button" class="btn small" data-profile="save" title="Update or create a profile from the fields below">${icon("plus")}<span>Save profile</span></button>
    <button type="button" class="btn small ghost" data-profile="delete" title="Delete the selected profile"${active ? "" : " disabled"}>${icon("trash")}<span>Delete</span></button>
  </div>`;
}

function wifiFieldsFromDom(el) {
  const form = el?.closest?.(".wifi-form") || document.querySelector(".wifi-form");
  const val = (name) => form?.querySelector(`[data-wifi="${name}"]`)?.value?.trim() || "";
  return {
    host: val("host") || app.device.wifi?.host || "",
    user: val("user") || app.device.wifi?.user || "muos",
    port: Number(val("port")) || app.device.wifi?.port || 2022,
  };
}

export async function saveProfileFromForm(el) {
  const wifi = wifiFieldsFromDom(el);
  if (!wifi.host) { toast("Enter an address before saving a profile", 3000); return; }
  const list = listProfiles();
  const active = activeProfileId();
  let profile = list.find((p) => p.id === active);
  const label = profile?.label || wifi.host;
  const name = window.prompt("Profile name", label);
  if (name == null) return;
  const trimmed = name.trim() || wifi.host;
  const modelName = app.device.models?.wifi?.name || app.device.models?.usb?.name || app.device.handheld?.name || "";
  if (profile) {
    profile = { ...profile, label: trimmed, wifi, model: modelName || profile.model, updatedAt: Date.now() };
    saveList(list.map((p) => (p.id === profile.id ? profile : p)));
  } else {
    profile = { id: uid(), label: trimmed, wifi, model: modelName, updatedAt: Date.now() };
    saveList([...list, profile]);
    setActiveProfileId(profile.id);
  }
  toast(`Saved profile "${trimmed}"`, 2500);
  const { renderDevice } = await import("./device.js");
  renderDevice();
}

export async function applyProfile(id) {
  if (!id) { setActiveProfileId(""); return; }
  const profile = listProfiles().find((p) => p.id === id);
  if (!profile) { setActiveProfileId(""); return; }
  setActiveProfileId(id);
  try {
    await api("device/wifi", { host: profile.wifi.host, user: profile.wifi.user || "muos", port: profile.wifi.port || 2022 });
    toast(`Using profile "${profile.label}"`, 2500);
  } catch (error) {
    toast(error.message, 4000);
  }
  const { refreshDevice, renderDevice } = await import("./device.js");
  await refreshDevice(true);
  renderDevice();
}

export function deleteActiveProfile() {
  const id = activeProfileId();
  if (!id) return;
  const list = listProfiles();
  const profile = list.find((p) => p.id === id);
  if (!profile || !window.confirm(`Delete profile "${profile.label}"?`)) return;
  saveList(list.filter((p) => p.id !== id));
  setActiveProfileId("");
  toast("Profile deleted", 2000);
  import("./device.js").then(({ renderDevice }) => renderDevice());
}

let profileBound = false;
export function bindProfiles() {
  if (profileBound) return;
  profileBound = true;
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-profile]");
    if (!btn) return;
    const act = btn.dataset.profile;
    if (act === "save") saveProfileFromForm(btn);
    else if (act === "delete") deleteActiveProfile();
  });
  document.addEventListener("change", (e) => {
    if (e.target.dataset?.profile === "pick") applyProfile(e.target.value);
  });
}

function countOnDevice() {
  if (!app.data?.systems) return 0;
  let n = 0;
  for (const sys of app.data.systems) for (const g of sys.games || []) if (g.on) n++;
  return n;
}

function countDeviceOnly() {
  if (!app.data?.systems) return 0;
  let n = 0;
  for (const sys of app.data.systems) for (const g of sys.games || []) if (g.st === "device") n++;
  return n;
}

/** Snapshot taken while a link is live; used for the Overview digest. */
export function captureConnectSnapshot() {
  const t = libraryTotals();
  const play = app.play?.games || [];
  const playTotal = play.reduce((n, g) => n + (g.total || 0), 0);
  store.set(SNAP_KEY, {
    at: Date.now(),
    playTotal,
    playGames: play.length,
    onDevice: countOnDevice(),
    libraryGames: t?.games || 0,
    failedTransfers: (app.transfers?.history || []).filter((j) => j.state === "failed" || j.failed_count).length,
    mode: app.ui.mode,
    host: app.device.wifi?.host || "",
  });
}

/** Call after a successful live refresh so the first connection seeds a baseline. */
export function noteLiveConnection(live) {
  if (!live) return;
  if (!store.get(SNAP_KEY, null)?.at) captureConnectSnapshot();
}

/** Diff vs last snapshot for Overview. */
export function connectDigest() {
  const prev = store.get(SNAP_KEY, null);
  if (!prev?.at) return null;
  const play = app.play?.games || [];
  const playTotal = play.reduce((n, g) => n + (g.total || 0), 0);
  const onDevice = countOnDevice();
  const failed = (app.transfers?.history || []).filter((j) => j.state === "failed" || j.failed_count).length;
  const items = [];
  if (playTotal > (prev.playTotal || 0)) {
    items.push({ id: "play", text: "New play time on the handheld", go: "#play", label: "Open Play" });
  }
  const gained = onDevice - (prev.onDevice || 0);
  if (gained > 0) {
    items.push({ id: "device", text: `${gained} more game${gained === 1 ? "" : "s"} on the handheld`, go: "#games", label: "Open Games" });
  }
  const onlyDevice = countDeviceOnly();
  if (onlyDevice > 0) {
    items.push({ id: "only", text: `${onlyDevice} on the handheld but not in Roms/`, go: "#games", label: "Open Games" });
  }
  if (failed > (prev.failedTransfers || 0)) {
    items.push({ id: "tx", text: "Transfers failed since last time", go: "activity", label: "Show Transfers" });
  }
  if (!items.length) {
    return { at: prev.at, items: [{ id: "ok", text: "Nothing new since the last connection", go: "", label: "" }] };
  }
  return { at: prev.at, items };
}

export function digestPanelHtml() {
  const dig = connectDigest();
  if (!dig) return "";
  const when = new Date(dig.at).toLocaleString();
  const rows = dig.items.map((it) => {
    if (!it.go && !it.label) return `<li>${esc(it.text)}</li>`;
    if (it.go === "activity") {
      return `<li><span>${esc(it.text)}</span> <button type="button" class="link-btn" data-digest="transfers">${esc(it.label)}</button></li>`;
    }
    return `<li><span>${esc(it.text)}</span> <a class="link-btn" href="${esc(it.go)}">${esc(it.label)}</a></li>`;
  }).join("");
  return `<section class="panel digest-panel">
    <h2>${icon("clock")} Since last connect</h2>
    <p class="muted-note">Compared with ${esc(when)}.</p>
    <ul class="digest-list">${rows}</ul>
    <div class="panel-actions">
      <button type="button" class="btn small" data-digest="refresh">${icon("refresh")}<span>Remember now</span></button>
    </div>
  </section>`;
}

export function bindDigest() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-digest]");
    if (!btn) return;
    if (btn.dataset.digest === "refresh") {
      captureConnectSnapshot();
      toast("Connection snapshot saved", 2000);
      import("./overview.js").then(({ renderOverview }) => renderOverview());
    } else if (btn.dataset.digest === "transfers") {
      openActivity();
    }
  });
}
