// BYOK chat assistant: settings in .cache/chat.json, OpenAI-compatible providers, and a grounded context pack
// (docs/assistant-knowledge.md, library, LaunchBox metadata, connection). Never invents walkthroughs; never mutates the handheld.

import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "./context.ts";
import { deviceInfo } from "./device/content.ts";
import { wifiStatus } from "./device/sftp.ts";
import { sshStatus } from "./device/ssh.ts";
import { findCards, withTarget } from "./device/target.ts";
import { UserError } from "./errors.ts";
import { getLibrary, type Game, type Library, type System } from "./games/library.ts";
import { RECOMMENDATIONS, type Recommendation } from "./tuning/profiles.ts";

const human = (n: number) => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = n;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return i === 0 ? `${v} B` : `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
};

export type ChatProvider = "groq" | "gemini" | "openrouter";

export interface ChatSettings {
  provider: ChatProvider;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  includeLibrary: boolean;
  includeConnection: boolean;
  /** Empty string means use DEFAULT_SYSTEM_PROMPT. */
  systemPrompt: string;
}

const PROMPT_MAX = 12_000;

/** Built-in instructions sent with every chat turn (before live CONTEXT). */
export const DEFAULT_SYSTEM_PROMPT = `You are the in-app assistant for muOS Anbernic Manager, a desktop app that manages Anbernic/TrimUI handhelds running MustardOS (muOS).

Rules:
- Prefer facts from the CONTEXT block over your own memory. CONTEXT includes the manager knowledge base — treat it as ground truth for UI paths, tabs and connections. If context is missing, say so briefly.
- Help with the manager UI, connections (card reader / USB / Wi-Fi), TF2/SD cards, copying games, artwork, apps, themes, and the user's Roms library.
- For retro game recommendations, descriptions, genres and related titles, use LaunchBox metadata and library hits in CONTEXT.
- For RetroArch / PPSSPP performance or "best settings" for a game: prefer Game Tuning tips in CONTEXT (presets Fastest / Balanced / Best looking, and any matched recommendation). Tell the user to apply them under Game Tuning or the game viewer Handheld tab (Core options). Do not invent Menu+X option keys that are not in CONTEXT; if unsure, say to open Game Tuning and try the recommended preset.
- You cannot search the web. If the user wants community per-game RetroArch tips, point them to the sites listed under finding settings in the knowledge base (Libretro docs/forums, Reddit r/RetroArch and r/SBCGaming, r/muOS for MustardOS). Suggest searching the game title plus the core name (e.g. PCSX-ReARMed, Mupen64Plus-Next, Flycast, PPSSPP).
- Do NOT invent walkthroughs, puzzle solutions, boss strategies or detailed spoilers. If asked for a walkthrough or guide, briefly refuse to invent one and point the user to GameFAQs (gamefaqs.gamespot.com), StrategyWiki (strategywiki.org), or a well-known wiki for that game.
- Do NOT invent buttons, tabs or menus that are not in the knowledge base.
- You cannot format cards, wipe disks, install OS images, or change the handheld. For those actions, tell the user which manager section to use (e.g. System Tools, Device).
- Keep answers concise and practical. Use plain language.
- Never ask for or repeat API keys or passwords.`;

const PROVIDERS: ChatProvider[] = ["groq", "gemini", "openrouter"];

const DEFAULT_MODELS: Record<ChatProvider, string> = {
  groq: "openai/gpt-oss-20b",
  gemini: "gemini-2.0-flash",
  openrouter: "openrouter/free",
};

/** Chat models on Groq's free plan (not Whisper / Orpheus / prompt-guard). */
const MODEL_PRESETS: Record<ChatProvider, { id: string; label: string }[]> = {
  groq: [
    { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B (fast)" },
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
    { id: "qwen/qwen3.8-27b", label: "Qwen3.8 27B" },
  ],
  gemini: [
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash-Lite" },
  ],
  openrouter: [
    { id: "openrouter/free", label: "Auto free router" },
    { id: "google/gemma-3-27b-it:free", label: "Gemma 3 27B (free)" },
    { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)" },
  ],
};

const DEFAULTS: ChatSettings = {
  provider: "groq",
  apiKey: "",
  model: DEFAULT_MODELS.groq,
  temperature: 0.4,
  maxTokens: 1024,
  includeLibrary: true,
  includeConnection: true,
  systemPrompt: "",
};

const normalizePrompt = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  return text.length > PROMPT_MAX ? text.slice(0, PROMPT_MAX) : text;
};

const effectivePrompt = (s: ChatSettings) => s.systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT;

const settingsFile = () => path.join(ctx.cacheDir, "chat.json");
const knowledgeFile = () => path.join(ctx.managerDir, "docs", "assistant-knowledge.md");

type KnowledgeSection = { title: string; text: string };

let cached: ChatSettings | null = null;
let knowledgeCache: { raw: string; sections: Record<string, KnowledgeSection> } | null = null;

/** Llama left Groq's free/developer tiers; map old presets to a current chat model. */
const GROQ_RETIRED = new Set(["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen/qwen3-32b", "qwen/qwen3-32b-instruct"]);

function normalizeModel(provider: ChatProvider, model: string): string {
  const id = model.trim();
  if (!id) return DEFAULT_MODELS[provider];
  if (provider === "groq" && GROQ_RETIRED.has(id)) return DEFAULT_MODELS.groq;
  return id;
}

async function loadSettings(): Promise<ChatSettings> {
  if (cached) return cached;
  try {
    const saved = JSON.parse(await fsp.readFile(settingsFile(), "utf8")) as Partial<ChatSettings>;
    const provider = PROVIDERS.includes(saved.provider as ChatProvider) ? (saved.provider as ChatProvider) : DEFAULTS.provider;
    cached = {
      ...DEFAULTS,
      ...saved,
      provider,
      apiKey: typeof saved.apiKey === "string" ? saved.apiKey : "",
      model: normalizeModel(provider, String(saved.model || "")),
      temperature: clampNum(saved.temperature, 0, 1, DEFAULTS.temperature),
      maxTokens: Math.round(clampNum(saved.maxTokens, 256, 4096, DEFAULTS.maxTokens)),
      includeLibrary: saved.includeLibrary !== false,
      includeConnection: saved.includeConnection !== false,
      systemPrompt: normalizePrompt(saved.systemPrompt),
    };
  } catch {
    cached = { ...DEFAULTS };
  }
  return cached!;
}

async function writeSettings(next: ChatSettings): Promise<void> {
  await fsp.mkdir(ctx.cacheDir, { recursive: true });
  await fsp.writeFile(settingsFile(), JSON.stringify(next, null, 2), { mode: 0o600 });
  cached = next;
}

const clampNum = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const maskKey = (key: string) => {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
};

export async function chatSettingsPublic() {
  const s = await loadSettings();
  const custom = !!s.systemPrompt.trim();
  return {
    configured: !!s.apiKey.trim(),
    provider: s.provider,
    model: s.model,
    temperature: s.temperature,
    maxTokens: s.maxTokens,
    includeLibrary: s.includeLibrary,
    includeConnection: s.includeConnection,
    systemPrompt: effectivePrompt(s),
    systemPromptCustom: custom,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    keyHint: maskKey(s.apiKey.trim()),
    providers: PROVIDERS.map((id) => ({
      id,
      label: id === "groq" ? "Groq" : id === "gemini" ? "Google Gemini" : "OpenRouter",
      models: MODEL_PRESETS[id],
      defaultModel: DEFAULT_MODELS[id],
    })),
    help: {
      groq: "Free key at https://console.groq.com - OpenAI-compatible, fast, generous daily free tier.",
      gemini: "Free key at https://aistudio.google.com - Gemini Flash models, long context, free tier.",
      openrouter: "Free key at https://openrouter.ai - pick models with a :free suffix, or openrouter/free. Lower daily cap until you have ever bought credit.",
    },
  };
}

export async function saveChatSettings(body: Record<string, unknown>) {
  const current = await loadSettings();
  const provider = PROVIDERS.includes(String(body.provider) as ChatProvider)
    ? (String(body.provider) as ChatProvider)
    : current.provider;
  let apiKey = current.apiKey;
  if (typeof body.apiKey === "string") {
    const next = body.apiKey.trim();
    // Empty string clears; omit/unchanged keeps. A masked hint must not overwrite the real key.
    if (body.clearKey === true || next === "") apiKey = "";
    else if (next && next !== current.apiKey && !next.includes("...") && next !== maskKey(current.apiKey)) apiKey = next;
  }
  if (body.clearKey === true) apiKey = "";
  let model = normalizeModel(provider, String(body.model ?? current.model));
  if (provider !== current.provider && !String(body.model ?? "").trim()) model = DEFAULT_MODELS[provider];
  let systemPrompt = current.systemPrompt;
  if (body.resetSystemPrompt === true) systemPrompt = "";
  else if (body.systemPrompt !== undefined) {
    systemPrompt = normalizePrompt(body.systemPrompt);
    if (systemPrompt === DEFAULT_SYSTEM_PROMPT.trim()) systemPrompt = "";
  }
  const next: ChatSettings = {
    provider,
    apiKey,
    model,
    temperature: clampNum(body.temperature ?? current.temperature, 0, 1, current.temperature),
    maxTokens: Math.round(clampNum(body.maxTokens ?? current.maxTokens, 256, 4096, current.maxTokens)),
    includeLibrary: body.includeLibrary !== undefined ? body.includeLibrary !== false && body.includeLibrary !== "false" : current.includeLibrary,
    includeConnection: body.includeConnection !== undefined ? body.includeConnection !== false && body.includeConnection !== "false" : current.includeConnection,
    systemPrompt,
  };
  await writeSettings(next);
  return chatSettingsPublic();
}

/** Parse `## slug — Title` sections from assistant-knowledge.md. */
function parseKnowledge(raw: string): Record<string, KnowledgeSection> {
  const sections: Record<string, KnowledgeSection> = {};
  const parts = raw.split(/^## /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const heading = (nl < 0 ? part : part.slice(0, nl)).trim();
    const body = (nl < 0 ? "" : part.slice(nl + 1)).trim();
    const m = heading.match(/^([a-z0-9_-]+)\s+[—–-]\s+(.+)$/i);
    if (!m) continue;
    const slug = m[1].toLowerCase();
    sections[slug] = { title: m[2].trim(), text: body };
  }
  return sections;
}

async function loadKnowledge(): Promise<{ raw: string; sections: Record<string, KnowledgeSection> }> {
  if (knowledgeCache) return knowledgeCache;
  try {
    const raw = await fsp.readFile(knowledgeFile(), "utf8");
    knowledgeCache = { raw, sections: parseKnowledge(raw) };
  } catch {
    knowledgeCache = { raw: "", sections: {} };
  }
  return knowledgeCache!;
}

/** Full Markdown for the Settings → Assistant read-only viewer. */
export async function chatKnowledgePublic(): Promise<{ markdown: string }> {
  const { raw } = await loadKnowledge();
  return { markdown: raw };
}

function knowledgeBlock(section: string, sections: Record<string, KnowledgeSection>): string {
  const parts: string[] = [];
  const start = sections.start;
  if (start) parts.push(`## Manager help: ${start.title}\n${start.text}`);
  const key = section && sections[section] ? section : "";
  if (key && key !== "start") parts.push(`## Current section: ${sections[key].title}\n${sections[key].text}`);
  // Troubleshooting / glossary when on Wiki or when no page-specific pack matched.
  if (key === "wiki" || !key) {
    if (sections.help) parts.push(`## Troubleshooting\n${sections.help.text}`);
    if (sections.glossary) parts.push(`## Glossary\n${sections.glossary.text}`);
  }
  const assistant = sections.assistant;
  if (assistant) parts.push(`## Assistant limits\n${assistant.text}`);
  return parts.join("\n\n");
}

async function connectionBlock(): Promise<string> {
  const lines: string[] = ["## Connection"];
  try {
    const [wifi, ssh, { cards }] = await Promise.all([
      wifiStatus(),
      sshStatus(),
      findCards().catch(() => ({ cards: [] as { name: string; free: number; total: number; fs: string }[] })),
    ]);
    lines.push(`Wi-Fi configured: ${wifi.configured ? "yes" : "no"}; reachable: ${wifi.reachable ? "yes" : "no"}${wifi.host ? `; host ${wifi.host}` : ""}.`);
    lines.push(`SSH configured: ${ssh.configured ? "yes" : "no"}; reachable: ${ssh.reachable ? "yes" : "no"}${ssh.host ? `; host ${ssh.host}` : ""}.`);
    if (cards.length) {
      lines.push(`Cards in reader: ${cards.map((c) => `${c.name} (${c.fs || "unknown"}, ${human(c.free)} free of ${human(c.total)})`).join("; ")}.`);
    } else {
      lines.push("No removable card in a reader right now.");
    }
    if (wifi.reachable || ssh.reachable) {
      try {
        const info = await withTarget("", (t) => deviceInfo(t));
        const model = (info as { identity?: Record<string, string | number> }).identity;
        const storages = (info as { storages?: { name: string; free: number; total: number }[] }).storages || [];
        if (model?.version) lines.push(`MustardOS version: ${model.version}.`);
        if (typeof model?.battery === "number") lines.push(`Battery: ${model.battery}%.`);
        for (const s of storages) lines.push(`${s.name}: ${human(s.free)} free of ${human(s.total)}.`);
      } catch {
        /* connection snapshot stays high-level */
      }
    }
  } catch (error) {
    lines.push(`Could not read connection state: ${(error as Error).message}`);
  }
  return lines.join("\n");
}

const SYSTEM_CODES = new Set([
  "gba", "gbc", "gb", "nds", "3ds", "n64", "snes", "nes", "md", "sms", "gg", "ps", "psp", "ps2", "dc", "saturn",
  "ngp", "ngpc", "pce", "pcfx", "wsc", "ws", "a2600", "a5200", "a7800", "lynx", "amiga", "c64", "dos", "scummvm", "ports",
]);

function scoreGame(sys: System, g: Game, meta: Library["meta"], tokens: string[]): number {
  const blob = [
    g.t, g.f, sys.code, sys.name, sys.cat,
    ...(g.g || []),
    meta[g.lb]?.n || "", meta[g.lb]?.g || "", meta[g.lb]?.dev || "", meta[g.lb]?.pub || "",
  ].join(" ").toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (sys.code.toLowerCase() === t) score += 8;
    else if (blob.includes(t)) score += t.length > 2 ? 3 : 1;
  }
  return score;
}

const PRESET_LABEL: Record<string, string> = { speed: "Fastest", balanced: "Balanced", quality: "Best looking" };

/** Profile ids that Game Tuning recommendations may apply to for a ROM folder code. */
const FOLDER_PROFILES: Record<string, string[]> = {
  PSP: ["ppsspp", "ppsspp-lr"],
  N64: ["mupen64plus"],
  PS: ["pcsx-rearmed", "swanstation", "duckstation"],
  DC: ["flycast"],
  NAOMI: ["flycast"],
  ATOMISWAVE: ["flycast"],
};

function matchRecommendation(title: string, profiles: string[] | null): Recommendation | null {
  const name = title.toLowerCase();
  for (const r of RECOMMENDATIONS) {
    if (profiles && !r.profiles.some((p) => profiles.includes(p))) continue;
    if (r.match) {
      if (!new RegExp(r.match, "i").test(name)) continue;
    } else if (!profiles) {
      continue;
    }
    return r;
  }
  return null;
}

function tuningHintsBlock(title: string, folderCode: string): string {
  const profiles = FOLDER_PROFILES[folderCode] || null;
  const rec = matchRecommendation(title, profiles);
  const lines = [
    `### Game Tuning tips`,
    `Apply under Game Tuning or the game viewer Handheld > Core options (Wi-Fi + SSH). Presets: Fastest, Balanced, Best looking (profiled cores). CPU governor is separate.`,
  ];
  if (rec) {
    const preset = PRESET_LABEL[rec.preset] || rec.preset;
    lines.push(
      `Matched recommendation for "${title}": use preset ${preset}`
      + (rec.gov ? ` with the ${rec.gov} governor` : "")
      + ` (${rec.profiles.join(", ")}). Note: ${rec.note}`,
    );
  } else if (profiles) {
    lines.push(`No title-specific recommendation; for ${folderCode} start from Balanced (or Fastest for Dreamcast/Flycast) in Game Tuning, then adjust.`);
  } else {
    lines.push(`No curated preset for this system; use Menu+X / Core options from the handheld catalogue, or community tips (see knowledge: finding settings).`);
  }
  return lines.join("\n");
}

function libraryBlock(lib: Library, userText: string, gameKey: string): string {
  const lines: string[] = [
    `## Library`,
    `${lib.totals.games} games across ${lib.totals.filled} systems with games (${lib.totals.described} with descriptions). Roms folder: ${lib.roms}.`,
  ];
  if (gameKey) {
    const [code, file] = gameKey.includes("|") ? gameKey.split("|") : gameKey.split("/");
    const sys = lib.systems.find((s) => s.code === code);
    const g = sys?.games.find((x) => x.f === file);
    if (sys && g) {
      const m = g.lb ? lib.meta[g.lb] : null;
      lines.push(`### Focused game`);
      lines.push(`Title: ${g.t}; system: ${sys.name} (${sys.code}); file: ${g.f}.`);
      if (m) {
        lines.push(`LaunchBox: ${m.n}${m.y ? ` (${m.y})` : ""}; genre: ${m.g || " -"}; developer: ${m.dev || " -"}; publisher: ${m.pub || " -"}${m.r != null ? `; rating ${m.r}` : ""}.`);
        if (m.d) lines.push(`Description: ${m.d.slice(0, 900)}${m.d.length > 900 ? "..." : ""}`);
      }
      lines.push(tuningHintsBlock(g.t, sys.code));
    }
  }
  const tokens = userText.toLowerCase().replace(/[^a-z0-9+#.\s-]/g, " ").split(/\s+/).filter((t) => t.length > 1);
  const useful = tokens.filter((t) => t.length > 2 || SYSTEM_CODES.has(t));
  if (useful.length) {
    const hits: { score: number; line: string }[] = [];
    for (const sys of lib.systems) {
      for (const g of sys.games) {
        const score = scoreGame(sys, g, lib.meta, useful);
        if (score < 3) continue;
        const m = g.lb ? lib.meta[g.lb] : null;
        const genre = m?.g || (g.g || []).join(", ") || "";
        hits.push({
          score,
          line: `- ${g.t} [${sys.code}]${m?.y ? ` (${m.y})` : ""}${genre ? ` - ${genre}` : ""}${m?.d ? `: ${m.d.slice(0, 160)}${m.d.length > 160 ? "..." : ""}` : ""}`,
        });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    const top = hits.slice(0, 15);
    if (top.length) {
      lines.push(`### Library matches for the question`);
      lines.push(...top.map((h) => h.line));
    } else {
      lines.push("No strong title/genre matches in the local library for those words.");
    }
  }
  return lines.join("\n");
}

async function buildContext(section: string, userText: string, gameKey: string, opts: ChatSettings): Promise<string> {
  const { sections } = await loadKnowledge();
  const parts = [knowledgeBlock(section || "start", sections)];
  if (opts.includeConnection) parts.push(await connectionBlock());
  if (opts.includeLibrary) {
    try {
      parts.push(libraryBlock(await getLibrary(), userText, gameKey));
    } catch (error) {
      parts.push(`## Library\nUnavailable: ${(error as Error).message}`);
    }
  }
  return parts.join("\n\n").slice(0, 24_000);
}

type Msg = { role: "user" | "assistant" | "system"; content: string };

function normalizeMessages(raw: unknown): Msg[] {
  if (!Array.isArray(raw)) return [];
  const out: Msg[] = [];
  for (const m of raw.slice(-12)) {
    if (!m || typeof m !== "object") continue;
    const role = (m as Msg).role;
    const content = String((m as Msg).content ?? "").trim();
    if (!content || (role !== "user" && role !== "assistant")) continue;
    out.push({ role, content: content.slice(0, 4000) });
  }
  return out;
}

function endpoint(provider: ChatProvider): string {
  if (provider === "groq") return "https://api.groq.com/openai/v1/chat/completions";
  if (provider === "gemini") return "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  return "https://openrouter.ai/api/v1/chat/completions";
}

export async function runChat(body: Record<string, unknown>) {
  const s = await loadSettings();
  if (!s.apiKey.trim()) throw new UserError("Add a free API key under Settings > Assistant before chatting.");
  const messages = normalizeMessages(body.messages);
  if (!messages.length) throw new UserError("Type a message first.");
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) throw new UserError("Type a message first.");
  const section = String(body.section ?? "").trim();
  const gameKey = String(body.gameKey ?? "").trim();
  const context = await buildContext(section, lastUser.content, gameKey, s);
  const payload = {
    model: s.model,
    temperature: s.temperature,
    max_tokens: s.maxTokens,
    messages: [
      { role: "system", content: `${effectivePrompt(s)}\n\nCONTEXT:\n${context}` },
      ...messages,
    ],
  };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${s.apiKey.trim()}`,
  };
  if (s.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/aaronns87/muos-anbernic-manager";
    headers["X-Title"] = "muOS Anbernic Manager";
  }
  let res: Response;
  try {
    res = await fetch(endpoint(s.provider), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    throw new UserError(`Could not reach the ${s.provider} API: ${(error as Error).message}`);
  }
  const data = await res.json().catch(() => ({})) as {
    error?: { message?: string } | string;
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  if (res.status === 401 || res.status === 403) {
    throw new UserError("The API key was rejected. Check it under Settings > Assistant.");
  }
  if (res.status === 429) {
    throw new UserError("The free quota for this key was hit. Wait a bit, or try another free provider under Settings > Assistant.");
  }
  if (!res.ok) {
    const err = typeof data.error === "string" ? data.error : data.error?.message || res.statusText;
    throw new UserError(`Chat API error: ${err}`);
  }
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new UserError("The model returned an empty reply. Try again or pick another model.");
  return {
    reply,
    usage: data.usage ? { prompt: data.usage.prompt_tokens || 0, completion: data.usage.completion_tokens || 0 } : null,
    provider: s.provider,
    model: s.model,
  };
}
