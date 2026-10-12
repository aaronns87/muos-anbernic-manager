// Starts the manager on a free port with a throwaway workspace and cache, so tests never see the real
// Roms/, settings or handheld logins.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const managerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const NAMES = `<?xml version="1.0"?>
<mamenames>
<game><mamename>sf2</mamename><realname>Street Fighter II: The World Warrior (World 910522)</realname></game>
</mamenames>
`;

const freePort = () => new Promise<number>((resolve) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => {
    const { port } = s.address() as net.AddressInfo;
    s.close(() => resolve(port));
  });
});

export interface TestServer {
  base: string;
  token: string;
  root: string;
  api: (route: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; json: any }>;
  stop: () => void;
}

/** roms: { GB: ["Tetris (World).gb"] } creates Roms/GB/Tetris (World).gb with a few bytes in it. */
export async function startServer(roms: Record<string, string[]>): Promise<TestServer> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manager-root-"));
  const cache = path.join(root, ".cache");
  fs.mkdirSync(cache);
  fs.writeFileSync(path.join(cache, "mamenames.xml"), NAMES);
  for (const [dir, files] of Object.entries(roms)) {
    fs.mkdirSync(path.join(root, "Roms", dir), { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(root, "Roms", dir, f), `rom data for ${f}`);
  }
  const args = ["src/main.ts", "--no-open", "--skip-descriptions", "--port", String(await freePort()), "--root", root, "--cache-dir", cache];
  const child = spawn(process.execPath, args, { cwd: managerDir, stdio: ["ignore", "pipe", "pipe"] });
  const stop = () => {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  };
  let out = "", base = "", token = "";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`The manager did not start:\n${out}`)), 30_000);
      const read = (chunk: Buffer) => {
        out += chunk.toString();
        const m = /(http:\/\/127\.0\.0\.1:\d+)\/\?token=([\w-]+)/.exec(out);
        if (m) { [, base, token] = m; clearTimeout(timer); resolve(); }
      };
      child.stdout!.on("data", read);
      child.stderr!.on("data", read);
      child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`The manager exited (${code}):\n${out}`)); });
    });
  } catch (error) {
    stop();
    throw error;
  }
  const api: TestServer["api"] = async (route, body, headers = {}) => {
    const res = await fetch(`${base}/api/${route}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-Manager-Token": token, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  return { base, token, root, api, stop };
}
