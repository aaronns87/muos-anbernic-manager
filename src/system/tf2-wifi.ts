// Format TF2 over Wi-Fi/SSH: erase the games card on the handheld.
// Set up TF2 also creates the ROMS folders; Reset leaves an empty volume.
// Never touches SD1 (/mnt/mmc). Uses MustardOS's own storage.sh to eject and remount.

import { runCommand, sshStatus } from "../device/ssh.ts";
import { UserError } from "../errors.ts";
import { shq } from "../util.ts";
import type { SystemCard } from "./cards.ts";
import { Cancelled } from "./image.ts";

const CONFIRM = "TF2";
const CFG = "/opt/muos/device/config/storage";

export interface WifiTf2Status {
  ready: boolean;
  reason: string;
  host: string;
  size: number;
  part: string;
  disk: string;
  mount: string;
  label: string;
}

/** The subset of SystemJob that the Wi-Fi setup path needs. */
export interface Tf2Job {
  cancelled: boolean;
  result: Record<string, unknown>;
  begin(id: string, detail?: string, total?: number): { done: number; detail: string };
  end(id: string, detail?: string): void;
}

let lastStatus: { at: number; value: WifiTf2Status } | null = null;

/** Reads MustardOS storage config and checks that TF2 is present and not the system card. */
export async function wifiTf2Status(force = false): Promise<WifiTf2Status> {
  if (!force && lastStatus && Date.now() - lastStatus.at < 8_000) return lastStatus.value;
  const empty = { ready: false, reason: "", host: "", size: 0, part: "", disk: "", mount: "", label: "" };
  const ssh = await sshStatus();
  if (!ssh.configured) return lastStatus = { at: Date.now(), value: { ...empty, reason: "Set the handheld's Wi-Fi address in Overview or SSH settings." } }, lastStatus.value;
  if (!ssh.reachable) {
    return lastStatus = { at: Date.now(), value: { ...empty, host: ssh.host, reason: `Nothing answers on ${ssh.host}. Enable Secure Shell on the handheld.` } }, lastStatus.value;
  }
  try {
    const { out, code } = await runCommand(`set -e
SD_DEV=$(cat ${CFG}/sdcard/dev)
SD_SEP=$(cat ${CFG}/sdcard/sep)
SD_NUM=$(cat ${CFG}/sdcard/num)
SD_MOUNT=$(cat ${CFG}/sdcard/mount)
SD_LABEL=$(cat ${CFG}/sdcard/label 2>/dev/null || true)
ROM_DEV=$(cat ${CFG}/rom/dev)
PART="/dev/\${SD_DEV}\${SD_SEP}\${SD_NUM}"
printf "disk=%s\\n" "$SD_DEV"
printf "part=%s\\n" "$PART"
printf "mount=%s\\n" "$SD_MOUNT"
printf "label=%s\\n" "$SD_LABEL"
printf "rom=%s\\n" "$ROM_DEV"
if [ "$SD_DEV" = "$ROM_DEV" ]; then printf "same=1\\n"; else printf "same=0\\n"; fi
if [ -b "$PART" ]; then printf "exists=1\\n"; else printf "exists=0\\n"; fi
if [ -b "/dev/$SD_DEV" ]; then printf "whole=1\\n"; else printf "whole=0\\n"; fi
SIZE=$(lsblk -bn -o SIZE "$PART" 2>/dev/null || lsblk -bn -o SIZE "/dev/$SD_DEV" 2>/dev/null || echo 0)
printf "size=%s\\n" "$SIZE"
if findmnt -n "$SD_MOUNT" >/dev/null 2>&1; then printf "mounted=1\\n"; else printf "mounted=0\\n"; fi
command -v mkfs.exfat >/dev/null && printf "mkfs=1\\n" || printf "mkfs=0\\n"
(command -v mkfs.vfat >/dev/null || command -v mkfs.fat >/dev/null) && printf "mkfs_fat=1\\n" || printf "mkfs_fat=0\\n"
[ -x /opt/muos/script/mount/storage.sh ] && printf "storage=1\\n" || printf "storage=0\\n"
`, 12_000);
    if (code !== 0) {
      return lastStatus = { at: Date.now(), value: { ...empty, host: ssh.host, reason: "Could not read the handheld's storage layout over SSH." } }, lastStatus.value;
    }
    const get = (k: string) => out.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";
    const disk = get("disk"), part = get("part"), mount = get("mount") || "/mnt/sdcard";
    const size = Number(get("size") || 0);
    const base = { host: ssh.host, size, part, disk, mount, label: get("label") || "TF2" };
    let value: WifiTf2Status;
    if (get("same") === "1") {
      value = { ...empty, ...base, reason: "This handheld keeps games on the system card. TF2 setup over Wi-Fi needs a second card slot." };
    } else if (get("mkfs") !== "1") {
      value = { ...empty, ...base, reason: "The handheld has no mkfs.exfat, so TF2 cannot be formatted over Wi-Fi." };
    } else if (get("storage") !== "1") {
      value = { ...empty, ...base, reason: "MustardOS storage.sh is missing on the handheld." };
    } else if (get("whole") !== "1" && get("exists") !== "1") {
      value = { ...empty, ...base, reason: "No TF2 card is in the handheld. Insert one and try again." };
    } else {
      value = { ready: true, reason: "", ...base };
    }
    lastStatus = { at: Date.now(), value };
    return value;
  } catch (error) {
    return lastStatus = { at: Date.now(), value: { ...empty, host: ssh.host, reason: (error as Error).message } }, lastStatus.value;
  }
}

export function wifiTf2Card(info: WifiTf2Status): SystemCard {
  return {
    id: CONFIRM,
    media: `TF2 on ${info.host || "the handheld"}`,
    size: info.size,
    protocol: "Wi-Fi",
    scheme: "MBR",
    partitions: [],
    role: { kind: "tf2", label: "TF2 games card", detail: `${info.part || "/mnt/sdcard"} over SSH` },
  };
}

export const wifiTf2Confirm = CONFIRM;

export type WifiFs = "FAT32" | "ExFAT";

/** Eject, format, remount. Shared by setup (exFAT/TF2) and reset (chosen FS/name). */
async function formatTf2OverWifi(j: Tf2Job, info: WifiTf2Status, fs: WifiFs = "ExFAT", name = "TF2"): Promise<string> {
  if (!info.ready || !info.disk || !info.part) throw new UserError(info.reason || "TF2 is not ready over Wi-Fi.");
  if (info.disk === "mmcblk0") throw new UserError("Refusing to format the system card.");

  const erase = j.begin("erase", "Unmounting TF2", 100);
  erase.done = 5;
  const ejected = await runCommand("/opt/muos/script/mount/storage.sh sdcard eject", 60_000);
  if (j.cancelled) throw new Cancelled();
  if (ejected.code !== 0 && !/already unmounted/i.test(ejected.out + ejected.err)) {
    throw new UserError(`Could not unmount TF2: ${(ejected.err || ejected.out).trim().split("\n").pop() || `exit ${ejected.code}`}`);
  }
  erase.done = 40;
  erase.detail = `Formatting ${info.part}`;

  const label = shq(name);
  const mkfs = fs === "FAT32"
    ? `if command -v mkfs.vfat >/dev/null; then mkfs.vfat -F 32 -n ${label} "$PART"
elif command -v mkfs.fat >/dev/null; then mkfs.fat -F 32 -n ${label} "$PART"
else echo "mkfs.vfat is missing"; exit 1; fi`
    : `command -v mkfs.exfat >/dev/null || { echo "mkfs.exfat is missing"; exit 1; }
mkfs.exfat -L ${label} -q "$PART"`;

  // Recreate a single MBR partition when needed, then format.
  const format = await runCommand(`set -e
DISK=/dev/${info.disk}
PART=${shq(info.part)}
if [ ! -b "$PART" ]; then
  command -v parted >/dev/null || { echo "parted is missing"; exit 1; }
  parted -s "$DISK" mklabel msdos
  parted -s "$DISK" mkpart primary 1MiB 100%
  sleep 1
  PART=${shq(info.part)}
  [ -b "$PART" ] || PART="\${DISK}p1"
  [ -b "$PART" ] || PART="\${DISK}1"
fi
[ -b "$PART" ] || { echo "No partition to format on $DISK"; exit 1; }
ROM=$(cat ${CFG}/rom/dev)
case "$PART" in /dev/"$ROM"|/dev/"$ROM"*) echo "Refusing to format the system card ($PART)"; exit 1 ;; esac
case "$DISK" in /dev/"$ROM") echo "Refusing to format the system card ($DISK)"; exit 1 ;; esac
${mkfs}
printf "formatted=%s\\n" "$PART"
`, 180_000);
  if (j.cancelled) throw new Cancelled();
  if (format.code !== 0) {
    throw new UserError(`Could not format TF2: ${(format.err || format.out).trim().split("\n").pop() || `exit ${format.code}`}`);
  }
  j.end("erase", `${fs === "FAT32" ? "FAT32" : "exFAT"} volume named ${name}`);

  j.begin("mount", "Mounting TF2 on the handheld");
  const mounted = await runCommand("/opt/muos/script/mount/storage.sh sdcard mount", 60_000);
  if (j.cancelled) throw new Cancelled();
  if (mounted.code !== 0 && !/already mounted/i.test(mounted.out + mounted.err)) {
    throw new UserError(`Formatted, but remount failed: ${(mounted.err || mounted.out).trim().split("\n").pop() || `exit ${mounted.code}`}`);
  }
  const mount = info.mount || "/mnt/sdcard";
  j.end("mount", mount);
  lastStatus = null;
  return mount;
}

/** Formats TF2 on the handheld and creates the same folders as the card-reader path. */
export async function setupTf2OverWifi(j: Tf2Job, info: WifiTf2Status, folders: string[], systems: number): Promise<void> {
  const mount = await formatTf2OverWifi(j, info, "ExFAT", "TF2");
  const stage = j.begin("folders", "", folders.length);
  const list = folders.map((f) => shq(`${mount}/${f}`)).join(" ");
  const made = await runCommand(`set -e
for d in ${list}; do
  mkdir -p "$d"
  printf "ok=%s\\n" "$d"
done
`, 60_000);
  if (j.cancelled) throw new Cancelled();
  if (made.code !== 0) {
    throw new UserError(`Could not create ROMS folders: ${(made.err || made.out).trim().split("\n").pop() || `exit ${made.code}`}`);
  }
  stage.done = folders.length;
  j.end("folders", `${systems} system folders in ROMS/`);
  j.result = { mount, systems, via: "wifi" };
}

/** Formats TF2 on the handheld to an empty volume; no ROMS folders. */
export async function resetTf2OverWifi(j: Tf2Job, info: WifiTf2Status, fs: WifiFs, name: string): Promise<void> {
  const mount = await formatTf2OverWifi(j, info, fs, name);
  j.result = { mount, name, fs, via: "wifi" };
}
