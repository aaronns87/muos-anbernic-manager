// RetroArch options per system: picture and play settings saved as RetroArch overrides on the handheld, either for one
// ROM folder (config/<Core>/<FOLDER>.cfg) or for every system that uses the core (config/<Core>/<Core>.cfg).
// Shaders go into a preset next to the override; RetroArch loads both when a game starts. Needs SSH.

import { coresJson } from "./cores.ts";
import { runCommand } from "./device/ssh.ts";
import { UserError } from "./errors.ts";
import { say } from "./log.ts";
import { shq as quote } from "./util.ts";

const CFG = "/opt/muos/share/info/config";
const INFO = "/opt/muos/share/emulator/retroarch/info";
const SHADERS = "/opt/muos/share/emulator/retroarch/shaders";
const OVERLAYS = "/opt/muos/share/emulator/retroarch/overlays";

/** The overrides this page manages; any other line in an override file is left alone. */
export const KEYS = ["aspect_ratio_index", "video_scale_integer", "video_smooth", "input_overlay", "input_overlay_enable", "input_overlay_opacity", "rewind_enable", "fps_show"];
export const ASPECTS: Record<string, string> = { 22: "Core provided", 0: "4:3", 1: "16:9", 7: "3:2", 21: "Square pixels", 24: "Full screen", 20: "Config" };

export function parseCfg(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/** Merges managed values into an override file's text: "" removes a key, anything else sets it. */
export function mergeCfg(text: string, values: Record<string, string>): string {
  const lines = text.split("\n").filter((l) => {
    const m = /^\s*([A-Za-z0-9_]+)\s*=/.exec(l);
    return l.trim() && !(m && m[1] in values);
  });
  for (const [k, v] of Object.entries(values)) if (v !== "") lines.push(`${k} = "${v}"`);
  return lines.length ? lines.join("\n") + "\n" : "";
}

function readScript(cores: string[]): string {
  return `
for so in ${cores.map(quote).join(" ")}; do
  n=$(sed -n 's/^corename *= *"\\(.*\\)"/\\1/p' "${INFO}/\${so%.so}.info" 2>/dev/null | head -1)
  printf '=N\\t%s\\t%s\\n' "$so" "$n"
  [ -n "$n" ] && for f in "${CFG}/$n"/*.cfg "${CFG}/$n"/*.glslp; do [ -f "$f" ] && { printf '=F\\t%s/%s\\n' "$n" "\${f##*/}"; cat "$f"; echo; }; done
done
printf '=G\\n'; grep -E '^(${KEYS.join("|")}|auto_shaders_enable|video_shader_enable) ' ${CFG}/retroarch.cfg
printf '=P\\n'; head -3 ${CFG}/global.glslp 2>/dev/null
printf '=S\\n'; cd ${SHADERS} 2>/dev/null && find . -name '*.glslp' | sort
printf '=O\\n'; cd ${OVERLAYS} 2>/dev/null && find . -name '*.cfg' | sort
printf '=E\\n'
`;
}

function parse(out: string) {
  const names = new Map<string, string>(), files = new Map<string, string>();
  let global = "", preset = "", shaders: string[] = [], overlays: string[] = [];
  let cur: string[] | null = null, tag = "", key = "";
  const flush = () => {
    if (!cur) return;
    const text = cur.join("\n");
    if (tag === "F") files.set(key, text);
    else if (tag === "G") global = text;
    else if (tag === "P") preset = text;
    else if (tag === "S") shaders = cur.filter(Boolean).map((l) => l.replace(/^\.\//, ""));
    else if (tag === "O") overlays = cur.filter(Boolean).map((l) => l.replace(/^\.\//, ""));
  };
  for (const line of out.split("\n")) {
    const m = /^=(N|F|G|P|S|O|E)(?:\t(.*))?$/.exec(line);
    if (!m) { cur?.push(line); continue; }
    flush();
    cur = null;
    tag = m[1];
    if (tag === "N") { const [so, n] = (m[2] || "").split("\t"); names.set(so, n || ""); continue; }
    if (tag === "E") break;
    key = m[2] || "";
    cur = [];
  }
  return { names, files, global: parseCfg(global), preset, shaders, overlays };
}

const presetShader = (text: string | undefined): string => {
  if (text === undefined) return "";
  const ref = /#reference\s+"([^"]+)"/.exec(text)?.[1];
  if (ref) return ref.startsWith(SHADERS + "/") ? ref.slice(SHADERS.length + 1) : ref;
  return /^\s*shaders\s*=\s*"?0"?/m.test(text) ? "off" : "custom";
};

const overlayRel = (p: string | undefined) => (p && p.startsWith(OVERLAYS + "/") ? p.slice(OVERLAYS.length + 1) : p || "");

/** What one override file sets, in the page's terms. */
function settingsOf(cfg: Map<string, string>, preset: string | undefined) {
  const enabled = cfg.get("input_overlay_enable");
  return {
    aspect: cfg.get("aspect_ratio_index") ?? "",
    integer: cfg.get("video_scale_integer") ?? "",
    smooth: cfg.get("video_smooth") ?? "",
    rewind: cfg.get("rewind_enable") ?? "",
    fps: cfg.get("fps_show") ?? "",
    opacity: cfg.get("input_overlay_opacity") ?? "",
    overlay: enabled === "false" ? "off" : overlayRel(cfg.get("input_overlay")),
    shader: presetShader(preset),
  };
}

async function load() {
  const cores = await coresJson();
  if (!cores.reachable) return { cores, data: null, folders: [] };
  const coreOf = (f: (typeof cores.folders)[number]) => {
    if (f.folder?.so) return f.folder.so;
    const system = cores.systems.find((s) => s.name === f.auto);
    return system?.cores.find((c) => c.key === system.defaultCore)?.so ?? "";
  };
  const folders = cores.folders.map((f) => ({ name: f.name, count: f.count, so: coreOf(f), system: f.folder?.system || f.auto }));
  const sos = [...new Set(folders.map((f) => f.so).filter(Boolean))];
  const { out } = await runCommand(readScript(sos), 60_000);
  if (!out.includes("=E")) throw new UserError("The handheld did not answer completely. Try again.");
  return { cores, data: parse(out), folders };
}

export async function retroarchJson() {
  const { cores, data, folders } = await load();
  if (!data) return { reachable: false, host: cores.host, folders: [] };
  const g = data.global;
  return {
    reachable: true, host: cores.host, frontend: cores.frontend,
    defaults: {
      aspect: g.get("aspect_ratio_index") ?? "", integer: g.get("video_scale_integer") ?? "", smooth: g.get("video_smooth") ?? "",
      rewind: g.get("rewind_enable") ?? "", fps: g.get("fps_show") ?? "", opacity: g.get("input_overlay_opacity") ?? "",
      overlay: g.get("input_overlay_enable") === "false" ? "off" : overlayRel(g.get("input_overlay")),
      shader: g.get("video_shader_enable") === "false" ? "off" : presetShader(data.preset || undefined), autoShaders: g.get("auto_shaders_enable") !== "false",
    },
    aspects: ASPECTS,
    shaders: data.shaders,
    overlays: data.overlays,
    folders: folders.map((f) => {
      const core = data.names.get(f.so) ?? "";
      const file = (n: string) => data.files.get(`${core}/${n}`);
      return {
        name: f.name, count: f.count, system: f.system, so: f.so, core,
        coreSettings: core ? settingsOf(parseCfg(file(`${core}.cfg`) ?? ""), file(`${core}.glslp`)) : null,
        folderSettings: core ? settingsOf(parseCfg(file(`${f.name}.cfg`) ?? ""), file(`${f.name}.glslp`)) : null,
        shared: core ? folders.filter((o) => o.so === f.so && o.name !== f.name).map((o) => o.name) : [],
      };
    }),
  };
}

const BOOL = new Set(["", "true", "false"]);

/** The override values and preset text for the page's settings; throws on anything outside the offered choices. */
export function overrideFor(v: Record<string, unknown>, shaders: string[], overlays: string[]) {
  const s = (k: string) => String(v[k] ?? "");
  for (const k of ["integer", "smooth", "rewind", "fps"]) if (!BOOL.has(s(k))) throw new UserError(`"${s(k)}" is not on or off.`);
  if (s("aspect") && !(s("aspect") in ASPECTS)) throw new UserError("Choose one of the offered aspect ratios.");
  const opacity = s("opacity");
  if (opacity && !(Number(opacity) >= 0 && Number(opacity) <= 1)) throw new UserError("Overlay opacity goes from 0 to 1.");
  const overlay = s("overlay"), shader = s("shader");
  if (overlay && overlay !== "off" && !overlays.includes(overlay)) throw new UserError(`${overlay} is not an overlay on the handheld.`);
  if (shader && shader !== "off" && shader !== "custom" && !shaders.includes(shader)) throw new UserError(`${shader} is not a shader on the handheld.`);
  const values: Record<string, string> = {
    aspect_ratio_index: s("aspect"), video_scale_integer: s("integer"), video_smooth: s("smooth"), rewind_enable: s("rewind"), fps_show: s("fps"),
    input_overlay_opacity: opacity ? Number(opacity).toFixed(6) : "",
    input_overlay: overlay && overlay !== "off" ? `${OVERLAYS}/${overlay}` : "",
    input_overlay_enable: overlay === "off" ? "false" : overlay ? "true" : "",
  };
  const preset = shader === "custom" ? null : shader === "off" ? 'shaders = "0"\n' : shader ? `#reference "${SHADERS}/${shader}"\n` : "";
  return { values, preset };
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

export async function saveRetroarch(body: Record<string, unknown>) {
  const { data, folders } = await load();
  if (!data) throw new UserError("Connect the handheld over Wi-Fi with SSH on to change RetroArch options.");
  const folder = folders.find((f) => f.name === String(body.folder ?? ""));
  if (!folder) throw new UserError(`${String(body.folder ?? "")} is not a ROM folder on the handheld.`);
  const core = data.names.get(folder.so);
  if (!core) throw new UserError(`${folder.name} does not start a RetroArch core, so these options do not apply.`);
  const scope = body.scope === "core" ? "core" : "folder";
  const base = scope === "core" ? core : folder.name;
  const { values, preset } = overrideFor((body.values ?? {}) as Record<string, unknown>, data.shaders, data.overlays);
  const text = mergeCfg(data.files.get(`${core}/${base}.cfg`) ?? "", values);
  const dir = `${CFG}/${core}`, cfg = `${dir}/${base}.cfg`, glslp = `${dir}/${base}.glslp`;
  const write = (file: string, content: string) => content
    ? `printf '%s' ${quote(b64(content))} | base64 -d > ${quote(file + ".tmp")} && mv ${quote(file + ".tmp")} ${quote(file)} || exit 1`
    : `rm -f ${quote(file)}`;
  const script = `mkdir -p ${quote(dir)} || exit 1\n${write(cfg, text)}\n${preset === null ? "" : write(glslp, preset)}\necho OK`;
  const { out, err } = await runCommand(script, 20_000);
  if (!out.includes("OK")) throw new UserError(`Saving on the handheld failed${err ? `: ${err.trim()}` : "."}`);
  const what = scope === "core" ? `${core} (every system using it)` : `${folder.name} with ${core}`;
  say("green", "RETROARCH", text || preset !== "" ? `Saved options for ${what}.` : `Reset options for ${what}.`);
  return { ok: true };
}
