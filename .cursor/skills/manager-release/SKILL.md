---
name: manager-release
description: Releases a new version of muOS Anbernic Manager - setting the version the user gave in VERSION, package.json and package-lock.json, testing, committing and pushing to main so running managers offer the update. Use when the user asks to release, publish, tag or bump the version. Never use it to pick a version on your own.
---

# Releasing

## Precondition

The user must state the new version number (for example "release 1.3.0"). If they ask to release without a
number, suggest one using the policy below and **ask**; do not apply a version yourself.

| Change since last release | Bump | Example |
| --- | --- | --- |
| Fixes, wording, styling, docs | patch | 1.2.0 -> 1.2.1 |
| New features, sections, device support (the usual case) | minor | 1.2.1 -> 1.3.0 |
| Breaking or big: workspace/settings migration, higher Node requirement, removed features, redesign | major | 1.3.0 -> 2.0.0 |

Prefer minor over major. The new number must be higher than the current `VERSION`.

## Steps

```
- [ ] 1. Working tree clean, on main, up to date (git status, git pull --ff-only)
- [ ] 2. Set the version
- [ ] 3. Move CHANGELOG.md "Unreleased" to the new version
- [ ] 4. npm run check && npm test
- [ ] 5. Commit "Version X.Y.Z" and push
- [ ] 6. Tag vX.Y.Z and create the GitHub release with the changelog section as notes
```

In `CHANGELOG.md`: rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`, add a fresh empty `## [Unreleased]`
above it, add a row to the version history table, and update the links at the bottom (`[Unreleased]` compares
`vX.Y.Z` with `main`; `[X.Y.Z]` points at `tree/vX.Y.Z`). If Unreleased is empty, ask what the release contains
before releasing.

```bash
V=1.3.0
npm version "$V" --no-git-tag-version      # package.json + package-lock.json
printf '%s\n' "$V" > VERSION
node --test --test-name-pattern=VERSION test/unit.test.ts
npm run check && npm test
git add VERSION package.json package-lock.json CHANGELOG.md
git commit -m "Version $V"
git push origin main
git tag "v$V" && git push origin "v$V"
awk -v v="$V" '$0 ~ "^## \\[" v "\\]" {f=1; next} /^## \[|^\[Unreleased\]:/ {f=0} f' CHANGELOG.md > /tmp/notes.md
gh release create "v$V" --verify-tag --title "$V" --notes-file /tmp/notes.md --latest
```

Release commits contain only the version change and the changelog (features are committed before). The GitHub release
is only for the repository page: the update check reads `VERSION` on `main` and updates pull `main`, never tags or
releases. Release notes must use absolute links, since relative ones break on the releases page.

## How users get it

- Running managers fetch `https://raw.githubusercontent.com/<repo>/main/VERSION` every 3 hours (15 minutes after
  a failed check); GitHub's CDN may serve the old file for about 5 minutes after a push.
- Git clones update with `git pull --ff-only`; downloaded copies are replaced from the ZIP of `main` (the old
  files are kept in `.update-old/`). Both restart through `run.sh` (exit code 75).
- So a broken `main` reaches users: never push a version bump with failing tests.
