# Context For LLMs

English | [Simplified Chinese](context_for_llms.zh-CN.md)

This file gives coding agents enough repository context to make useful changes without confusing Legax's control, capability, and communication planes.

## Project In One Paragraph

Legax is a local-first remote control and relay layer for AI coding-agent CLIs. It lets a phone or Telegram user monitor agent events, select a CLI/project/session, reply to the selected agent, and approve or deny supported native permission prompts. It is not a hosted IDE, terminal UI automation layer, or agent security bypass.

## Core Boundaries

- Control plane: one adapter process per supported CLI under `scripts/`.
- Capability plane: `scripts/mcp-server.mjs` exposes `legax_send`, `legax_poll`, `legax_request_permission`, and `legax_status`.
- Communication plane: `scripts/lib/outbound-transports.mjs`, `scripts/lib/inbound-transports.mjs`, the relay server, Telegram, and webhooks.
- Runtime state: `scripts/lib/runtime-state.mjs` is the shared cross-process state file owner. Do not add a sibling state file for adapter coordination.
- Config format: YAML only. Use `scripts/lib/yaml.mjs`; do not introduce JSON config support or a YAML dependency casually.

## Current Adapter Facts

| Adapter | Important behavior |
| --- | --- |
| Codex | Uses shared app-server websocket mode for local visibility and JSON-RPC approval callbacks. |
| Claude Code | Uses `claude -p` stream-json and Claude permission-prompt MCP for approvals. |
| Gemini CLI | Runs one headless turn per phone message and uses Gemini's own approval mode. |
| OpenCode | Uses `opencode serve` HTTP APIs for session listing and text routing. Native permission callback bridging is not implemented yet. |

## Safe Contribution Checklist

1. Read `AGENTS.md` and the relevant docs before editing.
2. Keep English and Simplified Chinese documentation pairs in the same change.
3. Never commit `config.yaml`, `data/`, logs, local package tarballs, generated machine config, or secrets.
4. Do not simulate UI clicks, auto-approve prompts, or bypass native agent security policy.
5. If you add scripts or E2E files, update the explicit lists in `package.json`.
6. Run the narrow relevant check first, then `npm run check:docs` for docs-only changes or `npm run ci` for broad code changes.

## Useful Entry Points

| Task | Start here |
| --- | --- |
| Install Legax | `README.md`, then `docs/USER_MANUAL.md` |
| Ask an AI to install Legax | `docs/AI_INSTALL.md` |
| Understand architecture | `docs/ARCHITECTURE.md` |
| Understand product limits | `docs/FUNCTIONAL_BOUNDARIES.md` |
| Add an adapter or transport | `docs/EXTENDING.md` |
| Review protocol shapes | `docs/LEGAX_PROTOCOL.md` |
| Work on the Codex plugin | `docs/CODEX_PLUGIN.md`, `.codex-plugin/plugin.json`, `.mcp.json`, `skills/legax/SKILL.md` |

## Verification Commands

```bash
npm run check:docs
npm run check:node
npm run test:e2e
npm run ci
```

Use `npm run check:docs` for documentation-only changes. Use `npm run ci` before claiming a code branch is ready to merge.
