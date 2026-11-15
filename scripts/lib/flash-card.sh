#!/bin/bash
# Elevated by sudo -A (administrator privileges). Writes a MustardOS image to a whole disk.
# Uses only Apple/system tools so the admin password applies to the process that opens /dev/rdisk*.
# Homebrew Node must not be in this process chain — macOS often returns EPERM for raw disks from it.
#
# Environment: MUOS_DISK MUOS_IMAGE MUOS_KIND MUOS_BYTES MUOS_HASH MUOS_PROGRESS MUOS_CANCEL

set -euo pipefail

# 1 MiB chunks: live UI progress, and small enough that a remount check stays responsive.
CHUNK=$((1 * 1024 * 1024))

emit() { printf '%s\n' "$1" >>"$MUOS_PROGRESS"; }

fail() {
  local msg="$1"
  local esc
  esc=$(printf '%s' "$msg" | /usr/bin/sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g' | /usr/bin/tr '\n' ' ')
  emit "{\"error\":\"$esc\"}"
  echo "$msg" >&2
  exit 1
}

# Kill a background helper and its children so Cancel stops gunzip/shasum promptly.
stop_pid() {
  local pid="${1:-}" kid
  [[ -n "$pid" ]] || return 0
  for kid in $(/bin/pgrep -P "$pid" 2>/dev/null || true); do
    stop_pid "$kid"
  done
  /bin/kill -TERM "$pid" 2>/dev/null || true
  /bin/sleep 0.2
  /bin/kill -KILL "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

HELPER_PID=""
cancelled() {
  if [[ -f "$MUOS_CANCEL" ]]; then
    stop_pid "${HELPER_PID:-}"
    exec 3<&- 2>/dev/null || true
    exec 4>&- 2>/dev/null || true
    exec 8<&- 2>/dev/null || true
    exec 9>&- 2>/dev/null || true
    if [[ "${1:-}" == "verify" ]]; then
      fail "Cancelled before the read-back finished. The card was written but not verified."
    fi
    fail "Cancelled. The card is incomplete; install again before using it."
  fi
}

[[ "$(/usr/bin/id -u)" -eq 0 ]] || fail "The installer is not running as administrator. Enter your macOS password when asked."
[[ "${MUOS_DISK}" =~ ^disk[0-9]+$ ]] || fail "Refusing an unusual disk identifier."
[[ -f "$MUOS_IMAGE" ]] || fail "The disk image is missing."
[[ "$MUOS_BYTES" -gt 0 ]] || fail "The image length is invalid."

RDEV="/dev/r${MUOS_DISK}"
BDEV="/dev/${MUOS_DISK}"
DEV=""

unmount() { /usr/sbin/diskutil unmountDisk force "$BDEV" >/dev/null 2>&1 || true; }

mounted_slices() { /sbin/mount | /usr/bin/grep -c "^/dev/${MUOS_DISK}s" || true; }

# True if we can open the device for writing (zero-byte probe).
can_write() { /bin/dd if=/dev/zero of="$1" bs=512 count=0 status=none >/dev/null 2>&1; }

pick_dev() {
  DEV=""
  for d in "$RDEV" "$BDEV"; do
    if can_write "$d"; then DEV="$d"; return 0; fi
  done
  return 1
}

# After the image's partition table lands, DiskArbitration may remount slices and
# break a fresh open of rdisk. Unmount, then keep writing through the held FD.
ensure_unmounted() {
  if [[ "$(mounted_slices)" -ne 0 ]]; then
    unmount
    [[ "$(mounted_slices)" -eq 0 ]] || fail "Part of ${MUOS_DISK} remounted during the write. Install again."
  fi
}

unmount
[[ "$(mounted_slices)" -eq 0 ]] || fail "Part of ${MUOS_DISK} is still mounted. Nothing was written."

# --- prepare ---
emit '{"stage":"prepare","done":0,"total":1}'
cancelled

if ! pick_dev; then
  # Prior Free Space / empty-content state often blocks raw writes until a normal erase.
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
# Device node can change after erase; pick again.
pick_dev || fail "Could not reopen ${MUOS_DISK} after clearing (Operation not permitted)."
emit '{"stage":"prepare","done":1,"total":1}'

# --- write ---
# Hold the raw device open for the whole image. Re-opening after the first few MB
# fails once macOS sees the new partition table and mounts MustardOS (offset 4 MiB).
# Progress is emitted per chunk — macOS dd status=progress does not flush to a file.
emit "{\"stage\":\"write\",\"done\":0,\"total\":${MUOS_BYTES}}"
cancelled

FIFO=$(/usr/bin/mktemp -u -t muos-wfifo)
BUF=$(/usr/bin/mktemp -t muos-wbuf)
HASH_OUT=$(/usr/bin/mktemp -t muos-hash)
DD_ERR=$(/usr/bin/mktemp -t muos-dderr)
/usr/bin/mkfifo "$FIFO"
cleanup() {
  stop_pid "${HELPER_PID:-}"
  exec 3<&- 2>/dev/null || true
  exec 4>&- 2>/dev/null || true
  exec 8<&- 2>/dev/null || true
  exec 9>&- 2>/dev/null || true
  /bin/rm -f "$FIFO" "$BUF" "$HASH_OUT" "$DD_ERR" "${HASH_FIFO:-}"
}
trap cleanup EXIT

if [[ "$MUOS_KIND" == "gz" ]]; then
  (/usr/bin/gunzip -c "$MUOS_IMAGE" >"$FIFO") &
else
  (/bin/cat "$MUOS_IMAGE" >"$FIFO") &
fi
HELPER_PID=$!
exec 3<"$FIFO"

unmount
# Exclusive write handle for the entire transfer (sequential; no seek/reopen).
exec 9>"$DEV" || fail "Could not open ${DEV} for writing (Operation not permitted)."

DONE=0
while (( DONE < MUOS_BYTES )); do
  cancelled
  ensure_unmounted
  N=$(( MUOS_BYTES - DONE ))
  (( N > CHUNK )) && N=$CHUNK
  /usr/bin/head -c "$N" <&3 >"$BUF" || true
  GOT=$(/usr/bin/stat -f%z "$BUF" 2>/dev/null || echo 0)
  if [[ "$GOT" -eq 0 ]]; then
    fail "The image ended after ${DONE} of ${MUOS_BYTES} bytes. Nothing further was written."
  fi
  # Write this chunk to the already-open device FD (same as one long dd of=).
  if ! /bin/dd if="$BUF" of=/dev/fd/9 bs="$GOT" count=1 status=none 2>"$DD_ERR"; then
    fail "Writing to the card failed at offset ${DONE}. $(/usr/bin/tr '\n' ' ' <"$DD_ERR" | /usr/bin/tail -c 200)"
  fi
  DONE=$(( DONE + GOT ))
  emit "{\"stage\":\"write\",\"done\":${DONE},\"total\":${MUOS_BYTES}}"
  if (( GOT < N )); then
    break
  fi
done
exec 9>&-
exec 3<&-
stop_pid "$HELPER_PID"
HELPER_PID=""

(( DONE >= MUOS_BYTES )) || fail "Only wrote ${DONE} of ${MUOS_BYTES} bytes to the card."

/bin/sync
emit "{\"stage\":\"write\",\"done\":${MUOS_BYTES},\"total\":${MUOS_BYTES}}"
ensure_unmounted

# --- verify ---
emit "{\"stage\":\"verify\",\"done\":0,\"total\":${MUOS_BYTES}}"
cancelled verify

HASH_FIFO=$(/usr/bin/mktemp -u -t muos-hfifo)
/usr/bin/mkfifo "$HASH_FIFO"

(/usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}' >"$HASH_OUT") <"$HASH_FIFO" &
HELPER_PID=$!
exec 4>"$HASH_FIFO"
# Hold a read FD so verify does not reopen/skip after remounts.
unmount
exec 8<"$DEV" || fail "Could not open ${DEV} for read-back."

DONE=0
while (( DONE < MUOS_BYTES )); do
  cancelled verify
  ensure_unmounted
  N=$(( MUOS_BYTES - DONE ))
  (( N > CHUNK )) && N=$CHUNK
  if ! /bin/dd if=/dev/fd/8 bs="$N" count=1 status=none 2>"$DD_ERR" >&4; then
    fail "Could not read the card back for verification at offset ${DONE}. $(/usr/bin/tr '\n' ' ' <"$DD_ERR" | /usr/bin/tail -c 200)"
  fi
  DONE=$(( DONE + N ))
  emit "{\"stage\":\"verify\",\"done\":${DONE},\"total\":${MUOS_BYTES}}"
done
exec 8<&-
exec 4>&-
set +e
wait "$HELPER_PID"
HASH_EC=$?
set -e
HELPER_PID=""

cancelled verify
emit "{\"stage\":\"verify\",\"done\":${MUOS_BYTES},\"total\":${MUOS_BYTES}}"

GOT=$(/bin/cat "$HASH_OUT" 2>/dev/null || true)
[[ "$HASH_EC" -eq 0 && -n "$GOT" ]] || fail "Could not read the card back for verification."
[[ "$GOT" == "$MUOS_HASH" ]] || fail "Read-back does not match the image. Try another card reader or card, and do not boot this card."

emit '{"stage":"done"}'
exit 0
