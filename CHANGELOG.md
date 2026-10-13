# Changelog

All notable changes to muOS Anbernic Manager. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow the policy in [CONTRIBUTING.md](CONTRIBUTING.md#versions): minor releases for new features,
patch releases for fixes, major releases only for big or breaking changes.

Running managers offer an update when the `VERSION` file on GitHub's `main` branch is higher than theirs. Changes under
**Unreleased** are already on `main` (a `git pull` or a fresh download gets them) and are offered as an update with the
next version number.

## Version history

| Version | Date | Highlights |
| --- | --- | --- |
| [Unreleased](#unreleased) | | |
| [1.1.0](#110---2026-10-13) | 2026-10-13 | Game Tuning, game viewer with handheld status and tabs, Emulation Systems tab, app market, Windows installer, factory reset, AGPL license |
| [1.0.0](#100---2026-10-13) | 2026-10-13 | First public release |

## [Unreleased]

## [1.1.0] - 2026-10-13

### Added

- **Game Tuning** (Handheld group): per-game emulator settings for speed and looks, saved on the handheld over SSH.
  - Pick a system from a list you filter by typing, search its games, and see which emulator starts the game (its own
    core or its folder's) and what it can change.
  - Standalone PPSSPP (a `<disc ID>_ppsspp.ini`, with the disc ID read from ISO, CSO and PBP files, or typed for CHD),
    and the PPSSPP, Mupen64Plus-Next, PCSX-ReARMed, SwanStation, DuckStation and Flycast RetroArch cores (a
    `<game>.opt`). Settings missing from the handheld's core version are hidden.
  - Every game can get its own CPU governor, the same `<game>.gov` the handheld's per-game option writes.
  - Fastest, Balanced and Best looking presets, plus recommendations for known heavy and light games, with what each
    setting costs or gains.
  - The game's file starts from what it used before (PPSSPP's button mapping included), so only changed settings
    differ. **Back to folder settings** removes it again.
  - New API routes `GET /api/tuning`, `GET /api/tuning/game`, `POST /api/tuning/save` and `POST /api/tuning/reset`.
- **Game viewer**: the big game view is redesigned around status cards and tabs.
  - Tags for the library check (Verified, Bad dump, Modified), a missing BIOS, other versions in the library and MAME
    clones, next to the year, genres, players and rating.
  - With the handheld connected, cards show whether the game is on it, the core it starts with, play time and saves.
    When the game's folder has no system on the handheld, the card offers a one-click fix (for example Arcade for CPS3).
  - **About**: description with its source, an inline editor for your own description, and the game's YouTube video.
  - **Details**: database facts, file size, date, CRC32 and path, the library check result, the BIOS files the system
    needs, and the arcade parent or clone set (with a note when a clone's parent zip is missing).
  - **Handheld**: core and how it was chosen, play history (total, launches, average session, first and last played,
    cores used), collections and save files.
  - **Related**: other versions, the arcade family, the same series, more from the developer and more of the genre,
    with a Back link.
  - Replace the artwork by dropping an image on it, and **Show in Finder** (Explorer on Windows) for the ROM.
  - New API routes `GET /api/game` and `POST /api/game/reveal`.
- **Emulation > Systems**: every library system with its status on the handheld. Folders in **Cores** that MustardOS
  has no system for now explain why (their games run under another system, need a newer MustardOS with extra cores, or
  have no core), and the editor preselects the recommended system and core.
- **App market** on the Apps page: popular MustardOS apps with screenshots, release notes and stars. The package that
  fits your handheld and MustardOS version is picked from GitHub's release feeds; **Get** downloads it into `apps/`.
- **Windows installer**: `installer.cmd` and `run.cmd` do what `installer.sh` and `run.sh` do, including installing
  Node.js with winget and restarting after updates.
- **App shortcuts** with the manager's icon in Applications (macOS), the Start menu (Windows) or the app menu (Linux),
  from the installers, the setup wizard or Settings.
- **Settings > Factory reset**: moves the workspace folders and the manager's cache to the Trash, creates empty folders
  and restarts into the setup wizard. You have to type RESET first, and the handheld is not touched.
- **Settings > History and resets**: clear the activity log and view preferences on this computer, or the play time and
  recently played list on the handheld. The cache panel can also clear online catalogues and ROM check results.
- Recovery steps for a handheld that is not found over USB, in the connection panel, the wiki and the README.
- Contributor guides: `AGENTS.md`, `CONTRIBUTING.md`, `docs/architecture.md`, and Cursor rules and skills.
- This changelog. **What's new** in the Manager updates dialog opens it.

### Changed

- The license is now the GNU Affero General Public License v3.0 or later. Version 1.0.0 and earlier stay available
  under MIT.
- The app market lists the manager itself first, and **Send** is hidden for apps already installed on the handheld.
- Confirm dialogs scroll when they are taller than the window.

### Fixed

- Settings are checked before any are applied, and saved atomically.
- SSH commands retry cleanly and can be cancelled; SFTP uploads use an atomic rename.
- Save backups fail on archive errors instead of saving a partial file; BIOS uploads stay inside the BIOS folder.
- A library rescan requested during a scan runs again afterwards; symbolic links are skipped.
- Moves to the Trash pick free names and work across disks.
- Device listings include hidden folders where deletes need them.
- Late answers from the server no longer overwrite a newer view, and scroll positions survive redraws.
- The game viewer updates when the handheld connects or disconnects while it is open.
- Accessibility: announced notifications, labelled dialogs and inputs, pressed states on toggle buttons, visible
  keyboard focus.
- Loading and error states in the app market and PortMaster have proper spacing.

## [1.0.0] - 2026-10-13

First public release, licensed under MIT.

### Added

- **Games**: the `Roms/` library by system, with search, filters (artwork, genre, rating, year), grid and list views,
  drag-and-drop adding, transfer to the handheld, what is on the device, duplicate finder and delete.
- **Artwork**: box art, screenshots and descriptions from libretro thumbnails and the LaunchBox Games Database, sized
  for the handheld's screen, with sync to the device.
- **Play**: play time, recently played games and collections from the handheld.
- **ScummVM and ports**: ScummVM games with their data folders, free classic adventures with one-click download, and
  the PortMaster catalogue with install and uninstall over Wi-Fi.
- **Apps**: install `.muxapp` apps and `.muxupd` updates, and check for new MustardOS releases.
- **Device Settings**: MustardOS settings (display, audio, network, interface and more) changed from the computer.
- **Themes**: the community theme library filtered for the screen, with previews, install and apply.
- **Emulation**: saves and save states backup and restore, BIOS check, cores per system or game, RetroArch options and
  a library health check against the No-Intro lists.
- **Files**: this computer and the handheld side by side, with copy, rename, delete, preview and editing.
- **System Tools**: install MustardOS on an SD card, set up a games card (TF2), or wipe a card.
- **SSH**: a terminal on the handheld in the browser.
- **Wiki**: help for every page, a glossary and troubleshooting.
- Every MustardOS handheld (13 Anbernic and TrimUI models), detected over USB and Wi-Fi, with a per-card model for card
  readers.
- Card reader, USB (MTP) and Wi-Fi (SFTP and SSH) connections.
- `installer.sh` and a first-run setup wizard for the handheld, folders, connection and game data.
- Update check against GitHub and one-click **Update now** for git clones and downloaded copies.

### Notes

- While it was being prepared, the release briefly carried the number 2.1.0 before it was set to 1.0.0. A copy
  downloaded in that window reports 2.1.0 and will not offer updates until a version above 2.1.0 is out; update it
  with `git pull` or a fresh download.

[Unreleased]: https://github.com/aaronns87/muos-anbernic-manager/compare/v1.1.0...main
[1.1.0]: https://github.com/aaronns87/muos-anbernic-manager/tree/v1.1.0
[1.0.0]: https://github.com/aaronns87/muos-anbernic-manager/tree/bc43b5c
