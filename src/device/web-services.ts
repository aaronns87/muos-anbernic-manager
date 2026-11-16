// Active MustardOS web services: enabled flags on the handheld plus whether this computer can reach them.

import net from "node:net";
import { banner, wifiSettings } from "./sftp.ts";
import { runCommand, sshSettings } from "./ssh.ts";

export interface WebServiceStatus {
  id: string;
  label: string;
  /** Config toggle is on (or unknown when we only probed the port). */
  enabled: boolean | null;
  /** Process looks running on the handheld (null when SSH inventory was skipped). */
  running: boolean | null;
  /** TCP from this computer answered (or SSH/SFTP banner). */
  reachable: boolean;
  port: number;
  detail: string;
}

const PROBE_MS = 900;

function tcpOpen(host: string, port: number, timeoutMs = PROBE_MS): Promise<boolean> {
  if (!host || !port) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

type Row = { id: string; label: string; enabledKey: string; portKey: string; defPort: number; runKey: string };

const ROWS: Row[] = [
  { id: "ssh", label: "Secure Shell (SSH)", enabledKey: "sshd", portKey: "sshd_port", defPort: 22, runKey: "ssh" },
  { id: "sftp", label: "Secure File Transfer (SFTP)", enabledKey: "sftp", portKey: "sftp_port", defPort: 2022, runKey: "sftp" },
  { id: "ttyd", label: "Virtual terminal", enabledKey: "ttyd", portKey: "ttyd_port", defPort: 8080, runKey: "ttyd" },
  { id: "syncthing", label: "Syncthing", enabledKey: "syncthing", portKey: "syncthing_port", defPort: 7070, runKey: "syncthing" },
  { id: "landing", label: "Web landing page", enabledKey: "landing", portKey: "landing_port", defPort: 80, runKey: "landing" },
  { id: "mdns", label: "mDNS discovery", enabledKey: "mdns", portKey: "", defPort: 0, runKey: "mdns" },
  { id: "tailscale", label: "Tailscale", enabledKey: "tailscaled", portKey: "", defPort: 0, runKey: "tailscale" },
];

let cache: { at: number; host: string; services: WebServiceStatus[] } | null = null;

/** Reads web/* toggles and running processes over SSH when possible; always TCP-probes known ports. */
export async function webServicesStatus(force = false): Promise<{ host: string; at: number; services: WebServiceStatus[] }> {
  const wifi = await wifiSettings();
  const ssh = await sshSettings();
  const host = ssh.host || wifi.host;
  if (!host) return { host: "", at: Date.now(), services: [] };
  if (!force && cache && cache.host === host && Date.now() - cache.at < 8_000) return cache;

  const enabled: Record<string, boolean> = {};
  const ports: Record<string, number> = {};
  const runningMap: Record<string, boolean> = {};
  let inventory = false;
  try {
    // pid/file checks avoid false positives from this remote script appearing in `ps`.
    const { out, code } = await runCommand(
      [
        "C=/opt/muos/config/web",
        'for k in sshd sftp sftpgo ttyd syncthing landing mdns tailscaled sshd_port sftp_port ttyd_port syncthing_port landing_port; do',
        '  [ -f "$C/$k" ] || continue',
        '  printf "=%s\\t%s\\n" "$k" "$(cat "$C/$k")"',
        "done",
        'alive() { [ -n "$1" ] && kill -0 "$1" 2>/dev/null; }',
        'printf "@run\\tssh\\t%s\\n" "$(alive "$(cat /run/muos/dropbear.pid 2>/dev/null)" && echo 1 || echo 0)"',
        'printf "@run\\tsftp\\t%s\\n" "$(if alive "$(cat /run/muos/dropbear-sftp.pid 2>/dev/null)" || pidof sftpgo >/dev/null 2>&1; then echo 1; else echo 0; fi)"',
        'printf "@run\\tttyd\\t%s\\n" "$(pidof ttyd >/dev/null 2>&1 && echo 1 || echo 0)"',
        'printf "@run\\tsyncthing\\t%s\\n" "$(pidof syncthing >/dev/null 2>&1 && echo 1 || echo 0)"',
        'printf "@run\\tlanding\\t%s\\n" "$(pidof muweb >/dev/null 2>&1 && echo 1 || echo 0)"',
        'printf "@run\\tmdns\\t%s\\n" "$(pidof mudns >/dev/null 2>&1 && echo 1 || echo 0)"',
        'printf "@run\\ttailscale\\t%s\\n" "$(pidof tailscaled >/dev/null 2>&1 && echo 1 || echo 0)"',
      ].join("\n"),
      12_000,
    );
    if (code === 0 || out.includes("=") || out.includes("@run")) {
      inventory = true;
      for (const line of out.split("\n")) {
        if (line.startsWith("@run\t")) {
          const [, id, value] = line.split("\t");
          if (id) runningMap[id] = value?.trim() === "1";
        } else if (line.startsWith("=")) {
          const tab = line.indexOf("\t");
          if (tab < 0) continue;
          const key = line.slice(1, tab), value = line.slice(tab + 1).trim();
          if (key.endsWith("_port")) ports[key] = Number(value) || 0;
          else enabled[key] = value === "1";
        }
      }
      // Jacaranda names the SFTP toggle sftpgo
      if (enabled.sftp === undefined && enabled.sftpgo !== undefined) enabled.sftp = enabled.sftpgo;
    }
  } catch {
    inventory = false;
  }

  const sshPort = ports.sshd_port || ssh.port || 22;
  const sftpPort = ports.sftp_port || wifi.port || 2022;
  const [sshBanner, sftpBanner, ...tcp] = await Promise.all([
    banner(host, sshPort, PROBE_MS),
    banner(host, sftpPort, PROBE_MS),
    tcpOpen(host, ports.ttyd_port || 8080),
    tcpOpen(host, ports.syncthing_port || 7070),
    tcpOpen(host, ports.landing_port || 80),
  ]);
  const tcpById: Record<string, boolean> = {
    ssh: !!sshBanner,
    sftp: !!sftpBanner,
    ttyd: tcp[0],
    syncthing: tcp[1],
    landing: tcp[2],
    mdns: inventory ? !!runningMap.mdns : false,
    tailscale: inventory ? !!runningMap.tailscale : false,
  };

  const services: WebServiceStatus[] = ROWS.map((row) => {
    const port = row.id === "ssh" ? sshPort : row.id === "sftp" ? sftpPort : row.portKey ? ports[row.portKey] || row.defPort : 0;
    const keyKnown = inventory && (enabled[row.enabledKey] !== undefined || (row.id === "sftp" && enabled.sftpgo !== undefined));
    const on = keyKnown ? !!enabled[row.enabledKey] || (row.id === "sftp" && !!enabled.sftpgo) : inventory ? false : null;
    const running = inventory ? !!runningMap[row.runKey] : null;
    const reachable = !!tcpById[row.id];
    let detail = "Not checked";
    if (!inventory && !reachable) detail = "Not reachable";
    else if (!inventory && reachable) detail = port ? `Port ${port} open` : "Responding";
    else if (!keyKnown && !running && !reachable) detail = "Not available";
    else if (on === false && !running && !reachable) detail = "Off";
    else if (on === false && (running || reachable)) detail = "Running (toggle off in config)";
    else if (running && reachable) detail = port ? `Running · port ${port}` : "Running";
    else if (running) detail = "Running on handheld";
    else if (reachable) detail = port ? `Port ${port} open` : "Reachable";
    else if (on) detail = port ? `Enabled · port ${port} not answering` : "Enabled · not running";
    else detail = "Off";
    return { id: row.id, label: row.label, enabled: keyKnown ? on : null, running, reachable, port, detail };
  }).filter((s) => {
    if (s.id === "tailscale" && s.enabled === null && !s.running && !s.reachable) return false;
    if (s.detail === "Not available") return false;
    return true;
  });

  cache = { at: Date.now(), host, services };
  return cache;
}
