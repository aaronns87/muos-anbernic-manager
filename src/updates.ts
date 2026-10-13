// Update checks: the MustardOS release list on mustardos.github.io against the handheld's version and the image in the
// os folder, and GitHub releases of known apps against the packages in the apps folder. Downloads go to the apps folder.

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ctx } from "./context.ts";
import { runCommand, sshStatus } from "./device/ssh.ts";
import { UserError } from "./errors.ts";
import { human, say } from "./log.ts";
import { listDir, removeQuietly } from "./util.ts";

const SITE = "https://raw.githubusercontent.com/MustardOS/mustardos.github.io/main";
const SITE_API = "https://api.github.com/repos/MustardOS/mustardos.github.io/contents/_data/releases";
const CACHE_AGE = 6 * 3600_000;

/** Apps with GitHub releases, matched by package or app name. */
export const APP_SOURCES = [
  { name: "vTree", repo: "MustardOS/vtree", match: /^vtree/i, asset: /\.muxapp$/i },
  { name: "Scrappy", repo: "gabrielfvale/scrappy", match: /^scrappy/i, asset: /\.(muxzip|muxapp)$/i },
];

// ---------------------------------------------------------------- small parsers

/** The scalar and simple list values of a flat YAML file such as the site's release and device data. */
export function parseYaml(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const stack: { indent: number; obj: Record<string, unknown> | unknown[] }[] = [{ indent: -1, obj: out }];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    const line = raw.trim();
    const unq = (v: string) => v.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (line.startsWith("- ")) {
      if (!Array.isArray(parent)) continue;
      const item = line.slice(2);
      const kv = /^([\w-]+):\s*(.*)$/.exec(item);
      if (kv) {
        const obj: Record<string, unknown> = { [kv[1]]: unq(kv[2]) };
        parent.push(obj);
        stack.push({ indent, obj });
      } else parent.push(unq(item));
      continue;
    }
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv || Array.isArray(parent)) continue;
    const [, key, value] = kv;
    if (value === "|" || value === ">") {
      const block: string[] = [];
      while (i + 1 < lines.length && (!lines[i + 1].trim() || lines[i + 1].length - lines[i + 1].trimStart().length > indent)) block.push(lines[++i].trim());
      parent[key] = block.join(value === "|" ? "\n" : " ").trim();
    } else if (value) parent[key] = unq(value);
    else {
      const next = lines.slice(i + 1).find((l) => l.trim());
      const child = next?.trim().startsWith("- ") ? [] : {};
      parent[key] = child;
      stack.push({ indent, obj: child as Record<string, unknown> });
    }
  }
  return out;
}

/** "2601.1" < "2606.0"; also handles "v8.0.5" and "1.4". */
export function compareVersions(a: string, b: string): number {
  const p = (v: string) => (v.match(/\d+/g) || []).map(Number);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

const versionIn = (name: string) => /v?(\d+(?:\.\d+)+)/i.exec(name)?.[1] || "";
const strip = (html: string) => String(html || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();

// ---------------------------------------------------------------- fetching

async function getText(url: string, json = false): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "muos-anbernic-manager", ...(json ? { Accept: "application/vnd.github+json" } : {}) }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 403 || res.status === 429) throw new UserError("GitHub's hourly limit for update checks is used up. Try again later.");
  if (!res.ok) throw new UserError(`${new URL(url).host} answered ${res.status}.`);
  return res.text();
}

interface Release { ver: string; code: string; type: string; changes: string[]; notes: string[]; important: string; updateFrom: string[]; links: Record<string, string>; updateLinks: Record<string, string> }
interface AppRelease { tag: string; date: string; url: string; assets: { name: string; size: number; url: string }[] }
interface Remote { fetched: number; releases: Release[]; images: Record<string, { name: string; hash: string; links: Record<string, string> }>; apps: Record<string, AppRelease | { error: string }> }

let remote: Remote | null = null;
const cacheFile = () => path.join(ctx.cacheDir, "updates.json");

/** Forgets the last MustardOS and app release check; the next look goes online again. */
export async function clearUpdateCache(): Promise<void> {
  remote = null;
  await fsp.rm(cacheFile(), { force: true });
}

function release(y: Record<string, unknown>): Release {
  const ua = (y.update_archive || {}) as Record<string, unknown>;
  const fi = (y.full_image || {}) as Record<string, unknown>;
  const links = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k, v]) => typeof v === "string" && /^https?:/.test(v) && k !== "warning"));
  const important = String(ua.important || "");
  return {
    ver: String(y.ver || ""), code: String(y.code || ""), type: String(y.type || ""),
    changes: (Array.isArray(y.changes) ? y.changes : []).map((c) => strip(String(c))),
    notes: (Array.isArray(y.note) ? y.note : []).map((c) => strip(String(c))),
    important: strip(important.split("<ul>")[0]),
    updateFrom: [...important.matchAll(/<strong>([\d.]+)<\/strong>/g)].map((m) => m[1]),
    links: links(fi) as Record<string, string>, updateLinks: links(ua) as Record<string, string>,
  };
}

async function fetchRemote(device: string): Promise<Remote> {
  const names = (JSON.parse(await getText(SITE_API, true)) as { name: string }[]).map((f) => f.name).filter((n) => /^\d+_\d+\.yml$/.test(n));
  names.sort((a, b) => compareVersions(b, a));
  const releases = (await Promise.all(names.slice(0, 3).map(async (n) => release(parseYaml(await getText(`${SITE}/_data/releases/${n}`)))))).filter((r) => r.ver);
  const images: Remote["images"] = {};
  if (device) {
    try {
      const d = parseYaml(await getText(`${SITE}/_data/devices/${device}.yml`));
      for (const dl of (Array.isArray(d.downloads) ? d.downloads : []) as Record<string, string>[]) {
        const url = dl.gofile || dl.mega || "";
        const name = dl.torrent ? `${dl.torrent}.img.gz` : path.basename(url);
        if (name) { images[device] = { name, hash: dl.hash || "", links: Object.fromEntries(Object.entries(dl).filter(([, v]) => /^https?:/.test(v))) }; break; }
      }
    } catch {}
  }
  const apps: Remote["apps"] = {};
  for (const src of APP_SOURCES) {
    try {
      const r = JSON.parse(await getText(`https://api.github.com/repos/${src.repo}/releases/latest`, true));
      apps[src.repo] = {
        tag: r.tag_name, date: r.published_at, url: r.html_url,
        assets: (r.assets || []).filter((a: { name: string }) => src.asset.test(a.name)).map((a: { name: string; size: number; browser_download_url: string }) => ({ name: a.name, size: a.size, url: a.browser_download_url })),
      };
    } catch (error) {
      apps[src.repo] = { error: (error as Error).message };
    }
  }
  return { fetched: Date.now(), releases, images, apps };
}

async function loadRemote(device: string, refresh: boolean): Promise<{ data: Remote | null; error: string }> {
  if (!remote) { try { remote = JSON.parse(await fsp.readFile(cacheFile(), "utf8")); } catch {} }
  const stale = !remote || Date.now() - remote.fetched > CACHE_AGE || (device && !remote.images[device]);
  if (!refresh && !stale) return { data: remote, error: "" };
  try {
    remote = await fetchRemote(device);
    await fsp.mkdir(ctx.cacheDir, { recursive: true });
    await fsp.writeFile(cacheFile(), JSON.stringify(remote));
    return { data: remote, error: "" };
  } catch (error) {
    return { data: remote, error: (error as Error).message };
  }
}

// ---------------------------------------------------------------- local state

const hashes = new Map<string, { key: string; sha: string }>();

async function sha256(file: string): Promise<string> {
  const st = await fsp.stat(file);
  const key = `${st.size}:${st.mtimeMs}`;
  if (hashes.get(file)?.key === key) return hashes.get(file)!.sha;
  const h = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), h);
  const sha = h.digest("hex");
  hashes.set(file, { key, sha });
  return sha;
}

async function osImages(): Promise<{ file: string; size: number }[]> {
  const out: { file: string; size: number }[] = [];
  const walk = async (dir: string, depth: number) => {
    for (const e of await listDir(dir)) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth < 2) await walk(full, depth + 1);
      else if (e.isFile() && /\.img(\.gz|\.xz)?$/i.test(e.name)) out.push({ file: full, size: (await fsp.stat(full)).size });
    }
  };
  await walk(ctx.os, 0);
  return out;
}

export async function deviceVersion(): Promise<{ version: string; build: string }> {
  const s = await sshStatus();
  if (!s.configured || !s.reachable) return { version: "", build: "" };
  const { out } = await runCommand(`printf '%s\\n' "$(cat /opt/muos/config/system/version 2>/dev/null)" "$(cat /opt/muos/config/system/build 2>/dev/null)"`, 10_000);
  const [version = "", build = ""] = out.split("\n").map((l) => l.trim());
  return { version, build };
}

/** The release an image name such as MustardOS_RG40XX-H_2601.1_FUNKY_JACARANDA-bc38efa0.img.gz belongs to, if its build id matches.
 * Point releases keep the version file of the release they update, so the build id is what tells them apart. */
export function versionOfBuild(build: string, names: string[]): string {
  if (!/^[0-9a-f]{6,}$/i.test(build)) return "";
  const hit = names.find((n) => n.toLowerCase().includes(`-${build.toLowerCase()}.img`));
  return hit ? versionIn(hit.replace(/^MustardOS_[^_]+_/, "")) : "";
}

/** The release a handheld build id belongs to, from the images in the os folder and the last update check; never goes online. */
export async function releaseOfBuild(build: string): Promise<string> {
  if (!remote) { try { remote = JSON.parse(await fsp.readFile(cacheFile(), "utf8")); } catch {} }
  const names = [...Object.values(remote?.images ?? {}).map((i) => i.name), ...(await osImages()).map((i) => path.basename(i.file))];
  return versionOfBuild(build, names);
}

/** The handheld's version file with the release corrected from the build id, e.g. 2601.0_JACARANDA becomes 2601.1_JACARANDA. */
export async function runningVersion(version: string, build: string): Promise<string> {
  const release = version && build ? await releaseOfBuild(build) : "";
  return release && !version.startsWith(release) ? version.replace(/^\d+\.\d+/, release) : version;
}

// ---------------------------------------------------------------- the report

/** What is newer than what the handheld runs and what the os and apps folders hold. */
export async function updatesJson(query?: URLSearchParams) {
  const device = /^[a-z0-9-]{3,40}$/.test(query?.get("device") || "") ? query!.get("device")! : "";
  const { data, error } = await loadRemote(device, query?.get("refresh") === "1");
  const dev = await deviceVersion().catch(() => ({ version: "", build: "" }));
  const current = data?.releases.find((r) => r.type === "current") || data?.releases.find((r) => r.type !== "progress") || null;
  const next = data?.releases.find((r) => r.type === "progress" && current && compareVersions(r.ver, current.ver) > 0) || null;
  const image = device ? data?.images[device] || null : null;

  const images = await osImages();
  const byBuild = versionOfBuild(dev.build, [image?.name || "", ...images.map((i) => path.basename(i.file))]);
  const runningVer = byBuild || /^(\d+\.\d+)/.exec(dev.version)?.[1] || "";
  const running = byBuild && !dev.version.startsWith(byBuild) ? `${byBuild}, build ${dev.build}` : dev.version;
  const local = await Promise.all(images.map(async ({ file, size }) => {
    const name = path.basename(file);
    const official = !!image && name === image.name;
    return { name, size, version: versionIn(name.replace(/^MustardOS_[^_]+_/, "")), official, verified: official && image.hash ? (await sha256(file)) === image.hash.toLowerCase() : null };
  }));

  const packages = (await listDir(ctx.apps)).filter((e) => e.isFile() && !e.name.startsWith(".")).map((e) => e.name);
  const apps = APP_SOURCES.map((src) => {
    const r = data?.apps[src.repo];
    const mine = packages.filter((p) => src.match.test(p));
    const localVer = mine.map(versionIn).filter(Boolean).sort((a, b) => compareVersions(b, a))[0] || "";
    const latest = r && "tag" in r ? r : null;
    const cmp = latest && localVer ? compareVersions(versionIn(latest.tag) || latest.tag, localVer) : 0;
    return {
      name: src.name, repo: src.repo, packages: mine, local: localVer,
      latest: latest ? { tag: latest.tag, date: latest.date, url: latest.url, assets: latest.assets.map((a) => ({ ...a, have: packages.includes(a.name) })) } : null,
      error: r && "error" in r ? r.error : "",
      state: !latest ? "unknown" : !localVer ? "none" : cmp > 0 ? "update" : cmp < 0 ? "ahead" : "current",
    };
  });

  return {
    checked: data?.fetched || 0, error,
    os: {
      running, runningVer,
      current, next,
      update: !!(current && runningVer && compareVersions(current.ver, runningVer) > 0),
      archiveFits: !!(current && runningVer && current.updateFrom.includes(runningVer)),
      image: image ? { name: image.name, hash: image.hash, links: image.links } : null,
      local,
    },
    apps,
  };
}

/** Downloads one asset of a checked app release into the apps folder. */
export async function downloadUpdate(body: Record<string, unknown>) {
  const repo = String(body.repo ?? ""), name = String(body.asset ?? "");
  const r = remote?.apps[repo];
  const asset = r && "assets" in r ? r.assets.find((a) => a.name === name) : undefined;
  if (!asset) throw new UserError("Check for updates again; that download is not in the latest release.");
  return downloadToApps(asset);
}

/** Downloads a GitHub release asset into the apps folder; refuses to replace a package that is already there. */
export async function downloadToApps(asset: { name: string; size: number; url: string }) {
  if (/[/\\]/.test(asset.name) || asset.name.startsWith(".")) throw new UserError(`${asset.name} is not a usable file name.`);
  if (!/^https:\/\/github\.com\//.test(asset.url)) throw new UserError(`${asset.name} does not come from GitHub.`);
  await fsp.mkdir(ctx.apps, { recursive: true });
  const target = path.join(ctx.apps, asset.name), partial = path.join(ctx.apps, `.${asset.name}.partial`);
  if (fs.existsSync(target)) throw new UserError(`${asset.name} is already in the apps folder.`);
  try {
    const res = await fetch(asset.url, { headers: { "User-Agent": "muos-anbernic-manager" }, redirect: "follow", signal: AbortSignal.timeout(15 * 60_000) })
      .catch((error: Error) => { throw new UserError(`GitHub could not be reached: ${error.message}`); });
    if (!res.ok || !res.body) throw new UserError(`The download failed (${res.status}).`);
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), fs.createWriteStream(partial))
      .catch((error: Error) => { throw error instanceof UserError ? error : new UserError(`The download of ${asset.name} stopped: ${error.message}`); });
    const size = (await fsp.stat(partial)).size;
    if (asset.size && size !== asset.size) throw new UserError(`The download of ${asset.name} is incomplete.`);
    await fsp.rename(partial, target);
    say("green", "DOWNLOADED", `${asset.name} (${human(size)}) into the apps folder.`);
    return { name: asset.name, size };
  } finally {
    await removeQuietly(partial);
  }
}
