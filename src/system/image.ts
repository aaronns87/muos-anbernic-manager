// MustardOS disk images (.img or .img.gz): layout checks, SHA256 files, and the full pass before writing.
// Mirrors scripts/install-muos.sh: the image carries a protective MBR and a GPT with boot and rootfs.

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { CHUNK, isFile, listDir } from "../util.ts";

export class Cancelled extends Error {}

export interface ImageInfo {
  path: string;
  name: string;
  kind: "raw" | "gz";
  fileSize: number;
  /** Uncompressed length: the backup GPT's sector plus one, times 512. */
  bytes: number;
  backupLba: number;
  parts: { name: string; size: number }[];
  hash: { value: string; source: string } | null;
}

const SECTOR = 512;
const HASH = /^[0-9a-f]{64}$/;

export const normalizeHash = (text: string) => text.toLowerCase().replace(/\s+/g, "");
export const isSha256 = (text: string) => HASH.test(text);

function kindOf(file: string): ImageInfo["kind"] {
  const lower = file.toLowerCase();
  if (lower.endsWith(".img.gz") || lower.endsWith(".gz")) return "gz";
  if (lower.endsWith(".img")) return "raw";
  throw new UserError("Pick a MustardOS .img or .img.gz file.");
}

function checkHeader(blob: Buffer, expectLba: number, where: string): void {
  if (blob.length < 92 || blob.toString("latin1", 0, 8) !== "EFI PART") throw new UserError(`${where} GPT header is missing. This is not a MustardOS disk image.`);
  const size = blob.readUInt32LE(12);
  if (size < 92 || size > SECTOR) throw new UserError(`${where} GPT header size is not usable.`);
  const copy = Buffer.from(blob.subarray(0, size));
  const stored = copy.readUInt32LE(16);
  copy.writeUInt32LE(0, 16);
  if ((zlib.crc32(copy) >>> 0) !== stored) throw new UserError(`${where} GPT header checksum does not match.`);
  if (Number(blob.readBigUInt64LE(24)) !== expectLba) throw new UserError(`${where} GPT header is at the wrong sector.`);
}

/** Protective MBR, primary GPT and its partition entries from the first bytes of the image. */
function parseLayout(head: Buffer) {
  if (head.length < 2 * SECTOR || head[510] !== 0x55 || head[511] !== 0xaa) throw new UserError("The image has no MBR boot signature.");
  if (head[450] !== 0xee) throw new UserError("The image has no protective MBR, so it is not a MustardOS GPT image.");
  const gpt = head.subarray(SECTOR, 2 * SECTOR);
  checkHeader(gpt, 1, "Primary");
  const backupLba = Number(gpt.readBigUInt64LE(32));
  const entryLba = Number(gpt.readBigUInt64LE(72));
  const count = gpt.readUInt32LE(80), entSize = gpt.readUInt32LE(84), arrayCrc = gpt.readUInt32LE(88);
  if (count < 1 || count > 128 || entSize < 128 || entSize > 256 || entryLba < 2 || entryLba > 64) throw new UserError("The GPT partition table is not a plausible MustardOS layout.");
  if (backupLba < 64 || (backupLba + 1) * SECTOR > 64 * 1024 ** 3) throw new UserError("The backup GPT is outside a reasonable image size.");
  const start = entryLba * SECTOR, end = start + count * entSize;
  if (head.length < end) throw new UserError("The GPT partition entries are truncated.");
  const array = head.subarray(start, end);
  if ((zlib.crc32(array) >>> 0) !== arrayCrc) throw new UserError("The GPT partition checksum does not match.");
  const parts: ImageInfo["parts"] = [];
  for (let i = 0; i < count; i++) {
    const e = array.subarray(i * entSize, (i + 1) * entSize);
    if (e.subarray(0, 16).every((b) => b === 0)) continue;
    const first = Number(e.readBigUInt64LE(32)), last = Number(e.readBigUInt64LE(40));
    if (last < first) throw new UserError("A partition in the image ends before it starts.");
    const name = e.toString("utf16le", 56, 128).split("\0")[0].trim() || "-";
    parts.push({ name, size: (last - first + 1) * SECTOR });
  }
  if (!parts.length) throw new UserError("The image has no partitions.");
  const names = parts.map((p) => p.name.toLowerCase());
  if (!names.includes("boot") || !names.includes("rootfs")) throw new UserError("This image has no boot and rootfs partitions, so it does not look like MustardOS.");
  return { bytes: (backupLba + 1) * SECTOR, backupLba, parts };
}

/** The first `n` bytes of the image, unpacked when it is a .gz. */
async function readHead(file: string, kind: ImageInfo["kind"], n: number): Promise<Buffer> {
  if (kind === "raw") {
    const fh = await fsp.open(file, "r");
    try {
      const buf = Buffer.alloc(n);
      const { bytesRead } = await fh.read(buf, 0, n, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  }
  const parts: Buffer[] = [];
  let have = 0;
  const source = fs.createReadStream(file, { highWaterMark: 256 * 1024 });
  const gunzip = zlib.createGunzip();
  try {
    for await (const chunk of source.pipe(gunzip)) {
      parts.push(chunk as Buffer);
      have += (chunk as Buffer).length;
      if (have >= n) break;
    }
  } catch {
    throw new UserError("This .gz file is not a gzip archive, or it is corrupt.");
  } finally {
    source.destroy();
    gunzip.destroy();
  }
  return Buffer.concat(parts).subarray(0, n);
}

/** Hash lines ("<sha256>  <name>") in a hash.txt, .sha256 or SHA256SUMS file; the one for `imageName`, or a lone hash. */
export function hashFromText(text: string, imageName: string, lone: boolean): string {
  for (let line of text.split("\n")) {
    line = line.replace(/#.*/, "").replace(/\r$/, "").trim();
    if (!line) continue;
    const [first, ...rest] = line.split(/\s+/);
    const hash = normalizeHash(first);
    if (!isSha256(hash)) continue;
    const name = path.basename(rest.join(" ").replace(/^\*/, "").replace(/^\.\//, ""));
    if (name ? name === imageName : lone) return hash;
  }
  return "";
}

/** A SHA256 for the image from the files next to it, like install-muos.sh looks for. */
export async function findHash(image: string): Promise<ImageInfo["hash"]> {
  const dir = path.dirname(image), base = path.basename(image);
  const candidates: [string, boolean][] = [[`${image}.sha256`, true], [`${image}.sha256sum`, true], [path.join(dir, "hash.txt"), false], [path.join(dir, "SHA256SUMS"), false]];
  for (const [file, lone] of candidates) {
    if (!(await isFile(file))) continue;
    const value = hashFromText(await fsp.readFile(file, "utf8"), base, lone);
    if (value) return { value, source: path.basename(file) };
  }
  return null;
}

export async function hashFromFile(file: string, image: string): Promise<{ value: string; source: string }> {
  if (!path.isAbsolute(file) || !(await isFile(file))) throw new UserError("Hash file not found.");
  if ((await fsp.stat(file)).size > 1024 * 1024) throw new UserError("That file is too large to be a hash list.");
  const value = hashFromText(await fsp.readFile(file, "utf8"), path.basename(image), true);
  if (!value) throw new UserError(`No SHA256 for ${path.basename(image)} in ${path.basename(file)}.`);
  return { value, source: path.basename(file) };
}

export async function inspectImage(file: string): Promise<ImageInfo> {
  if (!file || !path.isAbsolute(file)) throw new UserError("Pick an image file, or type its full path.");
  if (!(await isFile(file))) throw new UserError(`Image not found: ${file}`);
  const kind = kindOf(file);
  const fileSize = (await fsp.stat(file)).size;
  if (fileSize < 1024 * 1024) throw new UserError("The file is too small to be a MustardOS disk image.");
  const layout = parseLayout(await readHead(file, kind, 128 * 1024));
  if (kind === "raw" && fileSize !== layout.bytes) throw new UserError("The file size does not match the disk image length. It is truncated or has trailing data.");
  return { path: file, name: path.basename(file), kind, fileSize, ...layout, hash: await findHash(file) };
}

/** .img and .img.gz files in the OS images folder (os/ by default) and one level below it. */
interface WorkspaceImage { path: string; name: string; size: number; mtime: number; hash: boolean }

export async function workspaceImages(): Promise<WorkspaceImage[]> {
  const found: WorkspaceImage[] = [];
  const look = async (dir: string, depth: number) => {
    for (const entry of await listDir(dir)) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 1) await look(full, depth + 1);
      else if (entry.isFile() && /\.img(\.gz)?$/i.test(entry.name)) {
        const st = await fsp.stat(full);
        found.push({ path: full, name: entry.name, size: st.size, mtime: st.mtimeMs / 1000, hash: !!(await findHash(full)) });
      }
    }
  };
  await look(ctx.os, 0);
  return found.sort((a, b) => b.mtime - a.mtime);
}

/** One pass over the file: its SHA256 and, for a .gz, the unpacked image's SHA256, length and backup GPT. */
export async function fullCheck(info: ImageInfo, progress: (done: number) => void, cancelled: () => boolean): Promise<{ fileHash: string; payloadHash: string }> {
  const fileHasher = crypto.createHash("sha256");
  let read = 0;
  const tap = async function* (source: AsyncIterable<Buffer>) {
    for await (const chunk of source) {
      if (cancelled()) throw new Cancelled();
      fileHasher.update(chunk);
      read += chunk.length;
      progress(read);
      yield chunk;
    }
  };
  if (info.kind === "raw") {
    await pipeline(fs.createReadStream(info.path, { highWaterMark: CHUNK }), tap, async (source: AsyncIterable<Buffer>) => { for await (const _ of source); });
    const backup = Buffer.alloc(SECTOR);
    const fh = await fsp.open(info.path, "r");
    try {
      await fh.read(backup, 0, SECTOR, info.backupLba * SECTOR);
    } finally {
      await fh.close();
    }
    checkHeader(backup, info.backupLba, "Backup");
    const hash = fileHasher.digest("hex");
    return { fileHash: hash, payloadHash: hash };
  }
  const payload = crypto.createHash("sha256");
  const backupAt = info.backupLba * SECTOR;
  const backup = Buffer.alloc(SECTOR);
  let unpacked = 0;
  try {
    await pipeline(fs.createReadStream(info.path, { highWaterMark: CHUNK }), tap, zlib.createGunzip(), async (source: AsyncIterable<Buffer>) => {
      for await (const chunk of source) {
        payload.update(chunk);
        const from = unpacked, to = unpacked + chunk.length;
        if (to > backupAt && from < backupAt + SECTOR) {
          const s = Math.max(backupAt, from), e = Math.min(backupAt + SECTOR, to);
          chunk.copy(backup, s - backupAt, s - from, e - from);
        }
        unpacked = to;
      }
    });
  } catch (error) {
    if (error instanceof Cancelled) throw error;
    throw new UserError("The .gz image is truncated or corrupt.");
  }
  if (unpacked !== info.bytes) throw new UserError("The unpacked image size does not match its GPT. The download looks incomplete.");
  checkHeader(backup, info.backupLba, "Backup");
  if (Number(backup.readBigUInt64LE(32)) !== 1) throw new UserError("The backup GPT does not point back at the primary header.");
  return { fileHash: fileHasher.digest("hex"), payloadHash: payload.digest("hex") };
}
