// Lists the files in a .tar.gz without extracting it: ustar headers, plus GNU long names as BusyBox tar writes them.

import fsp from "node:fs/promises";
import { promisify } from "node:util";
import zlib from "node:zlib";

const gunzip = promisify(zlib.gunzip);

export interface TarEntry { path: string; size: number; mtime: number; dir: boolean }

const text = (b: Buffer, start: number, length: number) => {
  const raw = b.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end < 0 ? raw.length : end).toString("utf8");
};
const octal = (b: Buffer, start: number, length: number) => parseInt(text(b, start, length).trim() || "0", 8) || 0;

/** The entries of an uncompressed tar archive. */
export function tarEntries(data: Buffer): TarEntry[] {
  const out: TarEntry[] = [];
  let longName = "";
  for (let at = 0; at + 512 <= data.length;) {
    const header = data.subarray(at, at + 512);
    if (header.every((x) => x === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const body = at + 512;
    at = body + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = text(data, body, size); continue; }
    if (type === "x" || type === "g") continue;
    const prefix = text(header, 345, 155);
    const name = longName || (prefix ? `${prefix}/${text(header, 0, 100)}` : text(header, 0, 100));
    longName = "";
    const dir = type === "5" || name.endsWith("/");
    if (type !== "0" && type !== "5" && type !== "\0" && !dir) continue;
    out.push({ path: name.replace(/^\.\//, "").replace(/\/$/, ""), size: dir ? 0 : size, mtime: octal(header, 136, 12), dir });
  }
  return out;
}

/** The entries of a .tar.gz file. */
export async function tarGzEntries(file: string): Promise<TarEntry[]> {
  return tarEntries(await gunzip(await fsp.readFile(file)));
}

/** True when every path stays inside the archive's folder: no absolute paths and no "..". */
export function safeEntries(entries: TarEntry[], root: string): boolean {
  return entries.every((e) => !e.path.startsWith("/") && !e.path.split("/").includes("..") && (e.path === root || e.path.startsWith(root + "/")));
}
