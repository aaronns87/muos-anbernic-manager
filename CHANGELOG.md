# Changelog

All notable changes to muOS Anbernic Manager. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow the policy in [CONTRIBUTING.md](CONTRIBUTING.md#versions): minor releases for new features,
patch releases for fixes, major releases only for big or breaking changes.

Running managers offer an update when the `VERSION` file on GitHub's `main` branch is higher than theirs. Changes under
**Unreleased** are on the `changes/unreleased` branch and reach `main`, and with it running managers, in the next
version.

## Version history

| Version | Date | Highlights |
| --- | --- | --- |
| [Unreleased](#unreleased) | | Transfers panel with a queue and history |
| [1.2.1](#121---2026-10-14) | 2026-10-14 | Filterable dropdowns that line up with their field, full-width new theme form |
| [1.2.0](#120---2026-10-14) | 2026-10-14 | Theme Designer, cheats per game in Game Tuning |
| [1.1.0](#110---2026-10-13) | 2026-10-13 | Game Tuning, game viewer with handheld status and tabs, Emulation Systems tab, app market, Windows installer, factory reset, AGPL license |
| [1.0.0](#100---2026-10-13) | 2026-10-13 | First public release |

## [Unreleased]

### Added

- **Transfers panel** in the bottom-right corner instead of the progress bar at the bottom: the running copy with its
  progress, speed, time left and current file, the copies waiting their turn, and a history of finished ones with size,
  duration, speed and any failed files. It can be minimised to a thin progress bar, hidden and reopened from the top bar,
  and the history is kept between restarts until you clear it. A copy of several games or files lists each one with its
  own progress while it runs, and its size, time and speed (or the reason it failed) once it is done.

### Changed

- **Copies queue up.** Starting a game, file or app copy while another one runs adds it to the queue instead of refusing
  it, and the transfer dialog says **Queue** instead of **Transfer**. Games already waiting are not queued twice, and the
  free space check counts what the queue will still write. Over USB the handheld still takes one copy at a time.

## [1.2.1] - 2026-10-14

### Fixed

- Long dropdowns filter as you type in one consistent menu that lines up under its field and never gets cut off: the
  library theme picker in Themes > Designer, the game field and System in Emulation > Cores, System in Artwork >
  Scrape and the genre filter in Games. Arrow keys, Enter and Escape work as in other menus.
- The Theme Designer's new theme form uses the full width of the page, and picking a library theme no longer renames
  the new theme on every keystroke.

## [1.2.0] - 2026-10-14

### Added

- **Cheats** in Game Tuning: pick cheats for a game and save them on the handheld, switched on when the game starts.
  - RetroArch cores get cheats from the libretro cheat database, matched by the game's name (several cheat devices to
    choose from where the database has them), saved as `cheats/<core>/<game>.cht`.
  - Standalone PPSSPP shows the cheat files MustardOS ships (`PSP/Cheats/<disc ID>.ini`, such as 60 FPS patches) and
    switches cheats on and off in them; for games without one, the libretro database's file is matched by disc ID.
  - When RetroArch's **Apply cheats after game load** or PPSSPP's cheats are off on the handheld, saving can turn them on.
  - New API routes `GET /api/cheats/game`, `GET /api/cheats/file`, `POST /api/cheats/save` and `POST /api/cheats/remove`.
- **Theme Designer**, the third tab in Themes: make MustardOS themes on this computer with a live preview.
  - A canvas preview of the main menu (list or grid), Explore, Configuration, a settings list, pop-ups, the keyboard,
    the passcode wheel, the charging screen and the boot logo, drawn from the theme's settings, pictures and fonts at
    each screen size and colour variant. Clicking a part opens its settings.
  - Quick style: eight palettes, six colour roles, roundness, items per page, bar heights and a list or grid main menu.
  - Every scheme setting MustardOS reads, in groups with readable names, colour and opacity side by side, search,
    undo and redo, and autosave. Changes go to the whole theme, one screen size, one screen or a colour variant,
    following MustardOS's scheme layers, with notes where a more specific file wins.
  - Pictures (wallpapers per screen and per main menu item, boot and charging logos, overlay, preview pictures),
    icon folders and grid pictures, fonts converted from TTF/OTF/WOFF with `lv_font_conv`, sounds, display name,
    credits, MustardOS version, screen sizes and colour variants.
  - New themes start fresh with a palette, or from a library theme, a theme on the handheld, a local theme or a
    `.muxthm` file. Export as `.muxthm`, or install and apply over Wi-Fi; missing preview pictures are drawn first.
  - A new **themes** workspace folder, shown in Settings, the setup wizard, the installer and the factory reset.
  - New API routes `GET /api/designer` (the list) and under `/api/designer/`: theme, file, create, import, scheme,
    meta, resolution, variant, upload, remove-file, font, rename, duplicate, delete, reveal, package and install.

### Changed

- The Themes tabs show how many themes are on the handheld and how many you have designed.
- `--init`, the installer and the setup wizard create the `themes/` folder with the other workspace folders, and
  Settings counts the themes in it and lets you move it like the others.

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

[Unreleased]: https://github.com/aaronns87/muos-anbernic-manager/compare/v1.2.1...main
[1.2.1]: https://github.com/aaronns87/muos-anbernic-manager/tree/v1.2.1
[1.2.0]: https://github.com/aaronns87/muos-anbernic-manager/tree/v1.2.0
[1.1.0]: https://github.com/aaronns87/muos-anbernic-manager/tree/v1.1.0
[1.0.0]: https://github.com/aaronns87/muos-anbernic-manager/tree/v1.0.0
