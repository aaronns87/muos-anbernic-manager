// Handheld settings: the MustardOS options from the device's own Settings screens, read and written over SSH.
// muOS keeps each option as a one-line file under /opt/muos/config (settings/general/volume holds "28"). Only
// options listed here can be changed, only to the values the device menus offer, and only when the file exists on
// the handheld (other muOS versions have other options). Old values are kept locally so a save can be undone.

import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { say } from "../log.ts";
import { runningVersion } from "../updates.ts";
import { runCommand, sshStatus } from "./ssh.ts";

const CONFIG = "/opt/muos/config";

/** How a change reaches the running handheld. */
type Apply =
  | "bright" | "volume" // the device scripts set the hardware and store the value
  | "tweak" // /opt/muos/script/mux/tweak.sh, what the device runs after its General and Advanced screens
  | "services" // /opt/muos/script/web/service.sh starts or stops web services to match
  | "live" // read every time it is used
  | "menu" // the menu reads it when a screen loads
  | "network" // used when Wi-Fi connects
  | "boot" // used when the handheld starts
  | "reboot"; // only shows after a restart

type Option = [value: string, label: string];

interface Setting {
  key: string;
  label: string;
  help: string;
  kind: "toggle" | "select" | "range" | "text";
  apply: Apply;
  options?: Option[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Options or limits read from the handheld. */
  dyn?: "bright" | "volume" | "governors" | "languages";
  /** Pattern for text values. */
  pattern?: RegExp;
  /** Asked before saving a change to this option. */
  warn?: string;
  /** Hardware the setting is for; models without it do not show it. */
  needs?: "stick" | "lid" | "rumble";
}

interface Group {
  id: string;
  title: string;
  icon: string;
  intro: string;
  advanced?: boolean;
  items: Setting[];
}

const DISABLED_ENABLED: Option[] = [["0", "Disabled"], ["1", "Enabled"]];
const toggle = (key: string, label: string, help: string, apply: Apply, extra: Partial<Setting> = {}): Setting =>
  ({ key, label, help, kind: "toggle", apply, options: DISABLED_ENABLED, ...extra });
const select = (key: string, label: string, help: string, apply: Apply, options: Option[], extra: Partial<Setting> = {}): Setting =>
  ({ key, label, help, kind: "select", apply, options, ...extra });
const range = (key: string, label: string, help: string, apply: Apply, min: number, max: number, extra: Partial<Setting> = {}): Setting =>
  ({ key, label, help, kind: "range", apply, min, max, step: 1, ...extra });

const IDLE: Option[] = [["0", "Disabled"], ["10", "10 seconds"], ["30", "30 seconds"], ["60", "1 minute"], ["120", "2 minutes"],
  ["300", "5 minutes"], ["600", "10 minutes"], ["900", "15 minutes"], ["1800", "30 minutes"]];
const SLEEP: Option[] = [["-2", "Disabled"], ["-1", "Sleep until woken"], ["2", "Shut down right away"],
  ["10", "Sleep 10 s, then shut down"], ["30", "Sleep 30 s, then shut down"], ["60", "Sleep 1 min, then shut down"],
  ["120", "Sleep 2 min, then shut down"], ["300", "Sleep 5 min, then shut down"], ["600", "Sleep 10 min, then shut down"],
  ["900", "Sleep 15 min, then shut down"], ["1800", "Sleep 30 min, then shut down"], ["3600", "Sleep 60 min, then shut down"]];
const MUSIC: Option[] = [["0", "Disabled"], ["1", "Global"], ["2", "From the theme"]];

export const GROUPS: Group[] = [
  {
    id: "general", title: "General", icon: "handheld", intro: "Brightness, volume, language and what the handheld starts into.",
    items: [
      range("settings/general/brightness", "Screen brightness", "Changes the screen right away.", "bright", 1, 255, { dyn: "bright" }),
      range("settings/general/volume", "Volume", "Changes the speaker volume right away.", "volume", 0, 100, { dyn: "volume", unit: "%" }),
      select("settings/general/startup", "Start into", "Where the handheld goes after it boots.", "boot", [
        ["launcher", "Main menu"], ["explore", "Content explorer"], ["collection", "Collections"], ["history", "History"],
        ["last", "Last game played"], ["resume", "Resume the last game"],
      ]),
      select("settings/general/language", "Language", "The menu language. Shows after a restart.", "reboot", [], { dyn: "languages" }),
    ],
  },
  {
    id: "power", title: "Power", icon: "power", intro: "Sleep, screen dimming and the low battery warning.",
    items: [
      select("settings/power/shutdown", "Power button (short press)", "What a short press of the power button does.", "live", SLEEP),
      select("settings/power/idle_display", "Dim the screen after", "Time without input before the screen dims. Must be shorter than the sleep time.", "live", IDLE),
      select("settings/power/idle_sleep", "Sleep after", "Time without input before the handheld goes to sleep.", "live", IDLE),
      toggle("settings/power/idle_mute", "Mute when the screen dims", "Silences the audio while the display is dimmed.", "live"),
      range("settings/power/low_battery", "Low battery warning", "Battery level at which the red LED comes on.", "live", 0, 100, { unit: "%" }),
      select("settings/power/gov_idle", "Idle CPU governor", "The CPU governor used while there is no input.", "live", [], { dyn: "governors" }),
    ],
  },
  {
    id: "interface", title: "Interface", icon: "eye", intro: "What the menus show: status icons, names and counters in Explore Content.",
    items: [
      toggle("visual/battery", "Battery icon", "Shows the battery icon in the header.", "menu"),
      toggle("visual/network", "Network icon", "Shows the Wi-Fi icon in the header.", "menu"),
      toggle("visual/clock", "Clock", "Shows the clock in the header.", "menu"),
      select("visual/name", "Game names", "Hides extra information from names on screen. Files are not renamed.", "menu", [
        ["0", "Full name"], ["1", "Remove [ ]"], ["2", "Remove ( )"], ["3", "Remove [ ] and ( )"],
      ]),
      toggle("visual/dash", "Dash to colon", "Shows \"Zelda - Minish Cap\" as \"Zelda: Minish Cap\".", "menu"),
      toggle("visual/thetitleformat", "Move \"The\" to the front", "Shows \"Batman and Robin, The\" as \"The Batman and Robin\".", "menu"),
      toggle("visual/friendlyfolder", "Friendly folder names", "Shows full system names for short folder names like GBA.", "menu"),
      toggle("visual/titleincluderootdrive", "Storage in the title", "Shows the storage card along with the folder name in Explore Content.", "menu"),
      toggle("visual/folderitemcount", "Folder item count", "Shows how many items each folder holds.", "menu"),
      toggle("visual/folderempty", "Empty folders", "Lists folders that hold no games.", "menu"),
      toggle("visual/counterfolder", "Folder counter", "Shows the selected folder number and the total.", "menu"),
      toggle("visual/counterfile", "File counter", "Shows the selected game number and the total.", "menu"),
      toggle("visual/mixedcontent", "Mix folders with games", "Sorts folders in alphabetically between games instead of listing them first.", "menu"),
      toggle("visual/hidden", "Hidden content", "Shows files and folders whose names start with . or _.", "menu"),
      toggle("visual/contentcollect", "Collections in Explore Content", "Shows collections inside Explore Content.", "menu"),
      toggle("visual/contenthistory", "History in Explore Content", "Shows the history inside Explore Content.", "menu"),
    ],
  },
  {
    id: "content", title: "Box art and launching", icon: "image", intro: "How box art is shown and what happens when a game starts.",
    items: [
      select("visual/boxart", "Box art", "Where the artwork sits relative to the game list.", "menu", [
        ["0", "Behind the list"], ["1", "In front of the list"], ["2", "Full screen, behind"], ["3", "Full screen, in front"], ["4", "Hidden"],
      ]),
      select("visual/boxartalign", "Box art position", "Where on screen the artwork is placed.", "menu", [
        ["1", "Top left"], ["2", "Top middle"], ["3", "Top right"], ["4", "Bottom left"], ["5", "Bottom middle"], ["6", "Bottom right"],
        ["7", "Middle left"], ["8", "Middle right"], ["9", "Center"],
      ]),
      toggle("visual/boxarthide", "Hide box art in grid themes", "Hides system artwork in Explore Content when the theme uses a grid.", "menu"),
      toggle("visual/gridmodecontent", "Grid mode for games", "Lets themes show games in a grid.", "menu"),
      toggle("visual/contentwidth", "Full width highlight", "The selection bar spans the whole screen.", "menu"),
      toggle("visual/shuffle", "Shuffle with R2", "Press R2 to jump to a random game.", "menu"),
      toggle("visual/launchsplash", "Launch splash", "Shows the splash image when a game starts.", "live"),
      toggle("visual/blackfade", "Fade to black", "Fades to black when a game starts.", "live"),
      select("visual/launch_swap", "Resume from save state", "How to launch a game from its automatic save state.", "menu", [["0", "Press A"], ["1", "Hold A"]]),
    ],
  },
  {
    id: "sound", title: "Sound and theme", icon: "layers", intro: "Menu music, navigation sounds and theme effects.",
    items: [
      select("settings/general/bgm", "Background music", "Music in the menus.", "menu", MUSIC),
      range("settings/general/bgmvol", "Music volume", "Volume of the menu music.", "menu", 0, 100, { unit: "%" }),
      select("settings/general/sound", "Navigation sounds", "Sounds when moving through the menus.", "menu", MUSIC),
      range("settings/general/soundvol", "Navigation sound volume", "Volume of the navigation sounds.", "menu", 0, 100, { unit: "%" }),
      toggle("settings/general/chime", "Startup chime", "Plays a sound when the menu starts.", "boot"),
      toggle("visual/backgroundanimation", "Background animation", "Plays the theme's animated background.", "menu"),
      select("settings/general/theme_scaling", "Theme scaling", "How themes made for other screen sizes are fitted.", "menu", [["0", "None"], ["1", "Scale"], ["2", "Stretch"]]),
      toggle("settings/advanced/random_theme", "Random theme on boot", "Picks a different installed theme each time the handheld starts.", "boot"),
    ],
  },
  {
    id: "clock", title: "Date and time", icon: "clock", intro: "Clock format and internet time.",
    items: [
      select("clock/notation", "Time format", "How the clock in the header shows the time.", "menu", [["0", "12 hour"], ["1", "24 hour"]]),
      toggle("web/ntp", "Set the time from the internet", "Syncs the clock over Wi-Fi.", "network"),
      { key: "clock/pool", label: "Time server", help: "The NTP server used to set the clock, like pool.ntp.org.", kind: "text", apply: "network",
        pattern: /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/ },
    ],
  },
  {
    id: "web", title: "Web services", icon: "web", intro: "Network services on the handheld. Changes start or stop them right away.",
    items: [
      toggle("web/sshd", "Secure Shell (SSH)", "Port 22. This page, the SSH terminal and device stats use it.", "services",
        { warn: "Turning off Secure Shell disconnects the manager: this page, the terminal and device stats stop working until you turn it back on in Configuration \u203a Web Services on the handheld." }),
      toggle("web/sftpgo", "SFTP and file browser", "Port 2022, file browser on port 9090. Wi-Fi transfers use it.", "services",
        { warn: "Turning off SFTP stops transfers over Wi-Fi until you turn it back on." }),
      toggle("web/ttyd", "Virtual terminal", "A terminal in the browser on port 8080.", "services"),
      toggle("web/syncthing", "Syncthing", "Syncs saves and files with other devices. Web interface on port 7070.", "services"),
      toggle("web/tailscaled", "Tailscale", "Reach the handheld from anywhere. Log in over SSH first to set it up.", "services"),
    ],
  },
  {
    id: "advanced", title: "Advanced", icon: "wrench", advanced: true,
    intro: "Options muOS lists under Advanced Settings. Change them only if you know what they do.",
    items: [
      select("settings/advanced/brightness", "Brightness on boot", "The brightness the handheld starts with.", "boot",
        [["0", "Previous"], ["1", "Low"], ["2", "Medium"], ["3", "High"]]),
      select("settings/advanced/volume", "Volume on boot", "The volume the handheld starts with.", "boot",
        [["0", "Previous"], ["1", "Silent"], ["2", "Soft"], ["3", "Loud"]]),
      range("settings/advanced/incbright", "Brightness step", "How much one press of the brightness keys changes.", "live", 1, 32),
      range("settings/advanced/incvolume", "Volume step", "How much one press of the volume keys changes.", "live", 1, 32),
      select("settings/advanced/sticknav", "Menu navigation", "Which controls move through the menus.", "menu", [
        ["0", "D-pad only"], ["1", "Left stick only"], ["2", "Right stick only"], ["3", "D-pad and left stick"],
        ["4", "D-pad and right stick"], ["5", "D-pad and both sticks"], ["6", "Both sticks"],
      ], { needs: "stick" }),
      toggle("settings/advanced/dpad_swap", "D-pad swap on power button", "Lets the power button switch the D-pad between D-pad and stick mode.", "tweak"),
      select("settings/advanced/rumble", "Rumble", "When the handheld vibrates.", "live", [
        ["0", "Disabled"], ["1", "Startup"], ["2", "Shutdown"], ["3", "Sleep"], ["4", "Startup and shutdown"],
        ["5", "Startup and sleep"], ["6", "Shutdown and sleep"],
      ], { needs: "rumble" }),
      toggle("settings/advanced/led", "LED while playing", "Keeps the power LED on during games.", "live"),
      toggle("settings/advanced/activity", "Activity tracker", "Records play time for each game.", "live"),
      toggle("settings/advanced/thermal", "Thermal shutdown", "Shuts the handheld down when it gets too hot.", "boot"),
      toggle("settings/advanced/lidswitch", "Lid switch", "Uses the lid sensor to sleep when the lid closes.", "boot", { needs: "lid" }),
      toggle("settings/advanced/disp_suspend", "Display suspend", "Turns the display off while sleeping. Some screens do not like this.", "live"),
      toggle("settings/advanced/audio_swap", "Swap left and right audio", "Reverses the speaker channels.", "tweak"),
      toggle("settings/advanced/overdrive", "Audio overdrive", "Lets the volume go to 200%.", "tweak"),
      toggle("settings/advanced/maxgpu", "GPU performance mode", "Keeps the GPU at its highest clock.", "tweak"),
      select("settings/advanced/usb_function", "USB function", "What the handheld offers over USB.", "tweak", [["0", "Disabled"], ["1", "ADB"], ["2", "MTP (file transfer)"]],
        { warn: "The manager copies games over USB with MTP. With another USB function, USB transfers stop working." }),
      toggle("settings/advanced/retrowait", "RetroArch waits for network", "Starts RetroArch only after Wi-Fi connects.", "live"),
      toggle("settings/advanced/retrocache", "RetroArch startup cache", "About 3 s longer boot, faster first RetroArch start.", "boot"),
      toggle("settings/advanced/retrofree", "RetroArch config freedom", "Stops muOS from forcing its settings on RetroArch configs.", "live"),
      toggle("settings/advanced/audio_ready", "Wait for audio on boot", "Waits for the audio system during startup.", "boot"),
      toggle("settings/advanced/user_init", "User init scripts", "Runs your own scripts at startup.", "boot"),
      toggle("settings/advanced/verbose", "Verbose messages", "Shows startup and shutdown messages, for finding faults.", "boot"),
    ],
  },
];

const BY_KEY = new Map(GROUPS.flatMap((g) => g.items.map((s) => [s.key, s] as const)));

// ---------------------------------------------------------------- reading

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

interface Facts {
  bright: number; audioMax: number; governors: string[]; languages: string[]; version: string; host: string;
  /** From the board config: analog sticks, and whether there is a lid sensor and a rumble motor (null if unknown). */
  board: { stick: number | null; lid: boolean | null; rumble: boolean | null };
}

async function readValues(keys: string[]): Promise<{ values: Record<string, string>; facts: Facts }> {
  const script = [
    `cd ${CONFIG} || { echo "@missing"; exit 0; }`,
    `for k in ${keys.map(quote).join(" ")}; do [ -f "$k" ] || continue; v=; IFS= read -r v < "$k"; printf '=%s\\t%s\\n' "$k" "$v"; done`,
    `printf '@bright\\t%s\\n' "$(cat /opt/muos/device/config/screen/bright 2>/dev/null)"`,
    `printf '@audiomax\\t%s\\n' "$(cat /opt/muos/device/config/audio/max 2>/dev/null)"`,
    `printf '@gov\\t%s\\n' "$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors 2>/dev/null)"`,
    `printf '@lang\\t%s\\n' "$(ls /opt/muos/share/language 2>/dev/null | sed -n 's/\\.json$//p' | tr '\\n' '|')"`,
    `printf '@version\\t%s\\n' "$(cat system/version 2>/dev/null)"`,
    `printf '@build\\t%s\\n' "$(cat system/build 2>/dev/null)"`,
    `B=/opt/muos/device/config/board; printf '@board\\t%s\\t%s\\t%s\\n' "$(cat $B/stick 2>/dev/null)" "$(cat $B/lid 2>/dev/null)" "$(cat $B/rumble 2>/dev/null)"`,
  ].join("\n");
  const { out, code } = await runCommand(script, 20_000);
  if (out.includes("@missing")) throw new UserError("This handheld has no /opt/muos/config folder. Is it running MustardOS?");
  if (code !== 0 && !out) throw new UserError("Could not read the settings from the handheld.");
  const values: Record<string, string> = {};
  const facts: Facts = { bright: 255, audioMax: 100, governors: [], languages: [], version: "", host: "", board: { stick: null, lid: null, rumble: null } };
  let build = "";
  for (const line of out.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const name = line.slice(0, tab), value = line.slice(tab + 1).trim();
    if (name.startsWith("=")) values[name.slice(1)] = value;
    else if (name === "@bright") facts.bright = Number(value) || 255;
    else if (name === "@audiomax") facts.audioMax = Number(value) || 100;
    else if (name === "@gov") facts.governors = value.split(/\s+/).filter(Boolean);
    else if (name === "@lang") facts.languages = value.split("|").filter(Boolean).sort((a, b) => a.localeCompare(b));
    else if (name === "@version") facts.version = value;
    else if (name === "@build") build = value;
    else if (name === "@board") {
      const [stick = "", lid = "", rumble = ""] = line.slice(tab + 1).split("\t").map((v) => v.trim());
      facts.board = { stick: /^\d+$/.test(stick) ? Number(stick) : null, lid: lid ? lid !== "0" : null, rumble: rumble ? rumble !== "0" : null };
    }
  }
  facts.version = await runningVersion(facts.version, build);
  facts.host = (await sshStatus()).host;
  return { values, facts };
}

/** The setting with options and limits filled in from the handheld. */
function resolve(s: Setting, facts: Facts): Setting {
  if (s.dyn === "bright") return { ...s, max: facts.bright };
  if (s.dyn === "volume") return { ...s, max: facts.audioMax };
  if (s.dyn === "governors") return { ...s, options: facts.governors.map((g) => [g, g[0].toUpperCase() + g.slice(1)] as Option) };
  if (s.dyn === "languages") return { ...s, options: facts.languages.map((l) => [l, l] as Option) };
  if (s.needs === "stick" && facts.board.stick === 1) return { ...s, options: s.options?.filter(([v]) => ["0", "1", "3"].includes(v)) };
  return s;
}

/** Whether the handheld has what a setting is for; unknown hardware counts as present. */
function fitsBoard(s: Setting, facts: Facts): boolean {
  const b = facts.board;
  if (s.needs === "stick") return b.stick !== 0;
  if (s.needs === "lid") return b.lid !== false;
  if (s.needs === "rumble") return b.rumble !== false;
  return true;
}

const keysOf = () => [...BY_KEY.keys()];

export async function handheldSettings() {
  const { values, facts } = await readValues(keysOf());
  const groups = GROUPS.map((g) => ({
    id: g.id, title: g.title, icon: g.icon, intro: g.intro, advanced: !!g.advanced,
    items: g.items.filter((s) => s.key in values && fitsBoard(s, facts)).map((s) => {
      const r = resolve(s, facts);
      const options = r.options && !r.options.some(([v]) => v === values[s.key]) && values[s.key] !== ""
        ? [...r.options, [values[s.key], `${values[s.key]} (set on the handheld)`] as Option] : r.options;
      return {
        key: r.key, label: r.label, help: r.help, kind: r.kind, apply: r.apply, options, min: r.min, max: r.max, step: r.step,
        unit: r.unit, warn: r.warn, pattern: r.pattern?.source, value: values[s.key],
      };
    }),
  })).filter((g) => g.items.length);
  return { at: Date.now(), version: facts.version, host: facts.host, groups, undo: await lastBackup() };
}

// ---------------------------------------------------------------- saving

function check(key: string, raw: unknown, facts: Facts): string {
  const base = BY_KEY.get(key);
  if (!base) throw new UserError(`"${key}" is not a setting the manager can change.`);
  const s = resolve(base, facts);
  const value = String(raw ?? "").trim();
  if (s.kind === "range") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < (s.min ?? 0) || n > (s.max ?? 100)) throw new UserError(`${s.label} must be a whole number from ${s.min} to ${s.max}.`);
    return String(n);
  }
  if (s.kind === "text") {
    if (!s.pattern?.test(value)) throw new UserError(`${s.label}: "${value}" is not valid.`);
    return value;
  }
  if (!s.options?.some(([v]) => v === value)) throw new UserError(`${s.label} can't be set to "${value}".`);
  return value;
}

const backupsFile = () => path.join(ctx.cacheDir, "handheld-settings.json");

interface Backup { at: number; host: string; version: string; before: Record<string, string>; after: Record<string, string> }

async function readBackups(): Promise<Backup[]> {
  try { return JSON.parse(await fsp.readFile(backupsFile(), "utf8")); } catch { return []; }
}

async function writeBackups(list: Backup[]): Promise<void> {
  await fsp.mkdir(ctx.cacheDir, { recursive: true });
  await fsp.writeFile(backupsFile(), JSON.stringify(list.slice(-20), null, 2));
}

async function lastBackup() {
  const host = (await sshStatus()).host;
  const last = (await readBackups()).filter((b) => b.host === host).at(-1);
  if (!last) return null;
  return { at: last.at, labels: Object.keys(last.before).map((k) => BY_KEY.get(k)?.label ?? k) };
}

const APPLY_ORDER: Apply[] = ["bright", "volume", "tweak", "services", "live", "menu", "network", "boot", "reboot"];

/** Writes the changes, then applies them the way the handheld's own Settings screens do. */
async function writeChanges(changes: Record<string, string>, values: Record<string, string>) {
  const lines = [`cd ${CONFIG} || exit 1`];
  const applies = new Set<Apply>();
  for (const [key, value] of Object.entries(changes)) {
    const s = BY_KEY.get(key)!;
    applies.add(s.apply);
    if (s.apply === "bright") {
      lines.push(`/opt/muos/script/device/bright.sh ${quote(value)} >/dev/null 2>&1`);
      lines.push(`[ "$(cat ${quote(key)})" = ${quote(value)} ] || printf '%s' ${quote(value)} > ${quote(key)}`);
    } else if (s.apply === "volume") {
      lines.push(`/opt/muos/script/device/audio.sh ${quote(value)} >/dev/null 2>&1`);
      lines.push(`[ "$(cat ${quote(key)})" = ${quote(value)} ] || printf '%s' ${quote(value)} > ${quote(key)}`);
    } else {
      lines.push(`printf '%s' ${quote(value)} > ${quote(key + ".manager")} && mv -f ${quote(key + ".manager")} ${quote(key)} || echo "@failed ${key}"`);
    }
  }
  lines.push("sync");
  if (applies.has("tweak")) lines.push("setsid -f /opt/muos/script/mux/tweak.sh >/dev/null 2>&1 </dev/null");
  if (applies.has("services")) lines.push("setsid -f /opt/muos/script/web/service.sh >/dev/null 2>&1 </dev/null");
  lines.push("echo @done");
  const { out } = await runCommand(lines.join("\n"), 30_000);
  const failed = [...out.matchAll(/@failed (\S+)/g)].map((m) => BY_KEY.get(m[1])?.label ?? m[1]);
  if (!out.includes("@done")) throw new UserError("The handheld stopped answering while saving. Reload to see what was saved.");
  if (failed.length) throw new UserError(`Could not save ${failed.join(", ")} on the handheld.`);
  say("green", "HANDHELD", `Changed ${Object.keys(changes).map((k) => `${k}=${changes[k]} (was ${values[k]})`).join(", ")}`);
  return APPLY_ORDER.filter((a) => applies.has(a));
}

/** Saves changed options. `seen` holds the values the page showed, to catch changes made on the handheld meanwhile. */
export async function saveHandheldSettings(body: Record<string, unknown>) {
  const changes = (body.changes ?? {}) as Record<string, unknown>;
  const seen = (body.seen ?? {}) as Record<string, unknown>;
  const keys = Object.keys(changes);
  if (!keys.length) throw new UserError("Nothing to save.");
  const idle = ["settings/power/idle_display", "settings/power/idle_sleep"];
  const { values, facts } = await readValues(keys.some((k) => idle.includes(k)) ? [...new Set([...keys, ...idle])] : keys);
  const clean: Record<string, string> = {};
  for (const key of keys) {
    if (!(key in values)) throw new UserError(`This handheld has no "${BY_KEY.get(key)?.label ?? key}" option.`);
    clean[key] = check(key, changes[key], facts);
    if (key in seen && String(seen[key]) !== values[key]) {
      throw new UserError(`${BY_KEY.get(key)!.label} was changed on the handheld since this page loaded. Reload to see the current settings.`);
    }
  }
  const display = clean["settings/power/idle_display"] ?? values["settings/power/idle_display"];
  const sleep = clean["settings/power/idle_sleep"] ?? values["settings/power/idle_sleep"];
  if (Number(display) > 0 && Number(sleep) > 0 && Number(display) >= Number(sleep)) {
    throw new UserError("The screen must dim before the handheld sleeps: choose a shorter dim time or a longer sleep time.");
  }
  const changed = Object.fromEntries(Object.entries(clean).filter(([k, v]) => v !== values[k]));
  if (!Object.keys(changed).length) return { applied: [], settings: await handheldSettings() };
  const before = Object.fromEntries(Object.keys(changed).map((k) => [k, values[k]]));
  const backups = await readBackups();
  backups.push({ at: Date.now(), host: facts.host, version: facts.version, before, after: changed });
  await writeBackups(backups);
  const applied = await writeChanges(changed, values);
  return { applied, settings: await handheldSettings().catch(() => null) };
}

/** Puts back the values from before the last save. */
export async function undoHandheldSettings() {
  const host = (await sshStatus()).host;
  const backups = await readBackups();
  const index = backups.findLastIndex((b) => b.host === host);
  if (index < 0) throw new UserError("There is no earlier save to undo.");
  const last = backups[index];
  const { values } = await readValues(Object.keys(last.before));
  const restore = Object.fromEntries(Object.entries(last.before).filter(([k]) => k in values && BY_KEY.has(k)));
  const applied = Object.keys(restore).length ? await writeChanges(restore, values) : [];
  backups.splice(index, 1);
  await writeBackups(backups);
  return { applied, settings: await handheldSettings().catch(() => null) };
}
