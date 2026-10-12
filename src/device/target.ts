// Which device the manager talks to: the TF2 card in the computer's card reader, or the handheld over USB (MTP).

import fsp from "node:fs/promises";
import path from "node:path";
import { CATALOGUE_PATH, EMPTY_OVER_USB, ROMS_DIR, USB_ID, WIFI_ID } from "../catalogue.ts";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { platform, type Handheld, type Volume } from "../platform/index.ts";
import { isDir } from "../util.ts";
import { CardFs, type DeviceFs } from "./fs.ts";
import { deviceFor } from "../../public/js/devices.js";
import { usbModel, wifiModelName } from "./model.ts";
import { library, MtpFs, usbReleased, withSession, type Session, type StorageInfo } from "./mtp.ts";
import { SftpFs, wifiSettings, withSftp, type SftpStorage } from "./sftp.ts";

export interface Card extends Volume {
  free: number;
  total: number;
  catalogue: boolean;
}

export interface TargetInfo {
  id: string;
  mode: "card" | "usb" | "wifi";
  name: string;
  kind: string;
  /** Where ROMs go: "TF2" or "SD1" (a handheld without a TF2 card). */
  storage: string;
  free: number;
  total: number;
  /** Where MustardOS reads artwork from: "TF2", "SD1" or "" for no catalogue. */
  art: string;
  catalogue: boolean;
  fs?: Volume["fs"];
  disk?: string;
  mount?: string;
}

export interface Target {
  info: TargetInfo;
  roms: DeviceFs;
  /** Artwork catalogues, the one MustardOS uses first. */
  arts: [string, DeviceFs][];
  /** Every storage that can be read, by label ("TF2", "SD1"). */
  all: [string, DeviceFs][];
  /** The MTP session, over USB only. */
  session: Session | null;
  storages: StorageInfo[];
  /** "TF2" or the handheld's name, for messages. */
  name: string;
}

export const art = (t: Target): DeviceFs | null => t.arts[0]?.[1] ?? null;

const cards = new Map<string, Card>();
export const handheldState = { name: "Handheld" };

async function usage(mount: string): Promise<{ free: number; total: number }> {
  const st = await fsp.statfs(mount);
  return { free: st.bavail * st.bsize, total: st.blocks * st.bsize };
}

export async function findCards(): Promise<{ cards: Card[]; rejects: string[] }> {
  let found: Card[] = [], rejects: string[] = [];
  if (ctx.tf2Dir) {
    found = [{
      id: "folder", disk: "", name: path.basename(ctx.tf2Dir), fs: "exfat", kind: "Folder (test)", mount: ctx.tf2Dir,
      ...(await usage(ctx.tf2Dir)), catalogue: await isDir(path.join(ctx.tf2Dir, ...CATALOGUE_PATH)),
    }];
  } else {
    const scan = await platform.removableVolumes();
    rejects = scan.rejects;
    for (const volume of scan.volumes) {
      const missing = [];
      for (const dir of ["ROMS", "ARCHIVE"]) if (!(await isDir(path.join(volume.mount, dir)))) missing.push(dir);
      if (missing.length) {
        rejects.push(`${volume.id} ${path.basename(volume.mount)} is missing ${missing.join(" ")}`);
        continue;
      }
      found.push({ ...volume, ...(await usage(volume.mount)), catalogue: await isDir(path.join(volume.mount, ...CATALOGUE_PATH)) });
    }
  }
  cards.clear();
  for (const card of found) cards.set(card.id, card);
  return { cards: found, rejects };
}

export async function cardFor(id: string): Promise<Card> {
  let card = cards.get(id);
  if (!card || !(await isDir(path.join(card.mount, "ROMS")))) card = (await findCards()).cards.find((c) => c.id === id);
  if (!card) throw new UserError("The TF2 card is no longer connected. Check again.");
  Object.assign(card, await usage(card.mount), { catalogue: await isDir(path.join(card.mount, ...CATALOGUE_PATH)) });
  return { ...card };
}

export async function handheldStatus(): Promise<Handheld | null> {
  const handheld = await platform.findHandheld();
  if (handheld) {
    handheld.libmtp = library() !== null;
    handheld.released = usbReleased();
    const known = usbModel(handheld.name);
    handheld.model = known?.id ?? "";
    if (known) handheld.name = deviceFor(known.board)!.name;
    handheldState.name = handheld.name;
  }
  return handheld;
}

const storageLabel = (name: string) => (name.toUpperCase() === "SD2" ? "TF2" : name.toUpperCase());

/** The handheld's name over Wi-Fi: its board config once read, else the USB name if it was seen. */
const wifiName = () => wifiModelName() || handheldState.name;

/** Runs fn with the device behind a volume id: a card id, "usb" for the handheld over MTP, or "wifi" for SFTP. */
export async function withTarget<T>(volume: string, fn: (t: Target) => Promise<T>): Promise<T> {
  if (volume === WIFI_ID) {
    return withSftp(async (session) => {
      const named = new Map(session.storages.map((s) => [s.name, s]));
      const romStorage = named.get("SD2") ?? named.get("SD1") ?? session.storages[0];
      const fsOf = (s: SftpStorage) => new SftpFs(session.sftp, s.root);
      const arts: [string, DeviceFs][] = [];
      for (const name of ["SD2", "SD1"]) {
        const storage = named.get(name);
        if (storage && (await fsOf(storage).hasDir(CATALOGUE_PATH))) arts.push([storageLabel(name), fsOf(storage)]);
      }
      const name = wifiName();
      const host = (await wifiSettings()).host;
      const info: TargetInfo = {
        id: WIFI_ID, mode: "wifi", name, kind: `${name} over Wi-Fi (SFTP, ${host})`,
        storage: storageLabel(romStorage.name), free: romStorage.free, total: romStorage.total,
        art: arts[0]?.[0] ?? "", catalogue: arts.length > 0,
      };
      return fn({
        info, roms: fsOf(romStorage), arts, all: session.storages.map((s) => [storageLabel(s.name), fsOf(s)]), session: null,
        storages: session.storages.map((s, i) => ({ id: i, name: s.name, free: s.free, total: s.total })), name,
      });
    });
  }
  if (volume !== USB_ID) {
    const card = await cardFor(volume);
    const fs = new CardFs(card.mount);
    const info: TargetInfo = { ...card, mode: "card", storage: "TF2", art: card.catalogue ? "TF2" : "" };
    return fn({ info, roms: fs, arts: card.catalogue ? [["TF2", fs]] : [], all: [["TF2", fs]], session: null, storages: [], name: "TF2" });
  }
  return withSession(async (session) => {
    const storages = session.storages();
    const named = new Map(storages.map((s) => [s.name.toUpperCase(), s]));
    const romStorage = named.get("SD2") ?? named.get("SD1") ?? storages[0];
    if (!romStorage) throw new UserError("The handheld did not report any storage.");
    if (named.has("SD1") && !(await new MtpFs(session, named.get("SD1")!).hasDir(["MUOS"]))) throw new UserError(EMPTY_OVER_USB);
    const arts: [string, DeviceFs][] = [];
    for (const [name, label] of [["SD2", "TF2"], ["SD1", "SD1"]]) {
      const storage = named.get(name);
      if (!storage) continue;
      const fs = new MtpFs(session, storage);
      if (await fs.hasDir(CATALOGUE_PATH)) arts.push([label, fs]);
    }
    const name = handheldState.name;
    const info: TargetInfo = {
      id: USB_ID, mode: "usb", name, kind: `${name} over USB (MTP)`,
      storage: romStorage === named.get("SD2") ? "TF2" : "SD1", free: romStorage.free, total: romStorage.total,
      art: arts[0]?.[0] ?? "", catalogue: arts.length > 0,
    };
    const all: [string, DeviceFs][] = storages.map((s) => [storageLabel(s.name), new MtpFs(session, s)]);
    return fn({ info, roms: new MtpFs(session, romStorage), arts, all, session, storages, name });
  });
}

export async function hasRomsFolder(t: Target): Promise<boolean> {
  return t.roms.hasDir([ROMS_DIR]);
}
