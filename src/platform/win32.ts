import fsp from "node:fs/promises";
import { UserError } from "../errors.ts";
import { detached, run } from "./run.ts";
import { MUSTARD_VENDOR, MUSTARD_MTP_PRODUCT, usbFunction, usbId, type Platform, type Volume } from "./types.ts";

function powershell(script: string) {
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
}

const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;

export const win32: Platform = {
  name: "Windows",
  libmtpPaths: ["libmtp-9.dll", "libmtp.dll"],

  async removableVolumes() {
    const result = await powershell(
      "Get-Volume | Where-Object { $_.DriveType -eq 'Removable' -and $_.DriveLetter } | "
      + "Select-Object DriveLetter,FileSystem,FileSystemLabel | ConvertTo-Json -Compress");
    if (result.code !== 0 || !result.stdout.trim()) return { volumes: [], rejects: [] };
    type Row = { DriveLetter: string; FileSystem: string; FileSystemLabel: string };
    let parsed: Row | Row[];
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      return { volumes: [], rejects: [] };
    }
    const volumes: Volume[] = [], rejects: string[] = [];
    for (const v of Array.isArray(parsed) ? parsed : [parsed]) {
      const fs = (v.FileSystem || "").toUpperCase();
      if (fs !== "FAT32" && fs !== "EXFAT" && fs !== "FAT") {
        rejects.push(`${v.DriveLetter}: is ${v.FileSystem || "unformatted"}, not FAT32 or exFAT`);
        continue;
      }
      volumes.push({
        id: `${v.DriveLetter}:`, disk: `${v.DriveLetter}:`, name: v.FileSystemLabel || "", fs: fs === "EXFAT" ? "exfat" : "fat",
        kind: v.FileSystem, mount: `${v.DriveLetter}:\\`,
      });
    }
    return { volumes, rejects };
  },

  async eject(volume) {
    const result = await powershell(
      `(New-Object -ComObject Shell.Application).Namespace(17).ParseName(${quote(volume.disk)}).InvokeVerb('Eject')`);
    if (result.code !== 0) throw new UserError("Could not eject TF2. Close any windows using it and try again.");
  },

  async trash(file) {
    const method = (await fsp.stat(file).catch(() => null))?.isDirectory() ? "DeleteDirectory" : "DeleteFile";
    const result = await powershell(
      `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${method}(`
      + `${quote(file)}, 'OnlyErrorDialogs', 'SendToRecycleBin')`);
    if (result.code !== 0) throw new UserError(`Could not move ${file} to the Recycle Bin.`);
    return "Recycle Bin";
  },

  async findHandheld() {
    const result = await powershell(
      "Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '^USB\\\\VID_1D6B&PID_' } | "
      + "Select-Object -First 1 InstanceId,FriendlyName | ConvertTo-Json -Compress");
    if (result.code !== 0 || !result.stdout.trim()) return null;
    let device: { InstanceId: string; FriendlyName: string };
    try {
      device = JSON.parse(result.stdout);
    } catch {
      return null;
    }
    const match = /PID_([0-9A-F]{4})(?:\\(.+))?/i.exec(device.InstanceId);
    const productId = match ? parseInt(match[1], 16) : 0;
    return {
      name: device.FriendlyName || "MustardOS handheld", vendor: "MustardOS", mtp: productId === MUSTARD_MTP_PRODUCT,
      ready: true, function: usbFunction(productId), usb_id: usbId(MUSTARD_VENDOR, productId), serial: match?.[2] ?? "", speed: "",
    };
  },

  async releaseMtp() {},

  openUrl(url) {
    if (/^https?:\/\//i.test(url)) detached("rundll32.exe", ["url.dll,FileProtocolHandler", url]);
    else detached("explorer.exe", [url]);
  },
};
