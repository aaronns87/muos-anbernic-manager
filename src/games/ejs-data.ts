// Proxy EmulatorJS stable data/ with a local override for the Dreamcast Flycast core.

import path from "node:path";
import { flycastCoreFile, ensureFlycastCore } from "./flycast-core.ts";
import { UserError } from "../errors.ts";

const CDN = "https://cdn.emulatorjs.org/stable/data/";

function safeRel(rel: string): string {
  const clean = rel.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!clean || clean.includes("..") || clean.startsWith("/") || /[\0]/.test(clean)) {
    throw new UserError("Bad EmulatorJS data path.");
  }
  return clean;
}

/** Resolve an EmulatorJS data file: Flycast from cache, everything else from the CDN. */
export async function ejsDataFile(relRaw: string) {
  const rel = safeRel(relRaw);
  if (rel === "cores/flycast-wasm.js" || rel === "cores/flycast-wasm.wasm") {
    await ensureFlycastCore();
    return flycastCoreFile(path.posix.basename(rel));
  }
  const url = CDN + rel.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new UserError(`EmulatorJS CDN returned ${res.status} for ${rel}.`);
  const download = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get("content-type")
    || (rel.endsWith(".js") ? "application/javascript"
      : rel.endsWith(".wasm") ? "application/wasm"
      : rel.endsWith(".css") ? "text/css"
      : rel.endsWith(".json") ? "application/json"
      : "application/octet-stream");
  return { download, name: path.posix.basename(rel), type };
}

export async function prepareDreamcastPlay() {
  await ensureFlycastCore();
  return flycastCoreStatusSafe();
}

async function flycastCoreStatusSafe() {
  const { flycastCoreStatus } = await import("./flycast-core.ts");
  return flycastCoreStatus();
}
