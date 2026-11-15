---
name: muos-device-expert
description: Explains how the manager reaches MustardOS handhelds (card reader, USB/MTP, Wi-Fi SFTP+SSH), the muOS folder layout and the device code layer (Target, DeviceFs, runCommand). Use when working on anything that reads or writes the handheld or its SD cards, adds a handheld model, or touches src/device/, src/system/ or muOS paths.
---

# MustardOS device expert

## Three ways in

| Mode (`TargetInfo.mode`) | Volume id | Code | Notes |
| --- | --- | --- | --- |
| `card` | card id from `findCards()` | `CardFs` (`src/device/fs.ts`) on the mounted card | local paths, fast, full compare |
| `usb` | `"usb"` | `MtpFs` + `Session` (`src/device/mtp.ts`, libmtp via `koffi`) | no rename, compares by size only |
| `wifi` | `"wifi"` (`WIFI_ID`) | `SftpFs` (`src/device/sftp.ts`, SFTPGo on port 2022) | plus SSH (`src/device/ssh.ts`, port 22) |

Default logins on muOS: SFTP `muos`/`muos`, SSH `root`/`root`. They are saved per user in `.cache/` (never
commit, never print).

## Code layer

```ts
import { withTarget, art } from "./device/target.ts";

await withTarget(volume, async (t) => {
  const games = await t.roms.list(["ROMS", "GB"]);   // DeviceFs: path parts below the storage root
  const catalogue = art(t);                          // preferred artwork storage or null
  for (const [label, fs] of t.all) { /* "TF2", "SD1" */ }
});
```

- `DeviceFs`: `list`, `hasDir`, `entry`, `get`, `put(src, parts, progress)`, `delete`, `mkdir`, `removeDir`,
  optional `rename` (absent over USB) and `localPath` (cards only). `remote` is true for USB and Wi-Fi.
- Shell on the handheld: `runCommand(cmd, timeoutMs)` returns `{ out, err, code }`; `streamCommand` for long
  output. Quote everything you interpolate (`'` -> `'\''`). Requires Wi-Fi mode and SSH enabled.
- Model detection: `src/device/model.ts`; the device list (board ids, slots, screen, chip, arch) is
  `public/js/devices.js`, shared with the browser. A new handheld is an entry in `DEVICES` there.

## MustardOS layout

- SD1 (system card) mounts at `/mnt/mmc`; TF2 (SD2, games card) at `/mnt/sdcard`. One-slot models keep
  everything on SD1.
- Games: `ROMS/<SYSTEM>/` on TF2, else SD1. Hidden folders (`.name`) hold data for folder-based games.
- Artwork: `MUOS/info/catalogue/<Catalogue>/{box,preview,splash}/<rom stem>.png` (`CATALOGUE_PATH`), read from
  TF2 if it has that folder, else SD1. Catalogue names per ROM folder: `CATALOGUES` in `src/catalogue.ts`.
- Play data on SD1: `MUOS/info/track/playtime_data.json`, `MUOS/info/history/`, `MUOS/info/collection/`.
- Settings: one value per file under `/opt/muos/config/...` (`src/device/muos-settings.ts`). Core per system or
  game: `/opt/muos/share/info/content`.
- Saves and BIOS: `/run/muos/storage/save`, `/run/muos/storage/bios`. Themes: `MUOS/theme/` on SD1.
- Packages (`.muxapp`, `.muxupd`, themes) are copied to `ARCHIVE/` and installed with muOS's archive script over
  SSH. Ports use the handheld's PortMaster.
- Board name: `/opt/muos/device/config/board/name`.

## Safety (always)

- Writes only from an explicit user action; device deletes are permanent, so confirm first.
- Agents must not write to the user's real handheld or cards to test. Read-only listing is fine.
- `src/system/` install accepts only whole external removable disks; never relax that. Set up TF2 and Reset card may also
  run over SSH (`system/tf2-wifi.ts`) against `/mnt/sdcard` only - never `/mnt/mmc` / SD1. Reset over Wi-Fi leaves an
  empty FAT32 or exFAT volume with the chosen name; Set up TF2 always uses exFAT named TF2 and creates the ROMS folders.
- Every write logs with `say(...)` so it shows in the activity log.

## Before changing device code

1. Read the file's header comment and the matching section of `docs/architecture.md`.
2. Keep all three modes working, or give a clear `UserError` naming the mode that is needed
   (for example "Connect over Wi-Fi with SSH turned on to ...").
3. Test with `--tf2-dir` (a folder standing in for TF2) on a temp server; see the `manager-testing` skill.
