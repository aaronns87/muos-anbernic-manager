// Why MustardOS may have no system for a ROM folder the games library knows, and what to do about it.
// extra: missing from MustardOS 2601 Jacaranda; newer versions offer these as optional extra cores.
// use: runs under another MustardOS system, with the cores named in how. none: no MustardOS core runs it.

import { esc } from "./core.js";

const EXTRA_PATH = "Configuration &rsaquo; Advanced Settings &rsaquo; Extra Cores";

const NOTES = {
  A5200: { extra: ["a5200", "Atari800"] },
  A7800: { extra: ["ProSystem"] },
  A800: { extra: ["Atari800"] },
  ATARIST: { extra: ["Hatari"] },
  VIC20: { extra: ["VICE"] },
  MSX: { extra: ["blueMSX", "fMSX"] },
  NDS: { extra: ["melonDS", "DeSmuME 2015"] },
  VB: { extra: ["Beetle VB"] },
  GW: { extra: ["Game & Watch"] },
  POKE: { extra: ["PokeMini"] },
  SATURN: { extra: ["YabaSanshiro", "Yabause", "Beetle Saturn"], tip: "The Saturn is hard to emulate: even with a core, expect many games to run slowly on these handhelds." },
  WS: { extra: ["Beetle WonderSwan"] },
  EASYRPG: { extra: ["EasyRPG"] },
  ONS: { extra: ["ONScripter", "ONScripter-Yuri"] },
  JAVA: { extra: ["FreeJ2ME"] },
  MAME: { use: "Arcade", how: "one of its MAME 2003 cores", core: "mame 2003" },
  FBNEO: { use: "Arcade", how: "the FinalBurn Neo core", core: "finalburn neo" },
  CPS1: { use: "Arcade", how: "the FinalBurn Neo core", core: "finalburn neo" },
  CPS2: { use: "Arcade", how: "the FinalBurn Neo core", core: "finalburn neo" },
  CPS3: { use: "Arcade", how: "the FinalBurn Neo core", core: "finalburn neo" },
  FDS: { use: "Nintendo NES - Famicom", how: "FCEUmm or Nestopia, with disksys.rom in the BIOS folder", core: "fceumm" },
  PGM2: { none: "PolyGame Master 2 games need a recent MAME. MustardOS's arcade cores (FinalBurn Neo, FB Alpha 2012, MAME 2003) do not run them." },
  OPENBOR: { none: "MustardOS has no OpenBOR core, so these games do not run on the handheld." },
};

/** The MustardOS system to pick for a folder whose name matches none, when its games run under another one. */
export const useSystem = (folder) => NOTES[String(folder).toUpperCase()]?.use || "";

/** The key of the core the note recommends among a system's cores, or "". */
export function useCore(folder, cores = []) {
  const want = NOTES[String(folder).toUpperCase()]?.core;
  return (want && (cores.find((c) => c.key.toLowerCase() === want) || cores.find((c) => c.key.toLowerCase().startsWith(want)))?.key) || "";
}

/** What kind of note a folder has: extra, use, none, or "" when the manager knows nothing about it. */
export function noteKind(folder) {
  const n = NOTES[String(folder).toUpperCase()];
  return n ? (n.extra ? "extra" : n.use ? "use" : "none") : "";
}

/** Why MustardOS has no system for this folder and what to do, as HTML; name is the system's friendly name. */
export function systemNote(folder, name = "", inCores = true) {
  const n = NOTES[String(folder).toUpperCase()];
  const label = esc(name || folder);
  const where = inCores ? "with <b>Change</b>" : "in the Cores tab";
  if (!n) return `MustardOS has no system called ${esc(folder)}. If the folder holds games for a system it does have, pick that system ${where}.`;
  if (n.use) return `MustardOS has no ${label} system of its own: these games run under <b>${esc(n.use)}</b> with ${esc(n.how)}. Pick ${esc(n.use)} for the folder ${where}.`;
  if (n.none) return esc(n.none);
  const tip = n.tip ? ` ${esc(n.tip)}` : "";
  return `${label} is not part of MustardOS 2601 Jacaranda. Newer MustardOS versions offer optional cores for it (${n.extra.map(esc).join(", ")}) under ${EXTRA_PATH}.${tip}`;
}
