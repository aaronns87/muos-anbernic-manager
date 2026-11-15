#!/bin/bash
# Elevated by sudo -A (administrator privileges). Writes a MustardOS image to a whole disk.
# Uses only Apple/system tools so the admin password applies to the process that opens /dev/rdisk*.
# Homebrew Node must not be in this process chain — macOS often returns EPERM for raw disks from it.
#
# Prepare stays in bash; write+verify run via flash-io.py (mount watchdog + F_FULLFSYNC) so
# DiskArbitration cannot remount MustardOS mid-flash and cause false read-back mismatches.
#
# Environment: MUOS_DISK MUOS_IMAGE MUOS_KIND MUOS_BYTES MUOS_HASH MUOS_PROGRESS MUOS_CANCEL
# Optional: MUOS_SKIP MUOS_SKIP_VERIFY

set -euo pipefail

emit() { printf '%s\n' "$1" >>"$MUOS_PROGRESS"; }

fail() {
  local msg="$1"
  local esc
  esc=$(printf '%s' "$msg" | /usr/bin/sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g' | /usr/bin/tr '\n' ' ')
  emit "{\"error\":\"$esc\"}"
  echo "$msg" >&2
  exit 1
}

cancelled() {
  if [[ -f "$MUOS_CANCEL" ]]; then
    fail "Cancelled. The card is incomplete; install again before using it."
  fi
}

[[ "$(/usr/bin/id -u)" -eq 0 ]] || fail "The installer is not running as administrator. Enter your macOS password when asked."
[[ "${MUOS_DISK}" =~ ^disk[0-9]+$ ]] || fail "Refusing an unusual disk identifier."
[[ -f "$MUOS_IMAGE" ]] || fail "The disk image is missing."
[[ "$MUOS_BYTES" -gt 0 ]] || fail "The image length is invalid."
(( MUOS_BYTES % 512 == 0 )) || fail "The image length is not a whole number of sectors."

RDEV="/dev/r${MUOS_DISK}"
BDEV="/dev/${MUOS_DISK}"
DEV=""

# flash-io.py lives next to this script.
HERE=$(/usr/bin/dirname "$0")
FLASH_IO="$HERE/flash-io.py"
[[ -f "$FLASH_IO" ]] || fail "scripts/lib/flash-io.py is missing, so the card cannot be written."
[[ -x /usr/bin/python3 ]] || fail "python3 is required to write the card (install the Xcode Command Line Tools)."

unmount() { /usr/sbin/diskutil unmountDisk force "$BDEV" >/dev/null 2>&1 || true; }

mounted_slices() { /sbin/mount | /usr/bin/grep -c "^/dev/${MUOS_DISK}s" || true; }

can_write() { /bin/dd if=/dev/zero of="$1" bs=512 count=0 status=none >/dev/null 2>&1; }

pick_dev() {
  DEV=""
  for d in "$RDEV" "$BDEV"; do
    if can_write "$d"; then DEV="$d"; return 0; fi
  done
  return 1
}

unmount
[[ "$(mounted_slices)" -eq 0 ]] || fail "Part of ${MUOS_DISK} is still mounted. Nothing was written."

# --- prepare ---
emit '{"stage":"prepare","done":0,"total":1}'
cancelled

if ! pick_dev; then
  /usr/sbin/diskutil eraseDisk FAT32 MUOSTEMP MBRFormat "$BDEV" >/dev/null 2>&1 \
    || fail "Could not prepare ${MUOS_DISK} for writing (Operation not permitted). Check System Settings → Privacy & Security → Full Disk Access for Terminal (or Cursor), unplug the card, and try again."
  unmount
  pick_dev || fail "Could not open ${MUOS_DISK} for writing after reformatting (Operation not permitted)."
fi

cancelled
/bin/dd if=/dev/zero of="$DEV" bs=1m count=10 status=none >/dev/null 2>&1 \
  || fail "Could not clear the old partition map on ${MUOS_DISK} (Operation not permitted)."
/bin/sync
unmount
[[ "$(mounted_slices)" -eq 0 ]] || fail "Part of ${MUOS_DISK} remounted after clearing. Nothing was written."
pick_dev || fail "Could not reopen ${MUOS_DISK} after clearing (Operation not permitted)."
emit '{"stage":"prepare","done":1,"total":1}'

# --- write + verify (Python: same FD, mount watchdog, F_FULLFSYNC) ---
export MUOS_DEV="$DEV"
set +e
/usr/bin/python3 "$FLASH_IO"
EC=$?
set -e
unmount
exit "$EC"
