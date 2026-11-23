---
name: files-apps-themes
description: >-
  Sandboxed workspace files, apps, PortMaster ports, themes, OS images, activity and
  logs over manager MCP. Use when browsing or editing manager folders, installing apps
  or themes, or inspecting logs via MCP. Treat System Tools–class actions as destructive.
kind: expert
---

# Files, apps, themes, and OS expert

## Workspace files (sandboxed)

- `files_roots`, `files_list`, `files_read`, `files_write`, `files_mkdir`, `files_rename`, `files_delete`, `files_copy`
- Stay inside the roots the tools expose. Path traversal is rejected — do not try to escape.

## Apps and market

- `apps_list`, `apps_send`
- `market_list`, `market_download`

## Ports

- `ports_list`, `ports_install`, `ports_uninstall` — PortMaster over SSH; handheld often needs its own network.

## Themes

- `themes_list`, `themes_install`, `themes_apply`, `themes_delete`

## OS / images

- `os_images_list`, `os_market` — listing and catalogue. Card format / OS install style operations are destructive; only when the user clearly asked, and say so bluntly.

## Meta

- `workspace_info`, `activity_list`, `logs_list`
- `manager_status`, `mcp_stats`, `mcp_tool_catalogue`, `agent_pack_list`, `agent_pack_get`

## Tips

- Prefer list/read before write/delete.
- Install/apply/uninstall mutate the handheld or workspace; summarize results from tool JSON.
