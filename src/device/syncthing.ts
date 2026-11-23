// Syncthing on the handheld: idle probe plus a read-only folder snapshot over SSH → localhost REST.

import { runCommand } from "./ssh.ts";
import { webServicesStatus } from "./web-services.ts";

const POLL_MS = 1200;
const MAX_WAIT_MS = 90_000;

export interface SyncthingFolder {
  id: string;
  label: string;
  path: string;
  paused: boolean;
  state: string;
}

export interface SyncthingSnapshot {
  idle: boolean;
  syncing: boolean;
  detail: string;
  waited: boolean;
  port: number;
  url: string;
  folders: SyncthingFolder[];
  version: string;
}

function parseFolders(raw: string): SyncthingFolder[] {
  // Lightweight parse: Syncthing config JSON — pull id/label/path/paused without full JSON.parse failures on huge configs.
  const folders: SyncthingFolder[] = [];
  const blocks = raw.split(/"folders"\s*:\s*\[/i);
  if (blocks.length < 2) return folders;
  const body = blocks[1];
  const objs = body.match(/\{[^{}]*"id"\s*:\s*"[^"]+"[^{}]*\}/g) || [];
  for (const chunk of objs.slice(0, 40)) {
    const id = /"id"\s*:\s*"([^"]+)"/.exec(chunk)?.[1] || "";
    if (!id) continue;
    const label = /"label"\s*:\s*"([^"]*)"/.exec(chunk)?.[1] || id;
    const path = /"path"\s*:\s*"([^"]*)"/.exec(chunk)?.[1] || "";
    const paused = /"paused"\s*:\s*true/.test(chunk);
    folders.push({ id, label, path, paused, state: paused ? "paused" : "unknown" });
  }
  return folders;
}

/** Polls the handheld Syncthing REST API on localhost; returns idle when unsure. With a folder id, that folder's state is read. */
export async function syncthingIdleJson(folderId = ""): Promise<SyncthingSnapshot> {
  const pack = await webServicesStatus(true);
  const svc = pack.services.find((s) => s.id === "syncthing");
  const port = svc?.port || 7070;
  const url = svc?.url || (pack.host ? `http://${pack.host}:${port}/` : "");
  const empty = (detail: string, idle = true): SyncthingSnapshot => ({
    idle, syncing: !idle, detail, waited: false, port, url, folders: [], version: "",
  });
  if (!svc?.running && !svc?.reachable) {
    return empty("Syncthing is not running.");
  }
  const script = [
    `P=${port}`,
    'if ! pidof syncthing >/dev/null 2>&1; then echo "@idle\\t1"; echo "@ver\\t"; echo "@cfg\\t"; exit 0; fi',
    'WGET="wget -qO- --timeout=2"',
    'VER=$($WGET "http://127.0.0.1:$P/rest/system/version" 2>/dev/null || true)',
    'CFG=$($WGET "http://127.0.0.1:$P/rest/config" 2>/dev/null || true)',
    `STAT=$($WGET "http://127.0.0.1:$P/rest/db/status${/^[A-Za-z0-9._-]{1,64}$/.test(folderId) ? `?folder=${folderId}` : ""}" 2>/dev/null || true)`,
    'printf "@ver\\t%s\\n" "$(printf %s "$VER" | head -c 400)"',
    'printf "@cfg\\t%s\\n" "$(printf %s "$CFG" | head -c 120000)"',
    'if [ -z "$STAT" ]; then echo "@idle\\t1"; exit 0; fi',
    'if echo "$STAT" | grep -q \'"state":"syncing"\'; then echo "@busy\\t1"; exit 0; fi',
    'if echo "$STAT" | grep -q \'"state":"sync-preparing"\'; then echo "@busy\\t1"; exit 0; fi',
    'echo "@idle\\t1"',
  ].join("\n");
  try {
    const { out, code } = await runCommand(script, 12_000);
    if (code !== 0 && !out.includes("@")) {
      return empty("Could not read Syncthing status.");
    }
    let verRaw = "", cfgRaw = "";
    for (const line of out.split("\n")) {
      if (line.startsWith("@ver\t")) verRaw = line.slice(5);
      if (line.startsWith("@cfg\t")) cfgRaw = line.slice(5);
    }
    const version = /"version"\s*:\s*"([^"]+)"/.exec(verRaw)?.[1] || "";
    const folders = parseFolders(cfgRaw);
    const busy = out.includes("@busy");
    const syncingFolders = folders.filter((f) => !f.paused).length;
    const detail = busy
      ? "Syncthing is still syncing."
      : folders.length
        ? `Syncthing looks idle · ${folders.length} folder${folders.length === 1 ? "" : "s"}${syncingFolders !== folders.length ? ` (${syncingFolders} active)` : ""}.`
        : "Syncthing looks idle.";
    return {
      idle: !busy,
      syncing: busy,
      detail,
      waited: false,
      port,
      url,
      folders,
      version,
    };
  } catch {
    return empty("SSH unavailable.");
  }
}

/** Optional gate: wait until Syncthing is idle or timeout (before large copies, and after a Syncthing transfer).
 *  settleMs gives Syncthing time to notice files that were just written before the first probe. */
export async function waitSyncthingIdle(maxMs = MAX_WAIT_MS, opts: { folderId?: string; settleMs?: number; stop?: () => boolean } = {}): Promise<{ idle: boolean; waited: boolean; detail: string }> {
  const start = Date.now();
  let detail = "";
  if (opts.settleMs) await new Promise((r) => setTimeout(r, opts.settleMs));
  while (Date.now() - start < maxMs) {
    if (opts.stop?.()) return { idle: false, waited: true, detail: "Stopped waiting for Syncthing." };
    const snap = await syncthingIdleJson(opts.folderId);
    detail = snap.detail;
    if (snap.idle) return { idle: true, waited: Date.now() - start > POLL_MS, detail };
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return { idle: false, waited: true, detail: detail || "Timed out waiting for Syncthing." };
}
