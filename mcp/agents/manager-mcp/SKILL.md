---
name: manager-mcp
description: >-
  How to use muOS Anbernic Manager over MCP (Streamable HTTP on localhost). Use when
  connecting to the manager MCP server, choosing tools, handling destructive actions,
  or when the user asks about manager MCP auth, tokens, or tool catalogue.
kind: skill
---

# Manager MCP skill

You talk to a **running** muOS Anbernic Manager on this computer via MCP tools. Prefer tools over guessing live state.

## Connection

- In IDE MCP lists the server is named **`MuAnMCP`**.
- Endpoint is localhost only (`http://127.0.0.1:<port>/mcp`). Never invent LAN URLs.
- Auth is a persistent **bearer token** (not the per-run UI `?token=`). Never ask for, print, or echo that token.
- If tools fail with auth errors, tell the user to open Tools → MCP and check the token / rotate.

## How to work

1. Orient with `manager_status` and/or `mcp_tool_catalogue` when unsure which tools exist.
2. Call domain tools for reads (`library_*`, `connection_status`, `handheld_settings_get`, `job_*`, …).
3. Mutating tools (delete, send, transfer, install, restore, settings, System Tools) run **without a second confirm** in the UI sense. Only use them when the user clearly asked. Say what you did afterward.
4. `system_start` still requires `confirm` equal to the card id or `TF2` (Wi-Fi TF2). Be blunt about irreversibility.
5. Use `agent_pack_list` / `agent_pack_get` (or MCP resources `agent://…`) for deeper domain experts.

## Coverage

Library (verify/CHD/m3u/homebrew), connection, Device Settings/Controls/Benchmark, Syncthing idle, transfers, artwork, play/collections, BIOS/saves, emulation, files, apps/ports/themes, System Tools, OS market, meta.

## Do not

- Drive EmulatorJS / in-browser play sessions (`play_capabilities` only).
- Invent UI buttons or paths that are not in tool results or these packs.
- Repeat API keys, Wi-Fi passwords, or MCP tokens.
