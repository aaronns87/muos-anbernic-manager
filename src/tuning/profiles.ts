// Game Tuning profiles: the settings worth changing per game for each emulator, what they cost or gain, three presets,
// and starting points for known heavy (or light) games. Values are the exact strings the emulators store.

export type Impact = "speed" | "looks" | "both";
export type Preset = "speed" | "balanced" | "quality";

export interface Setting {
  key: string; label: string; impact: Impact; help: string;
  options: [string, string][];
  /** The emulator's own default, used when no settings file mentions the key. */
  def: string;
  /** PPSSPP only: the ini section the key lives in. */
  section?: string;
}

export interface Profile {
  id: string; name: string; kind: "ppsspp" | "retroarch";
  /** RetroArch core names (the config folder) this profile applies to. */
  cores?: string[];
  settings: Setting[];
  presets: Record<Preset, Record<string, string>>;
}

const onOff = (on = "enabled", off = "disabled"): [string, string][] => [[off, "Off"], [on, "On"]];
const PSP_SPEED = "Faster, but some games then miss effects or draw wrongly.";

const PPSSPP: Profile = {
  id: "ppsspp", name: "PPSSPP (standalone)", kind: "ppsspp",
  settings: [
    { key: "InternalResolution", section: "Graphics", label: "Rendering resolution", impact: "both", def: "1",
      help: "How sharp 3D is drawn. 1x matches the PSP and is fastest; higher needs a lot more GPU.",
      options: [["1", "1x PSP (480 x 272)"], ["2", "2x (960 x 544)"], ["3", "3x (1440 x 816)"]] },
    { key: "FrameSkip", section: "Graphics", label: "Frame skip", impact: "speed", def: "0",
      help: "Draws fewer frames so the game itself keeps full speed. 1 is barely visible; more looks choppy.",
      options: [["0", "Off"], ["1", "1 frame"], ["2", "2 frames"], ["3", "3 frames"]] },
    { key: "AutoFrameSkip", section: "Graphics", label: "Auto frame skip", impact: "speed", def: "False",
      help: "Only skips frames when the game falls behind. Works together with Frame skip.", options: onOff("True", "False") },
    { key: "SkipBufferEffects", section: "Graphics", label: "Skip buffer effects", impact: "speed", def: "False",
      help: `Leaves out blur, glow and similar screen effects. Often the biggest gain. ${PSP_SPEED}`, options: onOff("True", "False") },
    { key: "TextureBackoffCache", section: "Graphics", label: "Lazy texture caching", impact: "speed", def: "False",
      help: "Checks textures for changes less often. Faster; rarely shows an old texture for a moment.", options: onOff("True", "False") },
    { key: "SkipGPUReadbackMode", section: "Graphics", label: "Skip GPU readbacks", impact: "speed", def: "0",
      help: `Stops copying the picture back to the emulated PSP. ${PSP_SPEED}`,
      options: [["0", "Off"], ["1", "Skip"], ["2", "Copy to texture"]] },
    { key: "SplineBezierQuality", section: "Graphics", label: "Curve quality", impact: "both", def: "2",
      help: "Detail of curved surfaces a few games use. Low is faster.", options: [["0", "Low"], ["1", "Medium"], ["2", "High"]] },
    { key: "RenderDuplicateFrames", section: "Graphics", label: "Duplicate frames to 60 Hz", impact: "both", def: "False",
      help: "Repeats frames in 30 fps games so motion is even. Costs a little speed.", options: onOff("True", "False") },
    { key: "TextureFiltering", section: "Graphics", label: "Texture filtering", impact: "looks", def: "1",
      help: "Smooth or sharp textures. Nearly free.", options: [["1", "Auto"], ["2", "Nearest (sharp)"], ["3", "Linear (smooth)"], ["4", "Auto max quality"]] },
    { key: "AnisotropyLevel", section: "Graphics", label: "Anisotropic filtering", impact: "looks", def: "4",
      help: "Keeps floors and roads sharp at an angle. Small cost.", options: [["0", "Off"], ["1", "2x"], ["2", "4x"], ["3", "8x"], ["4", "16x"]] },
    { key: "TexScalingLevel", section: "Graphics", label: "Texture upscaling", impact: "looks", def: "1",
      help: "Smooths textures on the CPU. Heavy; can stutter when new textures appear.", options: [["1", "Off"], ["2", "2x"], ["3", "3x"]] },
    { key: "TexScalingType", section: "Graphics", label: "Upscaling type", impact: "looks", def: "0",
      help: "How Texture upscaling smooths.", options: [["0", "xBRZ"], ["1", "Hybrid"], ["2", "Bicubic"], ["3", "Hybrid + Bicubic"]] },
  ],
  presets: {
    speed: { InternalResolution: "1", FrameSkip: "1", AutoFrameSkip: "True", SkipBufferEffects: "True", TextureBackoffCache: "True", SkipGPUReadbackMode: "1", SplineBezierQuality: "0", RenderDuplicateFrames: "False", TextureFiltering: "1", AnisotropyLevel: "0", TexScalingLevel: "1" },
    balanced: { InternalResolution: "1", FrameSkip: "0", AutoFrameSkip: "False", SkipBufferEffects: "False", TextureBackoffCache: "True", SkipGPUReadbackMode: "0", SplineBezierQuality: "1", RenderDuplicateFrames: "False", TextureFiltering: "1", AnisotropyLevel: "2", TexScalingLevel: "1" },
    quality: { InternalResolution: "2", FrameSkip: "0", AutoFrameSkip: "False", SkipBufferEffects: "False", TextureBackoffCache: "False", SkipGPUReadbackMode: "0", SplineBezierQuality: "2", RenderDuplicateFrames: "False", TextureFiltering: "4", AnisotropyLevel: "4", TexScalingLevel: "2", TexScalingType: "0" },
  },
};

const PPSSPP_LR: Profile = {
  id: "ppsspp-lr", name: "PPSSPP (RetroArch)", kind: "retroarch", cores: ["PPSSPP"],
  settings: [
    { key: "ppsspp_internal_resolution", label: "Rendering resolution", impact: "both", def: "480x272",
      help: PPSSPP.settings[0].help, options: [["480x272", "1x PSP (480 x 272)"], ["960x544", "2x (960 x 544)"], ["1440x816", "3x (1440 x 816)"]] },
    { key: "ppsspp_frameskip", label: "Frame skip", impact: "speed", def: "disabled", help: PPSSPP.settings[1].help,
      options: [["disabled", "Off"], ["1", "1 frame"], ["2", "2 frames"], ["3", "3 frames"]] },
    { key: "ppsspp_auto_frameskip", label: "Auto frame skip", impact: "speed", def: "disabled", help: PPSSPP.settings[2].help, options: onOff() },
    { key: "ppsspp_skip_buffer_effects", label: "Skip buffer effects", impact: "speed", def: "disabled", help: PPSSPP.settings[3].help, options: onOff() },
    { key: "ppsspp_lazy_texture_caching", label: "Lazy texture caching", impact: "speed", def: "disabled", help: PPSSPP.settings[4].help, options: onOff() },
    { key: "ppsspp_skip_gpu_readbacks", label: "Skip GPU readbacks", impact: "speed", def: "disabled", help: PPSSPP.settings[5].help, options: onOff() },
    { key: "ppsspp_lower_resolution_for_effects", label: "Lower resolution for effects", impact: "speed", def: "disabled",
      help: "Draws screen effects at a lower resolution. Faster, effects look blockier.",
      options: [["disabled", "Off"], ["Safe", "Safe"], ["Balanced", "Balanced"], ["Aggressive", "Aggressive"]] },
    { key: "ppsspp_spline_quality", label: "Curve quality", impact: "both", def: "High", help: PPSSPP.settings[6].help,
      options: [["Low", "Low"], ["Medium", "Medium"], ["High", "High"]] },
    { key: "ppsspp_frame_duplication", label: "Duplicate frames to 60 Hz", impact: "both", def: "disabled", help: PPSSPP.settings[7].help, options: onOff() },
    { key: "ppsspp_texture_filtering", label: "Texture filtering", impact: "looks", def: "Auto", help: PPSSPP.settings[8].help,
      options: [["Auto", "Auto"], ["Nearest", "Nearest (sharp)"], ["Linear", "Linear (smooth)"], ["Auto max quality", "Auto max quality"]] },
    { key: "ppsspp_texture_anisotropic_filtering", label: "Anisotropic filtering", impact: "looks", def: "16x", help: PPSSPP.settings[9].help,
      options: [["disabled", "Off"], ["2x", "2x"], ["4x", "4x"], ["8x", "8x"], ["16x", "16x"]] },
    { key: "ppsspp_texture_scaling_level", label: "Texture upscaling", impact: "looks", def: "disabled", help: PPSSPP.settings[10].help,
      options: [["disabled", "Off"], ["2x", "2x"], ["3x", "3x"]] },
  ],
  presets: {
    speed: { ppsspp_internal_resolution: "480x272", ppsspp_frameskip: "1", ppsspp_auto_frameskip: "enabled", ppsspp_skip_buffer_effects: "enabled", ppsspp_lazy_texture_caching: "enabled", ppsspp_skip_gpu_readbacks: "enabled", ppsspp_lower_resolution_for_effects: "Aggressive", ppsspp_spline_quality: "Low", ppsspp_frame_duplication: "disabled", ppsspp_texture_anisotropic_filtering: "disabled", ppsspp_texture_scaling_level: "disabled" },
    balanced: { ppsspp_internal_resolution: "480x272", ppsspp_frameskip: "disabled", ppsspp_auto_frameskip: "disabled", ppsspp_skip_buffer_effects: "disabled", ppsspp_lazy_texture_caching: "enabled", ppsspp_skip_gpu_readbacks: "disabled", ppsspp_lower_resolution_for_effects: "Safe", ppsspp_spline_quality: "Medium", ppsspp_frame_duplication: "disabled", ppsspp_texture_anisotropic_filtering: "4x", ppsspp_texture_scaling_level: "disabled" },
    quality: { ppsspp_internal_resolution: "960x544", ppsspp_frameskip: "disabled", ppsspp_auto_frameskip: "disabled", ppsspp_skip_buffer_effects: "disabled", ppsspp_lazy_texture_caching: "disabled", ppsspp_skip_gpu_readbacks: "disabled", ppsspp_lower_resolution_for_effects: "disabled", ppsspp_spline_quality: "High", ppsspp_frame_duplication: "disabled", ppsspp_texture_filtering: "Auto max quality", ppsspp_texture_anisotropic_filtering: "16x", ppsspp_texture_scaling_level: "2x" },
  },
};

const MUPEN: Profile = {
  id: "mupen64plus", name: "Mupen64Plus-Next", kind: "retroarch", cores: ["Mupen64Plus-Next"],
  settings: [
    { key: "mupen64plus-43screensize", label: "Rendering resolution", impact: "both", def: "640x480",
      help: "How sharp 3D is drawn. 320 x 240 matches the N64 and is fastest.", options: [["320x240", "1x N64 (320 x 240)"], ["640x480", "2x (640 x 480)"], ["960x720", "3x (960 x 720)"]] },
    { key: "mupen64plus-ThreadedRenderer", label: "Threaded renderer", impact: "speed", def: "False",
      help: "Draws on a second CPU core. Usually a clear gain on four-core handhelds.", options: [["False", "Off"], ["True", "On"]] },
    { key: "mupen64plus-FrameDuping", label: "Frame duplication", impact: "speed", def: "True",
      help: "Repeats the last frame when the emulator falls behind instead of slowing down.", options: [["False", "Off"], ["True", "On"]] },
    { key: "mupen64plus-EnableCopyColorToRDRAM", label: "Copy picture to N64 memory", impact: "speed", def: "Async",
      help: "Needed for pause screens, photos and some effects. Off is fastest, Async is the usual trade-off.",
      options: [["Off", "Off"], ["Async", "Async"], ["Sync", "Sync (accurate)"]] },
    { key: "mupen64plus-EnableCopyDepthToRDRAM", label: "Copy depth to N64 memory", impact: "speed", def: "Software",
      help: "Needed for a few effects such as the lens flare in some games. Off is fastest.", options: [["Off", "Off"], ["Software", "Software"], ["FromMem", "From memory"]] },
    { key: "mupen64plus-EnableFBEmulation", label: "Framebuffer emulation", impact: "both", def: "True",
      help: "Off is faster but breaks many effects and menus. Leave on unless a game needs the speed.", options: [["False", "Off"], ["True", "On"]] },
    { key: "mupen64plus-EnableLegacyBlending", label: "Faster blending", impact: "speed", def: "True",
      help: "Simpler colour blending. Faster on weak GPUs; a few effects look slightly off.", options: [["False", "Off"], ["True", "On"]] },
    { key: "mupen64plus-CountPerOp", label: "Count per op", impact: "speed", def: "0",
      help: "Higher values run less CPU work per frame. 0 lets the core choose; 2 or 3 can help slow games but may break timing.",
      options: [["0", "Auto"], ["1", "1"], ["2", "2"], ["3", "3"]] },
    { key: "mupen64plus-BilinearMode", label: "Bilinear filtering", impact: "looks", def: "standard",
      help: "3-point matches the N64's own blur; standard is a little cheaper.", options: [["standard", "Standard"], ["3point", "3-point (N64 look)"]] },
    { key: "mupen64plus-FXAA", label: "FXAA", impact: "looks", def: "0", help: "Softens jagged edges. Small cost.", options: [["0", "Off"], ["1", "On"]] },
    { key: "mupen64plus-MultiSampling", label: "Anti-aliasing (MSAA)", impact: "looks", def: "0",
      help: "Smooth edges. Heavy on handheld GPUs.", options: [["0", "Off"], ["2", "2x"], ["4", "4x"]] },
  ],
  presets: {
    speed: { "mupen64plus-43screensize": "320x240", "mupen64plus-ThreadedRenderer": "True", "mupen64plus-FrameDuping": "True", "mupen64plus-EnableCopyColorToRDRAM": "Off", "mupen64plus-EnableCopyDepthToRDRAM": "Off", "mupen64plus-EnableFBEmulation": "True", "mupen64plus-EnableLegacyBlending": "True", "mupen64plus-BilinearMode": "standard", "mupen64plus-FXAA": "0", "mupen64plus-MultiSampling": "0" },
    balanced: { "mupen64plus-43screensize": "320x240", "mupen64plus-ThreadedRenderer": "True", "mupen64plus-FrameDuping": "True", "mupen64plus-EnableCopyColorToRDRAM": "Async", "mupen64plus-EnableCopyDepthToRDRAM": "Software", "mupen64plus-EnableFBEmulation": "True", "mupen64plus-EnableLegacyBlending": "True", "mupen64plus-BilinearMode": "standard", "mupen64plus-FXAA": "0", "mupen64plus-MultiSampling": "0" },
    quality: { "mupen64plus-43screensize": "640x480", "mupen64plus-ThreadedRenderer": "True", "mupen64plus-FrameDuping": "True", "mupen64plus-EnableCopyColorToRDRAM": "Async", "mupen64plus-EnableCopyDepthToRDRAM": "Software", "mupen64plus-EnableFBEmulation": "True", "mupen64plus-EnableLegacyBlending": "False", "mupen64plus-BilinearMode": "3point", "mupen64plus-FXAA": "1", "mupen64plus-MultiSampling": "0" },
  },
};

const PCSX: Profile = {
  id: "pcsx-rearmed", name: "PCSX-ReARMed", kind: "retroarch", cores: ["PCSX-ReARMed"],
  settings: [
    { key: "pcsx_rearmed_frameskip_type", label: "Frame skip", impact: "speed", def: "disabled",
      help: "Skips drawing frames when the game falls behind, so sound and speed stay right.",
      options: [["disabled", "Off"], ["auto", "Auto"], ["auto_threshold", "Auto (threshold)"], ["fixed_interval", "Fixed interval"]] },
    { key: "pcsx_rearmed_drc", label: "Dynamic recompiler", impact: "speed", def: "enabled",
      help: "The fast CPU core. Turn off only if a game crashes; it gets much slower.", options: onOff() },
    { key: "pcsx_rearmed_spu_thread", label: "Threaded sound", impact: "speed", def: "disabled",
      help: "Runs sound on another CPU core. Helps when the sound crackles under load.", options: onOff() },
    { key: "pcsx_rearmed_neon_enhancement_enable", label: "Enhanced resolution", impact: "both", def: "disabled",
      help: "Draws at twice the PlayStation's resolution. Sharper, much heavier.", options: onOff() },
    { key: "pcsx_rearmed_neon_enhancement_no_main", label: "Enhanced resolution speed hack", impact: "speed", def: "disabled",
      help: "Makes Enhanced resolution cheaper; a few games show glitches.", options: onOff() },
    { key: "pcsx_rearmed_dithering", label: "Dithering", impact: "looks", def: "enabled",
      help: "The PlayStation's grainy colour pattern. Off looks cleaner.", options: [["disabled", "Off"], ["enabled", "On"]] },
  ],
  presets: {
    speed: { pcsx_rearmed_frameskip_type: "auto", pcsx_rearmed_drc: "enabled", pcsx_rearmed_spu_thread: "enabled", pcsx_rearmed_neon_enhancement_enable: "disabled", pcsx_rearmed_dithering: "disabled" },
    balanced: { pcsx_rearmed_frameskip_type: "disabled", pcsx_rearmed_drc: "enabled", pcsx_rearmed_neon_enhancement_enable: "disabled", pcsx_rearmed_dithering: "enabled" },
    quality: { pcsx_rearmed_frameskip_type: "disabled", pcsx_rearmed_drc: "enabled", pcsx_rearmed_neon_enhancement_enable: "enabled", pcsx_rearmed_neon_enhancement_no_main: "disabled", pcsx_rearmed_dithering: "disabled" },
  },
};

/** SwanStation and the older DuckStation core share their options; only the key spelling differs. */
function station(id: string, name: string, core: string, k: (group: string, key: string) => string): Profile {
  const g = (key: string) => k("GPU", key);
  return {
    id, name, kind: "retroarch", cores: [core],
    settings: [
      { key: g("Renderer"), label: "Renderer", impact: "both", def: "Auto",
        help: "Software is often fastest at 1x on handheld GPUs; hardware allows a higher resolution.",
        options: [["Software", "Software"], ["OpenGL", "Hardware (OpenGL)"], ["Auto", "Auto"]] },
      { key: g("ResolutionScale"), label: "Resolution scale", impact: "both", def: "1",
        help: "Sharper 3D with the hardware renderer. Each step costs a lot of GPU.", options: [["1", "1x"], ["2", "2x"], ["3", "3x"]] },
      { key: g("UseThread"), label: "Threaded rendering", impact: "speed", def: "true",
        help: "Software renderer on a second CPU core.", options: onOff("true", "false") },
      { key: k("CPU", "ExecutionMode"), label: "CPU mode", impact: "speed", def: "Recompiler",
        help: "Recompiler is fast; the interpreter only helps a game that crashes.", options: [["Recompiler", "Recompiler"], ["CachedInterpreter", "Cached interpreter"]] },
      { key: g("PGXPEnable"), label: "PGXP geometry correction", impact: "looks", def: "false",
        help: "Stops wobbly polygons. Costs CPU.", options: onOff("true", "false") },
      { key: g("TrueColor"), label: "True colour", impact: "looks", def: "false",
        help: "Smoother colour gradients without dithering.", options: onOff("true", "false") },
      { key: g("TextureFilter"), label: "Texture filtering", impact: "looks", def: "Nearest",
        help: "Smooth textures. Small cost.", options: [["Nearest", "Nearest (sharp)"], ["Bilinear", "Bilinear (smooth)"]] },
    ],
    presets: {
      speed: { [g("Renderer")]: "Software", [g("ResolutionScale")]: "1", [g("UseThread")]: "true", [k("CPU", "ExecutionMode")]: "Recompiler", [g("PGXPEnable")]: "false", [g("TrueColor")]: "false", [g("TextureFilter")]: "Nearest" },
      balanced: { [g("Renderer")]: "Software", [g("ResolutionScale")]: "1", [g("UseThread")]: "true", [k("CPU", "ExecutionMode")]: "Recompiler", [g("PGXPEnable")]: "false", [g("TrueColor")]: "true", [g("TextureFilter")]: "Nearest" },
      quality: { [g("Renderer")]: "OpenGL", [g("ResolutionScale")]: "2", [k("CPU", "ExecutionMode")]: "Recompiler", [g("PGXPEnable")]: "true", [g("TrueColor")]: "true", [g("TextureFilter")]: "Bilinear" },
    },
  };
}

const FLYCAST: Profile = {
  id: "flycast", name: "Flycast", kind: "retroarch", cores: ["Flycast", "Flycast Xtreme", "MorpheusCast Xtreme Acc"],
  settings: [
    { key: "reicast_internal_resolution", label: "Rendering resolution", impact: "both", def: "640x480",
      help: "640 x 480 is the Dreamcast's own; half is much faster but blurry.", options: [["320x240", "Half (320 x 240)"], ["640x480", "Native (640 x 480)"], ["960x720", "1.5x (960 x 720)"]] },
    { key: "reicast_threaded_rendering", label: "Threaded rendering", impact: "speed", def: "enabled",
      help: "Draws on a second CPU core. Big gain; leave on.", options: onOff() },
    { key: "reicast_synchronous_rendering", label: "Synchronous rendering", impact: "speed", def: "disabled",
      help: "Keeps drawing in step with the game. More accurate, slower.", options: onOff() },
    { key: "reicast_frame_skipping", label: "Frame skip", impact: "speed", def: "disabled",
      help: "Draws fewer frames so the game keeps full speed.", options: [["disabled", "Off"], ["1", "1 frame"], ["2", "2 frames"]] },
    { key: "reicast_auto_skip_frame", label: "Auto frame skip", impact: "speed", def: "some",
      help: "Skips frames only when the game falls behind.", options: [["disabled", "Off"], ["some", "Normal"], ["more", "Maximum"]] },
    { key: "reicast_delay_frame_swapping", label: "Delay frame swapping", impact: "both", def: "disabled",
      help: "Fixes flicker in some games; can cost speed.", options: onOff() },
    { key: "reicast_enable_dsp", label: "Sound DSP", impact: "speed", def: "disabled",
      help: "Accurate sound effects such as echo. Off saves CPU.", options: onOff() },
    { key: "reicast_alpha_sorting", label: "Transparency sorting", impact: "both", def: "per-triangle (normal)",
      help: "Per-strip is fastest; per-triangle fixes see-through objects drawn in the wrong order.",
      options: [["per-strip (fast, least accurate)", "Per-strip (fast)"], ["per-triangle (normal)", "Per-triangle (normal)"]] },
    { key: "reicast_mipmapping", label: "Mipmapping", impact: "looks", def: "enabled", help: "Less shimmering on distant textures.", options: onOff() },
    { key: "reicast_anisotropic_filtering", label: "Anisotropic filtering", impact: "looks", def: "4",
      help: "Sharp floors and roads at an angle. Small cost.", options: [["off", "Off"], ["2", "2x"], ["4", "4x"]] },
    { key: "reicast_fog", label: "Fog", impact: "looks", def: "enabled", help: "Fog effects. Off is slightly faster but changes the look.", options: onOff() },
  ],
  presets: {
    speed: { reicast_internal_resolution: "320x240", reicast_threaded_rendering: "enabled", reicast_synchronous_rendering: "disabled", reicast_frame_skipping: "1", reicast_auto_skip_frame: "more", reicast_delay_frame_swapping: "disabled", reicast_enable_dsp: "disabled", reicast_alpha_sorting: "per-strip (fast, least accurate)", reicast_mipmapping: "disabled", reicast_anisotropic_filtering: "off" },
    balanced: { reicast_internal_resolution: "640x480", reicast_threaded_rendering: "enabled", reicast_synchronous_rendering: "disabled", reicast_frame_skipping: "disabled", reicast_auto_skip_frame: "some", reicast_delay_frame_swapping: "disabled", reicast_enable_dsp: "disabled", reicast_alpha_sorting: "per-strip (fast, least accurate)", reicast_mipmapping: "enabled", reicast_anisotropic_filtering: "off" },
    quality: { reicast_internal_resolution: "960x720", reicast_threaded_rendering: "enabled", reicast_synchronous_rendering: "enabled", reicast_frame_skipping: "disabled", reicast_auto_skip_frame: "disabled", reicast_enable_dsp: "enabled", reicast_alpha_sorting: "per-triangle (normal)", reicast_mipmapping: "enabled", reicast_anisotropic_filtering: "4", reicast_fog: "enabled" },
  },
};

export const PROFILES: Profile[] = [
  PPSSPP, PPSSPP_LR, MUPEN, PCSX,
  station("swanstation", "SwanStation", "SwanStation", (g, key) => `swanstation_${g}_${key}`),
  station("duckstation", "DuckStation", "DuckStation", (g, key) => `duckstation_${g}.${key}`),
  FLYCAST,
];

/** RetroArch cores whose .info corename differs from the name they save their options under. */
export const CORE_FOLDERS: Record<string, string> = {
  "flycast-xtreme_libretro.so": "Flycast Xtreme",
  "morpheuscast_libretro.so": "MorpheusCast Xtreme Acc",
};

/** The profile for a core: "ext-ppsspp" for standalone PPSSPP, otherwise the RetroArch core's config folder name. */
export function profileFor(so: string, core: string): Profile | null {
  if (so === "ext-ppsspp") return PPSSPP;
  return PROFILES.find((p) => p.cores?.includes(core)) ?? null;
}

export const GOVERNORS: Record<string, string> = {
  performance: "Performance - full speed, uses the most battery",
  schedutil: "Schedutil - follows the load quickly",
  ondemand: "On demand - speeds up when busy",
  interactive: "Interactive - speeds up on input",
  conservative: "Conservative - speeds up slowly, saves battery",
  powersave: "Power save - slowest, longest battery",
};

export interface Recommendation { profiles: string[]; match: string; preset: Preset; gov?: string; note: string }

const HEAVY_PSP = "god of war|grand theft auto|\\bgta\\b|monster hunter|daxter|ratchet|secret agent clank|killzone|gran turismo|burnout|need for speed|midnight club|wipeout|tekken 6|soulcalibur|soul calibur|dissidia|birth by sleep|crisis core|peace walker|portable ops|battlefront|syphon filter|motorstorm|jak and daxter|resistance|silent hill|metal gear";
const LIGHT_PSP = "bomberman|pac-man|pacman|mega man|megaman|castlevania|lumines|bloons|patapon|locoroco|disgaea|puzzle quest|every extend|tetris|worms|street fighter|darkstalkers|metal slug|king of fighters|capcom classics|namco museum|sega genesis collection|valkyria";
const HEAVY_N64 = "conker|perfect dark|goldeneye|banjo-tooie|banjo tooie|donkey kong 64|rogue squadron|battle for naboo|episode i racer|world driver|majora|indiana jones|resident evil 2|turok 2|turok 3|f-zero x|jet force gemini";
const PSP_PROFILES = ["ppsspp", "ppsspp-lr"];

/** First match wins; the profile-only entries at the end are the per-system fallbacks. */
export const RECOMMENDATIONS: Recommendation[] = [
  { profiles: PSP_PROFILES, match: HEAVY_PSP, preset: "speed", gov: "performance",
    note: "One of the heavier PSP games. Frame skip with auto, Skip buffer effects and Lazy texture caching give the biggest gains; if the picture goes black or effects vanish, turn Skip buffer effects off." },
  { profiles: PSP_PROFILES, match: LIGHT_PSP, preset: "balanced",
    note: "A light PSP game that should run at full speed without skipping frames. Try Best looking if it stays smooth." },
  { profiles: ["mupen64plus"], match: HEAVY_N64, preset: "speed", gov: "performance",
    note: "One of the heaviest N64 games. Turning off the copies to N64 memory gives most of the speed, but can blank pause screens and in-game photos." },
  { profiles: PSP_PROFILES, match: "", preset: "balanced",
    note: "Start here. If the game slows down, switch to Fastest; Skip buffer effects and Frame skip help the most." },
  { profiles: ["mupen64plus"], match: "", preset: "balanced",
    note: "Start here. If the game slows down, switch to Fastest, which turns off the costly copies to N64 memory." },
  { profiles: ["pcsx-rearmed", "swanstation", "duckstation"], match: "", preset: "balanced",
    note: "Most PlayStation games run at full speed with these. Best looking doubles the resolution, which only light games handle." },
  { profiles: ["flycast"], match: "", preset: "speed", gov: "performance",
    note: "Dreamcast is demanding for most handhelds. Start fast, then raise the resolution if the game stays smooth." },
];
