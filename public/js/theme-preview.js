// Theme Designer preview: draws MustardOS screens on a canvas from a theme's resolved scheme values and pictures,
// following the frontend's layout rules (header, content list, grid, footer, pop-ups). Fonts are approximated unless the
// theme keeps the TTF its .bin fonts were made from. Every drawn part records a region so a click can open its settings.

import { LAUNCH_ITEMS } from "./theme-schema.js";

const SAMPLE = {
  muxlaunch: { title: "MAIN MENU", items: LAUNCH_ITEMS.map(([id, label]) => [label, id]), nav: [["a", "Select"]] },
  muxplore: {
    title: "EXPLORE CONTENT", nav: [["a", "Open"], ["b", "Back"], ["x", "Options"]],
    items: ["Castlevania - Symphony of the Night", "Chrono Trigger", "Final Fantasy Tactics", "Golden Sun", "Metroid Fusion",
      "Mega Man X", "Pokemon Emerald", "Sonic the Hedgehog 2", "Street Fighter Alpha 3", "Super Mario World", "Tetris DX", "Zelda - Minish Cap"].map((t) => [t, ""]),
  },
  muxconfig: {
    title: "CONFIGURATION", nav: [["a", "Select"], ["b", "Back"]],
    items: [["General Settings", "general"], ["Connectivity", "connect"], ["Customisation", "custom"], ["Interface Options", "interface"],
      ["Language", "language"], ["Power Settings", "power"], ["Storage", "storage"], ["Device Backup", "backup"], ["Overlay", "overlay"]],
  },
  muxtweakgen: {
    title: "GENERAL SETTINGS", nav: [["lr", "Change"], ["b", "Back"]],
    items: [["Brightness", "", "70%"], ["Volume", "", "45%"], ["Hidden Content", "", "Hide"], ["Startup", "", "Main Menu"],
      ["Colour Temperature", "", "Neutral"], ["Battery Display", "", "Percentage"], ["HDMI Output", "", "Off", true], ["Advanced Settings", "", ""]],
  },
};

const rgba = (hex, alpha = 255) => {
  const n = parseInt(String(hex || "000000").slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(255, alpha)) / 255})`;
};

function rounded(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h);
}

/** An LVGL-style background: a colour, or a gradient that keeps the first colour until start and reaches the second at stop. */
function fill(c, x, y, w, h, { colour, alpha = 255, grad, start = 0, stop = 255, dir = 0, radius = 0 }) {
  if (alpha <= 0 || w <= 0 || h <= 0) return;
  rounded(c, x, y, w, h, radius);
  if (dir === 1 || dir === 2) {
    const g = dir === 1 ? c.createLinearGradient(0, y, 0, y + h) : c.createLinearGradient(x, 0, x + w, 0);
    const a = Math.min(start, stop) / 255, b = Math.max(start, stop) / 255;
    g.addColorStop(0, rgba(colour, alpha));
    g.addColorStop(a, rgba(colour, alpha));
    g.addColorStop(Math.max(a, b), rgba(grad ?? colour, alpha));
    g.addColorStop(1, rgba(grad ?? colour, alpha));
    c.fillStyle = g;
  } else {
    c.fillStyle = rgba(colour, alpha);
  }
  c.fill();
}

function stroke(c, x, y, w, h, { colour, alpha = 255, width = 0, radius = 0, sides = 15 }) {
  if (alpha <= 0 || width <= 0) return;
  c.save();
  c.strokeStyle = rgba(colour, alpha);
  c.lineWidth = width;
  if (sides === 15) {
    rounded(c, x + width / 2, y + width / 2, w - width, h - width, Math.max(0, radius - width / 2));
    c.stroke();
  } else {
    c.fillStyle = rgba(colour, alpha);
    rounded(c, x, y, w, h, radius);
    c.clip();
    if (sides & 1) c.fillRect(x, y + h - width, w, width);
    if (sides & 2) c.fillRect(x, y, w, width);
    if (sides & 4) c.fillRect(x, y, width, h);
    if (sides & 8) c.fillRect(x + w - width, y, width, h);
  }
  c.restore();
}

function text(c, s, x, y, { colour, alpha = 255, font, align = "left", max = 0, shadow = null }) {
  if (alpha <= 0 || !s) return;
  c.save();
  c.font = font;
  c.textAlign = align;
  c.textBaseline = "middle";
  c.fillStyle = rgba(colour, alpha);
  if (shadow && shadow.alpha > 0) {
    c.shadowColor = rgba(shadow.colour, shadow.alpha);
    c.shadowOffsetX = shadow.x;
    c.shadowOffsetY = shadow.y;
  }
  let out = s;
  if (max > 0 && c.measureText(out).width > max) {
    while (out.length > 1 && c.measureText(`${out}\u2026`).width > max) out = out.slice(0, -1);
    out = `${out}\u2026`;
  }
  c.fillText(out, x, y);
  c.restore();
}

const scratch = document.createElement("canvas");

/** Draws a picture into a box, tinted like LVGL's recolour (mixing in the colour by tintAlpha) and faded by alpha. */
function picture(c, img, x, y, w, h, { tint = "FFFFFF", tintAlpha = 0, alpha = 255 } = {}) {
  if (!img || alpha <= 0 || w <= 0 || h <= 0) return;
  scratch.width = Math.ceil(w);
  scratch.height = Math.ceil(h);
  const s = scratch.getContext("2d");
  s.clearRect(0, 0, scratch.width, scratch.height);
  s.drawImage(img, 0, 0, scratch.width, scratch.height);
  if (tintAlpha > 0) {
    s.globalCompositeOperation = "source-atop";
    s.fillStyle = rgba(tint, tintAlpha);
    s.fillRect(0, 0, scratch.width, scratch.height);
    s.globalCompositeOperation = "source-over";
  }
  c.save();
  c.globalAlpha = alpha / 255;
  c.drawImage(scratch, x, y);
  c.restore();
}

/** A stand-in icon when the theme has no picture: MustardOS falls back to its own glyphs. */
function placeholderIcon(c, x, y, size, colour, alpha) {
  if (alpha <= 0) return;
  c.save();
  c.strokeStyle = rgba(colour, alpha);
  c.lineWidth = Math.max(1.5, size / 12);
  rounded(c, x + size * 0.15, y + size * 0.15, size * 0.7, size * 0.7, size * 0.18);
  c.stroke();
  c.fillStyle = rgba(colour, alpha);
  c.beginPath();
  c.arc(x + size / 2, y + size / 2, size * 0.12, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/**
 * Draws one screen. opts: w, h (theme resolution), screen (SCREENS id), program (scheme program), get(section, key),
 * image(paths) -> loaded picture or null, font(kind) -> CSS family, size(kind) -> px or 0, regions (array to fill).
 */
export function drawScreen(canvas, opts) {
  const { w, h, screen, get, image, regions } = opts;
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, w, h);
  regions.length = 0;
  const mark = (group, x, y, rw, rh) => regions.push({ group, x, y, w: rw, h: rh });
  const res = `${w}x${h}`;
  const baseSize = Math.round(h / 24);
  const fontOf = (kind, px) => `${px}px ${opts.font(kind)}`;
  const sizeOf = (kind, fallback) => get("font", { list: "FONT_LIST_SIZE", header: "FONT_HEADER_SIZE", footer: "FONT_FOOTER_SIZE", panel: "FONT_PANEL_SIZE" }[kind]) || opts.size(kind) || fallback;
  const find = (...names) => image(names.flatMap((n) => [`${res}/${n}`, n]));

  if (screen === "boot") {
    c.fillStyle = "#000";
    c.fillRect(0, 0, w, h);
    const logo = find("image/bootlogo.png", "image/bootlogo.bmp");
    if (logo) c.drawImage(logo, (w - logo.naturalWidth) / 2, (h - logo.naturalHeight) / 2);
    else text(c, "No boot logo yet; add one in Pictures", w / 2, h / 2, { colour: "777777", font: fontOf("list", baseSize) });
    mark("images", 0, 0, w, h);
    return;
  }

  const program = opts.program;
  const sample = SAMPLE[screen] || SAMPLE.muxconfig;
  const focus = screen === "muxlaunch" ? 0 : 2;
  const focusId = sample.items[focus]?.[1] || "";

  // background and wallpaper
  fill(c, 0, 0, w, h, {
    colour: get("background", "BACKGROUND"), alpha: get("background", "BACKGROUND_ALPHA"), grad: get("background", "BACKGROUND_GRADIENT_COLOR"),
    start: get("background", "BACKGROUND_GRADIENT_START"), stop: get("background", "BACKGROUND_GRADIENT_STOP"), dir: get("background", "BACKGROUND_GRADIENT_DIRECTION"),
  });
  mark("background", 0, 0, w, h);
  const wall = find(...(program === "muxlaunch" && focusId ? [`image/wall/muxlaunch/${focusId}.png`] : []), `image/wall/${program}.png`, "image/wall/default.png", "image/wall.png");
  if (wall) c.drawImage(wall, 0, 0);
  const staticImg = screen === "muxcharge" ? null
    : find(...(program === "muxlaunch" && focusId ? [`image/static/muxlaunch/${focusId}.png`] : []), `image/static/${program}.png`, "image/static/default.png");
  const staticAlign = get("misc", "STATIC_ALIGNMENT");
  const hh = get("header", "HEADER_HEIGHT"), fh = get("footer", "FOOTER_HEIGHT");
  const drawStatic = () => {
    if (!staticImg) return;
    const iw = staticImg.naturalWidth, ih = staticImg.naturalHeight;
    const pos = { 1: [w - iw, (h - ih) / 2], 2: [w - iw, hh + 2], 3: [(w - iw) / 2, (h - ih) / 2], 4: [(w - iw) / 2, (h - ih) / 2] }[staticAlign] || [w - iw, h - fh - ih];
    c.drawImage(staticImg, pos[0], pos[1]);
    mark("images", pos[0], pos[1], iw, ih);
  };
  if (staticAlign === 3) drawStatic();

  if (screen === "muxcharge") {
    const y = h / 2 + get("charging", "CHARGER_Y_POS");
    const bh = Math.round(h / 8);
    fill(c, 0, y - bh / 2, w, bh, { colour: get("charging", "CHARGER_BACKGROUND"), alpha: get("charging", "CHARGER_BACKGROUND_ALPHA") });
    text(c, "Charging 64%", w / 2, y, { colour: get("charging", "CHARGER_TEXT"), alpha: get("charging", "CHARGER_TEXT_ALPHA"), font: fontOf("list", baseSize), align: "center" });
    mark("boot", 0, y - bh / 2, w, bh);
    return;
  }

  // content
  const grid = screen === "muxlaunch" && get("grid", "COLUMN_COUNT") > 0 && get("grid", "ROW_COUNT") > 0;
  const top = hh + 2 + get("misc", "CONTENT_PADDING_TOP");
  const contentH = Math.max(0, Math.min(get("misc", "CONTENT_HEIGHT"), h));
  let count = Math.max(1, get("misc", "CONTENT_ITEM_COUNT"));
  let ih = get("misc", "CONTENT_ITEM_HEIGHT"), panel;
  if (ih > 0) { panel = ih + 2; count = Math.max(1, Math.floor(contentH / panel)); }
  else { panel = Math.floor(contentH / count); ih = panel - 2; }
  const contentW = get("misc", "CONTENT_WIDTH") || w;
  const padLeft = get("misc", "CONTENT_PADDING_LEFT");
  const align = get("misc", "CONTENT_ALIGNMENT");
  const left = align === 1 ? (w - contentW) / 2 + padLeft : align === 2 ? w - contentW - padLeft : padLeft;

  if (screen === "muxplore") drawArt(c, get, { x: get("image_list", "IMAGE_LIST_PAD_LEFT") || contentW, top: hh, w, h, fh, mark });
  if (grid) drawGrid(c, get, { w, h, top, contentH, contentW, left, find, sample, focus, fontOf, sizeOf, baseSize, mark });
  else drawList(c, get, { program, top, count, panel, ih, contentW, left, find, sample, focus, fontOf, sizeOf, baseSize, mark, screen });

  if (staticAlign !== 3 && staticAlign !== 4) drawStatic();
  drawHeader(c, get, { w, hh, find, title: sample.title, fontOf, sizeOf, baseSize, mark });
  drawFooter(c, get, { w, h, fh, find, nav: sample.nav, fontOf, sizeOf, baseSize, mark });
  if (!grid) drawCounter(c, get, { w, hh, total: sample.items.length, focus, fontOf, sizeOf, baseSize, mark });
  if (staticAlign === 4) drawStatic();

  if (screen === "popups") drawPopups(c, get, { w, h, fh, find, fontOf, sizeOf, baseSize, mark });
  if (screen === "keyboard") drawKeyboard(c, get, { w, h, fontOf, sizeOf, baseSize, mark });
  if (screen === "passcode") drawPasscode(c, get, { w, h, fontOf, sizeOf, baseSize, mark });

  const overlay = get("misc", "IMAGE_OVERLAY") ? find(`image/overlay/${program}.png`, "image/overlay.png") : null;
  if (overlay) c.drawImage(overlay, 0, 0, w, h);
}

function drawHeader(c, get, { w, hh, find, title, fontOf, sizeOf, baseSize, mark }) {
  if (hh <= 0) return;
  fill(c, 0, 0, w, hh, { colour: get("header", "HEADER_BACKGROUND"), alpha: get("header", "HEADER_BACKGROUND_ALPHA") });
  mark("header", 0, 0, w, hh);
  const font = fontOf("header", sizeOf("header", Math.round(baseSize * 0.9)));
  const mid = hh / 2 + (get("font", "FONT_HEADER_PAD_TOP") - get("font", "FONT_HEADER_PAD_BOTTOM")) / 2;
  const tAlign = get("header", "HEADER_TEXT_ALIGN");
  const tx = tAlign === 1 ? get("header", "PADDING_LEFT") + 12 : tAlign === 3 ? w - get("header", "PADDING_RIGHT") - 12 : w / 2;
  text(c, title, tx, mid, { colour: get("header", "HEADER_TEXT"), alpha: get("header", "HEADER_TEXT_ALPHA"), font, align: tAlign === 1 ? "left" : tAlign === 3 ? "right" : "center" });

  const dAlign = get("date", "DATETIME_ALIGN");
  const dx = dAlign === 2 ? w / 2 : dAlign === 3 ? w - 12 - get("date", "PADDING_RIGHT") : 12 + get("date", "PADDING_LEFT");
  text(c, "12:34", dx, mid, { colour: get("date", "DATETIME_TEXT"), alpha: get("date", "DATETIME_ALPHA"), font, align: dAlign === 2 ? "center" : dAlign === 3 ? "right" : "left" });

  const iconH = Math.round(hh * 0.5);
  const iy = (hh - iconH) / 2 + (get("font", "FONT_HEADER_ICON_PAD_TOP") - get("font", "FONT_HEADER_ICON_PAD_BOTTOM")) / 2;
  const icons = [
    ["glyph/header/bluetooth.png", get("bluetooth", "BLUETOOTH_NORMAL"), get("bluetooth", "BLUETOOTH_NORMAL_ALPHA"), "bt"],
    ["glyph/header/network_active.png", get("network", "NETWORK_ACTIVE"), get("network", "NETWORK_ACTIVE_ALPHA"), "wifi"],
    ["glyph/header/capacity_80.png", get("battery", "BATTERY_NORMAL"), get("battery", "BATTERY_NORMAL_ALPHA"), "bat"],
  ].map(([p, colour, alpha, kind]) => {
    const img = find(p);
    const iw = img ? Math.round(img.naturalWidth * iconH / img.naturalHeight) : kind === "bat" ? Math.round(iconH * 1.7) : iconH;
    return { img, colour, alpha, kind, iw };
  });
  const gap = 8, total = icons.reduce((a, i) => a + i.iw, 0) + gap * (icons.length - 1);
  const sAlign = get("status", "ALIGN");
  let x = sAlign === 0 ? 12 + get("status", "PADDING_LEFT") : sAlign === 2 ? (w - total) / 2 : w - 12 - get("status", "PADDING_RIGHT") - total;
  for (const i of icons) {
    if (i.img) picture(c, i.img, x, iy, i.iw, iconH, { tint: i.colour, tintAlpha: 255, alpha: i.alpha });
    else drawStatusIcon(c, i.kind, x, iy, i.iw, iconH, i.colour, i.alpha);
    x += i.iw + gap;
  }
}

function drawStatusIcon(c, kind, x, y, w, h, colour, alpha) {
  if (alpha <= 0) return;
  c.save();
  c.strokeStyle = c.fillStyle = rgba(colour, alpha);
  c.lineWidth = Math.max(1.5, h / 10);
  if (kind === "bat") {
    rounded(c, x, y + h * 0.15, w - h * 0.15, h * 0.7, h * 0.12);
    c.stroke();
    c.fillRect(x + w - h * 0.15, y + h * 0.35, h * 0.12, h * 0.3);
    c.fillRect(x + h * 0.15, y + h * 0.3, (w - h * 0.45) * 0.8, h * 0.4);
  } else if (kind === "wifi") {
    for (const r of [0.85, 0.55]) { c.beginPath(); c.arc(x + w / 2, y + h * 0.95, h * r, Math.PI * 1.25, Math.PI * 1.75); c.stroke(); }
    c.beginPath(); c.arc(x + w / 2, y + h * 0.85, h * 0.1, 0, Math.PI * 2); c.fill();
  } else {
    c.beginPath();
    c.moveTo(x + w * 0.3, y + h * 0.3); c.lineTo(x + w * 0.7, y + h * 0.7); c.lineTo(x + w / 2, y + h * 0.9); c.lineTo(x + w / 2, y + h * 0.1);
    c.lineTo(x + w * 0.7, y + h * 0.3); c.lineTo(x + w * 0.3, y + h * 0.7);
    c.stroke();
  }
  c.restore();
}

function drawFooter(c, get, { w, h, fh, find, nav, fontOf, sizeOf, baseSize, mark }) {
  if (fh <= 0) return;
  const y = h - fh;
  fill(c, 0, y, w, fh, { colour: get("footer", "FOOTER_BACKGROUND"), alpha: get("footer", "FOOTER_BACKGROUND_ALPHA") });
  mark("footer", 0, y, w, fh);
  const font = fontOf("footer", sizeOf("footer", Math.round(baseSize * 0.85)));
  const gs = get("glyph", "FOOTER") || Math.round(fh * 0.5);
  const spacing = get("navigation", "SPACING");
  c.save();
  c.font = font;
  const parts = nav.map(([b, label]) => {
    const key = `NAV_${b.toUpperCase()}`;
    const img = find(`glyph/footer/${b}.png`);
    const gw = img ? Math.round(img.naturalWidth * gs / img.naturalHeight) : gs;
    return { b, label, key, img, gw, tw: c.measureText(label).width };
  });
  c.restore();
  const widths = parts.map((p) => p.gw + 6 + p.tw);
  const content = widths.reduce((a, b) => a + b, 0);
  const alignment = get("navigation", "ALIGNMENT");
  let x = 12, gap = spacing + 8;
  if (alignment === 1) x = (w - content - gap * (parts.length - 1)) / 2;
  else if (alignment === 2) x = w - 12 - content - gap * (parts.length - 1);
  else if (alignment >= 3 && alignment <= 5) {
    const free = w - content;
    const slots = alignment === 3 ? parts.length * 2 : alignment === 4 ? Math.max(1, parts.length - 1) : parts.length + 1;
    gap = free / slots * (alignment === 3 ? 2 : 1);
    x = alignment === 3 ? gap / 2 : alignment === 4 ? (parts.length > 1 ? 0 : free / 2) : gap;
  }
  const mid = y + fh / 2 + (get("font", "FONT_FOOTER_PAD_TOP") - get("font", "FONT_FOOTER_PAD_BOTTOM")) / 2;
  const iy = y + (fh - gs) / 2 + (get("font", "FONT_FOOTER_ICON_PAD_TOP") - get("font", "FONT_FOOTER_ICON_PAD_BOTTOM")) / 2;
  parts.forEach((p, i) => {
    const glyph = get("navigation", `${p.key}_GLYPH`), ga = get("navigation", `${p.key}_GLYPH_ALPHA`), ra = get("navigation", `${p.key}_GLYPH_RECOLOUR_ALPHA`);
    if (p.img) picture(c, p.img, x, iy, p.gw, gs, { tint: glyph, tintAlpha: ra, alpha: ga });
    else if (ga > 0) {
      c.save();
      c.fillStyle = rgba(glyph, ga);
      c.beginPath();
      c.arc(x + gs / 2, iy + gs / 2, gs / 2, 0, Math.PI * 2);
      c.fill();
      c.restore();
      text(c, p.b.length > 1 ? p.b.toUpperCase().slice(0, 2) : p.b.toUpperCase(), x + gs / 2, iy + gs / 2, { colour: get("footer", "FOOTER_BACKGROUND"), font: `bold ${Math.round(gs * 0.55)}px sans-serif`, align: "center" });
    }
    text(c, p.label, x + p.gw + 6, mid, { colour: get("navigation", `${p.key}_TEXT`), alpha: get("navigation", `${p.key}_TEXT_ALPHA`), font });
    x += widths[i] + gap;
  });
}

function drawList(c, get, { program, top, count, panel, ih, contentW, left, find, sample, focus, fontOf, sizeOf, baseSize, mark, screen }) {
  const font = fontOf("list", sizeOf("list", Math.max(10, Math.min(Math.round(ih * 0.6), Math.round(baseSize * 1.1)))));
  const glyphHidden = get("list", "LIST_DEFAULT_GLYPH_ALPHA") === 0 && get("list", "LIST_FOCUS_GLYPH_ALPHA") === 0;
  const gPadL = get("list", "LIST_DEFAULT_GLYPH_PAD_LEFT"), gPadR = get("list", "LIST_DEFAULT_GLYPH_PAD_RIGHT");
  const gs = get("glyph", "LIST") || Math.round(ih * 3 / 4);
  const showGlyphs = !glyphHidden && screen !== "muxplore" && screen !== "muxtweakgen";
  const textX = showGlyphs ? gPadL + gs + gPadR : screen === "muxplore" || screen === "muxtweakgen" ? get("font", "FONT_LIST_PAD_LEFT") : gPadL;
  const bgMain = get("background", "BACKGROUND");
  const radius = Math.min(get("list", "LIST_DEFAULT_RADIUS"), Math.floor(ih / 2));
  const items = sample.items.slice(0, count);
  items.forEach(([label, glyphId, value, disabled], i) => {
    const y = top + i * panel;
    const s = i === focus ? "LIST_FOCUS" : "LIST_DEFAULT";
    const bg = get("list", `${s}_BACKGROUND`);
    fill(c, left, y, contentW, ih, {
      colour: bg, alpha: get("list", `${s}_BACKGROUND_ALPHA`), grad: get("list", `${s}_GRADIENT_START`) === 255 ? bg : bgMain,
      start: get("list", `${s}_GRADIENT_START`), stop: get("list", `${s}_GRADIENT_STOP`), dir: get("list", `${s}_GRADIENT_DIRECTION`), radius,
    });
    stroke(c, left, y, contentW, ih, { colour: get("list", `${s}_INDICATOR`), alpha: get("list", `${s}_INDICATOR_ALPHA`), width: get("list", `${s}_BORDER_WIDTH`), radius, sides: get("list", `${s}_BORDER_SIDE`) });
    mark("list", left, y, contentW, ih);
    if (showGlyphs) {
      const img = glyphId ? find(`glyph/${program}/${glyphId}.png`) : null;
      const gy = y + (ih - gs) / 2 + (get("font", "FONT_LIST_ICON_PAD_TOP") - get("font", "FONT_LIST_ICON_PAD_BOTTOM")) / 2;
      const ga = get("list", `${s}_GLYPH_ALPHA`), tint = get("list", `${s}_GLYPH_RECOLOUR`), ta = get("list", `${s}_GLYPH_RECOLOUR_ALPHA`);
      if (img) picture(c, img, left + gPadL, gy, gs, gs, { tint, tintAlpha: ta, alpha: ga });
      else placeholderIcon(c, left + gPadL, gy, gs, ta > 0 ? tint : get("list", `${s}_TEXT`), ga);
    }
    const mid = y + ih / 2 + (get("font", "FONT_LIST_PAD_TOP") - get("font", "FONT_LIST_PAD_BOTTOM")) / 2;
    const colour = disabled ? get("list", "LIST_DISABLED_TEXT") : get("list", `${s}_TEXT`);
    const alpha = disabled ? get("list", "LIST_DISABLED_TEXT_ALPHA") : get("list", `${s}_TEXT_ALPHA`);
    const shadow = { colour: get("list", `${s}_SHADOW_COLOUR`), alpha: get("list", `${s}_SHADOW_ALPHA`), x: get("list", `${s}_SHADOW_X_OFFSET`), y: get("list", `${s}_SHADOW_Y_OFFSET`) };
    const valueW = value ? contentW * (1 - get("misc", "LABEL_WIDTH") / 100) : 0;
    text(c, label, left + textX, mid, { colour, alpha, font, max: contentW - textX - get("font", "FONT_LIST_PAD_RIGHT") - valueW, shadow });
    if (value) text(c, value, left + contentW - get("font", "FONT_LIST_PAD_RIGHT") - 6, mid, { colour, alpha, font, align: "right", shadow });
  });
}

function drawGrid(c, get, { w, h, top, contentH, contentW, left, find, sample, focus, fontOf, sizeOf, baseSize, mark }) {
  const cols = get("grid", "COLUMN_COUNT"), rows = get("grid", "ROW_COUNT");
  const colW = get("grid", "COLUMN_WIDTH") || Math.floor(contentW / cols);
  const rowH = get("grid", "ROW_HEIGHT") || Math.floor(contentH / rows);
  const gw = cols * colW, gh = rows * rowH;
  let gx = get("grid", "LOCATION_X"), gy = get("grid", "LOCATION_Y");
  const al = get("grid", "ALIGNMENT");
  if (al > 0) {
    const ox = get("grid", "ALIGNMENT_X_OFFSET"), oy = get("grid", "ALIGNMENT_Y_OFFSET");
    const hx = { 1: 0, 4: 0, 7: 0, 2: 0.5, 5: 0.5, 9: 0.5, 3: 1, 6: 1, 8: 1 }[al] ?? 0.5;
    const vy = { 1: 0, 2: 0, 3: 0, 7: 0.5, 9: 0.5, 8: 0.5, 4: 1, 5: 1, 6: 1 }[al] ?? 0.5;
    gx = (w - gw) * hx + ox;
    gy = (h - gh) * vy + oy;
  } else if (gx === 0 && gy === 0) {
    gx = left;
    gy = top;
  }
  fill(c, gx, gy, gw, gh, { colour: get("grid", "BACKGROUND"), alpha: get("grid", "BACKGROUND_ALPHA") });
  mark("grid", gx, gy, gw, gh);
  const cw = Math.min(get("grid", "CELL_WIDTH"), colW), ch = Math.min(get("grid", "CELL_HEIGHT"), rowH);
  const radius = get("grid", "CELL_RADIUS"), bw = get("grid", "CELL_BORDER_WIDTH");
  const font = fontOf("list", sizeOf("list", Math.max(10, Math.round(baseSize * 0.85))));
  const colAl = get("grid", "CELL_COLUMN_ALIGN"), rowAl = get("grid", "CELL_ROW_ALIGN");
  sample.items.slice(0, cols * rows).forEach(([label, id], i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = gx + col * colW + (colAl === 0 ? 0 : colAl === 2 ? colW - cw : (colW - cw) / 2);
    const y = gy + row * rowH + (rowAl === 0 ? 0 : rowAl === 2 ? rowH - ch : (rowH - ch) / 2);
    const s = i === focus ? "CELL_FOCUS" : "CELL_DEFAULT";
    if (get("grid", "CELL_SHADOW_WIDTH") > 0) {
      c.save();
      c.shadowColor = rgba(get("grid", "CELL_SHADOW"), 255);
      c.shadowBlur = get("grid", "CELL_SHADOW_WIDTH");
      c.shadowOffsetX = get("grid", "CELL_SHADOW_X_OFFSET");
      c.shadowOffsetY = get("grid", "CELL_SHADOW_Y_OFFSET");
      rounded(c, x, y, cw, ch, radius);
      c.fillStyle = "rgba(0,0,0,1)";
      c.fill();
      c.restore();
    }
    fill(c, x, y, cw, ch, {
      colour: get("grid", `${s}_BACKGROUND`), alpha: get("grid", `${s}_BACKGROUND_ALPHA`), grad: get("grid", `${s}_BACKGROUND_GRADIENT_COLOR`),
      start: get("grid", `${s}_BACKGROUND_GRADIENT_START`), stop: get("grid", `${s}_BACKGROUND_GRADIENT_STOP`), dir: get("grid", `${s}_BACKGROUND_GRADIENT_DIRECTION`), radius,
    });
    stroke(c, x, y, cw, ch, { colour: get("grid", `${s}_BORDER`), alpha: get("grid", `${s}_BORDER_ALPHA`), width: bw, radius });
    const textAlpha = get("grid", `${s}_TEXT_ALPHA`);
    const img = find(`image/grid/muxlaunch/${id}.png`, `glyph/muxlaunch/${id}.png`);
    const imgArea = Math.max(8, Math.min(cw, ch) - get("grid", "CELL_IMAGE_PADDING_TOP") * 2 - (textAlpha > 0 ? baseSize * 1.6 : 0));
    let iw = imgArea, ihh = imgArea;
    if (img) {
      const scale = Math.min(1, imgArea / Math.max(img.naturalWidth, img.naturalHeight));
      iw = img.naturalWidth * scale;
      ihh = img.naturalHeight * scale;
    }
    const iy = textAlpha > 0 ? y + get("grid", "CELL_IMAGE_PADDING_TOP") : y + (ch - ihh) / 2;
    const look = { tint: get("grid", `${s}_IMAGE_RECOLOUR`), tintAlpha: get("grid", `${s}_IMAGE_RECOLOUR_ALPHA`), alpha: get("grid", `${s}_IMAGE_ALPHA`) };
    if (img) picture(c, img, x + (cw - iw) / 2, iy, iw, ihh, look);
    else placeholderIcon(c, x + (cw - iw) / 2, iy, iw, get("grid", `${s}_TEXT`), look.alpha);
    text(c, label, x + cw / 2, y + ch - get("grid", "CELL_TEXT_PADDING_BOTTOM") - baseSize * 0.6, {
      colour: get("grid", `${s}_TEXT`), alpha: textAlpha, font, align: "center", max: cw - get("grid", "CELL_TEXT_PADDING_SIDE") * 2,
    });
  });

  const L = (k) => get("grid", `CURRENT_ITEM_LABEL_${k}`);
  if (L("BACKGROUND_ALPHA") > 0 || L("TEXT_ALPHA") > 0 || L("BORDER_ALPHA") > 0) {
    const label = sample.items[focus][0];
    c.save();
    c.font = font;
    const lw = L("WIDTH") || c.measureText(label).width + L("TEXT_PADDING_LEFT") + L("TEXT_PADDING_RIGHT") + 8;
    c.restore();
    const lh = L("HEIGHT") || baseSize * 1.4 + L("TEXT_PADDING_TOP") + L("TEXT_PADDING_BOTTOM");
    const al2 = L("ALIGNMENT");
    const hx = { 1: 0, 4: 0, 7: 0, 2: 0.5, 5: 0.5, 9: 0.5, 3: 1, 6: 1, 8: 1 }[al2] ?? 0.5;
    const vy = { 1: 0, 2: 0, 3: 0, 7: 0.5, 9: 0.5, 8: 0.5, 4: 1, 5: 1, 6: 1 }[al2] ?? 1;
    const x = (w - lw) * hx + L("OFFSET_X"), y = (h - lh) * vy + L("OFFSET_Y");
    fill(c, x, y, lw, lh, { colour: L("BACKGROUND"), alpha: L("BACKGROUND_ALPHA"), grad: L("BACKGROUND_GRADIENT_COLOR"), start: L("BACKGROUND_GRADIENT_START"), stop: L("BACKGROUND_GRADIENT_STOP"), dir: L("BACKGROUND_GRADIENT_DIRECTION"), radius: L("RADIUS") });
    stroke(c, x, y, lw, lh, { colour: L("BORDER"), alpha: L("BORDER_ALPHA"), width: L("BORDER_WIDTH"), radius: L("RADIUS") });
    const ta = L("TEXT_ALIGNMENT");
    text(c, label, ta === 1 ? x + L("TEXT_PADDING_LEFT") + 4 : ta === 3 ? x + lw - L("TEXT_PADDING_RIGHT") - 4 : x + lw / 2, y + lh / 2, {
      colour: L("TEXT"), alpha: L("TEXT_ALPHA"), font, align: ta === 1 ? "left" : ta === 3 ? "right" : "center",
    });
    mark("grid", x, y, lw, lh);
  }
}

function drawArt(c, get, { x, top, w, h, fh, mark }) {
  const pt = get("image_list", "IMAGE_LIST_PAD_TOP"), pb = get("image_list", "IMAGE_LIST_PAD_BOTTOM"), pr = get("image_list", "IMAGE_LIST_PAD_RIGHT");
  const aw = w - x - pr - 16, ah = h - top - fh - pt - pb - 16;
  if (aw < 40 || ah < 40) return;
  const size = Math.min(aw, ah * 0.75);
  const bx = x + (w - x - pr - size) / 2, by = top + pt + (h - top - fh - pt - pb - size / 0.75) / 2;
  const alpha = get("image_list", "IMAGE_LIST_ALPHA"), radius = get("image_list", "IMAGE_LIST_RADIUS");
  c.save();
  c.globalAlpha = alpha / 255;
  rounded(c, bx, by, size, size / 0.75, radius);
  const g = c.createLinearGradient(bx, by, bx + size, by + size / 0.75);
  g.addColorStop(0, "#3b5bdb");
  g.addColorStop(1, "#7048e8");
  c.fillStyle = g;
  c.fill();
  c.fillStyle = "rgba(255,255,255,.85)";
  c.font = `bold ${Math.round(size / 7)}px sans-serif`;
  c.textAlign = "center";
  c.fillText("BOX ART", bx + size / 2, by + size / 0.75 / 2);
  if (get("image_list", "IMAGE_LIST_RECOLOUR_ALPHA") > 0) {
    c.globalAlpha = (alpha / 255) * (get("image_list", "IMAGE_LIST_RECOLOUR_ALPHA") / 255);
    rounded(c, bx, by, size, size / 0.75, radius);
    c.fillStyle = rgba(get("image_list", "IMAGE_LIST_RECOLOUR"), 255);
    c.fill();
  }
  c.restore();
  mark("artwork", bx, by, size, size / 0.75);
}

function drawCounter(c, get, { w, hh, total, focus, fontOf, sizeOf, baseSize, mark }) {
  const K = (k) => get("counter", `COUNTER_${k}`);
  if (K("TEXT_ALPHA") <= 0 && K("BACKGROUND_ALPHA") <= 0 && K("BORDER_ALPHA") <= 0) return;
  const label = `${focus + 1}${K("TEXT_SEPARATOR")}${total}`;
  const font = fontOf("list", Math.round(sizeOf("list", baseSize) * 0.8));
  c.save();
  c.font = font;
  const tw = c.measureText(label).width;
  c.restore();
  const pad = K("PADDING_AROUND"), bw = tw + pad * 2, bh = baseSize + pad * 2;
  const al = K("ALIGNMENT");
  const x = al === 1 ? (w - bw) / 2 : al === 2 ? w - bw - K("PADDING_SIDE") : K("PADDING_SIDE");
  const y = hh + 4 + K("PADDING_TOP");
  fill(c, x, y, bw, bh, { colour: K("BACKGROUND"), alpha: K("BACKGROUND_ALPHA"), radius: K("RADIUS") });
  stroke(c, x, y, bw, bh, { colour: K("BORDER_COLOUR"), alpha: K("BORDER_ALPHA"), width: K("BORDER_WIDTH"), radius: K("RADIUS") });
  text(c, label, x + bw / 2, y + bh / 2, { colour: K("TEXT"), alpha: K("TEXT_ALPHA"), font, align: "center" });
  mark("list", x, y, bw, bh);
}

function drawPopups(c, get, { w, h, fh, find, fontOf, sizeOf, baseSize, mark }) {
  const font = fontOf("panel", sizeOf("panel", Math.round(baseSize * 0.9)));
  const bold = fontOf("panel", Math.round(sizeOf("panel", baseSize) * 1.05));
  const H = (k) => get("help", `HELP_${k}`);
  const bw = Math.round(w * 0.78), bh = Math.round(h * 0.42), bx = (w - bw) / 2, by = Math.round(h * 0.13);
  fill(c, bx, by, bw, bh, { colour: H("BACKGROUND"), alpha: H("BACKGROUND_ALPHA"), radius: H("RADIUS") });
  stroke(c, bx, by, bw, bh, { colour: H("BORDER"), alpha: H("BORDER_ALPHA"), width: 2, radius: H("RADIUS") });
  text(c, "General Settings", bx + 16, by + baseSize * 1.2, { colour: H("TITLE"), font: bold });
  ["Brightness, volume, start-up and the", "other settings that apply everywhere.", "Press B to close this window."].forEach((line, i) => {
    text(c, line, bx + 16, by + baseSize * (2.8 + i * 1.35), { colour: H("CONTENT"), font, max: bw - 32 });
  });
  mark("popups", bx, by, bw, bh);

  const B = (k) => get("bar", `BAR_${k}`);
  const barW = Math.min(B("WIDTH"), w), barH = B("HEIGHT"), barX = (w - barW) / 2, barY = B("Y_POS");
  fill(c, barX, barY, barW, barH, { colour: B("BACKGROUND"), alpha: B("BACKGROUND_ALPHA"), radius: B("RADIUS") });
  stroke(c, barX, barY, barW, barH, { colour: B("BORDER"), alpha: B("BORDER_ALPHA"), width: 2, radius: B("RADIUS") });
  const pw = Math.min(B("PROGRESS_WIDTH"), barW - 20), ph = B("PROGRESS_HEIGHT");
  const px = barX + barW - pw - 12, py = barY + (barH - ph) / 2;
  const icon = find("glyph/bar/volume_2.png");
  const is = Math.round(barH * 0.55);
  if (icon) picture(c, icon, barX + 12, barY + (barH - is) / 2, is, is, { tint: B("ICON"), tintAlpha: 255, alpha: B("ICON_ALPHA") });
  else drawStatusIcon(c, "wifi", barX + 12, barY + (barH - is) / 2, is, is, B("ICON"), B("ICON_ALPHA"));
  fill(c, px, py, pw, ph, { colour: B("PROGRESS_BACKGROUND"), alpha: B("PROGRESS_BACKGROUND_ALPHA"), radius: B("PROGRESS_RADIUS") });
  fill(c, px, py, pw * 0.6, ph, { colour: B("PROGRESS_ACTIVE_BACKGROUND"), alpha: B("PROGRESS_ACTIVE_BACKGROUND_ALPHA"), radius: B("PROGRESS_RADIUS") });
  mark("bar", barX, barY, barW, barH);

  const M = (k) => get("notification", `MSG_${k}`);
  const msg = "Theme saved";
  c.save();
  c.font = font;
  const mw = c.measureText(msg).width + 40;
  c.restore();
  const mh = baseSize * 2, mx = (w - mw) / 2, my = barY - mh - 14 - (get("font", "FONT_MESSAGE_PAD_BOTTOM") - get("font", "FONT_MESSAGE_PAD_TOP"));
  fill(c, mx, my, mw, mh, { colour: M("BACKGROUND"), alpha: M("BACKGROUND_ALPHA"), radius: M("RADIUS") });
  stroke(c, mx, my, mw, mh, { colour: M("BORDER"), alpha: M("BORDER_ALPHA"), width: 2, radius: M("RADIUS") });
  text(c, msg, w / 2, my + mh / 2, { colour: M("TEXT"), alpha: M("TEXT_ALPHA"), font, align: "center" });
  mark("popups", mx, my, mw, mh);
}

function drawKeyboard(c, get, { w, h, fontOf, sizeOf, baseSize, mark }) {
  const K = (k) => get("keyboard", `OSK_${k}`);
  const kw = Math.round(w * 0.92), kh = Math.round(h * 0.56), kx = (w - kw) / 2, ky = h - kh - Math.round(h * 0.04);
  c.fillStyle = "rgba(0,0,0,.35)";
  c.fillRect(0, 0, w, h);
  fill(c, kx, ky, kw, kh, { colour: K("BACKGROUND"), alpha: K("BACKGROUND_ALPHA"), radius: K("RADIUS") });
  stroke(c, kx, ky, kw, kh, { colour: K("BORDER"), alpha: K("BORDER_ALPHA"), width: 2, radius: K("RADIUS") });
  mark("keyboard", kx, ky, kw, kh);
  const font = fontOf("panel", sizeOf("panel", Math.round(baseSize * 0.9)));
  text(c, "MustardOS_", kx + 18, ky + baseSize * 1.3, { colour: K("TEXT"), alpha: K("TEXT_ALPHA"), font });
  const rows = ["1234567890", "qwertyuiop", "asdfghjkl-", "zxcvbnm,._"];
  const pad = 10, top = ky + baseSize * 2.6, cellW = (kw - pad * 2) / 10, cellH = (ky + kh - pad - top) / rows.length;
  rows.forEach((row, r) => [...row].forEach((ch, i) => {
    const focus = r === 1 && i === 4;
    const x = kx + pad + i * cellW + 2, y = top + r * cellH + 2, cw = cellW - 4, chh = cellH - 4;
    const sfx = focus ? "_FOCUS" : "";
    const sh = { colour: K(`ITEM_SHADOW_COLOUR${sfx}`), alpha: K(`ITEM_SHADOW_ALPHA${sfx}`), x: K(`ITEM_SHADOW_X_OFFSET${sfx}`), y: K(`ITEM_SHADOW_Y_OFFSET${sfx}`) };
    if (sh.alpha > 0) fill(c, x + sh.x, y + sh.y, cw, chh, { colour: sh.colour, alpha: sh.alpha, radius: K("ITEM_RADIUS") });
    fill(c, x, y, cw, chh, { colour: K(focus ? "ITEM_BACKGROUND_FOCUS" : "ITEM_BACKGROUND"), alpha: K(focus ? "ITEM_BACKGROUND_FOCUS_ALPHA" : "ITEM_BACKGROUND_ALPHA"), radius: K("ITEM_RADIUS") });
    stroke(c, x, y, cw, chh, { colour: K(focus ? "ITEM_BORDER_FOCUS" : "ITEM_BORDER"), alpha: K(focus ? "ITEM_BORDER_FOCUS_ALPHA" : "ITEM_BORDER_ALPHA"), width: 2, radius: K("ITEM_RADIUS") });
    text(c, ch, x + cw / 2, y + chh / 2, { colour: K(focus ? "TEXT_FOCUS" : "TEXT"), alpha: K(focus ? "TEXT_FOCUS_ALPHA" : "TEXT_ALPHA"), font, align: "center" });
  }));
}

function drawPasscode(c, get, { w, h, fontOf, sizeOf, baseSize, mark }) {
  const R = (k) => get("roll", `ROLL_${k}`);
  const n = 6, cell = Math.round(Math.min(w / 10, h / 7)), gap = Math.round(cell * 0.35);
  const ww = n * cell + (n - 1) * gap + gap * 2, wh = cell * 3 + gap * 2, wx = (w - ww) / 2, wy = (h - wh) / 2;
  fill(c, wx, wy, ww, wh, { colour: get("background", "BACKGROUND"), alpha: 200, radius: R("BORDER_RADIUS") });
  stroke(c, wx, wy, ww, wh, { colour: R("BORDER_COLOUR"), alpha: R("BORDER_ALPHA"), width: 2, radius: R("BORDER_RADIUS") });
  mark("roll", wx, wy, ww, wh);
  const font = fontOf("panel", sizeOf("panel", Math.round(cell * 0.5)));
  for (let i = 0; i < n; i++) {
    const x = wx + gap + i * (cell + gap);
    for (let r = 0; r < 3; r++) {
      const y = wy + gap + r * cell, sel = r === 1, focus = sel && i === 2;
      fill(c, x, y, cell, cell - 4, {
        colour: R(focus ? "SELECT_BACKGROUND" : "BACKGROUND"), alpha: R(focus ? "SELECT_BACKGROUND_ALPHA" : "BACKGROUND_ALPHA") * (sel ? 1 : 0.45),
        radius: R(focus ? "SELECT_RADIUS" : "RADIUS"),
      });
      text(c, String((i * 3 + r + 7) % 10), x + cell / 2, y + (cell - 4) / 2, {
        colour: R(focus ? "SELECT_TEXT" : "TEXT"), alpha: R(focus ? "SELECT_TEXT_ALPHA" : "TEXT_ALPHA") * (sel ? 1 : 0.5), font, align: "center",
      });
    }
  }
}
