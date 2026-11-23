// Library health for Overview: one list of checks built only from data the manager already has in memory or cached
// (library scan, BIOS catalogue cache, last verify run, Syncthing probe). It never walks Roms/ or hashes ROMs.

import { biosHealth } from "../bios.ts";
import { verifyHealth } from "../checks.ts";
import { sshStatus } from "../device/ssh.ts";
import { syncthingIdleJson } from "../device/syncthing.ts";
import { getLibrary } from "../games/library.ts";

export type HealthSeverity = "ok" | "warn" | "bad" | "info";
export interface HealthItem { id: string; severity: HealthSeverity; label: string; detail: string; href: string }

const SYNCTHING_TIMEOUT = 15_000;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const list = (names: string[], max = 3) => names.length > max ? `${names.slice(0, max).join(", ")} and ${names.length - max} more` : names.join(", ");

async function artworkItem(): Promise<HealthItem> {
  const library = await getLibrary();
  const { games, art } = library.totals;
  const href = "#artwork";
  if (!games) return { id: "artwork", severity: "info", label: "Artwork", detail: "No games in Roms/ yet.", href: "#games" };
  const missing = games - art;
  if (!missing) return { id: "artwork", severity: "ok", label: "Artwork", detail: `All ${plural(games, "game")} have box art.`, href };
  const worst = library.systems
    .map((s) => ({ code: s.code, n: s.games.filter((g) => !g.i).length }))
    .filter((s) => s.n)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((s) => `${s.code} ${s.n.toLocaleString()}`);
  return { id: "artwork", severity: "warn", label: "Missing artwork", detail: `${plural(missing, "game")} without box art (${Math.floor((art / games) * 100)}% covered)${worst.length ? `: ${worst.join(", ")}` : ""}.`, href };
}

async function biosItem(): Promise<HealthItem> {
  const library = await getLibrary();
  const folders = library.systems.filter((s) => s.games.length).map((s) => s.code);
  const href = "#emulation/bios";
  if (!folders.length) return { id: "bios", severity: "info", label: "BIOS", detail: "No games in Roms/ yet.", href };
  const r = await biosHealth(folders);
  if (!r.catalog) return { id: "bios", severity: "info", label: "BIOS", detail: "Open BIOS once with the handheld on Wi-Fi to load its BIOS list; gaps show here afterwards.", href };
  if (r.required.length) {
    return { id: "bios", severity: "bad", label: "BIOS missing", detail: `Required BIOS files are missing for ${list(r.required)}${r.optional.length ? `; optional ones for ${list(r.optional)}` : ""}.`, href };
  }
  if (r.optional.length) return { id: "bios", severity: "warn", label: "BIOS optional", detail: `No BIOS files yet for ${list(r.optional)}.`, href };
  return { id: "bios", severity: "ok", label: "BIOS", detail: `Nothing missing for ${plural(r.checked, "system")} with games.`, href };
}

async function verifyItem(): Promise<HealthItem> {
  const v = await verifyHealth();
  const href = "#emulation/checks";
  if (v.running) return { id: "verify", severity: "info", label: "Library check", detail: "A ROM check is running.", href };
  if (!v.ran) return { id: "verify", severity: "info", label: "Library check", detail: "ROMs have not been checked against No-Intro yet.", href };
  const { bad, modified, unknown, ok } = v.counts;
  const when = v.checked ? ` (${v.checked.slice(0, 10)})` : "";
  if (bad) return { id: "verify", severity: "bad", label: "Bad ROM dumps", detail: `${plural(bad, "ROM")} failed the No-Intro check${modified ? `, ${modified.toLocaleString()} modified` : ""}${when}.`, href };
  if (modified || v.errors) {
    const parts = [modified && `${plural(modified, "ROM")} modified`, v.errors && `${plural(v.errors, "system")} could not be checked`].filter(Boolean);
    return { id: "verify", severity: "warn", label: "Library check", detail: `${parts.join(", ")}${when}.`, href };
  }
  return { id: "verify", severity: "ok", label: "Library check", detail: `${plural(ok, "ROM")} verified${unknown ? `, ${unknown.toLocaleString()} not in the lists` : ""}${when}.`, href };
}

async function syncthingItem(): Promise<HealthItem> {
  const href = "#handheld/settings";
  const status = await sshStatus();
  if (!status.configured || !status.reachable) {
    return { id: "syncthing", severity: "info", label: "Syncthing", detail: "Connect over Wi-Fi with Secure Shell to see whether Syncthing is busy.", href };
  }
  const snap = await Promise.race([
    syncthingIdleJson(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SYNCTHING_TIMEOUT)),
  ]);
  if (!snap) return { id: "syncthing", severity: "info", label: "Syncthing", detail: "The handheld did not answer in time.", href };
  return snap.syncing
    ? { id: "syncthing", severity: "warn", label: "Syncthing busy", detail: `${snap.detail} Wait before large copies.`, href }
    : { id: "syncthing", severity: "ok", label: "Syncthing", detail: snap.detail, href };
}

const CHECKS: [string, string, () => Promise<HealthItem>][] = [
  ["artwork", "Artwork", artworkItem],
  ["bios", "BIOS", biosItem],
  ["verify", "Library check", verifyItem],
  ["syncthing", "Syncthing", syncthingItem],
];

/** Health items for Overview. A check that fails shows as info instead of failing the whole list. */
export async function overviewHealthJson() {
  const settled = await Promise.all(CHECKS.map(async ([id, label, run]): Promise<HealthItem> => {
    try { return await run(); }
    catch (error) { return { id, severity: "info", label, detail: `Could not check: ${(error as Error).message}`, href: "#overview" }; }
  }));
  const summary = { ok: 0, warn: 0, bad: 0 };
  for (const item of settled) if (item.severity !== "info") summary[item.severity]++;
  return { ok: summary.bad === 0, generatedAt: new Date().toISOString(), items: settled, summary };
}
