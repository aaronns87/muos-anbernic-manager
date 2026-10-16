// Shows CHANGELOG notes once after the manager version goes up (see `.cache/seen-version`).

import { $, api, esc, icon } from "./core.js";

let bound = false;

/** Light Markdown for changelog bullets (already HTML-escaped). */
function mdLine(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function render(data) {
  const body = $("whats-body");
  const sub = $("whats-sub");
  if (!body || !data) return;
  const from = data.from ? `from ${esc(data.from)} to ` : "";
  if (sub) sub.innerHTML = `You updated ${from}<b>${esc(data.version)}</b>. Here is what changed.`;
  body.innerHTML = data.releases.map((r) => {
    const date = r.date ? `<time>${esc(r.date)}</time>` : "";
    const blocks = r.sections.map((sec) => `
      <h3>${esc(sec.title)}</h3>
      <ul>${sec.items.map((item) => `<li>${mdLine(item)}</li>`).join("")}</ul>`).join("");
    return `<article class="whats-rel">
      <header><b>Version ${esc(r.version)}</b>${date}</header>
      ${blocks}
    </article>`;
  }).join("") || `<p class="muted-note">No changelog entries for this update.</p>`;
}

async function dismiss() {
  try { await api("whats-new/dismiss", {}); } catch {}
  $("whats-new")?.close();
}

export function openWhatsNew(data) {
  if (!data?.show || !data.releases?.length) return;
  render(data);
  const dlg = $("whats-new");
  if (dlg && !dlg.open) dlg.showModal();
}

/** After startup (and after the setup wizard closes), show notes if VERSION is newer than last seen. */
export async function checkWhatsNew() {
  if ($("wizard")?.open || $("whats-new")?.open) return;
  try {
    const data = await api("whats-new");
    openWhatsNew(data);
  } catch {}
}

export function bindWhatsNew() {
  if (bound) return;
  bound = true;
  const dlg = $("whats-new");
  if (!dlg) return;
  dlg.addEventListener("click", (e) => {
    if (e.target.closest("[data-whats]")) dismiss();
  });
  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    dismiss();
  });
}
