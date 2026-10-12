// Core assignment: which emulator core MustardOS starts for a ROM folder, or for one game in it. Mirrors what the
// frontend's Core Assignment writes in /opt/muos/share/info/content: <FOLDER>/core.cfg (core, system, catalogue,
// lookup, launcher) and <FOLDER>/<game>.cfg (name, core, system, catalogue, lookup, launcher, mount, folder, file).

import { Readable } from "node:stream";
import { parseIni } from "./bios.ts";
import { runCommand, sshStatus, streamCommand } from "./device/ssh.ts";
import { UserError } from "./errors.ts";
import { say } from "./log.ts";

const CONTENT = "/opt/muos/share/info/content";
const ASSIGN = "/opt/muos/share/info/assign";
const ROMS = "/mnt/union/ROMS";

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
const stripExt = (f: string) => (f.lastIndexOf(".") > 0 ? f.slice(0, f.lastIndexOf(".")) : f);

const SCRIPT = `
cd ${ROMS} 2>/dev/null && for d in */; do d=\${d%/}; printf '=D\\t%s\\t%s\\n' "$d" "$(ls -A "$d" 2>/dev/null | wc -l)"; done
cd ${CONTENT} 2>/dev/null && for f in */*.cfg; do [ -f "$f" ] && { printf '=C\\t%s\\n' "$f"; cat "$f"; echo; }; done
cd ${ASSIGN} || exit 1
for f in */*.ini; do printf '=F\\t%s\\n' "$f"; cat "$f"; echo; done
echo "=J"; cat assign.json 2>/dev/null; echo
pgrep -f "/opt/muos/frontend/[m]uxfrontend" >/dev/null && echo "=R"
echo "=E"
`;

interface Core { key: string; name: string; so: string }
interface System { name: string; catalogue: string; lookup: string; defaultCore: string; cores: Core[]; aliases: string[] }
interface Assigned { so: string; system: string; catalogue: string; lookup: string; key: string }
interface Override extends Assigned { name: string; file: string }

function parse(out: string) {
  const blocks: [string, string, string[]][] = [];
  const folders: { name: string; count: number }[] = [];
  let frontend = false, cur: string[] | null = null;
  for (const line of out.split("\n")) {
    const m = /^=(D|C|F|J|R|E)(?:\t(.*))?$/.exec(line);
    if (!m) { cur?.push(line); continue; }
    cur = null;
    if (m[1] === "D") { const [name, count] = (m[2] || "").split("\t"); folders.push({ name, count: Number(count) || 0 }); }
    else if (m[1] === "R") frontend = true;
    else if (m[1] !== "E") { cur = []; blocks.push([m[1], m[2] || "", cur]); }
  }
  const systems = new Map<string, System>();
  let aliases: Record<string, string> = {};
  const content = new Map<string, string[]>();
  for (const [tag, key, lines] of blocks) {
    if (tag === "J") { try { aliases = JSON.parse(lines.join("\n") || "{}"); } catch {} continue; }
    if (tag === "C") { content.set(key, lines.join("\n").replace(/\n$/, "").split("\n")); continue; }
    const [dir, file] = key.split("/");
    if (!dir || !file) continue;
    const s = systems.get(dir) || systems.set(dir, { name: dir, catalogue: dir, lookup: "0", defaultCore: "", cores: [], aliases: [] }).get(dir)!;
    const ini = parseIni(lines.join("\n"));
    if (file === "global.ini") {
      const g = ini.find((x) => x.name === "global")?.keys || {};
      s.name = g.name || dir;
      s.catalogue = g.catalogue || s.name;
      s.lookup = g.lookup || "0";
      s.defaultCore = g.default || "";
      s.aliases.push(...(ini.find((x) => x.name === "friendly")?.bare || []));
    } else {
      const sec = ini.find((x) => x.name && x.name !== "launch");
      if (sec) s.cores.push({ key: sec.name, name: sec.keys.name || sec.name, so: sec.keys.core || "" });
    }
  }
  for (const s of systems.values()) s.cores.sort((a, b) => a.name.localeCompare(b.name));
  return { folders, systems, aliases, content, frontend };
}

const assigned = (l: string[]): Assigned => ({ so: l[0] || "", system: l[1] || "", catalogue: l[2] || "", lookup: l[3] || "0", key: l[4] || "" });

async function read() {
  const status = await sshStatus();
  if (!status.configured || !status.reachable) return { status, data: null };
  const { out } = await runCommand(SCRIPT, 60_000);
  if (!out.includes("=E")) throw new UserError("The handheld did not answer completely. Try again.");
  return { status, data: parse(out) };
}

/** Every ROM folder on the handheld with the core it starts, and the games that have their own core. */
export async function coresJson() {
  const { status, data } = await read();
  if (!data) return { reachable: false, host: status.host, frontend: false, systems: [], folders: [] };
  const norm = (s: string) => s.toLowerCase().replace(/[ \-_+]/g, "");
  const auto = (folder: string) => {
    const name = data.aliases[norm(folder)];
    if (name && data.systems.has(name)) return name;
    const n = folder.toLowerCase().replace(/[^a-z0-9]/g, "");
    return [...data.systems.values()].find((s) => s.aliases.some((a) => a.toLowerCase().replace(/[^a-z0-9]/g, "") === n))?.name || "";
  };
  const folders = data.folders.map(({ name, count }) => {
    const cfg = data.content.get(`${name}/core.cfg`);
    const folder = cfg ? assigned(cfg) : null;
    const overrides: Override[] = [];
    let following = 0;
    for (const [key, l] of data.content) {
      if (!key.startsWith(`${name}/`) || /\/core(_recursive)?\.cfg$/.test(key) || l.length < 6) continue;
      const o = { name: l[0], ...assigned(l.slice(1)), file: l[8] || "" };
      if (folder && o.so === folder.so && o.key === folder.key && o.system === folder.system) following++;
      else overrides.push(o);
    }
    return { name, count, folder, auto: folder ? "" : auto(name), overrides: overrides.sort((a, b) => a.name.localeCompare(b.name)), following };
  });
  const systems = [...data.systems.values()].filter((s) => s.cores.length).map(({ aliases: _, ...s }) => s).sort((a, b) => a.name.localeCompare(b.name));
  return { reachable: true, host: status.host, frontend: data.frontend, systems, folders };
}

async function context(body: Record<string, unknown>) {
  const { data } = await read();
  if (!data) throw new UserError("Connect the handheld over Wi-Fi with SSH on to change cores.");
  const folder = String(body.folder ?? "");
  if (!data.folders.some((f) => f.name === folder)) throw new UserError(`${folder} is not a ROM folder on the handheld.`);
  const system = [...data.systems.values()].find((s) => s.name === String(body.system ?? ""));
  if (!system) throw new UserError(`"${String(body.system ?? "")}" is not a system on the handheld.`);
  const core = system.cores.find((c) => c.key === String(body.core ?? ""));
  if (!core) throw new UserError(`"${String(body.core ?? "")}" is not a core for ${system.name}.`);
  return { data, folder, system, core };
}

/** Shell script that saves stdin as a folder's core.cfg; without keepGames it first removes the games' own cores. */
export function folderScript(content: string, folder: string, keepGames: boolean): string {
  const purge = keepGames ? "" : `for f in "$d"/*.cfg "$d"/*.gov "$d"/*.con "$d"/*.rac; do case "\${f##*/}" in core.*|core_recursive.cfg) ;; *) rm -f "$f" ;; esac; done`;
  return `d=${quote(`${content}/${folder}`)}; mkdir -p "$d" || exit 1
${purge}
cat > "$d/core.cfg.tmp" && mv -f "$d/core.cfg.tmp" "$d/core.cfg" || exit 1
for x in gov con rac; do [ -f "$d/core.$x" ] || cp ${quote(content)}/core.$x "$d/core.$x" 2>/dev/null; done
sync`;
}

/** Shell script that saves stdin as one game's .cfg, with governor, control and RetroArch files copied from its folder. */
export function gameScript(content: string, folder: string, name: string): string {
  return `d=${quote(`${content}/${folder}`)}; b=${quote(`${content}/${folder}/${name}`)}; mkdir -p "$d" || exit 1
cat > "$b.cfg.tmp" && mv -f "$b.cfg.tmp" "$b.cfg" || exit 1
for x in gov con rac; do s="$d/core.$x"; [ -f "$s" ] || s=${quote(content)}/core.$x; [ -f "$s" ] && cp "$s" "$b.$x"; done
sync`;
}

async function write(script: string, input: string) {
  const { code, err } = await streamCommand(script, { stdin: Readable.from([input]) }, 30_000);
  if (code !== 0) throw new UserError(`The handheld could not save the core${err ? `: ${err.trim()}` : ""}.`);
}

/** Sets the core for a whole folder. Unless keepGames is set, games with their own core go back to the folder's. */
export async function setFolderCore(body: Record<string, unknown>) {
  const { folder, system, core } = await context(body);
  await write(folderScript(CONTENT, folder, !!body.keepGames), [core.so, system.name, system.catalogue, system.lookup, core.key].join("\n"));
  say("green", "CORE", `${folder} now starts with ${core.name} (${system.name})${body.keepGames ? ", games with their own core kept" : ""}.`);
  return coresJson();
}

/** The game files in one ROM folder on the handheld, for picking a game to give its own core. */
export async function folderGames(query: URLSearchParams) {
  const folder = String(query.get("folder") ?? "");
  const { data } = await read();
  if (!data) throw new UserError("Connect the handheld over Wi-Fi with SSH on.");
  if (!data.folders.some((f) => f.name === folder)) throw new UserError(`${folder} is not a ROM folder on the handheld.`);
  const { out } = await runCommand(`cd ${quote(`${ROMS}/${folder}`)} && for f in *; do [ -f "$f" ] && printf '%s\\n' "$f"; done; echo "=E"`, 30_000);
  return { folder, games: out.split("\n").filter((l) => l && l !== "=E" && !l.startsWith(".")) };
}

/** Gives one game its own core, as "Assign to this content only" does on the handheld. */
export async function setGameCore(body: Record<string, unknown>) {
  const { folder, system, core } = await context(body);
  const file = String(body.file ?? "");
  if (!file || /[/\n\0]/.test(file) || file.startsWith(".")) throw new UserError(`"${file}" is not a game file name.`);
  const { code } = await runCommand(`[ -f ${quote(`${ROMS}/${folder}/${file}`)} ]`, 15_000);
  if (code !== 0) throw new UserError(`${file} is not in ${folder} on the handheld.`);
  const name = stripExt(file);
  await write(gameScript(CONTENT, folder, name), [name, core.so, system.name, system.catalogue, system.lookup, core.key, `${ROMS}/`, folder, file].join("\n"));
  say("green", "CORE", `${folder}/${file} now starts with ${core.name}.`);
  return coresJson();
}

/** Removes one game's own core, so it follows its folder again. */
export async function resetGameCore(body: Record<string, unknown>) {
  const folder = String(body.folder ?? ""), name = String(body.name ?? "");
  const { data } = await read();
  if (!data) throw new UserError("Connect the handheld over Wi-Fi with SSH on.");
  if (!name || /[/\n\0]/.test(name) || name === "core" || name === "core_recursive" || !data.content.has(`${folder}/${name}.cfg`)) {
    throw new UserError(`${name} has no core of its own in ${folder}.`);
  }
  const base = quote(`${CONTENT}/${folder}/${name}`);
  const { code } = await runCommand(`b=${base}; rm -f "$b.cfg" "$b.gov" "$b.con" "$b.rac" && sync`, 15_000);
  if (code !== 0) throw new UserError("The handheld could not remove the game's core.");
  say("yellow", "CORE", `${folder}/${name} follows the folder's core again.`);
  return coresJson();
}
