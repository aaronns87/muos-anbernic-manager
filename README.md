<div align="center">

<img src="public/assets/favicon.svg" width="96" alt="muOS Anbernic Manager logo">

# muOS Anbernic Manager

**Your games, artwork, apps, themes and handheld settings for MustardOS, managed from a browser tab on your computer.**

[![Node.js 23.6+](https://img.shields.io/badge/node-23.6%2B-3c873a?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-555)](#requirements)
[![MustardOS](https://img.shields.io/badge/for-MustardOS-e3b341)](https://muos.dev/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

<img src="docs/screenshots/games.jpg" width="32%" alt="Game library with box art">
<img src="docs/screenshots/themes.jpg" width="32%" alt="Theme browser">
<img src="docs/screenshots/wizard.jpg" width="32%" alt="First-run setup wizard">

</div>

The manager runs on your Mac, Linux or Windows computer and looks after an Anbernic or TrimUI handheld running
[MustardOS (muOS)](https://muos.dev/). It keeps your `Roms/` library tidy with box art and descriptions, copies games to the
handheld over a card reader, USB or Wi-Fi, installs apps, themes and PortMaster ports, and changes the handheld's own settings,
without editing files by hand or remembering where MustardOS keeps things.

Everything happens locally: the manager is a small Node.js server with a web interface on `127.0.0.1`, protected by a
per-session token. Nothing is uploaded anywhere.

## Contents

- [Features](#features)
- [Supported handhelds](#supported-handhelds)
- [Requirements](#requirements)
- [Installation](#installation)
- [Connecting the handheld](#connecting-the-handheld)
- [Usage](#usage)
- [Safety](#safety)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Credits](#credits)
- [License](#license)

## Features

**Library**
- **Games**: browse the whole `Roms/` library by system, with search, filters (artwork, genre, rating, year) and grid or list views.
  Add games by drag and drop, copy them to the handheld, see what is on the device and what is missing, and remove games.
- **Artwork**: fetch box art, screenshots and descriptions for every game (libretro thumbnails, LaunchBox Games Database),
  in the size your handheld's screen needs, and sync them to the device.
- **Play**: play time, recently played games and collections from the handheld.
- **ScummVM and ports**: ScummVM games with their data folders, a list of classic adventures released for free with
  one-click download, and the PortMaster catalogue with install and uninstall over Wi-Fi.

**Handheld**
- **Apps**: install `.muxapp` apps and `.muxupd` updates, and check for new MustardOS releases.
- **Device Settings**: change MustardOS settings (display, audio, network, interface and more) from the computer.
- **Themes**: browse the community theme library filtered for your screen, preview themes, install and apply them.
- **Emulation**: back up and restore saves and save states, check BIOS files, choose emulator cores per system or game,
  edit RetroArch options, and run a health check of your library.
- **Files**: this computer and the handheld side by side; copy, rename, delete, preview and edit config files.

**Tools**
- **System Tools**: install MustardOS on an SD card, set up a games card (TF2) with every system folder, or wipe a card.
- **SSH**: a terminal on the handheld in the browser, plus a quick look at its system.
- **Wiki**: built-in help for every page, a glossary and troubleshooting.

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
  install it with Homebrew on macOS.
- **macOS or Linux** for `installer.sh` and `run.sh`. **Windows** works with `npm install` and `node src/main.ts`
  (see [Installation](#installation)); the scripts run in Git Bash or WSL.
- For **USB**: `libmtp` (`brew install libmtp` on macOS, `sudo apt install libmtp9` or similar on Linux). The installer offers it.
- For **Wi-Fi**: the handheld and computer on the same network.
- A modern browser (Chrome, Edge, Firefox or Safari).

## Installation

1. Pick a folder for your handheld files. The manager puts its workspace (`Roms/`, `apps/`, `os/`, `bios/`, `backups/`)
   next to its own folder, so a dedicated folder keeps things together:

   ```bash
   mkdir -p ~/Handheld && cd ~/Handheld
   git clone https://github.com/aaronns87/muos-anbernic-manager.git
   ```

   No git? Download the ZIP from the green **Code** button and unpack it into that folder.

2. Run the installer:

   ```bash
   ./muos-anbernic-manager/installer.sh
   ```

   It checks Node.js and installs the npm packages, offers `libmtp` for USB, creates the workspace folders (with one folder
   per MustardOS system in `Roms/`), and can start from a clean cache. Existing folders and files are never touched.
   Options: `--workspace DIR` to put the workspace somewhere else, `--yes` to accept the defaults, `--help` for the rest.

3. The installer starts the manager and your browser opens the **setup wizard**: pick your handheld, check the folders,
   choose how to connect, and optionally download the game descriptions (about 110 MB). Skip anything; it is all in
   **Settings** later, and **Settings > Game data > Run setup** opens the wizard again.

4. Next time, start the manager with:

   ```bash
   ./muos-anbernic-manager/run.sh
   ```

   Keep the terminal window open while you use it; `Ctrl-C` stops it.

**Updating:** `git pull` in `muos-anbernic-manager/`, then `run.sh` (it installs new packages when needed).

**Windows without bash:** in the `muos-anbernic-manager` folder run `npm install`, `node src/main.ts --init` once to create
the workspace, then `node src/main.ts` to start.

## Connecting the handheld

| Connection | How | Good for |
| --- | --- | --- |
| Card reader | Take the games card (TF2, or the only card on one-slot models) out and put it in the computer. | Copying many games quickly; System Tools. |
| USB cable | On the handheld: **Configuration > Advanced Settings > USB Function > MTP**, then plug it in. | Copying games and artwork; play time. |
| Wi-Fi | Turn on **Configuration > Web Services > SFTP + Filebrowser** (files) and **Secure Shell** (everything else). | Everything, including apps, themes, ports, settings and saves. |

Switch between them at the top of the Overview page. The default MustardOS logins (`muos`/`muos` for SFTP, `root`/`root`
for SSH) are filled in; **Find on network** looks for the handheld's address.

## Usage

- **Add games**: drop ROM files on the Games page or use **Add games**. They go into the right `Roms/<SYSTEM>` folder with
  artwork and a description.
- **Copy to the handheld**: select games and use **Transfer**, or compare the library with the device on the Overview page.
- **Artwork**: the Artwork page shows what is missing; **Scrape** fetches it, sized for your screen.
- **Install MustardOS**: put a release image (`.img.gz`) in `os/` or download it from the Apps page, then use
  **System Tools** with the card in a card reader.

Every page has a **?** button that opens its Wiki article.

### Command-line options

```
./muos-anbernic-manager/run.sh [--no-open] [--port N] [--root DIR] [--skip-descriptions] [--refresh-descriptions]
```

`--root DIR` uses another workspace; `--port N` picks another port (default 8765); `node src/main.ts --help` lists the rest.

## Safety

- Deleting something on the computer moves it to the **Trash**. Deleting on the handheld or its cards is **permanent**,
  and the manager says so before it does it.
- Anything that changes the handheld or erases a card asks first and explains what will happen. System Tools only offers
  removable cards, never internal disks.
- Logins for Wi-Fi and SSH are stored in `muos-anbernic-manager/.cache/` on your computer only (file mode 600).
- The web interface listens on `127.0.0.1` only and needs the token from the URL the manager opens.

## Troubleshooting

- **"Node.js is too old"**: install Node.js 23.6 or newer from [nodejs.org](https://nodejs.org/) or with `brew install node`.
- **USB shows nothing on a Mac**: install `libmtp` (`brew install libmtp`), set the handheld's USB Function to MTP, and quit
  apps that grab MTP devices (Android File Transfer, OpenMTP).
- **Wi-Fi does not connect**: check that SFTP + Filebrowser is on and the address under Wi-Fi settings is right; features
  that change the handheld also need Secure Shell.
- **The card reader card is not found**: on one-slot models the games live on the only card; pick your model in the picker
  under the logo so the manager knows.
- **Start over**: `./muos-anbernic-manager/installer.sh --clean-cache` moves the cache aside (Wi-Fi logins, downloads and
  settings) and shows the setup wizard on the next start.

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

## Credits

- [MustardOS](https://muos.dev/) and its community, for the firmware and the theme library.
- [PortMaster](https://portmaster.games/) for the ports catalogue.
- [libretro thumbnails](https://thumbnails.libretro.com/) and the [libretro database](https://github.com/libretro/libretro-database) for artwork and game names.
- [LaunchBox Games Database](https://gamesdb.launchbox-app.com/) for descriptions, genres and ratings.
- [ScummVM](https://www.scummvm.org/) and the authors who released their games for free.
- [xterm.js](https://xtermjs.org/), [ssh2](https://github.com/mscdex/ssh2), [koffi](https://koffi.dev/), [libmtp](https://libmtp.sourceforge.net/),
  [saxes](https://github.com/lddubeau/saxes) and [yauzl](https://github.com/thejoshwolfe/yauzl).

This project is not affiliated with MustardOS, Anbernic or TrimUI.

## License

[MIT](LICENSE)
