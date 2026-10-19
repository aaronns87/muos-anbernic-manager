# Assistant knowledge base

Ground truth for the in-app assistant. Prefer this over memory. Do not invent UI, buttons, tabs or menus that are not described here.
Live CONTEXT may also include connection status and Roms library matches - use those when present.
People can open the same guide read-only under Settings > Assistant > View knowledge base.

## start - Getting started

muOS Anbernic Manager runs on this computer (Mac, Linux or Windows) and looks after Anbernic or TrimUI handhelds on MustardOS (muOS): games in `Roms/`, box art, apps and updates, saves, BIOS, emulator choices and the handheld's own settings. Everything happens in a browser tab; keep the terminal that started the manager open.

### Sidebar

- **Library** - Games, Play, Artwork
- **Handheld** - Apps, Device, Themes, Emulation, Files, Game Tuning
- **Tools** - System Tools, SSH
- **Manager** - Settings, Wiki (chat opens from the top bar or mustard button after an API key is saved)

### Install and setup wizard

- Installer: `./muos-anbernic-manager/installer.sh` (macOS/Linux) or `installer.cmd` (Windows). Checks Node.js and packages, can install Node via Homebrew/winget and libmtp on Mac for USB. Creates workspace folders `Roms/`, `apps/`, `os/`, `bios/`, `backups/`, `themes/` (existing files left alone).
- Offers an **app shortcut** (Applications / Start menu / app menu). Shortcut opens a terminal that runs the manager; closing the window stops it. Settings > Behaviour can add the shortcut again after moving the folder.
- First start with a clean cache opens the **setup wizard** (model, folders, connection, optional game data download and shortcut). Skip setup closes it; Settings can open Run setup again.
- Start later with the shortcut, `./muos-anbernic-manager/run.sh` or `run.cmd`.
- **Updates**: version next to the clock becomes Update when GitHub has a newer one. Update now uses git pull or ZIP swap, then restarts. Settings can turn the check off. After update, **What's new** shows once from CHANGELOG.md.

### Three ways to connect

1. **Card reader** - TF2 games card (or the only card on one-slot models) in this computer. Fastest for many games. Needed for Install MustardOS and for card wipes from a reader.
2. **USB** - On the handheld: Configuration > Advanced Settings > USB Function > **MTP**, then plug in.
3. **Wi-Fi** - Same network. Enable **SFTP + Filebrowser** for files. Enable **Secure Shell** for apps, themes, Device, cores, BIOS, Game Tuning, TF2-over-Wi-Fi tools and SSH. Set address under Overview > Wi-Fi settings (or Find on network). Wake the handheld; sleep drops Wi-Fi.

USB and Wi-Fi can both be up. Top-bar connection chip shows every live link and opens the connection panel (primary path for copies, reconnect, Wi-Fi setup). Game copies use one primary path at a time.

### How the model is known

- USB: handheld reports model name.
- Wi-Fi: read from MustardOS (SFTP or SSH).
- Card reader: card cannot say; SD1 play records often can; otherwise ask once and remember. Change next to Handheld in Overview asks again.
- Nothing connected: model picker under the logo. While connected, reported model cannot be changed.

### What needs which connection

| Feature | Needs |
| --- | --- |
| Copy games, artwork, packages; Files | Card reader, USB or Wi-Fi |
| Play time, Recently played, Collections | USB or Wi-Fi (live on SD1 inside handheld) |
| Install/uninstall apps, Device (settings + controls + benchmark), Themes, Ports, Saves, BIOS, Cores, RetroArch, Game Tuning, SSH | Wi-Fi with Secure Shell on |
| Install MustardOS or wipe a card in a reader | Card reader |
| Set up TF2 / Reset card on TF2 | Card reader, or Wi-Fi with SSH |
| Library check, Updates, App market downloads, adding to Roms/ | This computer only |

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

- `1`-`9`: first nine sidebar sections (Overview to Files); `0`: Wiki.
- `?`: help for current page. `[`: fold sidebar.
- Games: `/` search, `S` select mode, arrows in game viewer.
- Tab bars: Left/Right to change tabs, Home/End for first/last. Tab to Skip to content to bypass navigation.

## overview - Overview

Home page: whether the handheld is connected and how (card reader, USB or Wi-Fi), free space, how many systems have games and artwork, empty systems, MustardOS images in `os/`, apps with updates. Top-bar chip opens the connection panel; Overview is the full connection page.

**Wi-Fi settings**: enter the handheld address (Configuration > Wi-Fi Network on the handheld). Address can change after reconnect; **Find on network** searches again. Optional Filebrowser link when SFTP is up.

**Recent activity**: last copies, deletes, settings, installs, failures. Show all opens the full log with search and warning/error filter. Log lives in the manager cache (last few thousand entries). Clear from Settings > Resets.

## games - Games

### Library

Every game under `Roms/<SYSTEM>/`, grouped by system, with box art and LaunchBox descriptions when game data is downloaded. Controls: grid/list, Empty systems, expand/collapse all, card size slider.

### Finding and selecting

Search matches titles, file names, regions, systems. Filters: platform, genre, year. **Roms/ library** vs **On TF2** switches computer vs handheld card. **Select** (or `S`) then Transfer, Trash, or delete from TF2.
On phones, **Filters** reveals filters and the card-size slider and shows the active filter count. Hiding it keeps the selections. Wider screens always show the filters.

### Copying and Transfers

Picked games (with art) copy into handheld `ROMS` over the active connection. FAT32 warns before files over 4 GB. **Transfers** panel: running copy (progress, speed, ETA, current file), queue, history; stop or dequeue; minimise or hide from top bar. History persists until cleared. USB: one copy at a time.

### Add games

**Add games** drops files into the right system folder and looks up description/art.

### ScummVM

Folder of data files, not one ROM. Drop folder on Add games or Choose a ScummVM game folder -> `Roms/SCUMMVM/<Name>.scummvm` plus data in `Roms/SCUMMVM/.<Name>/` (also `_Name` or `Name`). Copy/delete always takes the data folder. **Free games** downloads freeware from scummvm.org into Roms/SCUMMVM. Saves stay on handheld save folder, not in the game folder.

### Ports (PortMaster)

Ports are native PC ports. Games > Ports shows what PortMaster installed on the handheld (not Roms/PORTS files). Needs Wi-Fi + SSH.

- Browse PortMaster library; **Runs on this handheld** / **Ready to run** filters.
- **Install** asks handheld PortMaster to download (handheld needs internet). Return to main menu first. Runs in background.
- **Needs game files**: after install, Add game files copies into the folder the port docs name.
- **Remove** deletes port folder, script, art and added game files permanently.
- Ports land on TF2 `/mnt/sdcard/ports` when present, else SD1. Files in `Roms/PORTS` on the computer are not copied.

### Game viewer

Click a game: artwork, year, genre, players, rating, library-check tags, BIOS, other versions. Arrows step games. With handheld: on-device?, core, play time, saves; one-click system fix when needed.

Tabs: **About** (description, YouTube, Write your own in `Roms/<SYSTEM>/Text/`); **Details** (DB, file size/CRC, check, BIOS, Rename); **Handheld** (core, Menu+X core options when the game is on the handheld and starts RetroArch or PPSSPP, play stats, collections, saves, Open Game Tuning, Read again); **Related**. Drop image or Replace artwork. Show in Finder/Explorer.

### Deleting

Computer: Trash, optional art. Handheld card: permanent.

## play - Play

Needs USB or Wi-Fi (data on SD1). Games card alone is not enough.

**Play time**: MustardOS activity tracking (on by default). Totals, launches, sort by most/last played, launches, name. Box art from Roms when present. Refresh after playing (written when leaving a game).

**Recently played**: MustardOS history, newest first.

**Collections**: handheld playlists under Collections in its menu. Create, rename, delete, add/remove games. Add games searches Roms but only offers titles already on the handheld (collections point; they do not copy). Removing from a collection never deletes the game. Changes show after returning to main menu. USB rename copies entries to a new folder (USB cannot rename).

## artwork - Artwork

Pictures next to games in MustardOS menus. Computer: `Roms/<SYSTEM>/Imgs/` named like the game. Handheld: MustardOS catalogue.

Tabs: **Sync** (copy missing either way); **Roms/ library** (coverage per system); **On device**; **Scrape** (download missing from online DBs). Routine: add games, Scrape, Sync. Upload size: Settings > Behaviour > Uploaded artwork size.

## apps - Apps

Packages: `.muxapp` apps, `.muxupd` updates/add-ons, `.muxzip` bundles. Live in `apps/` folder (market, Add packages, or drag).

### App market

Popular apps (Scrappy, Artie, Grout, Bluetooth, ...) with screenshots, stars, notes, GitHub links. Filter to what runs on the model; badges for wrong handheld, abandoned, pre-release. **Get** downloads the right package for model/MustardOS. Send or Send and install. Reinstall from About. List refreshes every 12h; Refresh forces. Apps are third-party - read the page before install.

### Send then install

1. **Send** copies to handheld `ARCHIVE` (Waiting in ARCHIVE).
2. **Install** runs Archive Manager over Wi-Fi+SSH (menu closes while working). Or install from the handheld. Plain `.zip` will not install - MustardOS packages only.

**Installed applications**: Uninstall removes permanently from handheld.

### Updates panel

MustardOS site + GitHub. Check now. MustardOS: newest release vs handheld; point releases match by build id. Update in place = Archive Manager package (keeps saves). Fresh install = System Tools image write (erases SD1 - back up saves). Apps: compare packages to GitHub releases.

## handheld - Device

Sidebar **Device** (was Device Settings). Tabs need Wi-Fi + Secure Shell.

### Settings tab

Same options as handheld Configuration screens (General, Power, Interface, Customisation, ...). Change many, save once. Each option says when it applies: immediate, next menu load, next Wi-Fi connect, or reboot. Undo last save. Search box; Advanced shows rare options.

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

Themes folder (Settings). Start blank, from library, handheld, own theme, or `.muxthm`. Autosave; Ctrl+Z / Ctrl+Shift+Z. Live preview of menus, lists, popups, keyboard, passcode, charging, boot logo. Quick style palettes; full scheme settings. Changes go to: whole theme / screen size / one screen / colour variant. Pictures, icons, fonts (lv_font_conv via npx), sounds. Export `.muxthm`; Install / Install and apply over Wi-Fi+SSH. Needs MustardOS 2601.0+ (themes as folders) for install/apply. Browse needs internet; Designer works offline.

## emulation - Emulation

### Saves

Backup save games and states from handheld to `backups/` (one archive each). Back up now; open backup to compare/restore all or selected. Before restore, auto backup labelled Before a restore.

### BIOS

Some systems need BIOS (PS, Sega CD, GBA, ...). Workspace `bios/` folder only (not root). Listed by system with MD5 check. Add BIOS / drop files; **Fix names** for casing (e.g. `scph5501.bin`). **Send** to `/run/muos/storage/bios`. Trash local and/or delete on handheld (SSH).

### Cores

Emulator per ROM folder. Automatic = from folder name. Change system/core for folder; Keep games with their own core. Per-game core; Use the folder's core. Needs a system = unknown folder name (hints for Arcade/CPS/FDS/etc.).

### Systems

All known systems vs what MustardOS can run. Show all systems toggle. States: On the handheld; Pick its system; Needs an extra core (Config > Advanced > Extra Cores on newer muOS); No core. Needs Wi-Fi+SSH.

### RetroArch

Per ROM folder: **Picture and play** (aspect, integer scale, smooth, shader, overlay/opacity, rewind, FPS as `.cfg` overrides) and **Core options** (Menu+X `.opt` catalogue from the handheld, curated labels when known). Scope: Only folder vs Every folder using core. Apply next game start. Non-RetroArch cores listed separately. Per-game options also in Game Tuning and the game viewer Handheld tab.

### Library check

**Verify dumps** (No-Intro): Verified / Bad dump / Not in No-Intro / Translation or hack / Not checked (.7z). Bin moves to Trash (optional art). Arcade/CD/engine not covered here.

**Disc layouts** (PlayStation): need .chd, .pbp, or complete .cue+.bin. Problem / Tip / OK. Fix... on archives; CHD on complete cues.

**Fix PlayStation archives**: wizard inspects zip/7z, may need p7zip/chdman (brew install p7zip, brew install rom-tools on Mac).

**Convert to CHD**: needs chdman on PATH. Refresh tooling in Disc layouts. Multi-disc: one .chd per disc + .m3u.

**Duplicates**: suggest keep by preferred region then good dumps; Move to Trash selected. Arcade skipped.

## files - Files

Left: this computer (workspace + remapped folders). Right: handheld SD1 and TF2 over card/USB/Wi-Fi. Pick place, open folders, path/up.

Copy to handheld / Copy to computer into open folder; confirm overwrites; appears in Transfers. New folder, rename, delete. Computer delete = Trash; handheld = permanent. Rename on handheld not over USB - use Wi-Fi or reader. Warns before changing SD1 `MUOS`. Preview: images; edit text/cfg/ini/json/txt up to 512 KB; Save / Ctrl-Cmd+S.

## tuning - Game Tuning

Per-game Menu+X core options, CPU governor and cheats without changing other games. Wi-Fi+SSH; applies next start. Folder-wide options: Emulation > RetroArch. Same editor in the game viewer Handheld tab when the game is on the device.

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

**Install MustardOS**: write image from `os/` onto SD1 in reader, verify. Not over Wi-Fi.

**Set up TF2**: format exFAT named TF2 + ROMS folders. Reader or Over Wi-Fi (`/mnt/sdcard` only; never SD1). One-slot games-on-SD1 cannot use Wi-Fi path.

**Reset card**: empty FAT32 or exFAT with chosen name. Reader or Over Wi-Fi TF2. Confirm by typing disk id or TF2.

## ssh - SSH

Browser terminal over Wi-Fi; needs Secure Shell. Quick commands, Storage, Busiest processes. Runs as root - wrong commands can brick MustardOS.

## settings - Settings

Five tabs; subtitle describes the active tab.

### Folders

Roms folder (library) and other folders: apps, os, bios, backups, themes. Change folder / Choose in Finder / Show in Finder / use default.

### Behaviour

Transfers, startup and updates (app shortcut, update check). Appearance, clock/date format, uploaded artwork size.

### Assistant

BYOK provider, API key, model (Custom model id only when Custom...), temperature, max tokens, include library/connection, Edit prompt, **View knowledge base** (this file, read-only). Save assistant / Clear key.

### Data

Refresh game data (LaunchBox / arcade titles). Clear caches: scraper lists, device art previews, catalogues (PortMaster, market, themes, OS updates), ROM check results.

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
- **SFTP** - File copy over Wi-Fi (SFTP + Filebrowser). **SSH** - Secure shell. **MTP** - USB file mode.
- **Save state** - Emulator snapshot (not in-game save).
- **Port / PortMaster / Runtime / Ready to run** - Native ports; installer app; shared engine; self-contained port.
- **ScummVM / .scummvm** - Adventure runner; empty list file next to data folder.

## help - Troubleshooting

**USB not found**: set USB Function to MTP; unplug after boot and replug; Mac Allow accessories; try data cable/port; quit MTP grabbers (Android File Transfer, OpenMTP); or use Wi-Fi.

**Wi-Fi unreachable**: same network; handheld awake; SFTP (+ SSH for SSH features); Find on network if address changed.

**Game won't start**: Emulation > BIOS (Fix names for PS lowercase); Disc layouts for zip/broken cue; try SwanStation/DuckStation for PS CHD black screen; try another core; Verify dumps for bad dump.

**Games/art missing on device**: correct ROMS system folder; Artwork > Sync (Scrape first); return to main menu to refresh.

**Port won't install**: handheld needs its own internet; return to main menu; check Ports last PortMaster line; black screen often needs Add game files.

**ScummVM not recognised**: matching `.scummvm` and data folder names; data files not nested extra folder; some engines missing on device (free games work).

**Wrong token**: each manager start gets a new URL; reopen from `run.sh` / printed address.

## assistant - Assistant limits and setup

### Opening chat

After API key under Settings > Assistant: mustard button bottom-right or **Assistant** in top bar. Clear next to Send wipes history on this computer. Markdown replies with timestamps.

### Settings > Assistant

Provider (Groq, Gemini, OpenRouter); API key in `.cache/chat.json` mode 600; Model presets or Custom...; temperature; max tokens; library/connection toggles; Edit prompt (default preferred); View knowledge base (read-only).

Free keys: Groq console.groq.com (`openai/gpt-oss-20b` default, `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`); Google AI Studio Gemini Flash; OpenRouter `:free` or `openrouter/free`. Rate limits - wait or switch.

### Good at

Manager UI from this knowledge base + current section; selected handheld model (name, chip, screen, Wi-Fi); Roms library and LaunchBox when included; open-game description / library recommendations / Game Tuning tip; connection status without passwords.

### Must not

Invent walkthroughs/spoilers (point to GameFAQs/StrategyWiki/game wiki); claim to format cards, wipe disks, install OS or change the handheld (name the section instead); ask for/repeat API keys or passwords; invent UI not in this guide.
