---
name: library-games
description: >-
  Roms library over manager MCP: list/search/delete/rescan, No-Intro verify, CHD convert,
  disc m3u playlists, free homebrew, and browser play capabilities. Use for library work via MCP.
kind: expert
---

# Library and games expert

## Read

- `library_list` / `library_search` / `game_get` / `library_rescan`
- `play_capabilities` — EmulatorJS support. **Does not start play** (UI only).
- `checks_status` — verify results and disc/CHD hints.
- `chd_status` — CHD convert status.
- `homebrew_list` — free/legal homebrew catalogue.

## Write (confirm intent first)

- `game_delete` — deletes library files.
- `checks_verify` then poll `checks_status`; `checks_trash` for bad dumps (destructive).
- `chd_convert` — needs `chdman` on PATH; poll `chd_status`.
- `disc_m3u_preview` / `disc_m3u_write` / `disc_m3u_batch` — multi-disc playlists.
- `homebrew_install` — download one free title into Roms/; poll `homebrew_list` for task progress.

## Tips

- System codes are folder names (GB, PS, MD, …).
- For copies use `transfer_plan` / `transfer_start`. For artwork scrape/sync see artwork tools / packs.
- Do not invent metadata missing from `game_get`.
