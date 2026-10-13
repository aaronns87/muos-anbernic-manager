import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UserError } from "../errors.ts";
import { detached, run } from "./run.ts";
import { MUSTARD_VENDOR, MUSTARD_MTP_PRODUCT, usbFunction, usbId, type Handheld, type Platform, type Volume } from "./types.ts";

interface BlockDevice {
  name: string;
  type: string;
  rm: boolean | string;
  hotplug: boolean | string;
  ro: boolean | string;
  fstype: string | null;
  mountpoint: string | null;
  label: string | null;
  children?: BlockDevice[];
}

const yes = (value: boolean | string) => value === true || value === "1";

async function lsblk(): Promise<BlockDevice[]> {
  const result = await run("lsblk", ["-J", "-p", "-o", "NAME,TYPE,RM,HOTPLUG,RO,FSTYPE,MOUNTPOINT,LABEL"]);
  if (result.code !== 0) return [];
  try {
    return (JSON.parse(result.stdout) as { blockdevices: BlockDevice[] }).blockdevices ?? [];
  } catch {
    return [];
  }
}

async function readSys(dir: string, name: string): Promise<string> {
  return (await fsp.readFile(path.join(dir, name), "utf8").catch(() => "")).trim();
}

export const linux: Platform = {
  name: "Linux",
  libmtpPaths: ["libmtp.so.9", "libmtp.so", "/usr/lib/x86_64-linux-gnu/libmtp.so.9", "/usr/lib/aarch64-linux-gnu/libmtp.so.9"],

  async removableVolumes() {
    const volumes: Volume[] = [], rejects: string[] = [];
    for (const disk of await lsblk()) {
      if (disk.type !== "disk" || !(yes(disk.rm) || yes(disk.hotplug)) || yes(disk.ro)) continue;
      const parts = disk.children ?? [];
      const usable = parts.filter((p) => p.fstype === "vfat" || p.fstype === "exfat");
      if (parts.length !== 1 || usable.length !== 1) {
        rejects.push(`${disk.name} has ${parts.length} partitions, not one FAT32 or exFAT volume`);
        continue;
      }
      let part = usable[0];
      if (!part.mountpoint) {
        await run("udisksctl", ["mount", "-b", part.name, "--no-user-interaction"]);
        part = (await lsblk()).flatMap((d) => d.children ?? []).find((p) => p.name === part.name) ?? part;
      }
      if (!part.mountpoint) {
        rejects.push(`${disk.name} volume would not mount`);
        continue;
      }
      volumes.push({
        id: part.name, disk: disk.name, name: part.label ?? "", fs: part.fstype === "exfat" ? "exfat" : "fat",
        kind: part.fstype === "exfat" ? "exFAT" : "FAT32", mount: part.mountpoint,
      });
    }
    return { volumes, rejects };
  },

  async eject(volume) {
    const unmount = await run("udisksctl", ["unmount", "-b", volume.id, "--no-user-interaction"]);
    if (unmount.code !== 0) throw new UserError("Could not unmount TF2. Close any windows using it and try again.");
    await run("udisksctl", ["power-off", "-b", volume.disk, "--no-user-interaction"]);
  },

  async trash(file) {
    const gio = await run("gio", ["trash", file]);
    if (gio.code === 0) return path.join(os.homedir(), ".local/share/Trash/files", path.basename(file));
    const folder = path.join(os.homedir(), ".local/share/Trash");
    await fsp.mkdir(path.join(folder, "files"), { recursive: true });
    await fsp.mkdir(path.join(folder, "info"), { recursive: true });
    let name = path.basename(file);
    for (let n = 2; await fsp.access(path.join(folder, "files", name)).then(() => true, () => false); n++) {
      name = `${path.basename(file)}.${n}`;
    }
    await fsp.writeFile(path.join(folder, "info", `${name}.trashinfo`),
      `[Trash Info]\nPath=${encodeURI(file)}\nDeletionDate=${new Date().toISOString().slice(0, 19)}\n`);
    const target = path.join(folder, "files", name);
    try {
      await fsp.rename(file, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await fsp.cp(file, target, { recursive: true, preserveTimestamps: true });
      await fsp.rm(file, { recursive: true });
    }
    return target;
  },

  async findHandheld() {
    const base = "/sys/bus/usb/devices";
    for (const entry of await fsp.readdir(base).catch(() => [] as string[])) {
      const dir = path.join(base, entry);
      const vendorId = parseInt(await readSys(dir, "idVendor"), 16);
      if (Number.isNaN(vendorId)) continue;
      const productId = parseInt(await readSys(dir, "idProduct"), 16);
      const vendor = await readSys(dir, "manufacturer");
      const mtp = vendorId === MUSTARD_VENDOR && productId === MUSTARD_MTP_PRODUCT;
      if (!mtp && !vendor.toLowerCase().includes("mustard")) continue;
      const mbps = Number(await readSys(dir, "speed"));
      const handheld: Handheld = {
        name: (await readSys(dir, "product")) || "MustardOS handheld", vendor: vendor || "MustardOS", mtp,
        ready: (await readSys(dir, "bConfigurationValue")) !== "", function: usbFunction(productId),
        usb_id: usbId(vendorId, productId), serial: await readSys(dir, "serial"),
        speed: mbps >= 10000 ? "USB 3 SuperSpeed+" : mbps >= 5000 ? "USB 3 SuperSpeed" : mbps >= 480 ? "USB 2.0 high speed"
          : mbps >= 12 ? "USB 1.1 full speed" : "",
      };
      return handheld;
    }
    return null;
  },

  async releaseMtp() {
    // GNOME's gvfs can hold MTP devices; unmounting its mtp:// mounts lets libmtp open the handheld.
    const mounts = await run("gio", ["mount", "-l"]);
    for (const match of mounts.stdout.matchAll(/(mtp:\/\/\S+)/g)) await run("gio", ["mount", "-u", match[1]]);
  },

  openUrl(url) {
    detached("xdg-open", [url]);
  },
};
