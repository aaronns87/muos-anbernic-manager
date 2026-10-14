// Theme Designer file panels: pictures, icons, fonts, sounds, theme details and colour variants. Uploads go straight into
// the theme in the themes folder; removing a file moves it to the Trash.

import { $, esc, human, icon, plural, toast } from "./core.js";
import { confirmBox } from "./art-images.js";

const GLYPH_FOLDERS = [
  ["muxlaunch", "Main menu", "Next to each main menu item; about 26 px at 640x480."],
  ["footer", "Button hints", "The buttons in the footer; about 20 px tall at 640x480."],
  ["header", "Status icons", "Battery, Wi-Fi and Bluetooth in the header; about 23 px tall at 640x480."],
  ["bar", "Volume and brightness", "The icon in the volume and brightness bar."],
  ["muxconfig", "Configuration", "Next to the Configuration items."],
];
const FULL = new Set(["wall/default.png", "bootlogo.png", "charge.png", "wall/muxcharge.png", "overlay.png", "screensaver.png", "reboot.png", "shutdown.png"]);
const A = { extra: new Set(), folders: new Set(), font: null, busy: "" };

const scopeOf = (H) => (H.D.imgScope === "res" ? `${H.D.res}/` : "");
const extOf = (name) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();

function scopeBar(H, what) {
  const res = H.D.res, on = H.D.imgScope === "res";
  return `<div class="dz-scope"><span>${what} for</span><span class="dz-seg" role="group">
      <button data-da="scope" data-scope="all" class="${on ? "" : "on"}" aria-pressed="${!on}">Every screen size</button>
      <button data-da="scope" data-scope="res" class="${on ? "on" : ""}" aria-pressed="${on}">Only ${esc(res)}</button></span>
    <small>Files for one size win over the ones for every size.</small></div>`;
}

function tile(H, path, label, hint, accept = ".png") {
  const have = H.has(path);
  const sized = /^\d+x\d+\//.test(path);
  const twin = sized ? path.replace(/^\d+x\d+\//, "") : `${H.D.res}/${path}`;
  const isSound = path.endsWith(".wav");
  return `<div class="dz-tile${have ? " have" : ""}" data-drop="${esc(path)}" data-accept="${accept}">
      <div class="dz-thumb">${have ? (isSound ? icon("play") : `<img src="${H.fileUrl(path)}" alt="">`) : icon(isSound ? "play" : "image")}</div>
      <div class="dz-tile-text"><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ""}
        ${have ? `<small class="muted">${esc(path)} &middot; ${human(H.D.files.get(path).size)}</small>` : H.has(twin) ? `<small class="muted">Set ${sized ? "for every size" : `for ${esc(H.D.res)}`}</small>` : ""}</div>
      <div class="dz-tile-acts">
        ${have && isSound ? `<button class="btn small ghost icon-only" data-da="play" data-path="${esc(path)}" title="Play" aria-label="Play">${icon("play")}</button>` : ""}
        <button class="btn small" data-da="pick" data-path="${esc(path)}" data-accept="${accept}">${have ? "Replace" : "Add"}</button>
        ${have ? `<button class="btn small ghost icon-only" data-da="remove" data-path="${esc(path)}" title="Move to the Trash" aria-label="Remove">${icon("trash")}</button>` : ""}
      </div></div>`;
}

const fileInput = () => `<input type="file" id="dz-file" hidden>`;

// ---------------------------------------------------------------- panels

export function assetPanel(id, H) {
  const view = { images, glyphs, fonts, sounds, details, variants }[id];
  return view ? view(H) + fileInput() : "";
}

function images(H) {
  const { D, S } = H;
  const pre = scopeOf(H);
  const [w, h] = D.res.split("x");
  const size = (rel) => (FULL.has(rel) ? ` Make it ${w} x ${h} pixels; pictures are not scaled.` : "");
  const known = new Set(S.IMAGE_SLOTS.map(([rel]) => `image/${rel}`));
  const walls = [...new Set([...[...D.files.keys()].map((p) => p.replace(/^\d+x\d+\//, "")).filter((p) => /^image\/wall\/mux\w+\.(png|svg|mp4)$/.test(p) && p !== "image/wall/muxcharge.png").map((p) => p.replace(/\.\w+$/, "")), ...A.extra])];
  const items = S.LAUNCH_ITEMS.map(([id, label]) => tile(H, `${pre}image/wall/muxlaunch/${id}.png`, label, "", ".png")).join("");
  const others = [...D.files.keys()].filter((p) => /^(\d+x\d+\/)?image\//.test(p) && !known.has(p.replace(/^\d+x\d+\//, "")) && !walls.some((x) => p.replace(/^\d+x\d+\//, "").startsWith(`${x}.`)) && !/image\/wall\/muxlaunch\//.test(p));
  const missing = S.PROGRAMS.filter(([p]) => !walls.includes(`image/wall/${p}`) && p !== "muxcharge");
  return `${scopeBar(H, "Pictures")}
    <section class="dz-part"><h4>Everywhere</h4><div class="dz-tiles">${S.IMAGE_SLOTS.map(([rel, label, hint]) => tile(H, `${pre}image/${rel}`, label, hint + size(rel), rel === "bootlogo.png" ? ".png,.bmp" : rel.startsWith("wall/") ? ".png,.svg,.mp4" : ".png")).join("")}</div></section>
    <section class="dz-part"><h4>Wallpaper for one screen</h4>
      <div class="dz-tiles">${walls.map((x) => { const p = x.slice(11); return tile(H, `${pre}${x}.png`, S.PROGRAMS.find((q) => q[0] === p)?.[1] || p, `Instead of the wallpaper on ${p}.`, ".png,.svg,.mp4"); }).join("")}</div>
      <label class="dz-add"><span>Add one for</span><select class="control" data-da-change="wall-add"><option value="">Pick a screen</option>${missing.map(([p, l]) => `<option value="${p}">${esc(l)}</option>`).join("")}</select></label></section>
    <details class="dz-part dz-more-part"><summary><h4>Main menu wallpaper per item</h4></summary><p class="muted-note">The wallpaper changes as you move through the main menu.</p><div class="dz-tiles">${items}</div></details>
    <section class="dz-part"><h4>Preview pictures</h4><p class="muted-note">The theme picker shows these. The designer draws them for you when you export or install a theme without them.</p>
      <div class="dz-tiles">${[["preview.png", "Main preview"], ["preview.0.png", "Second preview"], ["preview.1.png", "Third preview"]].map(([f, l]) => tile(H, `${D.res}/${f}`, `${l} (${D.res})`, "", ".png")).join("")}</div></section>
    ${others.length ? `<section class="dz-part"><h4>Other pictures in the theme</h4><div class="dz-tiles">${others.map((p) => tile(H, p, p.split("/").pop(), "", `.${extOf(p)}`)).join("")}</div></section>` : ""}`;
}

function glyphs(H) {
  const { D, S } = H;
  const pre = scopeOf(H);
  const present = new Set([...D.files.keys()].map((p) => p.replace(/^\d+x\d+\//, "")).filter((p) => p.startsWith("glyph/")).map((p) => p.split("/")[1]).filter((f) => !f.includes(".")));
  const folders = [...GLYPH_FOLDERS];
  for (const f of [...present, ...A.folders]) if (!folders.some((x) => x[0] === f)) folders.push([f, S.PROGRAMS.find((p) => p[0] === f)?.[1] || f, "Icons for this screen's items, named like the items."]);
  const card = ([folder, label, hint]) => {
    const names = new Set(S.GLYPHS[folder] || []);
    for (const p of D.files.keys()) {
      const m = p.match(new RegExp(`^(?:\\d+x\\d+/)?glyph/${folder}/([^/]+)\\.(png|svg)$`));
      if (m) names.add(m[1]);
    }
    return `<section class="dz-part dz-glyphs" data-drop-folder="${esc(`${pre}glyph/${folder}`)}" data-drop="${esc(`${pre}glyph/${folder}`)}">
      <header><h4>${esc(label)}</h4><small>${esc(hint)} Drop PNGs named like the slots onto this box.</small>
        <button class="btn small ghost" data-da="pick-many" data-folder="${esc(`${pre}glyph/${folder}`)}">${icon("upload")}<span>Add several</span></button></header>
      <div class="dz-cells">${[...names].map((n) => {
        const path = `${pre}glyph/${folder}/${n}.png`, have = H.has(path);
        return `<div class="dz-cell${have ? " have" : ""}" data-drop="${esc(path)}" data-accept=".png">
          <button class="dz-cell-pick" data-da="pick" data-path="${esc(path)}" data-accept=".png" title="${have ? "Replace" : "Add"} ${esc(n)}.png">${have ? `<img src="${H.fileUrl(path)}" alt="">` : icon("plus")}</button>
          <span>${esc(n)}</span>${have ? `<button class="dz-cell-x" data-da="remove" data-path="${esc(path)}" title="Move to the Trash" aria-label="Remove ${esc(n)}">${icon("x")}</button>` : ""}</div>`;
      }).join("") || `<p class="muted-note">Add PNG files named like the items, for example explore.png.</p>`}</div></section>`;
  };
  const grid = `<section class="dz-part dz-glyphs" data-drop-folder="${esc(`${pre}image/grid/muxlaunch`)}" data-drop="${esc(`${pre}image/grid/muxlaunch`)}">
    <header><h4>Main menu grid pictures</h4><small>Bigger pictures for a main menu drawn as a grid (Quick style, Main menu layout).</small>
      <button class="btn small ghost" data-da="pick-many" data-folder="${esc(`${pre}image/grid/muxlaunch`)}">${icon("upload")}<span>Add several</span></button></header>
    <div class="dz-cells">${S.LAUNCH_ITEMS.map(([n]) => {
      const path = `${pre}image/grid/muxlaunch/${n}.png`, have = H.has(path);
      return `<div class="dz-cell${have ? " have" : ""}" data-drop="${esc(path)}" data-accept=".png"><button class="dz-cell-pick" data-da="pick" data-path="${esc(path)}" data-accept=".png">${have ? `<img src="${H.fileUrl(path)}" alt="">` : icon("plus")}</button>
        <span>${esc(n)}</span>${have ? `<button class="dz-cell-x" data-da="remove" data-path="${esc(path)}" aria-label="Remove ${esc(n)}">${icon("x")}</button>` : ""}</div>`;
    }).join("")}</div></section>`;
  return `${scopeBar(H, "Icons")}${folders.map(card).join("")}${grid}
    <label class="dz-add"><span>Icons for another screen</span><select class="control" data-da-change="glyph-folder"><option value="">Pick a screen</option>${S.PROGRAMS.filter(([p]) => !folders.some((f) => f[0] === p)).map(([p, l]) => `<option value="${p}">${esc(l)}</option>`).join("")}</select></label>`;
}

function fonts(H) {
  const { D, S } = H;
  const pre = scopeOf(H);
  const sources = [...D.files.keys()].filter((p) => /^\.designer\/fonts\/[^/]+\.(ttf|otf|woff2?)$/i.test(p));
  const h = Number(D.res.split("x")[1]) || 480;
  const slot = ([rel, label, hint]) => {
    const path = pre + rel, have = H.has(path), made = D.model.fonts?.[path];
    const open = A.font?.slot === path;
    return `<div class="dz-tile${have ? " have" : ""}" data-drop="${esc(path)}" data-accept=".bin">
      <div class="dz-thumb dz-font-thumb">Aa</div>
      <div class="dz-tile-text"><b>${esc(label)}</b><small>${esc(hint)}</small>
        <small class="muted">${have ? (made ? `Made from ${esc(made.source.split("/").pop())} at ${made.size} px` : `A MustardOS font, ${human(D.files.get(path).size)}`) : "MustardOS's own font"}</small></div>
      <div class="dz-tile-acts">
        <button class="btn small" data-da="font-open" data-path="${esc(path)}"${sources.length ? "" : " disabled title=\"Add a TTF or OTF font first\""}>Make from a font</button>
        <button class="btn small ghost" data-da="pick" data-path="${esc(path)}" data-accept=".bin" title="A .bin font made with lv_font_conv">Add .bin</button>
        ${have ? `<button class="btn small ghost icon-only" data-da="remove" data-path="${esc(path)}" title="Move to the Trash" aria-label="Remove">${icon("trash")}</button>` : ""}
      </div>
      ${open ? `<div class="dz-font-form">
        <label><span>Font</span><select class="control" data-da-change="font-source">${sources.map((s) => `<option value="${esc(s)}"${s === A.font.source ? " selected" : ""}>${esc(s.split("/").pop())}</option>`).join("")}</select></label>
        <label><span>Size</span><input type="number" class="control dz-num" min="8" max="96" value="${A.font.size || Math.round(h / 24)}" data-da-change="font-size"></label>
        <label><span>Characters</span><select class="control" data-da-change="font-range">${[["basic", "English and Western European"], ["european", "All European (Latin)"], ["cyrillic", "Latin and Cyrillic"]].map(([v, l]) => `<option value="${v}"${v === (A.font.range || "european") ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <button class="btn small primary" data-da="font-make"${A.busy ? " disabled" : ""}>${A.busy ? `<span class="spinner sm"></span> ${esc(A.busy)}` : "Convert"}</button>
        <button class="btn small ghost" data-da="font-close">Cancel</button>
        <small class="muted">Uses LVGL's lv_font_conv through npx; the first time it is downloaded, which takes a moment.</small>
      </div>` : ""}</div>`;
  };
  return `${scopeBar(H, "Fonts")}
    <section class="dz-part"><h4>Your fonts</h4><p class="muted-note">TTF, OTF or WOFF fonts kept with the theme (not installed on the handheld). The designer turns them into MustardOS fonts and uses them in the preview.</p>
      <div class="dz-chips">${sources.map((s) => `<span class="pill">${icon("file")} ${esc(s.split("/").pop())} <button class="dz-cell-x" data-da="remove" data-path="${esc(s)}" aria-label="Remove">${icon("x")}</button></span>`).join("")}
      <button class="btn small" data-da="font-upload">${icon("upload")}<span>Add a font</span></button></div></section>
    <section class="dz-part"><h4>Where they are used</h4><div class="dz-tiles">${S.FONT_SLOTS.map(slot).join("")}</div></section>`;
}

function sounds(H) {
  return `<p class="muted-note">Short WAV files the handheld plays when sounds are on in Interface Options.</p>
    <div class="dz-tiles">${H.S.SOUNDS.map(([id, label]) => tile(H, `sound/${id}.wav`, label, `${id}.wav`, ".wav")).join("")}</div>`;
}

function details(H) {
  const { D, S } = H;
  const m = D.model;
  const sizes = [...new Set([...S.RESOLUTIONS, ...m.res])];
  return `<section class="dz-part"><h4>About</h4>
      <label class="dz-field"><span>Display name</span><input class="control" id="dz-title" value="${esc(m.title || m.name)}" maxlength="100"><small>Shown in the theme picker; the folder is ${esc(m.name)}.</small></label>
      <label class="dz-field"><span>Made for</span><select class="control" id="dz-version">${S.VERSIONS.map(([v, l]) => `<option value="${v}"${v === m.version ? " selected" : ""}>${esc(l)}</option>`).join("")}${S.VERSIONS.some(([v]) => v === m.version) ? "" : `<option value="${esc(m.version)}" selected>${esc(m.version || "Not set")}</option>`}</select><small>The theme picker hides themes made for other MustardOS versions.</small></label>
      <label class="dz-field"><span>Credits</span><textarea class="control" id="dz-credits" rows="4" maxlength="8000" placeholder="Who made it, fonts and pictures used">${esc(m.credits)}</textarea></label>
      <button class="btn small primary" data-da="meta">${icon("save")}<span>Save details</span></button></section>
    <section class="dz-part"><h4>Screen sizes</h4><p class="muted-note">Each size gets its own folder for size-specific settings, pictures and fonts. Removing a size moves its folder to the Trash.</p>
      <div class="dz-checks">${sizes.map((r) => `<label class="check"><input type="checkbox" data-da-change="res" value="${r}"${m.res.includes(r) ? " checked" : ""}> ${r}${r === H.deviceRes() ? " <em>your handheld</em>" : ""}</label>`).join("")}</div></section>
    <section class="dz-part"><h4>Preview pictures</h4><div class="dz-previews">${m.res.map((r) => `<figure>${H.has(`${r}/preview.png`) ? `<img src="${H.fileUrl(`${r}/preview.png`)}" alt="">` : `<span class="th-none">${icon("image")}</span>`}
      <figcaption>${r} <button class="btn small ghost" data-da="previews" data-res="${r}">${H.has(`${r}/preview.png`) ? "Draw again" : "Draw"}</button></figcaption></figure>`).join("")}</div></section>
    <section class="dz-part"><h4>Catalogue pictures</h4><div class="dz-tiles">${tile(H, "assets.muxzip", "assets.muxzip", "A zip of content pictures for the catalogue, installed with the theme.", ".muxzip,.zip")}</div></section>
    <section class="dz-part"><h4>Files</h4><p class="muted-note">${plural(m.count, "file")}, ${human(m.bytes)}. <button class="btn small ghost" data-dz="reveal">${icon("folder")}<span>Show in the themes folder</span></button></p></section>`;
}

function variants(H) {
  const { D } = H;
  const m = D.model;
  return `<p class="muted-note">Colour variants are extra colour sets people switch between in the theme picker's Alternates. A variant only holds the settings that differ; it is read after the theme's own schemes.</p>
    ${m.variants.length ? `<div class="dz-variants">${m.variants.map((v) => `<div class="dz-variant">
      <label class="check" title="The variant the theme starts with"><input type="radio" name="dz-active" data-da-change="var-default" value="${esc(v)}"${v === m.active ? " checked" : ""}> <b>${esc(v)}</b></label>
      <span class="grow"></span>
      <button class="btn small" data-da="var-edit" data-v="${esc(v)}">${icon("pencil")}<span>Edit colours</span></button>
      <button class="btn small ghost" data-da="var-rename" data-v="${esc(v)}">Rename</button>
      <button class="btn small ghost icon-only" data-da="var-delete" data-v="${esc(v)}" title="Move to the Trash" aria-label="Delete ${esc(v)}">${icon("trash")}</button></div>`).join("")}</div>` : `<div class="empty-state">${icon("palette")}<b>No colour variants</b><p>Add one, then pick a palette in Quick style while editing it.</p></div>`}
    <div class="dz-add"><input class="control" id="dz-var-name" placeholder="Name, for example Dark" maxlength="80">
      <select class="control" id="dz-var-copy"><option value="">Start empty</option>${m.variants.map((v) => `<option value="${esc(v)}">Copy ${esc(v)}</option>`).join("")}</select>
      <button class="btn small primary" data-da="var-add">${icon("plus")}<span>Add variant</span></button></div>`;
}

// ---------------------------------------------------------------- actions

let target = { path: "", folder: "" };

function pick(accept, multiple) {
  const input = $("dz-file");
  input.accept = accept;
  input.multiple = multiple;
  input.value = "";
  input.click();
}

/** The theme path for an uploaded file: the slot's own path, with the file's extension when the slot takes several kinds. */
function pathFor(path, file, accept) {
  const ext = extOf(file.name);
  const allowed = (accept || "").split(",").map((a) => a.replace(".", "").trim()).filter(Boolean);
  if (ext && allowed.includes(ext) && path.endsWith(`.${allowed[0]}`) && path !== "assets.muxzip") return path.replace(/\.[a-z0-9]+$/i, `.${ext}`);
  return path;
}

async function uploadMany(H, folder, files) {
  let n = 0;
  for (const file of files) {
    if (!/\.png$/i.test(file.name)) continue;
    await H.upload(`${folder}/${file.name.replace(/[^\w.-]+/g, "_")}`, file);
    n++;
  }
  H.render();
  H.redraw();
  toast(n ? `${plural(n, "picture")} added.` : "Only PNG files can be added here.", 3000);
}

async function guarded(H, fn) {
  try { await fn(); } catch (error) { toast(error.message, 6000); }
  H.render();
}

async function askName(title, label, value) {
  const ok = await confirmBox({ title, html: `<label class="dz-field"><span>${esc(label)}</span><input class="control" id="dz-ask" value="${esc(value)}" maxlength="80"></label>`, ok: "OK" });
  return ok ? $("dz-ask")?.value.trim() || "" : "";
}

export function assetClick(t, H) {
  const el = t.closest("[data-da]");
  if (!el || el.disabled) return false;
  const { da, path, v } = el.dataset;
  if (da === "scope") { H.D.imgScope = el.dataset.scope; H.render(); }
  else if (da === "pick") { target = { path, folder: "", accept: el.dataset.accept }; pick(el.dataset.accept || ".png", false); }
  else if (da === "pick-many") { target = { path: "", folder: el.dataset.folder }; pick(".png", true); }
  else if (da === "font-upload") { target = { path: ".designer/fonts/", folder: "", accept: ".ttf,.otf,.woff,.woff2" }; pick(".ttf,.otf,.woff,.woff2", false); }
  else if (da === "play") new Audio(H.fileUrl(path)).play().catch(() => toast("The browser could not play that sound.", 3000));
  else if (da === "remove") {
    confirmBox({ title: `Remove ${path.split("/").pop()}?`, html: `<p>${esc(path)} moves to the Trash on this computer.</p>`, ok: "Remove", danger: true })
      .then((ok) => ok && guarded(H, async () => { await H.remove(path); H.redraw(); }));
  } else if (da === "font-open") {
    const sources = [...H.D.files.keys()].filter((p) => p.startsWith(".designer/fonts/"));
    const made = H.D.model.fonts?.[path];
    A.font = { slot: path, source: made?.source || sources[0], size: made?.size || 0, range: made?.range || "european" };
    H.render();
  } else if (da === "font-close") { A.font = null; H.render(); }
  else if (da === "font-make") {
    const h = Number(H.D.res.split("x")[1]) || 480;
    A.busy = "Converting";
    H.render();
    guarded(H, async () => {
      try {
        await H.call("designer/font", { source: A.font.source, slot: A.font.slot, size: Number(A.font.size) || Math.round(h / 24), range: A.font.range || "european" });
        toast("The font is ready.", 3000);
        A.font = null;
      } finally { A.busy = ""; }
      H.redraw();
    });
  } else if (da === "meta") {
    guarded(H, async () => {
      await H.call("designer/meta", { title: $("dz-title").value, credits: $("dz-credits").value, version: $("dz-version").value });
      toast("Details saved.", 2000);
    });
  } else if (da === "previews") {
    el.disabled = true;
    guarded(H, async () => { await H.makePreviews(el.dataset.res); toast(`Preview pictures for ${el.dataset.res} are saved.`, 3000); });
  } else if (da === "var-edit") H.editVariant(v);
  else if (da === "var-add") {
    const name = $("dz-var-name").value.trim();
    if (!name) return toast("Give the variant a name.", 3000), true;
    guarded(H, async () => { await H.call("designer/variant", { action: "add", variant: name, copy: $("dz-var-copy").value }); H.editVariant(name); });
  } else if (da === "var-rename") {
    askName(`Rename ${v}`, "New name", v).then((to) => to && to !== v && guarded(H, () => H.call("designer/variant", { action: "rename", variant: v, to })));
  } else if (da === "var-delete") {
    confirmBox({ title: `Delete the variant ${v}?`, html: `<p>alternate/${esc(v)}.ini moves to the Trash on this computer.</p>`, ok: "Delete", danger: true })
      .then((ok) => ok && guarded(H, () => H.call("designer/variant", { action: "delete", variant: v })));
  } else return false;
  return true;
}

export function assetChange(t, H) {
  if (t.id === "dz-file") {
    const files = [...t.files];
    if (!files.length) return true;
    if (target.folder) { guarded(H, () => uploadMany(H, target.folder, files)); return true; }
    const file = files[0];
    const rel = target.path === ".designer/fonts/" ? `.designer/fonts/${file.name.replace(/[^\w.-]+/g, "_")}` : pathFor(target.path, file, target.accept);
    guarded(H, async () => { await H.upload(rel, file); H.redraw(); toast(`${rel.split("/").pop()} added.`, 2000); });
    return true;
  }
  const what = t.dataset.daChange;
  if (!what) return false;
  if (what === "wall-add" && t.value) { A.extra.add(`image/wall/${t.value}`); H.render(); }
  else if (what === "glyph-folder" && t.value) { A.folders.add(t.value); H.render(); }
  else if (what === "font-source") A.font.source = t.value;
  else if (what === "font-size") A.font.size = Number(t.value);
  else if (what === "font-range") A.font.range = t.value;
  else if (what === "var-default") guarded(H, () => H.call("designer/meta", { active: t.value }));
  else if (what === "res") {
    const res = t.value;
    if (t.checked) guarded(H, () => H.call("designer/resolution", { res }));
    else {
      t.checked = true;
      confirmBox({ title: `Remove ${res}?`, html: `<p>The ${esc(res)} folder, with its settings, pictures and fonts, moves to the Trash on this computer.</p>`, ok: "Remove", danger: true })
        .then((ok) => ok && guarded(H, () => H.call("designer/resolution", { res, remove: true })));
    }
  }
  return true;
}

export function assetDrop(zone, files, H) {
  if (!files?.length) return;
  const cell = zone.dataset.accept !== undefined;
  if (zone.dataset.dropFolder && (!cell || files.length > 1)) return void guarded(H, () => uploadMany(H, zone.dataset.dropFolder, [...files]));
  const file = files[0];
  const accept = zone.dataset.accept || ".png";
  if (!accept.split(",").includes(`.${extOf(file.name)}`)) return toast(`That place takes ${accept.replaceAll(",", ", ")} files.`, 3000);
  const rel = pathFor(zone.dataset.drop, file, accept);
  guarded(H, async () => { await H.upload(rel, file); H.redraw(); toast(`${rel.split("/").pop()} added.`, 2000); });
}
