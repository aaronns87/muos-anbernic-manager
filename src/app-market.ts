// App market: MustardOS apps that publish packages (.muxapp, .muxzip, .muxupd) in their GitHub releases. The list is the
// community App Downloader listing merged with apps the manager knows; releases, stars and README screenshots come from
// GitHub. Releases are read from github.com's feed and asset pages, which are not part of the API's hourly allowance
// that the update checks need.

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { byId, DEFAULT_DEVICE } from "../public/js/devices.js";
import { ctx } from "./context.ts";
import { UserError } from "./errors.ts";
import { deviceVersion, downloadToApps } from "./updates.ts";

const LISTING = "https://raw.githubusercontent.com/andersmmg/app_downloader/main/apps_listing.json";
const FRESH_MS = 12 * 3600_000;
const AGENT = { "User-Agent": "muos-anbernic-manager" };
const PACKAGE = /\.(muxapp|muxzip|muxupd)$/i;
/** MustardOS release names in the order they came out. */
const CODENAMES = ["BANANA", "PIXIE", "GOOSE", "JACARANDA"];
const MAKERS: Record<string, string> = { ANBERNIC: "Anbernic", TRIMUI: "TrimUI" };

type Need = "wifi";
interface Known { repo: string; title: string; category: string; desc: string; needs?: Need[]; models?: string[]; folder?: string }

/** Apps checked to publish MustardOS packages; the community listing adds its own. */
export const KNOWN: Known[] = [
  { repo: "rommapp/grout", title: "Grout", category: "Online", desc: "RomM client: browse your RomM library, download games to the handheld and sync saves.", needs: ["wifi"] },
  { repo: "milouk/artie", title: "Artie", category: "Tools", desc: "Artwork scraper that fetches box art, screenshots and previews for your games on the handheld.", needs: ["wifi"] },
  { repo: "gabrielfvale/scrappy", title: "Scrappy", category: "Tools", desc: "Artwork and metadata scraper using ScreenScraper, with customisable artwork styles.", needs: ["wifi"] },
  { repo: "MustardOS/vtree", title: "vTree", category: "Tools", desc: "Gamepad-driven twin-panel file manager for handhelds." },
  { repo: "mxmgorin/retsend", title: "RetSend", category: "Online", desc: "LocalSend client: send files between the handheld and phones or computers on the same network.", needs: ["wifi"] },
  { repo: "pocketkode/wifi-transfer", title: "Wi-Fi Transfer", category: "Online", desc: "Move files between the handheld and any phone or computer browser over Wi-Fi.", needs: ["wifi"] },
  { repo: "KyleJamesWalker/AmberDAV", title: "AmberDAV", category: "Online", desc: "WebDAV file server: open the handheld's files from a computer over Wi-Fi.", needs: ["wifi"] },
  { repo: "nvcuong1312/hotspotmuos", title: "Wi-Fi Hotspot", category: "Online", desc: "Turns the handheld into a Wi-Fi hotspot.", needs: ["wifi"] },
  { repo: "escal8tor/MuFin", title: "MuFin", category: "Media", desc: "Jellyfin client: browse and watch your Jellyfin media on the handheld.", needs: ["wifi"] },
  { repo: "pocketkode/pocketkode-radio", title: "PocketKode Radio", category: "Media", desc: "Internet radio and podcasts, with the screen off to save battery.", needs: ["wifi"] },
  { repo: "atalaygrgn/XMPlayer", title: "XMPlayer", category: "Media", desc: "Music and video player with a familiar media-centre interface." },
  { repo: "pcorbel/storiies", title: "Storiies", category: "Media", desc: "Simple, kid-friendly MP3 player." },
  { repo: "vasinsky/Aplayer", title: "APlayer", category: "Media", desc: "Music player for your own MP3 collection." },
  { repo: "CharlexH/SideB", title: "SideB", category: "Media", desc: "Cassette-style music player with Spotify Connect and offline playback.", models: ["tui-brick"] },
  { repo: "PuppetHoundZ/PicoReader-MuOS", title: "PicoReader", category: "Media", desc: "Small EPUB e-book reader." },
  { repo: "saitamasahil/2048plus", title: "2048 Plus", category: "Games", desc: "Feature-packed version of the 2048 puzzle game." },
  { repo: "pocketkode/game-manager", title: "Game Manager", category: "Games", desc: "Find, install and manage free homebrew games from Homebrew Hub.", needs: ["wifi"] },
  { repo: "joneavila/aesthetic", title: "Aesthetic", category: "Customisation", desc: "Create minimalist duo-tone themes directly on the handheld." },
  { repo: "Photonic2790/Rethemer", title: "Rethemer", category: "Customisation", desc: "Recolour and adjust installed themes on the handheld." },
  { repo: "DanjelRicci/RGB-Screen-React", title: "RGB Screen React", category: "Customisation", desc: "Matches the RGB lights to the colours on screen while you play." },
  { repo: "nvcuong1312/bltMuos", title: "Bluetooth", category: "Tools", desc: "Pair and manage Bluetooth headphones and controllers.", needs: ["wifi"] },
  { repo: "treebeard/muOS-Play-Activity", title: "Play Activity", category: "Tools", desc: "Shows your play time history." },
  { repo: "SilverCrow2323/muOS-Void-Desk", title: "Void Desk", category: "Tools", desc: "Hub with Linux desktop environments and tools for the handheld." },
  { repo: "andersmmg/app_downloader", title: "App Downloader", category: "Tools", desc: "Download community apps straight from the handheld.", needs: ["wifi"] },
  { repo: "rommapp/muos-app", title: "RomM", category: "Online", desc: "The original RomM app for muOS, replaced by Grout.", needs: ["wifi"] },
];

interface Asset { name: string; size: number; url: string }
interface Release { tag: string; name: string; date: string; pre: boolean; notes: string; assets: Asset[] }
interface RepoInfo { stars: number; archived: boolean; pushed: string; license: string; homepage: string; desc: string }
interface Entry { repo: string; title: string; desc: string; category: string; needs: Need[]; models: string[]; folder: string; images: string[] }
interface Market {
  fetched: number;
  entries: Entry[];
  releases: Record<string, { release: Release | null }>;
  info: Record<string, RepoInfo>;
}

let market: Market | null = null;
const cacheFile = () => path.join(ctx.cacheDir, "app-market.json");
const imageDir = () => path.join(ctx.cacheDir, "app-market");

export async function clearMarketCache(): Promise<void> {
  market = null;
  await Promise.all([cacheFile(), imageDir()].map((p) => fsp.rm(p, { recursive: true, force: true })));
}

// ---------------------------------------------------------------- reading GitHub

async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  try {
    return await fetch(url, { headers: { ...AGENT, ...headers }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new UserError(`GitHub could not be reached: ${(error as Error).message}`);
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
const unescape = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_, e: string) => ENTITIES[e])
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));

/** Release notes HTML as plain text with list bullets and paragraph breaks. */
export function notesText(html: string): string {
  return unescape(html.replace(/<li[^>]*>/gi, "\n- ").replace(/<\/(p|h\d|ul|ol|pre|div)>|<br\s*\/?>/gi, "\n").replace(/<h\d[^>]*>/gi, "\n").replace(/<[^>]+>/g, ""))
    .split("\n").map((l) => l.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);
}

/** The releases in a repository's releases.atom feed, newest first. */
export function parseAtom(xml: string): { tag: string; name: string; date: string; notes: string }[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    tag: /\/releases\/tag\/([^"]+)"/.exec(e)?.[1] ?? "",
    name: unescape(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1] ?? "").trim(),
    date: /<updated>([^<]+)<\/updated>/.exec(e)?.[1] ?? "",
    notes: notesText(unescape(/<content[^>]*>([\s\S]*?)<\/content>/.exec(e)?.[1] ?? "")),
  })).filter((r) => r.tag);
}

const UNITS: Record<string, number> = { Bytes: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };

/** The packages on a release's expanded assets page, with the size GitHub shows (rounded). */
export function parseAssets(html: string): Asset[] {
  const out: Asset[] = [];
  for (const block of html.split(/<li\b/).slice(1)) {
    const href = /href="(\/[^"]+\/releases\/download\/[^"]+)"/.exec(block)?.[1];
    if (!href) continue;
    const name = decodeURIComponent(href.split("/").pop()!);
    if (!PACKAGE.test(name)) continue;
    const size = /([\d.]+) (Bytes|KB|MB|GB)/.exec(block);
    out.push({ name, size: size ? Math.round(Number(size[1]) * UNITS[size[2]]) : 0, url: `https://github.com${unescape(href)}` });
  }
  return out;
}

/** The newest of the last few releases that has a MustardOS package, read from github.com pages rather than the API. */
async function readRelease(repo: string): Promise<Release | null> {
  const feed = await get(`https://github.com/${repo}/releases.atom`);
  if (!feed.ok) throw new UserError(`github.com answered ${feed.status} for ${repo}.`);
  for (const r of parseAtom(await feed.text()).slice(0, 4)) {
    const page = await get(`https://github.com/${repo}/releases/expanded_assets/${r.tag}`);
    if (!page.ok) continue;
    const assets = parseAssets(await page.text());
    if (assets.length) return { tag: decodeURIComponent(r.tag), name: r.name || decodeURIComponent(r.tag), date: r.date, pre: /\b(pre|alpha|beta|nightly|rc\d*)\b/i.test(`${r.tag} ${r.name}`), notes: r.notes, assets };
  }
  return null;
}

/** Stars and state of many repositories in a few search calls (search has its own allowance). */
async function readInfo(repos: string[]): Promise<Record<string, RepoInfo>> {
  const out: Record<string, RepoInfo> = {};
  const batches: string[][] = [];
  for (const repo of repos) {
    const last = batches.at(-1);
    if (last && [...last, repo].map((r) => `repo:${r}`).join(" ").length < 230) last.push(repo);
    else batches.push([repo]);
  }
  for (const batch of batches) {
    const q = encodeURIComponent(`${batch.map((r) => `repo:${r}`).join(" ")} fork:true`);
    const res = await get(`https://api.github.com/search/repositories?q=${q}&per_page=100`, { Accept: "application/vnd.github+json" });
    if (!res.ok) continue;
    for (const r of ((await res.json()) as { items?: Record<string, unknown>[] }).items ?? []) {
      out[String(r.full_name).toLowerCase()] = {
        stars: Number(r.stargazers_count) || 0, archived: !!r.archived, pushed: String(r.pushed_at ?? ""),
        license: String((r.license as { spdx_id?: string } | null)?.spdx_id ?? "").replace("NOASSERTION", ""),
        homepage: /^https?:\/\//.test(String(r.homepage ?? "")) ? String(r.homepage) : "", desc: String(r.description ?? ""),
      };
    }
  }
  return out;
}

/** Screenshot-like images in a README: no badges, icons or SVGs; relative paths resolved against the repository. */
export function readmeImages(repo: string, text: string): string[] {
  const raw = `https://raw.githubusercontent.com/${repo}/HEAD/`;
  const found = [
    ...[...text.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)/g)].map((m) => m[1]),
    ...[...text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]),
  ];
  const out: string[] = [];
  for (let url of found) {
    url = url.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|raw)\/(.+?)(\?raw=true)?$/, "https://raw.githubusercontent.com/$1/$2");
    if (!/^https?:\/\//.test(url)) url = new URL(url.replace(/^\.?\//, ""), raw).href;
    if (/\.svg(\?|$)|shields\.io|badge|badgen|img\.shields|travis-ci|codecov|\/actions\/workflows\/|buymeacoffee|ko-fi|discord|paypal|logo|icon|isotipo/i.test(url)) continue;
    if (!out.includes(url)) out.push(url);
  }
  return out.slice(0, 8);
}

async function readmeOf(repo: string): Promise<string[]> {
  for (const name of ["README.md", "readme.md", "Readme.md"]) {
    const res = await get(`https://raw.githubusercontent.com/${repo}/HEAD/${name}`).catch(() => null);
    if (res?.ok) return readmeImages(repo, await res.text());
  }
  return [];
}

async function readListing(): Promise<Record<string, unknown>[]> {
  try {
    const res = await get(LISTING);
    const list = res.ok ? await res.json() : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const httpUrl = (v: unknown) => (typeof v === "string" && /^https?:\/\//.test(v) ? v : "");

async function fetchMarket(old: Market | null): Promise<{ data: Market; error: string }> {
  const listing = await readListing();
  const byRepo = new Map<string, Entry>();
  for (const k of KNOWN) {
    byRepo.set(k.repo.toLowerCase(), { repo: k.repo, title: k.title, desc: k.desc, category: k.category, needs: k.needs ?? [], models: k.models ?? [], folder: k.folder ?? "", images: [] });
  }
  for (const l of listing) {
    const repo = String(l.repo ?? "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) continue;
    const e = byRepo.get(repo.toLowerCase()) ?? { repo, title: String(l.title || repo.split("/")[1]), desc: "", category: "Other", needs: [], models: [], folder: "", images: [] };
    if (typeof l.description === "string" && l.description.trim()) e.desc = l.description.trim();
    e.images = [httpUrl(l.image_url), ...(Array.isArray(l.gallery) ? l.gallery.map(httpUrl) : [])].filter(Boolean);
    byRepo.set(repo.toLowerCase(), e);
  }
  const entries = [...byRepo.values()];
  let failed = 0;
  const releases: Market["releases"] = {};
  await mapLimit(entries, 5, async (e) => {
    const key = e.repo.toLowerCase();
    try {
      releases[key] = { release: await readRelease(e.repo) };
    } catch {
      failed++;
      if (old?.releases[key]) releases[key] = old.releases[key];
    }
  });
  if (failed === entries.length) throw new UserError("GitHub could not be reached.");
  await mapLimit(entries, 6, async (e) => {
    const extra = await readmeOf(e.repo).catch(() => []);
    e.images = [...e.images, ...extra.filter((u) => !e.images.includes(u))].slice(0, 8);
  });
  const info = { ...(old?.info ?? {}), ...(await readInfo(entries.map((e) => e.repo)).catch(() => ({}))) };
  return {
    data: { fetched: Date.now(), entries, releases, info },
    error: failed ? `${failed} of ${entries.length} apps could not be checked; they show the release from the last check.` : "",
  };
}

async function loadMarket(refresh: boolean): Promise<{ data: Market | null; error: string }> {
  if (!market) { try { market = JSON.parse(await fsp.readFile(cacheFile(), "utf8")); } catch {} }
  if (market && !refresh && Date.now() - market.fetched < FRESH_MS) return { data: market, error: "" };
  try {
    const { data, error } = await fetchMarket(market);
    market = data;
    await fsp.mkdir(ctx.cacheDir, { recursive: true });
    await fsp.writeFile(cacheFile(), JSON.stringify(market));
    return { data, error };
  } catch (error) {
    return { data: market, error: (error as Error).message };
  }
}

// ---------------------------------------------------------------- what fits the handheld

interface Ranked { name: string; size: number; fit: "best" | "ok" | "other"; why: string }
const cap = (s: string) => s[0] + s.slice(1).toLowerCase();

/** Orders a release's packages for a handheld: ones built for another maker, MustardOS release or as a patch come last. */
export function rankAssets(assets: Pick<Asset, "name" | "size">[], maker: string, codename: string): Ranked[] {
  const full = assets.some((a) => !/[_.-]update\b/i.test(a.name));
  const ranked = assets.map((a) => {
    const up = a.name.toUpperCase();
    const codes = CODENAMES.filter((c) => up.includes(c)), makers = Object.keys(MAKERS).filter((m) => up.includes(m));
    let fit: Ranked["fit"] = "ok", why = "", score = 0;
    if (makers.length && maker && !makers.includes(maker.toUpperCase())) { fit = "other"; why = `For ${makers.map((m) => MAKERS[m]).join(" and ")} handhelds`; }
    else if (codes.length && codename && !codes.includes(codename)) { fit = "other"; why = `For MustardOS ${codes.map(cap).join(" and ")}`; }
    else if (full && /[_.-]update\b/i.test(a.name)) { fit = "other"; why = "Updates an existing install"; }
    else {
      if (codes.length) score += codename ? 2 : Math.max(...codes.map((c) => CODENAMES.indexOf(c))) / CODENAMES.length;
      if (makers.length) score += 1;
    }
    return { ...a, fit, why, score };
  });
  const top = Math.max(-1, ...ranked.filter((r) => r.fit !== "other").map((r) => r.score));
  return ranked
    .map((r) => ({ name: r.name, size: r.size, why: r.why, fit: (r.fit === "ok" && r.score === top ? "best" : r.fit) as Ranked["fit"] }))
    .sort((a, b) => ["best", "ok", "other"].indexOf(a.fit) - ["best", "ok", "other"].indexOf(b.fit));
}

let codenameAt = 0, codenameValue = "";

async function runningCodename(): Promise<string> {
  if (Date.now() - codenameAt < 60_000) return codenameValue;
  const { version } = await deviceVersion().catch(() => ({ version: "" }));
  codenameAt = Date.now();
  codenameValue = CODENAMES.find((c) => version.toUpperCase().includes(c)) ?? "";
  return codenameValue;
}

/** The app list for one handheld model, with the package to get and why an app may not suit it. */
export async function marketJson(query: URLSearchParams) {
  const model = byId(query.get("model") ?? "") ?? byId(DEFAULT_DEVICE)!;
  const [{ data, error }, codename] = await Promise.all([loadMarket(query.get("refresh") === "1"), runningCodename()]);
  const apps = (data?.entries ?? []).map((e) => {
    const key = e.repo.toLowerCase(), r = data!.releases[key]?.release ?? null, info = data!.info[key] ?? null;
    const assets = r ? rankAssets(r.assets, model.maker, codename) : [];
    const pick = assets.find((a) => a.fit !== "other") ?? null;
    const why: string[] = [];
    let fit: "yes" | "warn" | "no" = "yes";
    if (!r) { fit = "no"; why.push("No MustardOS package in its releases"); }
    else if (!pick) { fit = "warn"; why.push(assets[0]?.why || "Not made for this handheld"); }
    if (e.needs.includes("wifi") && !model.wifi) { fit = "no"; why.push(`Needs Wi-Fi, which the ${model.name} does not have`); }
    if (e.models.length && !e.models.includes(model.id)) {
      if (fit === "yes") fit = "warn";
      why.push(`Made for the ${e.models.map((id) => byId(id)?.name ?? id).join(" and ")}`);
    }
    if (info?.archived) { if (fit === "yes") fit = "warn"; why.push("No longer developed"); }
    return {
      repo: e.repo, title: e.title, desc: e.desc || info?.desc || "", category: e.category, needs: e.needs, folder: e.folder,
      images: e.images.length, stars: info?.stars ?? 0, archived: !!info?.archived, pushed: info?.pushed ?? "", license: info?.license ?? "", homepage: info?.homepage ?? "",
      release: r ? { tag: r.tag, name: r.name, date: r.date, pre: r.pre, notes: r.notes, assets } : null,
      pick: pick?.name ?? "", fit, why,
    };
  });
  return { fetched: data?.fetched ?? 0, error, codename: codename ? cap(codename) : "", model: { id: model.id, name: model.name }, apps };
}

// ---------------------------------------------------------------- screenshots and downloads

const IMAGE_TYPES: [string, (b: Buffer) => boolean][] = [
  [".png", (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))],
  [".jpg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  [".gif", (b) => b.subarray(0, 3).toString("latin1") === "GIF"],
  [".webp", (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
];

/** One of an app's screenshots, downloaded once and kept on disk. Only PNG, JPEG, GIF and WebP are passed on. */
export async function marketImage(query: URLSearchParams) {
  const repo = (query.get("repo") ?? "").toLowerCase(), n = Number(query.get("n") ?? 0);
  const entry = (await loadMarket(false)).data?.entries.find((e) => e.repo.toLowerCase() === repo);
  const url = entry?.images[Number.isInteger(n) ? n : -1];
  if (!url) throw new UserError("This app has no such screenshot.");
  const base = path.join(imageDir(), crypto.createHash("sha1").update(url).digest("hex"));
  for (const [ext] of IMAGE_TYPES) { try { return { image: await fsp.readFile(base + ext), name: base + ext }; } catch {} }
  if (fs.existsSync(`${base}.none`)) throw new UserError("This screenshot could not be loaded.");
  await fsp.mkdir(imageDir(), { recursive: true });
  const res = await get(url);
  const image = res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
  const type = image.length <= 16 * 1024 * 1024 ? IMAGE_TYPES.find(([, test]) => test(image)) : undefined;
  if (!type) { await fsp.writeFile(`${base}.none`, ""); throw new UserError("This screenshot could not be loaded."); }
  await fsp.writeFile(base + type[0], image);
  return { image, name: base + type[0] };
}

/** Downloads one package of an app's checked release into the apps folder. */
export async function marketDownload(body: Record<string, unknown>) {
  const repo = String(body.repo ?? "").toLowerCase(), name = String(body.asset ?? "");
  const data = (await loadMarket(false)).data;
  const asset = data?.releases[repo]?.release?.assets.find((a) => a.name === name);
  if (!asset) throw new UserError("Refresh the app market; that package is not in the app's latest release.");
  return downloadToApps({ ...asset, size: 0 });
}
