#!/usr/bin/env bash
# Pre-commit smoke: type-check + detailed smoke suite (+ optional browser when SMOKE_BROWSER=1).
# Extend test/smoke.test.ts (and the browser "smoke: roadmap" test) when adding user-visible features.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> npm run check"
npm run check

echo "==> node --test test/smoke.test.ts test/file-safety.test.ts"
node --test test/smoke.test.ts test/file-safety.test.ts

if [[ "${SMOKE_BROWSER:-0}" == "1" ]]; then
  echo "==> browser smoke (SMOKE_BROWSER=1)"
  node --test --test-name-pattern 'smoke: roadmap' test/browser.test.ts
fi

echo "Smoke OK"
