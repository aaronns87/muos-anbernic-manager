---
name: artwork-play
description: >-
  Artwork scrape/sync and handheld play activity/collections over manager MCP. Use when the
  user wants box art, device catalogue sync, play times, or MustardOS collections via MCP.
kind: expert
---

# Artwork, play, and collections expert

## Artwork scrape (libretro → Roms/Imgs)

- `artwork_scrape_plan` — plan matches (`only`: missing|all).
- `artwork_scrape_game` — picks for one title.
- `artwork_scrape_save` — download one PNG into Roms/<system>/Imgs.
- `artwork_local_delete` — trash local Imgs (destructive).

## Device catalogue sync

- `artwork_get_plan` / `artwork_send_plan` → `artwork_start` (poll `job_get`).
- `artwork_send_game` / `artwork_get_game` / `artwork_delete_device` for one file.
- `artwork_keep_on_card` — ensure catalogue folders on TF2.

## Play activity

- `play_activity` — tracker + recent history (needs SD1).
- `play_reset` — reset time or history (destructive for that data).

## Collections

- `collections_list` / `collections_create` / `collections_rename` / `collections_delete`
- `collections_add` — games must already be on the handheld (pointers only).
- `collections_remove` — removes .cfg entries, not ROMs.
