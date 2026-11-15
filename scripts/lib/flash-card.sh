#!/bin/bash
# Elevated by sudo -A (administrator privileges). Writes a MustardOS image to a whole disk.
# Uses only Apple/system tools so the admin password applies to the process that opens /dev/rdisk*.
# Homebrew Node must not be in this process chain — macOS often returns EPERM for raw disks from it.
#
# Environment: MUOS_DISK MUOS_IMAGE MUOS_KIND MUOS_BYTES MUOS_HASH MUOS_PROGRESS MUOS_CANCEL
# Optional: MUOS_SKIP MUOS_SKIP_VERIFY

set -euo pipefail

# 4 MiB chunks: live progress without the ~1 MB/s tax of 512-byte reads/writes.
CHUNK=$((4 * 1024 * 1024))

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
    exec 8<&- 2>/dev/null || true
    exec 9>&- 2>/dev/null || true
    if [[ "${1:-}" == "verify" ]]; then
      fail "Cancelled before the read-back finished. The card was written but not verified."
    fi
    fail "Cancelled. The card is incomplete; install again before using it."
  fi
}

skip_verify() {
  [[ "${MUOS_SKIP_VERIFY:-0}" == "1" || -f "${MUOS_SKIP:-}" ]]
}

[[ "$(/usr/bin/id -u)" -eq 0 ]] || fail "The installer is not running as administrator. Enter your macOS password when asked."
[[ "${MUOS_DISK}" =~ ^disk[0-9]+$ ]] || fail "Refusing an unusual disk identifier."
[[ -f "$MUOS_IMAGE" ]] || fail "The disk image is missing."
[[ "$MUOS_BYTES" -gt 0 ]] || fail "The image length is invalid."
(( MUOS_BYTES % 512 == 0 )) || fail "The image length is not a whole number of sectors."

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
pick_dev || fail "Could not reopen ${MUOS_DISK} after clearing (Operation not permitted)."
emit '{"stage":"prepare","done":1,"total":1}'

# --- write ---
# Hold rdisk open for the whole image. Never call diskutil until AFTER verify — sync/unmount
# here lets DiskArbitration mount MustardOS and dirty sectors, so read-back falsely fails.
emit "{\"stage\":\"write\",\"done\":0,\"total\":${MUOS_BYTES}}"
cancelled

FIFO=$(/usr/bin/mktemp -u -t muos-wfifo)
BUF=$(/usr/bin/mktemp -t muos-wbuf)
HASH_WRITE=$(/usr/bin/mktemp -t muos-hash-w)
HASH_READ=$(/usr/bin/mktemp -t muos-hash-r)
/usr/bin/mkfifo "$FIFO"
cleanup() {
  stop_pid "${HELPER_PID:-}"
  exec 3<&- 2>/dev/null || true
  exec 8<&- 2>/dev/null || true
  exec 9>&- 2>/dev/null || true
  /bin/rm -f "$FIFO" "$BUF" "$HASH_WRITE" "$HASH_READ"
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
exec 9>"$DEV" || fail "Could not open ${DEV} for writing (Operation not permitted)."

# Write chunks to the device and hash the same bytes. head -c / cat are byte-exact;
# dd bs=N count=1 can short-transfer on raw devices and still exit 0.
set +e
(
  set +e
  DONE=0
  while (( DONE < MUOS_BYTES )); do
    if [[ -f "$MUOS_CANCEL" ]]; then exit 3; fi
    N=$(( MUOS_BYTES - DONE ))
    (( N > CHUNK )) && N=$CHUNK
    /usr/bin/head -c "$N" <&3 >"$BUF" || true
    GOT=$(/usr/bin/stat -f%z "$BUF" 2>/dev/null || echo 0)
    if [[ "$GOT" -eq 0 ]]; then
      echo "short-image at ${DONE}" >&2
      exit 2
    fi
    if ! /bin/cat "$BUF" >&9; then
      echo "write-failed at ${DONE}" >&2
      exit 1
    fi
    /bin/cat "$BUF" || exit 1
    DONE=$(( DONE + GOT ))
    printf '%s\n' "{\"stage\":\"write\",\"done\":${DONE},\"total\":${MUOS_BYTES}}" >>"$MUOS_PROGRESS"
    if (( GOT < N )); then
      break
    fi
  done
  if (( DONE < MUOS_BYTES )); then
    echo "short-write ${DONE}/${MUOS_BYTES}" >&2
    exit 2
  fi
  exit 0
) | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}' >"$HASH_WRITE"
WRITE_PIPE_EC=${PIPESTATUS[0]}
set -e

exec 3<&-
stop_pid "$HELPER_PID"
HELPER_PID=""

if [[ "$WRITE_PIPE_EC" -eq 3 ]]; then
  exec 9>&-
  fail "Cancelled. The card is incomplete; install again before using it."
fi
[[ "$WRITE_PIPE_EC" -eq 0 ]] || fail "Writing to the card failed (exit ${WRITE_PIPE_EC})."

WRITE_GOT=$(/bin/cat "$HASH_WRITE" 2>/dev/null || true)
[[ -n "$WRITE_GOT" ]] || fail "Could not hash the data while writing."
if [[ "$WRITE_GOT" != "$MUOS_HASH" ]]; then
  exec 9>&-
  fail "The bytes sent to the card do not match the image (got ${WRITE_GOT:0:12}…, want ${MUOS_HASH:0:12}…). Install again."
fi

emit "{\"stage\":\"write\",\"done\":${MUOS_BYTES},\"total\":${MUOS_BYTES}}"

# Flush this fd to the card without diskutil (sync/unmount remounts MustardOS and dirties sectors).
if [[ -x /usr/bin/python3 ]]; then
  /usr/bin/python3 -c 'import fcntl,os; fcntl.fcntl(9, getattr(fcntl,"F_FULLFSYNC",51))' 2>/dev/null \
    || /usr/bin/python3 -c 'import os; os.fsync(9)' 2>/dev/null \
    || /bin/sync
else
  /bin/sync
fi

# Close write and open read back-to-back — no unmount in between.
exec 9>&-
exec 8<"$DEV" || fail "Could not open ${DEV} for read-back."

if skip_verify; then
  exec 8<&-
  unmount
  emit '{"stage":"verify","done":0,"total":0,"skipped":true}'
  emit '{"stage":"done"}'
  exit 0
fi

# --- verify ---
emit "{\"stage\":\"verify\",\"done\":0,\"total\":${MUOS_BYTES}}"
cancelled verify

set +e
(
  set +e
  DONE=0
  while (( DONE < MUOS_BYTES )); do
    if [[ -f "$MUOS_CANCEL" ]]; then exit 3; fi
    if [[ "${MUOS_SKIP_VERIFY:-0}" == "1" || -f "${MUOS_SKIP:-}" ]]; then exit 4; fi
    N=$(( MUOS_BYTES - DONE ))
    (( N > CHUNK )) && N=$CHUNK
    # head -c reads exactly N bytes (or fails) — unlike dd bs=N count=1 on rdisk.
    if ! /usr/bin/head -c "$N" <&8; then
      echo "read-failed at ${DONE}" >&2
      exit 1
    fi
    DONE=$(( DONE + N ))
    printf '%s\n' "{\"stage\":\"verify\",\"done\":${DONE},\"total\":${MUOS_BYTES}}" >>"$MUOS_PROGRESS"
  done
  exit 0
) | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}' >"$HASH_READ"
VERIFY_PIPE_EC=${PIPESTATUS[0]}
set -e

exec 8<&-

if [[ "$VERIFY_PIPE_EC" -eq 3 ]]; then
  fail "Cancelled before the read-back finished. The card was written but not verified."
fi
if [[ "$VERIFY_PIPE_EC" -eq 4 ]]; then
  unmount
  emit '{"stage":"verify","done":0,"total":0,"skipped":true}'
  emit '{"stage":"done"}'
  exit 0
fi
[[ "$VERIFY_PIPE_EC" -eq 0 ]] || fail "Could not read the card back for verification (exit ${VERIFY_PIPE_EC})."

READ_GOT=$(/bin/cat "$HASH_READ" 2>/dev/null || true)
[[ -n "$READ_GOT" ]] || fail "Could not read the card back for verification."
emit "{\"stage\":\"verify\",\"done\":${MUOS_BYTES},\"total\":${MUOS_BYTES}}"

if [[ "$READ_GOT" != "$MUOS_HASH" ]]; then
  fail "Read-back does not match the image (wrote ${WRITE_GOT:0:12}… ok, read ${READ_GOT:0:12}…, want ${MUOS_HASH:0:12}…). Try another card reader or card, and do not boot this card."
fi

unmount
emit '{"stage":"done"}'
exit 0
