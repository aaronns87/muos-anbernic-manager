// First-run-after-update notes: compare VERSION to `.cache/seen-version` and, when higher,
// return the matching sections from CHANGELOG.md. Dismissing writes the current version as seen.

import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "./context.ts";
import { runningVersion } from "./manager-update.ts";
import { compareVersions } from "./updates.ts";

export interface WhatsNewSection {
  title: string;
  items: string[];
}

export interface WhatsNewRelease {
  version: string;
  date: string;
  sections: WhatsNewSection[];
}

export interface WhatsNewStatus {
  show: boolean;
  version: string;
  from: string;
  releases: WhatsNewRelease[];
}

const seenFile = () => path.join(ctx.cacheDir, "seen-version");

async function readSeen(): Promise<string> {
  try {
    return (await fsp.readFile(seenFile(), "utf8")).trim();
  } catch {
    return "";
  }
}

async function writeSeen(version: string): Promise<void> {
  await fsp.mkdir(ctx.cacheDir, { recursive: true });
  await fsp.writeFile(seenFile(), `${version}\n`, "utf8");
}

/** Keep a Changelog version blocks: "## [1.2.2] - 2026-10-15" then ### Added / bullets. */
export function parseChangelog(md: string): WhatsNewRelease[] {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const out: WhatsNewRelease[] = [];
  let cur: WhatsNewRelease | null = null;
  let section: WhatsNewSection | null = null;

  const flushSection = () => {
    if (cur && section?.items.length) cur.sections.push(section);
    section = null;
  };
  const flushRelease = () => {
    flushSection();
    if (cur?.sections.length) out.push(cur);
    cur = null;
  };

  for (const raw of lines) {
    const head = /^## \[([^\]]+)\](?:\s*-\s*(.+))?$/.exec(raw.trim());
    if (head) {
      flushRelease();
      const version = head[1].trim();
      if (/^unreleased$/i.test(version)) continue;
      cur = { version, date: (head[2] || "").trim(), sections: [] };
      continue;
    }
    if (!cur) continue;
    const sub = /^###\s+(.+)$/.exec(raw.trim());
    if (sub) {
      flushSection();
      section = { title: sub[1].trim(), items: [] };
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(raw.trim());
    if (bullet && section) {
      section.items.push(bullet[1].trim().replace(/\s+/g, " "));
      continue;
    }
    // Continuation lines of a multi-line bullet.
    if (section?.items.length && /^\s+\S/.test(raw) && !raw.trim().startsWith("#")) {
      section.items[section.items.length - 1] += ` ${raw.trim().replace(/\s+/g, " ")}`;
    }
  }
  flushRelease();
  return out;
}

async function loadReleases(): Promise<WhatsNewRelease[]> {
  try {
    const md = await fsp.readFile(path.join(ctx.managerDir, "CHANGELOG.md"), "utf8");
    return parseChangelog(md);
  } catch {
    return [];
  }
}

/** Releases newer than `from` up to and including `version`, newest first. */
export function releasesSince(all: WhatsNewRelease[], from: string, version: string): WhatsNewRelease[] {
  return all
    .filter((r) => /^\d+(\.\d+)*$/.test(r.version)
      && compareVersions(r.version, version) <= 0
      && (!from || compareVersions(r.version, from) > 0))
    .sort((a, b) => compareVersions(b.version, a.version));
}

export async function whatsNewStatus(): Promise<WhatsNewStatus> {
  const version = await runningVersion();
  const from = await readSeen();
  if (!from) {
    // First launch (or wiped cache): remember the version, do not interrupt setup.
    await writeSeen(version);
    return { show: false, version, from: "", releases: [] };
  }
  if (compareVersions(version, from) <= 0) {
    return { show: false, version, from, releases: [] };
  }
  const releases = releasesSince(await loadReleases(), from, version);
  return { show: releases.length > 0, version, from, releases };
}

export async function dismissWhatsNew(): Promise<WhatsNewStatus> {
  const version = await runningVersion();
  await writeSeen(version);
  return { show: false, version, from: version, releases: [] };
}
