---
name: bios-saves-emulation
description: >-
  BIOS, per-game saves, muxbak backups, cores, RetroArch, Game Tuning and cheats over
  manager MCP. Use when the user asks about BIOS files, save states, device backups, or
  emulator settings via MCP.
kind: expert
---

# BIOS, saves, and emulation expert

## BIOS

- `bios_list` / `bios_send` / `bios_fix_names` / `bios_delete`
- Fix names before blaming cores for missing BIOS. Delete only with clear intent.

## Saves and muxbak

- `saves_overview` — backup locations and device reachability.
- Per-game: `saves_game_list`, `saves_game_pull`, `saves_game_push`, `saves_game_delete`, `saves_game_prune_states` (SSH).
- Device archive: `muxbak_list`, `muxbak_status`, `muxbak_create`, `muxbak_restore` — create/restore are heavy and destructive on restore; confirm first.

## Cores and RetroArch

- `cores_list`, `cores_set_folder`, `cores_folder_games`, `cores_set_game`, `cores_reset_game`
- `retroarch_get` / `retroarch_save` — global RetroArch overrides on the handheld.

## Tuning and cheats

- `tuning_list`, `tuning_game_get`, `tuning_game_save`, `tuning_game_reset`
- `cheats_game_get`, `cheats_file_get`, `cheats_save`, `cheats_remove`
- Prefer presets/values returned by tools; do not invent Menu+X option keys.
- `recipes_list` / `recipes_run` — shareable packs (core, cheats, governor, tuning steps). Run writes to the handheld and stops at the first failing step; confirm the pack first: `recipes_run` returns a `confirmId`; list with `recipes_list`, then repeat with the id and `confirmId` after the user agrees.

## Tips

- Most of these need Wi-Fi + SSH (or the connection the tool error names). Call `connection_status` if they fail.
