// Artwork sync between Roms/<system>/Imgs and the MustardOS catalogue on the device.

import { $, app, api, esc, human, store, toast, slowHint, devName, busy, ART_KINDS } from "./core.js";
import { refreshDevice } from "./device.js";
import { jobStarted } from "./copy.js";

let artPlan = null;

export function openArtSync(dir) {
  if (busy()) { toast("Wait for the current job to finish"); return; }
  if (!app.device.target) return;
  artPlan = { dir, kind: store.get("artKind", "box"), data: null, mode: "sync" };
  const name = devName();
  $("a-title").textContent = dir === "send" ? `Send artwork to ${name}` : `Get artwork from ${name}`;
  $("a-scope").textContent = dir === "send"
    ? `Copies the Roms/<system>/Imgs PNGs into the MUOS/info/catalogue on ${name}, for the games that are on it, so MustardOS shows them.`
    : "Copies the images Scrappy saved in MUOS/info/catalogue into Roms/<system>/Imgs, matched by ROM file name.";
  $("artsync").showModal();
  planArt();
}

async function planArt() {
  const request = artPlan;
  const kinds = ART_KINDS.map(([k, label]) => `<button data-kind="${k}" class="${k === request.kind ? "on" : ""}">${label}</button>`).join("");
  const label = request.dir === "send" ? "Save as" : "Artwork type";
  $("a-body").innerHTML = `<div class="kind-pick">${label} <div class="segmented" id="a-kinds">${kinds}</div></div>
    <div id="a-plan"><div class="planning"><span class="spinner"></span> ${request.dir === "send" ? `Comparing with the catalogue on ${esc(devName())}` : "Reading the artwork catalogue"}&hellip;${slowHint()}</div></div>`;
  $("a-start").hidden = true;
  $("a-cancel").textContent = "Cancel";
  try {
    const data = await api(request.dir === "send" ? "artwork/send-plan" : "artwork/get-plan", { volume: app.device.target.id, kind: request.kind });
    if (artPlan !== request) return;
    request.data = data;
    renderArtPlan();
  } catch (error) {
    if (artPlan !== request) return;
    $("a-plan").innerHTML = `<div class="notice err">${esc(error.message)}</div>`;
    $("a-cancel").textContent = "Close";
  }
}

const moreList = (items, count) =>
  `<ul>${items.map((f) => `<li>${esc(f)}</li>`).join("")}${count > items.length ? `<li>&hellip;and ${count - items.length} more</li>` : ""}</ul>`;

function renderArtPlan() {
  const p = artPlan.data;
  const send = artPlan.dir === "send";
  const name = esc(devName());
  const there = send ? `on ${name}` : "in Roms/";
  const names = Object.fromEntries(app.data.systems.map((s) => [s.code, s.name]));
  const kindName = ART_KINDS.find(([k]) => k === p.kind)[1].toLowerCase();
  const parts = [];
  if (send) {
    parts.push(`<div class="sources"><span class="active">Catalogue on ${esc(p.where)}</span></div>`);
  } else {
    parts.push(`<div class="sources">${p.source.sources.map((s) => `<span class="${s.active ? "active" : ""}">${esc(s.name)}${s.active && p.source.sources.length > 1 ? " (in use)" : ""} &middot; ${s.images.toLocaleString()} image${s.images === 1 ? "" : "s"}</span>`).join("")}</div>`);
  }
  if (!p.found) {
    parts.push(send
      ? `<div class="notice">None of the games on ${name} have artwork in Roms/ yet.</div>`
      : `<div class="notice">No ${esc(kindName)} images in the catalogue yet. Scrape games with Scrappy on the handheld first${p.kind === "box" ? "" : ", or pick another artwork type"}.</div>`);
  } else {
    parts.push(`<div class="plan-grid">
      <div class="stat"><b>${p.new.count.toLocaleString()}</b><span>new &middot; ${human(p.new.bytes)}</span></div>
      <div class="stat"><b>${p.identical.toLocaleString()}</b><span>already ${there}</span></div>
      <div class="stat"><b>${p.different.count.toLocaleString()}</b><span>different ${there}</span></div>
    </div>`);
  }
  if (p.different.count) {
    parts.push(`<label class="check"><input type="checkbox" id="a-replace">
      <span>Replace the ${p.different.count === 1 ? "image that differs" : `${p.different.count.toLocaleString()} images that differ`} ${there}<br>
      <small style="color:var(--muted)">${send ? "Permanent: there is no Trash on the device." : "The current images go to the Trash."} Left unticked, they are kept.</small></span></label>
      <details><summary>Show images that differ</summary>${moreList(p.different.files, p.different.count)}</details>`);
  }
  if (p.systems.length > 1) {
    parts.push(`<div class="plan-table"><table><thead><tr><th>System</th><th class="num">New</th><th class="num">Differ</th><th class="num">Same</th></tr></thead><tbody>
      ${p.systems.map((s) => `<tr><td>${esc(names[s.code] || s.code)} <span style="color:var(--muted)">${esc(s.code)}</span></td><td class="num">${s.new || ""}</td><td class="num">${s.different || ""}</td><td class="num">${s.same || ""}</td></tr>`).join("")}
    </tbody></table></div>`);
  }
  if (send && p.missing) {
    parts.push(`<small style="color:var(--muted)">${p.missing.toLocaleString()} file${p.missing === 1 ? "" : "s"} on ${name} ha${p.missing === 1 ? "s" : "ve"} no PNG in Roms/&lt;system&gt;/Imgs.</small>`);
  }
  if (!send && p.unmatched.count) {
    parts.push(`<details><summary>${p.unmatched.count.toLocaleString()} image${p.unmatched.count === 1 ? " has" : "s have"} no matching ROM in Roms/</summary>${moreList(p.unmatched.files, p.unmatched.count)}</details>`);
  }
  if (!send && p.unmapped.length) {
    parts.push(`<small style="color:var(--muted)">Catalogue folders not tied to a ROM folder (matched by unique file name instead): ${p.unmapped.map(esc).join(", ")}</small>`);
  }
  parts.push(`<div id="a-totals"></div>`);
  $("a-plan").innerHTML = parts.join("");
  $("a-replace")?.addEventListener("change", updateArtTotals);
  updateArtTotals();
}

function updateArtTotals() {
  const p = artPlan.data;
  const send = artPlan.dir === "send";
  const count = p.new.count + ($("a-replace")?.checked ? p.different.count : 0);
  const start = $("a-start");
  if (!count) {
    $("a-totals").innerHTML = p.found
      ? (p.different.count ? `<div class="notice">Nothing new. Tick the box above to replace the images that differ.</div>`
        : (p.new.count + p.identical ? `<div class="notice ok">${send ? `${esc(devName())} already has all of this artwork.` : "Roms/ already has all of this artwork."}</div>` : ""))
      : "";
    start.hidden = true;
    $("a-cancel").textContent = "Close";
    return;
  }
  $("a-totals").innerHTML = `<small style="color:var(--muted)">${send ? "MustardOS shows the new artwork right away." : "The library updates when the copy finishes."}</small>`;
  start.hidden = false;
  start.disabled = false;
  start.textContent = `${send ? "Send" : "Copy"} ${count.toLocaleString()} image${count === 1 ? "" : "s"}`;
  $("a-cancel").textContent = "Cancel";
}

export function openKeepOnCard() {
  if (busy()) { toast("Wait for the current job to finish"); return; }
  const c = app.device.target;
  if (!c) return;
  artPlan = { mode: "keep" };
  $("a-title").textContent = "Keep artwork on TF2";
  $("a-scope").textContent = `${c.name || "TF2"} (${c.id})`;
  $("a-body").innerHTML = `<p style="margin:0;font-size:13.5px;line-height:1.55">MustardOS reads its artwork catalogue from TF2 when the card has a <code>MUOS/info/catalogue</code> folder, and from SD1 otherwise.
    This creates that folder on TF2, with box, preview, splash and text folders for your systems. From the next boot, Scrappy saves artwork onto the card, and you can sync it here with the card in the reader.</p>
    <div class="notice">Artwork already saved on SD1 stays there and is no longer shown on the handheld. If Scrappy has already scraped games, sync them over USB or Wi-Fi first.</div>`;
  $("a-start").hidden = false;
  $("a-start").disabled = false;
  $("a-start").textContent = "Create folder";
  $("a-cancel").textContent = "Cancel";
  $("artsync").showModal();
}

async function confirmArt() {
  const start = $("a-start");
  start.disabled = true;
  start.innerHTML = `<span class="spinner"></span> Starting`;
  try {
    if (artPlan.mode === "keep") {
      await api("artwork/keep-on-card", { volume: app.device.target.id });
      $("artsync").close();
      toast("TF2 now holds the artwork catalogue. Restart the handheld to use it.", 4000);
      refreshDevice(true);
      return;
    }
    const result = await api("artwork/start", { plan: artPlan.data.plan, replace: $("a-replace")?.checked || false });
    $("artsync").close();
    jobStarted(result.job);
  } catch (error) {
    ($("a-totals") || $("a-body")).insertAdjacentHTML("beforeend", `<div class="notice err">${esc(error.message)}</div>`);
    start.disabled = false;
    start.textContent = "Try again";
  }
}

export function bindArtwork() {
  $("a-body").addEventListener("click", (e) => {
    const kind = e.target.closest("[data-kind]")?.dataset.kind;
    if (!kind || !artPlan || artPlan.mode !== "sync" || kind === artPlan.kind) return;
    store.set("artKind", kind);
    artPlan = { dir: artPlan.dir, kind, data: null, mode: "sync" };
    planArt();
  });
  $("a-cancel").addEventListener("click", () => $("artsync").close());
  $("artsync").addEventListener("close", () => { artPlan = null; });
  $("a-start").addEventListener("click", confirmArt);
}
