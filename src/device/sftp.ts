// The handheld over Wi-Fi: MustardOS's "SFTP + Filebrowser" web service (SFTPGo). Files go over SFTP (port 2022);
// Filebrowser is SFTPGo's web UI (port 9090), which the app only links to.

import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import ssh2 from "ssh2";
import type { SFTPWrapper, Stats } from "ssh2";
import { ctx } from "../context.ts";
import { Cancelled, UserError } from "../errors.ts";
import type { DeviceFs, Entry, Progress } from "./fs.ts";

export interface WifiSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  /** Filebrowser (SFTPGo web UI) port, for the link. */
  web: number;
}

const DEFAULTS: WifiSettings = { host: "", port: 2022, user: "muos", password: "muos", web: 9090 };
const IDLE_MS = 90_000;
const settingsFile = () => path.join(ctx.cacheDir, "wifi.json");
let settings: WifiSettings | null = null;

export async function wifiSettings(): Promise<WifiSettings> {
  if (!settings) {
    try {
      settings = { ...DEFAULTS, ...JSON.parse(await fsp.readFile(settingsFile(), "utf8")) };
    } catch {
      settings = { ...DEFAULTS };
    }
  }
  return settings!;
}

export async function saveWifiSettings(body: Record<string, unknown>): Promise<WifiSettings> {
  const host = String(body.host ?? "").trim();
  if (host && !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(host)) throw new UserError("Enter an IP address like 192.168.0.32, or a host name.");
  const port = Number(body.port || DEFAULTS.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UserError("The SFTP port must be a number from 1 to 65535.");
  const next: WifiSettings = { ...(await wifiSettings()), host, port, user: String(body.user ?? "").trim() || DEFAULTS.user };
  if (typeof body.password === "string" && body.password) next.password = body.password;
  await fsp.mkdir(ctx.cacheDir, { recursive: true });
  await fsp.writeFile(settingsFile(), JSON.stringify(next, null, 2), { mode: 0o600 });
  settings = next;
  await closeSftp();
  return next;
}

// ---------------------------------------------------------------- reachability and discovery

/** The SSH banner on host:port ("SSH-2.0-SFTPGo_2.6.6"), or "" if nothing answers in time. */
export function banner(host: string, port: number, ms: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let text = "";
    const done = (value: string) => { socket.destroy(); resolve(value); };
    socket.setTimeout(ms, () => done(text.startsWith("SSH-") ? text : ""));
    socket.on("data", (d) => {
      text += d.toString("latin1");
      if (text.includes("\n")) done(text.split(/\r?\n/)[0]);
    });
    socket.on("error", () => done(""));
  });
}

let lastCheck = { key: "", at: 0, banner: "" };

/** What /api/status reports about the Wi-Fi connection. */
export async function wifiStatus() {
  const s = await wifiSettings();
  const base = { host: s.host, port: s.port, user: s.user, web: s.web, configured: !!s.host };
  if (!s.host) return { ...base, reachable: false, server: "" };
  if (shared) return { ...base, reachable: true, server: lastCheck.banner };
  const key = `${s.host}:${s.port}`;
  if (lastCheck.key !== key || Date.now() - lastCheck.at > 3000) lastCheck = { key, at: Date.now(), banner: await banner(s.host, s.port, 1500) };
  return { ...base, reachable: !!lastCheck.banner, server: lastCheck.banner };
}

/** Handhelds on the local networks: hosts answering with an SFTPGo banner on the SFTP port. */
export async function findHandhelds(): Promise<{ host: string; server: string }[]> {
  const port = (await wifiSettings()).port;
  const prefixes = new Set<string>();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal && a.netmask.startsWith("255.255.255")) prefixes.add(a.address.split(".").slice(0, 3).join("."));
    }
  }
  const hosts = [...prefixes].flatMap((p) => Array.from({ length: 254 }, (_, i) => `${p}.${i + 1}`));
  const found: { host: string; server: string }[] = [];
  for (let i = 0; i < hosts.length; i += 128) {
    const batch = await Promise.all(hosts.slice(i, i + 128).map(async (host) => ({ host, server: await banner(host, port, 1200) })));
    found.push(...batch.filter((b) => b.server));
  }
  return found.sort((a, b) => Number(/sftpgo/i.test(b.server)) - Number(/sftpgo/i.test(a.server)));
}

// ---------------------------------------------------------------- the session

export interface SftpStorage {
  /** "SD1" or "SD2". */
  name: string;
  root: string;
  free: number;
  total: number;
}

export interface SftpSession {
  sftp: SFTPWrapper;
  storages: SftpStorage[];
  close(): void;
  /** When free space was last read; reads closer than 5 s apart reuse it. */
  spaceAt?: number;
}

let shared: Promise<SftpSession> | null = null;
let active = 0;
let lastUsed = 0;

function friendly(error: Error & { code?: string; level?: string }, s: WifiSettings): string {
  const where = `${s.host}:${s.port}`;
  if (error.code === "ECONNREFUSED") {
    return `Nothing answers on ${where}. On the handheld enable Configuration \u203a Web Services \u203a SFTP + Filebrowser.`;
  }
  if (error.level === "client-authentication" || /authentication/i.test(error.message)) {
    return `The handheld refused user "${s.user}" and its password. MustardOS uses muos / muos unless you changed it.`;
  }
  if (["ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EHOSTDOWN", "ENOTFOUND"].includes(error.code ?? "") || /timed out/i.test(error.message)) {
    return `${s.host} does not answer. Check that the handheld is awake and on the same Wi-Fi network, and its address (Configuration \u203a Wi-Fi Network shows it).`;
  }
  return `Wi-Fi connection to ${where} failed: ${error.message}`;
}

const call = <T>(fn: (cb: (err: Error | null | undefined, value: T) => void) => void): Promise<T> =>
  new Promise((resolve, reject) => fn((err, value) => (err ? reject(err) : resolve(value))));

const run = (fn: (cb: (err?: Error | null) => void) => void): Promise<void> =>
  new Promise((resolve, reject) => fn((err) => (err ? reject(err) : resolve())));

const missing = (error: unknown) => (error as { code?: number }).code === 2;

/** MustardOS shows its storages as "SD1 (mmc)", "SD2 (sdcard)", "USB (external)" and "MUX (internal)". */
async function findStorages(sftp: SFTPWrapper): Promise<SftpStorage[]> {
  const top = await call<{ filename: string; attrs: Stats }[]>((cb) => sftp.readdir("/", cb));
  const pick = (re: RegExp) => top.find((e) => re.test(e.filename))?.filename;
  const roots: [string, string | undefined][] = [["SD1", pick(/^sd1\b|^mmc$/i)], ["SD2", pick(/^sd2\b|^sdcard$/i)]];
  const found = roots.filter((r): r is [string, string] => !!r[1]).map(([name, dir]) => ({ name, root: `/${dir}`, free: 0, total: 0 }));
  if (!found.length && top.some((e) => /^(roms|muos)$/i.test(e.filename))) found.push({ name: "SD1", root: "/", free: 0, total: 0 });
  return found;
}

async function updateSpace(session: SftpSession): Promise<void> {
  if (Date.now() - (session.spaceAt ?? 0) < 5000) return;
  session.spaceAt = Date.now();
  for (const storage of session.storages) {
    try {
      const st = await call<Record<string, number>>((cb) => session.sftp.ext_openssh_statvfs(storage.root, cb as never));
      storage.free = st.f_bavail * st.f_frsize;
      storage.total = st.f_blocks * st.f_frsize;
    } catch {}
  }
}

function connect(s: WifiSettings): Promise<SftpSession> {
  const mine: Promise<SftpSession> = new Promise((resolve, reject) => {
    const client = new ssh2.Client();
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      client.end();
      reject(new UserError(friendly(error, s)));
    };
    client.on("error", (error) => {
      if (!settled) return fail(error);
      if (shared === mine) shared = null;
      client.end();
    });
    client.on("close", () => {
      if (!settled) return fail(new Error("The connection closed."));
      if (shared === mine) shared = null;
    });
    client.on("ready", () => {
      client.sftp(async (err, sftp) => {
        if (err) return fail(err);
        try {
          const storages = await findStorages(sftp);
          if (!storages.length) throw new Error("No SD1 or SD2 folder is visible over SFTP.");
          settled = true;
          resolve({ sftp, storages, close: () => client.end() });
        } catch (error) {
          fail(error as Error);
        }
      });
    });
    client.connect({ host: s.host, port: s.port, username: s.user, password: s.password, readyTimeout: 10_000, keepaliveInterval: 15_000 });
  });
  return mine;
}

/** Runs fn with the shared SFTP session, opened on first use and closed after 90 seconds of idle time. */
export async function withSftp<T>(fn: (session: SftpSession) => Promise<T>): Promise<T> {
  const s = await wifiSettings();
  if (!s.host) throw new UserError("Enter the handheld's Wi-Fi address in Overview first.");
  const opening = (shared ??= connect(s));
  let session: SftpSession;
  try {
    session = await opening;
  } catch (error) {
    if (shared === opening) shared = null;
    throw error;
  }
  active++;
  try {
    await updateSpace(session);
    return await fn(session);
  } finally {
    active--;
    lastUsed = Date.now();
  }
}

export async function closeSftp(): Promise<void> {
  const current = shared;
  shared = null;
  if (current) (await current.catch(() => null))?.close();
}

setInterval(() => {
  if (shared && !active && Date.now() - lastUsed > IDLE_MS) void closeSftp();
}, 15_000).unref();

/** A small text file from anywhere on the handheld, or "". */
export async function readWifiText(file: string): Promise<string> {
  return withSftp(async ({ sftp }) => {
    try {
      const handle = await call<Buffer>((cb) => sftp.open(file, "r", cb));
      try {
        const buffer = Buffer.alloc(4096);
        const read = await new Promise<number>((resolve, reject) => sftp.read(handle, buffer, 0, buffer.length, 0, (e, n) => (e ? reject(e) : resolve(n))));
        return buffer.subarray(0, read).toString("utf8");
      } finally {
        await run((cb) => sftp.close(handle, cb)).catch(() => {});
      }
    } catch {
      return "";
    }
  });
}

// ---------------------------------------------------------------- files

const CHUNK = 64 * 1024;
const PARALLEL = 32;

export class SftpFs implements DeviceFs {
  readonly remote = true;
  readonly sftp: SFTPWrapper;
  readonly root: string;

  constructor(sftp: SFTPWrapper, root: string) {
    this.sftp = sftp;
    this.root = root;
  }

  private full(parts: string[]): string {
    return path.posix.join(this.root, ...parts);
  }

  private stat(parts: string[]): Promise<Stats | null> {
    return call<Stats>((cb) => this.sftp.stat(this.full(parts), cb)).catch((error) => {
      if (missing(error)) return null;
      throw error;
    });
  }

  async list(parts: string[], hidden = false): Promise<Entry[] | null> {
    let entries: { filename: string; attrs: Stats }[];
    try {
      entries = await call((cb) => this.sftp.readdir(this.full(parts), cb));
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
    return entries.filter((e) => hidden ? e.filename !== "." && e.filename !== ".." : !e.filename.startsWith(".")).map((e) => ({
      name: e.filename, folder: e.attrs.isDirectory(), size: e.attrs.size, mtime: e.attrs.mtime, id: null,
    }));
  }

  async hasDir(parts: string[]): Promise<boolean> {
    return !!(await this.stat(parts))?.isDirectory();
  }

  async entry(parts: string[]): Promise<Entry | null> {
    const st = await this.stat(parts);
    return st?.isFile() ? { name: parts[parts.length - 1], folder: false, size: st.size, mtime: st.mtime, id: null } : null;
  }

  async get(parts: string[], dest: string): Promise<void> {
    if (!(await this.entry(parts))) throw new UserError(`${parts[parts.length - 1]} is no longer on the handheld.`);
    await call((cb) => this.sftp.fastGet(this.full(parts), dest, { concurrency: PARALLEL, chunkSize: CHUNK }, cb as never));
  }

  async delete(parts: string[]): Promise<void> {
    if (!(await this.entry(parts))) throw new UserError(`${parts[parts.length - 1]} is not on the handheld.`);
    await run((cb) => this.sftp.unlink(this.full(parts), cb));
    const sidecar = [...parts.slice(0, -1), "._" + parts[parts.length - 1]];
    await run((cb) => this.sftp.unlink(this.full(sidecar), cb)).catch(() => {});
  }

  async mkdir(parts: string[]): Promise<void> {
    await this.mkdirs(parts);
  }

  async removeDir(parts: string[]): Promise<void> {
    await run((cb) => this.sftp.rmdir(this.full(parts), cb));
  }

  async rename(parts: string[], name: string): Promise<void> {
    const to = [...parts.slice(0, -1), name];
    const from = parts[parts.length - 1];
    if (from === name) return;
    if (await this.stat(to)) {
      const entries = await this.list(parts.slice(0, -1), true);
      const same = from.toLowerCase() === name.toLowerCase()
        && entries?.some((e) => e.name === from) && !entries.some((e) => e.name === name);
      if (!same) throw new UserError(`${name} already exists there.`);
    }
    await run((cb) => this.sftp.rename(this.full(parts), this.full(to), cb));
  }

  private async mkdirs(parts: string[]): Promise<void> {
    for (let i = 1; i <= parts.length; i++) {
      if (await this.hasDir(parts.slice(0, i))) continue;
      await run((cb) => this.sftp.mkdir(this.full(parts.slice(0, i)), cb)).catch(async (error) => {
        if (!(await this.hasDir(parts.slice(0, i)))) throw error;
      });
    }
  }

  async put(src: string, parts: string[], progress: Progress): Promise<void> {
    await this.mkdirs(parts.slice(0, -1));
    const name = parts[parts.length - 1];
    const dest = this.full(parts);
    const partial = this.full([...parts.slice(0, -1), `.${name}.partial`]);
    const input = await fsp.open(src, "r");
    const { size, atime, mtime } = await input.stat();
    let handle: Buffer | null = null;
    try {
      handle = await call<Buffer>((cb) => this.sftp.open(partial, "w", cb));
      const inflight = new Set<Promise<void>>();
      let offset = 0, sent = 0;
      while (offset < size) {
        if (progress(sent)) throw new Cancelled();
        const length = Math.min(CHUNK, size - offset);
        const buffer = Buffer.allocUnsafe(length);
        await input.read(buffer, 0, length, offset);
        const write = call<void>((cb) => this.sftp.write(handle!, buffer, 0, length, offset, cb as never)).then(() => { sent += length; });
        offset += length;
        inflight.add(write);
        write.then(() => inflight.delete(write), () => inflight.delete(write));
        if (inflight.size >= PARALLEL) await Promise.race(inflight);
      }
      await Promise.all(inflight);
      progress(sent);
      await run((cb) => this.sftp.close(handle!, cb));
      handle = null;
      const st = await call<Stats>((cb) => this.sftp.stat(partial, cb));
      if (st.size !== size) throw new UserError(`${name} arrived incomplete (${st.size} of ${size} bytes).`);
      await run((cb) => this.sftp.ext_openssh_rename(partial, dest, cb)).catch(async () => {
        if (await this.entry(parts)) await run((cb) => this.sftp.unlink(dest, cb));
        await run((cb) => this.sftp.rename(partial, dest, cb));
      });
      await run((cb) => this.sftp.utimes(dest, atime, mtime, cb)).catch(() => {});
    } catch (error) {
      if (handle) await run((cb) => this.sftp.close(handle!, cb)).catch(() => {});
      await run((cb) => this.sftp.unlink(partial, cb)).catch(() => {});
      throw error;
    } finally {
      await input.close();
    }
  }
}
