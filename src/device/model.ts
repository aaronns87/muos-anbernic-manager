// Which handheld model is connected. Over USB its name is the board ("RG40XX-H"); over Wi-Fi MustardOS's board config
// is readable through SFTP ("MUX (internal)" is /opt/muos), or SSH. A card in a reader only hints at it: SD1 keeps
// play time records with the model each game was last played on. The browser asks about cards with no hint.

import fsp from "node:fs/promises";
import path from "node:path";
import { deviceFor } from "../../public/js/devices.js";
import { readWifiText, wifiSettings } from "./sftp.ts";
import { runCommand, sshStatus } from "./ssh.ts";

export interface Detected {
  /** The id from devices.js, or "" for a board the manager does not know. */
  id: string;
  /** The board name as the handheld reports it. */
  board: string;
  via: "usb" | "wifi" | "ssh" | "card";
  screen: [number, number] | null;
}

const BOARD = "/opt/muos/device/config";
const FOUND_MS = 15 * 60_000;
const MISSED_MS = 60_000;

const detected = (board: string, via: Detected["via"], w = 0, h = 0): Detected | null =>
  board ? { id: deviceFor(board)?.id ?? "", board, via, screen: w > 0 && h > 0 ? [w, h] : null } : null;

export const usbModel = (name: string): Detected | null => (deviceFor(name) ? detected(name, "usb") : null);

let wifiSeen: { host: string; at: number; found: Detected | null } = { host: "", at: 0, found: null };
let pending: Promise<Detected | null> | null = null;

async function readBoard(): Promise<Detected | null> {
  const sftp = `/MUX (internal)${BOARD.replace("/opt/muos", "")}`;
  try {
    const [name, w, h] = await Promise.all(["board/name", "screen/width", "screen/height"].map((f) => readWifiText(`${sftp}/${f}`)));
    const found = detected(name.trim(), "wifi", Number(w), Number(h));
    if (found) return found;
  } catch {}
  const ssh = await sshStatus().catch(() => null);
  if (!ssh?.configured || !ssh.reachable) return null;
  const { out } = await runCommand(`cd ${BOARD} && echo "$(cat board/name) $(cat screen/width) $(cat screen/height)"`, 10_000).catch(() => ({ out: "" }));
  const [name = "", w = "", h = ""] = out.trim().split(/\s+/);
  return detected(name, "ssh", Number(w), Number(h));
}

/** The model of the handheld on Wi-Fi, read once per address and kept for a while. */
export async function wifiModel(reachable: boolean): Promise<Detected | null> {
  if (!reachable) return null;
  const host = (await wifiSettings()).host;
  const fresh = wifiSeen.host === host && Date.now() - wifiSeen.at < (wifiSeen.found ? FOUND_MS : MISSED_MS);
  if (fresh) return wifiSeen.found;
  pending ??= readBoard().then((found) => {
    wifiSeen = { host, at: Date.now(), found };
    return found;
  }).finally(() => { pending = null; });
  return pending;
}

/** The model name for messages over Wi-Fi, once it is known. */
export const wifiModelName = () => (wifiSeen.found ? deviceFor(wifiSeen.found.board)?.name ?? wifiSeen.found.board.toUpperCase() : "");

const hints = new Map<string, { stamp: string; board: string }>();

/** The model SD1's play time records name most often, or "" (TF2 cards and unplayed handhelds have none). */
export async function cardHint(mount: string): Promise<string> {
  const file = path.join(mount, "MUOS", "info", "track", "playtime_data.json");
  const st = await fsp.stat(file).catch(() => null);
  if (!st || st.size > 20 * 1024 * 1024) return "";
  const stamp = `${st.size}:${st.mtimeMs}`;
  const known = hints.get(mount);
  if (known?.stamp === stamp) return known.board;
  const counts = new Map<string, number>();
  try {
    const data = JSON.parse(await fsp.readFile(file, "utf8")) as Record<string, { device_launches?: Record<string, number>; last_device?: string }>;
    for (const game of Object.values(data)) {
      const launches = game?.device_launches && typeof game.device_launches === "object" ? game.device_launches : game?.last_device ? { [game.last_device]: 1 } : {};
      for (const [board, n] of Object.entries(launches)) counts.set(board, (counts.get(board) ?? 0) + (Number(n) || 0));
    }
  } catch {}
  const board = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  hints.set(mount, { stamp, board });
  return board;
}
