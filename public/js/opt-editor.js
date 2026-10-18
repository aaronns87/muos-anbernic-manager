// Shared RetroArch / Game Tuning core-options editor helpers (catalogue from the handheld + curated profiles).

import { esc, icon } from "./core.js";

export const optionLabel = (s, v) => (s.options || []).find(([o]) => o === v)?.[1] ?? v;

export function inheritedOf(s, base) {
  return base?.[s.key] ?? s.def ?? "";
}

export function effectiveOf(s, draft, base) {
  return (draft?.[s.key] || inheritedOf(s, base));
}

/** Draft: empty string means "use default/inherited". */
export function draftFromOwn(catalogue, own, base) {
  const out = {};
  for (const s of catalogue || []) {
    const v = own?.[s.key];
    const inh = inheritedOf(s, base);
    out[s.key] = v !== undefined && v !== inh ? v : "";
  }
  return out;
}

export function catalogueDirty(catalogue, draft, own, base) {
  const start = draftFromOwn(catalogue, own, base);
  return (catalogue || []).some((s) => (draft?.[s.key] || "") !== (start[s.key] || ""));
}

export function optRowHtml(s, draftVal, base, { disabled = false, dataKey = "opt-key" } = {}) {
  const d = draftVal || "";
  const inh = inheritedOf(s, base);
  const tag = s.curated && s.impact
    ? { speed: ["Speed", "ok-badge"], looks: ["Looks", ""], both: ["Speed + looks", "warn"] }[s.impact]
    : null;
  const badge = tag ? ` <span class="badge ${tag[1]}">${tag[0]}</span>` : (!s.curated ? ` <span class="badge">Core</span>` : "");
  let control;
  if (s.options && s.options.length) {
    const opts = [...s.options];
    if (d && !opts.some(([o]) => o === d)) opts.push([d, `${d} (on the handheld)`]);
    control = `<select class="control${d ? " active" : ""}" data-${dataKey}="${esc(s.key)}"${disabled ? " disabled" : ""}>
      <option value="">Default: ${esc(optionLabel(s, inh) || "-")}</option>
      ${opts.map(([v, l]) => `<option value="${esc(v)}"${d === v ? " selected" : ""}>${esc(l)}</option>`).join("")}
    </select>`;
  } else {
    control = `<input class="control mono${d ? " active" : ""}" data-${dataKey}="${esc(s.key)}" spellcheck="false"
      placeholder="${esc(inh || "value")}" value="${esc(d)}"${disabled ? " disabled" : ""} aria-label="${esc(s.label)}">`;
  }
  return `<label class="tune-row${d ? " set" : ""}">
    <span class="tune-row-text"><b>${esc(s.label)}${badge}</b><small>${esc(s.help || s.key)}</small></span>
    ${control}
  </label>`;
}

export function optGroupsHtml(catalogue, draft, base, { q = "", disabled = false, dataKey = "opt-key" } = {}) {
  const needle = q.trim().toLowerCase();
  const shown = (catalogue || []).filter((s) =>
    !needle || `${s.key} ${s.label} ${s.help}`.toLowerCase().includes(needle));
  if (!shown.length) {
    return `<p class="muted-note">${needle ? "No options match." : "No core options found on the handheld for this core yet. Save options once from Menu+X on the device to create a template, or set values below after creating a file."}</p>`;
  }
  const speed = shown.filter((s) => s.curated && s.impact !== "looks");
  const looks = shown.filter((s) => s.curated && s.impact === "looks");
  const other = shown.filter((s) => !s.curated);
  const group = (rows, label, ico) => rows.length
    ? `<section class="panel"><h2>${icon(ico)}${label}<small>${rows.length}</small></h2><div class="tune-rows">${rows.map((s) => optRowHtml(s, draft?.[s.key], base, { disabled, dataKey })).join("")}</div></section>`
    : "";
  // Curated-only cores: speed/looks. Device-only keys: More core options.
  if (!speed.length && !looks.length && other.length) {
    return `<section class="panel"><h2>${icon("sliders")}Core options<small>${other.length}</small></h2><div class="tune-rows">${other.map((s) => optRowHtml(s, draft?.[s.key], base, { disabled, dataKey })).join("")}</div></section>`;
  }
  return group(speed, "Speed", "bolt") + group(looks, "Looks", "image") + group(other, "More core options", "sliders");
}

export function valuesPayload(catalogue, draft) {
  return Object.fromEntries((catalogue || []).map((s) => [s.key, draft?.[s.key] ?? ""]));
}
