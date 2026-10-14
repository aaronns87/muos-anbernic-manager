#!/bin/bash
# muOS Anbernic Manager installer: checks Node.js and the manager's packages, creates the workspace folders
# (Roms with a folder per MustardOS system, apps, os, bios, backups, themes) and can start from a clean cache, so the
# next start opens the setup wizard in the browser. Nothing on the handheld or its cards is touched.
# Usage: installer.sh [--workspace DIR] [--clean-cache | --keep-cache] [--shortcut | --no-shortcut] [--yes]
#                     [--start | --no-start] [-h]

set -euo pipefail

MANAGER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$MANAGER_DIR/scripts/common.sh"

usage() {
  cat <<EOF
Usage: installer.sh [options]

Sets up the muOS Anbernic Manager on this computer:
  1. checks for Node.js $NODE_MIN_MAJOR.$NODE_MIN_MINOR or newer (offers to install it with Homebrew) and installs the npm packages,
  2. creates the workspace: Roms/ with a folder per MustardOS system, apps/, os/, bios/, backups/ and themes/,
  3. optionally starts from a clean cache; the old one is kept as .cache-backup-<date>,
  4. offers an app shortcut with the manager's icon (Applications on macOS, the app menu on Linux),
  5. optionally starts the manager, which opens the setup wizard on a clean cache.

  --workspace DIR   where the workspace folders go (default: the folder holding muos-anbernic-manager)
  --clean-cache     start from a clean cache without asking
  --keep-cache      keep the current cache
  --shortcut        add the app shortcut without asking
  --no-shortcut     do not add the app shortcut
  --yes             accept the defaults without asking
  --start           start the manager at the end without asking
  --no-start        do not start the manager
  -h, --help        show this help
EOF
}

WORKSPACE="" CACHE_CHOICE="" ASSUME_YES=0 START_CHOICE="" SHORTCUT_CHOICE=""
while (( $# )); do
  case "$1" in
    --workspace) [[ $# -ge 2 ]] || die "--workspace needs a folder."; WORKSPACE="$2"; shift ;;
    --clean-cache) CACHE_CHOICE=clean ;;
    --keep-cache) CACHE_CHOICE=keep ;;
    --yes|-y) ASSUME_YES=1 ;;
    --start) START_CHOICE=start ;;
    --no-start) START_CHOICE=skip ;;
    --shortcut) SHORTCUT_CHOICE=make ;;
    --no-shortcut) SHORTCUT_CHOICE=skip ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "Unknown option: $1" ;;
  esac
  shift
done

step() { echo; printf "  %s%s%s\n" "$BOLD" "$*" "$RESET"; }
ok() { printf "  %s DONE %s  %s\n" "$BADGE_GREEN" "$RESET" "$*"; }

# ask_default QUESTION Y|N: the answer, or the default with --yes or without a terminal.
ask_default() {
  local reply hint="[Y/n]"
  [[ "$2" == N ]] && hint="[y/N]"
  if (( ASSUME_YES )) || [[ ! -t 0 ]]; then [[ "$2" == Y ]]; return; fi
  printf "  %s%s%s %s " "$BOLD" "$1" "$RESET" "$hint"
  read -r reply || reply=""
  [[ -z "$reply" ]] && { [[ "$2" == Y ]]; return; }
  [[ "$reply" =~ ^[Yy] ]]
}

echo
printf "  %s muOS Anbernic Manager %s  installer\n" "$BADGE_GREEN" "$RESET"
note "Games, artwork, apps and settings for MustardOS handhelds, from this computer."

step "1. Node.js and packages"
ensure_node
ensure_packages
ok "Node.js $(node_version) and the manager's packages are ready."

if [[ "$(uname -s)" == Darwin ]] && brew="$(find_brew)" && ! "$brew" list --formula libmtp >/dev/null 2>&1; then
  note "libmtp lets the manager reach the handheld over a USB cable (MTP). The card reader and Wi-Fi work without it."
  if ask_default "Install libmtp with Homebrew (brew install libmtp)?" N; then
    "$brew" install libmtp || note "brew install libmtp failed; USB connections need it, the rest works."
  fi
fi

step "2. Workspace folders"
DEFAULT_WORKSPACE="$(cd "$MANAGER_DIR/.." && pwd)"
if [[ -z "$WORKSPACE" ]] && (( ! ASSUME_YES )) && [[ -t 0 ]]; then
  note "Roms/, apps/, os/, bios/, backups/ and themes/ go into one folder. Existing folders and files are left as they are."
  printf "  %sWorkspace folder%s [%s] " "$BOLD" "$RESET" "$DEFAULT_WORKSPACE"
  read -r WORKSPACE || WORKSPACE=""
fi
WORKSPACE="${WORKSPACE:-$DEFAULT_WORKSPACE}"
WORKSPACE="${WORKSPACE/#\~/$HOME}"
mkdir -p "$WORKSPACE" || die "Could not create $WORKSPACE."
WORKSPACE="$(cd "$WORKSPACE" && pwd)"
note "Workspace: $WORKSPACE"

step "3. Cache"
CACHE="$MANAGER_DIR/.cache"
if [[ -d "$CACHE" ]] && [[ -n "$(ls -A "$CACHE" 2>/dev/null)" ]]; then
  note "The cache holds downloads (game descriptions, arcade titles), Wi-Fi and SSH logins, and settings."
  if [[ "$CACHE_CHOICE" == clean ]] || { [[ -z "$CACHE_CHOICE" ]] && ask_default "Start from a clean cache? The current one is kept as a backup." N; }; then
    BACKUP="$MANAGER_DIR/.cache-backup-$(date +%Y%m%d-%H%M%S)"
    mv "$CACHE" "$BACKUP" || die "Could not move the cache to $BACKUP."
    ok "Clean cache. The old one is in $(basename "$BACKUP"); delete it once you no longer need it."
  else
    note "Keeping the current cache and settings."
  fi
else
  note "The cache is clean."
fi

INIT_ARGS=(--init)
[[ "$WORKSPACE" != "$DEFAULT_WORKSPACE" ]] && INIT_ARGS+=(--workspace "$WORKSPACE")
(cd "$MANAGER_DIR" && node src/main.ts "${INIT_ARGS[@]}") || die "Could not create the workspace folders."

chmod +x "$MANAGER_DIR/run.sh" "$MANAGER_DIR/installer.sh" 2>/dev/null || true

step "4. App shortcut"
if [[ "$(uname -s)" == Darwin ]]; then PLACE="Applications"; else PLACE="the app menu"; fi
if [[ "$(uname -s)" != Darwin && -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" && "$SHORTCUT_CHOICE" != make ]]; then
  note "No desktop session; skipping. Run  node $MANAGER_DIR/src/main.ts --shortcut  later to add it."
elif [[ "$SHORTCUT_CHOICE" == make ]] || { [[ -z "$SHORTCUT_CHOICE" ]] && { (( ASSUME_YES )) || [[ -t 0 ]]; } \
    && { note "Starts the manager from $PLACE with its icon, in a terminal window; closing the window stops it."; ask_default "Add muOS Anbernic Manager to $PLACE?" Y; }; }; then
  (cd "$MANAGER_DIR" && node src/main.ts --shortcut) || note "Could not add the shortcut; Settings in the manager can try again."
else
  note "Skipped. Settings in the manager can add it later."
fi

step "Ready"
note "Start the manager any time with:  $MANAGER_DIR/run.sh"
note "Put games in $WORKSPACE/Roms/<SYSTEM>, MustardOS apps (.muxapp, .muxupd) in apps/ and images (.img.gz) in os/."
if [[ "$START_CHOICE" == start ]] || { [[ -z "$START_CHOICE" ]] && ask_default "Start the manager now?" Y; }; then
  exec "$MANAGER_DIR/run.sh"
fi
echo
