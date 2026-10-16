# Architecture

A map of the code for contributors and coding agents: where things live, how a request flows, and the
MustardOS facts the code relies on. Read this instead of scanning the tree. Each source file starts with a
comment saying what it does; `rg -n "^// " src/<file>` shows it.

## Shape

- **Server**: Node.js 23.6+ running TypeScript directly (type stripping, no build). Entry `src/main.ts`.
  Plain `node:http` server on `127.0.0.1`, JSON API under `/api/`, static files from `public/`.
- **Client**: plain ES modules in `public/js/`, one HTML file `public/index.html`, one stylesheet
  `public/css/app.css`. No framework, no bundler, no npm packages in the browser except xterm.js
  (served from `node_modules/@xterm` at `/vendor/xterm/`).
- **Dependencies** (`package.json`): `ssh2` (SFTP and SSH), `koffi` (libmtp FFI for USB), `yauzl` (zips),
  `saxes` (XML), `@xterm/*` (terminal). Dev: `typescript` for `npm run check` only.
- **Workspace**: the folder above `muos-anbernic-manager/` holds `Roms/`, `apps/`, `os/`, `bios/`,
  `backups/`, `themes/` (each can be moved in Settings). `.cache/` inside the manager folder holds settings,
  logins and downloads.

## Startup (`src/main.ts`)

1. Parse flags (`--root`, `--cache-dir`, `--tf2-dir`, `--port`, `--no-open`, `--skip-descriptions`,
   `--init`, `--workspace`, `--shortcut`, ...). `--init` creates the workspace folders and exits, and `--shortcut`
   adds the app shortcut and exits (both used by `installer.sh` and `installer.ps1`).
2. `loadSettings()` (`src/settings.ts`): reads `.cache/settings.json`, or `settings-<hash>.json` when
   `--root` differs from the default. A clean cache marks the setup wizard pending.
3. Stop a previous manager for the same workspace (`instance-<hash>.json` + `POST /api/shutdown`) and take
   over its port and token, so an open tab keeps working.
4. Download arcade names and LaunchBox descriptions if missing (`src/games/metadata.ts`), scan `Roms/`
   (`src/games/library.ts`), then `listen()` and open the browser with `?token=...`.
5. Exit code 75 means "restart me" (after a self-update); `run.sh` and `run.ps1` (Windows, through `run.cmd`) loop on it.

## Request flow (`src/server.ts`)

- `routes` is one object: `"METHOD /api/path": (query: URLSearchParams, body, req) => result`.
- Every `/api/` call needs header `X-Manager-Token` (a few image routes accept `?token=`). POST bodies must
  be `Content-Type: application/json`.
- Throw `UserError` (`src/errors.ts`) for anything the user should read: it becomes HTTP 400 `{ error }`.
  Other exceptions become 500. `SshError` adds `code` and `fingerprint`.
- Return `{ raw }` for pre-serialised JSON, `{ image, name }` for image bytes, anything else is JSON.
- Host header must be `127.0.0.1:<port>` or `localhost:<port>`; WebSocket only for `/api/ssh/socket`.

## Server modules (`src/`)

| Area | Files |
| --- | --- |
| Entry, context, settings | `main.ts`, `context.ts` (`ctx` paths, `setRoot`), `settings.ts` (settings, folder browser, workspace creation, cache upkeep), `shortcut.ts` (the app shortcut in Applications, the Start menu or the app menu) |
| HTTP | `server.ts`, `ws.ts` (WebSocket for the SSH terminal) |
| Logging | `log.ts` (`say(badge, LABEL, message)` prints and records to the activity log), `activity.ts` |
| Jobs and locks | `jobs.ts`: background jobs, one running at a time with the rest queued (`startJob`, `cancelJob`, `requireIdle`, `requireQueueable`, `locks.system`), a history of finished jobs in `.cache/transfers.json`; copy plans |
| Games library | `games/library.ts` (scan, in-memory library), `games/systems.ts` (ROM folders), `games/metadata.ts` (mamenames, LaunchBox index), `games/add.ts`, `games/actions.ts` (delete), `games/engines.ts` (ScummVM folders), `games/free-scummvm.ts` |
| Workspace | `workspace.ts`, `files.ts` (file explorer, local deletes go to the Trash) |
| Artwork | `artwork.ts` (Roms/Imgs <-> device catalogue), `artwork-tools.ts`, `scrape.ts` (thumbnails.libretro.com) |
| Device access | `device/target.ts` (which device; `withTarget`), `device/fs.ts` (`DeviceFs`, `CardFs`), `device/mtp.ts` (libmtp via koffi), `device/sftp.ts` (`SftpFs`, Wi-Fi), `device/ssh.ts` (`runCommand`, terminal, stats, power), `device/model.ts`, `device/content.ts`, `device/muos-settings.ts`, `catalogue.ts` (MustardOS layout constants) |
| Theme Designer | `theme-designer.ts` (themes in `ctx.themes`: scheme files, uploads checked by kind, fonts via `lv_font_conv`, create/import/rename/duplicate, `.muxthm` packing, install through `themes.ts`), `zip.ts` (zip writer, safe unzip) |
| Handheld features over SSH | `apps.ts`, `themes.ts`, `ports.ts`, `cores.ts`, `retroarch.ts`, `bios.ts`, `saves.ts`, `play.ts`, `tuning/` (Game Tuning: `profiles.ts` settings and presets, `disc-id.ts` PSP disc IDs, `tuning.ts` per-game files, `cheats.ts` libretro cheat database and per-game cheat files) |
| Checks and updates | `checks.ts` (No-Intro verify, duplicates), `updates.ts` (MustardOS releases, app releases), `app-market.ts` (curated apps from GitHub release feeds, ranked for the chosen handheld), `manager-update.ts` (the manager's own version and self-update) |
| System Tools (cards) | `system/cards.ts` (removable disks only), `system/image.ts`, `system/ops.ts`, `system/tf2-wifi.ts` (TF2 setup/reset over SSH), `system/flash-helper.ts` (runs as root to write a card) |
| Assistant (BYOK chat) | `chat.ts` (`.cache/chat.json` key, Groq/Gemini/OpenRouter, context from `docs/assistant-wiki.json` + library + connection); UI `public/js/chat.js` (FAB + dock, Markdown replies) |
| What's new | `whats-new.ts` (`.cache/seen-version` vs `VERSION`, parse `CHANGELOG.md`); UI `public/js/whats-new.js` |
| Platform | `platform/index.ts` picks `darwin.ts` / `linux.ts` / `win32.ts` (`Platform` in `types.ts`): volumes, USB handheld, Trash, open URL, libmtp paths; `run.ts` (`run(cmd, args)` never throws) |
| Helpers | `util.ts` (`inside`, `safePart`, `exists`, `listDir`, ...), `tar.ts`, `errors.ts` |

`public/js/devices.js` (the handheld list) is imported by both the server and the browser; keep it free
of DOM and Node APIs.

## Client modules (`public/js/`)

- `app.js` starts everything: section switching by `location.hash` (`SECTIONS` in `core.js`), shared
  buttons, keyboard shortcuts, first loads (`loadLibrary`, `refreshDevice`, `checkWizard`,
  `startManagerChecks`).
- `core.js`: `$`, `api(path, body)` (adds the token, throws `Error(message)` on 4xx/5xx), `esc`, `icon`,
  `ICONS`, `store` (localStorage `manager.*`), `app` (shared state), `toast`, `plural`, `human`, model helpers.
- `combo.js`: filterable dropdowns for `<input data-combo="key">` (choices from `comboItems`) and long `<select data-combo>` lists.
- `device.js`: connection state, mode (`card` / `usb` / `wifi`), the status bar (`renderStatusbar`).
- One module per section: `overview.js`, `games.js`, `play.js`, `artwork-view.js` (+ `art-*.js`), `apps.js`
  (+ `updates.js`), `handheld.js`, `themes.js` (Designer tab: `theme-designer.js` editor and preview, `theme-assets.js` file panels, `theme-preview.js` canvas renderer, `theme-schema.js` every scheme setting), `emulation.js` (+ `bios.js`, `cores.js`, `emu-systems.js`,
  `system-notes.js`, `retroarch.js`, `saves.js`, `checks.js`), `files.js`, `tuning.js` (with `tuning-cheats.js`), `system.js`, `ssh.js`, `settings.js`, `wiki.js`, `chat.js` (assistant dock).
- Dialogs: `<dialog>` elements in `index.html` (header `.help-head`, body, footer `.fv-foot`), filled by
  their module: `add-games.js`, `ports.js`, `free-scummvm.js`, `wizard.js`, `model-pick.js`,
  `manager-update.js`, `activity.js`. The library game viewer is opened by `games.js` and filled by
  `game-view.js` (status cards, tabs, related games), which reads `GET /api/game` and the handheld's play,
  collections, cores and saves lists, kept for two minutes across games.
- `wiki.js`: `ARTICLES` = `[id, icon, title, section, summary, [[heading, html], ...]]`; the `?` button opens
  the article for the current section.

## Device access

The handheld runs MustardOS. The manager reaches it three ways, chosen by the user (`app.ui.mode`):

| Mode | Code | What works |
| --- | --- | --- |
| Card reader | `CardFs` on the mounted TF2 card (or SD1 on one-slot models); `system/cards.ts` for raw disks | files, games, artwork; System Tools (install, TF2, reset) |
| Wi-Fi SSH | `runCommand` / `storage.sh` on the handheld | System Tools Set up TF2 and Reset card (never SD1) |
| USB (MTP) | `device/mtp.ts` via libmtp; vendor `0x1d6b`, product `0x0100` | files, games, artwork, play data |
| Wi-Fi | `device/sftp.ts` (SFTPGo, port 2022, `muos`/`muos`) and `device/ssh.ts` (port 22, `root`/`root`) | everything; SSH is needed for apps, themes, ports, settings, cores, saves, BIOS |

`withTarget(volume, (t) => ...)` gives a `Target`: `t.roms` (where ROMs go), `t.arts` (artwork
catalogues, preferred first), `t.all` (every readable storage by label). All three implement `DeviceFs`.

MustardOS layout the code relies on:

- SD1 is `/mnt/mmc`, TF2 (SD2) is `/mnt/sdcard`. Games are in `ROMS/<SYSTEM>/` on TF2, or on SD1 for
  one-slot models.
- Artwork: `MUOS/info/catalogue/<Catalogue name>/{box,preview,splash}/<rom stem>.png`, read from TF2 when that
  folder exists there, otherwise SD1. Names per ROM folder are in `CATALOGUES` (`src/catalogue.ts`).
- Play data on SD1: `MUOS/info/track/playtime_data.json`, `MUOS/info/history`, `MUOS/info/collection`.
- Options: one-line files under `/opt/muos/config`; core assignment under `/opt/muos/share/info/content`.
- Saves and BIOS: `/run/muos/storage/save`, `/run/muos/storage/bios`. Themes: `MUOS/theme` on SD1.
  Packages go to `ARCHIVE` and install with Archive Manager's script; ports use the handheld's PortMaster.

## Data kept on this computer (`.cache/`)

`settings*.json` (folders, toggles, wizard state), `wifi.json` and `ssh.json` (logins, mode 600),
`instance-*.json` (running port and token), `mamenames.xml`, `metadata-index.json` (LaunchBox, ~100 MB),
`activity.jsonl`, `transfers.json`, `rom-crc.json`, `checks.json`, `dats/`, `thumbnails/`, `themes/`, `ports/`,
`updates.json`, `device-art/`. Never commit any of it.

Settings > Cache and History and resets clear parts of it through `POST /api/settings/clear-cache`
(`thumbnails`, `deviceArt`, `catalogues`, `checks`, `activity`); each owning module exposes a `clear*`
function that also drops its in-memory copy. Logins, settings and the big downloads are not cleared there.
`POST /api/play/reset` (`time` writes `{}` to the tracker, `history` deletes `MUOS/info/history/*.cfg`)
changes the handheld, and View preferences only removes this browser's `manager.*` localStorage keys.

Factory reset (`POST /api/settings/factory-reset`, body `{confirm: "RESET", folders}`) trashes the chosen
workspace folders (never a drive root, the home folder, the manager or cache folder; on macOS a folder on
another device than `~/.Trash` is kept), then renames `.cache/` to `manager-cache-<time>` and trashes it.
It keeps the `instance-*.json` files so the restarted process reuses the port and token, saves fresh
settings with the wizard pending, recreates the default workspace and restarts through the exit-75 loop
(or stops when not started by `run.sh` / `run.ps1`). The page clears its `manager.*` and `library.*`
localStorage keys and reloads once `/api/manager` reports a new start time.

## Self-update (`src/manager-update.ts`, `public/js/manager-update.js`)

`VERSION` is compared with `https://raw.githubusercontent.com/<repo>/main/VERSION` (repo from
`package.json` `repository`) at most every 3 hours. A git clone updates with `git pull --ff-only origin main`;
a downloaded copy swaps in the files of GitHub's ZIP of `main` (old ones in `.update-old/`). Then the process
exits with code 75 and `run.sh` restarts it. After that restart, `whats-new.ts` compares `VERSION` to
`.cache/seen-version` and may open the What's new dialog once. Versions are set by hand; see `.cursor/rules/versioning.mdc`.
