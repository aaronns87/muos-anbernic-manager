// HTTP server: the app from public/, Roms/ artwork, and the JSON API. Binds to 127.0.0.1 only;
// API calls need the per-run token, which the app gets from the URL it is opened with.

import crypto from "node:crypto";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { activityJson } from "./activity.ts";
import { marketDownload, marketImage, marketJson } from "./app-market.ts";
import { filesCopy, filesDelete, filesList, filesMkdir, filesRead, filesRename, filesRoots, filesWrite } from "./files.ts";
import { addToCollection, collectionsJson, createCollection, deleteCollection, playJson, removeFromCollection, renameCollection, resetPlay } from "./play.ts";
import { retroarchJson, saveRetroarch } from "./retroarch.ts";
import { cheatFile, cheatsGame, removeCheats, saveCheats } from "./tuning/cheats.ts";
import { gameTuning, resetTuning, saveTuning, tuningJson } from "./tuning/tuning.ts";
import { applyTheme, deleteTheme, deviceThemePreview, installTheme, themePreview, themesJson } from "./themes.ts";
import {
  convertFont, createTheme, designerFile, designerJson, designerTheme, duplicateTheme, importTheme, installDesigned, packageTheme,
  removeAsset, renameTheme, revealTheme, saveMeta, saveScheme, setResolution, trashDesignedTheme, uploadAsset, variantAction,
} from "./theme-designer.ts";
import { installPort, portShot, portTask, portsJson, uninstallPort, uploadPortFile } from "./ports.ts";
import { deleteGameArt, deviceImage, getGameArt, getPlan, keepArtOnCard, sendGameArt, sendPlan, startArtJob } from "./artwork.ts";
import { deleteDeviceArt, deleteLocalArt, deviceArtAudit, localArtwork, localArtworkSystem, putLocalArt } from "./artwork-tools.ts";
import { USB_ID } from "./catalogue.ts";
import { ctx } from "./context.ts";
import { deviceIndex, deviceInfo, deviceListing, deviceSummary } from "./device/content.ts";
import { allowUsb, disconnect, MtpError, releaseUsb, restartUsb } from "./device/mtp.ts";
import { closeSftp, findHandhelds, saveWifiSettings, wifiStatus } from "./device/sftp.ts";
import { attachTerminal, deviceStats, forgetHostKey, power, saveSshSettings, SshError, sshStatus } from "./device/ssh.ts";
import { handheldSettings, saveHandheldSettings, undoHandheldSettings } from "./device/muos-settings.ts";
import { cardFor, findCards, handheldStatus, withTarget } from "./device/target.ts";
import { cardHint, usbModel, wifiModel } from "./device/model.ts";
import { deviceFor } from "../public/js/devices.js";
import { UserError } from "./errors.ts";
import { deleteGame } from "./games/actions.ts";
import { detectGames, saveDescription, searchDescriptions, uploadGame } from "./games/add.ts";
import { gameDetails, revealGame } from "./games/details.ts";
import { freeGamesJson, installFreeGame } from "./games/free-scummvm.ts";
import { checksJson, startVerify, trashGames } from "./checks.ts";
import { libraryJson, rescanLibrary } from "./games/library.ts";
import { cancelJob, forgetJob, jobFiles, jobList, jobRunning, locks, makePlan, planSummary, requireIdle, requireQueueable, startCopy } from "./jobs.ts";
import { ejectCard, listCards } from "./system/cards.ts";
import { hashFromFile, inspectImage, workspaceImages } from "./system/image.ts";
import { cancelSystemJob, dismissSystemJob, startSystemJob, systemJob, tf2Systems, TF2_TOP, wifiTf2Status } from "./system/ops.ts";
import { say } from "./log.ts";
import { platform } from "./platform/index.ts";
import { workspaceInfo } from "./workspace.ts";
import { acceptWebSocket } from "./ws.ts";
import { scrapeGame, scrapeImage, scrapePlan } from "./scrape.ts";
import { downloadUpdate, updatesJson } from "./updates.ts";
import { coresJson, folderGames, resetGameCore, setFolderCore, setGameCore } from "./cores.ts";
import { biosJson, sendBios, uploadBios } from "./bios.ts";
import { backupContents, backupSaves, restoreSaves, savesJson, trashBackup } from "./saves.ts";
import { appsDevice, appsJson, deleteDeviceApp, installStatus, uninstallDeviceApp, sendApps, startInstall, trashApp, uploadApp } from "./apps.ts";
import { browseFolders, clearCache, createWorkspace, factoryReset, pickFolder, refreshData, revealFolder, saveSettings, settingsJson } from "./settings.ts";
import { createShortcut } from "./shortcut.ts";
import { managerStatus, restartManager, startedAt, updateManager } from "./manager-update.ts";
import type { Duplex } from "node:stream";

type Body = Record<string, unknown>;
type Reply = unknown | { raw: string } | { image: Buffer; name: string } | { download: Buffer; name: string };
type Handler = (query: URLSearchParams, body: Body, req: http.IncomingMessage) => Promise<Reply> | Reply;

const volumeOf = (query: URLSearchParams) => query.get("volume") ?? "";

const routes: Record<string, Handler> = {
  "GET /api/status": async () => {
    const [{ cards, rejects }, handheld, wifi] = await Promise.all([findCards(), handheldStatus(), wifiStatus()]);
    const [hints, wifiModelFound] = await Promise.all([Promise.all(cards.map((c) => cardHint(c.mount))), wifiModel(wifi.reachable)]);
    const models = { usb: handheld ? usbModel(handheld.name) : null, wifi: wifiModelFound };
    return { cards: cards.map((c, i) => ({ ...c, hint: deviceFor(hints[i])?.id ?? "" })), rejects, handheld, wifi, models, platform: process.platform };
  },
  "POST /api/device/wifi": async (_, body) => {
    requireIdle("Wait for the current job to finish first.");
    const s = await saveWifiSettings(body);
    return { host: s.host, port: s.port, user: s.user };
  },
  "POST /api/device/wifi/find": async () => ({ found: await findHandhelds() }),
  "GET /api/workspace": () => workspaceInfo(),
  "GET /api/activity": (q) => activityJson(q),
  "GET /api/files/roots": (q) => filesRoots(q),
  "GET /api/files/list": (q) => filesList(q),
  "GET /api/files/read": (q) => filesRead(q),
  "POST /api/files/mkdir": (_, body) => filesMkdir(body),
  "POST /api/files/rename": (_, body) => filesRename(body),
  "POST /api/files/delete": (_, body) => filesDelete(body),
  "POST /api/files/write": (_, body) => filesWrite(body),
  "POST /api/files/copy": (_, body) => filesCopy(body),
  "GET /api/play": (q) => playJson(q),
  "POST /api/play/reset": (_, body) => resetPlay(body),
  "GET /api/collections": (q) => collectionsJson(q),
  "POST /api/collections/create": (_, body) => createCollection(body),
  "POST /api/collections/rename": (_, body) => renameCollection(body),
  "POST /api/collections/delete": (_, body) => deleteCollection(body),
  "POST /api/collections/add": (_, body) => addToCollection(body),
  "POST /api/collections/remove": (_, body) => removeFromCollection(body),
  "GET /api/retroarch": () => retroarchJson(),
  "POST /api/retroarch/save": (_, body) => saveRetroarch(body),
  "GET /api/tuning": () => tuningJson(),
  "GET /api/tuning/game": (q) => gameTuning(q),
  "POST /api/tuning/save": (_, body) => saveTuning(body),
  "POST /api/tuning/reset": (_, body) => resetTuning(body),
  "GET /api/cheats/game": (q) => cheatsGame(q),
  "GET /api/cheats/file": (q) => cheatFile(q),
  "POST /api/cheats/save": (_, body) => saveCheats(body),
  "POST /api/cheats/remove": (_, body) => removeCheats(body),
  "GET /api/themes": (q) => themesJson(q),
  "GET /api/themes/preview": (q) => themePreview(q),
  "GET /api/themes/device-preview": (q) => deviceThemePreview(q),
  "POST /api/themes/install": (_, body) => installTheme(body),
  "POST /api/themes/apply": (_, body) => applyTheme(body),
  "POST /api/themes/delete": (_, body) => deleteTheme(body),
  "GET /api/designer": () => designerJson(),
  "GET /api/designer/theme": (q) => designerTheme(q),
  "GET /api/designer/file": (q) => designerFile(q),
  "GET /api/designer/package": (q) => packageTheme(q),
  "POST /api/designer/create": (_, body) => createTheme(body),
  "PUT /api/designer/import": (query, _, req) => importTheme(req, query),
  "POST /api/designer/scheme": (_, body) => saveScheme(body),
  "POST /api/designer/meta": (_, body) => saveMeta(body),
  "POST /api/designer/resolution": (_, body) => setResolution(body),
  "POST /api/designer/variant": (_, body) => variantAction(body),
  "PUT /api/designer/upload": (query, _, req) => uploadAsset(req, query),
  "POST /api/designer/remove-file": (_, body) => removeAsset(body),
  "POST /api/designer/font": (_, body) => convertFont(body),
  "POST /api/designer/rename": (_, body) => renameTheme(body),
  "POST /api/designer/duplicate": (_, body) => duplicateTheme(body),
  "POST /api/designer/delete": (_, body) => trashDesignedTheme(body),
  "POST /api/designer/reveal": (_, body) => revealTheme(body),
  "POST /api/designer/install": (_, body) => installDesigned(body),
  "GET /api/ports": (q) => portsJson(q),
  "GET /api/ports/task": () => portTask(),
  "GET /api/ports/shot": (q) => portShot(q),
  "GET /api/market": (q) => marketJson(q),
  "GET /api/market/image": (q) => marketImage(q),
  "POST /api/market/download": (_, body) => marketDownload(body),
  "POST /api/ports/install": (_, body) => installPort(body),
  "POST /api/ports/uninstall": (_, body) => uninstallPort(body),
  "PUT /api/ports/upload": (query, _, req) => uploadPortFile(req, query),
  "GET /api/games": async () => ({ raw: await libraryJson() }),
  "GET /api/game": (q) => gameDetails(q),
  "POST /api/game/reveal": (_, body) => revealGame(body),
  "POST /api/games/rescan": async () => {
    requireIdle("Wait for the current job to finish first.");
    const library = await rescanLibrary();
    return { games: library.totals.games, sig: library.sig };
  },
  "GET /api/job": () => jobList(),
  "GET /api/job/files": (q) => jobFiles(Number(q.get("id"))),
  "POST /api/job/cancel": (_, body) => {
    cancelJob(body.id === undefined ? undefined : Number(body.id));
    return jobList();
  },
  "POST /api/job/forget": (_, body) => {
    forgetJob(body.id === undefined ? undefined : Number(body.id));
    return jobList();
  },

  "GET /api/device/index": (q) => withTarget(volumeOf(q), async (t) => ({ card: t.info, files: await deviceIndex(t) })),
  "GET /api/device/games": (q) => {
    requireIdle();
    return withTarget(volumeOf(q), deviceListing);
  },
  "GET /api/device/info": (q) => {
    if (volumeOf(q) === USB_ID) requireIdle("Busy with a transfer. Device details come back when it finishes.");
    return withTarget(volumeOf(q), deviceInfo);
  },
  "GET /api/device/summary": (q) => {
    if (volumeOf(q) === USB_ID) requireIdle("Busy with a transfer. Counts come back when it finishes.");
    return withTarget(volumeOf(q), deviceSummary);
  },
  "GET /api/device/image": async (q) => {
    const { data, name } = await deviceImage(q);
    return { image: data, name };
  },
  "POST /api/device/reconnect": async () => {
    if (!jobRunning()) await Promise.all([disconnect(), closeSftp()]);
    return { ok: true };
  },
  "POST /api/device/disconnect": async () => {
    requireIdle("Wait for the transfer to finish before disconnecting.");
    await releaseUsb();
    say("green", "USB", "Let go of the handheld. Other apps can use it now.");
    return { ok: true };
  },
  "POST /api/device/usb-restart": async () => {
    requireIdle("Wait for the transfer to finish first.");
    await restartUsb();
    return { ok: true };
  },
  "POST /api/device/connect": () => {
    allowUsb();
    return { ok: true };
  },
  "GET /api/settings": () => settingsJson(),
  "GET /api/manager": (q) => managerStatus(q.get("refresh") === "1"),
  "POST /api/manager/update": () => updateManager(),
  "POST /api/settings": (_, body) => saveSettings(body),
  "GET /api/settings/folders": (q) => browseFolders(q),
  "POST /api/settings/pick-folder": (_, body) => pickFolder(body),
  "POST /api/settings/reveal": (_, body) => revealFolder(body),
  "POST /api/settings/refresh": (_, body) => refreshData(body),
  "POST /api/settings/clear-cache": (_, body) => clearCache(body),
  "POST /api/settings/factory-reset": async (_, body) => {
    const result = await factoryReset(body);
    const restart = restartManager();
    if (!restart) setTimeout(() => shutdownHook(), 400);
    return { ...result, restart, started: startedAt() };
  },
  "POST /api/settings/shortcut": async () => {
    const made = await createShortcut();
    say("green", "SHORTCUT", `Added the manager to ${made.place}: ${made.path}`);
    return settingsJson();
  },
  "POST /api/settings/workspace": async () => {
    const created = await createWorkspace();
    if (created.length) await rescanLibrary();
    return { created, ...(await settingsJson()) };
  },
  "POST /api/shutdown": () => {
    requireIdle("A copy is running in the manager that is already open. Let it finish or cancel it first.");
    setImmediate(() => shutdownHook());
    return { ok: true };
  },
  "POST /api/device/eject": async (_, body) => {
    requireIdle("Wait for the copy to finish before ejecting.");
    const card = await cardFor(String(body.volume ?? ""));
    if (!card.disk) throw new UserError("A test folder cannot be ejected.");
    await platform.eject(card);
    say("green", "EJECTED", "TF2 can be removed.");
    return { ok: true };
  },

  "POST /api/games/plan": (_, body) => {
    requireQueueable(String(body.volume ?? ""));
    return withTarget(String(body.volume ?? ""), async (t) => planSummary(t.info, await makePlan(t, (body.targets as unknown[]) || [""])));
  },
  "POST /api/games/copy": async (_, body) => ({ job: await startCopy(body) }),
  "POST /api/games/delete": (_, body) => deleteGame(body),
  "GET /api/checks": (query) => checksJson(query),
  "POST /api/checks/verify": (_, body) => startVerify(body),
  "POST /api/checks/trash": (_, body) => trashGames(body),
  "POST /api/games/add/detect": (_, body) => detectGames(body),
  "POST /api/games/add/describe": (_, body) => searchDescriptions(body),
  "POST /api/games/add/artwork": (_, body) => scrapeGame(body),
  "POST /api/games/description": (_, body) => saveDescription(body),
  "PUT /api/games/upload": (query, _, req) => uploadGame(req, query),
  "GET /api/scummvm/free": () => freeGamesJson(),
  "POST /api/scummvm/free/install": (_, body) => installFreeGame(body),

  "GET /api/apps": () => appsJson(),
  "PUT /api/apps/upload": (query, _, req) => uploadApp(req, query),
  "POST /api/apps/trash": (_, body) => trashApp(body),
  "POST /api/apps/send": async (_, body) => ({ job: await sendApps(body) }),
  "GET /api/apps/device": () => appsDevice(),
  "POST /api/apps/device/delete": (_, body) => deleteDeviceApp(body),
  "POST /api/apps/device/uninstall": (_, body) => uninstallDeviceApp(body),
  "GET /api/saves": () => savesJson(),
  "POST /api/saves/backup": () => backupSaves(),
  "GET /api/saves/backup": (query) => backupContents(query),
  "POST /api/saves/restore": (_, body) => restoreSaves(body),
  "POST /api/saves/trash": (_, body) => trashBackup(body),
  "GET /api/bios": (query) => biosJson(query),
  "POST /api/bios/send": (_, body) => sendBios(body),
  "PUT /api/bios/upload": (query, _, req) => uploadBios(req, query),
  "GET /api/cores": () => coresJson(),
  "GET /api/cores/games": (query) => folderGames(query),
  "POST /api/cores/folder": (_, body) => setFolderCore(body),
  "POST /api/cores/game": (_, body) => setGameCore(body),
  "POST /api/cores/game/reset": (_, body) => resetGameCore(body),
  "GET /api/updates": (query) => updatesJson(query),
  "POST /api/updates/download": (_, body) => downloadUpdate(body),
  "POST /api/apps/install": (_, body) => startInstall(body),
  "GET /api/apps/install": () => installStatus(),
  "POST /api/games/artwork/send": (_, body) => sendGameArt(body),
  "POST /api/games/artwork/get": (_, body) => getGameArt(body),
  "POST /api/games/artwork/delete": (_, body) => deleteGameArt(body),

  "POST /api/artwork/get-plan": (_, body) => getPlan(body),
  "POST /api/artwork/send-plan": (_, body) => sendPlan(body),
  "POST /api/artwork/start": async (_, body) => ({ job: await startArtJob(body) }),
  "POST /api/artwork/keep-on-card": (_, body) => keepArtOnCard(body),
  "GET /api/artwork/local": (q) => localArtwork(q),
  "GET /api/artwork/local/system": (q) => localArtworkSystem(q),
  "POST /api/artwork/local/put": (_, body) => putLocalArt(body),
  "POST /api/artwork/local/delete": (_, body) => deleteLocalArt(body),
  "POST /api/artwork/device/audit": (_, body) => deviceArtAudit(body),
  "POST /api/artwork/device/delete": (_, body) => deleteDeviceArt(body),
  "POST /api/scrape/plan": (_, body) => scrapePlan(body),
  "GET /api/scrape/image": (q) => scrapeImage(q),

  "GET /api/system/cards": async () => ({
    cards: await listCards(), job: systemJob(), busy: locks.system, platform: process.platform,
    wifiTf2: await wifiTf2Status().catch((error) => ({ ready: false, reason: (error as Error).message, host: "", size: 0, part: "", disk: "", mount: "", label: "" })),
  }),
  "GET /api/system/images": async () => ({ images: await workspaceImages(), tf2: { top: TF2_TOP, systems: tf2Systems() } }),
  "POST /api/system/inspect": (_, body) => inspectImage(String(body.path ?? "")),
  "POST /api/system/hash-file": (_, body) => hashFromFile(String(body.path ?? ""), String(body.image ?? "")),
  "POST /api/system/pick": async (_, body) => {
    if (!platform.pickFile) throw new UserError("This system has no file picker; type the path instead.");
    const hash = body.kind === "hash";
    const start = typeof body.start === "string" && body.start ? path.dirname(body.start) : ctx.os;
    return { path: await platform.pickFile(hash ? "Choose the SHA256 file (hash.txt, .sha256)" : "Choose a MustardOS image (.img or .img.gz)", start, hash ? ["txt", "sha256", "sha256sum"] : ["img", "gz"]) };
  },
  "POST /api/system/start": (_, body) => startSystemJob(body),
  "GET /api/system/job": () => ({ job: systemJob() }),
  "POST /api/system/cancel": () => {
    cancelSystemJob();
    return { ok: true };
  },
  "POST /api/system/dismiss": () => {
    dismissSystemJob();
    return { ok: true };
  },
  "POST /api/system/eject": async (_, body) => {
    requireIdle();
    await ejectCard(String(body.disk ?? ""));
    say("green", "EJECTED", `${body.disk} can be removed.`);
    return { ok: true };
  },

  "GET /api/ssh/status": () => sshStatus(),
  "POST /api/ssh/settings": async (_, body) => {
    await saveSshSettings(body);
    return sshStatus();
  },
  "POST /api/ssh/forget-key": async () => {
    await forgetHostKey();
    return sshStatus();
  },
  "GET /api/ssh/stats": () => deviceStats(),
  "GET /api/handheld/settings": () => handheldSettings(),
  "POST /api/handheld/settings": (_, body) => saveHandheldSettings(body),
  "POST /api/handheld/settings/undo": () => undoHandheldSettings(),
  "POST /api/ssh/power": async (_, body) => {
    requireIdle("Wait for the current job to finish first.");
    await power(String(body.action ?? ""));
    say("yellow", "POWER", body.action === "reboot" ? "Rebooting the handheld." : "Shutting down the handheld.");
    return { ok: true };
  },
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".mjs": "text/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".bmp": "image/bmp",
  ".wav": "audio/wav", ".mp4": "video/mp4", ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2",
};

function send(res: http.ServerResponse, status: number, body: string | Buffer, type: string): void {
  res.writeHead(status, {
    "Content-Type": type, "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

const sendJson = (res: http.ServerResponse, status: number, payload: unknown) => send(res, status, JSON.stringify(payload), MIME[".json"]);

async function serveFile(res: http.ServerResponse, base: string, rel: string): Promise<void> {
  const parts = rel.split("/").filter(Boolean);
  if (parts.some((p) => p.startsWith(".") || p.includes("\\"))) return send(res, 404, "Not found", "text/plain");
  const file = path.join(base, ...parts);
  try {
    const st = await fsp.stat(file);
    if (!st.isFile()) throw new Error("not a file");
    send(res, 200, await fsp.readFile(file), MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain");
  }
}

async function readBody(req: http.IncomingMessage): Promise<Body> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 40 * 1024 * 1024) throw new UserError("Request too large.");
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new UserError("Invalid JSON.");
  }
}

function tokenOk(given: string): boolean {
  const a = Buffer.from(given), b = Buffer.from(ctx.token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const route = `${req.method} ${url.pathname}`;
  let token = String(req.headers["x-manager-token"] ?? "");
  if (!token && (route === "GET /api/device/image" || route === "GET /api/scrape/image" || route === "GET /api/files/read" || route === "GET /api/themes/preview" || route === "GET /api/themes/device-preview" || route === "GET /api/ports/shot" || route === "GET /api/market/image" || route === "GET /api/designer/file" || route === "GET /api/designer/package")) token = url.searchParams.get("token") ?? "";
  if (!tokenOk(token)) return sendJson(res, 403, { error: "Missing or wrong manager token. Reopen the manager from ./muos-anbernic-manager/run.sh." });
  const handler = routes[route];
  if (!handler) return sendJson(res, 404, { error: "Unknown API call." });
  try {
    let body: Body = {};
    if (req.method === "POST") {
      if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return sendJson(res, 415, { error: "Expected JSON." });
      body = await readBody(req);
    }
    const result = await handler(url.searchParams, body, req);
    if (result && typeof result === "object" && "raw" in result) return send(res, 200, (result as { raw: string }).raw, MIME[".json"]);
    if (result && typeof result === "object" && "image" in result && Buffer.isBuffer(result.image)) {
      const { image, name } = result as { image: Buffer; name: string };
      return send(res, 200, image, MIME[path.extname(name).toLowerCase()] ?? "image/png");
    }
    if (result && typeof result === "object" && "download" in result && Buffer.isBuffer(result.download)) {
      const { download, name } = result as { download: Buffer; name: string };
      res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`);
      return send(res, 200, download, "application/zip");
    }
    sendJson(res, 200, result);
  } catch (error) {
    if (error instanceof SshError) sendJson(res, 400, { error: error.message, code: error.code, fingerprint: error.fingerprint });
    else if (error instanceof UserError || error instanceof MtpError) sendJson(res, 400, { error: error.message });
    else {
      console.error(`${route} failed:`, error);
      sendJson(res, 500, { error: `Server error: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
}

const localHost = (host: string) => host === `127.0.0.1:${ctx.port}` || host === `localhost:${ctx.port}`;

/** WebSocket upgrades: only the SSH terminal, only from this app's own pages. */
function upgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
  socket.on("error", () => socket.destroy());
  const host = req.headers.host ?? "";
  const origin = String(req.headers.origin ?? "");
  const refuse = (status: string) => void socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  if (!localHost(host) || !localHost(origin.replace(/^http:\/\//, ""))) return refuse("403 Forbidden");
  const url = URL.parse(req.url ?? "/", `http://${host}`);
  if (!url) return refuse("400 Bad Request");
  if (!tokenOk(url.searchParams.get("token") ?? "")) return refuse("403 Forbidden");
  if (url.pathname !== "/api/ssh/socket") return refuse("404 Not Found");
  const ws = acceptWebSocket(req, socket, head);
  if (ws) void attachTerminal(ws, url.searchParams).catch(() => ws.close(1011));
}

function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
  const host = req.headers.host ?? "";
  if (!localHost(host)) return send(res, 403, "Forbidden", "text/plain");
  const url = URL.parse(req.url ?? "/", `http://${host}`);
  if (!url) return send(res, 400, "Bad request", "text/plain");
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, "Bad request", "text/plain");
  }
  if (pathname.startsWith("/api/")) {
    void api(req, res, url);
    return;
  }
  if (req.method !== "GET") return send(res, 405, "Method not allowed", "text/plain");
  if (pathname === "/" || pathname === "/index.html") return void serveFile(res, ctx.publicDir, "index.html");
  if (pathname.startsWith("/Roms/")) {
    const rel = pathname.slice("/Roms/".length);
    if (!/^[^/]+\/Imgs\/[^/]+\.(png|jpe?g|gif|webp|bmp)$/i.test(rel)) return send(res, 404, "Not found", "text/plain");
    return void serveFile(res, ctx.roms, rel);
  }
  if (pathname.startsWith("/vendor/xterm/")) return void serveFile(res, path.join(ctx.managerDir, "node_modules", "@xterm"), pathname.slice("/vendor/xterm/".length));
  void serveFile(res, ctx.publicDir, pathname);
}

/** Listens on the first free port from `first`; resolves with the server once it is listening. */
let shutdownHook: () => void = () => {};

/** What POST /api/shutdown runs: a newer manager for the same workspace asks this one to stop. */
export function onShutdown(fn: () => void): void {
  shutdownHook = fn;
}

export async function listen(first: number): Promise<http.Server> {
  for (let port = first; port < first + 20; port++) {
    const server = http.createServer(handle);
    server.on("upgrade", upgrade);
    const ok = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (ok) {
      server.removeAllListeners("error");
      server.on("error", (error) => console.error("Server error:", error));
      ctx.port = port;
      return server;
    }
    server.close();
  }
  throw new UserError(`No free port between ${first} and ${first + 19}.`);
}
