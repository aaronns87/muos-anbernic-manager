// MustardOS layout facts shared by the device code.
// MustardOS binds MUOS/info/catalogue from SD2 (TF2) when that folder exists there, otherwise from SD1.
// Scrappy saves to <catalogue>/<System>/{box,preview,splash}/<rom stem>.png.

export const ROMS_DIR = "ROMS";
export const USB_ID = "usb";
export const WIFI_ID = "wifi";
export const EXCLUDED_TOP = new Set(["APPS", "PORTS"]);
export const FAT32_LIMIT = 4 * 1024 ** 3;
export const CATALOGUE_PATH = ["MUOS", "info", "catalogue"];
export const ART_KINDS = ["box", "preview", "splash"] as const;
export type ArtKind = (typeof ART_KINDS)[number];
export const CATALOGUE_EXTRAS = new Set(["application", "archive", "collection", "folder", "root", "task", "theme"]);
export const NOT_ROMS = new Set(["xml", "txt", "db", "ini", "cfg", "json", "png", "jpg", "jpeg", "gif", "webp",
  "nfo", "srm", "sav", "state", "log", "bak", "dat", "md5", "sha1", "url"]);
export const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

/** Catalogue folder names per ROM folder: MustardOS core.json names first, then Scrappy's own spellings. */
export const CATALOGUES: Record<string, string[]> = {
  A2600: ["Atari 2600"], A5200: ["Atari 5200"], A7800: ["Atari 7800"],
  A800: ["Atari 800", "Atari 8-bit Family"], AMIGA: ["Commodore Amiga"],
  ATARIST: ["Atari ST-STE-TT-Falcon"], ATOMISWAVE: ["Sega Atomiswave Naomi"], C64: ["Commodore C64"],
  CPS1: ["Arcade"], CPS2: ["Arcade"], CPS3: ["Arcade"], FBNEO: ["Arcade"], HBMAME: ["Arcade"],
  MAME: ["Arcade"], PGM2: ["Arcade"], VARCADE: ["Arcade"], DOS: ["PC DOS", "DOS"],
  DREAMCAST: ["Sega Dreamcast"], EASYRPG: ["RPG Maker 2000 - 2003"], FC: ["Nintendo NES - Famicom"],
  FDS: ["Nintendo Famicom Disk System", "Nintendo FDS"], GB: ["Nintendo Game Boy"],
  GBA: ["Nintendo Game Boy Advance"], GBC: ["Nintendo Game Boy Color"], GG: ["Sega Game Gear"],
  GW: ["Handheld Electronic - Game and Watch"], JAVA: ["Java J2ME"], LYNX: ["Atari Lynx"],
  MD: ["Sega Mega Drive - Genesis"], MDCD: ["Sega Mega CD - Sega CD"],
  MSX: ["Microsoft MSX", "MSX-SVI-ColecoVision-SG1000"], N64: ["Nintendo N64"],
  NAOMI: ["Sega Atomiswave Naomi"], NDS: ["Nintendo DS"], NEOCD: ["SNK Neo Geo CD"],
  NEOGEO: ["SNK Neo Geo"], NGP: ["SNK Neo Geo Pocket - Color"], ONS: ["Onscripter"],
  OPENBOR: ["OpenBOR"], PCE: ["NEC PC Engine"], PCECD: ["NEC PC Engine CD"], PICO: ["PICO-8"],
  POKE: ["Nintendo Pokemon Mini"], PS: ["Sony PlayStation"], PSP: ["Sony PlayStation Portable"],
  SATURN: ["Sega Saturn"], SCUMMVM: ["ScummVM"], SEGA32X: ["Sega 32X"], SFC: ["Nintendo SNES - SFC"],
  SMS: ["Sega Master System"], VB: ["Nintendo Virtual Boy"], VIC20: ["Commodore VIC-20"],
  WS: ["Bandai WonderSwan Color"],
};

export function normName(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** ROM folders per normalised catalogue name. */
export const CATALOGUE_SYSTEMS = new Map<string, string[]>();
for (const [code, names] of Object.entries(CATALOGUES)) {
  for (const name of names) {
    const key = normName(name);
    CATALOGUE_SYSTEMS.set(key, [...(CATALOGUE_SYSTEMS.get(key) ?? []), code]);
  }
}

export function isArtFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return !name.startsWith(".") && !name.includes("/") && dot > 0 && IMAGE_EXTS.has(name.slice(dot + 1).toLowerCase());
}

export const EMPTY_OVER_USB = "The handheld shows its cards as empty over USB, so nothing can be read or copied. On the "
  + "handheld set Advanced Settings > USB Function to None and back to MTP (or restart it with MTP on), then reconnect "
  + "the cable.";
