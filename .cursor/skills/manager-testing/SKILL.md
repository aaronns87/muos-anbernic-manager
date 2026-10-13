---
name: manager-testing
description: How to test muOS Anbernic Manager - automated tests (node:test, server and headless-browser tests), type checks, and manual checks on an isolated temp server with a fake TF2 card, plus cleanup. Use when writing or running tests, verifying a change, debugging a failing test, or checking UI in a browser.
---

# Testing the manager

## Automated

```bash
npm test                                   # everything; browser tests skip without Chrome
npm run check                              # tsc over src/ and test/
node --test test/server.test.ts            # one file
node --test --test-name-pattern "wizard" test/*.test.ts
CHROME_PATH=/path/to/chrome npm test       # browser tests with a specific Chrome
```

- `test/helpers.ts`: `startServer(roms)` boots `src/main.ts` with `--no-open` on a free port, a throwaway
  workspace (`roms` = `{ SYSTEM: [file names] }`) and cache; returns `{ base, token, root, api, stop }`.
  Stop it in `t.after()`.
- Unit tests that use `ctx`: point `setRoot()` / `ctx.cacheDir` at a temp folder and restore both afterwards.
- The browser test fails on script errors and on sideways scrolling at phone width; fix the layout, not the
  test.

## Manual check on a temp server

Never use the real `.cache/` or workspace, and leave port 8765 (the user's manager) alone.

```bash
mkdir -p /tmp/mgr-t/Roms/GB /tmp/mgr-t/.cache /tmp/mgr-t/tf2/ROMS /tmp/mgr-t/tf2/ARCHIVE
touch "/tmp/mgr-t/Roms/GB/Tetris (World).gb"
node src/main.ts --no-open --skip-descriptions --port 8790 \
  --root /tmp/mgr-t --cache-dir /tmp/mgr-t/.cache --tf2-dir /tmp/mgr-t/tf2 > /tmp/mgr-t.log 2>&1
```

Run it in the background (agents: a background shell, not `&`). The URL with the token is in the log:
`rg -o 'http://127.0.0.1:8790/\S+' /tmp/mgr-t.log`.

- `--tf2-dir` makes a folder act as the TF2 card, so copy and artwork flows work without hardware.
- Before opening the page, set `localStorage["manager.mode"]` to `"card"` (or `"wifi"`) on
  `http://127.0.0.1:8790` so it does not start a USB session with a real handheld.
- A clean cache opens the setup wizard. To skip it, finish it once or POST `{ "wizard": "done" }` to
  `/api/settings` (header `X-Manager-Token`).
- Copy metadata only as read-only copies into the temp cache if needed (`metadata-index.json`).

## Against a real handheld

Read-only only (listing, status, `GET` routes) unless the user asked for that write. Never install, delete,
apply settings, flash or format on the user's device or cards to test.

## Cleanup

```bash
lsof -ti tcp:8790 | xargs kill      # only your temp server
rm -rf /tmp/mgr-t /tmp/mgr-t.log
```

Agents with a browser: clear any device-metrics emulation and unlock the tab when done.

## When a test fails

1. Run only that test with `--test-name-pattern` and read the assertion.
2. Decide whether the code or the expectation is wrong; change expectations only when the behaviour change is
   intended (for example a new element id).
3. Do not skip or delete tests to get green.
