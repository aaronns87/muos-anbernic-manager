// MCP serverInfo.icons for IDE lists (data URIs so clients need no extra fetch/auth).

import fsp from "node:fs/promises";
import path from "node:path";
import { ctx } from "../context.ts";

export type McpIcon = {
  src: string;
  mimeType: string;
  sizes: string[];
  theme?: "light" | "dark";
};

let cached: McpIcon[] | null = null;

async function dataIcon(file: string, mimeType: string, sizes: string[]): Promise<McpIcon | null> {
  try {
    const buf = await fsp.readFile(file);
    return {
      src: `data:${mimeType};base64,${buf.toString("base64")}`,
      mimeType,
      sizes,
    };
  } catch {
    return null;
  }
}

/** Manager brand icons (hexagon mark) for MuAnMCP in client MCP lists. */
export async function mcpServerIcons(): Promise<McpIcon[]> {
  if (cached) return cached;
  const assets = path.join(ctx.managerDir, "public", "assets");
  const icons: McpIcon[] = [];
  // Prefer PNG for broad client support; SVG for sharp scaling when allowed.
  const png = await dataIcon(path.join(assets, "favicon-180.png"), "image/png", ["180x180"]);
  if (png) icons.push(png);
  const svg = await dataIcon(path.join(assets, "favicon.svg"), "image/svg+xml", ["any"]);
  if (svg) icons.push(svg);
  cached = icons;
  return icons;
}
