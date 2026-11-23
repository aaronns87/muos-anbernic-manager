# Assistant knowledge base

Ground truth for the in-app assistant. Prefer this over memory. Do not invent UI, buttons, tabs or menus that are not described here.
Live CONTEXT may also include connection status and Roms library matches - use those when present.
People can open the same guide read-only under Settings > Assistant > View knowledge base.

## start - Getting started

muOS Anbernic Manager runs on this computer (Mac, Linux or Windows) and looks after Anbernic or TrimUI handhelds on MustardOS (muOS): games in `Roms/`, box art, apps and updates, saves, BIOS, emulator choices and the handheld's own settings. Everything happens in a browser tab; keep the terminal that started the manager open.

### Sidebar

- **Overview**, then **Wiki** (help; shortcuts `2` or `0`)
- **Library** - Games, Play, Artwork, OS
- **Handheld** - Apps, Device, Themes, Emulation, Files, Game Tuning
- **Tools** - System Tools, Terminal (SSH), MCP
- **Manager** - Settings, Logs (Assistant chat opens from the top bar or mustard button after an API key is saved)

### Install and setup wizard

- Installer: `./muos-anbernic-manager/installer.sh` (macOS/Linux) or `installer.cmd` (Windows). Checks Node.js and packages, can install Node via Homebrew/winget and libmtp on Mac for USB. Creates workspace folders `Roms/`, `apps/`, `os/`, `bios/`, `backups/`, `themes/`, `logs/` (existing files left alone).
- Offers an **app shortcut** (Applications / Start menu / app menu). Shortcut opens a terminal that runs the manager; closing the window stops it. Settings > Behaviour can add the shortcut again after moving the folder.
- First start with a clean cache opens the **setup wizard** (model, folders, connection, optional game data download and shortcut). Skip setup closes it; Settings can open Run setup again.
- Start later with the shortcut, `./muos-anbernic-manager/run.sh` or `run.cmd`.
- **Updates**: version next to the clock becomes Update when GitHub has a newer one. Update now uses git pull or ZIP swap, then restarts. Settings can turn the check off. After update, **What's new** shows once from CHANGELOG.md.
- **Hints and tips**: after the wizard and What's new, a carousel walks through main features (connection, Games, Artwork, OS, Apps, Device, Themes, Emulation, Files, Tuning, Appearance, Logs, Wiki). Checkbox **Show tips when the manager starts** (also Settings > Behaviour). Reopen from Help (?), Settings > Behaviour > Open tips, or Wiki Getting started.

### Three ways to connect

1. **Card reader** - TF2 games card (or the only card on one-slot models) in this computer. Fastest for many games. Needed for Install MustardOS and for card wipes from a reader.
2. **USB** - Needs MTP. On Andromeda, USB Function is often missing on the handheld menus — use the Andromeda MTP steps below. Older MustardOS: Configuration > Advanced Settings > USB Function > **MTP**, then plug in.
3. **Wi-Fi** - Same network. Enable **Secure File Transfer** (Andromeda; older: SFTP + Filebrowser) for files — SFTP root uses Primary/Secondary Storage (mapped to SD1/TF2). Enable **Secure Shell** for apps, themes, Device, cores, BIOS, Game Tuning, TF2-over-Wi-Fi tools and SSH. Set the handheld under Overview / Connection → **Handheld on this network** (Save and connect, or Find on network then Use and connect). Sign-in details (user, password, SFTP port) sit behind a disclosure. Wake the handheld; sleep drops Wi-Fi.

USB and Wi-Fi can both be up. Top-bar connection chip shows every live link and opens the connection panel: **Transfer path** cards pick the primary path for copies (USB / Wi-Fi / Card), with actions and help for that path (including **Andromeda USB (MTP) help**), plus a **Web services** list (SSH, SFTP, virtual terminal/ttyd, Syncthing, web dashboard, Filebrowser when present, mDNS, Tailscale) with enabled/running/reachable status and **Open** for HTTP UIs; a **Netplay helper** below it shows a copyable `IP:port` invite for RetroArch netplay (default port 55435, editable, remembered in the browser) and links to the RetroArch netplay docs (helper only, nothing is hosted); optional **Wait for Syncthing idle** before large copies (manager does not start/stop Syncthing—use Device Settings → Web services). **Find on network** scans for MustardOS SFTP (Dropbear/SFTPGo on port 2022) and updates the saved Wi-Fi address (and SSH when it followed that address) if the handheld’s IP changed. **Use handheld ports** (Device Settings) copies SSH, SFTP, ttyd, Syncthing and dashboard ports into the manager. Terminal can **Show ttyd** as an embedded virtual terminal. Overview shows the same services block. Game copies use one primary path at a time. Play activity and collections use any live USB or Wi-Fi link even when Card reader is primary.

### Andromeda USB (MTP) — set MTP from the manager

Andromeda Device Link (**USB Cable**, `usblink0`, USB id `1d6b:0110`) joins two MustardOS handhelds. While it is on, MTP/ADB are paused and Status may say it is looking for another device. USB Function often does not appear on the handheld menus.

1. On the handheld: **Configuration → Connectivity → Device Link** → turn **USB Cable** off.
2. Enable Wi-Fi and **Configuration → Connectivity → Web Services → Secure Shell** (and **Secure File Transfer** if you want file copies over Wi-Fi).
3. In this manager: connect over Wi-Fi, open **Device → Settings → Advanced**, set **USB function** to **MTP**, and turn off **USB Cable (Device Link)** if it is listed.
4. Unplug the USB cable, plug it in again, then press **Check again**.

The connection panel’s **Open Device Settings** link jumps to step 3 when Wi-Fi + SSH are up.

### How the model is known

- USB: handheld reports model name.
- Wi-Fi: read from MustardOS (SFTP or SSH).
- Card reader: card cannot say; SD1 play records often can; otherwise ask once and remember. Change next to Handheld in Overview asks again.
- Nothing connected: model picker under the logo (each model shows a horizontal / vertical / clamshell silhouette). While connected, reported model cannot be changed.

### What needs which connection

| Feature | Needs |
| --- | --- |
| Copy games, artwork, packages; Files | Card reader, USB or Wi-Fi |
| Play time, Recently played, Collections | USB or Wi-Fi (live on SD1 inside handheld) |
| Install/uninstall apps, Device (settings + controls + benchmark), Themes, Ports, Saves, BIOS, Cores, RetroArch, Game Tuning, SSH | Wi-Fi with Secure Shell on |
| Install MustardOS or wipe a card in a reader | Card reader |
| Set up TF2 / Reset card on TF2 | Card reader, or Wi-Fi with SSH |
| Library check, Updates, App market downloads, adding to Roms/, OS library | This computer only |

### Top bar

- **Connection chip** - Live links, Check/Connect/Disconnect, Wi-Fi help when offline.
- On phones, the chip's panel replaces the duplicate sidebar device card; connection choices remain available there.
- **Transfers** - Show Transfers / Hide Transfers. Queue, history, per-file progress. Shown when there is transfer state.
- **Assistant** - Opens/hides chat dock after API key saved (same as mustard button bottom-right).
- Version / Update / What's new as above.

### Safety

- Delete on this computer goes to Trash (recoverable).
- Delete on handheld or its card is permanent (no Trash).
- Destructive actions confirm first.
- Never invent game walkthroughs - point to GameFAQs, StrategyWiki or a game wiki.

### Keyboard shortcuts

- `1`-`9`: first nine sidebar sections (1 Overview, 2 Wiki, 3 Games … through Themes); `0`: always Wiki.
- `?`: help for current page. `[`: fold sidebar.
- Power user keys (Settings > Behaviour, on by default): `Ctrl`/`Cmd`+`K` opens a command palette (type to filter sections and actions such as focus game search, transfers and activity, rescan, sidebar, help; arrows + Enter; Esc closes); `/` focuses game search from any page.
- Games: `/` search, `S` select mode, arrows in game viewer.
- Tab bars: Left/Right to change tabs, Home/End for first/last. Tab to Skip to content to bypass navigation.

## overview - Overview

Home page: whether the handheld is connected and how (card reader, USB or Wi-Fi), free space, how many systems have games and artwork, empty systems, MustardOS images in `os/`, apps with updates. Top-bar chip opens the connection panel; Overview is the full connection page.

**Syncthing conflicts** (Device web services in the connection panel, and the Saves panel on the handheld side): lists `.sync-conflict` copies Syncthing left in `save/` and `info/` on the handheld (name, size, time). Per file: **Keep handheld file** or **Delete copy** removes the conflict copy, **Use conflict copy** overwrites the original with it. Needs Wi-Fi + SSH. API `GET /api/syncthing/conflicts`, `POST /api/syncthing/conflicts/resolve` (`{path, action: keep-device|keep-conflict|delete-conflict}`). MCP: `syncthing_conflicts` (read), `syncthing_conflict_resolve` (two-step confirm).

**What changed on the card** (Overview **Since last connect**, and Device web services): each Games > Handheld listing is compared with the previous one for the same device profile (or volume) and shows games added, removed or changed (size/time). Snapshot in `.cache/device-listing-digest.json`; API `GET /api/device/card-diff?volume=`.

**Library health** (Overview, `GET /api/overview/health`): severity chips for missing artwork, BIOS gaps, last Library check result, Syncthing busy and games not on the handheld; each chip links to the section that fixes it. Cached signals only, refreshed about once a minute.

**Handheld on this network**: enter the address (Configuration > Wi-Fi Network on the handheld). Status shows connected / saved-but-unreachable / not set. **Save and connect** stores details and probes; **Find on network** scans LAN for SFTP (port 2022) with **Use and connect** on each hit. Sign-in details disclosure for user/password/port. Optional Filebrowser link when SFTP is up. **Device profiles** (stored by the manager in `.cache/device-profiles.json`) save a named handheld: Wi-Fi and SSH sign-in, web service ports, model, last seen and battery. In the Connection panel pick one to apply Wi-Fi, SSH and ports and reconnect; Save profile updates or creates, Delete removes. Passwords are not stored in profiles.

**Update handheld…** (Overview and Games): plan dialog — open Scrape for missing art, sync artwork to the device, queue copies for games not on the handheld.

**Since last connect**: Overview card remembers play/saves/library-vs-device counts while linked, then summarises changes next time (links to Play, Saves, Games, Transfers).

**Recent activity**: last copies, deletes, settings, installs, failures. Show all opens the full log with search and warning/error filter. Log lives in the manager cache (last few thousand entries). Clear from Settings > Resets. Separate from Manager → Logs (which can **Export support pack** as a zip).

## games - Games

### Library

Every game under `Roms/<SYSTEM>/`, grouped by system, with box art and LaunchBox descriptions when game data is downloaded. Controls: grid/list, Empty systems, expand/collapse all, card size slider.

### Finding and selecting

Search matches titles, file names, regions, systems. Filters: platform, genre, year. **Smart lists**: Favourites (star on card/viewer, stored locally), Never copied, No art, Bad dump (Library check), Needs tuning, On device only; **Select shown** for bulk transfer/scrape. **Roms/ library** vs **On TF2** switches computer vs handheld card. **Select** (or `S`) then Transfer, Trash, or delete from TF2.
On phones, **Filters** reveals filters and the card-size slider and shows the active filter count. Hiding it keeps the selections. Wider screens always show the filters.

### Copying and Transfers

Picked games (with art) copy into handheld `ROMS` over the active connection. FAT32 warns before files over 4 GB. **Transfers** panel: running copy (progress, speed, ETA, current file), queue, history; stop or dequeue; minimise or hide from top bar. History persists until cleared. USB: one copy at a time.

**Direction** (transfer dialog; MCP `direction` on `transfer_plan` / `transfer_start`, default `to-device`): `to-device` copies Roms/ games the handheld lacks; `from-device` pulls handheld games into Roms/ (same relative paths, folders created, free space checked on this computer); `match-device` / `match-library` are guided modes that also replace copies that differ (replaced Roms/ files go to the Trash). Every mode starts with a dry-run plan (new / identical / different per system); none deletes files on the other side. Pulls show as "from TF2 into Roms/" in Transfers and Roms/ is rescanned when they finish.

**Transport** (transfer dialog **Send via**; MCP `transport` on `transfer_plan` / `transfer_start`, default `sftp`): `syncthing` copies Roms/ games into the local folder that Syncthing shares with the handheld's `ROMS` (Settings → Transfers, startup and updates → **Syncthing ROMs folder**, setting `syncthingRomsPath`, optional **Syncthing folder id** `syncthingFolderId`) with the same `SYSTEM/file` layout, then waits for Syncthing on the handheld to be idle (same probe as `syncthing_wait_idle`, up to 90 s, folder id used when set) before the job is marked done. No SFTP/USB session is used, so the handheld need not be connected; the plan compares with the sync folder, not the device. Only `to-device` and `match-device` work with it. The option is disabled in the UI until the folder is set; the API/MCP return a clear error. Pairing happens in Syncthing itself (add the handheld as a device, share the folder, point the handheld folder at `ROMS`); the manager never edits Syncthing's config. Jobs show `transport: "syncthing"` and phase `sync` while waiting.

### Add games

**Add games** drops files into the right system folder and looks up description/art. **Free ScummVM games** and **Free & homebrew** catalogues download legal titles into Roms/ (homebrew into normal system folders). Legal downloads only (freeware, public domain, open-source; never commercial ROM dumps). Several catalogues (`free`, `pd-homebrew`, `libre-games`, from `data/free-homebrew.json` + `data/catalogues/*.json`) with a switcher in the modal; API `GET /api/homebrew/free?catalogue=<id|all>` and MCP `homebrew_list` `catalogue`. **Library recipes** (Settings → Behaviour) can scrape missing art and queue copies after add games or after Scrape saves.

### ScummVM

Folder of data files, not one ROM. Drop folder on Add games or Choose a ScummVM game folder -> `Roms/SCUMMVM/<Name>.scummvm` plus data in `Roms/SCUMMVM/.<Name>/` (also `_Name` or `Name`). Copy/delete always takes the data folder. **Free games** downloads freeware from scummvm.org into Roms/SCUMMVM. Saves stay on handheld save folder, not in the game folder.

### Ports (PortMaster)

Ports are native PC ports. Games > Ports shows what PortMaster installed on the handheld (not Roms/PORTS files). Needs Wi-Fi + SSH.

- Browse PortMaster library; **Runs on this handheld** / **Ready to run** filters.
- **Install** asks handheld PortMaster to download (handheld needs internet). Return to main menu first. Runs in background.
- **Needs game files**: after install, Add game files copies into the folder the port docs name.
- **Remove** deletes port folder, script, art and added game files permanently.
- Ports land on TF2 `/mnt/sdcard/ports` when present, else SD1. Files in `Roms/PORTS` on the computer are not copied.

### Play in browser

Supported systems: GB, GBC, GBA, FC, FDS, SFC, VB, N64, NDS, SMS, GG, MD, SEGA32X, MDCD, SATURN, PCE, PCECD, WS, NGP, A2600, A5200, A7800, LYNX, C64, VIC20, PS, PSP; arcade folders MAME, FBNEO, CPS1, CPS2, CPS3, NEOGEO (FinalBurn Neo `fbneo`, `.zip` only); Dreamcast (`DREAMCAST`) via Flycast (core cached from `nasomers/flycast-wasm` into `.cache/flycast-core/` on first play, served through `/api/games/ejs-data/` — needs both `dc_boot.bin` and `dc_flash.bin` in `bios/`; `.gdi`/`.cdi`/`.chd`). Card play control bottom-left; game viewer **Play in browser** when supported. EmulatorJS cores from CDN on first use (network once). Local ROM/BIOS stream. `.cue`/`.m3u` pull sibling tracks via `EJS_externalFiles`. PS / MDCD / SATURN / PCECD need BIOS in `bios/`. Session keyboard remap (click button, press key, Restart). Esc does not close; leave via X / Leave game with confirm. Focus mode hides chrome. **SRAM sync**: autosaves to `backups/saves-browser/`; **Load from device** / **Save to device** over SSH (close the game on the handheld first). Syncs battery SRAM (`.srm`), not RetroArch save states.

### Game viewer

Click a game: artwork, year, genre, players, rating, library-check tags, BIOS, other versions. Arrows step games. With handheld: on-device?, core, play time, saves; one-click system fix when needed. **Play in browser** when the system/file is supported (including disc CHD/ISO/cue/m3u/PBP where EmulatorJS can run them; BIOS required for PS / Sega CD / Saturn / PCE CD).

Tabs: **About** (description, YouTube, Write your own in `Roms/<SYSTEM>/Text/`); **Details** (DB, file size/CRC, check, BIOS, Rename); **Handheld** (core, Menu+X core options when the game is on the handheld and starts RetroArch or PPSSPP, play stats, collections, **saves with pull/push/delete/prune**, Open Game Tuning, Read again); **Related**. Drop image or Replace artwork. Show in Finder/Explorer.

**Emulation > Saves > Save browser**: per-game `.srm` and save states over SSH; pull to `backups/saves-pulled/`, push, delete, prune states (confirm). Complements tar.gz backups and `.muxbak`; does not replace them.

### Deleting

Computer: Trash, optional art. Handheld card: permanent.

## play - Play

Needs USB or Wi-Fi (data on SD1). Games card alone is not enough. Works whenever USB or Wi-Fi is live in the top bar — Card reader as the primary transfer path does not block it.

**Play time**: MustardOS activity tracking (on by default). Totals, launches, sort by most/last played, launches, name. Box art from Roms when present. Refresh after playing (written when leaving a game).

**Recently played**: MustardOS history, newest first.

**Collections**: handheld playlists under Collections in its menu. Create, rename, delete, add/remove games. Add games searches Roms but only offers titles already on the handheld (collections point; they do not copy). Removing from a collection never deletes the game. Changes show after returning to main menu. USB rename copies entries to a new folder (USB cannot rename).

## artwork - Artwork

Pictures next to games in MustardOS menus. Computer: `Roms/<SYSTEM>/Imgs/` named like the game. Handheld: MustardOS catalogue.

Tabs: **Sync** (copy missing either way); **Roms/ library** (coverage per system); **On device**; **Scrape** (download missing from online DBs). Routine: add games, Scrape, Sync. Upload size: Settings > Behaviour > Uploaded artwork size.

## os - OS

Library section after Artwork. Shows a spinner while reading `os/` and the MustardOS catalogue. Local disk images grouped by `mustardos_<version>/` (loose root images = Unsorted). **OS market** modal: catalogue releases for the selected handheld; GoFile/Mega/Filen open in the browser; after opening a host, a helper reminds you to **Add image** when the download finishes (no in-app multi-GB fetch). Add image (pick `.img`/`.img.gz` + SHA256 → same import as System Tools). Remove image or whole release → Trash. Show OS folder. Release notes from MustardOS site catalogue when version matches. Install opens System Tools → Install MustardOS with that image. Writing a card still only from System Tools + card reader.

## apps - Apps

Packages: `.muxapp` apps, `.muxupd` updates/add-ons, `.muxzip` bundles. Live in `apps/` folder (market, Add packages, or drag).

### App market

Popular apps and packages (Scrappy, Artie, Grout, Bluetooth, Void Desk, Dolphin Rt:Core for GameCube/Wii on H700, MustardTube for YouTube/radio on Andromeda, ...) with screenshots, stars, notes, GitHub links. Filter to what runs on the model; badges for wrong handheld, abandoned, pre-release. **Get** downloads the right package for model/MustardOS release (Banana through Andromeda). Send or Send and install. Reinstall from About. Some packages still need a separate binary after install (Dolphin Rt:Core: put `dolphin` in `/opt/muos/share/emulator/dolphin/`). List refreshes every 12h; Refresh forces. Apps are third-party - read the page before install.

### Send then install

1. **Send** copies to handheld `ARCHIVE` (Waiting in ARCHIVE).
2. **Install** runs Archive Manager over Wi-Fi+SSH (menu closes while working). Or install from the handheld. Plain `.zip` will not install - MustardOS packages only.

**Installed applications**: Uninstall removes permanently from handheld.

### Updates panel

MustardOS site + GitHub. Check now. MustardOS: newest release vs handheld; point releases match by build id. Update in place = Archive Manager package (keeps saves). Fresh install = System Tools image write (erases SD1 - back up saves). Apps: compare packages to GitHub releases.

## handheld - Device

Sidebar **Device** (was Device Settings). Tabs need Wi-Fi + Secure Shell.

### Settings tab

Same options as handheld Configuration screens (General, Power, Interface, Customisation, Connectivity, HDMI, overlays, Advanced, ...). List adapts by config-file presence: Jacaranda shows today's options; Andromeda (2606.0) adds Bluetooth, screensavers, passcode, web ports, Additional Cores, network proxy/retries, hotkeys, HDMI, colour schedule, overlays, remote-view detail, fonts/storage toggles, and related keys. Release badge shows MustardOS version · codename. **Use handheld ports** copies SSH/SFTP ports from the device into connection setup when they differ. Change many, save once. Each option says when it applies: immediate, next menu load, next Wi-Fi connect, or reboot. Undo last save. Search box; Advanced shows rare options. Wasabi playback, Core Management install/update, and deep Pickles hotkey editors stay on-device; related keys can appear when files exist.

### Controls tab

Live analog stick pads and button lights sampled over SSH. **Calibrate analogs** runs MustardOS experimental `joycal` (rest, then circles), review/apply `/opt/muos/share/conf/joycal.json`, or edit/remove that file. Input settings: menu stick navigation, D-pad swap, rumble. Close games before calibrating. Per-game RetroArch remaps stay in Emulation / Game Tuning / Menu+X.

### Benchmark tab

Checkboxes (default all on):

1. **Connectivity** - SSH reachability, latency, free space, uptime, battery.
2. **Storage speed** - Timed write/read of ~32 MB under `.muos-bench/` on SD1 and TF2; deleted after.
3. **CPU and thermal** - Load all cores up to ~20 s; samples usage/temperature; confirms; will not start if battery below 15%.

**Run selected**, **Run all**, **Stop**. Status, results and live log stay for the session.

## themes - Themes

Browse MustardOS theme library (theme.muos.dev), same as Theme Download on the handheld. Default: themes for your screen size; Every screen size shows all. Preview (some animated).

**Install and apply** downloads to `MUOS/theme` on SD1 and activates (menu reloads, boot logo may change). **Install** only adds. Apply waits until menus (not mid-game). **On the handheld**: list with previews; Apply; delete (permanent; active theme cannot be deleted).

### Theme Designer

Themes folder (Settings). Defaults to MustardOS **2606.0 Andromeda** (or connected device version), with 720×576 and 1920×1080 among sizes. Start blank, from library, handheld, own theme, or `.muxthm`. Autosave; Ctrl+Z / Ctrl+Shift+Z. Live preview of menus, lists, popups, keyboard, passcode, charging, boot logo. Quick style palettes; full scheme settings. Changes go to: whole theme / screen size / one screen / colour variant. Pictures, icons, fonts (lv_font_conv via npx), sounds. Export `.muxthm`; Install / Install and apply over Wi-Fi+SSH. Needs MustardOS 2601.0+ (themes as folders) for install/apply. Browse needs internet; Designer works offline.

## emulation - Emulation

### Saves

**Save games (all builds):** tar.gz of saves/states from handheld into `backups/` on this computer. Back up now; open to compare/restore all or selected. Before restore, auto backup labelled Before a restore.

**Device backups (Andromeda 2606+, backup.sh present):** `.muxbak` in ARCHIVE on the handheld (same as MustardOS Backup / Archive Manager). List, download to `backups/`, create (sections + SD1/SD2/USB, optional merge), restore on device (overwrites matching sections). TF2 setup still creates legacy `BACKUP/` for older zips; Andromeda system backups use ARCHIVE.

**Per-game save browser (Wi-Fi+SSH):** game viewer Handheld tab and Emulation > Saves note. Lists `.srm` and save states for that ROM; **Pull** to `backups/saves-pulled/`, **Push** back, delete on device, **Prune** to keep last N states. Complements tar backups and `.muxbak`; does not replace them.

### JAVA / FreeJ2ME

Andromeda: FreeJ2ME core in Pickles (external launchers removed). Older builds: Extra Cores → FreeJ2ME.

### BIOS

Some systems need BIOS (PS, Sega CD, GBA, ...). Workspace `bios/` folder only (not root). Listed by system with MD5 check. Add BIOS / drop files; **Fix names** for casing (e.g. `scph5501.bin`). **Send** to `/run/muos/storage/bios`. Trash local and/or delete on handheld (SSH).

### Cores

Emulator per ROM folder. Automatic = from folder name. Change system/core for folder; Keep games with their own core. Per-game core; Use the folder's core. Needs a system = unknown folder name (hints for Arcade/CPS/FDS/etc.). Andromeda: catalogue from `info/manifest/core.json` (+ `assign.json`); Jacaranda used `info/assign`. ROM folders: `/mnt/union/ROMS`, else `/mnt/mmc/ROMS` or `/mnt/sdcard/ROMS`.

### Systems

All known systems vs what MustardOS can run. Show all systems toggle. States: On the handheld; Pick its system; Needs an extra core (Andromeda: Configuration > Advanced > Additional Cores; older: Extra Cores); No core. Needs Wi-Fi+SSH.

### RetroArch

Per ROM folder: **Picture and play** (aspect, integer scale, smooth, shader, overlay/opacity, rewind, FPS as `.cfg` overrides) and **Core options** (Menu+X `.opt` catalogue from the handheld, curated labels when known). Scope: Only folder vs Every folder using core. Apply next game start. Non-RetroArch cores listed separately. Per-game options also in Game Tuning and the game viewer Handheld tab.

### Library check

**Verify dumps** (No-Intro): Verified / Bad dump / Not in No-Intro / Translation or hack / Not checked (.7z). Bin moves to Trash (optional art). Arcade/CD/engine not covered here.

**Disc layouts** (PlayStation): need .chd, .pbp, or complete .cue+.bin. Problem / Tip / OK. Fix... on archives; CHD on complete cues.

**Fix PlayStation archives**: wizard inspects zip/7z, may need p7zip/chdman (brew install p7zip, brew install rom-tools on Mac).

**Convert to CHD**: needs chdman on PATH. Refresh tooling in Disc layouts. Multi-disc: one .chd per disc + .m3u.

**Disc pipeline** (Disc layouts bar, or Pipeline on a row): Fix archives, Convert to CHD, Make playlist, Verify in order for the chosen games, one progress card. Steps that do not apply are skipped (no chdman, no multi-disc set, no No-Intro list for PS). Stop after this step pauses between steps; Resume continues from the step that did not finish; Cancel drops it. MCP: `disc_pipeline_start`, `disc_pipeline_status`, `disc_pipeline_control` (cancel/resume/dismiss).

**Make playlist** (Disc layouts): sibling No-Intro/Redump Disc N sheets without .m3u; preview and write; batch per system or all.

**Duplicates**: suggest keep by preferred region then good dumps; Move to Trash selected. Arcade skipped.

## files - Files

Left: this computer (workspace + remapped folders). Right: handheld SD1 and TF2 over card/USB/Wi-Fi. Pick place, open folders, path/up.

Copy to handheld / Copy to computer into open folder; confirm overwrites; appears in Transfers. New folder, rename, delete. Computer delete = Trash; handheld = permanent. Rename on handheld not over USB - use Wi-Fi or reader. Warns before changing SD1 `MUOS`. Preview: images; edit text/cfg/ini/json/txt up to 512 KB; Save / Ctrl-Cmd+S.

## logs - Logs

Manager section. Application diagnostics in workspace `logs/` (daily `manager-YYYY-MM-DD.jsonl`, ~14 days kept). Search, level/day filter, **Hide routine** (default on: drops SERVING/SCANNED/CLOSED and similar), Show more, export (txt), **Support pack** zip (logs + VERSION + connection snapshot with optional IP redaction + recent activity + platform), clear day or all, Show folder. Captures say() lines (routine tags as Info), USB/Wi-Fi/card connect edges, console.warn/error, uncaught exceptions, unhandled rejections, API 4xx/5xx and browser script errors. Separate from Overview Recent activity (user-facing change history in `.cache/activity.jsonl`).

## tuning - Game Tuning

Per-game Menu+X core options, CPU governor and cheats without changing other games. Wi-Fi+SSH; applies next start. Folder-wide options: Emulation > RetroArch. Same editor in the game viewer Handheld tab when the game is on the device. Andromeda: same manifest cores and ROM-root fallback as Emulation > Cores.

Pick system then game (Tuned badge). Any RetroArch core: full `.opt` catalogue from the handheld (curated labels for known cores). PSP: PPSSPP standalone or RA (disc ID for standalone). Every game: CPU governor. Standalone non-RA: governor only unless switched to a RetroArch core. Settings can be saved before the game is on the handheld; first save can create `.opt` from folder/core template.

Presets Fastest / Balanced / Best looking and recommendations for profiled cores; other cores show the device catalogue without presets. Save to handheld; Use folder settings. Paths: `info/config/<core>/<game>.opt`, PPSSPP `.../SYSTEM/<discID>_ppsspp.ini`, governor `info/content/<folder>/<game>.gov`.

**Recommendations**: for known heavy/light PSP and N64 titles (and system fallbacks for PS / Dreamcast), Game Tuning shows a starting preset and note. Prefer that over inventing option keys. The Assistant also gets the matched tip when a game is open in the viewer.

**Finding settings online**: there is no single official per-game RetroArch database. Point people to search the game title plus the core name (PCSX-ReARMed, Mupen64Plus-Next, Flycast, PPSSPP, Gambatte, etc.):
- Libretro docs for what each core option means: https://docs.libretro.com/
- Libretro forums (core threads and overrides): https://forums.libretro.com/
- Reddit r/RetroArch and r/SBCGaming (handheld performance tips)
- Reddit r/muOS for MustardOS-specific advice
Map community tips onto options that exist in Game Tuning / Core options; do not invent keys. Apply under Game Tuning or the game viewer Handheld tab.

**Cheats**: tick and Save cheats. RetroArch from libretro DB by filename; PPSSPP from MustardOS or DB by disc ID. Apply cheats after game load may need enabling (MustardOS default off). Remove cheats deletes RA .cht. Close game before saving cheats; cheats can break saves.

## system - System Tools

All erase the target - back up saves first (Emulation > Saves). Card reader may ask for password. Only removable cards offered.

**Install MustardOS**: write image from `os/` onto SD1 in reader. Not over Wi-Fi. Button enabled when checks pass; confirmation modal (no typing the disk id). On macOS, sudo askpass elevates `scripts/lib/flash-card.sh` (same idea as balenaEtcher — osascript admin cannot open `/dev/rdisk*`). Stages: check → authorize → prepare (clear old MBR/GPT) → write → verify → eject. Live write/verify progress; Cancel during those stages; optional skip verify (checkbox before install, or Skip verify while verifying). Card panel refreshes after steps except during write/verify (diskutil then can remount and corrupt the flash). **Add image to OS folder** / **Save into OS folder**: copy a downloaded `.img`/`.img.gz` plus SHA256 into `os/mustardos_<version>/` with `hash.txt` (version from the MustardOS file name). Day-to-day management of those releases: Library → OS.

**Set up TF2**: format exFAT named TF2 + ROMS folders. Reader or Over Wi-Fi (`/mnt/sdcard` only; never SD1). Confirmation modal (no typing). One-slot games-on-SD1 cannot use Wi-Fi path.

**Reset card**: empty FAT32 or exFAT with chosen name. Reader or Over Wi-Fi TF2. Confirmation modal (no typing).

## ssh - SSH

Browser terminal over Wi-Fi; needs Secure Shell. Quick commands, Storage, Busiest processes. Runs as root - wrong commands can brick MustardOS.

## mcp - MCP

Tools → MCP (sidebar under Terminal; `#settings/mcp` redirects here). Enable/disable the localhost Streamable HTTP MCP server (`http://127.0.0.1:<port>/mcp`). IDE configs name it `MuAnMCP` (with a short description). Reveal/copy/rotate the persistent bearer token (`.cache/mcp.json`). A separate **guest token** is read-only: it only serves an allowlist of list/read tools (status, library list/search, game, BIOS list, jobs, play activity, saves overview, cores, tuning, collections, homebrew, files list/roots, workspace, OS images, themes/apps/ports lists, agent pack list, catalogue, stats) and refuses all writes, deletes, transfers and System Tools; rotate it separately; Copy config has a guest entry per client (`MuAnMCP-guest`). Scan for installed IDEs (Cursor, Claude Desktop, Claude Code, Codex, Windsurf), auto-write their MCP config, or copy a snippet from the Copy config menu. **Clients & agents**: MCP-only skills/experts under `mcp/agents/` — Review, Copy, Install, or Install all into Cursor / Claude Code / Codex skill folders. Also `agent://` resources, `use-manager-mcp` prompt, and `agent_pack_list` / `agent_pack_get`. Tools cover library (including verify/CHD/m3u/homebrew), connection, Device Settings/Controls/Benchmark, Syncthing idle, transfers, artwork scrape/sync, play activity & collections, BIOS/saves, emulation, files, apps/ports/themes, System Tools (flash/TF2; confirm tokens required), and meta. Toggle **Assistant uses MCP tools** (Assistant dock shows an MCP chip). Green MCP chip in the top bar shows sessions, call counts and recent audit. Always `127.0.0.1` only. Not the same as developer skills in this repository's `.cursor` / `.agents` folders. In-browser EmulatorJS play stays UI-only (`play_capabilities` only).

## settings - Settings

Six tabs; subtitle describes the active tab.

### Folders

Roms folder (library) and other folders: apps, os, bios, backups, themes, logs. Change folder / Choose in Finder / Show in Finder / use default.

### Behaviour

Transfers, startup and updates (app shortcut, update check, **Show tips at start**, **Open tips** walkthrough). **Library recipes**: enable canned chains (scrape, queue copy, rescan) with a simple step editor and **Run now**. **Recipe packs** (Behaviour): import, export, run or remove shareable JSON packs whose steps set a folder/game core, apply or remove cheats, set a CPU governor or apply game tuning on the handheld (Wi-Fi + SSH; stops at the first failing step; the built-in preset is a template). MCP: `recipes_list`, `recipes_run` (two-step confirm). When the user asks to run a recipe or pack by name, call `recipes_list`, match the name to a pack id, then `recipes_run` with that id and the `confirmId` after they agree. Images: uploaded artwork size. **Idle jobs** (Behaviour): while the manager is open, a 60 second check runs one chosen recipe pack (or a Roms library rescan) when the handheld is reachable over SSH, Syncthing on it is idle, no copy runs and the cooldown (5 minutes to 7 days) has passed; off by default; settings in `.cache/idle-jobs.json`, API `GET/POST /api/idle-jobs`.

### Appearance

Theme (dark / light / match system), colour scheme presets (Mustard, Ocean, Forest, Berry, Slate, Ember) plus Create new custom scheme modal (dark/light colours, live preview; edit/delete later), zoom (50/65/85/100/110/125%), **Softer style** (pastel accents, rounder corners, airier spacing), compact layout, clock style (digital / analog widget), 12/24 format, date in the top bar, Reset to default (includes soft/compact; custom schemes kept).

### Assistant

BYOK provider (Groq, Gemini, OpenRouter, OpenAI, xAI Grok, or Custom OpenAI-compatible), API key, optional base URL for Custom, model presets or Custom model id, temperature, max tokens, include library/connection, Edit prompt, **View knowledge base** (this file, read-only). Save assistant / Clear key. Cursor has no public chat API for other apps.

### Data

Refresh game data (LaunchBox / arcade titles). Clear caches: scraper lists, device art previews, catalogues (PortMaster, market, themes, OS updates), ROM check results. **Workspace metadata** (Data): **Backup metadata** writes one passphrase-encrypted `.mumeta` file (AES-256-GCM, scrypt key) into the backups folder with settings, device profiles (with saved logins), recipe packs, idle jobs, library recipes, MCP switches (tokens left out) and small caches; never ROMs, BIOS files or artwork. **Restore metadata** needs the passphrase and a confirmation, keeps this computer's folder locations and MCP tokens, and restores idle jobs switched off. A lost passphrase cannot be recovered. API: `POST /api/workspace/backup-meta`, `POST /api/workspace/restore-meta`, `GET /api/workspace/meta-backups`.

### Resets

Activity log; View preferences (not connection/SSH snippets); Play time and Recently played on handheld (USB/Wi-Fi; irreversible); **Factory reset** - Trash chosen workspace folders + `.cache` (keys, wifi, catalogues, activity) + browser prefs, empty folders, wizard. Type RESET. Handheld untouched. External-drive folders on Mac may stay in place. Without run.sh/cmd, stops instead of restart.

## wiki - Wiki

In-app help for every section, glossary and troubleshooting. `?` opens the article for the current page. Assistant grounding is this knowledge base, not Wiki HTML.

## glossary - Glossary

- **SD1** - First card slot: MustardOS.
- **TF2** - Second slot: games (`ROMS`), art, `ARCHIVE`. One-slot devices keep OS+games on one card.
- **ROM / dump** - Game file; good dump = exact copy.
- **No-Intro** - Known-good cartridge dump list.
- **Region / Revision** - Sales region; later bugfix version.
- **Core** - Emulator program. **BIOS** - Console startup chip copy.
- **MD5 / CRC** - File fingerprints.
- **.muxapp / .muxupd** - MustardOS packages. **Archive Manager** - installs from ARCHIVE.
- **SFTP** - File copy over Wi-Fi (Andromeda Secure File Transfer / Dropbear; older SFTP + Filebrowser). **SSH** - Secure shell. **MTP** - USB file mode.
- **Save state** - Emulator snapshot (not in-game save).
- **Port / PortMaster / Runtime / Ready to run** - Native ports; installer app; shared engine; self-contained port.
- **ScummVM / .scummvm** - Adventure runner; empty list file next to data folder.

## help - Troubleshooting

**USB not found / Device Link / usblink0 / “looking for other device”**: Follow **Andromeda USB (MTP)** above (Device Link off → Wi-Fi + SSH → Device Settings → USB function MTP → unplug/replug). While USB Cable is on, MTP is paused. Also: Mac Allow accessories; try data cable/port; quit MTP grabbers (Android File Transfer, OpenMTP); or stay on Wi-Fi. Older builds: Advanced Settings → USB Function → MTP on the handheld.

**Wi-Fi “No SD1 or SD2 folder”**: Andromeda SFTP lists Primary/Secondary Storage (manager maps them to SD1/TF2). Enable Secure File Transfer under Connectivity → Web Services.

**SSH host key changed / different host key**: normal after reinstalling MustardOS. Connection panel → Remote controls → **Trust the new key**, or Terminal → **Trust the new key and connect**, or Device Settings → **Trust the new key**. Only trust if the address is still your handheld.

**Wi-Fi unreachable**: same network; handheld awake; Secure File Transfer / SFTP (+ SSH for SSH features); Find on network if address changed.

**Game won't start**: Emulation > BIOS (Fix names for PS lowercase); Disc layouts for zip/broken cue; try SwanStation/DuckStation for PS CHD black screen; try another core; Verify dumps for bad dump.

**Games/art missing on device**: correct ROMS system folder; Artwork > Sync (Scrape first); return to main menu to refresh.

**Port won't install**: handheld needs its own internet; return to main menu; check Ports last PortMaster line; black screen often needs Add game files.

**ScummVM not recognised**: matching `.scummvm` and data folder names; data files not nested extra folder; some engines missing on device (free games work).

**Wrong token**: each manager start gets a new URL; reopen from `run.sh` / printed address.

## assistant - Assistant limits and setup

### Opening chat

After API key under Settings > Assistant: mustard button bottom-right or **Assistant** in top bar. Clear next to Send wipes history on this computer. Markdown replies with timestamps.

### Settings > Assistant

Provider: Groq, Gemini, OpenRouter (often free), OpenAI, xAI Grok (paid BYOK), or Custom (OpenAI-compatible base URL). API key in `.cache/chat.json` mode 600; Model presets or Custom…; temperature; max tokens; library/connection toggles; Edit prompt (default preferred); View knowledge base (read-only).

Free keys: Groq console.groq.com (`openai/gpt-oss-20b` default, `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`); Google AI Studio Gemini Flash; OpenRouter `:free` or `openrouter/free`. Paid: OpenAI platform.openai.com (`gpt-4.1-mini` and peers); xAI console.x.ai (`grok-4.7` and peers). Custom needs base URL + key + model id. Cursor does not expose a public chat API — use OpenAI, xAI, or Custom. Rate/spend limits — wait or switch.

### Good at

Manager UI from this knowledge base + current section; selected handheld model (name, chip, screen, Wi-Fi); Roms library and LaunchBox when included; open-game description / library recommendations / Game Tuning tip; connection status without passwords.

### Must not

Invent walkthroughs/spoilers (point to GameFAQs/StrategyWiki/game wiki); invent UI not in this guide; ask for/repeat API keys, passwords or MCP bearer tokens.

### MCP tools (when enabled)

When Tools → MCP is on and **Assistant uses MCP tools** is on, prefer calling manager tools for live reads and for actions the user asked for. Use tools instead of guessing connection status, library contents, Device Settings/Controls/Benchmark, artwork, play/collections, jobs, files, apps/themes, BIOS/saves, System Tools, copy, delete, and similar. Do not only name a sidebar section when a tool can answer or act. Report results briefly. Destructive tools (including `system_start`, deletes, settings writes) are irreversible — only when clearly requested; Destructive tools (game_delete, artwork_local_delete, artwork_delete_device, bios_delete, saves_game_delete, saves_game_prune_states, muxbak_restore, files_delete, ports_uninstall, themes_delete, checks_trash, play_reset, collections_delete, recipes_run, syncthing_conflict_resolve, system_start) are two-step: the first call changes nothing and returns `{needsConfirm, confirmId, summary}`; tell the user the summary and repeat the same arguments plus `confirmId` only after they agree (5 minute, one-use token; `dryRun:true` previews again). System Tools still accept `confirm` matching the card id or `TF2` for Wi-Fi TF2, or a `confirmId` from a call without `confirm`. Do not start EmulatorJS play from tools. If tools are not available this turn, name the manager section instead of claiming you changed the handheld.
