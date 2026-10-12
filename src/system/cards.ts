// SD cards in a card reader, for the System section: whole external removable disks only, read without mounting.

import fsp from "node:fs/promises";
import path from "node:path";
import { UserError } from "../errors.ts";
import { dict, list, parsePlist, str, type PlistValue } from "../platform/plist.ts";
import { run } from "../platform/run.ts";
import { isDir } from "../util.ts";

export interface Partition {
  id: string;
  index: number;
  /** GPT partition name or volume name, "" when neither is set. */
  name: string;
  volume: string;
  /** Partition type as diskutil words it ("Microsoft Basic Data", "Linux Filesystem", "DOS_FAT_32"). */
  content: string;
  /** Filesystem as macOS reads it ("msdos", "exfat"), "" for ones it cannot (ext4). */
  fs: string;
  fsLabel: string;
  size: number;
  mount: string;
  free: number;
}

export interface Role {
  kind: "muos" | "tf2" | "blank" | "empty" | "unknown";
  label: string;
  detail: string;
}

export interface SystemCard {
  id: string;
  media: string;
  size: number;
  protocol: string;
  scheme: string;
  partitions: Partition[];
  role: Role;
}

const SCHEMES: Record<string, string> = { FDisk_partition_scheme: "MBR", GUID_partition_scheme: "GPT", Apple_partition_scheme: "APM" };

async function plist(args: string[]): Promise<Record<string, PlistValue>> {
  if (process.platform !== "darwin") return {};
  const result = await run("diskutil", args);
  return result.code === 0 ? dict(parsePlist(result.stdout)) : {};
}

/** The checks the shell scripts make before touching a disk. */
export function isCardDisk(info: Record<string, PlistValue>): boolean {
  return info.Internal === false && info.RemovableMedia === true && info.WholeDisk === true
    && info.VirtualOrPhysical === "Physical" && info.Writable === true && info.Ejectable === true;
}

async function free(mount: string): Promise<number> {
  try {
    const st = await fsp.statfs(mount);
    return st.bavail * st.bsize;
  } catch {
    return 0;
  }
}

async function roleOf(parts: Partition[]): Promise<Role> {
  if (!parts.length) return { kind: "empty", label: "No partitions", detail: "Blank or unreadable partition map" };
  const names = parts.map((p) => p.name.toLowerCase());
  if (names.includes("boot") && (names.includes("rootfs") || parts.some((p) => /linux/i.test(p.content)))) {
    return { kind: "muos", label: "MustardOS system card", detail: "SD1: boot and rootfs partitions" };
  }
  if (parts.length === 1 && (parts[0].fs === "msdos" || parts[0].fs === "exfat")) {
    const p = parts[0];
    if (p.mount && (await isDir(path.join(p.mount, "ROMS")))) {
      let systems = 0;
      try {
        systems = (await fsp.readdir(path.join(p.mount, "ROMS"), { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith(".")).length;
      } catch {}
      return { kind: "tf2", label: "TF2 games card", detail: `${p.fsLabel} with ROMS/ (${systems} system folders)` };
    }
    return { kind: "blank", label: `${p.fsLabel} card`, detail: p.mount ? `One volume named ${p.volume || "untitled"}` : "One volume, not mounted" };
  }
  return { kind: "unknown", label: "Other layout", detail: `${parts.length} partitions` };
}

export async function listCards(): Promise<SystemCard[]> {
  const listing = await plist(["list", "-plist", "external", "physical"]);
  const cards: SystemCard[] = [];
  for (const entryValue of list(listing.AllDisksAndPartitions)) {
    const entry = dict(entryValue);
    const id = str(entry.DeviceIdentifier);
    if (!/^disk\d+$/.test(id)) continue;
    const info = await plist(["info", "-plist", id]);
    if (!isCardDisk(info)) continue;
    const partitions: Partition[] = [];
    for (const [index, partValue] of list(entry.Partitions).entries()) {
      const part = dict(partValue);
      const pid = str(part.DeviceIdentifier);
      const pinfo = await plist(["info", "-plist", pid]);
      const mount = str(pinfo.MountPoint);
      const volume = str(pinfo.VolumeName) || str(part.VolumeName);
      partitions.push({
        id: pid, index: index + 1, volume,
        name: str(pinfo.MediaName) && !/^Untitled|^disk\d/i.test(str(pinfo.MediaName)) ? str(pinfo.MediaName) : volume,
        content: str(part.Content) || str(pinfo.Content),
        fs: str(pinfo.FilesystemType), fsLabel: str(pinfo.FilesystemUserVisibleName) || str(pinfo.FilesystemType),
        size: Number(part.Size ?? pinfo.Size ?? 0), mount, free: mount ? await free(mount) : 0,
      });
    }
    cards.push({
      id, media: str(info.MediaName) || "SD card", size: Number(info.TotalSize ?? info.Size ?? 0),
      protocol: str(info.BusProtocol), scheme: SCHEMES[str(entry.Content)] ?? (str(entry.Content) || "None"),
      partitions, role: await roleOf(partitions),
    });
  }
  return cards;
}

/** The card with this disk identifier, checked again right now; throws when it is gone or not a card. */
export async function requireCard(id: string): Promise<SystemCard> {
  if (!/^disk\d+$/.test(id)) throw new UserError("Pick a card first.");
  const card = (await listCards()).find((c) => c.id === id);
  if (!card) throw new UserError(`${id} is no longer in the card reader, or is not a removable card.`);
  return card;
}

export async function ejectCard(id: string): Promise<void> {
  await requireCard(id);
  const result = await run("diskutil", ["eject", `/dev/${id}`], 60_000);
  if (result.code !== 0) throw new UserError(`Could not eject ${id}. Close any Finder windows on it and try again.`);
}
