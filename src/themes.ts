// Themes: the MustardOS theme catalogue (the list the handheld's own Theme Download reads), previews, and installing,
// applying and removing themes over SSH. Since 2601.0 every theme is an open folder in MUOS/theme on SD1 and the active
// one is named in config/theme/active; "theme.sh bootlogo" then restarts the menu with it, as the Theme Picker does.

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ctx } from "./context.ts";
import { runCommand, sshStatus, streamCommand } from "./device/ssh.ts";
import { UserError } from "./errors.ts";
import { requireIdle } from "./jobs.ts";
import { say } from "./log.ts";

const DATA_URL = "https://raw.githubusercontent.com/MustardOS/theme/refs/heads/main/docs/theme_data.json";
const PREVIEW_URL = "https://raw.githubusercontent.com/MustardOS/theme/refs/heads/main/current/";
const THEMES = "/run/muos/storage/theme";
const ACTIVE = "/opt/muos/config/theme/active";
export const RESOLUTIONS = ["640x480", "720x480", "720x720", "1024x768", "1280x720"];
const FRESH_MS = 12 * 3600_000;
const AGENT = { "User-Agent": "muos-anbernic-manager" };

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

export interface Theme { name: string; url: string; res: string[]; grid: boolean; hdmi: boolean; language: boolean }

/** A folder name the handheld can hold as a theme; "active" and "override" are MustardOS's own folders. */
export const safeName = (n: unknown): n is string =>
  typeof n === "string" && n.length > 0 && n.length <= 100 && n.trim() === n && !n.startsWith(".") && !/[/\\\0\r\n\t]/.test(n) && n !== "active" && n !== "override";

/** The entries of theme_data.json that point at a MustardOS theme release. */
export function parseCatalogue(raw: unknown): Theme[] {
  if (!Array.isArray(raw)) throw new UserError("The theme list is not in the expected format.");
  return raw.flatMap((t) => {
    if (!t || !safeName(t.name) || typeof t.url !== "string") return [];
    if (!/^https:\/\/github\.com\/MustardOS\/theme\/releases\/download\/[^/]+\/[^/]+\.muxthm$/.test(t.url)) return [];
    return [{ name: t.name, url: t.url, res: RESOLUTIONS.filter((r) => t[`resolution${r}`] === true), grid: !!t.grid, hdmi: !!t.hdmi, language: !!t.language }];
  });
}

// ---------------------------------------------------------------- the catalogue

let catalogue: { fetched: number; themes: Theme[] } | null = null;
const cacheDir = () => path.join(ctx.cacheDir, "themes");
const catalogueFile = () => path.join(cacheDir(), "catalogue.json");

async function loadCatalogue(refresh: boolean): Promise<{ fetched: number; themes: Theme[]; error: string }> {
  if (!catalogue) { try { catalogue = JSON.parse(await fsp.readFile(catalogueFile(), "utf8")); } catch {} }
  if (catalogue && !refresh && Date.now() - catalogue.fetched < FRESH_MS) return { ...catalogue, error: "" };
  try {
    const res = await fetch(DATA_URL, { headers: AGENT, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    catalogue = { fetched: Date.now(), themes: parseCatalogue(await res.json()) };
    await fsp.mkdir(cacheDir(), { recursive: true });
    await fsp.writeFile(catalogueFile(), JSON.stringify(catalogue));
    return { ...catalogue, error: "" };
  } catch (error) {
    const message = error instanceof UserError ? error.message : `Could not load the theme list: ${(error as Error).message}`;
    return { fetched: catalogue?.fetched ?? 0, themes: catalogue?.themes ?? [], error: message };
  }
}

// ---------------------------------------------------------------- the handheld

interface Installed { name: string; version: string; title: string; kb: number }
interface DeviceThemes { active: string; res: string; foreground: string; freeKb: number; installed: Installed[] }

const DEVICE_SCRIPT = String.raw`cd ${THEMES} 2>/dev/null || { echo "@missing"; exit 0; }
printf '@active\t%s\n' "$(cat ${ACTIVE} 2>/dev/null)"
printf '@res\t%sx%s\n' "$(cat /opt/muos/device/config/screen/internal/width 2>/dev/null)" "$(cat /opt/muos/device/config/screen/internal/height 2>/dev/null)"
printf '@fg\t%s\n' "$(cat /opt/muos/config/system/foreground_process 2>/dev/null)"
printf '@free\t%s\n' "$(df -k . | awk 'NR==2{print $4}')"
for d in */; do d="${"$"}{d%/}"; [ -f "$d/version.txt" ] || continue
  printf '=%s\t%s\t%s\t%s\n' "$d" "$(head -n1 "$d/version.txt" | tr -d '\r\t')" "$(head -n1 "$d/name.txt" 2>/dev/null | tr -d '\r\t')" "$(du -sk "$d" | cut -f1)"
done`;

export function parseDevice(out: string): DeviceThemes {
  if (out.includes("@missing")) throw new UserError("This handheld has no MUOS/theme folder. Themes as folders need MustardOS 2601.0 or newer.");
  const d: DeviceThemes = { active: "", res: "640x480", foreground: "", freeKb: 0, installed: [] };
  for (const line of out.split("\n")) {
    const f = line.split("\t");
    if (f[0] === "@active") d.active = f[1]?.trim() ?? "";
    else if (f[0] === "@res" && /^\d+x\d+$/.test(f[1]?.trim() ?? "")) d.res = f[1].trim();
    else if (f[0] === "@fg") d.foreground = f[1]?.trim() ?? "";
    else if (f[0] === "@free") d.freeKb = Number(f[1]) || 0;
    else if (f[0].startsWith("=") && safeName(f[0].slice(1))) d.installed.push({ name: f[0].slice(1), version: f[1] ?? "", title: f[2] ?? "", kb: Number(f[3]) || 0 });
  }
  d.installed.sort((a, b) => a.name.localeCompare(b.name));
  return d;
}

async function connected(): Promise<void> {
  const s = await sshStatus();
  if (!s.configured || !s.reachable) throw new UserError("Connect the handheld over Wi-Fi with Secure Shell on to change its theme.");
}

const readDevice = async () => parseDevice((await runCommand(DEVICE_SCRIPT, 30_000)).out);

/** The catalogue, and the themes on the handheld when it can be reached over SSH. */
export async function themesJson(query?: URLSearchParams) {
  const [cat, status] = await Promise.all([loadCatalogue(query?.get("refresh") === "1"), sshStatus()]);
  let device: DeviceThemes | null = null, deviceError = "";
  if (status.configured && status.reachable) {
    try { device = await readDevice(); } catch (error) { deviceError = (error as Error).message; }
  }
  return {
    catalogue: { fetched: cat.fetched, error: cat.error, themes: cat.themes },
    reachable: !!(status.configured && status.reachable), host: status.host, device, deviceError, resolutions: RESOLUTIONS,
  };
}

// ---------------------------------------------------------------- previews

const previews = new Map<string, Buffer>();

/** A catalogue theme's preview from the theme repository, kept on disk after the first look. */
export async function themePreview(query: URLSearchParams) {
  const name = query.get("name") ?? "", kind = query.get("kind") === "gif" ? "gif" : "png";
  const theme = (await loadCatalogue(false)).themes.find((t) => t.name === name);
  if (!theme) throw new UserError("Unknown theme.");
  const want = query.get("res") ?? "";
  const res = theme.res.includes(want) ? want : theme.res[0] || "640x480";
  const file = path.join(cacheDir(), "previews", `${crypto.createHash("sha1").update(`${name}|${res}`).digest("hex")}.${kind}`);
  try { return { image: await fsp.readFile(file), name: file }; } catch {}
  const missing = `${file}.none`;
  if (fs.existsSync(missing)) throw new UserError("This theme has no such preview.");
  const res2 = await fetch(`${PREVIEW_URL}${encodeURIComponent(name)}/${res}/preview.${kind}`, { headers: AGENT, signal: AbortSignal.timeout(30_000) });
  await fsp.mkdir(path.dirname(file), { recursive: true });
  if (res2.status === 404) { await fsp.writeFile(missing, ""); throw new UserError("This theme has no such preview."); }
  if (!res2.ok) throw new UserError(`GitHub answered ${res2.status}.`);
  const image = Buffer.from(await res2.arrayBuffer());
  await fsp.writeFile(file, image);
  return { image, name: file };
}

/** A preview screen of a theme on the handheld (preview.png, preview.0.png, ...) for its screen size or any other. */
export async function deviceThemePreview(query: URLSearchParams) {
  const name = query.get("name") ?? "", n = /^[0-9]$/.test(query.get("n") ?? "") ? `.${query.get("n")}` : "";
  if (!safeName(name)) throw new UserError("Unknown theme.");
  const res = /^\d+x\d+$/.test(query.get("res") ?? "") ? query.get("res")! : "640x480";
  const key = `${name}|${res}|${n}`;
  if (previews.has(key)) return { image: previews.get(key)!, name: "preview.png" };
  const dir = `${THEMES}/${name}`;
  const { out } = await runCommand(`f=${quote(`${dir}/${res}/preview${n}.png`)}; [ -f "$f" ] || f=$(ls ${quote(dir)}/*/preview${n}.png 2>/dev/null | head -n1); [ -n "$f" ] && [ -f "$f" ] && base64 "$f" | tr -d '\\n'`, 20_000);
  if (!out.trim()) throw new UserError("This theme has no such preview.");
  const image = Buffer.from(out.trim(), "base64");
  if (previews.size > 200) previews.delete(previews.keys().next().value!);
  previews.set(key, image);
  return { image, name: "preview.png" };
}

// ---------------------------------------------------------------- install, apply, remove

let busy = "";

async function exclusive<T>(what: string, fn: () => Promise<T>): Promise<T> {
  if (busy) throw new UserError(`Wait until ${busy} finishes.`);
  requireIdle("Wait for the current job to finish first.");
  busy = what;
  try { return await fn(); } finally { busy = ""; }
}

const inMenu = (d: DeviceThemes) => d.foreground === "" || d.foreground === "muxfrontend";
const startApply = (name: string) =>
  runCommand(`printf '%s\\n' ${quote(name)} > ${ACTIVE} && setsid -f /opt/muos/script/package/theme.sh bootlogo launcher </dev/null >/dev/null 2>&1; echo @ok`);

/** Downloads a catalogue theme, unpacks it into MUOS/theme on the handheld and, if asked, makes it the active theme. */
export async function installTheme(body: Record<string, unknown>) {
  const theme = (await loadCatalogue(false)).themes.find((t) => t.name === body.name);
  if (!theme) throw new UserError("That theme is not in the theme list.");
  return exclusive(`installing ${theme.name}`, async () => {
    await connected();
    const before = await readDevice();
    const apply = body.apply === true || before.active === theme.name;
    if (apply && !inMenu(before)) throw new UserError("Something is running on the handheld. Go back to its main menu, then try again.");

    await fsp.mkdir(cacheDir(), { recursive: true });
    const file = path.join(cacheDir(), `.download-${process.pid}-${Date.now()}.muxthm`);
    try {
      const res = await fetch(theme.url, { headers: AGENT, redirect: "follow", signal: AbortSignal.timeout(10 * 60_000) });
      if (!res.ok || !res.body) throw new UserError(`Downloading ${theme.name} failed: GitHub answered ${res.status}.`);
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), fs.createWriteStream(file));
      const head = Buffer.alloc(4);
      const fd = await fsp.open(file, "r");
      try { await fd.read(head, 0, 4, 0); } finally { await fd.close(); }
      if (head.readUInt32LE(0) !== 0x04034b50) throw new UserError(`${theme.name} did not download as a theme archive.`);
      const { size } = await fsp.stat(file);
      if (before.freeKb && size * 3 > before.freeKb * 1024) throw new UserError(`SD1 has too little free space for ${theme.name}.`);
      const md5 = crypto.createHash("md5").update(await fsp.readFile(file)).digest("hex");

      const id = crypto.randomBytes(4).toString("hex");
      const tmp = quote(`${THEMES}/.manager-${id}.muxthm`), stage = quote(`${THEMES}/.manager-${id}`), dest = quote(`${THEMES}/${theme.name}`);
      const script = [
        `cd ${THEMES} || exit 1`,
        `cat > ${tmp} || { rm -f ${tmp}; exit 1; }`,
        `[ "$(md5sum < ${tmp} | cut -d' ' -f1)" = ${md5} ] || { rm -f ${tmp}; echo "@corrupt"; exit 1; }`,
        `if unzip -Z1 ${tmp} | grep -qE '^/|(^|/)\\.\\.(/|$)'; then rm -f ${tmp}; echo "@unsafe"; exit 1; fi`,
        `mkdir ${stage} && unzip -q -o ${tmp} -d ${stage} || { rm -rf ${tmp} ${stage}; echo "@unzip"; exit 1; }`,
        `rm -f ${tmp}`,
        `[ -f ${stage}/version.txt ] || { rm -rf ${stage}; echo "@notheme"; exit 1; }`,
        `[ -f ${stage}/name.txt ] || printf '%s\\n' ${quote(theme.name)} > ${stage}/name.txt`,
        `rm -rf ${dest} && mv ${stage} ${dest} && sync && echo "@ok"`,
      ].join("\n");
      const chunks: Buffer[] = [];
      const sink = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } });
      const { code, err } = await streamCommand(script, { stdin: fs.createReadStream(file), stdout: sink }, 10 * 60_000);
      const out = Buffer.concat(chunks).toString("utf8");
      if (code !== 0 || !out.includes("@ok")) {
        const why = out.includes("@corrupt") ? "the copy on the handheld did not match" : out.includes("@unsafe") ? "the archive has unsafe paths"
          : out.includes("@notheme") ? "it is not a MustardOS theme" : out.includes("@unzip") ? "unpacking failed" : err.trim() || "the handheld stopped answering";
        throw new UserError(`Installing ${theme.name} failed: ${why}.`);
      }
    } finally {
      await fsp.rm(file, { force: true });
    }
    for (const key of [...previews.keys()]) if (key.startsWith(`${theme.name}|`)) previews.delete(key);
    if (apply) await startApply(theme.name);
    say("green", "THEME", `${apply ? "Installed and applied" : "Installed"} ${theme.name} on the handheld.`);
    return { applied: apply, ...(await themesJson()) };
  });
}

/** Makes an installed theme the active one; the handheld's menu restarts with it. */
export async function applyTheme(body: Record<string, unknown>) {
  const name = body.name;
  if (!safeName(name)) throw new UserError("Pick a theme.");
  return exclusive(`applying ${name}`, async () => {
    await connected();
    const d = await readDevice();
    if (!d.installed.some((t) => t.name === name)) throw new UserError(`${name} is not on the handheld.`);
    if (!inMenu(d)) throw new UserError("Something is running on the handheld. Go back to its main menu, then try again.");
    const { out } = await startApply(name);
    if (!out.includes("@ok")) throw new UserError("The handheld did not take the theme.");
    say("green", "THEME", `Applied ${name} on the handheld.`);
    return { ok: true };
  });
}

/** Deletes an installed theme from the handheld; the active theme stays. */
export async function deleteTheme(body: Record<string, unknown>) {
  const name = body.name;
  if (!safeName(name)) throw new UserError("Pick a theme.");
  return exclusive(`removing ${name}`, async () => {
    await connected();
    const d = await readDevice();
    if (d.active === name) throw new UserError(`${name} is the active theme. Apply another theme first.`);
    if (!d.installed.some((t) => t.name === name)) throw new UserError(`${name} is not on the handheld.`);
    const { out } = await runCommand(`rm -rf ${quote(`${THEMES}/${name}`)} && sync && echo @ok`, 60_000);
    if (!out.includes("@ok")) throw new UserError(`Could not delete ${name}.`);
    for (const key of [...previews.keys()]) if (key.startsWith(`${name}|`)) previews.delete(key);
    say("yellow", "THEME", `Deleted ${name} from the handheld.`);
    return themesJson();
  });
}
