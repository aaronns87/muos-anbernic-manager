// What changed on the card: each device listing is compared with the previous one for the same profile (or volume)
// and the new snapshot is kept in .cache/device-listing-digest.json (relative path to a short size/time hash).

import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { WIFI_ID } from "../catalogue.ts";
import { ctx } from "../context.ts";
import { getProfile, listProfiles } from "./profiles.ts";

const MAX_KEYS = 20;
const MAX_NAMES = 40;

interface ListingGame { f: string; s: number; m?: number }
interface ListingLike { card?: { id?: string }; systems: { folder: string; games: ListingGame[] }[] }

export interface CardChange {
  at: number;
  since: number;
  added: number;
  removed: number;
  changed: number;
  /** A few names of each kind (relative paths), newest comparison only. */
  addedNames: string[];
  removedNames: string[];
  changedNames: string[];
}

export interface CardDiff {
  key: string;
  label: string;
  /** First listing for this key: nothing to compare yet. */
  baseline: boolean;
  checkedAt: number;
  files: number;
  /** Latest comparison (may be all zeros). */
  latest: CardChange | null;
  /** Last comparison that found a difference; kept until the next one. */
  lastChange: CardChange | null;
}

interface Entry { at: number; label: string; files: Record<string, string>; latest: CardChange | null; lastChange: CardChange | null }
type Store = Record<string, Entry>;

const file = () => path.join(ctx.cacheDir, "device-listing-digest.json");
let queue: Promise<unknown> = Promise.resolve();

const hash = (size: number, mtime: number) =>
  createHash("sha1").update(`${size}:${Math.round(mtime || 0)}`).digest("hex").slice(0, 10);

/** Relative path to hash for every ROM in a listing. */
export function listingDigest(listing: ListingLike): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sys of listing.systems) for (const g of sys.games) out[`${sys.folder}/${g.f}`] = hash(g.s, g.m ?? 0);
  return out;
}

export function compareDigests(prev: Record<string, string>, next: Record<string, string>, since: number, at: number): CardChange {
  const added: string[] = [], removed: string[] = [], changed: string[] = [];
  for (const [rel, h] of Object.entries(next)) {
    if (!(rel in prev)) added.push(rel);
    else if (prev[rel] !== h) changed.push(rel);
  }
  for (const rel of Object.keys(prev)) if (!(rel in next)) removed.push(rel);
  const top = (list: string[]) => list.sort().slice(0, MAX_NAMES);
  return {
    at, since,
    added: added.length, removed: removed.length, changed: changed.length,
    addedNames: top(added), removedNames: top(removed), changedNames: top(changed),
  };
}

async function read(): Promise<Store> {
  try {
    const raw = JSON.parse(await fsp.readFile(file(), "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Store : {};
  } catch { return {}; }
}

async function write(store: Store): Promise<void> {
  const keys = Object.keys(store).sort((a, b) => store[b].at - store[a].at).slice(0, MAX_KEYS);
  const kept: Store = {};
  for (const k of keys) kept[k] = store[k];
  await fsp.mkdir(ctx.cacheDir, { recursive: true });
  const tmp = `${file()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(kept) + "\n", { mode: 0o600 });
  await fsp.rename(tmp, file());
}

/** Profile id for the Wi-Fi target when a profile is active, otherwise the volume id. */
export async function digestKey(volume: string): Promise<{ key: string; label: string }> {
  if (volume === WIFI_ID) {
    const active = (await listProfiles()).activeId;
    const profile = active ? await getProfile(active) : null;
    if (profile) return { key: `profile:${profile.id}`, label: profile.label };
  }
  return { key: `volume:${volume || "default"}`, label: volume || "device" };
}

function view(key: string, e: Entry, baseline: boolean): CardDiff {
  return { key, label: e.label, baseline, checkedAt: e.at, files: Object.keys(e.files).length, latest: e.latest, lastChange: e.lastChange };
}

/** Compares a fresh listing with the stored one, stores it, and returns the difference. */
export function recordListing(listing: ListingLike): Promise<CardDiff> {
  const run = async () => {
    const volume = listing.card?.id ?? "";
    const { key, label } = await digestKey(volume);
    const store = await read();
    const prev = store[key];
    const files = listingDigest(listing);
    const now = Date.now();
    const latest = prev ? compareDigests(prev.files, files, prev.at, now) : null;
    const lastChange = latest && (latest.added || latest.removed || latest.changed) ? latest : prev?.lastChange ?? null;
    const entry: Entry = { at: now, label, files, latest, lastChange };
    store[key] = entry;
    await write(store);
    return view(key, entry, !prev);
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

/** The stored comparison for a volume without touching the handheld; null when nothing was listed yet. */
export async function storedCardDiff(volume: string): Promise<CardDiff | null> {
  const { key } = await digestKey(volume);
  const e = (await read())[key];
  return e ? view(key, e, !e.latest) : null;
}
