// PSP disc IDs (e.g. ULUS10391), which name PPSSPP's per-game settings file. Read from ISO, CSO and PBP images through a
// byte-range reader, so the same code works on a local file and on one read over SSH.

import zlib from "node:zlib";

export type ReadAt = (pos: number, len: number) => Promise<Buffer>;

const SECTOR = 2048;

/** A reader over the uncompressed image inside a CSO (CISO v1, or v2 without LZ4 blocks). */
async function csoReader(read: ReadAt): Promise<ReadAt> {
  const head = await read(0, 24);
  const blockSize = head.readUInt32LE(16), align = head[21];
  if (!blockSize || blockSize > 1 << 20) throw new Error("Unsupported CSO block size.");
  return async (pos, len) => {
    const first = Math.floor(pos / blockSize), last = Math.floor((pos + len - 1) / blockSize);
    const index = await read(24 + first * 4, (last - first + 2) * 4);
    const parts: Buffer[] = [];
    for (let b = first; b <= last; b++) {
      const raw = index.readUInt32LE((b - first) * 4), next = index.readUInt32LE((b - first + 1) * 4);
      const at = (raw & 0x7fffffff) * 2 ** align, size = (next & 0x7fffffff) * 2 ** align - at;
      const data = await read(at, Math.min(size, blockSize + 1024));
      if (head[20] >= 2 && raw & 0x80000000) throw new Error("LZ4 CSO blocks are not supported.");
      parts.push(raw & 0x80000000 || size >= blockSize ? data.subarray(0, blockSize) : zlib.inflateRawSync(data));
    }
    const all = Buffer.concat(parts), off = pos - first * blockSize;
    return all.subarray(off, off + len);
  };
}

/** The value of one key in a PARAM.SFO. */
export function sfoValue(sfo: Buffer, key: string): string {
  if (sfo.length < 20 || sfo.toString("latin1", 0, 4) !== "\0PSF") return "";
  const keys = sfo.readUInt32LE(8), data = sfo.readUInt32LE(12), count = sfo.readUInt32LE(16);
  for (let i = 0; i < count && 20 + i * 16 + 16 <= sfo.length; i++) {
    const e = 20 + i * 16;
    const nameAt = keys + sfo.readUInt16LE(e), end = sfo.indexOf(0, nameAt);
    if (sfo.toString("latin1", nameAt, end < 0 ? undefined : end) !== key) continue;
    const at = data + sfo.readUInt32LE(e + 12), len = sfo.readUInt32LE(e + 4);
    return sfo.toString("utf8", at, at + len).replace(/\0+$/, "");
  }
  return "";
}

interface Entry { name: string; lba: number; size: number; dir: boolean }

async function listDir(read: ReadAt, lba: number, size: number): Promise<Entry[]> {
  const buf = await read(lba * SECTOR, Math.min(size, 16 * SECTOR));
  const out: Entry[] = [];
  for (let i = 0; i < buf.length;) {
    const len = buf[i];
    if (!len) { i = (Math.floor(i / SECTOR) + 1) * SECTOR; continue; }
    const nameLen = buf[i + 32];
    out.push({
      name: buf.toString("latin1", i + 33, i + 33 + nameLen).replace(/;1$/, "").toUpperCase(),
      lba: buf.readUInt32LE(i + 2), size: buf.readUInt32LE(i + 10), dir: !!(buf[i + 25] & 2),
    });
    i += len;
  }
  return out;
}

const tidy = (id: string) => id.replace(/[^A-Z0-9]/gi, "").toUpperCase();

async function isoDiscId(read: ReadAt): Promise<string> {
  const pvd = await read(16 * SECTOR, SECTOR);
  if (pvd[0] !== 1 || pvd.toString("latin1", 1, 6) !== "CD001") return "";
  const root = await listDir(read, pvd.readUInt32LE(158), pvd.readUInt32LE(166));
  const game = root.find((e) => e.dir && e.name === "PSP_GAME");
  const sfo = game && (await listDir(read, game.lba, game.size)).find((e) => !e.dir && e.name === "PARAM.SFO");
  if (sfo) {
    const id = sfoValue(await read(sfo.lba * SECTOR, Math.min(sfo.size, 64 * 1024)), "DISC_ID");
    if (id) return tidy(id);
  }
  const umd = root.find((e) => !e.dir && e.name === "UMD_DATA.BIN");
  return umd ? tidy((await read(umd.lba * SECTOR, Math.min(umd.size, 64))).toString("latin1").split("|")[0]) : "";
}

/** The disc ID of a PSP image, or "" when the format is not readable (CHD, homebrew without an ID). */
export async function discId(read: ReadAt, file: string): Promise<string> {
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  const magic = (await read(0, 8)).toString("latin1", 0, 4);
  if (magic === "\0PBP" || ext === "pbp") {
    const head = await read(0, 16);
    const at = head.readUInt32LE(8), end = head.readUInt32LE(12);
    return end > at ? tidy(sfoValue(await read(at, Math.min(end - at, 64 * 1024)), "DISC_ID")) : "";
  }
  if (magic === "CISO") return isoDiscId(await csoReader(read));
  if (ext === "iso") return isoDiscId(read);
  return "";
}
