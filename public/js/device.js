// The connection to the handheld: a TF2 card in a reader, or the handheld over USB (MTP).

import { $, app, api, esc, human, store, icon, ICONS, model, cardWord, EXCLUDED, handheldMode, devName, devWord, busy, toast, section, formatDate, formatTime } from "./core.js";
import { byId } from "./devices.js";
import { renderModelPicker, checkCardModel } from "./model-pick.js";
import { renderWizard } from "./wizard.js";
import { versionItem } from "./manager-update.js";
import { render, setWhere, loadDevice, resetListing, syncGamesControls } from "./games.js";
import { renderOverview, resetOverview, loadInfo } from "./overview.js";
import { renderArtwork } from "./artwork-view.js";
import { renderApps } from "./apps.js";
import { renderEmulation } from "./emulation.js";
import { renderFiles } from "./files.js";
import { renderPlay } from "./play.js";
import { renderTuning } from "./tuning.js";
import { settingsDeviceChanged } from "./settings.js";
import { openArtSync, openKeepOnCard } from "./artwork.js";
import { viewerDeviceChanged } from "./game-view.js";

const LIBMTP = {
  darwin: "brew install libmtp",
  linux: "sudo apt install libmtp9 (or your distribution's libmtp package)",
  win32: "install libmtp, for example with MSYS2: pacman -S mingw-w64-x86_64-libmtp"
};

/** Games in Roms/ that can go to the device, and how many of them are on it. */
export function deviceCounts() {
  const copyable = app.data ? app.data.systems.filter((s) => !EXCLUDED.has(s.code)).reduce((a, s) => a + s.games.length, 0) : 0;
  const present = Object.values(app.device.files).filter((s) => s !== "changed").length;
  return { copyable, present };
}

/**
 * What to show about the connection. state is one of
 * checking, offline, waiting, libmtp, nomtp, none, error, card, usb.
 */
export function connection() {
  const d = app.device, c = d.target, h = d.handheld;
  if (d.status === "checking" && !c) {
    const m = app.ui.mode;
    return { state: "checking", cls: "", icon: ICONS[m], title: m === "card" ? "Looking for the TF2 card" : "Looking for the handheld",
      sub: m === "card" ? "In a card reader" : m === "wifi" ? "Over Wi-Fi (SFTP)" : "Over USB (MTP)", steps: [] };
  }
  if (d.status === "offline" || d.status === "error") {
    return { state: "offline", cls: "err", icon: ICONS.card, title: "Manager server unreachable", sub: d.error,
      steps: ["Start the manager again with ./muos-anbernic-manager/run.sh.", "Use the link it opens; earlier tabs stop working when it restarts."] };
  }
  if (!c && app.ui.mode === "card") {
    const one = model().slots === 1;
    return { state: "none", cls: "", icon: ICONS.card, title: `No ${cardWord()} found`,
      sub: one ? "Insert the handheld's SD card in a card reader" : "Insert the TF2 games card in a card reader",
      steps: [
        one ? `Turn the ${model().name} off, take its SD card out and put it in a card reader.`
          : "Take the TF2 card (the second slot) out of the handheld and put it in a card reader.",
        one ? "The computer reads its games partition, which has the ROMS and ARCHIVE folders."
          : "It needs one FAT32 or exFAT volume; setup-device.sh prepares one.",
        ...d.rejects
      ] };
  }
  if (!c && app.ui.mode === "wifi") {
    const w = d.wifi || {};
    const noWifi = !model().wifi ? [`The ${model().name} has no Wi-Fi. Use the USB cable or a card reader, or pick another model under the logo.`] : [];
    if (!w.configured) {
      return { state: "wifisetup", cls: "", icon: ICONS.wifi, title: "Connect over Wi-Fi",
        sub: "Enter the handheld's address",
        steps: [
          ...noWifi,
          "On the handheld open Configuration \u203a Web Services and enable SFTP + Filebrowser.",
          "Join the same Wi-Fi network as this computer. Configuration \u203a Wi-Fi Network shows the handheld's IP address.",
          "Enter that address below, or press Find on network."
        ] };
    }
    return { state: "wifioff", cls: "warn", icon: ICONS.wifi, title: "Handheld not reachable",
      sub: `Nothing answers at ${w.host}:${w.port}`,
      steps: [
        ...noWifi,
        "Wake the handheld. It drops Wi-Fi while it sleeps.",
        "Check that Configuration \u203a Web Services \u203a SFTP + Filebrowser is enabled.",
        "Check its address in Configuration \u203a Wi-Fi Network, as it can change. Find on network looks for it."
      ] };
  }
  if (!c) {
    if (h && h.released) {
      return { state: "released", cls: "warn", icon: ICONS.usb, title: `${h.name} disconnected`,
        sub: "The manager has let go of the USB connection",
        steps: [
          "Other apps, or a restarted manager, can use the handheld now.",
          "You can also unplug the cable safely.",
          "Press Connect to use it here again."
        ] };
    }
    if (h && h.mtp && !h.ready) {
      return { state: "waiting", cls: "warn", icon: ICONS.usb, title: `${h.name} is waiting for the computer`,
        sub: "Plugged in, but the computer has not finished connecting it",
        steps: [
          d.platform === "darwin" ? "Click Allow on the \u201cAllow accessory to connect\u201d prompt." : "Accept any prompt about the new USB device.",
          "Or unplug the cable and plug it in again.",
          d.platform === "darwin" ? "With no prompt, check System Settings \u203a Privacy & Security \u203a Allow accessories to connect." : ""
        ].filter(Boolean) };
    }
    if (h && h.mtp) {
      return { state: "libmtp", cls: "warn", icon: ICONS.usb, title: `${h.name} needs libmtp`,
        sub: "Connected in MTP mode, but libmtp is not installed",
        steps: [`Install it: ${LIBMTP[d.platform] || "install libmtp"}.`, "Then press Check again."] };
    }
    if (h) {
      return { state: "nomtp", cls: "warn", icon: ICONS.usb, title: `${h.name} is not in MTP mode`,
        sub: `Connected as ${h.function || "an unknown USB function"}`,
        steps: ["On the handheld open Configuration \u203a Advanced Settings \u203a USB Function.", "Set it to MTP, then press Check again."] };
    }
    return { state: "none", cls: "", icon: ICONS.usb, title: "Handheld not connected",
      sub: "Connect the handheld with a USB cable",
      steps: [
        "On the handheld open Configuration \u203a Advanced Settings \u203a USB Function and set it to MTP.",
        "Connect it to this computer with a USB-C data cable.",
        "Then press Check again.",
        "Still not found? Unplug the cable, wait until the handheld has finished starting, and plug it in again. Plugged in while starting, its USB port can come up in the wrong mode."
      ] };
  }
  const usb = c.mode === "usb", wifi = c.mode === "wifi", handheld = usb || wifi;
  const base = {
    cls: wifi ? "wifi" : usb ? "usb" : "ok", icon: ICONS[c.mode] || ICONS.card,
    title: handheld ? c.name : c.name || cardWord(), code: wifi ? "Wi-Fi" : usb ? "USB" : c.id
  };
  if (d.error) return { ...base, state: "error", cls: "err", sub: d.error, steps: [] };
  const used = c.total ? Math.round(((c.total - c.free) / c.total) * 100) : 0;
  const { copyable, present } = deviceCounts();
  const where = handheld ? ` on ${c.storage === "SD1" ? "SD1" : "TF2"}` : "";
  const space = `${human(c.free)} free of ${human(c.total)}`;
  const into = c.storage === "SD1" ? "SD1" : "the TF2 card in the handheld";
  return {
    ...base, state: c.mode, used, present, copyable,
    sub: `${present.toLocaleString()}/${copyable.toLocaleString()} games${where} \u00b7 ${human(c.free)} free`,
    art: c.art ? `artwork on ${c.art}` : handheld ? "no artwork catalogue" : "artwork stays on SD1",
    tip: wifi ? `${c.name} over Wi-Fi (SFTP at ${d.wifi?.host}). ROMs go to ${into}: ${space}.`
      : usb ? `${c.name} over USB (MTP). ROMs go to ${into}: ${space}.`
      : `${c.kind} at ${c.mount}: ${space}.`,
    steps: []
  };
}

/** Another way in when the chosen one finds nothing: the handheld on USB or Wi-Fi, or a card in a reader. */
export function alternative() {
  const d = app.device, h = d.handheld, w = d.wifi, m = app.ui.mode;
  if (d.target || d.status !== "ready") return null;
  if (m !== "usb" && h && !h.released) return { mode: "usb", text: `${h.name} is connected with a USB cable.` };
  if (m !== "wifi" && w && w.configured && w.reachable) return { mode: "wifi", text: `${byId(d.models?.wifi?.id)?.name || "The handheld"} answers over Wi-Fi at ${w.host}.` };
  if (m !== "card" && d.targets.length) return { mode: "card", text: `A card (${d.targets[0].name || d.targets[0].id}) is in a card reader.` };
  return null;
}

const altButton = (alt, iconOnly) => {
  const [ico, label] = VIA[alt.mode];
  return `<button class="btn primary${iconOnly ? " icon" : ""}" data-device="mode" data-mode="${alt.mode}"${busy() ? " disabled" : ""} title="${esc(alt.text)} Switch to it." aria-label="Use ${esc(label)}">${icon(ico)}${iconOnly ? "" : `<span>Use ${esc(label)}</span>`}</button>`;
};

/** A [data-device] button with an icon; iconOnly keeps the label for the tooltip and screen readers. */
const devBtn = (action, iconName, label, { title = label, cls = "", disabled = false, iconOnly = false } = {}) =>
  `<button class="btn${iconOnly ? " icon" : ""}${cls ? " " + cls : ""}" data-device="${action}"${disabled ? " disabled" : ""} title="${esc(title)}" aria-label="${esc(label)}">${icon(iconName)}${iconOnly ? "" : `<span>${esc(label)}</span>`}</button>`;
const retryButton = (label = "Check again", opts = {}) => devBtn("refresh", "refresh", label, opts);

/** Whether the connection is usable: a card, or the handheld over USB or Wi-Fi. */
export const isLive = (conn) => ["card", "usb", "wifi"].includes(conn.state);

/** The handheld's SFTPGo web file manager, or "" before an address is set. */
export function filebrowserUrl() {
  const w = app.device.wifi;
  return w && w.host ? `http://${w.host}:${w.web || 9090}/` : "";
}

/** Device-level buttons: switch card, refresh or reconnect, disconnect or eject. iconOnly for the sidebar. */
export function deviceButtons(conn, { iconOnly = false } = {}) {
  const c = app.device.target, disabled = busy();
  if (conn.state === "released") return devBtn("connect", "plug", "Connect", { cls: "primary", title: "Use the handheld here again" });
  const alt = alternative(), other = alt ? altButton(alt, iconOnly) : "";
  if (conn.state === "wifisetup") return other + (section() === "overview" ? "" : `<a class="btn${other ? "" : " primary"}" href="#overview">${icon("wifi")}<span>Set up Wi-Fi</span></a>`);
  if (!["card", "usb", "wifi", "error"].includes(conn.state)) return conn.state === "checking" ? "" : other + retryButton("Check again", { cls: iconOnly && !other ? "primary" : "" });
  if (c.mode === "wifi") {
    const web = filebrowserUrl();
    return devBtn("refresh", "refresh", "Reconnect", { title: "Close the SFTP session and connect again", disabled, iconOnly })
      + (web && !iconOnly ? `<a class="btn" href="${esc(web)}" target="_blank" rel="noopener" title="SFTPGo's web file manager on the handheld (user muos, password muos)">${icon("web")}<span>Filebrowser</span></a>` : "");
  }
  const usb = c.mode === "usb";
  const picker = !usb && app.device.targets.length > 1
    ? `<select class="control" data-device="pick" aria-label="Card">${app.device.targets.map((x) => `<option value="${esc(x.id)}"${x.id === c.id ? " selected" : ""}>${esc(x.name || x.id)} (${esc(x.id)})</option>`).join("")}</select>` : "";
  const refresh = usb
    ? devBtn("refresh", "refresh", "Reconnect", { title: "Close the USB session and connect again", disabled, iconOnly })
    : devBtn("refresh", "refresh", "Check again", { title: "Check the card again", iconOnly });
  const eject = !usb && c.disk ? devBtn("eject", "eject", "Eject", { title: "Eject the card so it can be removed", disabled, iconOnly }) : "";
  const fix = usb && conn.state === "error"
    ? devBtn("usb-restart", "wrench", "Restart USB on handheld", { cls: "primary", disabled, title: "Restarts the handheld's USB file service (MTP) over Wi-Fi with SSH, as a reboot would" }) : "";
  const release = usb
    ? devBtn("disconnect", "unplug", "Disconnect", { title: "Let go of the USB connection so another app, or a restarted manager, can use the handheld", disabled, iconOnly }) : "";
  return fix + picker + refresh + eject + release;
}

const c = () => app.device.target;
const VIA = { usb: ["cable", "USB cable"], wifi: ["wifi", "Wi-Fi"], card: ["sd", "Card reader"] };
const ROLE = { SD1: "System", SD2: "Games", USB: "USB drive" };

/** The cards to show: from the device details, or the card itself in a reader. null while they load. */
export function storages() {
  const o = app.overview, t = c();
  if (!t) return null;
  if (o.info && o.infoFor === t.id) {
    return [...o.info.storages].sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }
  if (t.mode === "card") return [{ key: "SD2", name: t.name || "TF2", free: t.free, total: t.total }];
  return null;
}

/** One card: free space up front, used and total underneath. */
export function storeRow(s, { card = false } = {}) {
  const used = Math.max(0, s.total - s.free), pct = s.total ? Math.round((used / s.total) * 100) : 0;
  const level = pct >= 95 ? " bad" : pct >= 85 ? " warn" : "";
  const key = s.key || s.name;
  return `<div class="store${level}">
    <div class="store-top"><span class="tag">${esc(card ? cardWord() : key)}</span><span class="store-role">${esc(card ? (model().slots === 1 ? "MustardOS and games" : "Games card") : ROLE[key] || s.name)}</span><b>${human(s.free)} free</b></div>
    <div class="meter"><i style="width:${pct}%"></i></div>
    <small>${human(used)} used of ${human(s.total)} &middot; ${pct}%</small></div>`;
}

export function renderSideDevice() {
  const conn = connection(), box = $("side-device"), t = c();
  const live = isLive(conn);
  const [viaIcon, via] = VIA[app.ui.mode];
  const status = live ? "Connected" : conn.state === "checking" ? "Connecting\u2026" : conn.state === "released" ? "Disconnected"
    : conn.state === "error" || conn.state === "offline" ? "Connection problem" : "Not connected";
  box.className = `sd ${live ? "live" : conn.state === "checking" ? "checking" : conn.cls || "off"}`;
  box.title = conn.tip || conn.steps.join("\n");
  const who = live ? (t.mode === "card" ? `${t.name || cardWord()} \u00b7 ${t.fs === "fat" ? "FAT32" : "exFAT"}` : `${conn.title}`) : model().name;
  const open = store.get("sdOpen", false);
  const title = `<span class="sd-ico">${icon(viaIcon)}</span>
      <span class="sd-title"><b><span class="dot"></span>${esc(status)}${live ? icon("down", "sd-chev") : ""}</b><small>${esc(via)} &middot; ${esc(who)}</small></span>`;
  const head = `<div class="sd-head">
      ${live ? `<button type="button" class="sd-toggle" aria-expanded="${open}" title="${open ? "Hide" : "Show"} free space on the cards">${title}</button>` : title}
      ${live ? `<div class="sd-btns">${deviceButtons(conn, { iconOnly: true })}</div>` : ""}
    </div>`;
  box.classList.toggle("open", live && open);
  if (!live) {
    const action = conn.state === "checking" ? "" : deviceButtons(conn, { iconOnly: true });
    box.innerHTML = `${head}<p class="sd-msg">${conn.state === "checking" ? `${ICONS.spin} ` : ""}${esc(conn.state === "checking" ? conn.title : conn.sub || conn.title)}</p>
      ${action ? `<div class="sd-actions">${action}</div>` : ""}`;
    return;
  }
  loadInfo();
  if (!open) {
    box.innerHTML = `${head}${app.device.error ? `<p class="sd-msg err">${esc(app.device.error)}</p>` : ""}`;
    return;
  }
  const list = storages();
  const body = list
    ? list.length ? list.map((s) => storeRow(s, { card: t.mode === "card" })).join("") : `<p class="sd-msg">The handheld reported no storage.</p>`
    : app.overview.infoError ? `<p class="sd-msg">${esc(app.overview.infoError)}</p>` : `<p class="sd-msg">${ICONS.spin} Reading SD1 and SD2&hellip;</p>`;
  box.innerHTML = `${head}<div class="sd-stores">${body}</div>${app.device.error ? `<p class="sd-msg err">${esc(app.device.error)}</p>` : ""}`;
}

/** The top bar's right side, like the MustardOS header: job, connection, battery, clock. */
export function renderStatusbar() {
  const box = $("sb-status");
  if (!box) return;
  const conn = connection(), live = isLive(conn), job = app.job;
  const [viaIcon, via] = VIA[app.ui.mode];
  const parts = [];
  if (job && job.state === "running") {
    const pct = job.total_bytes ? Math.min(100, Math.floor((job.done_bytes / job.total_bytes) * 100)) : 0;
    parts.push(`<span class="sb-item sb-job" title="${esc(job.label || "")}">${ICONS.spin}${job.kind === "art" || job.kind === "artsend" ? "Artwork" : "Transferring"} ${pct}%</span>`);
  }
  const sys = app.sysJob;
  if (sys && sys.state === "running") {
    parts.push(`<a class="sb-item sb-job" href="#system" title="${esc(sys.title)}">${ICONS.spin}${esc(sys.short)} ${sys.percent}%</a>`);
  }
  const state = live ? "on" : conn.state === "checking" ? "wait" : "off";
  parts.push(`<a class="sb-item sb-conn ${state}" href="#overview" title="${esc(live ? conn.tip || conn.title : conn.title)}">${icon(viaIcon)}<span>${esc(live ? via : conn.state === "checking" ? "Connecting" : "Offline")}</span></a>`);
  const battery = app.overview.info?.identity?.battery;
  if (live && typeof battery === "number" && battery > 0) {
    parts.push(`<span class="sb-item sb-batt${battery <= 15 ? " low" : ""}" title="Battery ${battery}%"><span class="batt"><i style="width:${battery}%"></i></span>${battery}%</span>`);
  }
  parts.push(versionItem());
  const now = new Date();
  const date = formatDate(now);
  parts.push(`<span class="sb-item sb-clock" title="${esc(now.toLocaleDateString(undefined, { dateStyle: "full" }))}">${date ? `<span class="sb-date">${esc(date)}</span>` : ""}<b>${esc(formatTime(now))}</b></span>`);
  parts.push(`<button type="button" class="sb-help" data-help title="Help for this page (?)" aria-label="Help for this page">${icon("help")}</button>`);
  box.innerHTML = parts.join("");
}

/** The connection in the Games header: a compact status chip. */
export function renderStrip() {
  const conn = connection(), box = $("games-device");
  box.hidden = false;
  box.className = "dev-chip " + (isLive(conn) ? "live" : conn.cls || "off");
  box.title = conn.tip || conn.steps.join("\n");
  const label = `<span class="dot"></span><b>${esc(conn.title)}</b>`;
  if (!isLive(conn)) {
    const sub = conn.state === "checking" ? ICONS.spin : `<a href="#overview">${conn.state === "wifisetup" ? "Set up Wi-Fi" : "Connection help"}</a>`;
    box.innerHTML = `<span class="chip-body">${label}${sub}</span>`;
    return;
  }
  box.innerHTML = `<span class="chip-body">${label}<span class="chip-sub">${conn.present.toLocaleString()} of ${conn.copyable.toLocaleString()} on ${esc(devWord())} \u00b7 ${human(c().free)} free</span></span>`;
}

/** Redraw everything that depends on the connection. */
export function renderDevice() {
  renderModelPicker();
  renderSideDevice();
  renderStatusbar();
  renderStrip();
  syncGamesControls();
  if (section() === "overview") renderOverview();
  if (section() === "artwork") renderArtwork();
  if (section() === "apps") renderApps();
  if (section() === "emulation") renderEmulation();
  if (section() === "files") renderFiles();
  if (section() === "play") renderPlay();
  if (section() === "tuning") renderTuning(!!app.device.wifi?.reachable);
  settingsDeviceChanged();
  renderWizard();
  viewerDeviceChanged();
}

export async function loadIndex() {
  const d = app.device;
  if (!d.target) { d.files = {}; d.error = ""; return; }
  try {
    const result = await api("device/index?volume=" + encodeURIComponent(d.target.id));
    d.target = Object.assign({}, d.target, result.card);
    d.files = result.files;
    d.error = "";
  } catch (error) {
    if (error.offline) throw error;
    d.files = {};
    d.error = error.message;
  }
}

/** Look for devices again. force also drops the cached device details. */
export async function refreshDevice(force = false) {
  const d = app.device;
  d.status = "checking";
  renderDevice();
  const previous = d.target;
  try {
    const status = await api("status");
    d.targets = status.cards;
    d.rejects = status.rejects;
    d.handheld = status.handheld;
    d.wifi = status.wifi;
    d.models = status.models || {};
    d.platform = status.platform;
    const h = status.handheld, w = status.wifi, board = d.models.wifi;
    const card = (previous && status.cards.find((c) => c.id === previous.id)) || status.cards[0];
    const wifiName = board ? byId(board.id)?.name || board.board.toUpperCase() : "Handheld";
    if (app.ui.mode === "card") d.target = card ? Object.assign({ mode: "card" }, card) : null;
    else if (app.ui.mode === "wifi") d.target = w && w.configured && w.reachable ? { id: "wifi", mode: "wifi", name: wifiName, free: 0, total: 0, art: "" } : null;
    else d.target = h && h.mtp && h.ready && h.libmtp && !h.released ? { id: "usb", mode: "usb", name: h.name, free: 0, total: 0, art: "" } : null;
    await loadIndex();
    d.status = "ready";
  } catch (error) {
    d.status = error.offline ? "offline" : "error";
    d.error = error.message;
    d.target = null;
    d.files = {};
    d.handheld = null;
  }
  const changed = !previous || !d.target || previous.id !== d.target.id;
  if (changed) resetListing();
  if (changed || force) resetOverview();
  if (!d.target || d.error) setWhere("library", false);
  renderDevice();
  checkCardModel();
  if (section() !== "games") return;
  if (app.ui.where === "device" && d.target && app.listing.status !== "loading") loadDevice();
  else render();
}

/** Switches between the USB cable, Wi-Fi and the card reader. */
export async function setMode(mode) {
  if (!["usb", "wifi", "card"].includes(mode)) return;
  if (mode === app.ui.mode) return;
  if (busy()) { toast("Wait for the current job to finish first"); return; }
  const wasHandheld = handheldMode();
  app.ui.mode = mode;
  store.set("mode", mode);
  Object.assign(app.device, { target: null, files: {}, error: "" });
  resetListing();
  resetOverview();
  setWhere("library", false);
  if (wasHandheld) await api("device/reconnect", {}).catch(() => {});
  return refreshDevice(true);
}

/** The USB cable / Wi-Fi / Card reader switch. */
export function modePicker() {
  const m = app.ui.mode, dis = busy() ? " disabled" : "";
  return `<div class="segmented mode-pick" role="group" aria-label="Connect with">
    <button data-device="mode" data-mode="usb" class="${m === "usb" ? "on" : ""}" aria-pressed="${m === "usb"}"${dis}>${icon("cable")} USB cable</button>
    <button data-device="mode" data-mode="wifi" class="${m === "wifi" ? "on" : ""}" aria-pressed="${m === "wifi"}"${dis}>${icon("wifi")} Wi-Fi</button>
    <button data-device="mode" data-mode="card" class="${m === "card" ? "on" : ""}" aria-pressed="${m === "card"}"${dis}>${icon("sd")} Card reader</button>
  </div>`;
}

/** The Wi-Fi settings: the handheld's address and SFTPGo login. */
export function wifiForm() {
  const w = app.device.wifi || {}, dis = busy() ? " disabled" : "";
  const found = wifiFound.list
    ? wifiFound.list.length
      ? `<div class="wifi-found">Found: ${wifiFound.list.map((f) => `<button class="btn" data-device="wifi-use" data-host="${esc(f.host)}">${esc(f.host)}</button>`).join("")}</div>`
      : `<div class="wifi-found nil">Nothing on this network answers on port 2022. Check that the handheld is awake and SFTP + Filebrowser is enabled.</div>`
    : "";
  return `<div class="wifi-form">
    <label>Address<input class="control" id="wifi-host" placeholder="192.168.0.32" value="${esc(w.host || "")}" spellcheck="false" autocomplete="off"></label>
    <label>User<input class="control" id="wifi-user" value="${esc(w.user || "muos")}" spellcheck="false" autocomplete="off"></label>
    <label>Password<input class="control" id="wifi-pass" type="password" placeholder="${w.configured ? "saved" : "muos"}" autocomplete="off"></label>
    <label>SFTP port<input class="control" id="wifi-port" inputmode="numeric" value="${esc(String(w.port || 2022))}"></label>
    <div class="wifi-actions">
      <button class="btn${w.reachable ? "" : " primary"}" data-device="wifi-save"${dis}>${icon("plug")}<span>Save and connect</span></button>
      <button class="btn" data-device="wifi-find"${dis || (wifiFound.busy ? " disabled" : "")} title="Look for SFTPGo on this computer's local networks">${wifiFound.busy ? `${ICONS.spin}<span>Looking</span>` : `${icon("search")}<span>Find on network</span>`}</button>
    </div>
    ${found}
  </div>`;
}

const wifiFound = { list: null, busy: false };

async function saveWifi(el, host) {
  const value = (id) => ($(id) ? $(id).value.trim() : "");
  const body = { host: host || value("wifi-host"), user: value("wifi-user") || "muos", port: Number(value("wifi-port")) || 2022 };
  if (value("wifi-pass")) body.password = $("wifi-pass").value;
  working(el, "Connecting");
  try {
    await api("device/wifi", body);
  } catch (error) {
    toast(error.message, 4000);
    return renderDevice();
  }
  wifiFound.list = null;
  if ($("wifi-host")) $("wifi-host").value = body.host;
  if ($("wifi-pass")) $("wifi-pass").value = "";
  await refreshDevice(true);
  const conn = connection();
  toast(conn.state === "wifi" ? `${conn.title} is connected over Wi-Fi` : conn.state === "error" ? conn.sub : conn.title, 4000);
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !e.target.closest || !e.target.closest(".wifi-form") || busy()) return;
  e.preventDefault();
  const button = document.querySelector('[data-device="wifi-save"]');
  if (button && !button.disabled) saveWifi(button);
});

async function findWifi() {
  if (wifiFound.busy) return;
  wifiFound.busy = true;
  renderDevice();
  try {
    wifiFound.list = (await api("device/wifi/find", {})).found;
  } catch (error) {
    toast(error.message, 4000);
  }
  wifiFound.busy = false;
  if (wifiFound.list && wifiFound.list.length === 1 && !(app.device.wifi && app.device.wifi.reachable)) return saveWifi(null, wifiFound.list[0].host);
  renderDevice();
}

async function pickCard(id) {
  const picked = app.device.targets.find((c) => c.id === id);
  if (picked) app.device.target = Object.assign({ mode: "card" }, picked);
  resetListing();
  resetOverview();
  try { await loadIndex(); } catch (error) { toast(error.message); }
  renderDevice();
  if (section() !== "games") return;
  if (app.ui.where === "device") loadDevice(); else render();
}

/** Shows a spinner in a button while it works; icon-only buttons keep their size. */
function working(el, text) {
  if (!el) return;
  el.disabled = true;
  el.innerHTML = el.classList.contains("icon") ? ICONS.spin : `${ICONS.spin}<span>${text}</span>`;
}

/** Handles [data-device] buttons anywhere in the app. */
export async function deviceAction(action, el) {
  if (action === "mode") return setMode(el.dataset.mode);
  if (action === "refresh") {
    working(el, "Checking");
    if (handheldMode()) await api("device/reconnect", {}).catch(() => {});
    await refreshDevice(true);
    const conn = connection();
    toast(conn.state === "usb" ? `${conn.title} is connected over USB`
      : conn.state === "wifi" ? `${conn.title} is connected over Wi-Fi`
      : conn.state === "card" ? `${conn.title} is in the card reader` : conn.title, 2500);
    return;
  }
  if (action === "disconnect" || action === "connect") {
    working(el, action === "connect" ? "Connecting" : "Disconnecting");
    try {
      await api("device/" + action, {});
    } catch (error) {
      toast(error.message);
      return renderDevice();
    }
    await refreshDevice(true);
    const conn = connection();
    toast(action === "disconnect" ? `Let go of ${conn.state === "released" ? conn.title.replace(/ disconnected$/, "") : "the handheld"}. Other apps can use it now.`
      : conn.state === "usb" ? `${conn.title} is connected over USB` : conn.title, 3000);
    return;
  }
  if (action === "usb-restart") {
    working(el, "Restarting USB");
    try {
      await api("device/usb-restart", {});
    } catch (error) {
      toast(error.message, 4000);
      return renderDevice();
    }
    await refreshDevice(true);
    const conn = connection();
    toast(conn.state === "usb" ? `${conn.title} is connected over USB again` : conn.title, 3000);
    return;
  }
  if (action === "wifi-save") return saveWifi(el);
  if (action === "wifi-use") return saveWifi(el, el.dataset.host);
  if (action === "wifi-find") return findWifi();
  if (action === "pick") return pickCard(el.value);
  if (action === "view") return setWhere(app.ui.where === "device" ? "library" : "device");
  if (action === "browse") {
    app.ui.where = "device";
    sessionStorage.setItem("manager.where", "device");
    if (section() !== "games") { location.hash = "#games"; return; }
    return setWhere("device");
  }
  if (action === "eject") {
    working(el, "Ejecting");
    try {
      await api("device/eject", { volume: app.device.target.id });
      toast(`${cardWord()} ejected. You can remove the card.`);
    } catch (error) { toast(error.message); }
    return refreshDevice();
  }
}

export function handleArtButton(kind) {
  if (kind === "get" || kind === "send") openArtSync(kind);
  if (kind === "keep") openKeepOnCard();
}

/** What the watcher compares: only changes that matter in the chosen mode reload the device. */
const deviceKey = (status) => JSON.stringify(app.ui.mode === "card"
  ? [status.cards.map((c) => [c.id, c.catalogue]), !!status.handheld]
  : app.ui.mode === "wifi" ? [status.wifi && status.wifi.host, status.wifi && status.wifi.reachable, status.models?.wifi?.board, !!status.handheld]
  : [status.handheld, status.cards.length > 0, status.wifi && status.wifi.reachable]);

/** Notices cards and handhelds coming and going. */
export async function watchDevices() {
  const d = app.device;
  const quiet = document.visibilityState === "visible" && !busy() && !document.querySelector("dialog[open]");
  if (quiet && ["ready", "offline", "error"].includes(d.status)) {
    try {
      const status = await api("status");
      if (d.status !== "ready" || deviceKey(status) !== deviceKey({ cards: d.targets, handheld: d.handheld, wifi: d.wifi, models: d.models })) await refreshDevice();
    } catch {}
  }
  setTimeout(watchDevices, 5000);
}
