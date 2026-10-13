# AGENTS.md

Guide for coding agents (Cursor, Claude Code, Codex, ...) and contributors working on this repository.

## What this is

muOS Anbernic Manager: a local web app that manages Anbernic and TrimUI handhelds running MustardOS (muOS).
A Node.js server (`src/`, TypeScript run directly by Node 23.6+, no build) serves a plain ES-module front end
(`public/`) on `127.0.0.1` with a per-run token. It manages the user's `Roms/` library and artwork, and talks
to the handheld over a card reader, USB (MTP via libmtp) or Wi-Fi (SFTP + SSH).

**Read [docs/architecture.md](docs/architecture.md) first**: module map, request flow, device access and the
MustardOS paths the code relies on. Each source file opens with a comment saying what it does.

## Commands

```bash
npm install                 # once; run.sh does it too
npm test                    # all tests (node --test test/*.test.ts)
npm run check               # TypeScript type check (tsc --noEmit)
node --test test/unit.test.ts --test-name-pattern "VERSION"   # one file / matching tests
node --check public/js/<file>.js                              # syntax of a front-end module
bash -n run.sh installer.sh scripts/common.sh                 # shell syntax (Windows twins: *.ps1, see shell-scripts rule)
./run.sh                    # start the manager (port 8765)
```

## Ground rules

1. **Never write to a handheld or a card unless the user asked for that action.** Tests and manual checks use
   a temp workspace and cache, never the real device. Deletes on the device are permanent; local deletes go to
   the Trash. System Tools must only ever offer removable cards.
2. **Never commit secrets or user data**: `.cache/` (Wi-Fi/SSH logins, settings), keys, passwords, ROMs.
3. **Version numbers are set by hand.** Do not change `VERSION`, `package.json` or `package-lock.json`
   versions unless the user gives the new number. Prefer minor bumps; major is for big or breaking changes.
4. **Keep files ASCII** and match the surrounding style: short functions, comments only for constraints the
   code cannot show, user-facing text in plain words (the wiki is written for non-technical users).
5. **TypeScript must stay erasable** (Node type stripping): no `enum`, `namespace`, parameter properties or
   decorators; use `import type`; import local files with the `.ts` extension.
6. **No new runtime dependencies** without a strong reason; the front end has none.
7. **Every feature change updates its test and its wiki article** (`public/js/wiki.js`), and the README when
   users would notice.

## Where to change things

| Task | Server | Client |
| --- | --- | --- |
| New API call | add to `routes` in `src/server.ts`, logic in its own module | `api("path", body)` from `core.js` |
| New section or tab | - | module in `public/js/`, `view-<name>` in `index.html`, `SECTIONS` in `core.js`, `TITLES` and `showSection` in `app.js` |
| New dialog | - | `<dialog>` in `index.html`, its module fills it; add its ids to the list in `test/server.test.ts` |
| Device files | `withTarget` + `DeviceFs` (`src/device/`) | `device.js` for state |
| Handheld command | `runCommand` in `src/device/ssh.ts` | - |
| Settings toggle | `Settings` + `DEFAULTS` + `loadSettings` + `saveSettings` in `src/settings.ts` | `toggle(...)` in `settings.js` |

## Cursor

`.cursor/rules/` holds the rules (always-on: project, safety, versioning; per-area: server, front end,
tests, shell scripts). `.cursor/skills/` holds task guides: `manager-feature-workflow`,
`manager-testing`, `muos-device-expert`, `manager-release`.
