// The device model: the picker under the brand, and the question about a card in a reader, which cannot say which
// handheld it belongs to. Connected handhelds report their model, so the picker only shows it then.

import { $, app, esc, icon, store, toast, DEVICES, model, modelInfo, cardKey, setCardModel } from "./core.js";
import { byId, screenText } from "./devices.js";
import { renderDevice } from "./device.js";

const VIA = { usb: "Detected over USB", wifi: "Detected over Wi-Fi", ssh: "Detected over SSH", card: "Chosen for this card", picked: "Pick your handheld" };
const STICKS = ["no sticks", "one stick", "two sticks"];
const makers = () => [...new Set(DEVICES.map((d) => d.maker))];
const detected = (via) => via === "usb" || via === "wifi" || via === "ssh";
const optSub = (d) => `${screenText(d)} \u00b7 ${STICKS[d.sticks]}${d.wifi ? "" : " \u00b7 no Wi-Fi"}`;

export function renderModelPicker() {
  const box = $("model-pick");
  if (!box) return;
  const { device: m, via } = modelInfo(), open = box.classList.contains("open"), locked = detected(via);
  const option = (d) => `<button class="mp-opt${d.id === m.id ? " on" : ""}" role="option" aria-selected="${d.id === m.id}" data-model="${esc(d.id)}"${locked ? " disabled" : ""}>
      ${icon("handheld")}<span><b>${esc(d.name)}</b><small>${esc(optSub(d))}</small></span>${d.id === m.id ? icon("check", "mp-check") : ""}</button>`;
  box.innerHTML = `<button class="mp-btn" aria-haspopup="listbox" aria-expanded="${open}" title="Device model: ${esc(VIA[via])}">
      <span class="mp-ico">${icon("handheld")}</span>
      <span class="mp-text"><b>${esc(m.name)}</b><small>${esc(m.maker)} &middot; ${esc(VIA[via])}</small></span>
      ${icon("down", "mp-chev")}
    </button>
    <div class="mp-menu" role="listbox" aria-label="Device model">
      ${locked ? `<div class="mp-note">${icon("check")}<span>The handheld reports itself as the <b>${esc(m.name)}</b>.</span></div>` : ""}
      ${makers().map((maker) => `<div class="mp-group">${esc(maker)}</div>${DEVICES.filter((d) => d.maker === maker).map(option).join("")}`).join("")}
      ${via === "card" ? `<div class="mp-soon">Remembered for the card in the reader.</div>` : locked ? "" : `<div class="mp-soon">Connected handhelds are detected over USB and Wi-Fi.</div>`}
    </div>`;
}

export function bindModelPicker() {
  const box = $("model-pick");
  renderModelPicker();
  const close = () => { box.classList.remove("open"); box.querySelector(".mp-btn")?.setAttribute("aria-expanded", "false"); };
  box.addEventListener("click", (e) => {
    const opt = e.target.closest("[data-model]");
    if (opt) {
      const t = app.device.target;
      if (t && t.mode === "card") setCardModel(t, opt.dataset.model);
      else store.set("model", opt.dataset.model);
      close();
      renderDevice();
      return;
    }
    if (e.target.closest(".mp-btn")) {
      box.classList.toggle("open");
      box.querySelector(".mp-btn").setAttribute("aria-expanded", String(box.classList.contains("open")));
    }
  });
  document.addEventListener("click", (e) => { if (!box.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

// ---------------------------------------------------------------- the card question

const asked = new Set();
const ask = { card: null, pick: "" };

/** A card in the reader with no model yet: SD1's play records name it, else ask once per card and session. */
export function checkCardModel() {
  const t = app.device.target;
  if (!t || t.mode !== "card" || app.ui.mode !== "card") return;
  const key = cardKey(t);
  if (store.get("cardModels", {})[key] || asked.has(key)) return;
  if (byId(t.hint)) {
    setCardModel(t, t.hint);
    toast(`This card was last used in the ${byId(t.hint).name}`, 3500);
    return;
  }
  if (document.querySelector("dialog[open]")) return;
  asked.add(key);
  const m = app.device.models || {};
  showAsk(t, byId(m.usb?.id)?.id || byId(m.wifi?.id)?.id || model().id);
}

/** Asks again which handheld the card in the reader is from. */
export function openCardModel() {
  const t = app.device.target;
  if (t && t.mode === "card") showAsk(t, model().id);
}

function showAsk(card, pick) {
  Object.assign(ask, { card, pick });
  renderAsk();
  $("model-ask").showModal();
}

function renderAsk() {
  const t = ask.card;
  $("mask-sub").textContent = `${t.name || "The card"} (${t.kind || "card"}) does not say which handheld it is from. The manager remembers your answer for this card.`;
  $("mask-body").innerHTML = modelGrid(ask.pick, "data-mask-pick");
}

/** Every model as a tile, grouped by maker; attr names the data attribute holding the id. */
export function modelGrid(pick, attr) {
  return makers().map((maker) => `<h3 class="sub-head">${esc(maker)}</h3><div class="mask-grid">${DEVICES.filter((d) => d.maker === maker).map((d) =>
    `<button type="button" class="mask-opt${d.id === pick ? " on" : ""}" ${attr}="${esc(d.id)}" aria-pressed="${d.id === pick}">
      ${icon("handheld")}<span><b>${esc(d.name)}</b><small>${esc(optSub(d))}</small></span></button>`).join("")}</div>`).join("");
}

$("model-ask")?.addEventListener("click", (e) => {
  const pick = e.target.closest("[data-mask-pick]");
  if (pick) { ask.pick = pick.dataset.maskPick; renderAsk(); return; }
  const btn = e.target.closest("[data-mask]");
  if (!btn) return;
  if (btn.dataset.mask === "use" && ask.card) {
    setCardModel(ask.card, ask.pick);
    toast(`Using the ${byId(ask.pick).name} for this card`);
  }
  $("model-ask").close();
  renderDevice();
});
$("model-ask")?.addEventListener("dblclick", (e) => { if (e.target.closest("[data-mask-pick]")) document.querySelector('[data-mask="use"]').click(); });
