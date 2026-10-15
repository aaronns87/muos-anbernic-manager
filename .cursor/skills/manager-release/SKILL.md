---
name: manager-release
description: Releases a new version of muOS Anbernic Manager - renaming changes/unreleased to version/X.Y.Z, setting the version the user gave in VERSION, package.json and package-lock.json, testing, tagging, creating the GitHub release and opening a pull request into main that the user merges. Use when the user asks to release, publish, tag or bump the version. Never use it to pick a version on your own.
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

Branches follow `.cursor/rules/branching.mdc`: unreleased work is on `changes/unreleased`, a release is made on
`version/X.Y.Z` and reaches `main` only when the user merges its pull request on GitHub.

```
- [ ] 1. Working tree clean, on changes/unreleased, up to date (git status, git pull --ff-only)
- [ ] 2. Rename the branch to version/X.Y.Z, push it, delete the remote changes/unreleased
- [ ] 3. Set the version
- [ ] 4. Move CHANGELOG.md "Unreleased" to the new version
- [ ] 5. npm run check && npm test
- [ ] 6. Commit "Version X.Y.Z" and push version/X.Y.Z
- [ ] 7. Tag vX.Y.Z and create the GitHub release with the changelog section as notes
- [ ] 8. Open a pull request version/X.Y.Z -> main (never merge it yourself)
```

Do not create a new `changes/unreleased` afterwards: it is created from `main` when the next change starts, once the
user has merged the release pull request.

In `CHANGELOG.md`: rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`, add a fresh empty `## [Unreleased]`
above it, add a row to the version history table, and update the links at the bottom (`[Unreleased]` compares
`vX.Y.Z` with `changes/unreleased`; `[X.Y.Z]` points at `tree/vX.Y.Z`). If Unreleased is empty, ask what the release contains
before releasing.

```bash
V=1.3.0
git switch changes/unreleased && git pull --ff-only
git branch -m changes/unreleased "version/$V"
git push -u origin "version/$V" && git push origin --delete changes/unreleased
npm version "$V" --no-git-tag-version      # package.json + package-lock.json
printf '%s\n' "$V" > VERSION
node --test --test-name-pattern=VERSION test/unit.test.ts
npm run check && npm test
git add VERSION package.json package-lock.json CHANGELOG.md
git commit -m "Version $V"
git push
git tag "v$V" && git push origin "v$V"
awk -v v="$V" '$0 ~ "^## \\[" v "\\]" {f=1; next} /^## \[|^\[Unreleased\]:/ {f=0} f' CHANGELOG.md > /tmp/notes.md
gh release create "v$V" --verify-tag --title "$V" --notes-file /tmp/notes.md --latest
gh pr create --base main --head "version/$V" --title "Version $V" --body-file /tmp/notes.md
```

Release commits contain only the version change and the changelog (features are committed before). The GitHub release
is only for the repository page: the update check reads `VERSION` on `main` and updates pull `main`, never tags or
releases, so users get the version once the user merges the pull request. Release notes must use absolute links, since relative ones break on the releases page.

## How users get it

- Running managers fetch `https://raw.githubusercontent.com/<repo>/main/VERSION` every 3 hours (15 minutes after
  a failed check); GitHub's CDN may serve the old file for about 5 minutes after a push.
- Git clones update with `git pull --ff-only`; downloaded copies are replaced from the ZIP of `main` (the old
  files are kept in `.update-old/`). Both restart through `run.sh` (exit code 75).
- So a broken `main` reaches users: never open the release pull request with failing tests.
