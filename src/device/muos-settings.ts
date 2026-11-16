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
import { shq as quote } from "../util.ts";

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
  dyn?: "bright" | "volume" | "governors" | "languages" | "soundfonts";
  /** Pattern for text values. */
  pattern?: RegExp;
  /** Asked before saving a change to this option. */
  warn?: string;
  /** Hardware the setting is for; models without it do not show it. */
  needs?: "stick" | "lid" | "rumble" | "hdmi" | "bluetooth";
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
const PORT = (key: string, label: string, help: string, def: number): Setting =>
  range(key, label, help, "services", 1, 65535, { warn: `Changing the port may disconnect the manager until you set the same port under connection settings (default ${def}).` });

/** Screensaver types from MustardOS Andromeda (common/saver/type.h). */
const SAVER_TYPE: Option[] = [
  ["0", "Disabled"], ["1", "DVD logo"], ["2", "Starfield"], ["3", "Matrix"], ["4", "Fireflies"],
  ["5", "Pulse"], ["6", "Trace"], ["7", "Constellation"], ["8", "Mystify"], ["9", "Maze"],
  ["10", "Block fall"], ["11", "Date and time"], ["12", "Video wallpaper"], ["13", "Slideshow"],
  ["14", "Flying box art"], ["15", "Blue screen"], ["16", "Lava lamp"], ["17", "Gravity glitch"],
  ["18", "Endless hallway"], ["19", "Pixel moss"], ["20", "Blank"],
];
const SAVER_SPEED: Option[] = [
  ["30", "Crawl"], ["90", "Cruise"], ["150", "Fast"], ["300", "Turbo"], ["600", "Ludicrous"],
];
const HOTKEY: Option[] = [
  ["0", "R2 + L2 + A"], ["1", "R2 + L2 + X"], ["2", "L1 + MENU + A"], ["3", "L1 + MENU + X"],
  ["4", "MENU + START"], ["5", "MENU + SELECT"],
];
const PARTITION: Option[] = [["0", "First"], ["1", "Second"], ["2", "Third"], ["3", "Fourth"]];
const REMOTE_VIEW: Option[] = [
  ["0", "Disabled"], ["1", "30 seconds"], ["2", "1 minute"], ["3", "3 minutes"], ["4", "5 minutes"],
  ["5", "10 minutes"], ["6", "30 seconds (alt)"],
];
const REMOTE_CONTROL: Option[] = [["0", "Off"], ["1", "Buttons"], ["2", "Buttons and sticks"]];
const SCROLL: Option[] = [["0", "Off"], ["1", "Slow"], ["2", "Normal"], ["3", "Fast"]];
const TRANSITION: Option[] = [["0", "None"], ["1", "Fade"], ["2", "Slide"], ["3", "Zoom"]];
const HDMI_RES: Option[] = [
  ["0", "640×480"], ["1", "720×480"], ["2", "1280×720"], ["3", "1920×1080"], ["4", "720×720"], ["5", "1024×768"],
];

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
      select("settings/general/orientation", "Screen orientation", "How the menus are rotated on screen (Andromeda).", "reboot", [
        ["0", "Normal"], ["1", "Left"], ["2", "Right"], ["3", "Upside down"],
      ]),
      select("settings/general/audiosink", "Audio sink", "Where menu and system audio plays (Andromeda).", "tweak", [
        ["0", "Internal speaker"], ["1", "HDMI"], ["2", "USB audio"],
      ]),
      select("settings/general/soundfont", "Soundfont", "SF2 used for MIDI menu music when the theme asks for one (Andromeda).", "menu", [], { dyn: "soundfonts" }),
      select("settings/hotkey/screenshot", "Screenshot hotkey", "Button combo that takes a screenshot while content is running.", "tweak", HOTKEY),
      select("settings/hotkey/dpad_toggle", "D-pad swap hotkey", "Button combo that switches D-pad / stick mode when D-pad swap is enabled.", "tweak", HOTKEY),
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
      select("settings/power/gov_default", "Default CPU governor", "The governor used while something is happening (Andromeda).", "live", [], { dyn: "governors" }),
      select("settings/power/saver_type", "Screensaver", "What plays after the screen dims (Andromeda Power settings).", "live", SAVER_TYPE),
      select("settings/power/saver_speed", "Screensaver speed", "How fast the screensaver moves when it supports speed.", "live", SAVER_SPEED),
      toggle("settings/advanced/power_pop", "Power confirmation pop-ups", "Shows a confirm dialog for power actions when Trust Power Choice is off (Andromeda).", "live"),
    ],
  },
  {
    id: "interface", title: "Interface", icon: "eye", intro: "What the menus show: status icons, names and counters in Explore Content.",
    items: [
      toggle("visual/battery", "Battery icon", "Shows the battery icon in the header.", "menu"),
      toggle("visual/network", "Network icon", "Shows the Wi-Fi icon in the header.", "menu"),
      toggle("visual/bluetooth", "Bluetooth icon", "Shows the Bluetooth icon in the header when the board supports it (Andromeda).", "menu", { needs: "bluetooth" }),
      toggle("visual/clock", "Clock", "Shows the clock in the header.", "menu"),
      toggle("visual/pickles_startup_messages", "Pickles startup messages", "Shows messages while Pickles (the Libretro player) starts (Andromeda).", "menu"),
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
      toggle("visual/forwardhistory", "Forward history", "Keeps a forward stack when moving back through Explore Content (Andromeda).", "menu"),
      toggle("visual/groupcontent", "Group content", "Groups related content entries in lists (Andromeda).", "menu"),
      toggle("visual/headertitle", "Header title", "Shows the current screen title in the header (Andromeda).", "menu"),
      toggle("visual/listglyph", "List glyphs", "Shows icons beside list entries (Andromeda).", "menu"),
      toggle("visual/boldfocus", "Bold focus", "Makes the focused item heavier weight (Andromeda).", "menu"),
      toggle("visual/shadow", "Text shadow", "Draws a soft shadow under labels (Andromeda).", "menu"),
      toggle("visual/highcontrast", "High contrast", "Stronger contrast for accessibility (Andromeda).", "menu"),
      toggle("visual/reducemotion", "Reduce motion", "Cuts back menu motion and transitions (Andromeda).", "menu"),
      toggle("visual/pageskip", "Page skip", "Lets shoulder buttons skip pages in long lists (Andromeda).", "menu"),
      select("visual/namescroll", "Name scroll", "How long names scroll when they do not fit (Andromeda).", "menu", SCROLL),
      select("visual/labelscrollspeed", "Label scroll speed", "How fast scrolling labels move (Andromeda).", "menu", SCROLL),
      select("visual/notifytime", "Notification time", "How long on-screen notices stay visible (Andromeda).", "menu",
        [["0", "Brief"], ["1", "Normal"], ["2", "Long"], ["3", "Sticky"]]),
      select("visual/sortorder", "Sort order", "Default sort for content lists (Andromeda).", "menu",
        [["0", "Name A–Z"], ["1", "Name Z–A"], ["2", "Recently added"], ["3", "Play time"]]),
      select("visual/tagorder", "Tag order", "How tags are ordered in lists (Andromeda).", "menu",
        [["0", "As stored"], ["1", "Alphabetical"], ["2", "Priority"]]),
      select("visual/selectionstyle", "Selection style", "How the focused row is drawn (Andromeda).", "menu",
        [["0", "None"], ["1", "Bar"], ["2", "Outline"], ["3", "Fill"], ["4", "Theme default"]]),
      select("visual/selectionanimation", "Selection animation", "Motion when moving the focus (Andromeda).", "menu", TRANSITION),
      select("visual/dialoguetransition", "Dialogue transition", "How dialogs appear and leave (Andromeda).", "menu", TRANSITION),
      select("visual/elementtransition", "Element transition", "How panels and overlays animate (Andromeda).", "menu", TRANSITION),
      select("visual/savescreenshot", "Save screenshot prompt", "Whether saving a screenshot asks for confirmation (Andromeda).", "menu",
        [["0", "Never"], ["1", "Ask"], ["2", "Always save"]]),
      toggle("visual/power_off", "Power-off visual", "Shows the CRT-style power-off effect (Andromeda).", "menu"),
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
      range("visual/boxartpadding", "Box art padding", "Space between box art and the screen edge, as a percentage (Andromeda).", "menu", 0, 100, { unit: "%" }),
      select("visual/boxartscale", "Box art scaling", "How box art is fitted (Andromeda).", "menu",
        [["0", "Fit"], ["1", "Fill"], ["2", "Stretch"], ["3", "Native"]]),
      toggle("visual/boxartplaceholder", "Box art placeholder", "Shows a placeholder when a game has no artwork (Andromeda).", "menu"),
      select("visual/boxarttransition", "Box art transition", "How artwork changes when moving the focus (Andromeda).", "menu", TRANSITION),
      toggle("visual/boxarthide", "Hide box art in grid themes", "Hides system artwork in Explore Content when the theme uses a grid.", "menu"),
      toggle("visual/gridmodecontent", "Grid mode for games", "Lets themes show games in a grid.", "menu"),
      toggle("visual/contentwidth", "Full width highlight", "The selection bar spans the whole screen.", "menu"),
      toggle("visual/shuffle", "Shuffle with R2", "Press R2 to jump to a random game.", "menu"),
      toggle("visual/launchsplash", "Launch splash", "Shows the splash image when a game starts.", "live"),
      toggle("visual/blackfade", "Fade to black", "Fades to black when a game starts.", "live"),
      select("visual/launch_swap", "Resume from save state", "How to launch a game from its automatic save state.", "menu", [["0", "Press A"], ["1", "Hold A"]]),
      select("visual/videopreview", "Video preview", "Plays catalogue video previews in Explore Content (Andromeda).", "menu",
        [["0", "Off"], ["1", "On focus"], ["2", "Auto"]]),
      toggle("visual/video_wallpaper", "Video wallpaper", "Allows theme video wallpapers (Andromeda).", "menu"),
      select("visual/background_scale", "Background scale", "How theme backgrounds are fitted (Andromeda).", "menu",
        [["0", "None"], ["1", "Fit"], ["2", "Fill"], ["3", "Stretch"]]),
      toggle("visual/overlayimage", "Overlay image", "Draws the catalogue overlay image when one is assigned (Andromeda).", "menu"),
      range("visual/overlaytransparency", "Overlay transparency", "How transparent the overlay image is (Andromeda).", "menu", 0, 100, { unit: "%" }),
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
      toggle("settings/general/rgb", "RGB lighting", "Turns stick and button RGB on where the board supports it (Andromeda).", "tweak"),
      select("settings/rgb/mode", "RGB mode", "Lighting pattern when RGB is on (Andromeda).", "tweak", [
        ["0", "Solid"], ["1", "Breath"], ["2", "Rainbow"], ["3", "Pulse"], ["4", "Spiral"], ["5", "Off pattern"],
      ]),
      select("settings/rgb/backend", "RGB backend", "Which RGB driver the handheld uses (Andromeda).", "tweak",
        [["0", "Default"], ["1", "Alternate"]]),
      range("settings/rgb/speed", "RGB speed", "How fast animated RGB patterns move (Andromeda).", "tweak", 1, 20),
      range("settings/rgb/breath_speed", "RGB breath speed", "Breath animation speed when that mode is used (Andromeda).", "tweak", 0, 20),
      range("settings/rgb/bright", "RGB brightness", "Overall stick and button LED brightness (Andromeda).", "tweak", 0, 255),
      range("settings/rgb/bright_theme", "RGB theme brightness", "Brightness ceiling themes may use for RGB (Andromeda).", "tweak", 0, 255),
      select("settings/rgb/combo", "RGB combo", "Which LED groups light together (Andromeda).", "tweak",
        [["0", "All"], ["1", "Sticks only"], ["2", "Buttons only"], ["3", "Shoulders"], ["4", "Custom"]]),
      toggle("visual/backgroundanimation", "Background animation", "Plays the theme's animated background.", "menu"),
      select("settings/general/theme_scaling", "Theme scaling", "How themes made for other screen sizes are fitted.", "menu", [["0", "None"], ["1", "Scale"], ["2", "Stretch"]]),
      select("settings/general/theme_resolution", "Theme resolution preference", "Preferred theme size when more than one is installed (Andromeda).", "menu",
        [["0", "Auto"], ["1", "Native screen"], ["2", "720p"], ["3", "1080p"]]),
      range("settings/font/scale", "Font scale", "Overall menu font scale as a percentage (Andromeda).", "menu", 50, 200, { unit: "%" }),
      { key: "settings/font/directory", label: "Font directory", help: "Folder under MUOS/font used for custom faces (Andromeda). Leave blank for built-in fonts.", kind: "text", apply: "menu",
        pattern: /^[\x20-\x7E]{0,128}$/ },
      { key: "settings/font/name", label: "Font name", help: "Display name for the active custom font (Andromeda).", kind: "text", apply: "menu",
        pattern: /^[\x20-\x7E]{0,128}$/ },
      { key: "settings/font/face", label: "Font face file", help: "Font file name inside the font directory (Andromeda).", kind: "text", apply: "menu",
        pattern: /^[\x20-\x7E]{0,128}$/ },
      range("settings/font/header_size", "Header font size", "Header label size (Andromeda).", "menu", 8, 64),
      range("settings/font/footer_size", "Footer font size", "Footer label size (Andromeda).", "menu", 8, 64),
      range("settings/font/list_size", "List font size", "Content list label size (Andromeda).", "menu", 8, 64),
      range("settings/font/panel_size", "Panel font size", "Panel and dialogue label size (Andromeda).", "menu", 8, 64),
      range("settings/font/width", "Font width", "Horizontal font stretch factor (Andromeda).", "menu", 50, 200, { unit: "%" }),
      toggle("settings/font/italic", "Italic font", "Uses an italic face when the font provides one (Andromeda).", "menu"),
      select("settings/advanced/font", "Font preset", "Built-in font size preset used with Customisation fonts (Andromeda).", "menu",
        [["0", "Small"], ["1", "Medium"], ["2", "Large"], ["3", "Extra large"]]),
      range("settings/theme/header_height", "Theme header height", "Header bar height in theme units (Andromeda).", "menu", 0, 200),
      range("settings/theme/footer_height", "Theme footer height", "Footer bar height in theme units (Andromeda).", "menu", 0, 200),
      range("settings/theme/content_item_count", "Theme content item count", "How many list rows themes reserve (Andromeda).", "menu", 1, 30),
      range("settings/theme/label_width", "Theme label width", "Content label width in theme units (Andromeda).", "menu", 0, 1000),
      range("settings/theme/glyph_size", "Theme glyph size", "Default glyph size in theme units (Andromeda).", "menu", 0, 128),
      range("settings/theme/glyph_size_header", "Theme header glyph size", "Header glyph size (Andromeda).", "menu", 0, 128),
      range("settings/theme/glyph_size_footer", "Theme footer glyph size", "Footer glyph size (Andromeda).", "menu", 0, 128),
      range("settings/theme/glyph_size_list", "Theme list glyph size", "List glyph size (Andromeda).", "menu", 0, 128),
      range("settings/theme/glyph_size_grid", "Theme grid glyph size", "Grid glyph size (Andromeda).", "menu", 0, 128),
      range("settings/rgb/bright_l", "RGB brightness (left)", "Left stick LED brightness (Andromeda).", "tweak", 0, 255),
      range("settings/rgb/bright_r", "RGB brightness (right)", "Right stick LED brightness (Andromeda).", "tweak", 0, 255),
      range("settings/rgb/bright_m", "RGB brightness (middle)", "Middle / logo LED brightness (Andromeda).", "tweak", 0, 255),
      range("settings/rgb/bright_f1", "RGB brightness (face 1)", "Face button group 1 brightness (Andromeda).", "tweak", 0, 255),
      range("settings/rgb/bright_f2", "RGB brightness (face 2)", "Face button group 2 brightness (Andromeda).", "tweak", 0, 255),
      range("settings/rgb/bright_rs1", "RGB brightness (RS 1)", "Right-side LED group 1 brightness (Andromeda).", "tweak", 0, 255),
      range("settings/rgb/bright_rs2", "RGB brightness (RS 2)", "Right-side LED group 2 brightness (Andromeda).", "tweak", 0, 255),
      range("settings/rgb/bright_shl1", "RGB brightness (shoulder L1)", "Left shoulder LED brightness (Andromeda).", "tweak", 0, 255),
      range("settings/rgb/bright_shl2", "RGB brightness (shoulder L2)", "Left trigger LED brightness (Andromeda).", "tweak", 0, 255),
      range("settings/rgb/bright_shr1", "RGB brightness (shoulder R1)", "Right shoulder LED brightness (Andromeda).", "tweak", 0, 255),
      range("settings/rgb/bright_shr2", "RGB brightness (shoulder R2)", "Right trigger LED brightness (Andromeda).", "tweak", 0, 255),
      { key: "settings/rgb/colour_l", label: "RGB colour (left)", help: "Left stick LED colour value from the handheld RGB editor (Andromeda).", kind: "text", apply: "tweak", pattern: /^[\x20-\x7E]{0,32}$/ },
      { key: "settings/rgb/colour_r", label: "RGB colour (right)", help: "Right stick LED colour value (Andromeda).", kind: "text", apply: "tweak", pattern: /^[\x20-\x7E]{0,32}$/ },
      { key: "settings/rgb/colour_m", label: "RGB colour (middle)", help: "Middle / logo LED colour value (Andromeda).", kind: "text", apply: "tweak", pattern: /^[\x20-\x7E]{0,32}$/ },
      { key: "settings/rgb/colour_f1", label: "RGB colour (face 1)", help: "Face button group 1 colour (Andromeda).", kind: "text", apply: "tweak", pattern: /^[\x20-\x7E]{0,32}$/ },
      { key: "settings/rgb/colour_f2", label: "RGB colour (face 2)", help: "Face button group 2 colour (Andromeda).", kind: "text", apply: "tweak", pattern: /^[\x20-\x7E]{0,32}$/ },
      { key: "settings/rgb/colour_rs1", label: "RGB colour (RS 1)", help: "Right-side LED group 1 colour (Andromeda).", kind: "text", apply: "tweak", pattern: /^[\x20-\x7E]{0,32}$/ },
      { key: "settings/rgb/colour_rs2", label: "RGB colour (RS 2)", help: "Right-side LED group 2 colour (Andromeda).", kind: "text", apply: "tweak", pattern: /^[\x20-\x7E]{0,32}$/ },
      { key: "settings/rgb/colour_shl1", label: "RGB colour (shoulder L1)", help: "Left shoulder LED colour (Andromeda).", kind: "text", apply: "tweak", pattern: /^[\x20-\x7E]{0,32}$/ },
      { key: "settings/rgb/colour_shl2", label: "RGB colour (shoulder L2)", help: "Left trigger LED colour (Andromeda).", kind: "text", apply: "tweak", pattern: /^[\x20-\x7E]{0,32}$/ },
      { key: "settings/rgb/colour_shr1", label: "RGB colour (shoulder R1)", help: "Right shoulder LED colour (Andromeda).", kind: "text", apply: "tweak", pattern: /^[\x20-\x7E]{0,32}$/ },
      { key: "settings/rgb/colour_shr2", label: "RGB colour (shoulder R2)", help: "Right trigger LED colour (Andromeda).", kind: "text", apply: "tweak", pattern: /^[\x20-\x7E]{0,32}$/ },
      { key: "settings/rgb/color_l", label: "RGB color (left, alt key)", help: "Alternate spelling of left stick colour used by some builds.", kind: "text", apply: "tweak", pattern: /^[\x20-\x7E]{0,32}$/ },
      { key: "settings/rgb/color_r", label: "RGB color (right, alt key)", help: "Alternate spelling of right stick colour used by some builds.", kind: "text", apply: "tweak", pattern: /^[\x20-\x7E]{0,32}$/ },
      { key: "settings/rgb/color_m", label: "RGB color (middle, alt key)", help: "Alternate spelling of middle LED colour used by some builds.", kind: "text", apply: "tweak", pattern: /^[\x20-\x7E]{0,32}$/ },
      { key: "settings/rgb/color_f1", label: "RGB color (face 1, alt key)", help: "Alternate spelling of face 1 colour used by some builds.", kind: "text", apply: "tweak", pattern: /^[\x20-\x7E]{0,32}$/ },
      { key: "settings/rgb/color_f2", label: "RGB color (face 2, alt key)", help: "Alternate spelling of face 2 colour used by some builds.", kind: "text", apply: "tweak", pattern: /^[\x20-\x7E]{0,32}$/ },
      toggle("settings/advanced/random_theme", "Random theme on boot", "Picks a different installed theme each time the handheld starts.", "boot"),
      select("settings/advanced/splash_scale", "Splash scale", "How the launch splash is fitted (Andromeda).", "live",
        [["0", "Fit"], ["1", "Fill"], ["2", "Stretch"]]),
    ],
  },
  {
    id: "clock", title: "Date and time", icon: "clock", intro: "Clock format and internet time.",
    items: [
      select("clock/notation", "Time format", "How the clock in the header shows the time.", "menu",
        [["0", "12 hour"], ["1", "24 hour"], ["2", "Custom"]]),
      { key: "clock/custom", label: "Custom time format", help: "strftime-style pattern when Time format is Custom (Andromeda), e.g. %H%P %Z.", kind: "text", apply: "menu",
        pattern: /^[\x20-\x7E]{0,64}$/ },
      toggle("web/ntp", "Set the time from the internet", "Syncs the clock over Wi-Fi.", "network"),
      { key: "clock/pool", label: "Time server", help: "The NTP server used to set the clock, like pool.ntp.org.", kind: "text", apply: "network",
        pattern: /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/ },
    ],
  },
  {
    id: "network", title: "Network", icon: "web", intro: "How the handheld connects on Wi-Fi (Andromeda Network settings).",
    items: [
      toggle("settings/network/boot", "Connect on boot", "Starts Wi-Fi when the handheld starts.", "boot"),
      toggle("settings/network/wake", "Reconnect after sleep", "Brings Wi-Fi back when waking from sleep.", "live"),
      toggle("settings/network/monitor", "Connection monitor", "Watches the link and retries when it drops.", "live"),
      toggle("settings/network/async_load", "Async network load", "Loads network services without blocking the menu.", "boot"),
      toggle("settings/network/system_dns", "Use system DNS", "Uses the handheld's DNS settings for lookups.", "network"),
      toggle("settings/network/compat", "Compatibility mode", "Uses a slower Wi-Fi path that works with more access points (Andromeda).", "network"),
      range("settings/network/con_retry", "Connection retries", "How many times to retry joining Wi-Fi (Andromeda).", "network", 0, 10),
      range("settings/network/mod_retry", "Module retries", "How many times to reload the Wi-Fi module on failure (Andromeda).", "network", 0, 10),
      range("settings/network/wait_timer", "Wait timer", "Seconds to wait for a link before giving up (Andromeda).", "network", 0, 60, { unit: "s" }),
      toggle("settings/network/proxy_enabled", "Use HTTP proxy", "Routes handheld web traffic through a proxy (Andromeda).", "network"),
      select("settings/network/proxy_type", "Proxy type", "Proxy protocol when a proxy is enabled.", "network",
        [["0", "HTTP"], ["1", "HTTPS"], ["2", "SOCKS5"]]),
      { key: "settings/network/proxy_server", label: "Proxy server", help: "Proxy host:port, e.g. 192.168.0.1:8080. Leave blank when unused.", kind: "text", apply: "network",
        pattern: /^$|^[A-Za-z0-9][A-Za-z0-9.:_-]{0,252}$/ },
      { key: "settings/network/proxy_noproxy", label: "Proxy bypass", help: "Comma-separated hosts that skip the proxy (Andromeda).", kind: "text", apply: "network",
        pattern: /^[\x20-\x7E]{0,512}$/ },
      toggle("settings/network/usb_cable", "USB Cable (Device Link)", "Andromeda Device Link: joins two MustardOS handhelds over USB-C (usblink0). Not for copying files to this computer. Turn this off before USB MTP.", "tweak",
        { warn: "While USB Cable is on, MTP and ADB are paused. Turn it off here (or on the handheld under Connectivity → Device Link), set USB function to MTP below, then unplug and replug the cable." }),
    ],
  },
  {
    id: "web", title: "Web services", icon: "web", intro: "Network services on the handheld. Changes start or stop them right away. Ports appear on Andromeda when those files exist.",
    items: [
      toggle("web/sshd", "Secure Shell (SSH)", "Remote shell for this page, the terminal and device stats.", "services",
        { warn: "Turning off Secure Shell disconnects the manager: this page, the terminal and device stats stop working until you turn it back on in Configuration \u203a Web Services on the handheld." }),
      PORT("web/sshd_port", "SSH port", "TCP port for Secure Shell (default 22).", 22),
      toggle("web/sftpgo", "SFTP and file browser (older MustardOS)", "Port 2022 and file browser. Used on Jacaranda builds that still name the service sftpgo.", "services",
        { warn: "Turning off SFTP stops transfers over Wi-Fi until you turn it back on." }),
      toggle("web/sftp", "SFTP and file browser", "Andromeda name for the SFTP service. Wi-Fi transfers use it.", "services",
        { warn: "Turning off SFTP stops transfers over Wi-Fi until you turn it back on." }),
      PORT("web/sftp_port", "SFTP port", "TCP port for SFTP file transfers (default 2022).", 2022),
      toggle("web/ttyd", "Virtual terminal", "A terminal in the browser.", "services"),
      PORT("web/ttyd_port", "Virtual terminal port", "Browser terminal port (default 8080).", 8080),
      { key: "web/ttyd_user", label: "Virtual terminal user", help: "Optional sign-in user for ttyd. Leave blank for the MustardOS default.", kind: "text", apply: "services",
        pattern: /^[A-Za-z0-9._-]{0,64}$/ },
      { key: "web/ttyd_pass", label: "Virtual terminal password", help: "Optional sign-in password for ttyd. Leave blank for the MustardOS default.", kind: "text", apply: "services",
        pattern: /^[\x20-\x7E]{0,128}$/ },
      toggle("web/syncthing", "Syncthing", "Syncs saves and files with other devices.", "services"),
      PORT("web/syncthing_port", "Syncthing port", "Syncthing web interface port (default 7070).", 7070),
      toggle("web/landing", "Web landing page", "Shows the MustardOS landing page on the local network (Andromeda).", "services"),
      PORT("web/landing_port", "Landing page port", "HTTP port for the landing page (default 80).", 80),
      toggle("web/landing_auth", "Landing page sign-in", "Asks for a password on the landing page.", "services"),
      toggle("web/mdns", "mDNS discovery", "Advertises the handheld on the local network for Find on network.", "services"),
      { key: "web/mdns_name", label: "mDNS name", help: "Local hostname advertised over mDNS, without .local.", kind: "text", apply: "services",
        pattern: /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/ },
      select("web/remote_view", "Remote view", "How long remote screen sharing stays available (Andromeda).", "services", REMOTE_VIEW),
      select("web/remote_control", "Remote controls", "Whether the landing page may send button input (Andromeda).", "services", REMOTE_CONTROL),
      toggle("web/remote_sound", "Remote view audio", "Sends audio with remote view when that is on.", "services"),
      toggle("web/remote_privacy", "Remote view privacy", "Blurs or hides sensitive screens in remote view.", "services"),
      toggle("web/remote_local_priority", "Prefer local remote view", "Favours viewers on the same LAN over remote ones (Andromeda).", "services"),
      range("web/live_fps", "Live view frame rate", "Frames per second for remote live view (Andromeda).", "services", 1, 60, { unit: "fps" }),
      range("web/live_quality", "Live view quality", "JPEG quality for remote live view (Andromeda).", "services", 10, 100, { unit: "%" }),
      toggle("web/tailscaled", "Tailscale", "Reach the handheld from anywhere. Log in over SSH first to set it up.", "services"),
    ],
  },
  {
    id: "hdmi", title: "HDMI", icon: "image", intro: "External display output when the handheld has HDMI (Andromeda).",
    items: [
      select("settings/hdmi/resolution", "HDMI resolution", "Output resolution when HDMI is connected.", "tweak", HDMI_RES, { needs: "hdmi" }),
      select("settings/hdmi/space", "Colour space", "HDMI colour space.", "tweak", [["0", "RGB"], ["1", "YCbCr"]], { needs: "hdmi" }),
      select("settings/hdmi/depth", "Colour depth", "Bits per channel on HDMI.", "tweak", [["0", "8-bit"], ["1", "10-bit"], ["2", "12-bit"]], { needs: "hdmi" }),
      select("settings/hdmi/range", "Colour range", "Limited or full HDMI range.", "tweak", [["0", "Limited"], ["1", "Full"]], { needs: "hdmi" }),
      select("settings/hdmi/scan", "Scan mode", "Progressive or interlaced output where supported.", "tweak", [["0", "Progressive"], ["1", "Interlaced"]], { needs: "hdmi" }),
      select("settings/hdmi/audio", "HDMI audio", "Whether audio rides the HDMI cable.", "tweak", [["0", "Off"], ["1", "On"]], { needs: "hdmi" }),
      toggle("settings/hdmi/mirror", "Mirror handheld screen", "Mirrors the built-in panel to HDMI instead of a separate desktop.", "tweak", { needs: "hdmi" }),
    ],
  },
  {
    id: "colour", title: "Display colour", icon: "eye", intro: "Scheduled colour temperature (Andromeda Display Colour).",
    items: [
      select("settings/colour/schedule_mode", "Colour schedule", "Automatic warm/cool shift over the day.", "live",
        [["0", "Off"], ["1", "Sunrise / sunset"], ["2", "Manual times"]]),
      range("settings/colour/sunrise_temp", "Sunrise temperature", "Cooler or warmer tint in the morning (higher is warmer).", "live", 0, 255),
      range("settings/colour/sunset_temp", "Sunset temperature", "Tint in the evening (higher is warmer).", "live", 0, 255),
      range("settings/colour/sunrise_time", "Sunrise time offset", "Schedule point for the morning shift (device units).", "live", 0, 143),
      range("settings/colour/sunset_time", "Sunset time offset", "Schedule point for the evening shift (device units).", "live", 0, 143),
    ],
  },
  {
    id: "overlay", title: "On-screen overlays", icon: "layers", intro: "Brightness, volume and battery stage overlays (Andromeda).",
    items: [
      range("settings/overlay/bat_alpha", "Battery overlay opacity", "Opacity of the battery stage overlay.", "live", 0, 255),
      select("settings/overlay/bat_anchor", "Battery overlay position", "Where the battery overlay sits.", "live",
        [["0", "Top left"], ["1", "Top right"], ["2", "Bottom left"], ["3", "Bottom right"]]),
      range("settings/overlay/bat_scale", "Battery overlay scale", "Size of the battery overlay.", "live", 1, 300, { unit: "%" }),
      range("settings/overlay/bri_alpha", "Brightness overlay opacity", "Opacity of the brightness stage overlay.", "live", 0, 255),
      select("settings/overlay/bri_anchor", "Brightness overlay position", "Where the brightness overlay sits.", "live",
        [["0", "Top left"], ["1", "Top right"], ["2", "Bottom left"], ["3", "Bottom right"]]),
      range("settings/overlay/bri_scale", "Brightness overlay scale", "Size of the brightness overlay.", "live", 1, 300, { unit: "%" }),
      range("settings/overlay/vol_alpha", "Volume overlay opacity", "Opacity of the volume stage overlay.", "live", 0, 255),
      select("settings/overlay/vol_anchor", "Volume overlay position", "Where the volume overlay sits.", "live",
        [["0", "Top left"], ["1", "Top right"], ["2", "Bottom left"], ["3", "Bottom right"]]),
      range("settings/overlay/vol_scale", "Volume overlay scale", "Size of the volume overlay.", "live", 1, 300, { unit: "%" }),
      range("settings/overlay/gen_alpha", "Generic overlay opacity", "Opacity for other stage overlays.", "live", 0, 255),
      select("settings/overlay/gen_anchor", "Generic overlay position", "Where generic stage overlays sit.", "live",
        [["0", "Top left"], ["1", "Top right"], ["2", "Bottom left"], ["3", "Bottom right"]]),
      range("settings/overlay/gen_scale", "Generic overlay scale", "Size of generic stage overlays.", "live", 1, 300, { unit: "%" }),
    ],
  },
  {
    id: "advanced", title: "Advanced", icon: "wrench", advanced: true,
    intro: "Options muOS lists under Advanced Settings. Change them only if you know what they do.",
    items: [
      range("settings/advanced/accelerate", "Menu acceleration", "How quickly held navigation speeds up (Andromeda).", "live", 0, 255),
      range("settings/advanced/repeat_delay", "Menu repeat delay", "How long a direction is held before it repeats (Andromeda).", "live", 0, 500),
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
      toggle("settings/general/activity", "Activity tracker (general)", "Andromeda also stores activity under General; keep both in sync if both appear.", "live"),
      toggle("settings/advanced/passcode", "Passcode lock", "Asks for a passcode on the handheld (set the code on-device under Advanced).", "boot",
        { warn: "Enabling a passcode without setting the code on the handheld can lock you out of menus. Set the code on the device first." }),
      toggle("settings/advanced/thermal", "Thermal shutdown", "Shuts the handheld down when it gets too hot.", "boot"),
      toggle("settings/advanced/lidswitch", "Lid switch", "Uses the lid sensor to sleep when the lid closes.", "boot", { needs: "lid" }),
      toggle("settings/advanced/disp_suspend", "Display suspend", "Turns the display off while sleeping. Some screens do not like this.", "live"),
      toggle("settings/advanced/stage_overlay", "Stage overlay", "On-screen brightness, volume and battery indicators (Andromeda). Off also hides Overlay Options.", "live"),
      range("settings/advanced/boxartpaddiv", "Box art padding divisor", "How much each percent of box art padding is worth (Andromeda). Smaller pushes artwork further.", "live", 1, 20),
      toggle("settings/advanced/audio_swap", "Swap left and right audio", "Reverses the speaker channels.", "tweak"),
      toggle("settings/advanced/audio_suspend", "Suspend audio with sleep", "Stops audio hardware while sleeping (Andromeda).", "live"),
      toggle("settings/advanced/overdrive", "Audio overdrive", "Lets the volume go to 200%.", "tweak"),
      toggle("settings/advanced/maxgpu", "GPU performance mode", "Keeps the GPU at its highest clock.", "tweak"),
      toggle("settings/advanced/double_buffer", "Double buffering", "Uses a second full-screen draw buffer. Extra memory; for comparing render paths (Andromeda).", "boot"),
      toggle("settings/advanced/swapfile", "System swapfile", "Adds disk-backed swap for memory-heavy content (Andromeda).", "boot"),
      toggle("settings/advanced/zramfile", "System ZRam", "Compressed in-memory swap; faster than a swapfile (Andromeda).", "boot"),
      select("settings/advanced/part_secondary", "Secondary partition", "Partition used when mounting the second card (Andromeda).", "boot", PARTITION),
      select("settings/advanced/part_external", "External partition", "Partition used when mounting USB storage (Andromeda).", "boot", PARTITION),
      select("settings/advanced/usb_function", "USB function", "What the handheld offers over USB to a computer. On Andromeda this is often not on the handheld menus — set MTP here over SSH, then unplug and replug the cable.", "tweak", [["0", "Disabled"], ["1", "ADB"], ["2", "MTP (file transfer)"]],
        { warn: "The manager copies games over USB with MTP. Turn USB Cable (Device Link) off first if USB shows as Link or usblink0, then set MTP and replug." }),
      toggle("settings/advanced/retrowait", "RetroArch waits for network", "Starts RetroArch only after Wi-Fi connects.", "live"),
      toggle("settings/advanced/retrocache", "RetroArch startup cache", "About 3 s longer boot, faster first RetroArch start.", "boot"),
      toggle("settings/advanced/retrofree", "RetroArch config freedom", "Stops muOS from forcing its settings on RetroArch configs.", "live"),
      range("settings/advanced/bt_scan_timeout", "Bluetooth scan timeout", "Seconds to keep scanning for nearby Bluetooth devices (Andromeda).", "live", 5, 120, { unit: "s", needs: "bluetooth" }),
      toggle("settings/advanced/bt_raw", "Bluetooth raw devices", "Lists nearby devices that only show a hardware address (Andromeda).", "live", { needs: "bluetooth" }),
      toggle("settings/advanced/audio_ready", "Wait for audio on boot", "Waits for the audio system during startup.", "boot"),
      toggle("settings/advanced/user_init", "User init scripts", "Runs your own scripts at startup.", "boot"),
      toggle("settings/advanced/verbose", "Verbose messages", "Shows startup and shutdown messages, for finding faults.", "boot"),
      toggle("settings/advanced/remember_section", "Remember section", "Reopens multi-section screens on the last section you used (Andromeda).", "menu"),
      toggle("settings/advanced/extracores", "Additional Cores", "Shows extra systems and Libretro cores in Core Assignment and Core Management (Andromeda). Leave off for a shorter list.", "live"),
      toggle("settings/advanced/trust_modify", "Trust modifications", "Saves settings changes without asking when leaving a screen (Andromeda).", "live"),
      toggle("settings/advanced/trust_power", "Trust power choice", "Reboots or shuts down without a confirmation (Andromeda).", "live"),
      toggle("settings/advanced/trust_remove", "Trust removals", "Removes content, history and collections without asking (Andromeda).", "live"),
      select("settings/remap/layout", "Control remap layout", "Default control remap layout index (Andromeda).", "live",
        [["0", "Default"], ["1", "Alternate"], ["2", "Custom"]]),
    ],
  },
];

const BY_KEY = new Map(GROUPS.flatMap((g) => g.items.map((s) => [s.key, s] as const)));

// ---------------------------------------------------------------- reading

interface Facts {
  bright: number; audioMax: number; governors: string[]; languages: string[]; soundfonts: string[]; version: string; host: string;
  /** From the board config: analog sticks, lid, rumble, HDMI and Bluetooth (null if unknown). */
  board: { stick: number | null; lid: boolean | null; rumble: boolean | null; hdmi: boolean | null; bluetooth: boolean | null };
}

async function readValues(keys: string[]): Promise<{ values: Record<string, string>; facts: Facts }> {
  const script = [
    `cd ${CONFIG} || { echo "@missing"; exit 0; }`,
    `for k in ${keys.map(quote).join(" ")}; do [ -f "$k" ] || continue; v=; IFS= read -r v < "$k"; printf '=%s\\t%s\\n' "$k" "$v"; done`,
    `printf '@bright\\t%s\\n' "$(cat /opt/muos/device/config/screen/bright 2>/dev/null)"`,
    `printf '@audiomax\\t%s\\n' "$(cat /opt/muos/device/config/audio/max 2>/dev/null)"`,
    `printf '@gov\\t%s\\n' "$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors 2>/dev/null)"`,
    `printf '@lang\\t%s\\n' "$(ls /opt/muos/share/language 2>/dev/null | sed -n 's/\\.json$//p' | tr '\\n' '|')"`,
    `printf '@soundfonts\\t%s\\n' "$(ls /opt/muos/share/soundfont 2>/dev/null | tr '\\n' '|')"`,
    `printf '@version\\t%s\\n' "$(cat system/version 2>/dev/null)"`,
    `printf '@build\\t%s\\n' "$(cat system/build 2>/dev/null)"`,
    `B=/opt/muos/device/config/board; printf '@board\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$(cat $B/stick 2>/dev/null)" "$(cat $B/lid 2>/dev/null)" "$(cat $B/rumble 2>/dev/null)" "$(cat $B/hdmi 2>/dev/null)" "$(cat $B/bluetooth 2>/dev/null)"`,
  ].join("\n");
  const { out, code } = await runCommand(script, 20_000);
  if (out.includes("@missing")) throw new UserError("This handheld has no /opt/muos/config folder. Is it running MustardOS?");
  if (code !== 0 && !out) throw new UserError("Could not read the settings from the handheld.");
  const values: Record<string, string> = {};
  const facts: Facts = {
    bright: 255, audioMax: 100, governors: [], languages: [], soundfonts: [], version: "", host: "",
    board: { stick: null, lid: null, rumble: null, hdmi: null, bluetooth: null },
  };
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
    else if (name === "@soundfonts") facts.soundfonts = value.split("|").filter(Boolean).sort((a, b) => a.localeCompare(b));
    else if (name === "@version") facts.version = value;
    else if (name === "@build") build = value;
    else if (name === "@board") {
      const [stick = "", lid = "", rumble = "", hdmi = "", bluetooth = ""] = line.slice(tab + 1).split("\t").map((v) => v.trim());
      facts.board = {
        stick: /^\d+$/.test(stick) ? Number(stick) : null,
        lid: lid ? lid !== "0" : null,
        rumble: rumble ? rumble !== "0" : null,
        hdmi: hdmi ? hdmi !== "0" : null,
        bluetooth: bluetooth ? bluetooth !== "0" : null,
      };
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
  if (s.dyn === "soundfonts") {
    return { ...s, options: [["", "Default"], ...facts.soundfonts.map((f) => [f, f] as Option)] };
  }
  if (s.needs === "stick" && facts.board.stick === 1) return { ...s, options: s.options?.filter(([v]) => ["0", "1", "3"].includes(v)) };
  return s;
}

/** Whether the handheld has what a setting is for; unknown hardware counts as present. */
function fitsBoard(s: Setting, facts: Facts): boolean {
  const b = facts.board;
  if (s.needs === "stick") return b.stick !== 0;
  if (s.needs === "lid") return b.lid !== false;
  if (s.needs === "rumble") return b.rumble !== false;
  if (s.needs === "hdmi") return b.hdmi !== false;
  if (s.needs === "bluetooth") return b.bluetooth !== false;
  return true;
}

const keysOf = () => [...BY_KEY.keys()];

/** Codename token from a MustardOS version string, e.g. ANDROMEDA from 2606.0_ANDROMEDA. */
export function codenameOf(version: string): string {
  const up = String(version || "").toUpperCase();
  for (const name of ["ANDROMEDA", "JACARANDA", "GOOSE", "BANANA", "BEAN", "PIPPIN"]) {
    if (up.includes(name)) return name[0] + name.slice(1).toLowerCase();
  }
  return "";
}

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
  const ports = {
    ssh: Number(values["web/sshd_port"]) || 0,
    sftp: Number(values["web/sftp_port"]) || 0,
    ttyd: Number(values["web/ttyd_port"]) || 0,
    syncthing: Number(values["web/syncthing_port"]) || 0,
    landing: Number(values["web/landing_port"]) || 0,
  };
  return {
    at: Date.now(), version: facts.version, codename: codenameOf(facts.version), host: facts.host, ports, groups,
    undo: await lastBackup(),
  };
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
