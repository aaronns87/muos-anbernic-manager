# Contributing

Thanks for helping. Bug reports, device reports (especially handhelds other than the RG40XX H) and pull
requests are all welcome.

## Set up

```bash
git clone https://github.com/aaronns87/muos-anbernic-manager.git
cd muos-anbernic-manager
npm install
npm test && npm run check
./run.sh --root /path/to/a/test/workspace   # a workspace with a Roms/ folder
```

Node.js 23.6 or newer runs the TypeScript in `src/` directly; there is no build step. The front end in
`public/` is plain JavaScript modules. Start with [docs/architecture.md](docs/architecture.md) and
[AGENTS.md](AGENTS.md); both apply to people as much as to coding agents.

## Making changes

- One concern per pull request, with a short description of what the user sees.
- Add or update tests in `test/` (`node:test`, no extra packages), and the wiki article in
  `public/js/wiki.js` for anything a user would notice.
- Before pushing: `npm test`, `npm run check`, and `node --check` on changed front-end files.
- Keep files ASCII, follow the style around your change, and write user-facing text in plain words.
- Anything that writes to the handheld or a card must happen only after an explicit user action, and say
  what will happen first. Deleting on the device is permanent, so it needs a confirmation.
- Never include `.cache/`, logins, keys or ROMs in a commit.

## Testing against a handheld

Use a separate workspace and cache so your real setup stays untouched:

```bash
node src/main.ts --no-open --skip-descriptions --port 8790 --root /tmp/mgr-test --cache-dir /tmp/mgr-test/.cache
```

`--tf2-dir DIR` (a folder holding `ROMS/` and `ARCHIVE/`) stands in for a TF2 card. Only point a test
build at a real handheld for read-only checks unless you are deliberately testing a write.

## Versions

Versions follow `MAJOR.MINOR.PATCH` and are only changed by the maintainer, by hand, when releasing:
`VERSION`, `package.json` and `package-lock.json` must match (a test checks this). Minor releases are the
norm; major releases are kept for big or breaking changes. Pull requests should not bump the version.

Add a line for every change users will notice under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) (Added, Changed,
Fixed or Removed), written for users rather than developers. When releasing, the maintainer renames **Unreleased** to
the new version and date and adds it to the version history table, then tags the release commit `vX.Y.Z` and
publishes a [GitHub release](https://github.com/aaronns87/muos-anbernic-manager/releases) with the same notes.
Running managers only look at `VERSION` on `main`, so tags and releases never change what they offer.

## License

By contributing you agree that your contributions are licensed under the
[GNU Affero General Public License v3.0 or later](LICENSE).
