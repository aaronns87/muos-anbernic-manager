---
name: transfers-jobs
description: >-
  Copying games and artwork via manager MCP jobs: plan a transfer, start it, poll
  progress, cancel or forget jobs. Use when the user wants to send ROMs or art to the
  handheld or check a running copy.
kind: expert
---

# Transfers and jobs expert

## Flow

1. Ensure a live connection (`connection_status`).
2. `transfer_plan` — build what would be copied (systems/games selection as the tool schema allows).
3. `transfer_start` — enqueue the job (USB may serialize; extras wait).
4. `job_list` / `job_get` — poll progress (`id` from start/list).
5. `job_cancel` — stop a running job; `job_forget` — drop history entries.

## Tips

- Prefer plan → confirm with the user → start for large copies.
- Report percent / bytes from `job_get` instead of inventing progress.
- Artwork sync may appear as separate job kinds; read the job label/kind from the API result.
- Syncthing idle waits are a manager setting; if transfers stall, check connection and services, not only the job id.
