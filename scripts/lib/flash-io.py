#!/usr/bin/env python3
"""Write a MustardOS image to a raw disk and optionally read it back.

Runs as root under flash-card.sh. While the device is open, a background thread
force-unmounts any volumes on this disk so DiskArbitration cannot remount
MustardOS mid-write and dirty sectors (that produced write-hash OK / read-back fail).

Env: MUOS_DISK MUOS_IMAGE MUOS_KIND MUOS_BYTES MUOS_HASH MUOS_PROGRESS
     MUOS_CANCEL MUOS_SKIP MUOS_SKIP_VERIFY MUOS_DEV
"""
from __future__ import annotations

import gzip
import hashlib
import os
import signal
import subprocess
import sys
import threading

CHUNK = 4 * 1024 * 1024
F_FULLFSYNC = 51


def emit(obj: str) -> None:
    with open(os.environ["MUOS_PROGRESS"], "a", encoding="utf-8") as f:
        f.write(obj + "\n")


def fail(msg: str, code: int = 1) -> None:
    esc = msg.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ").replace("\t", " ")
    emit(f'{{"error":"{esc}"}}')
    print(msg, file=sys.stderr)
    sys.exit(code)


def cancelled(verify: bool = False) -> None:
    if os.path.exists(os.environ.get("MUOS_CANCEL", "")):
        if verify:
            fail("Cancelled before the read-back finished. The card was written but not verified.", 3)
        fail("Cancelled. The card is incomplete; install again before using it.", 3)


def skip_verify() -> bool:
    if os.environ.get("MUOS_SKIP_VERIFY") == "1":
        return True
    skip = os.environ.get("MUOS_SKIP", "")
    return bool(skip) and os.path.exists(skip)


class UnmountWatchdog:
    """Force-unmount volumes on this disk every 250ms so remounts cannot stick."""

    def __init__(self, disk: str) -> None:
        self.bdev = f"/dev/{disk}"
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="unmount", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=2)
        self._unmount()

    def _unmount(self) -> None:
        subprocess.run(
            ["/usr/sbin/diskutil", "unmountDisk", "force", self.bdev],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )

    def _loop(self) -> None:
        while not self._stop.wait(0.25):
            self._unmount()


def open_image(path: str, kind: str):
    if kind == "gz":
        return gzip.open(path, "rb")
    return open(path, "rb")


def full_fsync(fd: int) -> None:
    try:
        import fcntl
        fcntl.fcntl(fd, getattr(fcntl, "F_FULLFSYNC", F_FULLFSYNC))
    except OSError:
        os.fsync(fd)


def read_exact(fd: int, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        chunk = os.read(fd, n - len(buf))
        if not chunk:
            break
        buf.extend(chunk)
    return bytes(buf)


def write_exact(fd: int, buf: bytes) -> None:
    sent = 0
    while sent < len(buf):
        w = os.write(fd, buf[sent:])
        if w <= 0:
            raise OSError("short write")
        sent += w


def main() -> None:
    disk = os.environ["MUOS_DISK"]
    image = os.environ["MUOS_IMAGE"]
    kind = os.environ["MUOS_KIND"]
    total = int(os.environ["MUOS_BYTES"])
    expect = os.environ["MUOS_HASH"].lower()
    dev_path = os.environ.get("MUOS_DEV") or f"/dev/r{disk}"

    if total <= 0 or total % 512:
        fail("The image length is invalid.")
    if not os.path.isfile(image):
        fail("The disk image is missing.")

    watchdog = UnmountWatchdog(disk)
    watchdog._unmount()

    fd = -1
    try:
        fd = os.open(dev_path, os.O_RDWR)
    except OSError:
        alt = f"/dev/{disk}"
        try:
            fd = os.open(alt, os.O_RDWR)
            dev_path = alt
        except OSError as exc:
            fail(f"Could not open {dev_path} for writing ({exc}).")

    watchdog.start()
    try:
        emit(f'{{"stage":"write","done":0,"total":{total}}}')
        hasher = hashlib.sha256()
        done = 0
        with open_image(image, kind) as src:
            while done < total:
                cancelled()
                n = min(CHUNK, total - done)
                buf = src.read(n)
                if not buf:
                    fail(f"The image ended after {done} of {total} bytes. Nothing further was written.")
                try:
                    write_exact(fd, buf)
                except OSError as exc:
                    fail(f"Writing to the card failed at offset {done}: {exc}.")
                hasher.update(buf)
                done += len(buf)
                emit(f'{{"stage":"write","done":{done},"total":{total}}}')

        write_got = hasher.hexdigest()
        if write_got != expect:
            fail(
                f"The bytes sent to the card do not match the image "
                f"(got {write_got[:12]}…, want {expect[:12]}…). Install again."
            )

        emit(f'{{"stage":"write","done":{total},"total":{total}}}')
        full_fsync(fd)
        watchdog._unmount()

        if skip_verify():
            emit('{"stage":"verify","done":0,"total":0,"skipped":true}')
            emit('{"stage":"done"}')
            return

        emit(f'{{"stage":"verify","done":0,"total":{total}}}')
        os.lseek(fd, 0, os.SEEK_SET)
        hasher = hashlib.sha256()
        done = 0
        while done < total:
            cancelled(verify=True)
            if skip_verify():
                emit('{"stage":"verify","done":0,"total":0,"skipped":true}')
                emit('{"stage":"done"}')
                return
            n = min(CHUNK, total - done)
            buf = read_exact(fd, n)
            if len(buf) != n:
                fail(f"Could not read the card back for verification at offset {done}.")
            hasher.update(buf)
            done += len(buf)
            emit(f'{{"stage":"verify","done":{done},"total":{total}}}')

        read_got = hasher.hexdigest()
        emit(f'{{"stage":"verify","done":{total},"total":{total}}}')
        if read_got != expect:
            fail(
                f"Read-back does not match the image (wrote {write_got[:12]}… ok, "
                f"read {read_got[:12]}…, want {expect[:12]}…). "
                "macOS may have remounted the card during the write; try again, or another reader/card."
            )
        emit('{"stage":"done"}')
    finally:
        watchdog.stop()
        if fd >= 0:
            try:
                os.close(fd)
            except OSError:
                pass


if __name__ == "__main__":
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    main()
