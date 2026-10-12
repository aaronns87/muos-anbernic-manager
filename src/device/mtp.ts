// libmtp binding (koffi) for the handheld in MTP mode: lists folders, downloads and uploads files,
// creates folders, deletes objects and reads what the device reports about itself.
// macOS has no built-in MTP support; install the library with: brew install libmtp
// Slow calls run on koffi's worker threads so the server keeps answering during transfers.

import fsp from "node:fs/promises";
import path from "node:path";
import koffi from "koffi";
import { Cancelled, UserError } from "../errors.ts";
import { platform } from "../platform/index.ts";
import { MUSTARD_VENDOR } from "../platform/types.ts";
import type { DeviceFs, Entry, Progress } from "./fs.ts";
import { restartMtpService } from "./ssh.ts";

export class MtpError extends UserError {}
class Busy extends Error {}

const ROOT = 0xffffffff;
const FOLDER = 0;
const PNG = 20;
const UNKNOWN = 44;
const FORCE_RESET_ON_CLOSE = 0x10000000;
const IDLE_MS = 90_000;
const NOT_ALLOWED = "Your computer has not finished connecting the handheld. On a Mac click Allow on the \"Allow "
  + "accessory to connect\" prompt, or unplug and reconnect the cable. Without a prompt, check System Settings > "
  + "Privacy & Security > Allow accessories to connect.";

export interface StorageInfo {
  id: number;
  name: string;
  free: number;
  total: number;
}

export interface Identity {
  model?: string;
  manufacturer?: string;
  version?: string;
  serial?: string;
  battery?: number;
}

type Fn = koffi.KoffiFunction;

interface Lib {
  types: { DeviceEntry: koffi.IKoffiCType; PtpUsb: koffi.IKoffiCType; RawDevice: koffi.IKoffiCType; Storage: koffi.IKoffiCType; ErrorT: koffi.IKoffiCType; DevicePrefix: koffi.IKoffiCType; File: koffi.IKoffiCType; Progress: koffi.IKoffiCType };
  Detect: Fn; Open: Fn; Release: Fn; GetStorage: Fn; Files: Fn; DestroyFile: Fn; GetFile: Fn; SendFile: Fn;
  Metadata: Fn; CreateFolder: Fn; Delete: Fn; Battery: Fn; Clear: Fn; Errors: Fn; free: Fn;
  identity: Record<keyof Omit<Identity, "battery">, Fn>;
}

let lib: Lib | null | undefined;

export function library(): Lib | null {
  if (lib !== undefined) return lib;
  let handle: koffi.IKoffiLib | null = null;
  for (const candidate of platform.libmtpPaths) {
    try {
      handle = koffi.load(candidate);
      break;
    } catch {
      continue;
    }
  }
  if (!handle) return (lib = null);
  const libc = koffi.load(process.platform === "win32" ? "msvcrt.dll" : null);

  const DeviceEntry = koffi.struct("LIBMTP_device_entry_t", {
    vendor: "char *", vendor_id: "uint16_t", product: "char *", product_id: "uint16_t", device_flags: "uint32_t",
  });
  const RawDevice = koffi.struct("LIBMTP_raw_device_t", { device_entry: DeviceEntry, bus_location: "uint32_t", devnum: "uint8_t" });
  const Storage = koffi.struct("LIBMTP_devicestorage_t", {
    id: "uint32_t", StorageType: "uint16_t", FilesystemType: "uint16_t", AccessCapability: "uint16_t",
    MaxCapacity: "uint64_t", FreeSpaceInBytes: "uint64_t", FreeSpaceInObjects: "uint64_t",
    StorageDescription: "char *", VolumeIdentifier: "char *", next: "void *", prev: "void *",
  });
  const ErrorT = koffi.struct("LIBMTP_error_t", { errornumber: "int", error_text: "char *", next: "void *" });
  // Only the leading fields of LIBMTP_mtpdevice_t are read.
  const DevicePrefix = koffi.struct("LIBMTP_mtpdevice_prefix_t", {
    object_bitsize: "uint8_t", params: "void *", usbinfo: "void *", storage: "void *",
  });
  const File = koffi.struct("LIBMTP_file_t", {
    item_id: "uint32_t", parent_id: "uint32_t", storage_id: "uint32_t", filename: "char *", filesize: "uint64_t",
    modificationdate: process.platform === "win32" ? "int64_t" : "long", filetype: "int", next: "void *",
  });
  const Progress = koffi.proto("int LIBMTP_progressfunc_t(uint64_t sent, uint64_t total, void *data)");
  // libmtp's private PTP_USB (libusb-glue.h, libusb 1 build), only to reach rawdevice.device_entry.device_flags.
  const PtpUsb = koffi.struct("PTP_USB_prefix_t", {
    params: "void *", handle: "void *", config: "uint8_t", interface: "uint8_t", altsetting: "uint8_t",
    inep: "int", inep_maxpacket: "int", outep: "int", outep_maxpacket: "int", intep: "int", callback_active: "int", timeout: "int",
    bcdusb: "uint16_t", current_transfer_total: "uint64_t", current_transfer_complete: "uint64_t",
    current_transfer_callback: "void *", current_transfer_callback_data: "void *", rawdevice: RawDevice,
  });

  const f = (sig: string) => handle.func(sig);
  lib = {
    types: { DeviceEntry, PtpUsb, RawDevice, Storage, ErrorT, DevicePrefix, File, Progress },
    Detect: f("int LIBMTP_Detect_Raw_Devices(_Out_ void **devices, _Out_ int *count)"),
    Open: f("void *LIBMTP_Open_Raw_Device_Uncached(void *raw)"),
    Release: f("void LIBMTP_Release_Device(void *device)"),
    GetStorage: f("int LIBMTP_Get_Storage(void *device, int sortby)"),
    Files: f("void *LIBMTP_Get_Files_And_Folders(void *device, uint32_t storage, uint32_t parent)"),
    DestroyFile: f("void LIBMTP_destroy_file_t(void *file)"),
    GetFile: f("int LIBMTP_Get_File_To_File(void *device, uint32_t id, const char *path, void *callback, void *data)"),
    SendFile: f("int LIBMTP_Send_File_From_File(void *device, const char *path, _Inout_ LIBMTP_file_t *filedata, LIBMTP_progressfunc_t *callback, void *data)"),
    Metadata: f("void *LIBMTP_Get_Filemetadata(void *device, uint32_t id)"),
    CreateFolder: f("uint32_t LIBMTP_Create_Folder(void *device, char *name, uint32_t parent, uint32_t storage)"),
    Delete: f("int LIBMTP_Delete_Object(void *device, uint32_t id)"),
    Battery: f("int LIBMTP_Get_Batterylevel(void *device, _Out_ uint8_t *max, _Out_ uint8_t *current)"),
    Clear: f("void LIBMTP_Clear_Errorstack(void *device)"),
    Errors: f("void *LIBMTP_Get_Errorstack(void *device)"),
    free: libc.func("void free(void *ptr)"),
    identity: {
      model: f("void *LIBMTP_Get_Modelname(void *device)"),
      manufacturer: f("void *LIBMTP_Get_Manufacturername(void *device)"),
      version: f("void *LIBMTP_Get_Deviceversion(void *device)"),
      serial: f("void *LIBMTP_Get_Serialnumber(void *device)"),
    },
  };
  f("void LIBMTP_Init()")();
  return lib;
}

function call<T>(fn: Fn, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    fn.async(...args, (error: unknown, result: T) => (error ? reject(error) : resolve(result)));
  });
}

// ---------------------------------------------------------------- shared session

let shared: Session | null = null;
let lastUsed = 0;
let locked = false;
const waiters: (() => void)[] = [];

async function acquire(waitMs: number): Promise<void> {
  if (!locked) {
    locked = true;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const wake = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      waiters.splice(waiters.indexOf(wake), 1);
      reject(new MtpError("The handheld is busy with another transfer. Try again when it finishes."));
    }, waitMs);
    waiters.push(wake);
  });
}

function release(): void {
  lastUsed = Date.now();
  const next = waiters.shift();
  if (next) next();
  else locked = false;
}

/** Runs fn with the shared MTP session, opened on first use and kept for 90 seconds of idle time.
 *  Calls are serialised; an MtpError drops the session so the next call reconnects. */
export async function withSession<T>(fn: (session: Session) => Promise<T>, waitMs = 20_000): Promise<T> {
  if (released) throw new UserError("The manager has let go of the handheld's USB connection. Press Connect in Overview to use it again.");
  await acquire(waitMs);
  try {
    if (!shared) {
      const session = new Session();
      try {
        await session.open();
      } catch (error) {
        session.close();
        throw error;
      }
      shared = session;
    }
    try {
      return await fn(shared);
    } catch (error) {
      if (error instanceof MtpError) {
        shared?.close();
        shared = null;
      }
      throw error;
    }
  } finally {
    release();
  }
}

export async function disconnect(): Promise<void> {
  await acquire(60_000).catch(() => {});
  try {
    shared?.close();
    shared = null;
  } finally {
    release();
  }
}

/** While released, no session is opened, so other apps (or a restarted manager) can use the handheld. */
let released = false;
export const usbReleased = (): boolean => released;

export async function releaseUsb(): Promise<void> {
  released = true;
  await disconnect();
}

export function allowUsb(): void {
  released = false;
}

const STUCK = "The handheld's USB file service stopped answering, which happens when an earlier connection ended badly. "
  + "Press Restart USB on handheld (needs Wi-Fi with SSH on), or restart the handheld.";
let lastAutoRestart = 0;

/** Restarts the handheld's MTP service over SSH and waits for the computer to see it again. */
async function restartHandheldMtp(): Promise<void> {
  await restartMtpService();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  for (let i = 0; i < 20 && !(await platform.findHandheld())?.ready; i++) await new Promise((resolve) => setTimeout(resolve, 500));
}

/** Drops the session and restarts the handheld's MTP service: the fix for a handheld that stopped answering on USB. */
export async function restartUsb(): Promise<void> {
  await disconnect();
  lastAutoRestart = Date.now();
  await restartHandheldMtp();
}

setInterval(() => {
  if (shared && !locked && Date.now() - lastUsed > IDLE_MS) {
    shared.close();
    shared = null;
  }
}, 15_000).unref();

// ---------------------------------------------------------------- session

export class Session {
  readonly lib: Lib;
  device: unknown = null;
  raw: unknown = null;
  rawCopy: unknown = null;
  /** Folder ids per storage, keyed by lower-cased path. */
  readonly ids = new Map<number, Map<string, number>>();
  /** Folder listings per storage, keyed by lower-cased path, then lower-cased name. */
  readonly files = new Map<number, Map<string, Map<string, Entry>>>();

  constructor() {
    const loaded = library();
    if (!loaded) throw new MtpError("libmtp is not installed. On a Mac run: brew install libmtp");
    this.lib = loaded;
  }

  close(): void {
    if (this.device) this.lib.Release(this.device);
    if (this.raw) this.lib.free(this.raw);
    if (this.rawCopy) koffi.free(this.rawCopy);
    this.device = this.raw = this.rawCopy = null;
  }

  async open(): Promise<void> {
    try {
      await this.openOnce();
      return;
    } catch (error) {
      if (!(error instanceof Busy)) throw error;
    }
    this.close();
    await platform.releaseMtp();
    try {
      await this.openOnce();
      return;
    } catch (again) {
      if (!(again instanceof Busy)) throw again;
    }
    this.close();
    const holders = (await platform.usbHolders?.()) ?? null;
    const others = holders?.filter((h) => h.pid !== process.pid) ?? [];
    if (others.length) {
      throw new MtpError(`${others.map((h) => `${h.name} (pid ${h.pid})`).join(", ")} has the handheld open. Quit it `
        + "(for another copy of the manager press Ctrl-C in its Terminal window), then press Reconnect.");
    }
    if (!holders) {
      throw new MtpError("The handheld is connected but another program is using it. Stop any other running copy of "
        + "the manager, and quit Android File Transfer, OpenMTP or Image Capture; if that does not help, restart the handheld.");
    }
    // Nothing else has it open, so the handheld's MTP service (umtprd) stopped answering. libmtp keeps the interface
    // it claimed for that failed attempt, so retrying here cannot work until the handheld comes back as a new device.
    if (Date.now() - lastAutoRestart > 5 * 60_000) {
      lastAutoRestart = Date.now();
      try {
        await restartHandheldMtp();
        await this.openOnce();
        return;
      } catch (error) {
        this.close();
        if (!(error instanceof Busy) && !(error instanceof UserError)) throw error;
      }
    }
    throw new MtpError(STUCK);
  }

  private async openOnce(): Promise<void> {
    const { RawDevice } = this.lib.types;
    const out: unknown[] = [null], count = [0];
    const error = await call<number>(this.lib.Detect, out, count);
    this.raw = out[0];
    if (error === 5 || count[0] === 0) {
      const handheld = await platform.findHandheld();
      if (handheld && !handheld.ready) throw new MtpError(NOT_ALLOWED);
      throw new MtpError("No MTP device found. On the handheld set Advanced Settings > USB Function to MTP.");
    }
    if (error !== 0) throw new MtpError(`libmtp could not scan USB devices (error ${error}).`);
    const devices = koffi.decode(this.raw, RawDevice, count[0]) as { device_entry: { vendor: string | null; vendor_id: number } }[];
    let pick = devices.findIndex((d) => d.device_entry.vendor_id === MUSTARD_VENDOR
      || (d.device_entry.vendor ?? "").toLowerCase().includes("mustard"));
    if (pick < 0 && devices.length === 1) pick = 0;
    if (pick < 0) throw new MtpError("Several MTP devices are connected and none is the MustardOS handheld.");
    let target = this.raw;
    if (pick > 0) {
      const size = koffi.sizeof(RawDevice);
      this.rawCopy = koffi.alloc("uint8_t", size);
      new Uint8Array(koffi.view(this.rawCopy, size)).set(new Uint8Array(koffi.view(this.raw, size * (pick + 1)), size * pick, size));
      target = this.rawCopy;
    }
    this.device = await call(this.lib.Open, target);
    if (!this.device) throw new Busy();
    this.keepUsbOnClose();
    if ((await call<number>(this.lib.GetStorage, this.device, 0)) !== 0) {
      this.lib.Clear(this.device);
      throw new MtpError("The handheld did not report its storage.");
    }
  }

  /** libmtp gives devices that look like Android its Android bug flags, among them a USB reset when the session closes.
   *  umtprd on the handheld never recovers from that reset: every later session fails until umtprd restarts. So the flag
   *  is cleared, after checking that the bytes really are this handheld's device entry. */
  private keepUsbOnClose(): void {
    const { DeviceEntry, DevicePrefix, PtpUsb, RawDevice } = this.lib.types;
    const usbinfo = (koffi.decode(this.device, DevicePrefix) as { usbinfo: unknown }).usbinfo;
    if (!usbinfo) return;
    const view = new DataView(koffi.view(usbinfo, koffi.sizeof(PtpUsb)));
    const entry = koffi.offsetof(PtpUsb, "rawdevice") + koffi.offsetof(RawDevice, "device_entry");
    const at = (field: string) => entry + koffi.offsetof(DeviceEntry, field);
    if (view.getUint16(at("vendor_id"), true) !== MUSTARD_VENDOR) return;
    const flags = view.getUint32(at("device_flags"), true);
    if (flags & FORCE_RESET_ON_CLOSE) view.setUint32(at("device_flags"), (flags & ~FORCE_RESET_ON_CLOSE) >>> 0, true);
  }

  /** What the handheld reports about itself; MustardOS puts its version in the device version. */
  async identity(): Promise<Identity> {
    const found: Identity = {};
    for (const [key, fn] of Object.entries(this.lib.identity) as [keyof Omit<Identity, "battery">, Fn][]) {
      const pointer = await call(fn, this.device);
      if (pointer) {
        found[key] = String(koffi.decode(pointer, "char", -1)).trim();
        this.lib.free(pointer);
      }
    }
    // umtprd answers 0 when it has no battery reading, so 0 counts as unknown.
    const top = [0], now = [0];
    if ((await call<number>(this.lib.Battery, this.device, top, now)) === 0 && top[0] && now[0]) {
      found.battery = Math.round((now[0] * 100) / top[0]);
    }
    this.lib.Clear(this.device);
    return found;
  }

  storages(): StorageInfo[] {
    const { DevicePrefix, Storage } = this.lib.types;
    const found: StorageInfo[] = [];
    let node = (koffi.decode(this.device, DevicePrefix) as { storage: unknown }).storage;
    while (node) {
      const s = koffi.decode(node, Storage) as { id: number; StorageDescription: string | null; VolumeIdentifier: string | null; FreeSpaceInBytes: number | bigint; MaxCapacity: number | bigint; next: unknown };
      found.push({ id: s.id, name: s.StorageDescription || s.VolumeIdentifier || "Storage", free: Number(s.FreeSpaceInBytes), total: Number(s.MaxCapacity) });
      node = s.next;
    }
    return found;
  }

  lastError(): string {
    const { ErrorT } = this.lib.types;
    const texts: string[] = [];
    let node = this.lib.Errors(this.device);
    while (node) {
      const e = koffi.decode(node, ErrorT) as { error_text: string | null; next: unknown };
      if (e.error_text?.trim()) texts.push(e.error_text.trim());
      node = e.next;
    }
    this.lib.Clear(this.device);
    return texts.join("; ");
  }

  async listdir(storage: number, parent = ROOT): Promise<Entry[]> {
    const { File } = this.lib.types;
    const head = await call(this.lib.Files, this.device, storage, parent);
    if (!head) {
      const error = this.lastError();
      if (error) throw new MtpError(`Reading the handheld failed (${error}). Unplug and reconnect the cable, then try again.`);
      return [];
    }
    const entries: Entry[] = [];
    let node: unknown = head;
    while (node) {
      const f = koffi.decode(node, File) as { item_id: number; filename: string | null; filesize: number | bigint; modificationdate: number | bigint; filetype: number; next: unknown };
      entries.push({ id: f.item_id, name: f.filename ?? "", size: Number(f.filesize), mtime: Number(f.modificationdate), folder: f.filetype === FOLDER });
      const next = f.next;
      this.lib.DestroyFile(node);
      node = next;
    }
    this.lib.Clear(this.device);
    return entries;
  }

  async download(id: number, dest: string): Promise<void> {
    if ((await call<number>(this.lib.GetFile, this.device, id, dest, null, null)) !== 0) {
      this.lib.Clear(this.device);
      throw new MtpError(`Could not read ${path.basename(dest)} from the handheld.`);
    }
  }

  async sizeOf(id: number): Promise<number | null> {
    const node = await call(this.lib.Metadata, this.device, id);
    if (!node) {
      this.lib.Clear(this.device);
      return null;
    }
    const size = Number((koffi.decode(node, this.lib.types.File) as { filesize: number | bigint }).filesize);
    this.lib.DestroyFile(node);
    return size;
  }

  async mkdir(storage: number, parent: number, name: string): Promise<number> {
    const folder = await call<number>(this.lib.CreateFolder, this.device, name, parent === ROOT ? 0 : parent, storage);
    if (!folder) {
      const error = this.lastError();
      throw new MtpError(`Could not create the folder ${name} on the handheld${error ? ` (${error})` : ""}.`);
    }
    return folder;
  }

  async delete(id: number): Promise<void> {
    if ((await call<number>(this.lib.Delete, this.device, id)) !== 0) {
      const error = this.lastError();
      throw new MtpError(`Could not delete a file on the handheld${error ? ` (${error})` : ""}.`);
    }
  }

  /** Sends a local file into a folder and returns the new object id. progress(sent) returning true cancels,
   *  which removes the partial upload and throws Cancelled. */
  async upload(src: string, storage: number, parent: number, name: string, progress?: Progress): Promise<number> {
    const size = (await fsp.stat(src)).size;
    const meta = {
      item_id: 0, parent_id: parent === ROOT ? 0 : parent, storage_id: storage, filename: name, filesize: size,
      modificationdate: 0, filetype: name.toLowerCase().endsWith(".png") ? PNG : UNKNOWN, next: null,
    };
    let stopped = false;
    const callback = koffi.register((sent: number | bigint) => {
      if (progress?.(Number(sent))) {
        stopped = true;
        return 1;
      }
      return 0;
    }, koffi.pointer(this.lib.types.Progress));
    let error = "";
    try {
      const result = await call<number>(this.lib.SendFile, this.device, src, meta, callback, null);
      if (result === 0 && !stopped) {
        if ((await this.sizeOf(meta.item_id)) === size) return meta.item_id;
        error = `${name} arrived incomplete`;
      } else {
        error = this.lastError() || "transfer interrupted";
      }
    } finally {
      koffi.unregister(callback);
    }
    if (meta.item_id) await this.delete(meta.item_id).catch(() => {});
    this.lib.Clear(this.device);
    if (stopped) throw new Cancelled();
    throw new MtpError(`Could not send ${name} to the handheld (${error}).`);
  }
}

// ---------------------------------------------------------------- one storage as a DeviceFs

const keyOf = (parts: string[]) => parts.map((p) => p.toLowerCase()).join("/");

/** Files on one storage of the handheld, addressed by path parts. Folder ids and listings are cached on the session. */
export class MtpFs implements DeviceFs {
  readonly remote = true;
  readonly session: Session;
  readonly storage: StorageInfo;
  private readonly ids: Map<string, number>;
  private readonly cache: Map<string, Map<string, Entry>>;

  constructor(session: Session, storage: StorageInfo) {
    this.session = session;
    this.storage = storage;
    if (!session.ids.has(storage.id)) session.ids.set(storage.id, new Map([["", ROOT]]));
    if (!session.files.has(storage.id)) session.files.set(storage.id, new Map());
    this.ids = session.ids.get(storage.id)!;
    this.cache = session.files.get(storage.id)!;
  }

  private remember(key: string, entries: Entry[]): void {
    this.cache.set(key, new Map(entries.map((e) => [e.name.toLowerCase(), e])));
    for (const e of entries) {
      if (e.folder) this.ids.set(key ? `${key}/${e.name.toLowerCase()}` : e.name.toLowerCase(), e.id!);
    }
  }

  private async folder(parts: string[]): Promise<number | null> {
    let key = "";
    for (const part of parts) {
      const child = key ? `${key}/${part.toLowerCase()}` : part.toLowerCase();
      if (!this.ids.has(child)) {
        if (this.cache.has(key)) return null;
        this.remember(key, await this.session.listdir(this.storage.id, this.ids.get(key)!));
        if (!this.ids.has(child)) return null;
      }
      key = child;
    }
    return this.ids.get(key)!;
  }

  async list(parts: string[]): Promise<Entry[] | null> {
    const folder = await this.folder(parts);
    if (folder === null) return null;
    const entries = await this.session.listdir(this.storage.id, folder);
    this.remember(keyOf(parts), entries);
    return entries.filter((e) => !e.name.startsWith("."));
  }

  async hasDir(parts: string[]): Promise<boolean> {
    return (await this.folder(parts)) !== null;
  }

  async entry(parts: string[]): Promise<Entry | null> {
    const key = keyOf(parts.slice(0, -1));
    if (!this.cache.has(key) && (await this.list(parts.slice(0, -1))) === null) return null;
    const found = this.cache.get(key)?.get(parts[parts.length - 1].toLowerCase());
    return found && !found.folder ? found : null;
  }

  private async mkdirs(parts: string[]): Promise<number> {
    let key = "";
    for (let i = 0; i < parts.length; i++) {
      const child = key ? `${key}/${parts[i].toLowerCase()}` : parts[i].toLowerCase();
      if ((await this.folder(parts.slice(0, i + 1))) === null) {
        this.ids.set(child, await this.session.mkdir(this.storage.id, this.ids.get(key)!, parts[i]));
        this.cache.delete(key);
        this.cache.set(child, new Map());
      }
      key = child;
    }
    return this.ids.get(key)!;
  }

  async mkdir(parts: string[]): Promise<void> {
    await this.mkdirs(parts);
  }

  async removeDir(parts: string[]): Promise<void> {
    const id = await this.folder(parts);
    if (id === null || !parts.length) throw new UserError(`${parts[parts.length - 1] ?? "That folder"} is not on the handheld.`);
    await this.session.delete(id);
    const key = keyOf(parts);
    for (const k of [...this.ids.keys()]) if (k === key || k.startsWith(key + "/")) this.ids.delete(k);
    for (const k of [...this.cache.keys()]) if (k === key || k.startsWith(key + "/")) this.cache.delete(k);
    this.cache.get(keyOf(parts.slice(0, -1)))?.delete(parts[parts.length - 1].toLowerCase());
  }

  async get(parts: string[], dest: string): Promise<void> {
    const found = await this.entry(parts);
    if (!found) throw new UserError(`${parts[parts.length - 1]} is no longer on the handheld.`);
    await this.session.download(found.id!, dest);
  }

  async delete(parts: string[]): Promise<void> {
    const found = await this.entry(parts);
    if (!found) throw new UserError(`${parts[parts.length - 1]} is not on the handheld.`);
    await this.session.delete(found.id!);
    this.cache.get(keyOf(parts.slice(0, -1)))?.delete(parts[parts.length - 1].toLowerCase());
  }

  async put(src: string, parts: string[], progress: Progress): Promise<void> {
    const parent = await this.mkdirs(parts.slice(0, -1));
    if (await this.entry(parts)) await this.delete(parts);
    const name = parts[parts.length - 1];
    const id = await this.session.upload(src, this.storage.id, parent, name, progress);
    const key = keyOf(parts.slice(0, -1));
    if (!this.cache.has(key)) this.cache.set(key, new Map());
    this.cache.get(key)!.set(name.toLowerCase(), { id, name, size: (await fsp.stat(src)).size, mtime: Date.now() / 1000, folder: false });
  }
}
