import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const CHUNK = 4 * 1024 * 1024;

/** ["Game (USA)", "zip"] for "Game (USA).zip"; the extension is lower-cased. */
export function splitName(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot + 1).toLowerCase()] : [name, ""];
}

/** Imgs holds a system's artwork and Text its descriptions; neither is a game. */
export const TEXT_DIR = "Text";

export function skipName(name: string): boolean {
  const lower = name.toLowerCase();
  return name.startsWith(".") || lower === "imgs" || lower === "text";
}

/** Single-quotes a value for a POSIX shell command line. */
export const shq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

export function safePart(part: unknown): part is string {
  return typeof part === "string" && part !== "" && !part.includes("/") && !part.includes("\\") && !part.startsWith(".");
}

/** The real path of p, or of its nearest existing folder plus the rest, so files not created yet resolve too. */
function realPath(p: string): string {
  const rest: string[] = [];
  for (let cur = path.resolve(p); ; ) {
    try {
      return path.join(fs.realpathSync(cur), ...rest.reverse());
    } catch {}
    const up = path.dirname(cur);
    if (up === cur) return path.resolve(p);
    rest.push(path.basename(cur));
    cur = up;
  }
}

export function inside(parent: string, child: string): boolean {
  const rel = path.relative(realPath(parent), realPath(child));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function isFile(p: string): Promise<boolean> {
  try {
    return (await fsp.stat(p)).isFile();
  } catch {
    return false;
  }
}

export async function isDir(p: string): Promise<boolean> {
  try {
    return (await fsp.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function listDir(p: string): Promise<fs.Dirent[]> {
  try {
    return await fsp.readdir(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function removeQuietly(p: string): Promise<void> {
  await fsp.rm(p, { force: true }).catch(() => {});
}

/** Byte-for-byte comparison of two files. */
export async function sameFile(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([fsp.open(a, "r"), fsp.open(b, "r")]);
  try {
    const bufA = Buffer.allocUnsafe(CHUNK), bufB = Buffer.allocUnsafe(CHUNK);
    for (;;) {
      const [ra, rb] = await Promise.all([x.read(bufA, 0, CHUNK, null), y.read(bufB, 0, CHUNK, null)]);
      if (ra.bytesRead !== rb.bytesRead) return false;
      if (ra.bytesRead === 0) return true;
      if (!bufA.subarray(0, ra.bytesRead).equals(bufB.subarray(0, rb.bytesRead))) return false;
    }
  } finally {
    await Promise.all([x.close(), y.close()]);
  }
}

export function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
