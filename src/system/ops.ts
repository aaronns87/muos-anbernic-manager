// System section jobs: install MustardOS, set up a TF2 card, reset a card. One at a time, never during a transfer.

import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { locks, requireIdle } from "../jobs.ts";
import { say } from "../log.ts";
import { busyDisks } from "../platform/types.ts";
import { run } from "../platform/run.ts";
import { dict, list, parsePlist, str } from "../platform/plist.ts";
import { isFile } from "../util.ts";
import { requireCard, type SystemCard } from "./cards.ts";
import { Cancelled, fullCheck, inspectImage, isSha256, normalizeHash, type ImageInfo } from "./image.ts";
import { resetTf2OverWifi, setupTf2OverWifi, wifiTf2Card, wifiTf2Confirm, wifiTf2Status } from "./tf2-wifi.ts";

export { wifiTf2Status };

type Op = "install" | "tf2" | "reset";
type StageState = "wait" | "run" | "done" | "fail" | "skip";

interface Stage {
  id: string;
  label: string;
  state: StageState;
  done: number;
  total: number;
  detail: string;
  started: number;
  finished: number;
}

/** Folders MustardOS reads on TF2, as scripts/setup-tf2.sh creates them. */
const TF2_SYSTEMS = [
  "A2600", "A5200", "A7800", "A800", "AMIGA", "ATARIST", "ATOMISWAVE", "C64", "CPS1", "CPS2", "CPS3", "DOS", "DREAMCAST", "EASYRPG", "FBNEO", "FC", "FDS",
  "GB", "GBA", "GBC", "GG", "GW", "HBMAME", "JAVA", "LYNX", "MAME", "MD", "MDCD", "MSX", "N64", "NAOMI", "NDS", "NEOCD", "NEOGEO", "NGP", "ONS", "OPENBOR",
  "PCE", "PCECD", "PGM2", "PICO", "POKE", "PORTS", "PS", "PSP", "SATURN", "SCUMMVM", "SEGA32X", "SFC", "SMS", "VARCADE", "VB", "VIC20", "WS",
];
export const TF2_TOP = ["ARCHIVE", "BACKUP", "ports", "ROMS"];
export const tf2Systems = () => TF2_SYSTEMS;

class SystemJob {
  op: Op;
  card: SystemCard;
  title: string;
  stages: Stage[];
  state: "running" | "done" | "failed" | "cancelled" = "running";
  error = "";
  result: Record<string, unknown> = {};
  started = Date.now();
  finished = 0;
  cancelled = false;
  onCancel: () => void = () => {};

  constructor(op: Op, card: SystemCard, title: string, stages: [string, string][]) {
    this.op = op;
    this.card = card;
    this.title = title;
    this.stages = stages.map(([id, label]) => ({ id, label, state: "wait", done: 0, total: 0, detail: "", started: 0, finished: 0 }));
  }

  stage(id: string): Stage {
    const s = this.stages.find((x) => x.id === id);
    if (!s) throw new Error(`No stage ${id}`);
    return s;
  }

  begin(id: string, detail = "", total = 0): Stage {
    if (this.cancelled) throw new Cancelled();
    const s = this.stage(id);
    Object.assign(s, { state: "run", detail, total, done: 0, started: Date.now() });
    return s;
  }

  end(id: string, detail?: string): void {
    const s = this.stage(id);
    s.state = "done";
    s.finished = Date.now();
    if (s.total) s.done = s.total;
    if (detail !== undefined) s.detail = detail;
  }

  snapshot() {
    return {
      op: this.op, disk: this.card.id, media: this.card.media, size: this.card.size, title: this.title, state: this.state, error: this.error,
      result: this.result, started: this.started, finished: this.finished,
      stages: this.stages.map((s) => {
        const elapsed = ((s.finished || Date.now()) - s.started) / 1000;
        const speed = s.state === "run" && s.total && elapsed > 1 ? s.done / elapsed : 0;
        return { ...s, speed, eta: speed ? (s.total - s.done) / speed : 0, elapsed: s.started ? elapsed : 0 };
      }),
    };
  }
}

let job: SystemJob | null = null;

export const systemJob = () => job?.snapshot() ?? null;

export function cancelSystemJob(): void {
  if (!job || job.state !== "running") return;
  job.cancelled = true;
  job.onCancel();
}

export function dismissSystemJob(): void {
  if (job && job.state !== "running") job = null;
}

function validName(name: string, fs: "FAT32" | "ExFAT"): string {
  const clean = name.trim().toUpperCase();
  const max = fs === "FAT32" ? 11 : 15;
  if (!clean) throw new UserError("Give the card a name.");
  if (clean.length > max) throw new UserError(`${fs} names stop at ${max} characters.`);
  if (!/^[A-Z0-9_-][A-Z0-9 _-]*$/.test(clean)) throw new UserError("Use letters, numbers, spaces, _ or - in the name.");
  return clean;
}

export async function startSystemJob(body: Record<string, unknown>) {
  requireIdle("Wait for the current transfer to finish first.");
  if (job?.state === "running") throw new UserError("Another card job is running.");
  const op = String(body.op ?? "") as Op;
  if (!["install", "tf2", "reset"].includes(op)) throw new UserError("Unknown card job.");
  const viaWifi = (op === "tf2" || op === "reset") && body.via === "wifi";
  if (!viaWifi && process.platform !== "darwin") throw new UserError("Card tools need macOS for now.");

  let card: SystemCard;
  let work: (j: SystemJob) => Promise<void>;
  let next: SystemJob;

  if (viaWifi) {
    if (String(body.confirm ?? "").trim() !== wifiTf2Confirm) throw new UserError(`Type ${wifiTf2Confirm} to confirm.`);
    const info = await wifiTf2Status(true);
    if (!info.ready) throw new UserError(info.reason || "TF2 is not ready over Wi-Fi.");
    card = wifiTf2Card(info);
    if (op === "tf2") {
      next = new SystemJob(op, card, "Set up TF2 over Wi-Fi", [["erase", "Erase"], ["mount", "Mount"], ["folders", "Create folders"]]);
      const folders = [...TF2_TOP, ...TF2_SYSTEMS.map((s) => `ROMS/${s}`)];
      work = (j) => setupTf2OverWifi(j, info, folders, TF2_SYSTEMS.length);
    } else {
      const fs = body.fs === "ExFAT" ? "ExFAT" as const : "FAT32" as const;
      const name = validName(String(body.name ?? "TF2"), fs);
      next = new SystemJob(op, card, `Reset TF2 over Wi-Fi to ${fs === "FAT32" ? "FAT32" : "exFAT"} "${name}"`, [["erase", "Erase"], ["mount", "Mount"]]);
      work = (j) => resetTf2OverWifi(j, info, fs, name);
    }
  } else {
    card = await requireCard(String(body.disk ?? ""));
    if (String(body.confirm ?? "").trim() !== card.id) throw new UserError(`Type ${card.id} to confirm.`);
    if (op === "install") {
      const image = await inspectImage(String(body.image ?? ""));
      if (image.bytes > card.size) throw new UserError(`The image unpacks to ${(image.bytes / 1e9).toFixed(1)} GB and ${card.id} holds ${(card.size / 1e9).toFixed(1)} GB.`);
      let expected = normalizeHash(String(body.hash ?? "")), source = String(body.hashSource ?? "") || "the checksum you entered";
      if (expected && !isSha256(expected)) throw new UserError("The checksum must be a 64 character SHA256.");
      if (!expected && image.hash) [expected, source] = [image.hash.value, image.hash.source];
      if (!expected && image.kind === "gz" && body.allowUnchecked !== true) throw new UserError("Add the SHA256 for this archive, or confirm installing without one.");
      next = new SystemJob(op, card, `Install ${image.name}`, [["check", "Check image"], ["auth", "Authorize"], ["write", "Write"], ["verify", "Verify"], ["eject", "Eject"]]);
      next.result = { image: image.name, bytes: image.bytes, hashSource: expected ? source : "" };
      work = (j) => install(j, image, expected, source);
    } else if (op === "tf2") {
      next = new SystemJob(op, card, "Set up TF2", [["erase", "Erase"], ["mount", "Mount"], ["folders", "Create folders"]]);
      work = (j) => setupTf2(j);
    } else {
      const fs = body.fs === "ExFAT" ? "ExFAT" : "FAT32";
      const name = validName(String(body.name ?? "SD_CARD"), fs);
      next = new SystemJob(op, card, `Reset to ${fs === "FAT32" ? "FAT32" : "exFAT"} "${name}"`, [["erase", "Erase"], ["mount", "Mount"]]);
      work = (j) => reset(j, fs, name);
    }
  }

  job = next;
  locks.system = `${next.title} on ${card.id} is running. Wait for it to finish.`;
  if (!viaWifi) busyDisks.add(card.id);
  say("yellow", "CARD", `${next.title} on ${card.id} (${card.media}).`);
  void (async () => {
    try {
      await work(next);
      next.state = "done";
      say("green", "CARD", `${next.title} on ${card.id} finished.`);
    } catch (error) {
      const running = next.stages.find((s) => s.state === "run");
      if (running) running.state = "fail";
      if (error instanceof Cancelled || next.cancelled) {
        next.state = "cancelled";
        next.error = error instanceof Cancelled ? "" : (error as Error).message;
      } else {
        next.state = "failed";
        next.error = (error as Error).message;
      }
      say("red", "CARD", `${next.title} on ${card.id}: ${next.error || "cancelled"}`);
    } finally {
      next.finished = Date.now();
      for (const s of next.stages) if (s.state === "wait") s.state = "skip";
      if (!viaWifi) busyDisks.delete(card.id);
      locks.system = "";
    }
  })();
  return next.snapshot();
}

// ---------------------------------------------------------------- erase and folders

const ERASE_STEPS: [RegExp, number, string][] = [
  [/Started erase/i, 5, "Starting"], [/Unmounting/i, 15, "Unmounting the card"], [/Creating the partition map/i, 35, "Writing a new MBR"],
  [/Waiting for partitions/i, 55, "Waiting for the partition"], [/Formatting/i, 70, "Formatting"], [/Mounting/i, 90, "Mounting"], [/Finished erase/i, 100, "Erased"],
];

async function erase(j: SystemJob, fs: "FAT32" | "ExFAT", name: string): Promise<void> {
  const s = j.begin("erase", "Starting", 100);
  await new Promise<void>((resolve, reject) => {
    const child = spawn("diskutil", ["eraseDisk", fs, name, "MBRFormat", `/dev/${j.card.id}`], { stdio: ["ignore", "pipe", "pipe"] });
    let errors = "";
    const take = (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        const hit = ERASE_STEPS.find(([re]) => re.test(line));
        if (hit) [s.done, s.detail] = [hit[1], hit[2]];
      }
    };
    child.stdout.on("data", take);
    child.stderr.on("data", (d: Buffer) => { errors += d.toString(); take(d); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new UserError(`diskutil could not erase ${j.card.id}: ${errors.trim().split("\n").pop() || `exit ${code}`}`)));
  });
  j.end("erase", `MBR with one ${fs === "FAT32" ? "FAT32" : "exFAT"} volume`);
}

/** The new volume on the card, mounted; its mount point. */
async function mountNew(j: SystemJob, want: string): Promise<string> {
  j.begin("mount", "Finding the new volume");
  const listing = dict(parsePlist((await run("diskutil", ["list", "-plist", `/dev/${j.card.id}`])).stdout));
  for (const part of list(dict(list(listing.AllDisksAndPartitions)[0]).Partitions)) {
    const id = str(dict(part).DeviceIdentifier);
    let info = dict(parsePlist((await run("diskutil", ["info", "-plist", id])).stdout));
    if (str(info.FilesystemType) !== want) continue;
    if (!str(info.MountPoint)) {
      await run("diskutil", ["mount", id]);
      info = dict(parsePlist((await run("diskutil", ["info", "-plist", id])).stdout));
    }
    const mount = str(info.MountPoint);
    if (!mount.startsWith("/Volumes/")) throw new UserError("The new volume did not mount.");
    j.end("mount", mount);
    return mount;
  }
  throw new UserError(`The ${want === "exfat" ? "exFAT" : "FAT32"} volume was not created.`);
}

async function setupTf2(j: SystemJob): Promise<void> {
  await erase(j, "ExFAT", "TF2");
  const mount = await mountNew(j, "exfat");
  const folders = [...TF2_TOP, ...TF2_SYSTEMS.map((s) => `ROMS/${s}`)];
  const s = j.begin("folders", "", folders.length);
  for (const folder of folders) {
    if (j.cancelled) throw new Cancelled();
    await fsp.mkdir(path.join(mount, folder), { recursive: true });
    s.done++;
    s.detail = folder;
  }
  j.end("folders", `${TF2_SYSTEMS.length} system folders in ROMS/`);
  j.result = { mount, systems: TF2_SYSTEMS.length };
}

async function reset(j: SystemJob, fs: "FAT32" | "ExFAT", name: string): Promise<void> {
  await erase(j, fs, name);
  j.result = { mount: await mountNew(j, fs === "FAT32" ? "msdos" : "exfat"), name };
}

// ---------------------------------------------------------------- install

const GUARD_SOURCE = () => path.join(ctx.root, "scripts", "lib", "mount-guard.swift");

/** The mount guard from scripts/lib, built once into the same cache the shell script uses. */
async function guardBinary(j: SystemJob): Promise<string> {
  const source = GUARD_SOURCE();
  if (!(await isFile(source))) throw new UserError("scripts/lib/mount-guard.swift is missing, so auto-mounts cannot be blocked during the write.");
  const digest = crypto.createHash("sha256").update(await fsp.readFile(source)).digest("hex").slice(0, 16);
  const dir = path.join(os.homedir(), "Library", "Caches", "anbernic-scripts");
  const bin = path.join(dir, `mount-guard-${digest}`);
  if (await isFile(bin)) return bin;
  j.stage("auth").detail = "Building the auto-mount guard";
  await fsp.mkdir(dir, { recursive: true });
  const built = await run("swiftc", ["-O", "-o", `${bin}.tmp`, source], 300_000);
  if (built.code !== 0) throw new UserError(built.code === -1 ? "swiftc is missing. Install the command line tools with: xcode-select --install" : "Could not build the mount guard.");
  await fsp.rename(`${bin}.tmp`, bin);
  return bin;
}

function startGuard(bin: string, disk: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [disk], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => { child.kill(); reject(new UserError("The mount guard did not start.")); }, 5000);
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      if (out.includes("ready")) { clearTimeout(timer); resolve(child); }
    });
    child.on("error", (e) => { clearTimeout(timer); reject(new UserError(`The mount guard did not start: ${e.message}`)); });
    child.on("exit", () => { clearTimeout(timer); reject(new UserError("The mount guard stopped before it was ready.")); });
  });
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const appleString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

async function install(j: SystemJob, image: ImageInfo, expected: string, source: string): Promise<void> {
  const check = j.begin("check", "Hashing and unpacking the image", image.fileSize);
  const { fileHash, payloadHash } = await fullCheck(image, (n) => { check.done = n; }, () => j.cancelled);
  if (expected && fileHash !== expected) throw new UserError(`The SHA256 does not match ${source}. The download is damaged or this is a different file. Expected ${expected.slice(0, 12)}…, got ${fileHash.slice(0, 12)}….`);
  j.end("check", expected ? `SHA256 matches ${source}` : "Structure OK. No checksum to compare.");
  j.result = { ...j.result, fileHash, verified: !!expected };

  const auth = j.begin("auth", "Waiting for your password");
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "muos-install-"));
  let guard: ChildProcess | null = null;
  try {
    guard = await startGuard(await guardBinary(j), j.card.id);
    auth.detail = "Waiting for your password";
    const progress = path.join(dir, "progress.jsonl"), cancel = path.join(dir, "cancel"), argsFile = path.join(dir, "args.json");
    await fsp.writeFile(progress, "");
    await fsp.writeFile(argsFile, JSON.stringify({
      image: image.path, kind: image.kind, bytes: image.bytes, payloadHash, disk: j.card.id, size: j.card.size, progress, cancel,
    }));
    const helper = path.join(ctx.managerDir, "src", "system", "flash-helper.ts");
    const command = `${shellQuote(process.execPath)} ${shellQuote(helper)} ${shellQuote(argsFile)} >> ${shellQuote(path.join(dir, "helper.log"))} 2>&1`;
    const prompt = `muOS Anbernic Manager needs your password to write MustardOS to ${j.card.id} (${j.card.media}).`;
    const osa = spawn("osascript", ["-e", "activate", "-e", `do shell script ${appleString(command)} with prompt ${appleString(prompt)} with administrator privileges`], { stdio: ["ignore", "pipe", "pipe"] });
    let osaErr = "", helperStarted = false;
    osa.stderr.on("data", (d: Buffer) => { osaErr += d.toString(); });
    j.onCancel = () => {
      void fsp.writeFile(cancel, "1").catch(() => {});
      if (!helperStarted) osa.kill();
    };
    const exited = new Promise<number>((resolve) => osa.on("close", (code) => resolve(code ?? 1)));

    let offset = 0, failure = "", finished = false;
    const pump = async () => {
      const text = await fsp.readFile(progress, "utf8");
      const fresh = text.slice(offset);
      const end = fresh.lastIndexOf("\n");
      if (end < 0) return;
      offset += end + 1;
      for (const line of fresh.slice(0, end).split("\n")) {
        let msg: { stage?: string; done?: number; total?: number; error?: string };
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.error) failure = msg.error;
        if (msg.stage === "write" || msg.stage === "verify") {
          helperStarted = true;
          if (j.stage("auth").state === "run") j.end("auth", "Administrator access granted");
          if (msg.stage === "verify" && j.stage("write").state === "run") j.end("write", "Every byte written");
          const s = j.stage(msg.stage);
          if (s.state !== "run") j.begin(msg.stage, msg.stage === "write" ? `Writing to /dev/r${j.card.id}` : "Reading the card back", msg.total ?? image.bytes);
          s.done = msg.done ?? 0;
        }
        if (msg.stage === "done") finished = true;
      }
    };
    const timer = setInterval(() => void pump().catch(() => {}), 300);
    const code = await exited;
    clearInterval(timer);
    await pump();
    if (!finished) {
      if (/-128|User cancel/i.test(osaErr)) throw new Cancelled();
      if (j.cancelled && !helperStarted) throw new Cancelled();
      throw new UserError(failure || osaErr.replace(/^.*execution error: /s, "").trim() || `The write stopped (exit ${code}).`);
    }
    j.end("verify", "Read-back SHA256 matches the image");
  } finally {
    guard?.kill();
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  j.begin("eject", `Ejecting ${j.card.id}`);
  const ejected = await run("diskutil", ["eject", `/dev/${j.card.id}`], 60_000);
  j.end("eject", ejected.code === 0 ? "Safe to remove" : "Could not eject. Eject it in Finder before removing it.");
}
