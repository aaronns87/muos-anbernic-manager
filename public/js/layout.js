// Shared markup builders for panels, notices, loading and empty states.
// Copy: pending labels use &hellip;; recovery is always Try again with refresh + span.

import { icon } from "./core.js";

/**
 * Panel card. Prefer object form; string first arg keeps the older positional call sites.
 * @param {string|{size?:string,title:string,icon?:string,body:string,actions?:string}} opts
 */
export function panel(opts, title, body, actions = "", ico = "") {
  if (typeof opts === "string" || opts == null) {
    return panelHtml({ size: opts || "", title, body, actions, icon: ico });
  }
  return panelHtml(opts);
}

function panelHtml({ size = "", title: t, icon: ico = "", body: b, actions: a = "" }) {
  const cls = ["panel", size].filter(Boolean).join(" ");
  return `<section class="${cls}"><h2>${ico ? icon(ico) : ""}${t}</h2>${b}${a ? `<div class="panel-actions">${a}</div>` : ""}</section>`;
}

/** @param {"err"|"ok"|"warn"|""} [level] */
export function notice(level, html) {
  const mod = level === "err" || level === "ok" || level === "warn" ? ` ${level}` : "";
  return `<div class="notice${mod}">${html}</div>`;
}

export function loading(msg) {
  return `<div class="planning"><span class="spinner"></span> ${msg}</div>`;
}

export function loadingInline(msg) {
  return `<p class="muted-note"><span class="spinner sm"></span> ${msg}</p>`;
}

/**
 * @param {{icon?:string,title?:string,body?:string,actions?:string,className?:string}} opts
 * body may be plain text (wrapped in <p>) or HTML starting with "<".
 */
export function emptyState({ icon: ico = "", title = "", body = "", actions = "", className = "" } = {}) {
  const text = body
    ? (String(body).trimStart().startsWith("<") ? body : `<p>${body}</p>`)
    : "";
  return `<div class="empty-state${className ? ` ${className}` : ""}">${ico ? icon(ico) : ""}${title ? `<h3>${title}</h3>` : ""}${text}${actions ? `<div class="empty-actions">${actions}</div>` : ""}</div>`;
}

/** Standard recovery control: refresh icon + Try again. */
export function retryBtn(attrs = "") {
  const extra = attrs ? (attrs.startsWith(" ") ? attrs : ` ${attrs}`) : "";
  return `<button type="button" class="btn"${extra}>${icon("refresh")}<span>Try again</span></button>`;
}

/** Pending actions append &hellip; (HTML entity). */
export function btnLabel(text, pending = false) {
  return pending ? `${text}&hellip;` : text;
}

/** Section title row used by MCP and similar multi-block pages. */
export function sectionHead({ title, note = "", actions = "" } = {}) {
  return `<div class="section-head mcp-section-head"><div><h2>${title}</h2>${note ? `<p class="muted-note">${note}</p>` : ""}</div>${actions ? `<div class="panel-actions">${actions}</div>` : ""}</div>`;
}
