// The manager's entry in the system's app list: an app in ~/Applications on macOS, a Start menu shortcut on Windows,
// a desktop entry in the app menu on Linux. Each opens a terminal window running run.sh (run.cmd on Windows), the same
// as starting it by hand, so closing that window stops the manager.

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ctx } from "./context.ts";
import { UserError } from "./errors.ts";
import { run } from "./platform/run.ts";

const NAME = "muOS Anbernic Manager";
const COMMENT = "Games, artwork, apps and settings for MustardOS handhelds";
const BUNDLE_ID = "io.github.aaronns87.muos-anbernic-manager";
const asset = (name: string) => path.join(ctx.publicDir, "assets", name);

export function shortcutPath(): string {
  const home = os.homedir();
  if (process.platform === "darwin") return path.join(home, "Applications", `${NAME}.app`);
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", `${NAME}.lnk`);
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "applications", "muos-anbernic-manager.desktop");
}

const place = () => (process.platform === "darwin" ? "Applications" : process.platform === "win32" ? "the Start menu" : "the app menu");

export async function shortcutInfo() {
  const file = shortcutPath();
  return { place: place(), path: file, exists: !!(await fsp.stat(file).catch(() => null)) };
}

const shellQuote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
const xml = (text: string) => text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);

async function macApp(file: string) {
  const contents = path.join(file, "Contents");
  const plist = await fsp.readFile(path.join(contents, "Info.plist"), "utf8").catch(() => null);
  if (plist !== null && !plist.includes(BUNDLE_ID)) throw new UserError(`${file} belongs to another app; move it away first.`);
  if (plist === null && (await fsp.stat(file).catch(() => null))) throw new UserError(`${file} is in the way; move it away first.`);
  const runSh = path.join(ctx.managerDir, "run.sh");
  await fsp.chmod(runSh, 0o755);
  await fsp.rm(file, { recursive: true, force: true });
  await fsp.mkdir(path.join(contents, "MacOS"), { recursive: true });
  await fsp.mkdir(path.join(contents, "Resources"), { recursive: true });
  await fsp.writeFile(path.join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${xml(NAME)}</string>
  <key>CFBundleDisplayName</key><string>${xml(NAME)}</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>app-icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`);
  await fsp.writeFile(path.join(contents, "MacOS", "launcher"), `#!/bin/bash\nexec /usr/bin/open -a Terminal ${shellQuote(runSh)}\n`, { mode: 0o755 });
  await fsp.copyFile(asset("app-icon.icns"), path.join(contents, "Resources", "app-icon.icns"));
  const now = new Date();
  await fsp.utimes(file, now, now);
}

/** Exec= quoting from the desktop entry spec: quote the path, escape the reserved characters, then the string escapes. */
const execQuote = (text: string) => `"${text.replace(/[\\"`$]/g, "\\$&")}"`.replaceAll("\\", "\\\\").replaceAll("%", "%%");

async function linuxEntry(file: string) {
  const runSh = path.join(ctx.managerDir, "run.sh");
  await fsp.chmod(runSh, 0o755);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, [
    "[Desktop Entry]", "Type=Application", `Name=${NAME}`, `Comment=${COMMENT}`, `Exec=${execQuote(runSh)}`, `Path=${ctx.managerDir}`,
    `Icon=${asset("app-icon.png")}`, "Terminal=true", "Categories=Utility;Game;", "",
  ].join("\n"), { mode: 0o755 });
  await run("update-desktop-database", [path.dirname(file)], 10_000);
}

async function windowsShortcut(file: string) {
  const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", [
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${quote(file)})`,
    `$s.TargetPath = ${quote(path.join(ctx.managerDir, "run.cmd"))}`,
    `$s.WorkingDirectory = ${quote(ctx.managerDir)}`,
    `$s.IconLocation = ${quote(`${asset("app-icon.ico")},0`)}`,
    `$s.Description = ${quote(COMMENT)}`,
    "$s.Save()",
  ].join("; ")]);
  if (result.code !== 0) throw new UserError(`Could not create the Start menu shortcut: ${result.stderr.trim() || `PowerShell exited with ${result.code}`}`);
}

/** Creates or replaces the entry, pointing at this copy of the manager. */
export async function createShortcut() {
  const file = shortcutPath();
  if (process.platform === "darwin") await macApp(file);
  else if (process.platform === "win32") await windowsShortcut(file);
  else await linuxEntry(file);
  return { place: place(), path: file };
}
