// BIOS files: which ones the handheld's emulators know about (MustardOS's per-system lists in info/assign plus the
// firmware RetroArch's core info files name), checked by MD5 in the local bios folder and in /run/muos/storage/bios,
// and sent there over SSH.

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { ctx } from "./context.ts";
import { runCommand, sshStatus, streamCommand } from "./device/ssh.ts";
import { UserError } from "./errors.ts";
import { say } from "./log.ts";
import { platform } from "./platform/index.ts";
import { inside, isDir, listDir, removeQuietly, shq as quote } from "./util.ts";

const DEVICE_BIOS = "/run/muos/storage/bios";
const ASSIGN = "/opt/muos/share/info/assign";
const INFO = "/opt/muos/share/emulator/retroarch/info";
const MAX_HASH = 128 * 1024 * 1024;
const CATALOG_AGE = 24 * 3600_000;

const safeBiosPath = (p: string) => !!p && !p.startsWith("/") && !p.split("/").includes("..");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const EXTRA_ALIASES: Record<string, string[]> = { Arcade: ["mame", "hbmame", "fbneo", "fba", "cps1", "cps2", "cps3", "pgm", "pgm2", "varcade"] };

const CATALOG_SCRIPT = `
cd ${ASSIGN} || exit 1
for f in */*.ini; do printf '=F\\t%s\\n' "$f"; cat "$f"; echo; done
echo "=J"; cat assign.json 2>/dev/null; echo
for c in $(sed -n 's/^core=\\(.*\\)\\.so[[:space:]]*$/\\1/p' */*.ini | sort -u); do
  [ -f "${INFO}/$c.info" ] && { printf '=I\\t%s\\n' "$c"; grep -E '^(firmware|notes|display_name)' "${INFO}/$c.info"; }
done
echo "=E"
`;

interface CatalogFile { path: string; md5s: string[]; desc: string }
interface CatalogCore { key: string; name: string; required: boolean }
/** files: everything the system's cores can load; main: what MustardOS lists for it or a core cannot run without. */
interface CatalogSystem { name: string; aliases: string[]; defaultCore: string; cores: CatalogCore[]; files: string[]; main: string[] }
interface Catalog { fetched: number; version: string; systems: CatalogSystem[]; files: Record<string, CatalogFile> }

// ---------------------------------------------------------------- the catalogue

export function parseIni(text: string) {
  const sections: { name: string; keys: Record<string, string>; bare: string[] }[] = [];
  let cur = { name: "", keys: {} as Record<string, string>, bare: [] as string[] };
  sections.push(cur);
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const head = /^\[(.+)\]$/.exec(line);
    if (head) { cur = { name: head[1], keys: {}, bare: [] }; sections.push(cur); continue; }
    const eq = line.indexOf("=");
    if (eq > 0) cur.keys[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    else cur.bare.push(line);
  }
  return sections;
}

function parseInfo(lines: string[]) {
  const keys: Record<string, string> = {};
  for (const line of lines) {
    const m = /^(\w+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (m) keys[m[1]] = m[2];
  }
  const md5 = new Map<string, string>();
  for (const note of (keys.notes || "").split("|")) {
    const m = /([^\s()!][^()]*?)\s*\(md5\)\s*:\s*([0-9a-f]{32})/i.exec(note);
    if (m) md5.set(path.basename(m[1].trim()).toLowerCase(), m[2].toLowerCase());
  }
  const firmware: { path: string; desc: string; optional: boolean; md5: string }[] = [];
  for (let i = 0; i < Number(keys.firmware_count || 0); i++) {
    const p = keys[`firmware${i}_path`];
    if (!p) continue;
    firmware.push({ path: p, desc: keys[`firmware${i}_desc`] || "", optional: keys[`firmware${i}_opt`] === "true", md5: md5.get(path.basename(p).toLowerCase()) || "" });
  }
  return { name: keys.display_name || "", firmware };
}

/** Builds the catalogue from the handheld's MustardOS and RetroArch files. */
export function parseCatalog(out: string, version = ""): Catalog {
  const blocks = new Map<string, string[]>();
  let key = "";
  for (const line of out.split("\n")) {
    const tag = /^=(F|J|I|E)(?:\t(.*))?$/.exec(line);
    if (tag) { key = tag[1] === "E" ? "" : `${tag[1]}\t${tag[2] ?? ""}`; if (key) blocks.set(key, []); continue; }
    if (key) blocks.get(key)!.push(line);
  }
  const infos = new Map<string, ReturnType<typeof parseInfo>>();
  for (const [k, lines] of blocks) if (k.startsWith("I\t")) infos.set(k.slice(2), parseInfo(lines));
  let aliasMap: Record<string, string> = {};
  try { aliasMap = JSON.parse(blocks.get("J\t")?.join("\n") || "{}"); } catch {}

  const files: Record<string, CatalogFile> = {};
  const addFile = (p: string, md5: string, desc: string) => {
    const k = p.toLowerCase();
    const f = files[k] || (files[k] = { path: p, md5s: [], desc: "" });
    if (md5 && !f.md5s.includes(md5.toLowerCase())) f.md5s.push(md5.toLowerCase());
    if (desc && !f.desc) f.desc = desc;
    return k;
  };
  const systems = new Map<string, CatalogSystem>();
  const sys = (name: string) => systems.get(name) || systems.set(name, { name, aliases: [...(EXTRA_ALIASES[name] || [])], defaultCore: "", cores: [], files: [], main: [] }).get(name)!;
  for (const [k, lines] of blocks) {
    if (!k.startsWith("F\t")) continue;
    const [dir, file] = k.slice(2).split("/");
    if (!dir || !file) continue;
    const s = sys(dir), ini = parseIni(lines.join("\n"));
    if (file === "global.ini") {
      const g = ini.find((x) => x.name === "global")?.keys || {};
      s.defaultCore = g.default || "";
      const bios = ini.find((x) => x.name === "bios")?.keys || {};
      for (const [bk, v] of Object.entries(bios)) {
        const n = /^file_(\d+)$/.exec(bk);
        if (!n || !v) continue;
        const fk = addFile(v, bios[`hash_${n[1]}`] || "", "");
        if (!s.files.includes(fk)) s.files.push(fk);
        if (!s.main.includes(fk)) s.main.push(fk);
      }
      s.aliases.push(...(ini.find((x) => x.name === "friendly")?.bare || []));
      continue;
    }
    const core = ini.find((x) => x.name && x.name !== "launch");
    if (!core) continue;
    const so = (core.keys.core || "").replace(/\.so$/, "");
    const info = infos.get(so);
    let required = core.keys.bios_required === "1";
    for (const fw of info?.firmware || []) {
      const fk = addFile(fw.path, fw.md5, fw.desc);
      if (!s.files.includes(fk)) s.files.push(fk);
      if (!fw.optional) { required = true; if (!s.main.includes(fk)) s.main.push(fk); }
    }
    s.cores.push({ key: core.name, name: core.keys.name || info?.name || core.name, required });
  }
  for (const [alias, name] of Object.entries(aliasMap)) if (systems.has(name)) systems.get(name)!.aliases.push(alias);
  return {
    fetched: Date.now(), version,
    systems: [...systems.values()].filter((s) => s.files.length).sort((a, b) => a.name.localeCompare(b.name)),
    files,
  };
}

const catalogFile = () => path.join(ctx.cacheDir, "bios-catalog.json");

async function cachedCatalog(): Promise<Catalog | null> {
  try {
    const c: Catalog = JSON.parse(await fsp.readFile(catalogFile(), "utf8"));
    return c.systems.every((s) => Array.isArray(s.main)) ? c : null;
  } catch {
    return null;
  }
}

async function fetchCatalog(): Promise<Catalog> {
  const { out } = await runCommand(CATALOG_SCRIPT, 60_000);
  if (!out.includes("=E")) throw new UserError("The handheld did not send its BIOS lists completely. Try again.");
  const version = (await runCommand("cat /opt/muos/config/system/version 2>/dev/null", 10_000)).out.trim();
  const catalog = parseCatalog(out, version);
  await fsp.mkdir(ctx.cacheDir, { recursive: true });
  await fsp.writeFile(catalogFile(), JSON.stringify(catalog));
  return catalog;
}

// ---------------------------------------------------------------- local and device files

const hashes = new Map<string, { key: string; md5: string }>();

async function md5File(file: string): Promise<string> {
  const st = await fsp.stat(file);
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = hashes.get(file);
  if (hit?.key === key) return hit.md5;
  const hash = crypto.createHash("md5");
  await pipeline(fs.createReadStream(file), hash);
  const md5 = hash.digest("hex");
  hashes.set(file, { key, md5 });
  return md5;
}

interface LocalFile { rel: string; size: number; md5: string }

async function localFiles(): Promise<LocalFile[]> {
  const out: LocalFile[] = [];
  const walk = async (dir: string, depth: number) => {
    for (const e of await listDir(dir)) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) await walk(full, depth + 1);
      else if (e.isFile()) {
        const size = (await fsp.stat(full)).size;
        out.push({ rel: path.relative(ctx.bios, full).split(path.sep).join("/"), size, md5: size <= MAX_HASH ? await md5File(full) : "" });
      }
    }
  };
  await walk(ctx.bios, 0);
  return out;
}

async function deviceFiles(catalog: Catalog): Promise<Map<string, { rel: string; md5: string }>> {
  const { out } = await runCommand(`cd ${DEVICE_BIOS} 2>/dev/null && find . -maxdepth 4 -type f; echo "=E"`, 30_000);
  if (!out.includes("=E")) throw new UserError("The handheld did not list its BIOS folder completely. Try again.");
  const wanted = out.split("\n").map((l) => l.replace(/^\.\//, "")).filter((l) => l && l !== "=E" && catalog.files[l.toLowerCase()]);
  const found = new Map<string, { rel: string; md5: string }>();
  if (!wanted.length) return found;
  const { out: sums } = await runCommand(`cd ${DEVICE_BIOS} && md5sum ${wanted.map(quote).join(" ")}; echo "=E"`, 60_000);
  for (const line of sums.split("\n")) {
    const m = /^([0-9a-f]{32})\s+(.+)$/.exec(line);
    if (m) found.set(m[2].toLowerCase(), { rel: m[2], md5: m[1] });
  }
  return found;
}

// ---------------------------------------------------------------- the report

type State = "ok" | "unknown" | "missing";

function systemFolders(catalog: Catalog, folders: string[]) {
  const bySystem = new Map<string, string[]>();
  for (const s of catalog.systems) {
    const aliases = new Set(s.aliases.map(norm));
    const mine = folders.filter((f) => aliases.has(norm(f)) || norm(f) === norm(s.name));
    if (mine.length) bySystem.set(s.name, mine);
  }
  return bySystem;
}

async function romFolders(): Promise<string[]> {
  const out: string[] = [];
  for (const e of await listDir(ctx.roms)) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const inside = await listDir(path.join(ctx.roms, e.name));
    if (inside.some((x) => x.isFile() && !x.name.startsWith("."))) out.push(e.name);
  }
  return out;
}

let lastReport: { catalog: Catalog | null; local: LocalFile[] } = { catalog: null, local: [] };

/** Every known BIOS file, per system, with its state in the bios folder and on the handheld. */
export async function biosJson(query?: URLSearchParams) {
  const status = await sshStatus();
  const reachable = status.configured && status.reachable;
  let catalog = await cachedCatalog(), catalogError = "", deviceError = "";
  if (reachable && (!catalog || query?.get("refresh") === "1" || Date.now() - catalog.fetched > CATALOG_AGE)) {
    try { catalog = await fetchCatalog(); } catch (error) { catalogError = (error as Error).message; }
  }
  await fsp.mkdir(ctx.bios, { recursive: true });
  const available = true;
  const local = await localFiles();
  let device: Map<string, { rel: string; md5: string }> | null = null;
  if (reachable && catalog) {
    try { device = await deviceFiles(catalog); } catch (error) { deviceError = (error as Error).message; }
  }
  lastReport = { catalog, local };
  const folders = await romFolders();
  const mine = catalog ? systemFolders(catalog, folders) : new Map<string, string[]>();
  const byPath = new Map(local.map((f) => [f.rel.toLowerCase(), f]));
  const judge = (f: CatalogFile, md5: string): State => (!f.md5s.length || f.md5s.includes(md5) ? "ok" : "unknown");

  const fileState = (key: string, main: boolean) => {
    const f = catalog!.files[key];
    const here = byPath.get(key);
    let localState: State = "missing", source = "";
    if (here) { localState = judge(f, here.md5); source = here.rel; }
    if (localState !== "ok" && f.md5s.length) {
      const other = local.find((x) => f.md5s.includes(x.md5));
      if (other) { localState = "ok"; source = other.rel; }
    }
    const d = device?.get(key);
    return {
      key, path: f.path, desc: f.desc, hashes: f.md5s.length, md5s: f.md5s, main,
      local: { state: localState, source },
      device: device ? { state: d ? judge(f, d.md5) : "missing" as State } : null,
    };
  };

  const systems = (catalog?.systems || []).map((s) => {
    const def = s.cores.find((c) => c.key === s.defaultCore);
    return {
      name: s.name, folders: mine.get(s.name) || [],
      defaultCore: def?.name || s.defaultCore, needsBios: !!def?.required,
      requiredBy: s.cores.filter((c) => c.required).map((c) => c.name),
      files: [...s.main.map((k) => fileState(k, true)), ...s.files.filter((k) => !s.main.includes(k)).map((k) => fileState(k, false))],
    };
  }).sort((a, b) => Number(!a.folders.length) - Number(!b.folders.length) || a.name.localeCompare(b.name));

  const known = new Set(Object.values(catalog?.files || {}).flatMap((f) => f.md5s));
  const knownPaths = new Set(Object.keys(catalog?.files || {}));
  return {
    folder: ctx.bios, available,
    deviceFolder: DEVICE_BIOS,
    catalog: catalog ? { fetched: catalog.fetched, version: catalog.version, files: Object.keys(catalog.files).length } : null,
    catalogError,
    device: { reachable, host: status.host, error: deviceError },
    systems,
    extra: local.filter((f) => !knownPaths.has(f.rel.toLowerCase()) && !known.has(f.md5)).map((f) => ({ path: f.rel, size: f.size })),
  };
}

/** The BIOS files a ROM folder's system needs, checked against the bios folder; null before the BIOS tab has read the handheld. */
export async function folderBios(folder: string) {
  const catalog = await cachedCatalog();
  if (!catalog) return null;
  const s = catalog.systems.find((x) => norm(x.name) === norm(folder) || x.aliases.some((a) => norm(a) === norm(folder)));
  if (!s) return { system: "", required: false, requiredBy: [] as string[], files: [] as { path: string; desc: string; state: State }[] };
  const local = (await isDir(ctx.bios)) ? await localFiles() : [];
  const files = s.main.map((key) => {
    const f = catalog.files[key];
    const here = local.find((x) => x.rel.toLowerCase() === key);
    const ok = (here && (!f.md5s.length || f.md5s.includes(here.md5))) || (f.md5s.length && local.some((x) => f.md5s.includes(x.md5)));
    return { path: f.path, desc: f.desc, state: (ok ? "ok" : here ? "unknown" : "missing") as State };
  });
  const def = s.cores.find((c) => c.key === s.defaultCore);
  return { system: s.name, required: !!def?.required, requiredBy: s.cores.filter((c) => c.required).map((c) => c.name), files };
}

// ---------------------------------------------------------------- sending and adding

/** Copies BIOS files from the bios folder to the handheld over SSH, checking each copy's MD5. */
export async function sendBios(body: Record<string, unknown>) {
  const keys = Array.isArray(body.keys) ? body.keys.map((k) => String(k).toLowerCase()) : [];
  if (!keys.length) throw new UserError("Pick the BIOS files to send.");
  const status = await sshStatus();
  if (!status.configured || !status.reachable) throw new UserError("Connect the handheld over Wi-Fi with SSH on to send BIOS files.");
  const { catalog, local } = lastReport;
  if (!catalog) throw new UserError("Open the BIOS tab again; the list of BIOS files is not loaded.");
  const plan: { target: string; source: string; md5: string }[] = [];
  for (const key of keys) {
    const f = catalog.files[key];
    if (!f) throw new UserError(`${key} is not a known BIOS file.`);
    const here = local.find((x) => x.rel.toLowerCase() === key && (!f.md5s.length || f.md5s.includes(x.md5)))
      || local.find((x) => f.md5s.includes(x.md5));
    if (!here) throw new UserError(`The bios folder has no good copy of ${f.path}.`);
    if (!safeBiosPath(f.path)) throw new UserError(`${f.path} is not a safe path.`);
    plan.push({ target: f.path, source: path.join(ctx.bios, here.rel), md5: await md5File(path.join(ctx.bios, here.rel)) });
  }
  for (const p of plan) {
    const t = quote(p.target), part = quote(`${p.target}.partial`);
    const { code, err } = await streamCommand(
      `cd ${DEVICE_BIOS} && mkdir -p "$(dirname ${t})" && cat > ${part} && [ "$(md5sum < ${part} | cut -d' ' -f1)" = ${p.md5} ] && mv -f ${part} ${t} && sync || { rm -f ${part}; exit 1; }`,
      { stdin: fs.createReadStream(p.source) }, 120_000);
    if (code !== 0) throw new UserError(`Sending ${p.target} failed${err ? `: ${err.trim()}` : ""}.`);
  }
  say("green", "SENT", `${plan.length} BIOS file${plan.length === 1 ? "" : "s"} to ${DEVICE_BIOS}: ${plan.map((p) => p.target).join(", ")}.`);
  return { sent: plan.length, ...(await biosJson()) };
}

/** Removes a BIOS file from the workspace bios folder (Trash) and/or from the handheld over SSH. */
export async function deleteBios(body: Record<string, unknown>) {
  const key = String(body.key ?? "").toLowerCase();
  const doLocal = body.local === true;
  const doDevice = body.device === true;
  if (!key) throw new UserError("Pick a BIOS file.");
  if (!doLocal && !doDevice) throw new UserError("Choose the bios folder, the handheld, or both.");
  const catalog = lastReport.catalog || (await cachedCatalog());
  if (!catalog?.files[key]) throw new UserError("Open the BIOS tab again; that BIOS file is not in the list.");
  const f = catalog.files[key];
  if (!safeBiosPath(f.path)) throw new UserError(`${f.path} is not a safe path.`);

  let trashed = "";
  let removedDevice = false;

  if (doLocal) {
    const local = await localFiles();
    const here = local.find((x) => x.rel.toLowerCase() === key)
      || (f.md5s.length ? local.find((x) => f.md5s.includes(x.md5)) : undefined)
      || local.find((x) => path.basename(x.rel).toLowerCase() === path.basename(f.path).toLowerCase());
    if (!here) throw new UserError(`${f.path} is not in the bios folder.`);
    const full = path.join(ctx.bios, ...here.rel.split("/"));
    if (!inside(ctx.bios, full)) throw new UserError("That path is outside the bios folder.");
    await platform.trash(full);
    trashed = here.rel;
  }

  if (doDevice) {
    const status = await sshStatus();
    if (!status.configured || !status.reachable) {
      throw new UserError("Connect the handheld over Wi-Fi with SSH on to delete a BIOS file there.");
    }
    const { out, code } = await runCommand(
      `cd ${DEVICE_BIOS} 2>/dev/null && rm -f ${quote(f.path)} && sync && echo @ok`,
      30_000,
    );
    if (code !== 0 || !out.includes("@ok")) throw new UserError(`Could not delete ${f.path} on the handheld.`);
    removedDevice = true;
  }

  const bits = [
    trashed && `moved ${trashed} to the Trash`,
    removedDevice && `deleted ${f.path} on the handheld`,
  ].filter(Boolean);
  say("yellow", "BIOS", bits.join("; ") + ".");
  return { trashed, removedDevice, ...(await biosJson()) };
}

/**
 * Renames recognised BIOS files in the bios folder to the names MustardOS / RetroArch expect
 * (e.g. SCPH5501.BIN → scph5501.bin). Matches by MD5 or case-insensitive path.
 */
export async function fixBiosNames(catalogOverride?: Catalog) {
  const catalog = catalogOverride || lastReport.catalog || (await cachedCatalog());
  if (!catalog) throw new UserError("Open the BIOS tab again; the list of BIOS files is not loaded.");
  if (!(await isDir(ctx.bios))) throw new UserError("The bios folder is missing.");
  const local = await localFiles();
  lastReport = { catalog, local };
  const fixed: { from: string; to: string }[] = [];
  const skipped: { from: string; to: string; why: string }[] = [];
  const claimed = new Set<string>();

  for (const [key, f] of Object.entries(catalog.files)) {
    if (!safeBiosPath(f.path)) continue;
    const here = local.find((x) => x.rel.toLowerCase() === key && (!f.md5s.length || f.md5s.includes(x.md5)))
      || (f.md5s.length ? local.find((x) => f.md5s.includes(x.md5)) : undefined);
    if (!here || here.rel === f.path) continue;
    const srcKey = here.rel.toLowerCase();
    if (claimed.has(srcKey)) continue;

    const from = path.join(ctx.bios, ...here.rel.split("/"));
    const to = path.join(ctx.bios, ...f.path.split("/"));
    if (!inside(ctx.bios, from) || !inside(ctx.bios, to)) {
      skipped.push({ from: here.rel, to: f.path, why: "unsafe path" });
      continue;
    }

    const samePath = from.toLowerCase() === to.toLowerCase();
    const existing = await fsp.stat(to).catch(() => null);
    if (existing?.isFile() && !samePath) {
      const otherMd5 = await md5File(to);
      if (otherMd5 === here.md5) {
        await platform.trash(from);
        claimed.add(srcKey);
        fixed.push({ from: here.rel, to: f.path });
        continue;
      }
      skipped.push({ from: here.rel, to: f.path, why: "a different file already has that name" });
      continue;
    }

    await fsp.mkdir(path.dirname(to), { recursive: true });
    if (samePath && from !== to) {
      const tmp = path.join(path.dirname(to), `.fix-${path.basename(to)}.tmp`);
      await fsp.rename(from, tmp);
      await fsp.rename(tmp, to);
    } else {
      await fsp.rename(from, to);
    }
    claimed.add(srcKey);
    fixed.push({ from: here.rel, to: f.path });
  }

  if (fixed.length) say("green", "BIOS", `Renamed ${fixed.length} file${fixed.length === 1 ? "" : "s"} to the names the emulators look for.`);
  return { fixed, skipped, ...(await biosJson()) };
}

function uploadName(name: unknown): string {
  const n = String(name ?? "");
  if (!n || n.length > 200 || n.startsWith(".") || /[/\\\0]/.test(n)) throw new UserError(`"${n}" is not a usable file name.`);
  return n;
}

/** Streams one file into the bios folder (PUT body). A recognised BIOS is filed under the name the emulators look for. */
export async function uploadBios(req: http.IncomingMessage, query: URLSearchParams) {
  const name = uploadName(query.get("name"));
  await fsp.mkdir(ctx.bios, { recursive: true });
  const expected = Number(req.headers["content-length"] ?? NaN);
  const partial = path.join(ctx.bios, `.${name}.partial`);
  try {
    await pipeline(req, fs.createWriteStream(partial));
    const size = (await fsp.stat(partial)).size;
    if (Number.isFinite(expected) && size !== expected) throw new UserError(`The upload of ${name} stopped early.`);
    const md5 = size <= MAX_HASH ? await md5File(partial) : "";
    const catalog = lastReport.catalog || (await cachedCatalog());
    const match = md5 ? Object.values(catalog?.files || {}).find((f) => f.md5s.includes(md5)) : undefined;
    const rel = match && safeBiosPath(match.path) ? match.path : name;
    const target = path.join(ctx.bios, ...rel.split("/"));
    if (!inside(ctx.bios, target)) throw new UserError(`${rel} is not a safe path.`);
    if ((await fsp.stat(target).catch(() => null))?.isFile()) {
      if ((await md5File(target)) === md5) return { name, placed: rel, known: !!match, already: true };
      await platform.trash(target);
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rename(partial, target);
    say("green", "ADDED", `${name} to the bios folder${match ? ` as ${rel}` : ""}.`);
    return { name, placed: rel, known: !!match, already: false };
  } finally {
    await removeQuietly(partial);
  }
}
