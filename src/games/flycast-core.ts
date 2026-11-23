// Dreamcast in-browser play: cache the nasomers/flycast-wasm libretro build and expose it in
// EmulatorJS core shape (flycast-wasm.js / .wasm). Official EmulatorJS CDN has no Flycast core.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "../context.ts";
import { UserError } from "../errors.ts";
import { say } from "../log.ts";

const RELEASE = "https://github.com/nasomers/flycast-wasm/releases/download/v1.0";
const FILES = [
  { remote: "flycast_libretro.js", local: "flycast-wasm.js" },
  { remote: "flycast_libretro.wasm", local: "flycast-wasm.wasm" },
] as const;

function coreDir(): string {
  return path.join(ctx.cacheDir, "flycast-core");
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new UserError(`Could not download Dreamcast core (${res.status}). Check your network.`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new UserError("Dreamcast core download looked empty.");
  await fsp.writeFile(dest + ".partial", buf);
  await fsp.rename(dest + ".partial", dest);
}

/** Ensure EmulatorJS-shaped Flycast core files exist under .cache/flycast-core/. */
export async function ensureFlycastCore(): Promise<{ ready: true; dir: string }> {
  const dir = coreDir();
  await fsp.mkdir(dir, { recursive: true });
  for (const f of FILES) {
    const dest = path.join(dir, f.local);
    if (fs.existsSync(dest) && (await fsp.stat(dest)).size > 1024) continue;
    say("yellow", "FLYCAST", `Downloading ${f.remote}…`);
    await download(`${RELEASE}/${f.remote}`, dest);
    say("green", "FLYCAST", `Cached ${f.local}`);
  }
  return { ready: true, dir };
}

export async function flycastCoreStatus() {
  const dir = coreDir();
  const files = Object.fromEntries(
    await Promise.all(
      FILES.map(async (f) => {
        const p = path.join(dir, f.local);
        try {
          const st = await fsp.stat(p);
          return [f.local, { exists: true, size: st.size }];
        } catch {
          return [f.local, { exists: false, size: 0 }];
        }
      }),
    ),
  );
  return { ready: FILES.every((f) => (files as Record<string, { exists: boolean }>)[f.local]?.exists), files, source: RELEASE };
}

/** Serve a cached Flycast core file (js/wasm/data). */
export async function flycastCoreFile(name: string) {
  const base = path.basename(name);
  if (!/^flycast-wasm\.(js|wasm)$/.test(base)) throw new UserError("Unknown Dreamcast core file.");
  await ensureFlycastCore();
  const full = path.join(coreDir(), base);
  if (!fs.existsSync(full)) throw new UserError("Dreamcast core is not cached yet.");
  const download = await fsp.readFile(full);
  const type = base.endsWith(".js") ? "application/javascript" : "application/wasm";
  return { download, name: base, type };
}
