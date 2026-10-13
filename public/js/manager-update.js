// The manager's own version in the status bar, and the update dialog: a newer VERSION on GitHub shows
// "Update" there; a git clone updates with one click and restarts in the same tab.

import { $, api, esc, icon, ICONS, toast } from "./core.js";
import { renderStatusbar } from "./device.js";

const POLL = 30 * 60 * 1000;
const M = { data: null, working: false, restarting: "", error: "" };

export const managerInfo = () => M.data;

/** The status bar entry: the version, or what to do about a newer one. */
export function versionItem() {
  const d = M.data;
  if (!d) return "";
  if (M.restarting) return `<span class="sb-item sb-ver new">${ICONS.spin}<span>Restarting</span></span>`;
  if (d.pulled) return `<button type="button" class="sb-item sb-ver new" data-mgr title="Version ${esc(d.pulled)} is downloaded; restart the manager to use it">${icon("refresh")}<span>Restart for ${esc(d.pulled)}</span></button>`;
  if (d.newer) return `<button type="button" class="sb-item sb-ver new" data-mgr title="Version ${esc(d.latest)} is available; you have ${esc(d.version)}">${icon("download")}<span>Update ${esc(d.latest)}</span></button>`;
  return `<button type="button" class="sb-item sb-ver" data-mgr title="muOS Anbernic Manager ${esc(d.version)}">v${esc(d.version)}</button>`;
}

export async function checkManager(refresh = false) {
  try {
    M.data = await api(`manager${refresh ? "?refresh=1" : ""}`);
  } catch {
    return;
  }
  renderStatusbar();
  if ($("mgr").open) render();
}

export function startManagerChecks() {
  checkManager();
  setInterval(() => { if (!M.restarting) checkManager(); }, POLL);
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-mgr]")) openManager();
    const act = e.target.closest("[data-mgr-act]")?.dataset.mgrAct;
    if (act === "close") $("mgr").close();
    else if (act === "check") check();
    else if (act === "update") update();
  });
}

function openManager() {
  M.error = "";
  render();
  if (!$("mgr").open) $("mgr").showModal();
  if (!M.data || Date.now() - M.data.checked > 10 * 60 * 1000) check();
}

async function check() {
  M.working = true;
  render();
  await checkManager(true);
  M.working = false;
  render();
}

const ago = (t) => {
  const min = Math.round((Date.now() - t) / 60000);
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
};

/** What to do by hand when Update now cannot run here. */
function howTo(d) {
  const i = d.install, cmd = (c) => `<code class="mgr-cmd">${esc(c)}</code>`;
  if (i.method === "git" && i.changed.length) {
    return `<p>${esc(i.blocker)}</p>
      <ul class="mgr-files">${i.changed.slice(0, 8).map((f) => `<li><code>${esc(f)}</code></li>`).join("")}</ul>
      <p>Keep them with <code>git stash</code> or undo them with <code>git checkout .</code>, then update again, or pull yourself:</p>${cmd(`git -C "${d.dir}" pull`)}`;
  }
  if (i.method === "git" && i.branch && i.branch !== "main") return `<p>${esc(i.blocker)} Switch back with</p>${cmd(`git -C "${d.dir}" switch main`)}`;
  if (i.method === "git") return `<p>${esc(i.blocker)}</p>${cmd(`git -C "${d.dir}" pull`)}`;
  return `<p>${esc(i.blocker)} Download the new version from GitHub and replace the files in the manager folder, keeping <code>.cache</code> (your settings and logins).</p>`;
}

const METHOD = {
  git: "This copy was installed with <code>git clone</code>; <b>Update now</b> runs <code>git pull</code> on the main branch.",
  zip: "This copy was downloaded; <b>Update now</b> downloads the new version from GitHub and replaces the manager's program files. The replaced files are kept in <code>.update-old</code> until the next update.",
};

function render() {
  const d = M.data, body = $("mgr-body"), foot = $("mgr-foot");
  if (!d) {
    body.innerHTML = `<p class="muted-note">${ICONS.spin} Reading the version...</p>`;
    foot.innerHTML = `<span class="grow"></span><button class="btn" data-mgr-act="close">Close</button>`;
    return;
  }
  const inst = d.install, canUpdate = !inst.blocker;
  let head, text = "";
  if (M.restarting) {
    head = `${ICONS.spin}<span>Starting version ${esc(M.restarting)}...</span>`;
    text = `<p>The page reloads by itself once the new version is running.</p>`;
  } else if (d.pulled) {
    head = `${icon("check")}<span>Version ${esc(d.pulled)} is downloaded</span>`;
    text = `<p>Stop the manager with <b>Ctrl-C</b> in its terminal window and start it again with <code>./muos-anbernic-manager/run.sh</code>
      to use it. Without run.sh (on Windows), run <code>npm ci</code> in the manager folder first, then <code>node src/main.ts</code>.</p>`;
  } else if (d.newer) {
    head = `${icon("download")}<span>Version ${esc(d.latest)} is available</span>`;
    text = canUpdate
      ? `<p>${METHOD[inst.method]} ${d.canRestart ? "The manager then restarts in this tab." : "Restart the manager afterwards."} Your games, settings and logins stay as they are.</p>`
      : howTo(d);
  } else if (!d.enabled) {
    head = `${icon("info")}<span>Update checks are off</span>`;
    text = `<p>Turn on <b>Check for manager updates</b> in Settings, or press <b>Check now</b>.</p>`;
  } else if (d.error && !d.latest) {
    head = `${icon("alert")}<span>Could not check for updates</span>`;
    text = `<p>${esc(d.error)}.</p>`;
  } else {
    head = `${icon("check")}<span>You have the latest version</span>`;
  }
  const facts = [
    `<li><span>Installed</span><b>${esc(d.version)}</b> <small>${inst.method === "git" ? `git clone${inst.branch ? ` &middot; ${esc(inst.branch)} ${esc(inst.commit)}` : ""}` : "downloaded files"}</small></li>`,
    d.latest ? `<li><span>On GitHub</span><b>${esc(d.latest)}</b>${d.checked ? ` <small>checked ${ago(d.checked)}</small>` : ""}</li>` : "",
    `<li><span>Folder</span><code>${esc(d.dir)}</code></li>`,
  ].join("");
  body.innerHTML = `<div class="mgr-state${d.newer || d.pulled ? " new" : ""}">${head}</div>${text}
    ${M.error ? `<p class="mgr-err">${icon("alert")}<span>${esc(M.error)}</span></p>` : ""}
    <ul class="mgr-facts">${facts}</ul>`;
  const busy = M.working || !!M.restarting;
  foot.innerHTML = `${d.home ? `<a class="btn ghost" href="${esc(d.home)}/blob/main/CHANGELOG.md" target="_blank" rel="noopener">${icon("external")}<span>What's new</span></a>` : ""}
    <span class="grow"></span>
    <button class="btn" data-mgr-act="check"${busy ? " disabled" : ""}>${M.working ? ICONS.spin : icon("refresh")}<span>Check now</span></button>
    ${d.newer && canUpdate ? `<button class="btn primary" data-mgr-act="update"${busy ? " disabled" : ""}>${icon("download")}<span>Update now</span></button>` : `<button class="btn" data-mgr-act="close">Close</button>`}`;
}

async function update() {
  M.working = true;
  M.error = "";
  render();
  let res;
  try {
    res = await api("manager/update", {});
  } catch (error) {
    M.error = error.message;
    M.working = false;
    render();
    return;
  }
  M.working = false;
  M.data = res;
  if (!res.updated) toast("Already up to date");
  if (res.restart) {
    M.restarting = res.pulled || res.version;
    renderStatusbar();
    render();
    waitForRestart(res.started);
    return;
  }
  renderStatusbar();
  render();
}

/** Polls until the restarted manager answers, then reloads the page. */
async function waitForRestart(started) {
  const until = Date.now() + 3 * 60 * 1000;
  await new Promise((r) => setTimeout(r, 1500));
  while (Date.now() < until) {
    try {
      const d = await api("manager");
      if (d.started !== started) { location.reload(); return; }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  M.restarting = "";
  M.error = "The manager did not come back. Start it again with ./muos-anbernic-manager/run.sh.";
  renderStatusbar();
  render();
}
