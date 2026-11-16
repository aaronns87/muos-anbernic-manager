// Manager appearance: built-in and custom colour schemes, plus applying scheme CSS variables.

import { store } from "./core.js";

export const BUILTIN_SCHEMES = ["mustard", "ocean", "forest", "berry", "slate", "ember"];
export const ZOOM_LEVELS = [50, 65, 85, 100, 110, 125];

const SCHEME_VARS = [
  "--mustard", "--mustard-2", "--mustard-dim", "--on-mustard",
  "--bg", "--bg-top", "--bar", "--panel", "--panel-2", "--panel-3",
  "--line", "--line-2", "--text", "--muted", "--faint", "--brand", "--shadow",
];

const SOFT_COLOR_VARS = [
  "--mustard", "--mustard-2", "--mustard-dim", "--on-mustard",
  "--bg", "--bg-top", "--bar", "--panel", "--panel-2", "--panel-3",
  "--line", "--line-2", "--text", "--muted", "--faint", "--brand",
  "--ok", "--warn", "--bad", "--bad-text",
];

/** Roles the scheme editor exposes; companions are derived. */
export const SCHEME_ROLES = [
  ["accent", "Accent", "Buttons, focus rings and highlights"],
  ["onAccent", "On accent", "Text and icons on accent-coloured controls"],
  ["bg", "Background", "Page background behind panels"],
  ["panel", "Panel", "Cards, dialogs and side surfaces"],
  ["text", "Text", "Main labels and body copy"],
  ["muted", "Muted", "Secondary notes and quieter labels"],
];

const DEFAULT_DARK = {
  accent: "#e2bd46", onAccent: "#181509", bg: "#111315", panel: "#1a1d21", text: "#f0f2f5", muted: "#aeb6c2",
};
const DEFAULT_LIGHT = {
  accent: "#e2bd46", onAccent: "#181509", bg: "#f3f5f7", panel: "#ffffff", text: "#202833", muted: "#566271",
};

export const defaultRoles = (mode) => ({ ...(mode === "light" ? DEFAULT_LIGHT : DEFAULT_DARK) });

export function loadCustomSchemes() {
  const raw = store.get("customSchemes", []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((s) => s && typeof s.id === "string" && typeof s.name === "string" && s.dark && s.light);
}

export function saveCustomSchemes(list) {
  store.set("customSchemes", list);
}

export function isBuiltinScheme(id) {
  return BUILTIN_SCHEMES.includes(id);
}

export function resolveSchemeId(id) {
  if (isBuiltinScheme(id)) return id;
  return loadCustomSchemes().some((s) => s.id === id) ? id : "mustard";
}

export function schemeChips(scheme) {
  if (!scheme?.dark) return ["#111315", "#1a1d21", "#e2bd46", "#f0f2f5"];
  const d = scheme.dark;
  return [d.bg, d.panel, d.accent, d.text];
}

/** Parse #rgb / #rrggbb into [r,g,b] or null. */
function parseHex(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toHex = (r, g, b) => "#" + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("");

function mix(a, b, t) {
  const A = parseHex(a), B = parseHex(b);
  if (!A || !B) return a;
  return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

function lighten(hex, t) { return mix(hex, "#ffffff", t); }
function darken(hex, t) { return mix(hex, "#000000", t); }

/** Expand editor roles into the CSS custom properties the app uses. */
export function rolesToVars(roles, mode) {
  const r = { ...defaultRoles(mode), ...roles };
  const accent = parseHex(r.accent) ? r.accent : defaultRoles(mode).accent;
  const onAccent = parseHex(r.onAccent) ? r.onAccent : defaultRoles(mode).onAccent;
  const bg = parseHex(r.bg) ? r.bg : defaultRoles(mode).bg;
  const panel = parseHex(r.panel) ? r.panel : defaultRoles(mode).panel;
  const text = parseHex(r.text) ? r.text : defaultRoles(mode).text;
  const muted = parseHex(r.muted) ? r.muted : defaultRoles(mode).muted;
  const light = mode === "light";
  return {
    "--mustard": accent,
    "--mustard-2": lighten(accent, light ? 0.12 : 0.22),
    "--mustard-dim": darken(accent, light ? 0.28 : 0.35),
    "--on-mustard": onAccent,
    "--bg": bg,
    "--bg-top": mix(bg, panel, 0.35),
    "--bar": mix(bg, panel, 0.18),
    "--panel": panel,
    "--panel-2": light ? darken(panel, 0.04) : lighten(panel, 0.06),
    "--panel-3": light ? darken(panel, 0.1) : lighten(panel, 0.12),
    "--line": mix(panel, text, light ? 0.14 : 0.12),
    "--line-2": mix(panel, text, light ? 0.28 : 0.22),
    "--text": text,
    "--muted": muted,
    "--faint": mix(muted, bg, 0.35),
    "--brand": darken(accent, light ? 0.35 : 0.15),
    "--shadow": light
      ? "0 16px 34px -18px rgba(40, 30, 10, .35)"
      : "0 18px 40px -18px rgba(0, 0, 0, .85)",
  };
}

export function applyVars(el, vars) {
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
}

export function clearSchemeVars(el) {
  for (const k of SCHEME_VARS) el.style.removeProperty(k);
}

/** Apply the active colour scheme to the document (or clear builtins' leftover inline vars). */
export function applyColourScheme(root, schemeId, theme) {
  const id = resolveSchemeId(schemeId);
  if (isBuiltinScheme(id)) {
    clearSchemeVars(root);
    root.dataset.scheme = id;
    return;
  }
  const custom = loadCustomSchemes().find((s) => s.id === id);
  if (!custom) {
    clearSchemeVars(root);
    root.dataset.scheme = "mustard";
    return;
  }
  root.dataset.scheme = "custom";
  applyVars(root, rolesToVars(custom[theme === "light" ? "light" : "dark"], theme === "light" ? "light" : "dark"));
}

export function newSchemeId() {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function parseCssColor(value) {
  const v = String(value || "").trim();
  const hex = parseHex(v);
  if (hex) return hex;
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const SOFT_ACCENTS = new Set(["--mustard", "--mustard-2", "--mustard-dim", "--brand", "--ok", "--warn", "--bad", "--bad-text"]);
const SOFT_SURFACES = new Set(["--bg", "--bg-top", "--bar", "--panel", "--panel-2", "--panel-3", "--line", "--line-2"]);
const SOFT_INK = new Set(["--on-mustard", "--text", "--muted", "--faint"]);

/** Soften accents to pastel; lift surfaces gently without washing dark themes to white. */
export function applySoftLook(root, soft, theme) {
  if (!soft) {
    for (const k of SOFT_COLOR_VARS) root.style.removeProperty(k);
    return;
  }
  const light = theme === "light";
  const cs = getComputedStyle(root);
  for (const k of SOFT_COLOR_VARS) {
    const rgb = parseCssColor(cs.getPropertyValue(k));
    if (!rgb) continue;
    let t, mixWith;
    if (SOFT_ACCENTS.has(k)) {
      // Pastel accents — clearer soft cue without washing the UI.
      t = light ? 0.42 : 0.36;
      mixWith = [255, 255, 255];
    } else if (SOFT_SURFACES.has(k)) {
      // Dark stays charcoal with a gentle lift; light gets creamier panels.
      const line = k === "--line" || k === "--line-2";
      t = light ? (line ? 0.35 : 0.3) : (line ? 0.18 : 0.1);
      mixWith = light ? [255, 252, 248] : [52, 56, 64];
    } else if (SOFT_INK.has(k)) {
      // Slightly ease contrast so text feels less sharp.
      t = light ? 0.08 : 0.1;
      mixWith = light ? [70, 64, 56] : [200, 206, 214];
    } else {
      t = 0.22;
      mixWith = [255, 255, 255];
    }
    root.style.setProperty(k, toHex(
      rgb[0] + (mixWith[0] - rgb[0]) * t,
      rgb[1] + (mixWith[1] - rgb[1]) * t,
      rgb[2] + (mixWith[2] - rgb[2]) * t,
    ));
  }
}
