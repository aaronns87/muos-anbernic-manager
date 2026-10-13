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
source "$MANAGER_DIR/scripts/common.sh"

ensure_node
ensure_packages
cd "$MANAGER_DIR"
# Exit code 75 is the manager restarting itself after an update; new packages are installed first.
export MANAGER_RESTART=1
while :; do
  code=0
  node src/main.ts "$@" || code=$?
  (( code == 75 )) || exit "$code"
  ensure_packages
done
