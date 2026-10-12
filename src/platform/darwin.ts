import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UserError } from "../errors.ts";
import { dict, list, parsePlist, str, type PlistValue } from "./plist.ts";
import { detached, run } from "./run.ts";
import { busyDisks, MUSTARD_VENDOR, MUSTARD_MTP_PRODUCT, usbFunction, usbId, type Handheld, type Platform, type Volume } from "./types.ts";

const USB_SPEEDS: Record<number, string> = {
  0: "USB 1.0 low speed", 1: "USB 1.1 full speed", 2: "USB 2.0 high speed", 3: "USB 3 SuperSpeed", 4: "USB 3 SuperSpeed+",
};

async function diskutil(...args: string[]): Promise<Record<string, PlistValue>> {
  const result = await run("diskutil", args);
  return result.code === 0 ? dict(parsePlist(result.stdout)) : {};
}

function* usbNodes(nodes: PlistValue[]): Generator<Record<string, PlistValue>> {
  for (const value of nodes) {
    const node = dict(value);
    if ("idVendor" in node) yield node;
    yield* usbNodes(list(node.IORegistryEntryChildren));
  }
}

async function uniqueIn(folder: string, name: string): Promise<string> {
  const target = path.join(folder, name);
  try {
    await fsp.access(target);
  } catch {
    return target;
  }
  const dot = name.lastIndexOf(".");
  const stamp = new Date().toTimeString().slice(0, 8).replaceAll(":", ".");
  return path.join(folder, dot > 0 ? `${name.slice(0, dot)} ${stamp}${name.slice(dot)}` : `${name} ${stamp}`);
}

export const darwin: Platform = {
  name: "macOS",
  libmtpPaths: ["/opt/homebrew/lib/libmtp.dylib", "/usr/local/lib/libmtp.dylib", "libmtp.dylib"],

  async removableVolumes() {
    const volumes: Volume[] = [], rejects: string[] = [];
    const listing = await diskutil("list", "-plist", "external", "physical");
    for (const entryValue of list(listing.AllDisksAndPartitions)) {
      const entry = dict(entryValue);
      const disk = str(entry.DeviceIdentifier);
      if (busyDisks.has(disk)) continue;
      const info = await diskutil("info", "-plist", disk);
      if (!(info.Internal === false && info.RemovableMedia === true && info.WholeDisk === true
        && info.VirtualOrPhysical === "Physical" && info.Writable === true)) continue;
      const partitions = list(entry.Partitions).map(dict);
      const found: Record<string, PlistValue>[] = [];
      for (const partition of partitions) {
        const pinfo = await diskutil("info", "-plist", str(partition.DeviceIdentifier));
        if (pinfo.FilesystemType === "msdos" || pinfo.FilesystemType === "exfat") found.push(pinfo);
      }
      if (partitions.length !== 1 || found.length !== 1) {
        rejects.push(`${disk} has ${partitions.length} partitions, not one FAT32 or exFAT volume`);
        continue;
      }
      let volume = found[0];
      let mount = str(volume.MountPoint);
      if (!mount) {
        await run("diskutil", ["mount", str(volume.DeviceIdentifier)]);
        volume = await diskutil("info", "-plist", str(volume.DeviceIdentifier));
        mount = str(volume.MountPoint);
      }
      if (!mount) {
        rejects.push(`${disk} volume would not mount`);
        continue;
      }
      volumes.push({
        id: str(volume.DeviceIdentifier), disk, name: str(volume.VolumeName),
        fs: volume.FilesystemType === "exfat" ? "exfat" : "fat",
        kind: str(volume.FilesystemUserVisibleName) || str(volume.FilesystemType), mount,
      });
    }
    return { volumes, rejects };
  },

  async eject(volume) {
    const result = await run("diskutil", ["eject", `/dev/${volume.disk}`]);
    if (result.code !== 0) throw new UserError("Could not eject. Close any Finder windows on TF2 and try again.");
  },

  async trash(file) {
    const target = await uniqueIn(path.join(os.homedir(), ".Trash"), path.basename(file));
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
    const result = await run("ioreg", ["-a", "-p", "IOUSB", "-l", "-r", "-c", "IOUSBHostDevice"], 15_000);
    if (result.code !== 0 || !result.stdout) return null;
    for (const node of usbNodes(list(parsePlist(result.stdout)))) {
      const vendor = str(node["USB Vendor Name"]) || str(node.kUSBVendorString);
      const vendorId = Number(node.idVendor ?? 0), productId = Number(node.idProduct ?? 0);
      const mtp = vendorId === MUSTARD_VENDOR && productId === MUSTARD_MTP_PRODUCT;
      if (!mtp && !vendor.toLowerCase().includes("mustard")) continue;
      const speed = node.USBSpeed ?? node["Device Speed"];
      const handheld: Handheld = {
        name: str(node["USB Product Name"]) || str(node.kUSBProductString) || "MustardOS handheld",
        vendor: vendor || "MustardOS", mtp, ready: "kUSBCurrentConfiguration" in node,
        function: usbFunction(productId), usb_id: usbId(vendorId, productId),
        serial: str(node["USB Serial Number"]) || str(node.kUSBSerialNumberString),
        speed: typeof speed === "number" ? USB_SPEEDS[speed] ?? "" : "",
      };
      return handheld;
    }
    return null;
  },

  async usbHolders() {
    const result = await run("ioreg", ["-l", "-w0", "-r", "-c", "IOUSBHostDevice"], 15_000);
    if (result.code !== 0) return null;
    const holders = new Map<number, string>();
    let handheld = false, cls = "";
    for (const line of result.stdout.split("\n")) {
      if (line.startsWith("+-o ")) handheld = false;
      const node = line.match(/\+-o .*<class (\w+)/);
      if (node) cls = node[1];
      const vendor = line.match(/"idVendor" = (\d+)/);
      if (vendor && Number(vendor[1]) === MUSTARD_VENDOR) handheld = true;
      const creator = line.match(/"IOUserClientCreator" = "pid (\d+), (.*)"/);
      if (creator && handheld && cls === "AppleUSBHostInterfaceUserClient") holders.set(Number(creator[1]), creator[2]);
    }
    return [...holders].map(([pid, name]) => ({ pid, name }));
  },

  async releaseMtp() {
    // macOS's Image Capture daemon claims every PTP/MTP device; launchd restarts it on demand.
    await run("killall", ["-9", "ptpcamerad"], 10_000);
    await new Promise((resolve) => setTimeout(resolve, 300));
  },

  openUrl(url) {
    detached("open", [url]);
  },

  async pickFolder(prompt, start) {
    const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    const script = `POSIX path of (choose folder with prompt ${quote(prompt)} default location POSIX file ${quote(start)})`;
    // A bare "activate" brings osascript's own dialog to the front without asking to control another app.
    const result = await run("osascript", ["-e", "activate", "-e", script], 600_000);
    return result.code === 0 ? result.stdout.trim().replace(/(.)\/$/, "$1") : "";
  },

  async pickFile(prompt, start, extensions) {
    const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    const types = extensions.length ? ` of type {${extensions.map(quote).join(", ")}}` : "";
    const script = `POSIX path of (choose file with prompt ${quote(prompt)}${types} default location POSIX file ${quote(start)})`;
    const result = await run("osascript", ["-e", "activate", "-e", script], 600_000);
    return result.code === 0 ? result.stdout.trim() : "";
  },
};
