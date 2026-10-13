// Shared state, helpers and the API client for the manager app.

import { DEVICES, DEFAULT_DEVICE, byId, deviceFor } from "./devices.js";

export const $ = (id) => document.getElementById(id);

export const ACCENTS = {
  "Arcade": "#ff7a45", "Nintendo": "#ff4d5e", "Sega": "#3d8bff", "Sony": "#9b7bff", "SNK": "#f5c518",
  "NEC": "#ffa53d", "Atari": "#ff5c8a", "Bandai": "#2fd3c4", "Computers": "#35c98a",
  "Engines & Ports": "#c06cff", "Other": "#8a96a4"
};
export const EXCLUDED = new Set(["APPS", "PORTS"]);
export const ART_KINDS = [["box", "Box art"], ["preview", "Screenshot"], ["splash", "Splash"]];
export const SECTIONS = ["overview", "games", "play", "artwork", "apps", "handheld", "themes", "emulation", "files", "system", "ssh", "settings", "wiki"];
/** The section each number key opens: 1 to 9 in order, 0 for the Wiki. */
export const sectionForKey = (k) => (k === "0" ? "wiki" : SECTIONS[+k - 1]);

export { DEVICES };

/** A card's identity across runs: the reader's volume id changes, its name, size and format do not. */
export const cardKey = (c) => [c.name, c.total, c.fs].join("|");

/**
 * The model the app works with and how it is known: "usb", "wifi" or "ssh" when the handheld reported it, "card" when
 * it was chosen (or hinted) for the card in the reader, else "picked" for the model picker's choice.
 */
export function modelInfo() {
  const d = app.device, m = d.models || {}, t = d.target;
  if (app.ui.mode === "usb" && byId(m.usb?.id)) return { device: byId(m.usb.id), via: "usb" };
  if (app.ui.mode === "wifi" && byId(m.wifi?.id)) return { device: byId(m.wifi.id), via: m.wifi.via };
  if (app.ui.mode === "card" && t && t.mode === "card") {
    const id = store.get("cardModels", {})[cardKey(t)];
    if (byId(id)) return { device: byId(id), via: "card" };
  }
  return { device: deviceFor(store.get("model", DEFAULT_DEVICE)) || byId(DEFAULT_DEVICE), via: "picked" };
}
export const model = () => modelInfo().device;

/** Remembers the model for a card in the reader, and as the default for the next one. */
export function setCardModel(card, id) {
  store.set("cardModels", { ...store.get("cardModels", {}), [cardKey(card)]: id });
  store.set("model", id);
}

const PATHS = {
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  package: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  unplug: '<path d="m19 5 3-3"/><path d="m2 22 3-3"/><path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z"/><path d="M7.5 13.5 10 11"/><path d="M10.5 16.5 13 14"/><path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  eject: '<path d="M5 18h14"/><path d="M12 5 5 14h14Z"/>',
  transfer: '<rect x="5" y="2" width="14" height="20" rx="2.5"/><path d="M12 6v7"/><path d="m9 10 3 3 3-3"/><path d="M10 18h4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  scrape: '<path d="M21 10V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/><path d="m3 15 4-4 3 3"/><circle cx="16.5" cy="16.5" r="3.5"/><path d="m21 21-2-2"/>',
  sync: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  select: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 0 1 4.85.8c0 1.7-2.45 2.2-2.45 3.6"/><path d="M12 17h.01"/>',
  alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  sd: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M10 7v3M13 7v3M16 9v1"/>',
  handheld: '<rect x="2" y="5" width="20" height="14" rx="3.5"/><rect x="7.5" y="8" width="9" height="8" rx="1"/><path d="M4.5 12h1.5M5.25 11.25v1.5"/><circle cx="19" cy="11" r=".6"/><circle cx="19" cy="13.5" r=".6"/>',
  cable: '<path d="M7 2v4M12 2v4M17 2v4"/><path d="M5 6h14v4a7 7 0 0 1-14 0Z"/><path d="M12 17v5"/>',
  wifi: '<path d="M2 8.5a15 15 0 0 1 20 0"/><path d="M5 12a10 10 0 0 1 14 0"/><path d="M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/>',
  battery: '<rect x="2" y="7" width="17" height="10" rx="2.5"/><path d="M22 11v2"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9Z"/>',
  dot: '<circle cx="12" cy="12" r="8"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
  eraser: '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21Z"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
  book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5v-2Z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H19"/><path d="M9 7h6M9 11h4"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5Z"/>',
  pencil: '<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  palette: '<path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.4-.5-.8-.5-1.2 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4c0-4.4-4-8.2-9-8.2Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/><circle cx="17" cy="11" r="1"/>',
};

/** An inline icon; sizes come from CSS (.i, or the button it sits in). */
export const icon = (name, cls = "") =>
  `<svg class="i${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ""}</svg>`;

export const ICONS = {
  up: icon("transfer"),
  card: icon("sd"),
  usb: icon("cable"),
  wifi: icon("wifi"),
  art: icon("image"),
  games: icon("handheld"),
  send: icon("upload"),
  get: icon("download"),
  spin: `<span class="spinner sm"></span>`,
};

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("manager." + key) ?? localStorage.getItem("library." + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem("manager." + key, JSON.stringify(value)); } catch {} }
};

const params = new URLSearchParams(location.search);
export const TOKEN = params.get("token") || sessionStorage.getItem("manager.token") || "";
if (params.get("token")) {
  sessionStorage.setItem("manager.token", TOKEN);
  history.replaceState(null, "", location.pathname + location.hash);
}

/** Everything the modules share. */
export const app = {
  /** The games library from /api/games. */
  data: null,
  all: [],
  ui: {
    q: "", art: "all", onCard: "all", devFilter: "all", genre: "all", rating: "all", year: "all", where: sessionStorage.getItem("manager.where") || "library",
    sort: store.get("sort", "title"), view: store.get("view", "grid"),
    card: store.get("card", 180), empty: store.get("empty", false), theme: store.get("theme", "dark"),
    clock: store.get("clock", "24"), dateFormat: store.get("dateFormat", "weekday"),
    /** Systems start collapsed on every load; filled in when the library arrives. */
    collapsed: new Set(),
    /** How the handheld is reached: "usb" (MTP over the cable), "wifi" (SFTP) or "card" (TF2 in a card reader). */
    mode: ["usb", "wifi", "card"].includes(store.get("mode", "usb")) ? store.get("mode", "usb") : "usb"
  },
  /** The connection: status is checking | ready | offline | error. target is the card, "usb" or "wifi" device in use. */
  device: { status: "checking", targets: [], target: null, rejects: [], files: {}, error: "", handheld: null, wifi: null, models: {}, platform: "" },
  /** The games on the device (Games > On device). */
  listing: { status: "idle", volume: "", data: null, error: "" },
  overview: { workspace: null, info: null, infoFor: "", infoError: "", summary: null, summaryFor: "", summaryError: "", loading: "" },
  job: null,
  /** The System section's card job (install, TF2 setup, reset) from /api/system/job. */
  sysJob: null,
  /** Games picked for a bulk action: library keys (SYS/file) or, on the device, folder/file. */
  sel: new Set(),
  selecting: false,
  visible: [],
  current: -1,
  devVisible: [],
};

export async function api(path, body) {
  let res;
  try {
    res = await fetch("/api/" + path, {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: Object.assign({ "X-Manager-Token": TOKEN }, body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    const error = new Error("The manager server is not running. Start it again with ./muos-anbernic-manager/run.sh.");
    error.offline = true;
    throw error;
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) {
    const error = new Error("This tab belongs to an earlier run of the manager. Use the link printed by ./muos-anbernic-manager/run.sh.");
    error.offline = true;
    throw error;
  }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const human = (n) => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = n;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return i === 0 ? `${v} B` : `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
};

export const clock = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : m ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
};

/** Date styles for the statusbar clock, keyed by the value saved in settings. */
export const DATE_FORMATS = [
  ["weekday", "Weekday, day and month"],
  ["long", "Weekday, day, month and year"],
  ["short", "Day and month"],
  ["iso", "ISO (year-month-day)"],
  ["dmy", "Day.month.year"],
  ["mdy", "Month/day/year"],
  ["none", "No date"],
];

/** A "2026-10-12 18:52" stamp from the server as the time today, or the date and time on other days. */
export function scanWhen(stamp) {
  const d = new Date(String(stamp).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(stamp || "");
  const time = formatTime(d);
  return d.toDateString() === new Date().toDateString() ? time : [formatDate(d), time].filter(Boolean).join(" ");
}

/** "2601.1_JACARANDA" as "2601.1 Jacaranda". */
export function osVersion(v) {
  return String(v || "").replace(/_/g, " ").replace(/\b([A-Z])([A-Z]{2,})\b/g, (_, a, b) => a + b.toLowerCase()).trim();
}

export function formatDate(d, style = app.ui.dateFormat) {
  const pad = (n) => String(n).padStart(2, "0");
  const day = d.getDate(), month = d.getMonth() + 1, year = d.getFullYear();
  const wd = d.toLocaleDateString(undefined, { weekday: "short" }), mon = d.toLocaleDateString(undefined, { month: "short" });
  if (style === "none") return "";
  if (style === "long") return `${wd} ${day} ${mon} ${year}`;
  if (style === "short") return `${day} ${mon}`;
  if (style === "iso") return `${year}-${pad(month)}-${pad(day)}`;
  if (style === "dmy") return `${pad(day)}.${pad(month)}.${year}`;
  if (style === "mdy") return `${pad(month)}/${pad(day)}/${year}`;
  return `${wd} ${day} ${mon}`;
}

export function formatTime(d, mode = app.ui.clock) {
  if (mode === "12") return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export const initial = (t) => (t.match(/[A-Za-z0-9]/) || ["?"])[0].toUpperCase();

export const highlight = (text, q) => {
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + q.length)) + "</mark>" + esc(text.slice(i + q.length));
};

export const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------- device helpers

export const usbMode = () => !!app.device.target && app.device.target.mode === "usb";
/** The handheld itself, over USB or Wi-Fi, rather than a card in a reader. */
export const handheldMode = () => !!app.device.target && app.device.target.mode !== "card";
/** A sentence for slow device reads, or "" for a card reader. */
export const slowHint = () => (!handheldMode() ? "" : usbMode() ? " Over USB this can take a minute." : " Over Wi-Fi this can take a minute.");
/** The games card: "TF2" on two-slot handhelds, "SD card" where one card holds MustardOS and games. */
export const cardWord = () => (model().slots === 1 ? "SD card" : "TF2");
/** The card or the handheld's name, for sentences. */
export const devName = () => (handheldMode() ? app.device.target.name || "the handheld" : cardWord());
/** The card or "device", for short labels. */
export const devWord = () => (handheldMode() ? "device" : cardWord());
export const ready = () => !!app.device.target && !app.device.error && app.device.status === "ready";
export const busy = () => !!app.job && app.job.state === "running";

export const keyOf = (sys, g) => sys.code + "/" + g.f;
export const onCardState = (sys, g) => (app.device.target ? app.device.files[keyOf(sys, g)] : undefined);
export const isOnCard = (sys, g) => { const s = onCardState(sys, g); return s === "same" || s === "check"; };
export const canCopy = (sys) => ready() && !EXCLUDED.has(sys.code) && sys.games.length > 0;

// ---------------------------------------------------------------- sections

export function section() {
  const hash = location.hash.slice(1);
  return SECTIONS.includes(hash) ? hash : "overview";
}

/** Replaces root's content, keeping the scroll position of the lists that match selector. */
export function setKeepingScroll(root, html, selector) {
  const tops = [...root.querySelectorAll(selector)].map((el) => el.scrollTop);
  root.innerHTML = html;
  root.querySelectorAll(selector).forEach((el, i) => { el.scrollTop = tops[i] ?? 0; });
}

/** Shows a short message; long ones stay up long enough to read. */
export function toast(message, ms = 1600) {
  const t = $("toast");
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), Math.max(ms, Math.min(8000, String(message).length * 55)));
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const area = document.createElement("textarea");
  area.value = text;
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  return ok;
}
