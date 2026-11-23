---
name: device-connection
description: >-
  Handheld connection and Device section over manager MCP: Wi-Fi/SSH/USB, Device Settings,
  Controls, Benchmark, Syncthing idle. Use when diagnosing connectivity or changing handheld
  settings via MCP.
kind: expert
---

# Device and connection expert

## Status first

- `connection_status` — Wi-Fi, SSH, cards, handheld presence, model hint, web services snapshot.
- `device_status` — richer device info when a target is available (`volume` optional).
- `web_services_status` — MustardOS web services (SSH, SFTP, Syncthing, …).
- `syncthing_idle` / `syncthing_wait_idle` — before large copies when Syncthing is in use.

## Wi-Fi / USB

- `wifi_find` — mDNS scan for MustardOS handhelds.
- `wifi_save` — save host/port/user (opens on next SSH/SFTP). Never echo passwords.
- `usb_allow` / `usb_release` / `usb_restart` — claim or free MTP.
- `device_reconnect` — drop USB + SFTP + SSH so the next action reconnects fresh.

## Device Settings (muxsettings)

- `handheld_settings_get` — read groups/values over SSH.
- `handheld_settings_save` — write `changes` (and optional `seen` for concurrency). Destructive for those keys.
- `handheld_settings_undo` — restore the last save on this host.
- Prefer keys and values from `handheld_settings_get`; do not invent mux key names.

## Controls & Benchmark

- `controls_snapshot` / `controls_state` — devices and live poll.
- `controls_joycal_get` / `controls_joycal_save` / `controls_calibrate` — stick calibration.
- Full visual button remapping UI remains in the manager; Andromeda layout can also be a Device Settings key.
- `benchmark_start` / `benchmark_status` / `benchmark_stop` — Device Benchmark.

## Tips

- Transfers need a live primary path. Fix connection before `transfer_*`.
- Andromeda MTP often needs Device Link off and USB function MTP (set on device or via `handheld_settings_save`).
