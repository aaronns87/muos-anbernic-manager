// Device profiles (Wi-Fi + SSH sign-in, web ports, model, last seen) and a "since last connect" Overview digest.
// The server keeps the profiles in .cache/device-profiles.json; localStorage is only a cache for the first paint.

import { api, app, esc, icon, store, toast } from "./core.js";
import { libraryTotals } from "./games.js";
import { openActivity } from "./activity.js";

const PROFILES_KEY = "deviceProfiles";
const ACTIVE_KEY = "deviceProfileId";
const SNAP_KEY = "connectSnapshot";
const SEEN_EVERY_MS = 60_000;

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

/** Takes the server's answer ({ activeId, profiles }) into the local cache. Returns true when something changed. */
function adopt(state) {
  if (!state || !Array.isArray(state.profiles)) return false;
  const changed = JSON.stringify(state.profiles) !== JSON.stringify(listProfiles()) || (state.activeId || "") !== activeProfileId();
  saveList(state.profiles);
  setActiveProfileId(state.activeId || "");
  return changed;
}

async function repaint() {
  const { renderDevice } = await import("./device.js");
  renderDevice();
}

/** Loads the profiles from the server (first run: uploads the ones this browser already had). */
export async function loadProfiles() {
  try {
    let state = await api("device/profiles");
    if (!state.profiles.length && listProfiles().length) {
      for (const p of listProfiles()) {
        try { state = await api("device/profiles", p); } catch { /* skip one that no longer validates */ }
      }
      const active = activeProfileId();
      if (active && state.profiles.some((p) => p.id === active)) state = await api("device/profiles/activate", { id: active });
    }
    if (adopt(state)) await repaint();
  } catch { /* offline or old server: the cached list keeps working */ }
}

function lastSeenText(p) {
  const bits = [p.model, p.lastSeen ? `last seen ${new Date(p.lastSeen).toLocaleString()}` : "", p.battery ? `battery ${p.battery.percent}%` : ""];
  return bits.filter(Boolean).join(", ");
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
        ${list.map((p) => `<option value="${esc(p.id)}"${p.id === active ? " selected" : ""} title="${esc(lastSeenText(p))}">${esc(p.label)}</option>`).join("")}
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

const modelNow = () => app.device.models?.wifi?.name || app.device.models?.usb?.name || app.device.handheld?.name || "";
const batteryNow = () => {
  const level = app.overview?.info?.identity?.battery;
  return typeof level === "number" && level > 0 ? { percent: Math.round(level) } : null;
};

/** The SSH sign-in and web ports the manager uses right now (best effort; the Wi-Fi fields are what matter). */
async function currentSsh() {
  try { return await api("ssh/status"); } catch { return null; }
}

export async function saveProfileFromForm(el) {
  const wifi = wifiFieldsFromDom(el);
  if (!wifi.host) { toast("Enter an address before saving a profile", 3000); return; }
  const list = listProfiles();
  const active = activeProfileId();
  const profile = list.find((p) => p.id === active);
  const label = profile?.label || wifi.host;
  const name = window.prompt("Profile name", label);
  if (name == null) return;
  const trimmed = name.trim() || wifi.host;
  const ssh = await currentSsh();
  const filebrowser = app.device.wifi?.web || profile?.ports?.filebrowser;
  const body = {
    ...(profile ? { id: profile.id } : {}),
    label: trimmed,
    wifi,
    model: modelNow() || profile?.model || "",
    ports: {
      ...profile?.ports,
      ...(ssh ? { ttyd: ssh.vt, syncthing: ssh.syncthing, landing: ssh.landing } : {}),
      ...(filebrowser ? { filebrowser } : {}),
    },
  };
  if (ssh) body.ssh = { host: ssh.hostSetting || "", user: ssh.user, port: ssh.port };
  try {
    const result = await api("device/profiles", body);
    adopt(result);
    if (!profile) adopt(await api("device/profiles/activate", { id: result.profile.id }));
    toast(`Saved profile "${trimmed}"`, 2500);
  } catch (error) {
    toast(error.message, 4000);
    return;
  }
  await repaint();
}

/** Applies a profile: Wi-Fi first (it resets the SSH address), then SSH and ports, then reconnects. */
export async function applyProfile(id) {
  if (!id) {
    setActiveProfileId("");
    api("device/profiles/activate", { id: "" }).then(adopt).catch(() => {});
    return;
  }
  const profile = listProfiles().find((p) => p.id === id);
  if (!profile) { setActiveProfileId(""); return; }
  setActiveProfileId(id);
  const ports = profile.ports || {};
  try {
    adopt(await api("device/profiles/activate", { id }));
    const wifi = { host: profile.wifi.host, user: profile.wifi.user || "muos", port: profile.wifi.port || 2022 };
    if (ports.filebrowser) wifi.web = ports.filebrowser;
    await api("device/wifi", wifi);
    if (profile.ssh) {
      const ssh = await currentSsh();
      await api("ssh/settings", {
        host: profile.ssh.host || "",
        user: profile.ssh.user || "root",
        port: profile.ssh.port || 22,
        shell: ssh?.shell || "bash",
        ...(ports.ttyd ? { vt: ports.ttyd } : {}),
        ...(ports.syncthing ? { syncthing: ports.syncthing } : {}),
        ...(ports.landing ? { landing: ports.landing } : {}),
      });
    }
    toast(`Using profile "${profile.label}"`, 2500);
  } catch (error) {
    toast(error.message, 4000);
  }
  const { refreshDevice, renderDevice } = await import("./device.js");
  await refreshDevice(true);
  renderDevice();
}

export async function deleteActiveProfile() {
  const id = activeProfileId();
  if (!id) return;
  const profile = listProfiles().find((p) => p.id === id);
  if (!profile || !window.confirm(`Delete profile "${profile.label}"?`)) return;
  try {
    adopt(await api("device/profiles/delete", { id }));
    toast("Profile deleted", 2000);
  } catch (error) {
    toast(error.message, 4000);
    return;
  }
  await repaint();
}

let lastSeenSent = { id: "", at: 0, battery: 0 };

/** Stores when the profile's handheld was last reachable, with its model and battery. Throttled; force skips that. */
export async function recordProfileSeen(force = false) {
  const host = app.device.wifi?.host || "";
  const list = listProfiles();
  const profile = list.find((p) => p.id === activeProfileId()) || list.find((p) => host && p.wifi?.host === host);
  if (!profile) return;
  const battery = batteryNow();
  const level = battery?.percent || 0;
  const now = Date.now();
  const fresh = lastSeenSent.id === profile.id && now - lastSeenSent.at < SEEN_EVERY_MS && (!level || level === lastSeenSent.battery);
  if (!force && fresh) return;
  lastSeenSent = { id: profile.id, at: now, battery: level };
  const body = { id: profile.id, lastSeen: now };
  const model = modelNow();
  if (model) body.model = model;
  if (battery) body.battery = battery;
  try { adopt(await api("device/profiles", body)); } catch { /* the next connect tries again */ }
}

let profileBound = false;
export function bindProfiles() {
  if (profileBound) return;
  profileBound = true;
  loadProfiles();
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
  recordProfileSeen(true);
}

/** Call after a successful live refresh so the first connection seeds a baseline and the profile's last seen. */
export function noteLiveConnection(live) {
  if (!live) return;
  if (!store.get(SNAP_KEY, null)?.at) captureConnectSnapshot();
  else recordProfileSeen();
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

/** What changed on the card since the previous device listing (from the server, per profile or volume). */
let cardDiff = null;
let cardDiffFor = "";

export function setCardDiff(diff, volume = app.device.target?.id || "") {
  cardDiff = diff || null;
  cardDiffFor = volume;
}

/** Loads the stored comparison once per device without touching the handheld. */
export async function loadCardDiff() {
  const id = app.device.target?.id;
  if (!id || cardDiffFor === id) return;
  cardDiffFor = id;
  try {
    cardDiff = (await api("device/card-diff?volume=" + encodeURIComponent(id))).diff || null;
  } catch { cardDiff = null; }
  import("./overview.js").then(({ renderOverview }) => renderOverview());
}

function cardDiffRows() {
  const c = cardDiff?.lastChange;
  if (!c) return [];
  const part = (n, word) => n ? `${n} ${word}` : "";
  const text = [part(c.added, "added"), part(c.removed, "removed"), part(c.changed, "changed")].filter(Boolean).join(", ");
  const names = (list, label) => list?.length
    ? `<li class="muted-note">${esc(label)}: ${esc(list.slice(0, 5).join(", "))}${list.length > 5 ? "&hellip;" : ""}</li>` : "";
  return [
    `<li><span>Games on the card: ${esc(text)}</span> <small class="muted-note">${esc(new Date(c.at).toLocaleString())}</small></li>`,
    names(c.addedNames, "Added"), names(c.removedNames, "Removed"), names(c.changedNames, "Changed"),
  ].filter(Boolean);
}

/** Compact card-change block for the Device panel; "" until a listing has been compared. */
export function cardDiffHtml() {
  if (!cardDiff) return "";
  const rows = cardDiffRows();
  const body = cardDiff.baseline && !rows.length
    ? `<p class="muted-note">Saved ${cardDiff.files} games as the starting point. Changes show after the next Games &rarr; Handheld listing.</p>`
    : rows.length ? `<ul class="digest-list">${rows.join("")}</ul>`
      : `<p class="muted-note">No games added, removed or changed on the card since the previous listing.</p>`;
  return `<div class="card-diff"><span class="mode-label">What changed on the card</span>${body}</div>`;
}

export function digestPanelHtml() {
  const dig = connectDigest();
  const card = cardDiffHtml();
  if (!dig && !card) return "";
  const when = dig ? new Date(dig.at).toLocaleString() : "";
  const rows = dig ? dig.items.map((it) => {
    if (!it.go && !it.label) return `<li>${esc(it.text)}</li>`;
    if (it.go === "activity") {
      return `<li><span>${esc(it.text)}</span> <button type="button" class="link-btn" data-digest="transfers">${esc(it.label)}</button></li>`;
    }
    return `<li><span>${esc(it.text)}</span> <a class="link-btn" href="${esc(it.go)}">${esc(it.label)}</a></li>`;
  }).join("") : "";
  return `<section class="panel digest-panel">
    <h2>${icon("clock")} Since last connect</h2>
    ${dig ? `<p class="muted-note">Compared with ${esc(when)}.</p>
    <ul class="digest-list">${rows}</ul>` : ""}
    ${card}
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
