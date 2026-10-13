---
name: manager-feature-workflow
description: Step-by-step checklist for adding or changing a feature in muOS Anbernic Manager end to end - server module, API route, browser module, dialog, CSS, wiki, tests and README. Use when implementing a new feature, section, dialog, setting or API endpoint in this repository.
---

# Adding a feature

Copy this checklist and tick it off:

```
- [ ] 1. Find the neighbours
- [ ] 2. Server logic + route
- [ ] 3. Browser module / dialog
- [ ] 4. Styles
- [ ] 5. Wiki (and README if users notice)
- [ ] 6. Tests
- [ ] 7. Verify
```

## 1. Find the neighbours

Read `docs/architecture.md`, then the closest existing feature (same section or same kind of dialog) and
copy its shape. `rg -n "^// " src public/js` lists every file's purpose in one call.

## 2. Server

- New logic in its own module under `src/` (or the matching folder: `games/`, `device/`, `system/`), opening
  with a one-line comment that says what it does.
- Wire it in the `routes` object in `src/server.ts`; keep the route a one-liner.
- Input: coerce and validate (`String(body.x ?? "")`, `safePart`, `inside`); user errors via `UserError`.
- Writes to the handheld or cards: only in POST routes the user triggers; `requireIdle()` if it conflicts with
  copies or card jobs; long work via `startJob` (`src/jobs.ts`) so the UI shows progress.
- Log changes with `say(badge, "LABEL", "Sentence.")`.
- New setting: `Settings`, `DEFAULTS`, `loadSettings`, `saveSettings` in `src/settings.ts`.

## 3. Browser

- Section: `view-<name>` in `public/index.html`, `SECTIONS` in `core.js`, `TITLES` + `showSection()` in
  `app.js`, a module `public/js/<name>.js` exporting `show<Name>()`.
- Dialog: `<dialog id="x">` in `index.html` with `.help-head`, body, `.fv-foot`; filled by its module.
- Use `api()`, `esc()`, `icon()`, `toast()`, `store` from `core.js`; delegated `data-*` click handlers.
- Anything destructive: a confirm step that says what happens and whether it can be undone.

## 4. Styles

`public/css/app.css`: reuse existing classes and `:root` variables; prefix new classes per feature.
Check the layout at 390 px wide as well as desktop.

## 5. Docs

- Wiki: add or update the article in `ARTICLES` in `public/js/wiki.js`
  (`[id, icon, title, section, summary, [[heading, html], ...]]`), written for non-technical users.
- README: features list or a section if users will look for it.

## 6. Tests

- Pure logic: `test/unit.test.ts`. API: `test/server.test.ts` with `startServer()`.
- New element ids (dialogs, views): add them to the id list in `test/server.test.ts`.
- The browser test loads every section automatically; a new section needs nothing extra unless it has tabs.

## 7. Verify

```bash
npm run check && npm test
node --check public/js/<changed>.js
LC_ALL=C rg -n '[^\x00-\x7F]' <changed files>
```

For UI work, look at it on a temp server (see `manager-testing`). Do not bump the version; mention at the end
if the change seems release-worthy (see `.cursor/rules/versioning.mdc`).
