// SSH to the handheld: MustardOS's "Secure Shell" web service (OpenSSH, port 22, root / root).
// Terminal tabs each get their own SSH session over a WebSocket; device stats and power actions share
// one command connection that closes after a minute of idle time. Host keys are trusted on first use.

import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import ssh2 from "ssh2";
import type { Client, ClientChannel } from "ssh2";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { say } from "../log.ts";
import { runningVersion } from "../updates.ts";
import type { WebSocket } from "../ws.ts";
import { banner, wifiSettings } from "./sftp.ts";

export interface SshSettings {
  /** "" follows the Wi-Fi address from Overview. */
  host: string;
  port: number;
  user: string;
  /** "" uses the keys in the SSH agent instead. */
  password: string;
  shell: "bash" | "sh";
  /** Virtual Terminal (ttyd) web port, for the link. */
  vt: number;
  /** "host:port" -> "SHA256:..." */
  known: Record<string, string>;
}

const DEFAULTS: SshSettings = { host: "", port: 22, user: "root", password: "root", shell: "bash", vt: 8080, known: {} };
const IDLE_MS = 60_000;
const settingsFile = () => path.join(ctx.cacheDir, "ssh.json");
let settings: SshSettings | null = null;

export class SshError extends UserError {
  code: string;
  fingerprint: string;
  constructor(message: string, code = "", fingerprint = "") {
    super(message);
    this.code = code;
    this.fingerprint = fingerprint;
  }
}

export async function sshSettings(): Promise<SshSettings> {
  if (!settings) {
    try {
      settings = { ...DEFAULTS, ...JSON.parse(await fsp.readFile(settingsFile(), "utf8")) };
    } catch {
      settings = { ...DEFAULTS, known: {} };
    }
  }
  return settings!;
}

async function writeSettings(next: SshSettings): Promise<void> {
  await fsp.mkdir(ctx.cacheDir, { recursive: true });
  await fsp.writeFile(settingsFile(), JSON.stringify(next, null, 2), { mode: 0o600 });
  settings = next;
}

export async function saveSshSettings(body: Record<string, unknown>): Promise<SshSettings> {
  const host = String(body.host ?? "").trim();
  if (host && !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(host)) throw new UserError("Enter an IP address like 192.168.0.32, or a host name.");
  const port = Number(body.port || DEFAULTS.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UserError("The SSH port must be a number from 1 to 65535.");
  const current = await sshSettings();
  const next: SshSettings = {
    ...current, host, port,
    user: String(body.user ?? "").trim() || DEFAULTS.user,
    shell: body.shell === "sh" ? "sh" : "bash",
  };
  if (typeof body.password === "string") next.password = body.password;
  await writeSettings(next);
  await closeControl();
  return next;
}

/** The address in use: the SSH setting, or the Wi-Fi address from Overview. */
async function hostOf(s: SshSettings): Promise<string> {
  return s.host || (await wifiSettings()).host;
}

export async function forgetHostKey(): Promise<void> {
  const s = await sshSettings();
  const known = { ...s.known };
  delete known[`${await hostOf(s)}:${s.port}`];
  await writeSettings({ ...s, known });
  await closeControl();
}

let lastCheck = { key: "", at: 0, banner: "" };

export async function sshStatus() {
  const s = await sshSettings();
  const host = await hostOf(s);
  const base = {
    host, port: s.port, user: s.user, shell: s.shell, vt: s.vt, hostSetting: s.host, followsWifi: !s.host,
    usesAgent: !s.password, fingerprint: s.known[`${host}:${s.port}`] ?? "", sessions: terminals.size, configured: !!host,
  };
  if (!host) return { ...base, reachable: false, server: "" };
  const key = `${host}:${s.port}`;
  if (lastCheck.key !== key || Date.now() - lastCheck.at > 3000) lastCheck = { key, at: Date.now(), banner: await banner(host, s.port, 1500) };
  return { ...base, reachable: !!lastCheck.banner, server: lastCheck.banner };
}

// ---------------------------------------------------------------- connecting

const fingerprintOf = (key: Buffer) => "SHA256:" + crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "");

function friendly(error: Error & { code?: string; level?: string }, where: string, user: string): string {
  if (error.code === "ECONNREFUSED") return `Nothing answers on ${where}. On the handheld enable Configuration \u203a Web Services \u203a Secure Shell.`;
  if (error.level === "client-authentication" || /authentication/i.test(error.message)) {
    return `The handheld refused user "${user}". MustardOS uses root / root unless you changed it.`;
  }
  if (["ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EHOSTDOWN", "ENOTFOUND"].includes(error.code ?? "") || /timed out/i.test(error.message)) {
    return `${where.split(":")[0]} does not answer. Check that the handheld is awake and on the same Wi-Fi network.`;
  }
  return `SSH to ${where} failed: ${error.message}`;
}

async function connect(): Promise<{ client: Client; host: string; fingerprint: string; trustedNow: boolean }> {
  const s = await sshSettings();
  const host = await hostOf(s);
  if (!host) throw new SshError("Enter the handheld's address in the SSH settings, or set up Wi-Fi in Overview.", "setup");
  const where = `${host}:${s.port}`;
  return new Promise((resolve, reject) => {
    const client = new ssh2.Client();
    let seen = "", mismatch = false, settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      client.end();
      if (mismatch) {
        reject(new SshError(`The handheld at ${where} has a different host key than the one trusted before. That happens after reinstalling MustardOS, but it can also mean another machine answers on that address.`, "hostkey", seen));
      } else reject(new SshError(friendly(error, where, s.user), (error as { level?: string }).level === "client-authentication" ? "auth" : ""));
    };
    client.on("ready", async () => {
      if (settled) return;
      settled = true;
      const trustedNow = !s.known[where];
      try {
        if (trustedNow) {
          const fresh = await sshSettings();
          await writeSettings({ ...fresh, known: { ...fresh.known, [where]: seen } });
        }
        resolve({ client, host, fingerprint: seen, trustedNow });
      } catch (error) {
        client.end();
        reject(error);
      }
    });
    client.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => finish(prompts.map(() => s.password)));
    client.on("error", fail);
    client.on("close", () => fail(new Error("The connection closed.")));
    client.connect({
      host, port: s.port, username: s.user,
      ...(s.password ? { password: s.password, tryKeyboard: true } : { agent: process.env.SSH_AUTH_SOCK }),
      readyTimeout: 10_000, keepaliveInterval: 15_000,
      hostVerifier: (key: Buffer) => {
        seen = fingerprintOf(key);
        mismatch = !!s.known[where] && s.known[where] !== seen;
        return !mismatch;
      },
    });
  });
}

// ---------------------------------------------------------------- commands

let control: Promise<Client> | null = null;
let controlActive = 0;
let controlUsed = 0;

async function closeControl(): Promise<void> {
  const current = control;
  control = null;
  if (current) (await current.catch(() => null))?.end();
}

setInterval(() => {
  if (control && !controlActive && Date.now() - controlUsed > IDLE_MS) void closeControl();
}, 15_000).unref();

function openControl(): Promise<Client> {
  const opening = connect().then(({ client }) => {
    client.on("close", () => { if (control === opening) control = null; });
    client.on("error", () => { if (control === opening) control = null; });
    return client;
  });
  opening.catch(() => { if (control === opening) control = null; });
  return opening;
}

/** Runs a command on the handheld and returns its output. */
export async function runCommand(command: string, timeoutMs = 15_000): Promise<{ out: string; err: string; code: number | null }> {
  controlActive++;
  try {
    for (let attempt = 0; ; attempt++) {
      const client = await (control ??= openControl());
      try {
        return await new Promise((resolve, reject) => {
          client.exec(command, (err, stream) => {
            if (err) return reject(err);
            let out = "", errText = "";
            const timer = setTimeout(() => { stream.close(); reject(new UserError("The handheld took too long to answer.")); }, timeoutMs);
            stream.on("data", (d: Buffer) => { out += d.toString("utf8"); });
            stream.stderr.on("data", (d: Buffer) => { errText += d.toString("utf8"); });
            stream.on("close", (code: number | null) => { clearTimeout(timer); resolve({ out, err: errText, code }); });
          });
        });
      } catch (error) {
        if (error instanceof UserError || attempt > 0) throw error;
        await closeControl();
      }
    }
  } finally {
    controlActive--;
    controlUsed = Date.now();
  }
}

/** Runs a command with streamed stdin and stdout, for binary transfers such as tar archives. */
export async function streamCommand(
  command: string,
  io: { stdin?: NodeJS.ReadableStream; stdout?: NodeJS.WritableStream },
  timeoutMs = 600_000,
): Promise<{ err: string; code: number | null }> {
  controlActive++;
  try {
    for (let attempt = 0; ; attempt++) {
      const client = await (control ??= openControl());
      const stream = await new Promise<ClientChannel>((resolve, reject) => {
        client.exec(command, (err, channel) => (err ? reject(err) : resolve(channel)));
      }).catch(async (error) => {
        if (attempt > 0) throw error;
        await closeControl();
        return null;
      });
      if (!stream) continue;
      return await new Promise((resolve, reject) => {
        let errText = "";
        const timer = setTimeout(() => { stream.close(); reject(new UserError("The handheld took too long to answer.")); }, timeoutMs);
        const written = io.stdout ? new Promise<void>((done, fail) => {
          io.stdout!.on("finish", done);
          io.stdout!.on("error", fail);
        }) : Promise.resolve();
        written.catch(() => stream.close());
        if (io.stdout) stream.pipe(io.stdout);
        else stream.resume();
        stream.stderr.on("data", (d: Buffer) => { errText += d.toString("utf8"); });
        if (io.stdin) {
          const input = io.stdin as NodeJS.ReadableStream & { readableEnded?: boolean };
          input.once("error", () => stream.close());
          input.once("close", () => { if (!input.readableEnded) stream.close(); });
          input.pipe(stream);
        } else stream.end();
        stream.on("close", (code: number | null) => {
          clearTimeout(timer);
          written.then(() => resolve({ err: errText, code }), reject);
        });
      });
    }
  } finally {
    controlActive--;
    controlUsed = Date.now();
  }
}

const STATS_SCRIPT = String.raw`
echo "@uptime"; cat /proc/uptime
echo "@load"; cat /proc/loadavg
echo "@stat"; head -1 /proc/stat
echo "@mem"; grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo
echo "@temp"; for z in /sys/class/thermal/thermal_zone*; do echo "$(cat $z/type) $(cat $z/temp)"; done 2>/dev/null
echo "@cpu"; cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null; nproc
echo "@battery"; for p in /sys/class/power_supply/*; do [ -f "$p/capacity" ] && echo "$(cat $p/capacity) $(cat $p/status)"; done 2>/dev/null
echo "@df"; df -k /mnt/mmc /mnt/sdcard / 2>/dev/null | tail -n +2
echo "@net"; hostname; ip -4 -o addr show wlan0 2>/dev/null | awk '{print $4}'
echo "@os"; . /etc/os-release 2>/dev/null; echo "$VERSION"; uname -r; cat /opt/muos/config/system/build 2>/dev/null
echo "@top"; top -bn1 2>/dev/null | head -n 16
`;

let lastStat: { key: string; total: number; idle: number } | null = null;

function sections(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let current = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("@")) out[(current = line.slice(1).trim())] = [];
    else if (current && line.trim()) out[current].push(line);
  }
  return out;
}

const MOUNTS: Record<string, string> = { "/mnt/mmc": "SD1 (system card)", "/mnt/sdcard": "SD2 (TF2, games)", "/": "Root file system" };

/** A snapshot of the handheld: uptime, load, CPU, memory, temperatures, battery, storage and the busiest processes. */
export async function deviceStats() {
  const s = await sshSettings();
  const { out } = await runCommand(STATS_SCRIPT);
  const sec = sections(out);
  const nums = (line = "") => line.trim().split(/\s+/).map(Number);

  const cpuFields = nums(sec.stat?.[0]?.replace(/^cpu\s+/, ""));
  const total = cpuFields.reduce((a, b) => a + (b || 0), 0), idle = (cpuFields[3] || 0) + (cpuFields[4] || 0);
  const key = `${await hostOf(s)}:${s.port}`;
  let cpu: number | null = null;
  if (lastStat && lastStat.key === key && total > lastStat.total) cpu = Math.round(100 * (1 - (idle - lastStat.idle) / (total - lastStat.total)));
  lastStat = { key, total, idle };
  const topCpu = (sec.top ?? []).find((l) => /^CPU:/.test(l));
  if (cpu === null && topCpu) cpu = Math.max(0, 100 - Number(/(\d+(?:\.\d+)?)% idle/.exec(topCpu)?.[1] ?? 100));

  const mem = Object.fromEntries((sec.mem ?? []).map((l) => { const [k, v] = l.split(":"); return [k, Number.parseInt(v) * 1024]; }));
  const temps = (sec.temp ?? []).map((l) => { const [name, t] = l.split(/\s+/); return { name: name.replace(/_thermal_zone$/, "").replace(/^axp\d+-/, ""), c: Number(t) / 1000 }; })
    .filter((t) => Number.isFinite(t.c) && t.c > 0);
  const [cur, max, governor, cores] = sec.cpu ?? [];
  const [battery] = (sec.battery ?? []).map((l) => { const [cap, ...st] = l.split(/\s+/); return { percent: Number(cap), status: st.join(" ") }; });
  const storage = (sec.df ?? []).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 6).map((p) => ({
    name: MOUNTS[p[5]] ?? p[5], mount: p[5], device: p[0], total: Number(p[1]) * 1024, used: Number(p[2]) * 1024, free: Number(p[3]) * 1024,
  }));
  const procHead = (sec.top ?? []).findIndex((l) => /^\s*PID\s+PPID/.test(l));
  const processes = procHead < 0 ? [] : (sec.top ?? []).slice(procHead + 1).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 8)
    .filter((p) => !p.slice(7).join(" ").startsWith("top -bn1"))
    .slice(0, 8).map((p) => ({ pid: Number(p[0]), user: p[2], state: p[3], vsz: p[4], cpu: Number.parseFloat(p[6]), command: p.slice(7).join(" ") }));

  return {
    at: Date.now(),
    uptime: Number(nums(sec.uptime?.[0])[0]) || 0,
    load: nums(sec.load?.[0]).slice(0, 3),
    cpu, cores: Number(cores) || 4, mhz: Math.round(Number(cur) / 1000) || 0, maxMhz: Math.round(Number(max) / 1000) || 0, governor: governor ?? "",
    memory: { total: mem.MemTotal || 0, available: mem.MemAvailable || 0, swapTotal: mem.SwapTotal || 0, swapFree: mem.SwapFree || 0 },
    temps, battery: battery ?? null, storage,
    hostname: sec.net?.[0] ?? "", ip: sec.net?.[1] ?? "", version: await runningVersion(sec.os?.[0] ?? "", sec.os?.[2]?.trim() ?? ""), kernel: sec.os?.[1] ?? "",
    processes,
  };
}

/** Reboots or powers off the handheld the way the MustardOS launcher does. */
export async function power(action: string): Promise<void> {
  if (action !== "reboot" && action !== "poweroff") throw new UserError("Unknown power action.");
  await runCommand(`setsid -f /opt/muos/script/mux/quit.sh ${action} frontend >/dev/null 2>&1 </dev/null`, 8000);
  await closeControl();
}

/** Restarts umtprd, the handheld's MTP service. MustardOS's usb_gadget.sh watchdog notices within a second, unbinds
 *  USB, starts umtprd again and binds, so the computer sees a fresh device: what a reboot does, in a few seconds.
 *  This clears a umtprd that stopped answering after a previous connection ended badly. */
export async function restartMtpService(): Promise<void> {
  const script = [
    "killall -q umtprd; sleep 0.4; pidof umtprd >/dev/null && killall -q -KILL umtprd",
    "ps | grep -q '[u]sb_gadget.sh __watchdog' || /opt/muos/script/system/usb_gadget.sh start >/dev/null 2>&1",
    "i=0; while [ $i -lt 40 ]; do pidof umtprd >/dev/null && break; sleep 0.25; i=$((i+1)); done",
    "sleep 1; pidof umtprd >/dev/null && echo up || echo down",
  ].join("\n");
  const { out } = await runCommand(script, 20_000);
  if (!out.includes("up")) throw new UserError("The handheld's USB service did not come back. Restart the handheld.");
  say("green", "USB", "Restarted the handheld's MTP service over SSH.");
}

// ---------------------------------------------------------------- terminals

const terminals = new Set<() => void>();

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

/** Runs an interactive shell for one terminal tab. Binary messages carry the bytes; text messages are JSON control. */
export async function attachTerminal(ws: WebSocket, query: URLSearchParams): Promise<void> {
  let cols = clamp(query.get("cols"), 10, 500, 100), rows = clamp(query.get("rows"), 4, 200, 30);
  let client: Client | null = null, stream: ClientChannel | null = null;
  const stop = () => { stream?.close(); client?.end(); };
  terminals.add(stop);
  ws.on("close", () => { stop(); terminals.delete(stop); });
  ws.on("binary", (data: Buffer) => stream?.write(data));
  ws.on("text", (text: string) => {
    let m: { t?: string; cols?: number; rows?: number };
    try { m = JSON.parse(text); } catch { return; }
    if (m.t === "resize") {
      cols = clamp(m.cols, 10, 500, cols); rows = clamp(m.rows, 4, 200, rows);
      stream?.setWindow(rows, cols, 0, 0);
    }
  });

  const s = await sshSettings();
  ws.sendJson({ t: "status", state: "connecting", host: await hostOf(s), port: s.port, user: s.user });
  let session: Awaited<ReturnType<typeof connect>>;
  try {
    session = await connect();
  } catch (error) {
    const e = error as SshError;
    ws.sendJson({ t: "error", message: e.message, code: e.code ?? "", fingerprint: e.fingerprint ?? "" });
    ws.close();
    return;
  }
  client = session.client;
  if (ws.closed) return void client.end();
  const pty = { term: "xterm-256color", cols, rows };
  // bash reports its working directory as the window title, which names the tab.
  const command = s.shell === "bash"
    ? `if command -v bash >/dev/null 2>&1; then PROMPT_COMMAND='printf "\\033]0;%s\\007" "\${PWD/#$HOME/\\~}"' exec bash -l; else exec sh -l; fi`
    : "";
  const opened = (err: Error | undefined, ch: ClientChannel) => {
    if (err) {
      ws.sendJson({ t: "error", message: `The handheld would not start a shell: ${err.message}` });
      return ws.close();
    }
    stream = ch;
    const forward = (d: Buffer) => {
      if (!ws.sendBinary(d)) { ch.pause(); ws.once("drain", () => ch.resume()); }
    };
    ch.on("data", forward);
    ch.stderr.on("data", forward);
    let exit: { code: number | null; signal: string | null } = { code: null, signal: null };
    ch.on("exit", (code: number | null, signal: string | null) => { exit = { code, signal }; });
    ch.on("close", () => {
      ws.sendJson({ t: "exit", ...exit });
      ws.close();
      client?.end();
    });
    ws.sendJson({ t: "ready", host: session.host, user: s.user, fingerprint: session.fingerprint, trustedNow: session.trustedNow, shell: s.shell });
  };
  client.on("close", () => { if (!ws.closed) { ws.sendJson({ t: "exit", code: null, signal: null, lost: true }); ws.close(); } });
  if (command) client.exec(command, { pty }, opened);
  else client.shell(pty, opened);
}

export async function closeSsh(): Promise<void> {
  for (const stop of terminals) stop();
  terminals.clear();
  await closeControl();
}
