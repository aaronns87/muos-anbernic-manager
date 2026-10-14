// Zip archives for theme packages: writing with node:zlib (deflate and crc32, no ZIP64) and unpacking with yauzl,
// refusing entries that would land outside the target folder.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import yauzl from "yauzl";
import { UserError } from "./errors.ts";
import { inside } from "./util.ts";

export interface ZipItem { name: string; file?: string; data?: Buffer; dir?: boolean; mtime?: Date }

const PACKED = /\.(png|jpe?g|gif|webp|mp4|zip|muxzip|muxalt|7z|gz)$/i;

function dosTime(d: Date): [number, number] {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return [(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()];
}

/** Everything in a folder as zip items, folders included so empty ones survive, in a stable order. */
export async function folderItems(dir: string, skip: (rel: string) => boolean = () => false): Promise<ZipItem[]> {
  const out: ZipItem[] = [];
  const walk = async (rel: string) => {
    const entries = await fsp.readdir(path.join(dir, rel), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skip(r)) continue;
      const full = path.join(dir, r);
      if (e.isDirectory()) {
        out.push({ name: r, dir: true, mtime: (await fsp.stat(full)).mtime });
        await walk(r);
      } else if (e.isFile()) {
        out.push({ name: r, file: full, mtime: (await fsp.stat(full)).mtime });
      }
    }
  };
  await walk("");
  return out;
}

/** Writes a zip file; pictures and archives are stored, everything else deflated when that is smaller. Returns its size. */
export async function writeZip(out: string, items: ZipItem[]): Promise<number> {
  if (items.length > 0xffff) throw new UserError("Too many files for one package.");
  const fh = await fsp.open(out, "w");
  const central: Buffer[] = [];
  let offset = 0;
  try {
    for (const item of items) {
      const name = Buffer.from(item.dir ? `${item.name.replace(/\/$/, "")}/` : item.name, "utf8");
      const raw = item.dir ? Buffer.alloc(0) : item.data ?? (await fsp.readFile(item.file!));
      const crc = zlib.crc32(raw);
      let body = raw, method = 0;
      if (raw.length && !PACKED.test(item.name)) {
        const packed = zlib.deflateRawSync(raw);
        if (packed.length < raw.length) { body = packed; method = 8; }
      }
      if (offset + 30 + name.length + body.length > 0xfffffff0) throw new UserError("The package would be larger than 4 GB.");
      const [time, date] = dosTime(item.mtime ?? new Date());
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(name.length, 26);
      await fh.write(local);
      await fh.write(name);
      if (body.length) await fh.write(body);

      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt16LE(0x031e, 4);
      entry.writeUInt16LE(20, 6);
      entry.writeUInt16LE(0x0800, 8);
      entry.writeUInt16LE(method, 10);
      entry.writeUInt16LE(time, 12);
      entry.writeUInt16LE(date, 14);
      entry.writeUInt32LE(crc, 16);
      entry.writeUInt32LE(body.length, 20);
      entry.writeUInt32LE(raw.length, 24);
      entry.writeUInt16LE(name.length, 28);
      entry.writeUInt32LE(((item.dir ? 0o40755 : 0o100644) * 0x10000 + (item.dir ? 0x10 : 0)) >>> 0, 38);
      entry.writeUInt32LE(offset, 42);
      central.push(entry, name);
      offset += 30 + name.length + body.length;
    }
    const dir = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(items.length, 8);
    end.writeUInt16LE(items.length, 10);
    end.writeUInt32LE(dir.length, 12);
    end.writeUInt32LE(offset, 16);
    await fh.write(dir);
    await fh.write(end);
    return offset + dir.length + end.length;
  } finally {
    await fh.close();
  }
}

const openZip = (file: string) => new Promise<yauzl.ZipFile>((resolve, reject) =>
  yauzl.open(file, { lazyEntries: true, decodeStrings: true }, (error, zip) => (error || !zip ? reject(error ?? new Error("bad zip")) : resolve(zip))));

/** The file names in a zip, folders ending in "/". */
export async function zipNames(file: string): Promise<string[]> {
  const zip = await openZip(file).catch(() => { throw new UserError("That is not a zip archive, or it is damaged."); });
  return new Promise((resolve, reject) => {
    const names: string[] = [];
    zip.on("entry", (e: yauzl.Entry) => { names.push(e.fileName); zip.readEntry(); });
    zip.on("end", () => resolve(names));
    zip.on("error", reject);
    zip.readEntry();
  });
}

const junk = (name: string) => name.startsWith("__MACOSX/") || /(^|\/)\.DS_Store$/.test(name);

/**
 * Unpacks a zip into dest, dropping the leading strip folder from every name and skipping macOS clutter. Refuses
 * absolute paths, "..", and more than maxBytes unpacked. Returns the number of files written.
 */
export async function unzipTo(file: string, dest: string, strip = "", maxBytes = 2 * 1024 ** 3): Promise<number> {
  const zip = await openZip(file).catch(() => { throw new UserError("That is not a zip archive, or it is damaged."); });
  let total = 0, files = 0;
  await new Promise<void>((resolve, reject) => {
    const fail = (error: unknown) => { zip.close(); reject(error); };
    zip.on("error", fail);
    zip.on("end", () => resolve());
    zip.on("entry", (entry: yauzl.Entry) => {
      const raw = entry.fileName.replaceAll("\\", "/");
      if (junk(raw) || (strip && !raw.startsWith(strip))) return zip.readEntry();
      const name = raw.slice(strip.length);
      if (!name || name === "/") return zip.readEntry();
      if (name.startsWith("/") || name.split("/").includes("..") || /^[a-z]:/i.test(name)) return fail(new UserError("The archive has unsafe paths."));
      const out = path.join(dest, ...name.split("/").filter(Boolean));
      if (!inside(dest, out)) return fail(new UserError("The archive has unsafe paths."));
      if (name.endsWith("/")) return void fsp.mkdir(out, { recursive: true }).then(() => zip.readEntry(), fail);
      total += entry.uncompressedSize;
      if (total > maxBytes) return fail(new UserError("The archive unpacks to more than the manager accepts."));
      fsp.mkdir(path.dirname(out), { recursive: true }).then(() => zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) return fail(error ?? new Error("unreadable entry"));
        pipeline(stream, fs.createWriteStream(out)).then(() => { files++; zip.readEntry(); }, fail);
      }), fail);
    });
    zip.readEntry();
  });
  return files;
}
