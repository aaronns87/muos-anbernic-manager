// Library checks: No-Intro DAT parsing, CRCs from zips and loose files, verdicts, and duplicate ranking.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import zlib from "node:zlib";
import { altCrc, groupKey, hashRom, judge, parseDat, rank, regionsOf, PREFER } from "../src/checks.ts";

const hex = (b: Buffer) => zlib.crc32(b).toString(16).toUpperCase().padStart(8, "0");

/** A zip with stored or deflated entries, enough for the central-directory reader. */
function zip(entries: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name), body = e.deflate ? zlib.deflateRawSync(e.data) : e.data, crc = zlib.crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(e.data.length, 22); local.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(e.deflate ? 8 : 0, 10);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(e.data.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    central.push(cd, name);
    offset += 30 + name.length + body.length;
  }
  const cdBuf = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}

const DAT = `clrmamepro (
\tname "Nintendo - Game Boy"
\tversion "2026.10.07"
)

game (
\tname "Tetris (World) (Rev 1)"
\tregion "World"
\trom ( name "Tetris (World) (Rev 1).gb" size 32768 crc 46DF91AD md5 0 sha1 0 )
)
game (
\tname "Tetris (Japan) (En)"
\trom ( name "Tetris (Japan) (En).gb" size 32768 crc AABBCCDD md5 0 sha1 0 )
)
game (
\tname "Tetris (World)"
\trom ( name "Tetris (World).gb" size 32768 crc 63F9407D md5 0 sha1 0 )
)
`;

test("parseDat indexes CRCs and every game per title", () => {
  const dat = parseDat(DAT, "Nintendo - Game Boy");
  assert.equal(dat.version, "2026.10.07");
  assert.deepEqual(dat.crc["46DF91AD"], ["Tetris (World) (Rev 1)", 32768]);
  assert.deepEqual(dat.titles.tetris, ["Tetris (World) (Rev 1)", "Tetris (Japan) (En)", "Tetris (World)"]);
});

test("judge: verified, renamed, bad with size hint, translation, unknown, unchecked", () => {
  const dat = parseDat(DAT);
  const g = (f: string, tags: string[] = []) => ({ f, t: f.replace(/ \(.*$|\.\w+$/g, ""), g: tags });
  assert.deepEqual(judge(g("Tetris (World).gb", ["World"]), { e: [["x", 32768, "63F9407D"]] }, [dat]), { f: "Tetris (World).gb", state: "ok" });
  assert.equal(judge(g("Tetris.gb"), { e: [["x", 32768, "46DF91AD"]] }, [dat]).as, "Tetris (World) (Rev 1)");
  const bad = judge(g("Tetris (Japan).gb", ["Japan"]), { e: [["x", 16384, "12345678"]] }, [dat]);
  assert.equal(bad.state, "bad");
  assert.equal(bad.like, "Tetris (Japan) (En)", "the same-region entry is the one compared");
  assert.match(bad.note ?? "", /underdump/);
  assert.equal(judge(g("Tetris (World).gb", ["World", "T+Eng"]), { e: [["x", 1, "00000000"]] }, [dat]).state, "modified");
  assert.equal(judge(g("Tetris (World).gb", ["World", "T"]), { e: [["x", 1, "00000000"]] }, [dat]).state, "modified");
  assert.equal(judge(g("Dr. Mario (World).gb"), { e: [["x", 1, "00000000"]] }, [dat]).state, "unknown");
  assert.equal(judge(g("Tetris.7z"), { e: [], u: "7z archives can't be checked" }, [dat]).state, "unchecked");
});

test("altCrc removes SNES copier headers and fixes N64 byte order", () => {
  const body = Buffer.alloc(1024 * 4, 0x5a);
  assert.equal(altCrc("SFC", Buffer.concat([Buffer.alloc(512), body])), hex(body));
  assert.equal(altCrc("SFC", body), undefined);
  const z64 = Buffer.concat([Buffer.from([0x80, 0x37, 0x12, 0x40]), Buffer.from("abcdefghijkl")]);
  assert.equal(altCrc("N64", Buffer.from(z64).swap16()), hex(z64));
  assert.equal(altCrc("N64", Buffer.from(z64).swap32()), hex(z64));
  assert.equal(altCrc("N64", z64), undefined);
});

test("hashRom reads CRCs from zips (stored and deflated) and loose files", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manager-checks-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const a = Buffer.from("game boy rom ".repeat(100)), b = Buffer.from("readme");
  const zfile = path.join(dir, "Game.zip");
  fs.writeFileSync(zfile, zip([{ name: "Game.gb", data: a, deflate: true }, { name: "readme.txt", data: b }]));
  const zh = await hashRom("GB", zfile, fs.statSync(zfile).size);
  assert.deepEqual(zh.e, [["Game.gb", a.length, hex(a)], ["readme.txt", b.length, hex(b)]]);

  const z64 = Buffer.concat([Buffer.from([0x80, 0x37, 0x12, 0x40]), Buffer.alloc(1020, 7)]);
  const nfile = path.join(dir, "Mario.zip");
  fs.writeFileSync(nfile, zip([{ name: "Mario.v64", data: Buffer.from(z64).swap16(), deflate: true }]));
  const nh = await hashRom("N64", nfile, fs.statSync(nfile).size);
  assert.equal(nh.e[0][3], hex(z64), "byte-swapped N64 ROM inside a zip gets its .z64 CRC");

  const loose = path.join(dir, "Zelda.sfc");
  const body = Buffer.alloc(2048, 1);
  fs.writeFileSync(loose, Buffer.concat([Buffer.alloc(512, 9), body]));
  const lh = await hashRom("SFC", loose, 2560);
  assert.equal(lh.e[0][3], hex(body));

  const seven = path.join(dir, "Game.7z");
  fs.writeFileSync(seven, "7z");
  assert.match((await hashRom("GB", seven, 2)).u ?? "", /7z/);
  const broken = path.join(dir, "Broken.zip");
  fs.writeFileSync(broken, "not a zip at all");
  assert.match((await hashRom("GB", broken, 16)).u ?? "", /damaged/);
});

test("regionsOf reads No-Intro and GoodTools tags without false hits", () => {
  assert.deepEqual(regionsOf(["USA, Europe"]), ["USA", "Europe"]);
  assert.deepEqual(regionsOf(["JUE"]), ["Japan", "USA", "Europe"]);
  assert.deepEqual(regionsOf(["SGB Enhanced", "32X", "En,Fr"]), []);
});

test("rank prefers good dumps, then region, then the newest revision", () => {
  const cmp = (x: number[], y: number[]) => { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
  const pick = (options: string[][], prefer = PREFER.usa) => options.reduce((a, b) => (cmp(rank(b, prefer, false), rank(a, prefer, false)) ? b : a));
  assert.deepEqual(pick([["Japan"], ["USA"], ["Europe"]]), ["USA"]);
  assert.deepEqual(pick([["Japan"], ["USA"], ["Europe"]], PREFER.europe), ["Europe"]);
  assert.deepEqual(pick([["USA", "Beta"], ["Japan"]]), ["Japan"]);
  assert.deepEqual(pick([["USA"], ["USA", "Rev 2"], ["USA", "Rev 1"]]), ["USA", "Rev 2"]);
  assert.deepEqual(pick([["Japan"], ["Japan", "Translated En"]]), ["Japan", "Translated En"]);
  assert.deepEqual(pick([["Japan"], ["Japan", "Translated En"]], PREFER.japan), ["Japan"]);
  assert.deepEqual(pick([["USA", "b"], ["Europe"]]), ["Europe"]);
});

test("groupKey joins versions of one game and keeps different games apart", () => {
  const k = (t: string, g: string[]) => groupKey({ t, g });
  assert.equal(k("Sonic", ["USA"]), k("Sonic", ["Japan", "Rev 1"]));
  assert.equal(k("After Burner", ["32X", "J"]), k("After Burner", ["32X", "U"]));
  assert.notEqual(k("Spider-Man", ["USA", "Acclaim"]), k("Spider-Man", ["World", "Sega"]));
  assert.notEqual(k("Skeleton+", ["USA"]), k("Skeleton", ["USA"]));
  assert.notEqual(k("Final Fantasy VII", ["USA", "Disc 1"]), k("Final Fantasy VII", ["USA", "Disc 2"]));
});
