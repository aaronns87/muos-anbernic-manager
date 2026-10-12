// Outline drawings of each system's hardware, tinted with the system's accent colour.
// Drawn on a 48 x 32 grid; paths with class "b" are the body and get a light fill.

const SHAPES = {
  cabinet: `<path class="b" d="M15 2h18a1 1 0 0 1 1 1v18l2 3v6H12v-6l2-3V3a1 1 0 0 1 1-1z"/><path d="M14 7h20M14 21h20"/><rect x="17" y="9.5" width="14" height="9" rx="1"/><path d="M19 25v-2.5"/><circle cx="19" cy="22" r="1"/><circle cx="26" cy="24.5" r=".9"/><circle cx="29.5" cy="24.5" r=".9"/>`,
  tall: `<path class="b" d="M18 1h12a2 2 0 0 1 2 2v21a7 7 0 0 1-7 7h-7a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z"/><rect x="19" y="4" width="10" height="9" rx="1"/><path d="M19.5 20h4.5M21.75 17.75v4.5"/><circle cx="27" cy="20.5" r="1.1"/><circle cx="29.3" cy="18.3" r="1.1"/><path d="M25 27.5l1.5-1.5M27 28.5l1.5-1.5"/>`,
  wide: `<rect class="b" x="2" y="8" width="44" height="17" rx="8.5"/><rect x="16" y="10.5" width="16" height="12" rx="1"/><path d="M6 16.5h5M8.5 14v5"/><circle cx="38.5" cy="18" r="1.2"/><circle cx="41.3" cy="15.2" r="1.2"/>`,
  psp: `<rect class="b" x="1.5" y="9" width="45" height="15" rx="7.5"/><rect x="12" y="11" width="24" height="11" rx="1"/><path d="M5 16.5h4.5M7.25 14.25v4.5"/><circle cx="41" cy="14" r=".9"/><circle cx="41" cy="19" r=".9"/><circle cx="38.5" cy="16.5" r=".9"/><circle cx="43.5" cy="16.5" r=".9"/>`,
  ds: `<rect class="b" x="12" y="1" width="24" height="13.5" rx="2"/><rect x="16" y="3.5" width="16" height="9" rx=".8"/><rect class="b" x="12" y="16.5" width="24" height="14.5" rx="2"/><rect x="18" y="18.5" width="12" height="9" rx=".8"/><path d="M13.5 22.5h3M15 21v3"/><circle cx="33" cy="22.5" r=".8"/>`,
  gw: `<rect class="b" x="5" y="6" width="38" height="20" rx="2.5"/><rect x="13" y="9" width="22" height="14" rx="1"/><circle cx="9" cy="20" r="1.6"/><circle cx="39" cy="20" r="1.6"/><path d="M8 11h2M38 11h2"/>`,
  vb: `<rect class="b" x="5" y="4" width="38" height="14" rx="3"/><rect x="13" y="8" width="9" height="6" rx="1.2"/><rect x="26" y="8" width="9" height="6" rx="1.2"/><path d="M24 18v7M17 30l7-5 7 5"/>`,
  atari: `<path class="b" d="M4 19l6-9h28l6 9v8H4z"/><rect x="20" y="11.5" width="8" height="3" rx=".5"/><path d="M13 12v6M16 12v6M32 12v6M35 12v6M4 22h40"/>`,
  nes: `<rect class="b" x="4" y="9" width="40" height="17" rx="1.5"/><path d="M4 16.5h40"/><rect x="15" y="11" width="22" height="3.5" rx=".5"/><rect x="7" y="11.2" width="4" height="2.2" rx=".5"/><rect x="7" y="20" width="3" height="3"/><rect x="12" y="20" width="3" height="3"/>`,
  fds: `<path d="M17 16V5h14v11"/><rect x="20" y="7" width="8" height="4" rx=".5"/><rect class="b" x="6" y="15" width="36" height="12" rx="1.5"/><path d="M14 18.5h20M36 23h3"/>`,
  snes: `<rect x="16" y="6.5" width="16" height="5" rx="1"/><rect class="b" x="4" y="10" width="40" height="16" rx="5"/><rect x="8" y="16" width="5" height="2.2" rx="1.1"/><rect x="35" y="16" width="5" height="2.2" rx="1.1"/><path d="M18 22h12"/>`,
  n64: `<path class="b" d="M9 9h30a3 3 0 0 1 3 3v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V12a3 3 0 0 1 3-3z"/><rect x="18" y="8" width="12" height="5.5" rx="1"/><rect x="12" y="20.5" width="4" height="3" rx=".5"/><rect x="18" y="20.5" width="4" height="3" rx=".5"/><rect x="26" y="20.5" width="4" height="3" rx=".5"/><rect x="32" y="20.5" width="4" height="3" rx=".5"/>`,
  md: `<rect class="b" x="4" y="11" width="40" height="15" rx="3.5"/><circle cx="27" cy="18.5" r="6"/><path d="M23 16.5h8M8 15.5h8M8 18.5h8M8 21.5h8"/>`,
  sms: `<path class="b" d="M4 15l4-5h32l4 5v12H4z"/><rect x="14" y="11.5" width="20" height="3" rx=".5"/><path d="M4 19h40M36 23h4"/>`,
  s32x: `<path class="b" d="M17 15v-6c0-3 3-5 7-5s7 2 7 5v6"/><rect class="b" x="4" y="15" width="40" height="13" rx="3.5"/><path d="M20 9h8M8 19h8M8 22h8"/><circle cx="29" cy="21.5" r="4"/>`,
  mdcd: `<rect class="b" x="7" y="3" width="34" height="10" rx="2.5"/><circle cx="28" cy="8" r="3.5"/><path d="M10 6.5h8M10 9.5h8"/><rect class="b" x="4" y="15" width="40" height="13" rx="2"/><path d="M11 21.5h26M37 25h3"/>`,
  ps: `<rect class="b" x="4" y="9" width="40" height="17" rx="2.5"/><circle cx="17" cy="17.5" r="6"/><circle cx="17" cy="17.5" r="1.4"/><circle cx="33" cy="13.5" r="1.4"/><circle cx="38" cy="13.5" r="1.4"/><rect x="30" y="20" width="4" height="2.5" rx=".5"/><rect x="36" y="20" width="4" height="2.5" rx=".5"/>`,
  disc: `<rect class="b" x="4" y="9" width="40" height="17" rx="4"/><circle cx="24" cy="17.5" r="6"/><circle cx="24" cy="17.5" r="1.4"/><path d="M8 14h6M8 17h6M34 14h6M34 17h6"/>`,
  dc: `<rect class="b" x="8" y="5" width="32" height="23" rx="4"/><circle cx="24" cy="14" r="6.5"/><circle cx="24" cy="14" r="1.5"/><path d="M8 22.5h32"/><rect x="12" y="24.5" width="4" height="2" rx=".5"/><rect x="18" y="24.5" width="4" height="2" rx=".5"/><rect x="26" y="24.5" width="4" height="2" rx=".5"/><rect x="32" y="24.5" width="4" height="2" rx=".5"/>`,
  pce: `<rect x="17" y="4" width="14" height="8" rx="1"/><path d="M20 7h8"/><rect class="b" x="9" y="11" width="30" height="16" rx="2.5"/><path d="M9 15.5h30M13 22h7M28 19v5M31 19v5M34 19v5"/>`,
  keyboard: `<path class="b" d="M3 27l3-13h36l3 13z"/><path stroke-dasharray="2 1.3" d="M10 17.5h28M9 20.5h30M8 23.5h24"/><path d="M19 25h10M35 23.5h4"/>`,
  computer: `<rect class="b" x="12" y="1.5" width="24" height="16" rx="2"/><rect x="15" y="4.5" width="18" height="10" rx=".8"/><path d="M22 17.5v2h4v-2"/><path class="b" d="M5 30l2-8h34l2 8z"/><path stroke-dasharray="2 1.3" d="M10 25h28M9 27.5h22"/>`,
  pc: `<rect class="b" x="4" y="3" width="26" height="19" rx="2"/><rect x="7" y="6" width="20" height="13" rx=".8"/><path d="M15 22v3h4v-3M12 26.5h10"/><rect class="b" x="34" y="5" width="10" height="22" rx="1"/><path d="M36.5 9h5M36.5 12h5"/><circle cx="39" cy="22" r="1"/>`,
  pico: `<rect class="b" x="14" y="2" width="20" height="28" rx="3"/><rect x="17" y="5" width="14" height="11" rx="1"/><path class="f" d="M24 14l-3-3a1.6 1.6 0 0 1 3-1.6 1.6 1.6 0 0 1 3 1.6z"/><path d="M18.5 22h4M20.5 20v4"/><circle cx="27" cy="22.5" r="1"/><circle cx="29.5" cy="20.5" r="1"/>`,
  phone: `<rect class="b" x="17" y="1" width="14" height="30" rx="3"/><rect x="19.5" y="4" width="9" height="8" rx=".8"/><g class="f"><circle cx="21" cy="16" r=".8"/><circle cx="24" cy="16" r=".8"/><circle cx="27" cy="16" r=".8"/><circle cx="21" cy="19.5" r=".8"/><circle cx="24" cy="19.5" r=".8"/><circle cx="27" cy="19.5" r=".8"/><circle cx="21" cy="23" r=".8"/><circle cx="24" cy="23" r=".8"/><circle cx="27" cy="23" r=".8"/><circle cx="24" cy="26.5" r=".8"/></g>`,
  cursor: `<path class="b" d="M17 3v21l5.5-5 4 9 3.5-1.6-4-8.8H33z"/>`,
  sword: `<path class="b" d="M33 3h4v4L22 22l-4-4z"/><path d="M14 18l8 8M16.5 24.5L12 29M30 6L19 17"/>`,
  book: `<path class="b" d="M7 6h11a5 5 0 0 1 5 5v17a3 3 0 0 0-3-3H7z"/><path class="b" d="M41 6H30a5 5 0 0 0-5 5v17a3 3 0 0 1 3-3h13z"/><path d="M11 11h7M11 15h7M30 11h7M30 15h7"/>`,
  fist: `<path class="b" d="M12 12a3 3 0 0 1 6 0 3 3 0 0 1 6 0 3 3 0 0 1 6 0v1a3 3 0 0 1 5 2v5c0 5-4 9-9 9h-6c-5 0-8-3-8-8z"/><path d="M18 12v5M24 12v5M30 12v5M14 21h10"/>`,
  pad: `<path class="b" d="M14 8h20a9 9 0 0 1 9 9v2a6 6 0 0 1-10.6 3.9L30 20H18l-2.4 2.9A6 6 0 0 1 5 19v-2a9 9 0 0 1 9-9z"/><path d="M12 13v6M9 16h6"/><circle cx="33" cy="14.5" r="1.3"/><circle cx="36.5" cy="18" r="1.3"/>`,
};

const BY_CODE = {
  MAME: "cabinet", FBNEO: "cabinet", HBMAME: "cabinet", VARCADE: "cabinet", CPS1: "cabinet", CPS2: "cabinet",
  CPS3: "cabinet", NAOMI: "cabinet", ATOMISWAVE: "cabinet", PGM2: "cabinet", NEOGEO: "cabinet",
  NEOCD: "disc", NGP: "wide",
  A2600: "atari", A5200: "atari", A7800: "atari", LYNX: "wide",
  A800: "keyboard", C64: "keyboard", VIC20: "keyboard", MSX: "keyboard", ATARIST: "computer", AMIGA: "computer", DOS: "pc",
  FC: "nes", FDS: "fds", SFC: "snes", N64: "n64", GB: "tall", GBC: "tall", GBA: "wide", NDS: "ds", VB: "vb", GW: "gw", POKE: "tall",
  SMS: "sms", GG: "wide", MD: "md", MDCD: "mdcd", SEGA32X: "s32x", SATURN: "disc", DREAMCAST: "dc",
  PS: "ps", PSP: "psp", PCE: "pce", PCECD: "disc", WS: "wide",
  PICO: "pico", OPENBOR: "fist", SCUMMVM: "cursor", EASYRPG: "sword", ONS: "book", JAVA: "phone", PORTS: "pad",
};

/** The drawing for a ROM folder code, falling back to a game pad. */
export function consoleIcon(code, cls = "console") {
  const shape = SHAPES[BY_CODE[String(code).toUpperCase()]] || SHAPES.pad;
  return `<svg class="${cls}" viewBox="0 0 48 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>`;
}
