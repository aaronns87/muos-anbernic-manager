// ROM folders the games library knows: [folder, friendly name, maker, year, category].

export const SYSTEMS: [string, string, string, number | null, string][] = [
  ["A2600", "Atari 2600", "Atari", 1977, "Atari"],
  ["A5200", "Atari 5200", "Atari", 1982, "Atari"],
  ["A7800", "Atari 7800", "Atari", 1986, "Atari"],
  ["A800", "Atari 800", "Atari", 1979, "Atari"],
  ["LYNX", "Atari Lynx", "Atari", 1989, "Atari"],
  ["ATARIST", "Atari ST", "Atari", 1985, "Computers"],
  ["AMIGA", "Commodore Amiga", "Commodore", 1985, "Computers"],
  ["C64", "Commodore 64", "Commodore", 1982, "Computers"],
  ["VIC20", "Commodore VIC-20", "Commodore", 1980, "Computers"],
  ["MSX", "MSX", "Microsoft / ASCII", 1983, "Computers"],
  ["DOS", "MS-DOS", "IBM PC", 1981, "Computers"],
  ["MAME", "MAME", "Multiple Arcade Machine Emulator", null, "Arcade"],
  ["FBNEO", "FinalBurn Neo", "Arcade emulator", null, "Arcade"],
  ["HBMAME", "HBMAME", "Homebrew and hacked arcade", null, "Arcade"],
  ["VARCADE", "Various Arcade", "Mixed arcade boards", null, "Arcade"],
  ["CPS1", "Capcom Play System", "Capcom", 1988, "Arcade"],
  ["CPS2", "Capcom Play System II", "Capcom", 1993, "Arcade"],
  ["CPS3", "Capcom Play System III", "Capcom", 1996, "Arcade"],
  ["NAOMI", "Sega NAOMI", "Sega", 1998, "Arcade"],
  ["ATOMISWAVE", "Sammy Atomiswave", "Sammy", 2003, "Arcade"],
  ["PGM2", "PolyGame Master 2", "IGS", 2007, "Arcade"],
  ["NEOGEO", "Neo Geo", "SNK", 1990, "SNK"],
  ["NEOCD", "Neo Geo CD", "SNK", 1994, "SNK"],
  ["NGP", "Neo Geo Pocket Color", "SNK", 1998, "SNK"],
  ["FC", "Famicom / NES", "Nintendo", 1983, "Nintendo"],
  ["FDS", "Famicom Disk System", "Nintendo", 1986, "Nintendo"],
  ["SFC", "Super Famicom / SNES", "Nintendo", 1990, "Nintendo"],
  ["N64", "Nintendo 64", "Nintendo", 1996, "Nintendo"],
  ["GB", "Game Boy", "Nintendo", 1989, "Nintendo"],
  ["GBC", "Game Boy Color", "Nintendo", 1998, "Nintendo"],
  ["GBA", "Game Boy Advance", "Nintendo", 2001, "Nintendo"],
  ["NDS", "Nintendo DS", "Nintendo", 2004, "Nintendo"],
  ["VB", "Virtual Boy", "Nintendo", 1995, "Nintendo"],
  ["GW", "Game & Watch", "Nintendo", 1980, "Nintendo"],
  ["POKE", "Pokemon Mini", "Nintendo", 2001, "Nintendo"],
  ["SMS", "Sega Master System", "Sega", 1985, "Sega"],
  ["GG", "Sega Game Gear", "Sega", 1990, "Sega"],
  ["MD", "Sega Mega Drive / Genesis", "Sega", 1988, "Sega"],
  ["MDCD", "Sega Mega-CD / Sega CD", "Sega", 1991, "Sega"],
  ["SEGA32X", "Sega 32X", "Sega", 1994, "Sega"],
  ["SATURN", "Sega Saturn", "Sega", 1994, "Sega"],
  ["DREAMCAST", "Sega Dreamcast", "Sega", 1998, "Sega"],
  ["PS", "PlayStation", "Sony", 1994, "Sony"],
  ["PSP", "PlayStation Portable", "Sony", 2004, "Sony"],
  ["PCE", "PC Engine / TurboGrafx-16", "NEC", 1987, "NEC"],
  ["PCECD", "PC Engine CD", "NEC", 1988, "NEC"],
  ["WS", "WonderSwan / Color", "Bandai", 1999, "Bandai"],
  ["PICO", "PICO-8", "Lexaloffle fantasy console", 2015, "Engines & Ports"],
  ["OPENBOR", "OpenBOR", "Beat 'em up engine", null, "Engines & Ports"],
  ["SCUMMVM", "ScummVM", "Point-and-click adventures", null, "Engines & Ports"],  ["EASYRPG", "EasyRPG", "RPG Maker 2000/2003 games", null, "Engines & Ports"],
  ["ONS", "ONScripter", "Visual novels", null, "Engines & Ports"],
  ["JAVA", "J2ME", "Java mobile phone games", null, "Engines & Ports"],
  ["PORTS", "Ports", "Native PC game ports", null, "Engines & Ports"],
];

export const CATEGORIES = ["Arcade", "Nintendo", "Sega", "Sony", "SNK", "NEC", "Atari", "Bandai", "Computers", "Engines & Ports", "Other"];
export const ARCADE = new Set(["MAME", "FBNEO", "HBMAME", "VARCADE", "CPS1", "CPS2", "CPS3", "NAOMI", "ATOMISWAVE", "PGM2", "NEOGEO"]);
export const SKIP_FOLDERS = new Set(["APPS"]);

const ARCADE_PLATFORMS = ["Arcade"];

/** LaunchBox Games Database platforms per ROM folder, best match first. */
export const PLATFORMS: Record<string, string[]> = {
  A2600: ["Atari 2600"], A5200: ["Atari 5200"], A7800: ["Atari 7800"], A800: ["Atari 800"],
  LYNX: ["Atari Lynx"], ATARIST: ["Atari ST"], AMIGA: ["Commodore Amiga"], C64: ["Commodore 64"],
  VIC20: ["Commodore VIC-20"], MSX: ["Microsoft MSX", "Microsoft MSX2"], DOS: ["MS-DOS"],
  MAME: ARCADE_PLATFORMS, HBMAME: ARCADE_PLATFORMS, VARCADE: ARCADE_PLATFORMS,
  CPS1: ARCADE_PLATFORMS, CPS2: ARCADE_PLATFORMS, CPS3: ARCADE_PLATFORMS, PGM2: ARCADE_PLATFORMS,
  FBNEO: ["Arcade", "SNK Neo Geo MVS", "SNK Neo Geo AES"],
  NAOMI: ["Sega Naomi", "Sega Naomi 2", "Arcade"], ATOMISWAVE: ["Sammy Atomiswave", "Arcade"],
  NEOGEO: ["SNK Neo Geo MVS", "SNK Neo Geo AES", "Arcade"], NEOCD: ["SNK Neo Geo CD"],
  NGP: ["SNK Neo Geo Pocket Color", "SNK Neo Geo Pocket"],
  FC: ["Nintendo Entertainment System"], FDS: ["Nintendo Famicom Disk System"],
  SFC: ["Super Nintendo Entertainment System"], N64: ["Nintendo 64"], GB: ["Nintendo Game Boy"],
  GBC: ["Nintendo Game Boy Color"], GBA: ["Nintendo Game Boy Advance"], NDS: ["Nintendo DS"],
  VB: ["Nintendo Virtual Boy"], GW: ["Nintendo Game & Watch"], POKE: ["Nintendo Pokemon Mini"],
  SMS: ["Sega Master System"], GG: ["Sega Game Gear"], MD: ["Sega Genesis"], MDCD: ["Sega CD"],
  SEGA32X: ["Sega 32X"], SATURN: ["Sega Saturn"], DREAMCAST: ["Sega Dreamcast"],
  PS: ["Sony Playstation"], PSP: ["Sony PSP", "Sony PSP Minis"],
  PCE: ["NEC TurboGrafx-16"], PCECD: ["NEC TurboGrafx-CD"], WS: ["WonderSwan", "WonderSwan Color"],
  PICO: ["PICO-8"], OPENBOR: ["OpenBOR"], SCUMMVM: ["ScummVM"], PORTS: ["Linux", "Windows", "MS-DOS"],
};

/** Platforms whose games go into the description index. */
export const INDEXED_PLATFORMS = new Set([
  "Arcade", "Sega Naomi", "Sega Naomi 2", "Sammy Atomiswave", "SNK Neo Geo AES", "SNK Neo Geo MVS",
  "SNK Neo Geo CD", "SNK Neo Geo Pocket", "SNK Neo Geo Pocket Color",
  "Atari 2600", "Atari 5200", "Atari 7800", "Atari 800", "Atari Lynx", "Atari ST",
  "Commodore Amiga", "Commodore 64", "Commodore VIC-20", "Microsoft MSX", "Microsoft MSX2", "MS-DOS",
  "Nintendo Entertainment System", "Nintendo Famicom Disk System", "Super Nintendo Entertainment System",
  "Nintendo 64", "Nintendo Game Boy", "Nintendo Game Boy Color", "Nintendo Game Boy Advance",
  "Nintendo DS", "Nintendo Virtual Boy", "Nintendo Game & Watch", "Nintendo Pokemon Mini",
  "Sega Master System", "Sega Game Gear", "Sega Genesis", "Sega CD", "Sega 32X", "Sega Saturn",
  "Sega Dreamcast", "Sony Playstation", "Sony PSP", "Sony PSP Minis",
  "NEC TurboGrafx-16", "NEC TurboGrafx-CD", "WonderSwan", "WonderSwan Color",
  "PICO-8", "OpenBOR", "ScummVM", "Linux", "Windows",
]);

const TAG = /\s*[([][^)\]]*[)\]]/g;

/** Title key used to match ROM names with database names. */
export function norm(title: string): string {
  let t = title.toLowerCase().replace(TAG, "").replaceAll("&", " and ");
  t = t.trim().replace(/^(the|a|an)\s+/, "");
  t = t.replace(/,\s*(the|a|an)\b/g, "");
  return t.replace(/[^a-z0-9]+/g, "");
}
