// Named device profiles kept in .cache/device-profiles.json: Wi-Fi (SFTP) and SSH sign-in details, optional web
// service ports, the model, and what the manager last saw (time, battery). The browser keeps a copy in localStorage.

import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";

export interface ProfileLink { host: string; user: string; port: number }
export interface ProfilePorts { landing?: number; ttyd?: number; syncthing?: number; filebrowser?: number }
export interface ProfileBattery { percent: number; status?: string }

export interface DeviceProfile {
  id: string;
  label: string;
  color?: string;
  wifi: ProfileLink;
  /** host "" follows the Wi-Fi address, like the SSH setting. */
  ssh: ProfileLink;
  ports?: ProfilePorts;
  model: string;
  lastSeen?: number;
  battery?: ProfileBattery;
  updatedAt: number;
}

interface Store { activeId: string; profiles: DeviceProfile[] }

const PORT_KEYS = ["landing", "ttyd", "syncthing", "filebrowser"] as const;
const MAX_PROFILES = 50;
const profilesFile = () => path.join(ctx.cacheDir, "device-profiles.json");

let store: Store | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Runs store changes one after another so two requests cannot overwrite each other. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

const text = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

function port(value: unknown, fallback: number, what: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new UserError(`The ${what} port must be a number from 1 to 65535.`);
  return n;
}

function host(value: unknown, required: boolean): string {
  const h = text(value, 253);
  if (!h && !required) return "";
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(h)) throw new UserError("Enter an IP address like 192.168.0.32, or a host name.");
  return h;
}

function link(value: unknown, defaults: { user: string; port: number }, what: string, hostRequired: boolean): ProfileLink {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return { host: host(v.host, hostRequired), user: text(v.user, 64) || defaults.user, port: port(v.port, defaults.port, what) };
}

function cleanPorts(value: unknown): ProfilePorts | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: ProfilePorts = {};
  for (const key of PORT_KEYS) {
    const raw = (value as Record<string, unknown>)[key];
    if (raw === undefined || raw === null || raw === "" || raw === 0) continue;
    out[key] = port(raw, 0, key);
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanBattery(value: unknown): ProfileBattery | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const percent = Math.round(Number(v.percent));
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return undefined;
  const status = text(v.status, 32);
  return status ? { percent, status } : { percent };
}

const newId = () => `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Builds a valid profile from request data; fields missing from `body` keep their value from `prev`. */
function build(body: Record<string, unknown>, prev?: DeviceProfile): DeviceProfile {
  const pick = <K extends keyof DeviceProfile>(key: K): unknown => (key in body ? body[key] : prev?.[key]);
  const wifi = link(pick("wifi"), { user: "muos", port: 2022 }, "SFTP", true);
  const ssh = link(pick("ssh"), { user: "root", port: 22 }, "SSH", false);
  const color = text(pick("color"), 7);
  const lastSeen = Number(pick("lastSeen"));
  const profile: DeviceProfile = {
    id: prev?.id ?? text(body.id, 64),
    label: text(pick("label"), 60) || wifi.host,
    wifi, ssh,
    model: text(pick("model"), 80),
    updatedAt: Date.now(),
  };
  if (/^#[0-9a-f]{6}$/i.test(color)) profile.color = color.toLowerCase();
  const ports = cleanPorts(pick("ports"));
  if (ports) profile.ports = ports;
  if (Number.isFinite(lastSeen) && lastSeen > 0) profile.lastSeen = Math.round(lastSeen);
  const battery = cleanBattery(pick("battery"));
  if (battery) profile.battery = battery;
  return profile;
}

async function load(): Promise<Store> {
  if (store) return store;
  const fresh: Store = { activeId: "", profiles: [] };
  try {
    const saved = JSON.parse(await fsp.readFile(profilesFile(), "utf8")) as Partial<Store>;
    for (const p of Array.isArray(saved.profiles) ? saved.profiles : []) {
      try {
        const made = build(p as unknown as Record<string, unknown>);
        if (made.id) fresh.profiles.push({ ...made, updatedAt: Number(p.updatedAt) || made.updatedAt });
      } catch { /* skip a damaged entry */ }
    }
    if (typeof saved.activeId === "string" && fresh.profiles.some((p) => p.id === saved.activeId)) fresh.activeId = saved.activeId;
  } catch { /* none saved yet, or unreadable */ }
  store = fresh;
  return fresh;
}

async function write(next: Store): Promise<void> {
  await fsp.mkdir(ctx.cacheDir, { recursive: true });
  const tmp = `${profilesFile()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  await fsp.rename(tmp, profilesFile());
  store = next;
}

const view = (s: Store) => ({ activeId: s.activeId, profiles: s.profiles });

/** Forgets the in-memory copy (tests that switch cache folders). */
export function resetProfilesCache(): void {
  store = null;
}

export async function listProfiles() {
  return view(await load());
}

export async function getProfile(id: string): Promise<DeviceProfile | null> {
  return (await load()).profiles.find((p) => p.id === id) ?? null;
}

/** Creates a profile (no id, or an unknown id) or updates the one with that id. */
export function saveProfile(body: Record<string, unknown>) {
  return serial(async () => {
    const s = await load();
    const id = text(body.id, 64);
    if (id && !/^[A-Za-z0-9_.-]+$/.test(id)) throw new UserError("That profile id is not valid.");
    const prev = id ? s.profiles.find((p) => p.id === id) : undefined;
    if (!prev && s.profiles.length >= MAX_PROFILES) throw new UserError(`You can keep up to ${MAX_PROFILES} profiles.`);
    const profile = build({ ...body, id: id || newId() }, prev);
    const profiles = prev ? s.profiles.map((p) => (p.id === prev.id ? profile : p)) : [...s.profiles, profile];
    await write({ ...s, profiles });
    return { profile, ...view(store!) };
  });
}

export function deleteProfile(id: string) {
  return serial(async () => {
    const s = await load();
    if (!s.profiles.some((p) => p.id === id)) throw new UserError("That profile no longer exists.");
    await write({ activeId: s.activeId === id ? "" : s.activeId, profiles: s.profiles.filter((p) => p.id !== id) });
    return view(store!);
  });
}

/** Marks a profile as the one in use; "" clears it. */
export function setActiveProfile(id: string) {
  return serial(async () => {
    const s = await load();
    if (id && !s.profiles.some((p) => p.id === id)) throw new UserError("That profile no longer exists.");
    await write({ ...s, activeId: id });
    return { profile: s.profiles.find((p) => p.id === id) ?? null, ...view(store!) };
  });
}
