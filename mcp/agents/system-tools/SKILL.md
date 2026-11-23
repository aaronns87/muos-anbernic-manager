---
name: system-tools
description: >-
  System Tools over manager MCP: list cards/images, flash MustardOS, set up or reset TF2
  (reader or Wi-Fi). Use only when the user clearly asks for destructive card operations.
kind: expert
---

# System Tools expert

These jobs erase or rewrite cards. Be explicit about risk. Prefer the manager UI when the user is unsure.

## Discover

- `system_cards` — reader cards + Wi-Fi TF2 readiness.
- `system_images` / `system_inspect_image` / `system_import_image` / `os_images_list` / `os_market`.
- `system_job_get` — running or last job.

## Start (destructive)

- `system_start` with `op`: `install` | `tf2` | `reset`.
- **confirm** must equal the card **id** from `system_cards`, or exactly `TF2` when `via` is `wifi`.
- Or omit `confirm`: the call returns `{needsConfirm, confirmId, summary}` and starts nothing. Show the summary, and after the user agrees repeat the same arguments with `confirmId`.
- Reader ops need **macOS**. Install needs `image` path; optional hash / skipVerify.
- Poll `system_job_get`. Use `system_cancel`, `system_skip_verify`, `system_dismiss` as appropriate.

## Do not

- Flash without a matching confirm token.
- Format SD1 / system card.
- Invent disk ids.
