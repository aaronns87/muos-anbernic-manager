#!/usr/bin/env bash
# Copies repo hooks into .git/hooks (no git config changes). Safe to re-run.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS="$ROOT/.git/hooks"
mkdir -p "$HOOKS"
install -m 755 "$ROOT/.githooks/pre-commit" "$HOOKS/pre-commit"
echo "Installed pre-commit hook → $HOOKS/pre-commit (runs ./scripts/smoke.sh)"
