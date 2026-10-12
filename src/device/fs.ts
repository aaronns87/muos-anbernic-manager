import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Cancelled, UserError } from "../errors.ts";
import { CHUNK, removeQuietly, sameFile } from "../util.ts";

export interface Entry {
  name: string;
  folder: boolean;
  size: number;
  /** Seconds since the epoch. */
  mtime: number;
  /** MTP object id; null on a card. */
  id: number | null;
}

/** progress(sentBytes) returns true to cancel. */
export type Progress = (sent: number) => boolean;

/** Files on one device storage, addressed by path parts below its root. */
export interface DeviceFs {
  /** Over a cable or the network: no local path, and files are compared by size only. */
  readonly remote: boolean;
  list(parts: string[]): Promise<Entry[] | null>;
  hasDir(parts: string[]): Promise<boolean>;
  entry(parts: string[]): Promise<Entry | null>;
  get(parts: string[], dest: string): Promise<void>;
  delete(parts: string[]): Promise<void>;
  put(src: string, parts: string[], progress: Progress): Promise<void>;
  /** Creates a folder and any missing parents. */
  mkdir(parts: string[]): Promise<void>;
  /** Removes an empty folder. */
  removeDir(parts: string[]): Promise<void>;
  /** Renames a file or folder in place; missing over USB, where MTP offers no rename. */
  rename?(parts: string[], name: string): Promise<void>;
  /** Local path of a file, for cards only. */
  localPath?(parts: string[]): string;
}

export class CardFs implements DeviceFs {
  readonly remote = false;
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  localPath(parts: string[]): string {
    return path.join(this.root, ...parts);
  }

  async list(parts: string[]): Promise<Entry[] | null> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(this.localPath(parts), { withFileTypes: true });
    } catch {
      return null;
    }
    const found: Entry[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      try {
        const st = await fsp.stat(path.join(this.localPath(parts), entry.name));
        found.push({ name: entry.name, folder: st.isDirectory(), size: st.size, mtime: st.mtimeMs / 1000, id: null });
      } catch {
        continue;
      }
    }
    return found;
  }

  async hasDir(parts: string[]): Promise<boolean> {
    return fsp.stat(this.localPath(parts)).then((s) => s.isDirectory(), () => false);
  }

  async entry(parts: string[]): Promise<Entry | null> {
    try {
      const st = await fsp.stat(this.localPath(parts));
      return st.isFile() ? { name: parts[parts.length - 1], folder: false, size: st.size, mtime: st.mtimeMs / 1000, id: null } : null;
    } catch {
      return null;
    }
  }

  async get(parts: string[], dest: string): Promise<void> {
    if (!(await this.entry(parts))) throw new UserError(`${parts[parts.length - 1]} is no longer on the card.`);
    await fsp.copyFile(this.localPath(parts), dest);
  }

  async delete(parts: string[]): Promise<void> {
    const file = this.localPath(parts);
    if (!(await this.entry(parts))) throw new UserError(`${parts[parts.length - 1]} is not on the card.`);
    await fsp.rm(file);
    await removeQuietly(path.join(path.dirname(file), "._" + parts[parts.length - 1]));
  }

  async mkdir(parts: string[]): Promise<void> {
    await fsp.mkdir(this.localPath(parts), { recursive: true });
  }

  async removeDir(parts: string[]): Promise<void> {
    const dir = this.localPath(parts);
    for (const name of await fsp.readdir(dir)) if (name.startsWith("._") || name === ".DS_Store") await removeQuietly(path.join(dir, name));
    await fsp.rmdir(dir);
  }

  async rename(parts: string[], name: string): Promise<void> {
    const from = this.localPath(parts), to = path.join(path.dirname(from), name);
    if (fs.existsSync(to) && from.toLowerCase() !== to.toLowerCase()) throw new UserError(`${name} already exists there.`);
    await fsp.rename(from, to);
    await removeQuietly(path.join(path.dirname(from), "._" + parts[parts.length - 1]));
  }

  async put(src: string, parts: string[], progress: Progress): Promise<void> {
    const dest = this.localPath(parts);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const partial = path.join(path.dirname(dest), `.${parts[parts.length - 1]}.partial`);
    try {
      const input = await fsp.open(src, "r");
      const output = await fsp.open(partial, "w");
      try {
        const buffer = Buffer.allocUnsafe(CHUNK);
        let sent = 0;
        for (;;) {
          const { bytesRead } = await input.read(buffer, 0, CHUNK, null);
          if (!bytesRead) break;
          await output.write(buffer, 0, bytesRead);
          sent += bytesRead;
          if (progress(sent)) throw new Cancelled();
        }
        await output.sync();
      } finally {
        await Promise.all([input.close(), output.close()]);
      }
      if (!(await sameFile(src, partial))) throw new UserError(`${parts[parts.length - 1]} did not verify after copying.`);
      await fsp.rename(partial, dest);
      const st = await fsp.stat(src);
      await fsp.utimes(dest, st.atime, st.mtime);
    } finally {
      await removeQuietly(partial);
    }
  }
}
