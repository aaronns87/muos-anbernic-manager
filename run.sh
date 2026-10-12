#!/bin/bash
# muOS Anbernic Manager: starts the manager app (a Node server in muos-anbernic-manager/src) on
# 127.0.0.1 and opens it in the browser. Overview shows how the handheld is
# connected (TF2 in a card reader, or the handheld over USB in MTP mode) and what
# is on it; Games copies ROMs, lists and deletes the games on the device, and
# moves artwork both ways between Roms/<system>/Imgs and the MustardOS catalogue.
# Needs Node.js 23.6 or newer; offers to install it when it is missing.
# Usage: run.sh [--no-open] [--port N] [--refresh-names] [--refresh-descriptions]
#               [--skip-descriptions] [--tf2-dir DIR] [--root DIR] [-h]

set -euo pipefail

MANAGER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_MIN_MAJOR=23
NODE_MIN_MINOR=6

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  RESET=$'\033[0m'
  BADGE_RED=$'\033[97;41m'
  BADGE_GREEN=$'\033[30;42m'
  BADGE_YELLOW=$'\033[30;43m'
else
  BOLD="" DIM="" RESET="" BADGE_RED="" BADGE_GREEN="" BADGE_YELLOW=""
fi

die() {
  echo
  printf "  %s STOPPED %s  %s\n" "$BADGE_RED" "$RESET" "$*"
  echo
  exit 1
}

note() { printf "  %s%s%s\n" "$DIM" "$*" "$RESET"; }

# Prints the installed Node version (23.6.0), or nothing.
node_version() {
  command -v node >/dev/null 2>&1 || return 0
  node -p 'process.versions.node' 2>/dev/null || true
}

node_ok() {
  local version="$1" major minor
  [[ -n "$version" ]] || return 1
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"
  (( major > NODE_MIN_MAJOR || (major == NODE_MIN_MAJOR && minor >= NODE_MIN_MINOR) ))
}

find_brew() {
  local candidate
  for candidate in "$(command -v brew 2>/dev/null || true)" /opt/homebrew/bin/brew /usr/local/bin/brew /home/linuxbrew/.linuxbrew/bin/brew; do
    [[ -n "$candidate" && -x "$candidate" ]] && { echo "$candidate"; return 0; }
  done
  return 1
}

ask() {
  local reply
  [[ -t 0 ]] || return 1
  printf "  %s%s%s [Y/n] " "$BOLD" "$1" "$RESET"
  read -r reply || return 1
  [[ -z "$reply" || "$reply" =~ ^[Yy] ]]
}

manual_install() {
  echo
  note "Install Node.js $NODE_MIN_MAJOR.$NODE_MIN_MINOR or newer, then run this script again:"
  note "  macOS:    brew install node   (Homebrew: https://brew.sh)"
  note "  Linux:    https://nodejs.org/en/download (or nvm: nvm install node)"
  note "  Windows:  https://nodejs.org/en/download, then run: node muos-anbernic-manager/src/main.ts"
  die "Node.js $NODE_MIN_MAJOR.$NODE_MIN_MINOR or newer is required."
}

ensure_node() {
  local version brew
  version="$(node_version)"
  node_ok "$version" && return 0

  echo
  if [[ -n "$version" ]]; then
    printf "  %s CHECK %s  Node.js %s is installed, but the manager needs %s.%s or newer.\n" \
      "$BADGE_YELLOW" "$RESET" "$version" "$NODE_MIN_MAJOR" "$NODE_MIN_MINOR"
  else
    printf "  %s CHECK %s  Node.js is not installed. The manager runs on Node.js %s.%s or newer.\n" \
      "$BADGE_YELLOW" "$RESET" "$NODE_MIN_MAJOR" "$NODE_MIN_MINOR"
  fi

  brew="$(find_brew)" || manual_install
  if [[ -n "$version" ]] && "$brew" list --formula node >/dev/null 2>&1; then
    ask "Upgrade Node.js with Homebrew (brew upgrade node)?" || manual_install
    "$brew" upgrade node || die "brew upgrade node failed."
  else
    ask "Install Node.js with Homebrew (brew install node)?" || manual_install
    "$brew" install node || die "brew install node failed."
  fi
  export PATH="$(dirname "$brew"):$PATH"
  hash -r
  version="$(node_version)"
  node_ok "$version" || die "Node.js $NODE_MIN_MAJOR.$NODE_MIN_MINOR or newer is still not the first node on PATH (found: ${version:-none}). Check: which -a node"
  printf "  %s READY %s  Node.js %s\n" "$BADGE_GREEN" "$RESET" "$version"
}

# Installs the npm packages when they are missing or older than package.json.
ensure_packages() {
  local stamp="$MANAGER_DIR/node_modules/.package-lock.json"
  if [[ -f "$stamp" && ! "$MANAGER_DIR/package.json" -nt "$stamp" ]] \
     && [[ ! -f "$MANAGER_DIR/package-lock.json" || ! "$MANAGER_DIR/package-lock.json" -nt "$stamp" ]]; then
    return 0
  fi
  command -v npm >/dev/null 2>&1 || die "npm is missing. Reinstall Node.js, which includes it."
  note "Installing the manager's packages (first run only)..."
  (cd "$MANAGER_DIR" && npm install --no-audit --no-fund --loglevel=error) || die "npm install failed."
}

ensure_node
ensure_packages
cd "$MANAGER_DIR"
exec node src/main.ts "$@"
