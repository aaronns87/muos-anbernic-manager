// Parsers and helpers that need no handheld: tar listing, ini and BIOS catalogue, release YAML, versions,
// path checks, and the shell scripts that save core assignments (run for real with sh in a temp folder).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fixBiosNames, parseCatalog, parseIni } from "../src/bios.ts";
import { chdInstallHelp, convertibleFromDisc, isChdConvertible, probeChdman, trashBasenamesForSheet } from "../src/games/chd.ts";
import { classifyMembers, relAfterFlatten } from "../src/games/disc-fix.ts";
import { gameDiscLayout, sheetRefs, sniffArchive } from "../src/games/disc-layout.ts";
import type { Game } from "../src/games/library.ts";
import { folderScript, gameScript } from "../src/cores.ts";
import { cleanName, cleanParts } from "../src/files.ts";
import { collectionItem, fnv1a, romOf } from "../src/play.ts";
import { parseInputDevices, pickStickDevice, pickButtonDevice } from "../src/device/controls.ts";
import { mergeCfg, overrideFor, parseCfg } from "../src/retroarch.ts";
import { parseCatalogue, parseDevice, safeName } from "../src/themes.ts";
import { parseCatalogue as parsePorts, parseDevice as parsePortsDevice, safePort, unfit } from "../src/ports.ts";
import { byId, DEVICES, deviceFor, imageDevice, portCaps, specs } from "../public/js/devices.js";
import { ctx, setRoot } from "../src/context.ts";
import { createWorkspace, firstRun, loadSettings, settings } from "../src/settings.ts";
import { githubRepo } from "../src/manager-update.ts";
import { assetKind, parseIni as parseScheme, writeIni as writeScheme } from "../src/theme-designer.ts";
import { folderItems, unzipTo, writeZip, zipNames } from "../src/zip.ts";
import { KNOWN, notesText, parseAssets, parseAtom, rankAssets, readmeImages } from "../src/app-market.ts";
import { companions, isRunner, scummFolder, scummFolders } from "../src/games/engines.ts";
import { splitTitle } from "../src/games/library.ts";
import { createShortcut, shortcutInfo } from "../src/shortcut.ts";
import { norm } from "../src/games/systems.ts";
import { discId, sfoValue } from "../src/tuning/disc-id.ts";
import { controlMapping, newGameIni, parseIni as parsePpssppIni, parseOpt, setIni, setOpt } from "../src/tuning/tuning.ts";
import { PROFILES, RECOMMENDATIONS } from "../src/tuning/profiles.ts";
import { cheatCandidates, parseCht, parsePpssppCheats, ppssppIni, retroarchName, setChtEnabled, setPpssppCheats, writeCht } from "../src/tuning/cheats.ts";
import zlib from "node:zlib";
import { safeEntries, tarEntries } from "../src/tar.ts";
import { compareVersions, parseYaml, versionOfBuild } from "../src/updates.ts";
import { inside, safePart, splitName } from "../src/util.ts";
import { parseChangelog, releasesSince } from "../src/whats-new.ts";

const tmp = (t: { after: (fn: () => void) => void }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manager-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

function tarHeader(name: string, size: number, type = "0"): Buffer {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0);
  h.write(size.toString(8).padStart(11, "0"), 124);
  h.write((1_700_000_000).toString(8).padStart(11, "0"), 136);
  h.write(type, 156);
  h.write("ustar", 257);
  return h;
}

function tar(entries: { name: string; data?: string; type?: string }[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = Buffer.from(e.data ?? "");
    if (e.name.length > 100) {
      const long = Buffer.from(e.name + "\0");
      parts.push(tarHeader("././@LongLink", long.length, "L"), long, Buffer.alloc((512 - (long.length % 512)) % 512));
    }
    parts.push(tarHeader(e.name, data.length, e.type ?? "0"), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}

test("tarEntries lists files, folders and GNU long names", () => {
  const long = `save/file/${"x".repeat(120)}.srm`;
  const entries = tarEntries(tar([{ name: "save/", type: "5" }, { name: "save/file/a.srm", data: "hello" }, { name: long, data: "abc" }]));
  assert.deepEqual(entries.map((e) => [e.path, e.size, e.dir]), [["save", 0, true], ["save/file/a.srm", 5, false], [long, 3, false]]);
  assert.equal(entries[1].mtime, 1_700_000_000);
});

test("safeEntries rejects absolute paths, .. and paths outside the root", () => {
  const e = (p: string) => ({ path: p, size: 0, mtime: 0, dir: false });
  assert.equal(safeEntries([e("save"), e("save/a.srm")], "save"), true);
  assert.equal(safeEntries([e("save/../etc/passwd")], "save"), false);
  assert.equal(safeEntries([e("/save/a")], "save"), false);
  assert.equal(safeEntries([e("other/a")], "save"), false);
});

test("splitName, safePart and inside", (t) => {
  assert.deepEqual(splitName("Game (USA).ZIP"), ["Game (USA)", "zip"]);
  assert.deepEqual(splitName(".hidden"), [".hidden", ""]);
  assert.equal(safePart("Game.zip"), true);
  for (const bad of ["", "..", ".x", "a/b", "a\\b", 3]) assert.equal(safePart(bad), false);
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, "Roms"));
  assert.equal(inside(path.join(dir, "Roms"), path.join(dir, "Roms", "GB", "x.gb")), true);
  assert.equal(inside(path.join(dir, "Roms"), path.join(dir, "Roms")), false);
  assert.equal(inside(path.join(dir, "Roms"), path.join(dir, "Roms", "..", "other")), false);
});

test("splitTitle and norm", () => {
  assert.deepEqual(splitTitle("Addams Family, The (USA, Europe) [!]"), ["The Addams Family", ["USA, Europe", "!"]]);
  assert.equal(norm("The Legend of Zelda - A Link to the Past (USA)"), norm("Legend of Zelda, The - A Link to the Past"));
  assert.equal(norm("Sonic & Knuckles"), "sonicandknuckles");
});

test("compareVersions", () => {
  assert.ok(compareVersions("2601.1", "2606.0") < 0);
  assert.ok(compareVersions("v8.0.5", "2.2.1") > 0);
  assert.equal(compareVersions("1.4", "v1.4.0"), 0);
  assert.ok(compareVersions("1.10", "1.9") > 0);
});

test("whats-new parses CHANGELOG version blocks", () => {
  const md = `# Changelog
## [Unreleased]
### Added
- Skip me
## [1.2.2] - 2026-10-15
### Added
- **Transfers** panel
  with a queue.
### Fixed
- A small bug
## [1.2.1] - 2026-10-14
### Changed
- Dropdowns
`;
  const all = parseChangelog(md);
  assert.equal(all.length, 2);
  assert.equal(all[0].version, "1.2.2");
  assert.equal(all[0].date, "2026-10-15");
  assert.equal(all[0].sections[0].title, "Added");
  assert.match(all[0].sections[0].items[0], /Transfers.*queue/);
  assert.equal(all[0].sections[1].items[0], "A small bug");
  const since = releasesSince(all, "1.2.1", "1.2.2");
  assert.deepEqual(since.map((r) => r.version), ["1.2.2"]);
  assert.deepEqual(releasesSince(all, "1.2.0", "1.2.2").map((r) => r.version), ["1.2.2", "1.2.1"]);
});

test("versionOfBuild finds a point release from the build id in an image name", () => {
  const names = ["MustardOS_RG40XX-H_2601.0_JACARANDA-1a2b3c4d.img.gz", "MustardOS_RG40XX-H_2601.1_FUNKY_JACARANDA-bc38efa0.img.gz"];
  assert.equal(versionOfBuild("bc38efa0", names), "2601.1");
  assert.equal(versionOfBuild("BC38EFA0", names), "2601.1");
  assert.equal(versionOfBuild("1a2b3c4d", names), "2601.0");
  assert.equal(versionOfBuild("deadbeef", names), "");
  assert.equal(versionOfBuild("", names), "");
});

test("parseYaml reads the MustardOS release files", () => {
  const yaml = `name: Funky Jacaranda
version: "2601.1"
type: current
important: |
  Line one
  line two
changes:
  - Themes are folders
  - "Quoted: change"
links:
  - name: GoFile
    url: https://example.com/a
  - name: MEGA
    url: https://example.com/b
device:
  slug: rg40xx-h
  hash: abc # not a comment in values
`;
  const y = parseYaml(yaml) as Record<string, any>;
  assert.equal(y.version, "2601.1");
  assert.equal(y.important, "Line one\nline two");
  assert.deepEqual(y.changes, ["Themes are folders", "Quoted: change"]);
  assert.deepEqual(y.links.map((l: Record<string, string>) => [l.name, l.url]), [["GoFile", "https://example.com/a"], ["MEGA", "https://example.com/b"]]);
  assert.equal(y.device.slug, "rg40xx-h");
});

test("parseIni keeps sections, keys and bare lines", () => {
  const ini = parseIni("; comment\n[global]\nname = Nintendo NES\ndefault=fceumm\n[friendly]\nnes\nfamicom\n");
  assert.deepEqual(ini.find((s) => s.name === "global")?.keys, { name: "Nintendo NES", default: "fceumm" });
  assert.deepEqual(ini.find((s) => s.name === "friendly")?.bare, ["nes", "famicom"]);
});

test("parseCatalog joins assign inis, assign.json and RetroArch firmware", () => {
  const out = [
    "=F\tSony PlayStation/global.ini", "[global]", "name=Sony PlayStation", "default=pcsx", "[bios]", "file_0=scph1001.bin", "hash_0=924E392ED05558FFDB115408C263DCCF", "[friendly]", "psx",
    "=F\tSony PlayStation/pcsx.ini", "[pcsx]", "name=PCSX ReARMed", "core=pcsx_rearmed_libretro.so", "bios_required=0",
    "=F\tNintendo NES/global.ini", "[global]", "default=fceumm",
    "=F\tNintendo NES/fceumm.ini", "[fceumm]", "name=FCEUmm", "core=fceumm_libretro.so",
    "=J", '{"ps": "Sony PlayStation", "nes": "Nintendo NES"}',
    "=I\tpcsx_rearmed_libretro", 'display_name = "Sony - PlayStation (PCSX ReARMed)"', 'firmware_count = "2"',
    'firmware0_path = "scph5501.bin"', 'firmware0_desc = "PS1 US BIOS"', 'firmware0_opt = "true"',
    'firmware1_path = "scph1001.bin"', 'firmware1_desc = "PS1 BIOS"', 'firmware1_opt = "true"',
    'notes = "(!) scph5501.bin (md5): 490f666e1afb15b7362b406ed1cea246|(!) scph1001.bin (md5): 924e392ed05558ffdb115408c263dccf"',
    "=E",
  ].join("\n");
  const cat = parseCatalog(out, "2601.0");
  assert.equal(cat.systems.length, 1, "systems without BIOS files are left out");
  const ps = cat.systems[0];
  assert.equal(ps.defaultCore, "pcsx");
  assert.deepEqual(ps.main, ["scph1001.bin"]);
  assert.deepEqual([...ps.files].sort(), ["scph1001.bin", "scph5501.bin"]);
  assert.ok(ps.aliases.includes("psx") && ps.aliases.includes("ps"));
  assert.deepEqual(ps.cores, [{ key: "pcsx", name: "PCSX ReARMed", required: false }]);
  assert.deepEqual(cat.files["scph1001.bin"].md5s, ["924e392ed05558ffdb115408c263dccf"]);
  assert.equal(cat.files["scph5501.bin"].desc, "PS1 US BIOS");
});

const sh = (script: string, input: string) => execFileSync("sh", ["-c", script], { input, encoding: "utf8" });

test("folderScript saves core.cfg and removes the games' own cores unless kept", (t) => {
  const content = tmp(t);
  const folder = "GB's \"Games\"";
  const d = path.join(content, folder);
  fs.mkdirSync(d);
  for (const f of ["Tetris.cfg", "Tetris.gov", "core.gov", "core_recursive.cfg"]) fs.writeFileSync(path.join(d, f), "x");
  fs.writeFileSync(path.join(content, "core.con"), "default controls");
  sh(folderScript(content, folder, true), "gambatte\nNintendo Game Boy\nNintendo Game Boy\n\ngambatte");
  assert.equal(fs.readFileSync(path.join(d, "core.cfg"), "utf8"), "gambatte\nNintendo Game Boy\nNintendo Game Boy\n\ngambatte");
  assert.ok(fs.existsSync(path.join(d, "Tetris.cfg")), "kept with keepGames");
  assert.equal(fs.readFileSync(path.join(d, "core.con"), "utf8"), "default controls");
  sh(folderScript(content, folder, false), "mgba");
  assert.deepEqual(fs.readdirSync(d).sort(), ["core.cfg", "core.con", "core.gov", "core_recursive.cfg"]);
  assert.equal(fs.readFileSync(path.join(d, "core.cfg"), "utf8"), "mgba");
});

test("gameScript saves one game's cfg next to copies of the folder settings", (t) => {
  const content = tmp(t);
  const d = path.join(content, "MD");
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, "core.gov"), "performance");
  fs.writeFileSync(path.join(content, "core.rac"), "global rac");
  const name = "Sonic & Knuckles (World) $HOME `x`";
  sh(gameScript(content, "MD", name), "picodrive");
  assert.equal(fs.readFileSync(path.join(d, `${name}.cfg`), "utf8"), "picodrive");
  assert.equal(fs.readFileSync(path.join(d, `${name}.gov`), "utf8"), "performance");
  assert.equal(fs.readFileSync(path.join(d, `${name}.rac`), "utf8"), "global rac");
  assert.ok(!fs.existsSync(path.join(d, `${name}.con`)));
});

test("collection entries use MustardOS's name, hash and contents", () => {
  assert.equal(fnv1a(""), "811C9DC5");
  assert.equal(fnv1a("a"), "E40C292C");
  const full = "/mnt/sdcard/ROMS/GB/Tetris (World).gb";
  assert.deepEqual(collectionItem("TF2", "GB/Tetris (World).gb"), { file: `Tetris (World)-${fnv1a(full)}.cfg`, text: `${full}\nGB\nTetris (World)` });
  assert.equal(collectionItem("SD1", "PS/Disc/Game.cue").text, "/mnt/mmc/ROMS/PS/Disc/Game.cue\nPS/Disc\nGame");
  assert.throws(() => collectionItem("TF2", "Tetris.gb"));
  assert.throws(() => collectionItem("TF2", "GB/../../etc/passwd"));
  assert.throws(() => collectionItem("USB", "GB/Tetris.gb"));
  assert.deepEqual(romOf("/mnt/union/ROMS/GB/sub/Tetris.gb"), { system: "GB/sub", file: "Tetris.gb" });
});

test("cleanParts and cleanName refuse paths that climb out or break on FAT32", () => {
  assert.deepEqual(cleanParts("MUOS//info/"), ["MUOS", "info"]);
  for (const bad of ["..", "a/../b", "a\\b"]) assert.throws(() => cleanParts(bad), bad);
  assert.equal(cleanName("  Saves 2 "), "Saves 2");
  for (const bad of ["", ".", "a/b", "a:b", "what?", "x".repeat(201)]) assert.throws(() => cleanName(bad), bad);
});

test("RetroArch overrides keep other lines and drop keys set back to default", () => {
  const text = 'video_driver = "gl"\naspect_ratio_index = "0"\nvideo_smooth = "true"\n';
  assert.deepEqual([...parseCfg(text)], [["video_driver", "gl"], ["aspect_ratio_index", "0"], ["video_smooth", "true"]]);
  assert.equal(mergeCfg(text, { aspect_ratio_index: "22", video_smooth: "", fps_show: "true" }), 'video_driver = "gl"\naspect_ratio_index = "22"\nfps_show = "true"\n');
  assert.equal(mergeCfg('aspect_ratio_index = "0"\n', { aspect_ratio_index: "" }), "");
  const shaders = ["crt/crt-geom.glslp"], overlays = ["Blank/Blank.cfg"];
  const on = overrideFor({ shader: "crt/crt-geom.glslp", overlay: "Blank/Blank.cfg", opacity: "0.5", integer: "true" }, shaders, overlays);
  assert.equal(on.preset, '#reference "/opt/muos/share/emulator/retroarch/shaders/crt/crt-geom.glslp"\n');
  assert.equal(on.values.input_overlay, "/opt/muos/share/emulator/retroarch/overlays/Blank/Blank.cfg");
  assert.deepEqual([on.values.input_overlay_enable, on.values.input_overlay_opacity, on.values.video_scale_integer], ["true", "0.500000", "true"]);
  const off = overrideFor({ shader: "off", overlay: "off" }, shaders, overlays);
  assert.deepEqual([off.preset, off.values.input_overlay, off.values.input_overlay_enable], ['shaders = "0"\n', "", "false"]);
  assert.equal(overrideFor({ shader: "custom" }, shaders, overlays).preset, null);
  assert.equal(overrideFor({}, shaders, overlays).preset, "");
  for (const bad of [{ shader: "../../etc/passwd" }, { overlay: "x.cfg" }, { aspect: "99" }, { opacity: "2" }, { fps: "yes" }]) assert.throws(() => overrideFor(bad, shaders, overlays), JSON.stringify(bad));
});

test("theme list keeps MustardOS releases with safe names, and the handheld listing parses", () => {
  const url = "https://github.com/MustardOS/theme/releases/download/2601.0_Jacaranda_Latest/Arctic.Blue.muxthm";
  const themes = parseCatalogue([
    { name: "Arctic Blue", url, resolution640x480: true, resolution1280x720: true, grid: true },
    { name: "../evil", url }, { name: "active", url }, { name: "Elsewhere", url: "https://example.com/x.muxthm" }, { name: "No URL" }, null,
  ]);
  assert.deepEqual(themes, [{ name: "Arctic Blue", url, res: ["640x480", "1280x720"], grid: true, hdmi: false, language: false }]);
  assert.throws(() => parseCatalogue({}));
  for (const bad of ["", ".hidden", "a/b", "override", " padded", "x".repeat(101)]) assert.equal(safeName(bad), false, bad);
  const d = parseDevice("@active\tGB Dark\n@res\t640x480\n@fg\tmuxfrontend\n@free\t22020096\n=MustardOS\t2601.0\tMustardOS\t80384\n=GB Dark\t2508.0\t\t14643\n=../x\t1\t\t1\n");
  assert.deepEqual(d, { active: "GB Dark", res: "640x480", foreground: "muxfrontend", freeKb: 22020096, installed: [
    { name: "GB Dark", version: "2508.0", title: "", kb: 14643 }, { name: "MustardOS", version: "2601.0", title: "MustardOS", kb: 80384 }] });
  assert.throws(() => parseDevice("@missing\n"));
});

test("PortMaster list keeps safe port names and works out which ports run on the RG40XX H", () => {
  const source = { url: "https://example.com/x.zip", size: 1000, date_added: "2025-01-02", date_updated: "2025-02-03" };
  const ports = parsePorts({ ports: {
    "b.zip": { name: "b.zip", items: ["B.sh", "b/"], attr: { title: "Bravo", rtr: true, genres: ["puzzle"], reqs: ["power", "!opengl"], arch: ["aarch64"], image: { screenshot: "shot.png" } }, source },
    "a.zip": { name: "a.zip", attr: { title: "Alpha", reqs: ["opengl"], image: { screenshot: "../x.png" } }, source },
    "../evil.zip": { name: "../evil.zip", attr: {}, source },
    "nourl.zip": { name: "nourl.zip", attr: {}, source: {} },
  } });
  assert.deepEqual(ports.map((p) => [p.name, p.title, p.fits, p.why, p.shot, p.rtr]), [["a.zip", "Alpha", false, "Needs opengl", "", false], ["b.zip", "Bravo", true, "", "shot.png", true]]);
  assert.throws(() => parsePorts([]));
  assert.equal(unfit({ arch: ["x86_64"] }), "Built for x86_64");
  assert.equal(unfit({ reqs: ["!muos"] }), "Not for muos");
  assert.equal(unfit({ reqs: ["2gb|1gb", "analog_1"] }), "");
  assert.equal(unfit({ min_glibc: "2.39" }), "Needs glibc 2.39");
  assert.equal(unfit({ min_glibc: "2.38", arch: ["armhf", "x86_64"] }), "");
  for (const bad of ["x.tar", "../a.zip", "a b.zip", ".zip"]) assert.equal(safePort(bad), false, bad);
  const d = parsePortsDevice(`@dirs\t/mnt/sdcard/ports\t/mnt/sdcard/ROMS/Ports\n@free\t1024\n@fg\tmuxfrontend\n=bravo\t300\t{"name":"b.zip","items":["B.sh","b/"],"attr":{"title":"Bravo"}}\n=../x\t1\t{}\n=broken\t2\tnot json\n>B.sh\n>Other.sh\n`);
  assert.deepEqual(d, { portsDir: "/mnt/sdcard/ports", scriptsDir: "/mnt/sdcard/ROMS/Ports", freeKb: 1024, foreground: "muxfrontend", scripts: ["B.sh", "Other.sh"], installed: [
    { dir: "bravo", name: "b.zip", title: "Bravo", kb: 300, items: ["B.sh", "b/"] }, { dir: "broken", name: "", title: "broken", kb: 2, items: [] }] });
  assert.throws(() => parsePortsDevice("@nopm\n"));
});

test("a ScummVM game brings its data folder along, whichever name the folder uses", async (t) => {
  const root = tmp(t), before = ctx.root;
  t.after(() => setRoot(before));
  setRoot(root);
  fs.mkdirSync(path.join(root, "Roms", "SCUMMVM", "_Lure", "sub"), { recursive: true });
  fs.writeFileSync(path.join(root, "Roms", "SCUMMVM", "Lure.scummvm"), "");
  fs.writeFileSync(path.join(root, "Roms", "SCUMMVM", "_Lure", "disk1.vga"), "x");
  fs.writeFileSync(path.join(root, "Roms", "SCUMMVM", "_Lure", "sub", "lure.dat"), "x");
  fs.writeFileSync(path.join(root, "Roms", "SCUMMVM", "_Lure", ".DS_Store"), "x");
  assert.equal(isRunner("SCUMMVM", "Lure.scummvm"), true);
  assert.equal(isRunner("GB", "Lure.scummvm"), false);
  assert.deepEqual(scummFolders("Lure"), [".Lure", "_Lure", "Lure"]);
  assert.equal(await scummFolder("SCUMMVM", "lure"), "_Lure");
  assert.deepEqual((await companions("SCUMMVM", "Lure.scummvm")).map(([rel]) => rel).sort(), ["SCUMMVM/_Lure/disk1.vga", "SCUMMVM/_Lure/sub/lure.dat"]);
  assert.deepEqual(await companions("SCUMMVM", "Other.scummvm"), []);
});

test("devices: board names, PortMaster capabilities and image names", () => {
  assert.equal(new Set(DEVICES.map((d) => d.id)).size, DEVICES.length);
  for (const [board, id] of [["rg40xx-h", "rg40xx-h"], ["RG40XX-H", "rg40xx-h"], ["RG40XX H", "rg40xx-h"], ["rg40xxh", "rg40xx-h"], ["rg28xx", "rg28xx-h"],
    ["RGCUBEXX", "rgcubexx-h"], ["TUI-BRICK", "tui-brick"], ["TrimUI Smart Pro", "tui-spoon"]]) assert.equal(deviceFor(board)?.id, id, board);
  assert.equal(deviceFor("rg99xx"), null);
  assert.equal(deviceFor(""), null);
  assert.deepEqual(new Set(portCaps(byId("rg40xx-h")!)),
    new Set(["aarch64", "armhf", "power", "restore", "4:3", "640x480", "muos", "rg40xx-h", "analog_0", "analog_1", "analog_2", "1gb"]));
  const sp = portCaps(byId("rg34xx-sp")!);
  for (const cap of ["3:2", "720x480", "hires", "wide", "2gb", "1gb", "analog_2"]) assert.ok(sp.includes(cap), cap);
  assert.ok(portCaps(byId("rgcubexx-h")!).includes("opengl"));
  assert.ok(!portCaps(byId("tui-spoon")!).includes("armhf"));
  assert.equal(unfit({ reqs: ["analog_1"] }, new Set(portCaps(byId("rg35xx-plus")!))), "Needs analog_1");
  assert.equal(unfit({ reqs: ["2gb"] }, new Set(portCaps(byId("rg34xx-sp")!))), "");
  assert.equal(imageDevice("/x/MustardOS_RG40XX-H_2601.1_FUNKY_JACARANDA-bc38efa0.img.gz")?.id, "rg40xx-h");
  assert.equal(imageDevice("MustardOS_TUI-BRICK_2601.1_X.img")?.id, "tui-brick");
  assert.equal(imageDevice("random.img"), null);
  assert.ok(specs(byId("tui-brick")!).some(([k, v]) => k === "Cards" && /One microSD/.test(v)));
});

test("a clean cache starts the setup wizard, and the workspace gets its folders without touching files", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manager-ws-"));
  const before = { root: ctx.root, cache: ctx.cacheDir };
  t.after(() => { setRoot(before.root); ctx.cacheDir = before.cache; fs.rmSync(dir, { recursive: true, force: true }); });
  setRoot(path.join(dir, "ws"));
  ctx.cacheDir = path.join(dir, "cache");
  await loadSettings();
  assert.equal(firstRun(), true);
  const [file] = fs.readdirSync(ctx.cacheDir).filter((f) => f.startsWith("settings"));
  assert.ok(file);
  const created = await createWorkspace();
  for (const f of ["Roms", "apps", "os", "bios", "backups", "Roms/GBA", "Roms/PORTS"]) assert.ok(fs.existsSync(path.join(dir, "ws", f)), f);
  assert.ok(created.length > 50);
  fs.writeFileSync(path.join(dir, "ws", "Roms", "GBA", "game.gba"), "x");
  assert.deepEqual(await createWorkspace(), []);
  assert.ok(fs.existsSync(path.join(dir, "ws", "Roms", "GBA", "game.gba")));
  await createWorkspace(path.join(dir, "elsewhere"));
  assert.equal(settings().roms, path.join(dir, "elsewhere", "Roms"));
  assert.ok(fs.existsSync(path.join(dir, "elsewhere", "Roms", "MD")));
  await loadSettings();
  assert.equal(firstRun(), true);
  fs.writeFileSync(path.join(ctx.cacheDir, file), "{}");
  await loadSettings();
  assert.equal(firstRun(), false);
  fs.rmSync(path.join(ctx.cacheDir, file));
  fs.writeFileSync(path.join(ctx.cacheDir, "wifi.json"), "{}");
  await loadSettings();
  assert.equal(firstRun(), false, "a cache with other files is not a first run");
});

test("VERSION is the version in package.json and its lock file, and the update check finds the GitHub repository", () => {
  const dir = path.join(import.meta.dirname, "..");
  const version = fs.readFileSync(path.join(dir, "VERSION"), "utf8").trim();
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, version);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "package-lock.json"), "utf8")).version, version, "npm install --package-lock-only");
  assert.equal(githubRepo(pkg.repository.url), "aaronns87/muos-anbernic-manager");
  assert.equal(githubRepo("git@github.com:someone/fork-name.git"), "someone/fork-name");
  assert.equal(githubRepo("https://github.com/a/b/"), "a/b");
  assert.equal(githubRepo("https://example.com/a/b"), "");
});

test("app market: release feed and asset page parsing", () => {
  const atom = `<feed><entry><id>x</id><updated>2026-10-12T02:26:06Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/a/b/releases/tag/v1.2%2Bx"/><title>Big &amp; small</title>
    <content type="html">&lt;p&gt;Fixes:&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;li&gt;Two&lt;/li&gt;&lt;/ul&gt;</content></entry>
    <entry><updated>2026-01-01T00:00:00Z</updated><link href="https://github.com/a/b/releases/tag/v1.1"/><title>v1.1</title><content type="html"></content></entry></feed>`;
  const feed = parseAtom(atom);
  assert.deepEqual(feed.map((r) => r.tag), ["v1.2%2Bx", "v1.1"]);
  assert.equal(feed[0].name, "Big & small");
  assert.equal(feed[0].notes, "Fixes:\n\n- One\n- Two");
  assert.equal(notesText("a<br>b &lt;c&gt;"), "a\nb <c>");
  const page = `<ul><li class="Box-row"><a href="/a/b/releases/download/v1.2/App%20One.muxapp" rel="nofollow"><span>App One.muxapp</span></a>
    <span>24.7 MB</span></li><li><a href="/a/b/releases/download/v1.2/App-PortMaster.zip">x</a><span>3 MB</span></li>
    <li><a href="/a/b/releases/download/v1.2/Theme.muxupd">t</a><span>512 KB</span></li><li><a href="/a/b/archive/refs/tags/v1.2.zip">Source</a></li></ul>`;
  assert.deepEqual(parseAssets(page), [
    { name: "App One.muxapp", size: Math.round(24.7 * 1024 ** 2), url: "https://github.com/a/b/releases/download/v1.2/App%20One.muxapp" },
    { name: "Theme.muxupd", size: 512 * 1024, url: "https://github.com/a/b/releases/download/v1.2/Theme.muxupd" },
  ]);
});

test("app market: packages are ranked for the handheld's maker and MustardOS release", () => {
  const bt = [{ name: "Bluetooth-GOOSE-JACARANDA-TRIMUI.muxupd", size: 1 }, { name: "Bluetooth-PIXIE-GOOSE-JACARANDA-ANBERNIC.muxupd", size: 2 }];
  const anbernic = rankAssets(bt, "Anbernic", "JACARANDA");
  assert.deepEqual(anbernic.map((a) => [a.name.split("-").pop(), a.fit]), [["ANBERNIC.muxupd", "best"], ["TRIMUI.muxupd", "other"]]);
  assert.equal(anbernic[1].why, "For TrimUI handhelds");
  const hotspot = rankAssets([{ name: "WifiHotspot_GOOSE.muxupd", size: 1 }, { name: "WifiHotspot_Pixie.muxupd", size: 1 }], "Anbernic", "JACARANDA");
  assert.ok(hotspot.every((a) => a.fit === "other"));
  assert.equal(hotspot[0].why, "For MustardOS Goose");
  const unknown = rankAssets([{ name: "X_PIXIE.muxupd", size: 1 }, { name: "X_GOOSE.muxupd", size: 1 }], "Anbernic", "");
  assert.equal(unknown[0].name, "X_GOOSE.muxupd");
  assert.equal(unknown[0].fit, "best");
  const scrappy = rankAssets([{ name: "Scrappy_v2.2.1.muxzip", size: 1 }, { name: "Scrappy_v2.2.1_update.muxapp", size: 1 }], "Anbernic", "JACARANDA");
  assert.deepEqual(scrappy.map((a) => a.fit), ["best", "other"]);
  assert.equal(new Set(KNOWN.map((k) => k.repo.toLowerCase())).size, KNOWN.length);
});

test("app market: README screenshots skip badges and resolve relative paths", () => {
  const md = `![build](https://img.shields.io/badge/x.svg) ![shot](docs/shot1.png)
    <img src="https://github.com/a/b/blob/main/img/s2.jpg?raw=true" width="300"> ![logo](logo.png) ![again](./docs/shot1.png)`;
  assert.deepEqual(readmeImages("a/b", md), [
    "https://raw.githubusercontent.com/a/b/HEAD/docs/shot1.png",
    "https://raw.githubusercontent.com/a/b/main/img/s2.jpg",
  ]);
});

test("app shortcut: starts run.sh from a temporary home", { skip: process.platform === "win32" }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mgr-shortcut-"));
  const saved = { HOME: process.env.HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME };
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = path.join(home, "share");
  try {
    assert.equal((await shortcutInfo()).exists, false);
    const { path: file } = await createShortcut();
    assert.ok(file.startsWith(home));
    const runSh = path.join(ctx.managerDir, "run.sh");
    if (process.platform === "darwin") {
      assert.match(fs.readFileSync(path.join(file, "Contents", "MacOS", "launcher"), "utf8"), /open -a Terminal '.*run\.sh'/);
      assert.ok(fs.existsSync(path.join(file, "Contents", "Resources", "app-icon.icns")));
    } else {
      const entry = fs.readFileSync(file, "utf8");
      assert.ok(entry.includes(`Exec="${runSh.replaceAll("\\", "\\\\\\\\")}"`));
      assert.match(entry, /^Terminal=true$/m);
    }
    assert.equal((await shortcutInfo()).exists, true);
    await createShortcut();
    if (process.platform === "darwin") {
      fs.writeFileSync(path.join(file, "Contents", "Info.plist"), "<plist>com.example.other</plist>");
      await assert.rejects(createShortcut(), /belongs to another app/);
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- Game Tuning

function sfo(values: Record<string, string>): Buffer {
  const keys = Object.keys(values), keyTable = 20 + keys.length * 16;
  const keyBytes = Buffer.from(keys.map((k) => k + "\0").join(""), "latin1");
  const dataTable = keyTable + Math.ceil(keyBytes.length / 4) * 4;
  const out = Buffer.alloc(dataTable + keys.length * 16);
  out.write("\0PSF", 0, "latin1");
  out.writeUInt32LE(keyTable, 8); out.writeUInt32LE(dataTable, 12); out.writeUInt32LE(keys.length, 16);
  let keyAt = 0;
  keys.forEach((k, i) => {
    const e = 20 + i * 16, v = values[k] + "\0";
    out.writeUInt16LE(keyAt, e); out.writeUInt16LE(0x0204, e + 2); out.writeUInt32LE(v.length, e + 4); out.writeUInt32LE(16, e + 8); out.writeUInt32LE(i * 16, e + 12);
    out.write(v, dataTable + i * 16, "utf8");
    keyAt += k.length + 1;
  });
  keyBytes.copy(out, keyTable);
  return out;
}

function record(name: string, lba: number, size: number, dir = false): Buffer {
  const n = Buffer.from(name, "latin1"), len = 33 + n.length + (n.length % 2 ? 0 : 1);
  const r = Buffer.alloc(len);
  r[0] = len; r.writeUInt32LE(lba, 2); r.writeUInt32LE(size, 10); r[25] = dir ? 2 : 0; r[32] = n.length; n.copy(r, 33);
  return r;
}

/** A tiny PSP-like ISO: PSP_GAME/PARAM.SFO and UMD_DATA.BIN, each optional. */
function pspIso({ sfoId = "", umdId = "" }): Buffer {
  const iso = Buffer.alloc(24 * 2048), S = (n: number) => n * 2048;
  iso[S(16)] = 1; iso.write("CD001", S(16) + 1, "latin1");
  iso.writeUInt32LE(18, S(16) + 158); iso.writeUInt32LE(2048, S(16) + 166);
  const root = [record("\0", 18, 2048, true), record("\x01", 18, 2048, true)];
  if (sfoId) {
    root.push(record("PSP_GAME", 19, 2048, true));
    const param = sfo({ CATEGORY: "UG", DISC_ID: sfoId, TITLE: "Test" });
    Buffer.concat([record("PARAM.SFO;1", 20, param.length)]).copy(iso, S(19));
    param.copy(iso, S(20));
  }
  if (umdId) { root.push(record("UMD_DATA.BIN;1", 21, 32)); iso.write(`${umdId}|0001|G`, S(21), "latin1"); }
  Buffer.concat(root).copy(iso, S(18));
  return iso;
}

function cso(iso: Buffer): Buffer {
  const blocks = iso.length / 2048, head = Buffer.alloc(24 + (blocks + 1) * 4);
  head.write("CISO", 0, "latin1"); head.writeUInt32LE(24, 4); head.writeBigUInt64LE(BigInt(iso.length), 8); head.writeUInt32LE(2048, 16); head[20] = 1;
  const parts: Buffer[] = [];
  let at = head.length;
  for (let b = 0; b < blocks; b++) {
    const raw = iso.subarray(b * 2048, (b + 1) * 2048), z = zlib.deflateRawSync(raw);
    const plain = z.length >= 2048;
    head.writeUInt32LE((at | (plain ? 0x80000000 : 0)) >>> 0, 24 + b * 4);
    parts.push(plain ? raw : z);
    at += plain ? 2048 : z.length;
  }
  head.writeUInt32LE(at, 24 + blocks * 4);
  return Buffer.concat([head, ...parts]);
}

const readerOf = (buf: Buffer) => async (pos: number, len: number) => buf.subarray(pos, pos + len);

test("PSP disc IDs come from PARAM.SFO, UMD_DATA.BIN, CSO and PBP files", async () => {
  assert.equal(sfoValue(sfo({ DISC_ID: "UCES00842", TITLE: "God of War" }), "TITLE"), "God of War");
  assert.equal(await discId(readerOf(pspIso({ sfoId: "UCES00842", umdId: "UCES-00842" })), "God of War.iso"), "UCES00842");
  assert.equal(await discId(readerOf(pspIso({ umdId: "ULUS-10391" })), "x.iso"), "ULUS10391");
  assert.equal(await discId(readerOf(cso(pspIso({ sfoId: "UCAS40015" }))), "Ridge Racer.cso"), "UCAS40015");
  const param = sfo({ DISC_ID: "NPEZ00045" }), pbp = Buffer.alloc(40 + param.length);
  pbp.write("\0PBP", 0, "latin1"); pbp.writeUInt32LE(40, 8); pbp.writeUInt32LE(40 + param.length, 12); param.copy(pbp, 40);
  assert.equal(await discId(readerOf(pbp), "EBOOT.PBP"), "NPEZ00045");
  assert.equal(await discId(readerOf(Buffer.alloc(40 * 2048)), "game.chd"), "");
});

test("RetroArch .opt files: keys with dashes and dots are replaced in place or added", () => {
  const text = 'mupen64plus-43screensize = "640x480"\nduckstation_GPU.Renderer = "Auto"\nother = "x"\n';
  assert.equal(parseOpt(text).get("duckstation_GPU.Renderer"), "Auto");
  const out = setOpt(text, { "mupen64plus-43screensize": "320x240", "mupen64plus-FXAA": "1" });
  assert.equal(out, 'mupen64plus-43screensize = "320x240"\nduckstation_GPU.Renderer = "Auto"\nother = "x"\nmupen64plus-FXAA = "1"\n');
});

test("PPSSPP game ini: copies the global settings and buttons, then changes only tuned keys", () => {
  const global = "[General]\nLanguage = en_US\n[Graphics]\nGraphicsBackend = 0 (OPENGL)\nInternalResolution = 2\nFrameSkip = 0\n\n[Sound]\nEnable = True\n";
  const controls = "[ControlMapping]\nUp = 10-19\nCross = 10-96\n";
  let ini = newGameIni(global, controls, "UCES00842", "God of War");
  assert.match(ini, /^; Game config for UCES00842 - God of War\n/);
  assert.doesNotMatch(ini, /GraphicsBackend/);
  ini = setIni(ini, "Graphics", "InternalResolution", "1");
  ini = setIni(ini, "Graphics", "SkipBufferEffects", "True");
  ini = setIni(ini, "CPU", "CPUSpeed", "0");
  const parsed = parsePpssppIni(ini);
  assert.equal(parsed.get("Graphics")?.get("InternalResolution"), "1");
  assert.equal(parsed.get("Graphics")?.get("SkipBufferEffects"), "True");
  assert.equal(parsed.get("Graphics")?.get("FrameSkip"), "0");
  assert.equal(parsed.get("Sound")?.get("Enable"), "True");
  assert.equal(parsed.get("CPU")?.get("CPUSpeed"), "0");
  assert.equal(parsed.get("ControlMapping")?.get("Cross"), "10-96");
  assert.equal(controlMapping("[Other]\na = 1\n"), "");
});

test("Game Tuning presets and recommendations only use offered settings and values", () => {
  for (const p of PROFILES) {
    for (const [preset, values] of Object.entries(p.presets)) {
      for (const [k, v] of Object.entries(values)) {
        const s = p.settings.find((x) => x.key === k);
        assert.ok(s, `${p.id} ${preset}: ${k} is not a setting`);
        assert.ok(s.options.some(([o]) => o === v), `${p.id} ${preset}: ${k} = ${v} is not a choice`);
      }
    }
    for (const s of p.settings) {
      assert.ok(s.options.some(([o]) => o === s.def) || p.kind === "retroarch", `${p.id}: default ${s.key} = ${s.def} is not a choice`);
      if (p.kind === "ppsspp") assert.ok(s.section, `${p.id}: ${s.key} needs an ini section`);
    }
  }
  for (const r of RECOMMENDATIONS) for (const id of r.profiles) assert.ok(PROFILES.some((p) => p.id === id), `${id} is not a profile`);
  const psp = RECOMMENDATIONS.find((r) => r.profiles.includes("ppsspp") && r.match && new RegExp(r.match, "i").test("God of War - Chains of Olympus"));
  assert.equal(psp?.preset, "speed");
});

test("cheats: RetroArch .cht files read, write and switch, keeping keys RetroArch saved", () => {
  const db = `cheats = "3"\n\ncheat0_desc = "__[>>>General<<<]__"\ncheat0_code =  "_L 0x00000000 0x00000000"\ncheat1_desc = "Use With "Skip Buffer" Setting"\ncheat1_code = "_L 0xE00173BF 0x00019860 _L 0x20019860 0x00000000"\ncheat1_enable = false\ncheat2_desc = "Lives"\ncheat2_code = "7E0DBE:63"\ncheat2_enable = true\n`;
  const cheats = parseCht(db);
  assert.equal(cheats.length, 3);
  assert.equal(cheats[0].note, true);
  assert.equal(cheats[1].desc, 'Use With "Skip Buffer" Setting');
  assert.equal(cheats[2].on, true);
  const out = writeCht(cheats.map((c, i) => ({ ...c, on: i !== 2 })));
  assert.match(out, /^cheats = 3\n/);
  assert.match(out, /cheat1_desc = "Use With 'Skip Buffer' Setting"/);
  assert.match(out, /cheat0_enable = false/);
  assert.match(out, /cheat1_enable = true/);
  assert.match(out, /cheat2_enable = false/);
  const saved = "cheats = 2\ncheat0_desc = \"A\"\ncheat0_code = \"1\"\ncheat0_handler = 1\ncheat0_enable = false\ncheat1_desc = \"B\"\ncheat1_code = \"2\"\n";
  const switched = setChtEnabled(saved, new Set([0, 1]));
  assert.match(switched, /cheat0_handler = 1/);
  assert.match(switched, /cheat0_enable = true/);
  assert.match(switched, /cheat1_enable = true/);
  assert.deepEqual(parseCht(switched).map((c) => c.on), [true, true]);
});

test("cheats: PPSSPP cheat files switch in place and are built from database entries", () => {
  const ini = "_S UCES-00842\n_G GoW CoO [EUR]\n_C0 60 FPS [Fixed]\n_L 0xE00E003C 0x10003800 // note\n_L 0x2001A388 0x0A200E01\n_C1 30 FPS\n_L 0xE00E001E 0x10003800\n_C0 ---- Notes ----\n";
  const cheats = parsePpssppCheats(ini);
  assert.deepEqual(cheats.map((c) => [c.desc, c.on, !!c.note]), [["60 FPS [Fixed]", false, false], ["30 FPS", true, false], ["---- Notes ----", false, true]]);
  assert.equal(cheats[0].code, "_L 0xE00E003C 0x10003800 _L 0x2001A388 0x0A200E01");
  const switched = setPpssppCheats(ini, new Set([0]));
  assert.match(switched, /^_C1 60 FPS \[Fixed\]$/m);
  assert.match(switched, /^_C0 30 FPS$/m);
  assert.match(switched, /\/\/ note/);
  const built = ppssppIni([{ desc: "Header", code: "_L 0x00000000 0x00000000", on: false, note: true }, { desc: "Fix", code: "_L 0xE001 0x0002 _L 0x2001 0x0000", on: true }], "UCUS98653", "God of War");
  assert.equal(built, "_S UCUS-98653\n_G God of War\n_C1 Fix\n_L 0xE001 0x0002\n_L 0x2001 0x0000\n");
});

test("cheats: RetroArch's file name and database matching", () => {
  assert.equal(retroarchName("Super Mario World (USA).sfc"), "Super Mario World (USA)");
  assert.equal(retroarchName("Super Mario Bros. 3 (USA).nes"), "Super Mario Bros");
  const files = [
    "Nintendo - Super Nintendo Entertainment System/Super Mario World (USA)",
    "Nintendo - Super Nintendo Entertainment System/Super Mario World (Europe) (Action Replay)",
    "Nintendo - Super Nintendo Entertainment System/Super Mario Kart (USA)",
    "Nintendo - Game Boy Advance/Super Mario World (USA)",
    "Sony - PlayStation Portable/God Of War - Chains Of Olympus [EU] [UCES-00842]",
    "Sony - PlayStation Portable/God Of War - Chains Of Olympus [US] [UCUS-98653]",
    "Atari - 8-bit Family/Boulder Dash (USA)",
  ];
  assert.deepEqual(cheatCandidates(files, "SFC", "Super Mario World (USA).sfc").map((c) => c.name), ["Super Mario World (USA)", "Super Mario World (Europe) (Action Replay)"]);
  assert.equal(cheatCandidates(files, "PSP", "God of War - Chains of Olympus (USA).iso", "UCES00842")[0].name, "God Of War - Chains Of Olympus [EU] [UCES-00842]");
  assert.equal(cheatCandidates(files, "A800", "Boulder Dash (USA).atr").length, 1);
  assert.equal(cheatCandidates(files, "GB", "Super Mario World (USA).gb").length, 0);
});

test("theme designer: scheme files round trip and only theme places take uploads", () => {
  const scheme = parseScheme("; comment\n[Header]\nheader_height = 42 \n[counter]\nCOUNTER_TEXT_SEPARATOR= / \nstray=1\n");
  assert.deepEqual(scheme, { header: { HEADER_HEIGHT: "42" }, counter: { COUNTER_TEXT_SEPARATOR: " / ", STRAY: "1" } });
  assert.deepEqual(parseScheme(writeScheme(scheme)), scheme);
  assert.equal(writeScheme({ empty: {}, list: { LIST_DEFAULT_RADIUS: "8" } }), "[list]\nLIST_DEFAULT_RADIUS=8\n");
  assert.equal(assetKind("640x480/image/wall/default.png"), "png");
  assert.equal(assetKind("image/bootlogo.bmp"), "bmp");
  assert.equal(assetKind("glyph/footer/a.png"), "png");
  assert.equal(assetKind("640x480/font/panel/default.bin"), "bin");
  assert.equal(assetKind("sound/navigate.wav"), "wav");
  assert.equal(assetKind(".designer/fonts/Inter.ttf"), "font");
  assert.equal(assetKind("640x480/preview.png"), "png");
  for (const bad of ["preview.png", "scheme/global.ini", "version.txt", "sound/x.mp3", "image/a/b/c/d/e.png", ".designer/x.ttf"]) {
    assert.throws(() => assetKind(bad), /not a file a theme can hold/, bad);
  }
});

test("zip: a folder packs and unpacks with empty folders, and unsafe entries are refused", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manager-zip-"));
  try {
    const src = path.join(tmp, "src");
    fs.mkdirSync(path.join(src, "640x480"), { recursive: true });
    fs.mkdirSync(path.join(src, "scheme"));
    fs.mkdirSync(path.join(src, ".designer"));
    fs.writeFileSync(path.join(src, "version.txt"), "2601.0\n");
    fs.writeFileSync(path.join(src, "scheme", "global.ini"), "[header]\nHEADER_HEIGHT=42\n".repeat(50));
    fs.writeFileSync(path.join(src, ".designer", "fonts.json"), "{}");
    const zip = path.join(tmp, "t.muxthm");
    await writeZip(zip, await folderItems(src, (rel) => rel.split("/").some((p) => p.startsWith("."))));
    assert.deepEqual((await zipNames(zip)).sort(), ["640x480/", "scheme/", "scheme/global.ini", "version.txt"]);
    const out = path.join(tmp, "out");
    await unzipTo(zip, out);
    assert.ok(fs.statSync(path.join(out, "640x480")).isDirectory());
    assert.equal(fs.readFileSync(path.join(out, "scheme", "global.ini"), "utf8"), "[header]\nHEADER_HEIGHT=42\n".repeat(50));
    const evil = path.join(tmp, "evil.zip");
    await writeZip(evil, [{ name: "../escape.txt", data: Buffer.from("x") }]);
    await assert.rejects(unzipTo(evil, path.join(tmp, "out2")));
    assert.equal(fs.existsSync(path.join(tmp, "escape.txt")), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

const discGame = (f: string, x: string): Game => ({
  t: splitName(f)[0], k: f.toLowerCase(), f, x, s: 1, m: 0, g: [], a: "", i: "", p: f, lb: "",
});

test("sheetRefs parses quoted and unquoted cue FILE lines and m3u entries", () => {
  assert.deepEqual(
    sheetRefs("cue", 'FILE "game.bin" BINARY\nFILE track02.wav WAVE\n'),
    ["game.bin", "track02.wav"],
  );
  assert.deepEqual(sheetRefs("cue", "FILE unquoted.bin BINARY"), ["unquoted.bin"]);
  assert.deepEqual(sheetRefs("ccd", 'FILE "disc.img" BINARY'), ["disc.img"]);
  assert.deepEqual(sheetRefs("m3u", "# comment\ndisc1.cue\n\ndisc2.cue\n"), ["disc1.cue", "disc2.cue"]);
  assert.deepEqual(sheetRefs("cue", ""), []);
});

test("disc layout flags orphan bins, missing cue tracks, archives, and prefers chd", async (t) => {
  const dir = tmp(t);
  const before = ctx.root;
  t.after(() => setRoot(before));
  setRoot(dir);
  fs.mkdirSync(path.join(ctx.roms, "PS"), { recursive: true });
  fs.writeFileSync(path.join(ctx.roms, "PS", "Twisted Metal.bin"), "x");
  fs.writeFileSync(path.join(ctx.roms, "PS", "Broken.cue"), 'FILE "Missing.bin" BINARY\n');
  fs.writeFileSync(path.join(ctx.roms, "PS", "Complete.cue"), 'FILE "Complete.bin" BINARY\n');
  fs.writeFileSync(path.join(ctx.roms, "PS", "Complete.bin"), "x");
  fs.writeFileSync(path.join(ctx.roms, "PS", "Good.chd"), "x");
  fs.writeFileSync(path.join(ctx.roms, "PS", "Fake.zip"), Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0]));
  fs.writeFileSync(path.join(ctx.roms, "PS", "Real.zip"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));

  const orphan = await gameDiscLayout("PS", discGame("Twisted Metal.bin", "bin"));
  assert.equal(orphan?.state, "bad");
  assert.match(orphan!.note, /\.cue/);

  const broken = await gameDiscLayout("PS", discGame("Broken.cue", "cue"));
  assert.equal(broken?.state, "bad");
  assert.match(broken!.note, /Missing track file Missing\.bin/);

  const complete = await gameDiscLayout("PS", discGame("Complete.cue", "cue"));
  assert.equal(complete?.state, "tip");
  assert.equal(complete?.fixable, true);

  const chd = await gameDiscLayout("PS", discGame("Good.chd", "chd"));
  assert.equal(chd?.state, "ok");

  const misnamed = await gameDiscLayout("PS", discGame("Fake.zip", "zip"));
  assert.equal(misnamed?.state, "bad");
  assert.equal(misnamed?.archive, "7z");
  assert.equal(misnamed?.fixable, true);

  const realZip = await gameDiscLayout("PS", discGame("Real.zip", "zip"));
  assert.equal(realZip?.state, "bad");
  assert.equal(realZip?.archive, "zip");
  assert.equal(realZip?.fixable, true);

  assert.equal(await gameDiscLayout("GB", discGame("Tetris.gb", "gb")), null);
});

test("fixBiosNames renames a wrong-case BIOS file to the catalogue path", async (t) => {
  const dir = tmp(t);
  const before = ctx.root;
  t.after(() => setRoot(before));
  setRoot(dir);
  fs.mkdirSync(ctx.bios, { recursive: true });
  fs.writeFileSync(path.join(ctx.bios, "SCPH1001.BIN"), "ps1-bios");
  const catalog = {
    fetched: 0,
    version: "test",
    systems: [],
    files: {
      "scph1001.bin": { path: "scph1001.bin", md5s: [] as string[], desc: "" },
    },
  };
  const result = await fixBiosNames(catalog);
  assert.deepEqual(result.fixed, [{ from: "SCPH1001.BIN", to: "scph1001.bin" }]);
  assert.equal(result.skipped.length, 0);
  assert.deepEqual(fs.readdirSync(ctx.bios), ["scph1001.bin"]);
});

test("sniffArchive and classifyMembers for PlayStation fix plans", () => {
  assert.equal(sniffArchive(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])), "zip");
  assert.equal(sniffArchive(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0])), "7z");
  assert.equal(sniffArchive(Buffer.from([0x52, 0x61, 0x72, 0x21, 0, 0, 0, 0])), "rar");
  assert.equal(sniffArchive(Buffer.from([0, 1, 2, 3])), "");
  assert.equal(classifyMembers(["Game.chd"]).kind, "readyChd");
  assert.equal(classifyMembers(["Game.pbp"]).kind, "readyPbp");
  assert.equal(classifyMembers(["Game.cue", "Game.bin"]).kind, "cueSet");
  assert.equal(classifyMembers(["Disc1.cue", "Disc1.bin", "Disc2.cue", "Disc2.bin"]).kind, "cueSet");
  assert.equal(classifyMembers(["Game.bin"]).kind, "orphanBin");
  assert.equal(classifyMembers(["readme.txt"]).kind, "unsupported");
  assert.equal(classifyMembers([]).kind, "empty");
  assert.equal(classifyMembers(["__MACOSX/._Game.bin", "Game.chd"]).kind, "readyChd");
  assert.equal(
    relAfterFlatten("Twisted Metal 2 (USA)/Twisted Metal 2 (USA).cue", "Twisted Metal 2 (USA)"),
    "Twisted Metal 2 (USA).cue",
  );
  assert.equal(relAfterFlatten("Game.cue", ""), "Game.cue");
  assert.equal(relAfterFlatten("Game.cue", "Folder"), "Game.cue");
});

test("CHD helpers: eligibility, trash file set, install help, and chdman probe shape", async () => {
  assert.equal(isChdConvertible({ x: "cue", state: "tip" }), true);
  assert.equal(isChdConvertible({ x: "m3u", state: "tip" }), true);
  assert.equal(isChdConvertible({ x: "cue", state: "bad" }), false);
  assert.equal(isChdConvertible({ x: "bin", state: "tip" }), false);
  assert.equal(isChdConvertible({ x: "chd", state: "ok" }), false);
  assert.deepEqual(
    trashBasenamesForSheet("cue", "Game.cue", 'FILE "Game.bin" BINARY\nFILE "track2.bin" BINARY\n').sort(),
    ["Game.bin", "Game.cue", "track2.bin"].sort(),
  );
  assert.deepEqual(
    convertibleFromDisc([
      { f: "A.cue", p: "A.cue", t: "A", x: "cue", state: "tip", note: "" },
      { f: "B.bin", p: "B.bin", t: "B", x: "bin", state: "bad", note: "" },
    ]).map((g) => g.f),
    ["A.cue"],
  );
  const help = chdInstallHelp();
  assert.ok(help.steps.length >= 2);
  assert.ok(help.os);
  const tool = await probeChdman();
  assert.equal(typeof tool.present, "boolean");
  assert.equal(typeof tool.path, "string");
  assert.equal(typeof tool.version, "string");
});

test("parseInputDevices finds stick event nodes", () => {
  const text = `I: Bus=0000 Vendor=0001 Product=0001 Version=0001
N: Name="muOS Gamepad"
P: Phys=
S: Sysfs=/devices/virtual/input/input0
U: Uniq=
H: Handlers=event0 js0
B: PROP=0
B: EV=b
B: KEY=7fff0000 0 0 0 0
B: ABS=3
`;
  const list = parseInputDevices(text);
  assert.equal(list.length, 1);
  assert.equal(list[0].path, "/dev/input/event0");
  assert.deepEqual(list[0].abs, [0, 1]);
  assert.equal(list[0].role, "mixed");
  assert.ok(list[0].score > 0);
});

test("parseInputDevices prefers gamepad over muOS-Keys for sticks", () => {
  const text = `I: Bus=0000 Vendor=0001 Product=0001 Version=0001
N: Name="muOS-Keys"
P: Phys=
S: Sysfs=/devices/virtual/input/input1
U: Uniq=
H: Handlers=event1
B: PROP=0
B: EV=3
B: KEY=1fffff ffffffff ffffffff ffffffff

I: Bus=0000 Vendor=0001 Product=0002 Version=0001
N: Name="muOS Gamepad"
P: Phys=
S: Sysfs=/devices/virtual/input/input0
U: Uniq=
H: Handlers=event0 js0
B: PROP=0
B: EV=b
B: KEY=7fff0000 0 0 0 0
B: ABS=1b
`;
  const list = parseInputDevices(text);
  const stick = pickStickDevice(list);
  const buttons = pickButtonDevice(list, stick);
  assert.equal(stick?.path, "/dev/input/event0");
  assert.equal(stick?.name, "muOS Gamepad");
  assert.ok(buttons);
  assert.notEqual(list[0]?.name, "muOS-Keys");
});
