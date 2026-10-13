/** A removable volume that could be the TF2 card, before the ROMS/ARCHIVE check. */
export interface Volume {
  /** Stable id for this run: the partition device (disk4s1, /dev/sdb1, E:). */
  id: string;
  /** Whole-disk device used for ejecting; "" when it cannot be ejected. */
  disk: string;
  name: string;
  /** "fat" (FAT12/16/32, so no files of 4 GB or more) or "exfat". */
  fs: "fat" | "exfat";
  /** Human-readable format name. */
  kind: string;
  mount: string;
}

export interface Handheld {
  name: string;
  vendor: string;
  /** Plugged in with USB Function set to MTP. */
  mtp: boolean;
  /** The OS has finished configuring it (macOS asks the user to allow new accessories first). */
  ready: boolean;
  function: "MTP" | "ADB" | "Unknown";
  usb_id: string;
  serial: string;
  speed: string;
  libmtp?: boolean;
  /** The model id from devices.js when the USB name is a known board, else "". */
  model?: string;
  /** The manager has let go of the USB connection until the user connects again. */
  released?: boolean;
}

export interface Platform {
  name: string;
  /** Removable single-partition FAT or exFAT volumes, mounted if needed, plus why other disks were skipped. */
  removableVolumes(): Promise<{ volumes: Volume[]; rejects: string[] }>;
  eject(volume: Volume): Promise<void>;
  /** Moves a file to the Trash or Recycle Bin; returns where it went when known. */
  trash(file: string): Promise<string>;
  /** The MustardOS handheld on USB, found without opening it. */
  findHandheld(): Promise<Handheld | null>;
  /** Frees the handheld from an OS service that claimed it (macOS's ptpcamerad). */
  releaseMtp(): Promise<void>;
  /** Processes that have the handheld's USB interface open, or null when that cannot be told. */
  usbHolders?(): Promise<{ pid: number; name: string }[] | null>;
  libmtpPaths: string[];
  openUrl(url: string): void;
  /** Shows a file selected in Finder or Explorer; on Linux opens its folder. */
  reveal(file: string): void;
  /** The system's own folder picker; resolves to "" when cancelled. Missing where there is none. */
  pickFolder?(prompt: string, start: string): Promise<string>;
  /** The system's own file picker limited to these extensions; resolves to "" when cancelled. */
  pickFile?(prompt: string, start: string, extensions: string[]): Promise<string>;
}

/** Whole disks a System section job is erasing or writing; card detection leaves them alone. */
export const busyDisks = new Set<string>();

export const MUSTARD_VENDOR = 0x1d6b;
export const MUSTARD_MTP_PRODUCT = 0x0100;
export const MUSTARD_ADB_PRODUCT = 0x0105;

export function usbFunction(product: number): Handheld["function"] {
  return product === MUSTARD_MTP_PRODUCT ? "MTP" : product === MUSTARD_ADB_PRODUCT ? "ADB" : "Unknown";
}

export function usbId(vendor: number, product: number): string {
  return `${vendor.toString(16).padStart(4, "0")}:${product.toString(16).padStart(4, "0")}`;
}
