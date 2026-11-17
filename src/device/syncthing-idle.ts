// Whether Syncthing on the handheld looks idle (no folder still syncing). Best-effort over SSH.

import { runCommand } from "./ssh.ts";
import { webServicesStatus } from "./web-services.ts";

const POLL_MS = 1200;
const MAX_WAIT_MS = 90_000;

/** Polls the handheld Syncthing REST API on localhost; returns idle when unsure. */
export async function syncthingIdleJson() {
  const pack = await webServicesStatus(true);
  const svc = pack.services.find((s) => s.id === "syncthing");
  if (!svc?.running && !svc?.reachable) {
    return { idle: true, syncing: false, detail: "Syncthing is not running.", waited: false };
  }
  const port = svc.port || 7070;
  const script = [
    `P=${port}`,
    'if ! pidof syncthing >/dev/null 2>&1; then echo "@idle\\t1"; exit 0; fi',
    'WGET="wget -qO- --timeout=2"',
    'STAT=$($WGET "http://127.0.0.1:$P/rest/db/status" 2>/dev/null || true)',
    'if [ -z "$STAT" ]; then echo "@idle\\t1"; exit 0; fi',
    'if echo "$STAT" | grep -q \'"state":"syncing"\'; then echo "@busy\\t1"; exit 0; fi',
    'if echo "$STAT" | grep -q \'"state":"sync-preparing"\'; then echo "@busy\\t1"; exit 0; fi',
    'echo "@idle\\t1"',
  ].join("\n");
  try {
    const { out, code } = await runCommand(script, 8000);
    if (code !== 0 && !out.includes("@")) {
      return { idle: true, syncing: false, detail: "Could not read Syncthing status.", waited: false };
    }
    const busy = out.includes("@busy");
    return { idle: !busy, syncing: busy, detail: busy ? "Syncthing is still syncing." : "Syncthing looks idle.", waited: false };
  } catch {
    return { idle: true, syncing: false, detail: "SSH unavailable.", waited: false };
  }
}

/** Optional gate: wait until Syncthing is idle or timeout (used before large copies). */
export async function waitSyncthingIdle(maxMs = MAX_WAIT_MS): Promise<{ idle: boolean; waited: boolean; detail: string }> {
  const start = Date.now();
  let detail = "";
  while (Date.now() - start < maxMs) {
    const snap = await syncthingIdleJson();
    detail = snap.detail;
    if (snap.idle) return { idle: true, waited: Date.now() - start > POLL_MS, detail };
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return { idle: false, waited: true, detail: detail || "Timed out waiting for Syncthing." };
}