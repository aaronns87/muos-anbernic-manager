// "Update handheld" pipeline: scrape → sync artwork → copy missing games.

import { $, app, icon, EXCLUDED, isOnCard, ready, toast } from "./core.js";
import { confirmBox } from "./art-images.js";
import { isLive, connection } from "./device.js";
import { openArtSync } from "./artwork.js";
import { startPlan } from "./copy.js";
import { showArtTab } from "./artwork-view.js";

function missingTargets() {
  if (!app.data?.systems) return [];
  const keys = [];
  for (const sys of app.data.systems) {
    if (EXCLUDED.has(sys.code)) continue;
    for (const g of sys.games || []) {
      if (!isOnCard(sys, g)) keys.push(`${sys.code}/${g.f}`);
    }
  }
  return keys;
}

function missingArtCount() {
  if (!app.data) return 0;
  const all = app.all || app.data.systems.flatMap((s) => s.games);
  return all.filter((g) => !g.i).length;
}

/** Overview / Games: plan dialog then kick off each chosen step. */
export async function runUpdateHandheld() {
  const conn = connection();
  if (!isLive(conn) || !ready()) {
    toast("Connect the handheld or insert a games card first", 3500);
    return;
  }
  const missing = missingTargets();
  const noArt = missingArtCount();
  const ok = await confirmBox({
    title: "Update handheld",
    html: `<p>Bring this computer's library and the handheld closer together. Transfers shows copy progress.</p>
      <label class="check"><input type="checkbox" name="upd-scrape"${noArt ? " checked" : ""}>
        <span><b>Open Scrape for missing artwork</b><br><small>${noArt ? `${noArt.toLocaleString()} games without box art` : "Nothing missing"} — review and run scrape yourself.</small></span></label>
      <label class="check"><input type="checkbox" name="upd-sync" checked>
        <span><b>Sync artwork to the handheld</b><br><small>Send Roms/ Imgs into the catalogue for games on the device.</small></span></label>
      <label class="check"><input type="checkbox" name="upd-copy"${missing.length ? " checked" : ""}>
        <span><b>Copy games missing on the handheld</b><br><small>${missing.length ? `${missing.length.toLocaleString()} not transferred yet` : "Library already matches"}.</small></span></label>`,
    ok: "Start",
  });
  if (!ok) return;
  // confirm body stays in the dialog after close — read options there
  const root = $("c-body") || document;
  const scrape = !!root.querySelector('[name="upd-scrape"]')?.checked;
  const syncArt = !!root.querySelector('[name="upd-sync"]')?.checked;
  const copyGames = !!root.querySelector('[name="upd-copy"]')?.checked;
  if (!scrape && !syncArt && !copyGames) {
    toast("Pick at least one step", 2500);
    return;
  }
  if (scrape) {
    location.hash = "#artwork/scrape";
    showArtTab("scrape");
    toast("Scrape missing art, then use Update handheld again for sync and copy", 4500);
    return;
  }
  if (syncArt) openArtSync("send");
  if (copyGames && missing.length) {
    const startCopy = () => startPlan(missing, `${missing.length.toLocaleString()} games missing on the handheld`);
    if (syncArt) setTimeout(startCopy, 600);
    else startCopy();
  } else if (!syncArt && !copyGames) {
    /* scrape-only already returned */
  } else if (!missing.length && copyGames && !syncArt) {
    toast("Nothing to copy", 2500);
  }
}

export function updateHandheldButton() {
  return `<button type="button" class="btn primary" data-uptodate>${icon("sync")}<span>Update handheld&hellip;</span></button>`;
}

let bound = false;
export function bindUpToDate() {
  if (bound) return;
  bound = true;
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-uptodate]")) runUpdateHandheld();
  });
}
