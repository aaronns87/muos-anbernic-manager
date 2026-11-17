<div align="center">

<img src="public/assets/favicon.svg" width="96" alt="muOS Anbernic Manager logo">

# muOS Anbernic Manager

**Your games, artwork, apps, themes and handheld settings for MustardOS, managed from a browser tab on your computer.**

[![Node.js 23.6+](https://img.shields.io/badge/node-23.6%2B-3c873a?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-555)](#requirements)
[![MustardOS](https://img.shields.io/badge/for-MustardOS-e3b341)](https://muos.dev/)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

<img src="docs/screenshots/games.jpg" width="100%" alt="The game library: every system in Roms/ with box art, filters and one-click transfer to the handheld">

</div>

The manager runs on your Mac, Linux or Windows computer and looks after an Anbernic or TrimUI handheld running
[MustardOS (muOS)](https://muos.dev/). It keeps your `Roms/` library tidy with box art and descriptions, copies games to the
handheld over a card reader, USB or Wi-Fi, installs apps, themes and PortMaster ports, and changes the handheld's own settings,
without editing files by hand or remembering where MustardOS keeps things.

Everything happens locally: the manager is a small Node.js server with a web interface on `127.0.0.1`, protected by a
per-session token. Nothing is uploaded anywhere.

## Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Supported handhelds](#supported-handhelds)
- [Requirements](#requirements)
- [Installation](#installation): [macOS and Linux](#macos-and-linux), [Windows](#windows), [App shortcut](#app-shortcut)
- [Connecting the handheld](#connecting-the-handheld)
- [Usage](#usage)
- [Safety](#safety)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Changelog](CHANGELOG.md)
- [Credits](#credits)
- [License](#license)

## Features

**Library**
- **Games**: browse the whole `Roms/` library by system, with search, filters (artwork, genre, rating, year), **favourites**
  and **smart lists** (never copied, no art, bad dump, needs tuning, on device only) and grid or list views.
  Add games by drag and drop, copy them to the handheld, see what is on the device and what is missing, and remove games.
  **Update handheld…** plans scrape, artwork sync and copying games that are not on the device yet.
  **Free & homebrew** (under Add games) downloads curated legal freeware into the right `Roms/` system folder.
  **Play in browser** on light systems (GB, GBC, GBA, NES/FC, SNES/SFC, SMS, GG, Mega Drive, Neo Geo Pocket, WonderSwan, PC Engine)
  opens EmulatorJS in a modal; cores load from the EmulatorJS CDN on first use (needs network once; browser caches them).
  Session keyboard remapping only — no save sync with the handheld yet.
- **Game view**: each game's box art, description, video and database facts, its library check and BIOS needs, and,
  with the handheld connected, whether it is on it, the core it starts with, play time, collections and saves (with
  per-game pull, push, delete and prune). Related games (other versions, series, developer, genre) are one click away.
  You can write your own description, drop in new artwork, or **rename the ROM file** from Details (matching artwork and
  descriptions rename with it). **Play in browser** appears for the same light systems as on the game cards.
- **Artwork**: fetch box art, screenshots and descriptions for every game (libretro thumbnails, LaunchBox Games Database),
  in the size your handheld's screen needs, and sync them to the device.
- **OS**: local MustardOS release folders under `os/mustardos_<version>/`, add or remove images, release notes, and
  **OS market** for official downloads (GoFile/Mega/Filen open in the browser). **Install** opens System Tools with that image.
- **Play**: play time, recently played games and collections from the handheld.
- **ScummVM and ports**: ScummVM games with their data folders, a list of classic adventures released for free with
  one-click download, and the PortMaster catalogue with install and uninstall over Wi-Fi.

**Handheld**
- **Connection**: Wi-Fi setup as **Handheld on this network** (status, sign-in details, Save and connect, Find on network),
  named **device profiles**, web services status with **Open Syncthing** when reachable, and an optional wait until
  Syncthing is idle before large copies. Overview **Since last connect** summarises what changed since the last live link.
- **Apps**: an app market of popular MustardOS apps and packages (including Void Desk, Dolphin Rt:Core and MustardTube) with
  screenshots and release notes, picking the package for your handheld and MustardOS release; install `.muxapp` apps
  and `.muxupd` updates, and check for new MustardOS releases.
- **Device**: change MustardOS settings from the computer (Jacaranda and Andromeda catalogues when those configs exist),
  calibrate analogs and watch live sticks (Controls), and run connectivity, storage and short CPU benchmarks over SSH.
- **Themes**: browse the community theme library filtered for your screen, preview themes, install and apply them.
  The **Designer** makes your own themes with a live preview of the handheld's screens: palettes and colours, layout,
  grid menus, pictures, icons, fonts (converted from TTF/OTF) and sounds, every scheme setting MustardOS reads, colour
  variants and screen sizes. Themes are kept in the `themes/` folder; export them as `.muxthm` or install and apply them.
  Failed autosaves keep your edits in the editor with **Retry**; switching themes, exporting and installing wait until they save.
- **Emulation**: back up and restore saves and save states (including Andromeda **`.muxbak`** device backups in
  `ARCHIVE` when `backup.sh` is present, plus a per-game **save browser**), check BIOS files in the workspace `bios/`
  folder (**Fix names** corrects casing like `SCPH5501.BIN` → `scph5501.bin`), choose emulator cores per system or game
  (Andromeda reads `info/manifest/core.json`; Jacaranda used `info/assign`), edit RetroArch picture/play and Menu+X
  **core options** per folder, and run a health check of your library (verify dumps, duplicates, and PlayStation
  **disc layouts** for orphaned `.bin` / broken `.cue` sheets / archives, with **Make playlist…** for multi-disc sets,
  **Fix…** and **Convert to CHD** when `p7zip` / `chdman` are installed). **Systems** lists every system with what the
  handheld can run, and why a system is missing when it cannot.
- **Files**: this computer and the handheld side by side; copy, rename, delete, preview and edit config files.
  Edits made during a save stay marked as unsaved until you save again; renaming protects existing files, including case-only name collisions.
- **Game Tuning**: per-game Menu+X core options for any RetroArch core (full catalogue from the handheld; presets for
  PPSSPP, Mupen64Plus-Next, PCSX-ReARMed, SwanStation, DuckStation, Flycast) and a per-game CPU governor, with Fastest,
  Balanced and Best looking presets and recommendations for known heavy games. Uses the same Andromeda manifest and ROM-root
  fallback as Emulation. The game viewer Handheld tab embeds the same editor when the game is on the device. **Cheats**
  per game from the libretro cheat database (RetroArch cores) or the cheat files MustardOS ships for PPSSPP. Pick the
  system from a list you filter by typing.

**Tools**
- **Interface**: consistent dark and light layouts, a navigation drawer on smaller screens, compact phone headers and game filters,
  keyboard tab navigation, visible focus indicators and reduced-motion support. Links remember the active section tab.
  The shared Connection panel separates file transfers from remote controls; setup stays beside the current task.
  Overview offers library tasks while offline, and Files uses switchable computer/handheld panes on phones.
- **System Tools**: install MustardOS on an SD card, set up a games card (TF2) with every system folder, or wipe a card.
  Each action asks for an Are you sure confirmation (no typing a disk name). Install needs a card reader: live write/verify
  progress on macOS (sudo password), optional skip verify, and Cancel during write/verify. Set up TF2 and Reset card can
  also run over Wi-Fi/SSH on the handheld's TF2 without touching SD1 (setup: exFAT named TF2 with ROMS folders; reset:
  FAT32 or exFAT with the name you choose, empty).
- **SSH**: a terminal on the handheld in the browser, plus a quick look at its system.

**Manager**
- **Wiki**: built-in help for every page, a glossary and troubleshooting. Sits under Overview in the sidebar
  (shortcuts <kbd>2</kbd> or <kbd>0</kbd>); every page also has a **?** button for its article.
- **Settings**: six tabs — **Folders** (including the `logs/` diagnostics folder), **Behaviour** (show tips at start,
  **library recipes** that chain scrape / copy / rescan after add games or scrape), **Appearance** (theme, colour schemes,
  zoom, Softer style, compact layout, digital or analog clock), **Assistant** (API key, model, system prompt, view
  knowledge base), **Data** and **Resets** (including factory reset that starts over from the setup wizard).
- **Hints and tips**: a short graphical walkthrough of the main features after the setup wizard and What's new. Uncheck
  **Show tips when the manager starts** in the dialog or under Settings → Behaviour; reopen from Help (<kbd>?</kbd>) or
  Behaviour → Open tips.
- **Logs**: application diagnostics written to workspace `logs/` as daily JSONL files. Search, filter by level or day,
  expand stacks, export, **Support pack** (zip for bug reports), clear, and open the folder. Captures errors, warnings,
  exceptions, manager actions and browser faults (separate from Overview **Recent activity**).
- **Assistant**: optional chat (bring your own free API key under Settings → Assistant) grounded in a shipped knowledge
  base plus your library and LaunchBox game data. After a key is saved, open it from the mustard chat button in the
  bottom-right corner or **Assistant** in the top bar. View the knowledge base read-only from Settings → Assistant.
  Replies support Markdown (including tables) and show timestamps; it will not invent walkthroughs.
- **Transfers**: a panel in the bottom-right corner with the running copy (progress, speed, time left, current file),
  the copies waiting their turn and a history of finished ones. **Show Transfers** appears when there is an active or
  finished transfer. Start more copies while one runs and they queue up; minimise the panel to a thin progress bar or
  hide it and reopen it from the top bar.
- **Updates**: the top bar shows when a new version is out, and **Update now** installs it with one click, whether you
  cloned the repository or downloaded the ZIP. After you restart into a new version, a **What's new** dialog lists the
  changes once. See [CHANGELOG.md](CHANGELOG.md) for the full history.

## Screenshots

<p align="center"><img src="docs/screenshots/overview.jpg" width="100%" alt="Overview"></p>
<p align="center"><em>Overview: library tasks while offline, Roms/ counts, artwork coverage and what to do next — connect when you want to transfer.</em></p>

<p align="center"><img src="docs/screenshots/game.jpg" width="100%" alt="Game details"></p>
<p align="center"><em>Game view: box art, description, rating and library check, with tabs for details, handheld data and related games.</em></p>

<p align="center"><img src="docs/screenshots/artwork.jpg" width="100%" alt="Artwork coverage"></p>
<p align="center"><em>Artwork: coverage per system, scraping what is missing, and syncing box art with the handheld.</em></p>

<p align="center"><img src="docs/screenshots/os.jpg" width="100%" alt="OS library"></p>
<p align="center"><em>OS: local MustardOS release folders, release notes and the OS market for official downloads.</em></p>

<p align="center"><img src="docs/screenshots/play.jpg" width="100%" alt="Play activity"></p>
<p align="center"><em>Play activity: play time, recently played games and collections from the handheld.</em></p>

<p align="center"><img src="docs/screenshots/apps.jpg" width="100%" alt="App market"></p>
<p align="center"><em>Apps: the app market with screenshots and release notes, picking the right package for your handheld.</em></p>

<p align="center"><img src="docs/screenshots/handheld.jpg" width="100%" alt="Device"></p>
<p align="center"><em>Device: MustardOS settings, Controls and Benchmark over Wi-Fi with SSH (needs the handheld reachable).</em></p>

<p align="center"><img src="docs/screenshots/themes.jpg" width="100%" alt="Theme browser"></p>
<p align="center"><em>Themes: the MustardOS community themes that fit your screen, ready to preview, install and apply.</em></p>

<p align="center"><img src="docs/screenshots/designer.jpg" width="100%" alt="Theme Designer quick style"></p>
<p align="center"><em>Theme Designer: Quick style palettes and colours with a live preview of the handheld's main menu.</em></p>

<p align="center"><img src="docs/screenshots/designer-edit.jpg" width="100%" alt="Theme Designer scheme settings"></p>
<p align="center"><em>Theme Designer: every scheme setting MustardOS reads, grouped by part of the screen, with the preview following along.</em></p>

<p align="center"><img src="docs/screenshots/emulation.jpg" width="100%" alt="Emulation systems"></p>
<p align="center"><em>Emulation: which systems the handheld can run. Saves, BIOS, cores, RetroArch and the library check sit in the other tabs.</em></p>

<p align="center"><img src="docs/screenshots/files.jpg" width="100%" alt="Files"></p>
<p align="center"><em>Files: this computer and the handheld side by side — copy, rename, delete, preview and edit.</em></p>

<p align="center"><img src="docs/screenshots/tuning.jpg" width="100%" alt="Game Tuning"></p>
<p align="center"><em>Game Tuning: per-game emulator settings, cheats and CPU governor, with Fastest, Balanced and Best looking presets.</em></p>

<p align="center"><img src="docs/screenshots/system.jpg" width="100%" alt="System Tools"></p>
<p align="center"><em>System Tools: install MustardOS, set up TF2 or wipe a card, with confirmations and live progress.</em></p>

<p align="center"><img src="docs/screenshots/terminal.jpg" width="100%" alt="Terminal"></p>
<p align="center"><em>Terminal: an SSH shell on the handheld in the browser, plus a quick look at its system.</em></p>

<p align="center"><img src="docs/screenshots/appearance.jpg" width="100%" alt="Settings Appearance"></p>
<p align="center"><em>Settings → Appearance: colour schemes (including custom), Softer style, zoom, compact layout and clock.</em></p>

<p align="center"><img src="docs/screenshots/settings.jpg" width="100%" alt="Settings Assistant"></p>
<p align="center"><em>Settings → Assistant: bring-your-own-key chat, Edit prompt and View knowledge base.</em></p>

<p align="center"><img src="docs/screenshots/logs.jpg" width="100%" alt="Logs"></p>
<p align="center"><em>Logs: application diagnostics in the workspace logs/ folder — search, filter, export and clear.</em></p>

<p align="center"><img src="docs/screenshots/wiki.jpg" width="100%" alt="Wiki"></p>
<p align="center"><em>Wiki: built-in help for every section, glossary and troubleshooting (also under Overview in the sidebar).</em></p>

<p align="center"><img src="docs/screenshots/wizard.jpg" width="100%" alt="Setup wizard"></p>
<p align="center"><em>Setup wizard: the first start asks for your handheld, folders and connection.</em></p>

## Supported handhelds

The manager follows the model it is talking to: screen size for artwork and themes, which ports run, which settings exist,
and whether there is a second card slot and Wi-Fi. Connected handhelds are recognised automatically over USB and Wi-Fi;
for a card in a card reader the manager asks once and remembers the answer.

| Maker | Models |
| --- | --- |
| Anbernic | RG28XX H, RG34XX H, RG34XX SP, RG35XX 2024, RG35XX H, RG35XX Plus, RG35XX Pro, RG35XX SP, RG40XX H, RG40XX V, RG CubeXX |
| TrimUI | Brick, Smart Pro |

## Requirements

- **Node.js 23.6 or newer** (the manager runs its TypeScript directly; there is no build step). The installer offers to
  install it with Homebrew on macOS and with winget on Windows.
- **macOS, Linux or Windows 10/11.** macOS and Linux use `installer.sh` and `run.sh`; Windows uses `installer.cmd` and
  `run.cmd` (PowerShell scripts that come with Windows).
- For **USB**: `libmtp` (`brew install libmtp` on macOS, `sudo apt install libmtp9` or similar on Linux, `libmtp-9.dll`
  on the `PATH` on Windows). The macOS installer offers it. The card reader and Wi-Fi work without it.
- For **Wi-Fi**: the handheld and computer on the same network.
- A modern browser (Chrome, Edge, Firefox or Safari).

## Installation

### macOS and Linux

1. Pick a folder for your handheld files and clone the repository into it. The manager puts its workspace (`Roms/`,
   `apps/`, `os/`, `bios/`, `backups/`, `themes/`, `logs/`) next to its own folder, so a dedicated folder keeps things together:

   ```bash
   mkdir -p ~/Handheld && cd ~/Handheld
   git clone https://github.com/aaronns87/muos-anbernic-manager.git
   ```

   No git? Download the ZIP from the green **Code** button and unpack it into that folder as `muos-anbernic-manager`.
   Both update themselves from inside the manager (see [Updates](#updates)); a clone also lets you update with `git pull`.

2. Run the installer:

   ```bash
   ./muos-anbernic-manager/installer.sh
   ```

   It checks Node.js and installs the npm packages, offers `libmtp` for USB, creates the workspace folders (with one folder
   per MustardOS system in `Roms/`), can start from a clean cache, and offers an [app shortcut](#app-shortcut). Existing
   folders and files are never touched. Options: `--workspace DIR` to put the workspace somewhere else, `--yes` to accept
   the defaults, `--help` for the rest.

3. The installer starts the manager and your browser opens the **setup wizard**: pick your handheld, check the folders,
   choose how to connect, and optionally download the game descriptions (about 110 MB). Skip anything; it is all in
   **Settings** later, and **Settings > Game data > Run setup** opens the wizard again.

4. Next time, open **muOS Anbernic Manager** from Applications or the app menu, or run:

   ```bash
   ./muos-anbernic-manager/run.sh
   ```

   Keep the terminal window open while you use it; closing it or pressing `Ctrl-C` stops the manager.

### Windows

1. Pick a folder for your handheld files, for example `C:\Users\<you>\Handheld`, and clone the repository into it from
   PowerShell or Command Prompt:

   ```powershell
   mkdir $HOME\Handheld; cd $HOME\Handheld
   git clone https://github.com/aaronns87/muos-anbernic-manager.git
   ```

   No git? Download the ZIP from the green **Code** button, unpack it into that folder and rename the result to
   `muos-anbernic-manager` (GitHub names it `muos-anbernic-manager-main`).

2. Double-click `installer.cmd` in the `muos-anbernic-manager` folder, or run it from a terminal:

   ```powershell
   .\muos-anbernic-manager\installer.cmd
   ```

   It does the same as the macOS and Linux installer: offers to install Node.js with winget if it is missing, installs the
   npm packages, creates the workspace folders, can start from a clean cache and offers a Start menu shortcut. It takes
   the same options (`--workspace DIR`, `--yes`, `--help`, ...).

3. The installer starts the manager and your browser opens the **setup wizard**, as above.

4. Next time, open **muOS Anbernic Manager** from the Start menu, or double-click `run.cmd`. Keep its window open while you
   use the manager; closing it stops the manager.

### App shortcut

The installers ask whether to add **muOS Anbernic Manager** with its icon to Applications (macOS, in `~/Applications`),
the Start menu (Windows) or the app menu (Linux). The setup wizard and **Settings > Transfers, startup and updates >
App shortcut** offer it too, and can create it again after you move the manager's folder. The shortcut opens a terminal
window that runs the manager and opens it in your browser, the same as `run.sh` or `run.cmd`; closing that window stops
the manager. From a terminal: `node muos-anbernic-manager/src/main.ts --shortcut`.

### Updates

The manager compares its `VERSION` file with the one on GitHub every few hours. When there is a newer version, the top
bar shows **Update** next to the clock (otherwise it shows the version you have). Click it, then **Update now**:

- **Cloned with git**: the manager runs `git pull` on the `main` branch. If you changed files in the manager folder or
  switched branches, it tells you what to do instead of pulling.
- **Downloaded as ZIP**: the manager downloads the ZIP of `main` from GitHub, checks it, and swaps in the new program
  files. The replaced files are kept in `muos-anbernic-manager/.update-old/` until the next update, and put back
  automatically if anything goes wrong.

Either way it installs new packages if needed and restarts in the same browser tab (when started with `run.sh`, `run.cmd`
or the app shortcut).
Your `Roms/`, workspace folders, settings and logins (`.cache/`) are never touched. From a terminal, a clone updates
with `git -C muos-anbernic-manager pull`, then `run.sh`.

The check only reads the version number from GitHub; turn it off under **Settings > Check for manager updates**.
**What's new** in the update dialog opens [CHANGELOG.md](CHANGELOG.md), which lists the changes in every version and
those already on `main` but not yet released.

## Connecting the handheld

| Connection | How | Good for |
| --- | --- | --- |
| Card reader | Take the games card (TF2, or the only card on one-slot models) out and put it in the computer. | Copying many games quickly; install MustardOS, set up TF2, wipe a card. |
| USB cable | Andromeda: turn **Device Link → USB Cable** off, connect Wi-Fi + SSH, set **Device → Settings → Advanced → USB function → MTP** in this manager (often not on the handheld menus), then unplug/replug. Older builds: **Advanced Settings → USB Function → MTP**. | Copying games and artwork; play time. |
| Wi-Fi | Turn on **Configuration > Connectivity > Web Services > Secure File Transfer** (Andromeda; older builds: SFTP + Filebrowser) for files, and **Secure Shell** for everything else. | Everything, including apps, themes, ports, settings, saves, Set up TF2 and Reset card (TF2). |

Switch between them from the top-bar connection chip (**Transfer path** cards for USB / Wi-Fi / Card). Game copies use the
primary path; Play activity can use any live USB or Wi-Fi link. The default MustardOS logins (`muos`/`muos` for SFTP,
`root`/`root` for SSH) are filled in; **Find on network** looks for the handheld's address.

## Usage

- **Add games**: drop ROM files on the Games page or use **Add games**. They go into the right `Roms/<SYSTEM>` folder with
  artwork and a description.
- **Copy to the handheld**: select games and use **Transfer**, or compare the library with the device on the Overview page.
- **Artwork**: the Artwork page shows what is missing; **Scrape** fetches it, sized for your screen.
- **Install MustardOS**: put a release image (`.img.gz`) in `os/` (or Library → OS / OS market), then use **System Tools** with
  the card in a card reader. Confirm once, enter your macOS password when asked, and watch write/verify progress. You can skip
  read-back verification if you want a faster finish.
- **Set up TF2 / Reset card**: same confirmation modal; use a card in the reader or **Over Wi-Fi** on the handheld's TF2 slot.

Every page has a **?** button that opens its Wiki article.

### Command-line options

```
./muos-anbernic-manager/run.sh [--no-open] [--port N] [--root DIR] [--skip-descriptions] [--refresh-descriptions]
```

On Windows, `run.cmd` takes the same options. `--root DIR` uses another workspace; `--port N` picks another port
(default 8765); `node src/main.ts --help` lists the rest.

## Safety

- Deleting something on the computer moves it to the **Trash**. Deleting on the handheld or its cards is **permanent**,
  and the manager says so before it does it.
- **Settings > Factory reset** asks you to type RESET, then moves the game library, the other workspace folders and the
  manager's cache to the Trash.
- Anything that changes the handheld or erases a card asks first and explains what will happen (System Tools uses a
  confirmation dialog; Factory reset still requires typing RESET). System Tools only offers removable cards, never
  internal disks.
- Logins for Wi-Fi and SSH are stored in `muos-anbernic-manager/.cache/` on your computer only (file mode 600).
- The web interface listens on `127.0.0.1` only and needs the token from the URL the manager opens.

## Troubleshooting

- **"Node.js is too old"**: install Node.js 23.6 or newer from [nodejs.org](https://nodejs.org/) or with `brew install node`.
- **SSH says the host key changed**: normal after reinstalling MustardOS. In the connection panel open **Remote controls** and
  click **Trust the new key** (or use the same button on Terminal / Device Settings). Only do that if the address is still yours.
- **USB shows Device Link / usblink0 / “looking for other device”**: that is Andromeda Device Link (USB id `1d6b:0110`),
  for two MustardOS handhelds — not this computer. Turn **USB Cable** off under **Configuration > Connectivity > Device Link**,
  connect Wi-Fi + SSH, set **Device → Settings → Advanced → USB function → MTP** in this manager (often missing on the handheld),
  then unplug and replug. While USB Cable is on, MTP is paused.
- **USB shows nothing on a Mac**: install `libmtp` (`brew install libmtp`), set the handheld's USB Function to MTP, and quit
  apps that grab MTP devices (Android File Transfer, OpenMTP).
- **The handheld is not found over USB, often after a restart**: unplug the cable, wait until the handheld has finished
  starting, and plug it in again; plugged in during start-up, its USB port can come up in the wrong mode. On a Mac, unlock
  it and click **Allow** on the accessory prompt (or check **System Settings > Privacy & Security > Allow accessories to
  connect**), and try another cable if it still shows nothing: charge-only cables carry no data.
- **Wi-Fi says no Primary Storage / SD1 folder**: Andromeda names cards Primary/Secondary Storage over SFTP; update the manager if you still see that on a current build. Check Secure File Transfer is on (Connectivity → Web Services).
- **Wi-Fi does not connect**: check that Secure File Transfer (or SFTP + Filebrowser) is on and the address under Wi-Fi settings is right; features
  that change the handheld also need Secure Shell.
- **The card reader card is not found**: on one-slot models the games live on the only card; pick your model in the picker
  under the logo so the manager knows.
- **Install MustardOS fails with “Operation not permitted” on macOS**: enter your password when asked (sudo). If it still
  fails, grant Full Disk Access to Terminal (or the app that launched the manager), unplug the card, and try again.
- **Install verify says the read-back does not match**: try again; leave the card alone during write/verify. You can skip
  verification for a faster finish if you trust the write, then boot-test on the handheld.
- **Start over**: `./muos-anbernic-manager/installer.sh --clean-cache` (or `installer.cmd --clean-cache` on Windows)
  moves the cache aside (Wi-Fi logins, downloads and settings) and shows the setup wizard on the next start. To also
  clear your games and the other workspace folders, use **Settings > Factory reset**: it moves everything to the Trash,
  creates empty folders and restarts into the setup wizard. The handheld is not touched.
- **Windows asks whether to run `installer.cmd` or `run.cmd`**: files from a downloaded ZIP carry a "from the internet"
  mark. Choose **More info > Run anyway**, or right-click the ZIP, open **Properties**, tick **Unblock** and unpack it again.
- **winget is missing on Windows**: install **App Installer** from the Microsoft Store, or install Node.js from
  [nodejs.org](https://nodejs.org/), then run `installer.cmd` again.
- **The app shortcut does nothing after moving the manager**: create it again under **Settings > Transfers, startup and
  updates > App shortcut**, or run the installer again.

The Wiki inside the manager has a longer Troubleshooting page.

## Development

```bash
npm install
npm test          # unit and server tests (node --test)
npm run check     # TypeScript type check
```

The server is in `src/` (TypeScript run directly by Node; entry point `src/main.ts`, routes in `src/server.ts`), and the
interface is plain ES modules in `public/` with no framework or bundler. Issues and pull requests are welcome; please run
the tests and type check first, and keep changes that write to the handheld behind an explicit user action.

- [CONTRIBUTING.md](CONTRIBUTING.md): setup, tests, pull requests and how versions are released.
- [CHANGELOG.md](CHANGELOG.md): release notes and version history; add user-visible changes under **Unreleased**.
- [docs/architecture.md](docs/architecture.md): module map, request flow, device access and the MustardOS paths used.
- [AGENTS.md](AGENTS.md): short guide for coding agents; Cursor also picks up the rules in `.cursor/rules/` and the
  task guides in `.cursor/skills/` (feature workflow, testing, device access, releasing). Codex uses copied rules
  in `.codex/rules/` through `AGENTS.md` and copied skills in `.agents/skills/`. Keep both sets in sync.

## Credits

- [MustardOS](https://muos.dev/) and its community, for the firmware and the theme library.
- [PortMaster](https://portmaster.games/) for the ports catalogue.
- [libretro thumbnails](https://thumbnails.libretro.com/) and the [libretro database](https://github.com/libretro/libretro-database) for artwork and game names.
- [LaunchBox Games Database](https://gamesdb.launchbox-app.com/) for descriptions, genres and ratings.
- [ScummVM](https://www.scummvm.org/) and the authors who released their games for free.
- [xterm.js](https://xtermjs.org/), [ssh2](https://github.com/mscdex/ssh2), [koffi](https://koffi.dev/), [libmtp](https://libmtp.sourceforge.net/),
  [saxes](https://github.com/lddubeau/saxes) and [yauzl](https://github.com/thejoshwolfe/yauzl).
- [EmulatorJS](https://emulatorjs.org/) (GPL-3.0) for in-browser play of light systems; cores load from their CDN.

This project is not affiliated with MustardOS, Anbernic or TrimUI.

## License

Copyright (C) 2026 aaronns87

Licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). You may use, study, change
and share the manager freely. If you distribute a modified version, or let others use one over a network,
you must publish its source code under the same license.
