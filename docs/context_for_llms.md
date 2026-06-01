# Context For LLMs

English | [Simplified Chinese](context_for_llms.zh-CN.md)

This file gives coding agents enough repository context to make useful changes without confusing Legax's control, capability, and communication planes.

## Project In One Paragraph

Legax manages session routing, task identity, approvals, handoffs, and controlled workflows across agent CLIs. Remote surfaces can monitor agent events, select a CLI/project/session, reply to the selected agent, and approve or deny supported native permission prompts. Hosted IDE behavior, terminal UI automation, and agent security bypasses are outside the project scope.

## Core Boundaries

- Control plane: one adapter process per supported CLI under `scripts/`.
- Capability plane: `scripts/mcp-server.mjs` exposes `legax_send`, `legax_poll`, `legax_request_permission`, and `legax_status`.
- Communication plane: `scripts/lib/outbound-transports.mjs`, `scripts/lib/inbound-transports.mjs`, the relay server, Telegram, and webhooks.
- Runtime state: `scripts/lib/runtime-state.mjs` is the shared cross-process state file owner. Do not add a sibling state file for adapter coordination.
- Relay store: `data/relay-store.json` uses `legax.relay/1` and owns portable relay session state. Keep it separate from runtime-state coordination.
- Config format: YAML only. Use `scripts/lib/yaml.mjs`; do not introduce JSON config support or a YAML dependency casually.
- Engineering rules: follow `docs/ENGINEERING_GUIDE.md` for naming, constants, directory ownership, design patterns, and anti-patterns.

## Document Loading Rules

Do not load every design document by default. Load the smallest relevant set for the files you will edit, while treating the listed documents as binding for their areas.

| Editing area | Required context |
| --- | --- |
| Any non-trivial code change | `AGENTS.md`, this file, `docs/ENGINEERING_GUIDE.md`, `docs/CHANGE_MATRIX.md` |
| Architecture, ownership, or scope decisions | `docs/ARCHITECTURE.md`, `docs/FUNCTIONAL_BOUNDARIES.md`, relevant ADRs under `docs/adr/` |
| Adapter scripts or adapter tests | `docs/ADAPTERS.md`, `docs/ADAPTER_CONFORMANCE.md`, `docs/EXTENDING.md` |
| MCP tools, permission MCP, skill, or plugin metadata | `docs/CODEX_PLUGIN.md`, `skills/legax/SKILL.md`, `docs/OBSERVABILITY.md` |
| Daemon, modes, launch requests, runtime queues | `docs/RUNTIME_STATE.md`, `docs/STATE_MACHINES.md` |
| Relay endpoints or relay-side records | `docs/RELAY_API.md`, `docs/RELAY_STORE.md`, `docs/LEGAX_PROTOCOL.md` |
| Config shape, YAML parser, examples | `docs/CONFIGURATION.md`, `config.example.yaml`, `config.example.zh-CN.yaml` |
| Transports, Telegram, Feishu/Lark, webhook routing | `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`, `docs/FEISHU_LARK.md`, `docs/COMPATIBILITY.md` |
| Workflows, checkpoint artifacts, worktree-lite | `docs/LEGAX_PROTOCOL.md`, `docs/RELAY_API.md`, `docs/RELAY_STORE.md`, `docs/STATE_MACHINES.md` |
| Authentication, secrets, privacy, public relay exposure | `docs/RELAY_API.md`, `docs/OBSERVABILITY.md`, `docs/PRIVACY.md`, `.github/SECURITY.md` |
| Logs, health, status, audit, diagnostics | `docs/OBSERVABILITY.md` |
| Documentation-only changes | `docs/DOCUMENTATION.md`, `docs/README.md` |
| Release or package work | `docs/RELEASE.md` |

If a change crosses more than one area, load the union of the relevant rows. If a document conflicts with `AGENTS.md`, stop and surface the conflict before editing.

## Current Adapter Facts

| Adapter | Important behavior |
| --- | --- |
| Codex | Uses shared app-server websocket mode for local visibility and JSON-RPC approval callbacks. |
| Claude Code | Uses `claude -p` stream-json and Claude permission-prompt MCP for approvals. |
| Gemini CLI | Runs one headless turn per phone message and uses Gemini's own approval mode. |
| OpenCode | Uses `opencode serve` HTTP APIs for session listing and text routing. Native permission callback bridging is not implemented yet. |

## Safe Contribution Checklist

1. Read `AGENTS.md` and the relevant docs from the routing table before editing.
2. Keep English and Simplified Chinese documentation pairs in the same change.
3. Never commit `config.yaml`, `data/`, logs, local package tarballs, generated machine config, or secrets.
4. Do not simulate UI clicks, auto-approve prompts, or bypass native agent security policy.
5. If you add scripts or E2E files, update the explicit lists in `package.json`.
6. Name behavioral constants instead of scattering hard-coded values; new hard-coded values require human review.
7. Use `docs/CHANGE_MATRIX.md` to choose focused verification before broader gates.
8. Run the narrow relevant check first, then `npm run check:docs` for docs-only changes or `npm run ci` for broad code changes.

## Useful Entry Points

| Task | Start here |
| --- | --- |
| Install Legax | `README.md`, then `docs/USER_MANUAL.md` |
| Ask an AI to install Legax | `docs/AI_INSTALL.md` |
| Understand architecture | `docs/ARCHITECTURE.md` |
| Follow engineering rules | `docs/ENGINEERING_GUIDE.md` |
| Choose docs and tests for a code change | `docs/CHANGE_MATRIX.md` |
| Review config fields | `docs/CONFIGURATION.md` |
| Review Relay HTTP APIs | `docs/RELAY_API.md` |
| Review runtime state | `docs/RUNTIME_STATE.md` |
| Review state transitions | `docs/STATE_MACHINES.md` |
| Review compatibility assumptions | `docs/COMPATIBILITY.md` |
| Understand product limits | `docs/FUNCTIONAL_BOUNDARIES.md` |
| Add an adapter or transport | `docs/EXTENDING.md` |
| Review protocol shapes | `docs/LEGAX_PROTOCOL.md` |
| Review diagnostics and audit behavior | `docs/OBSERVABILITY.md` |
| Work on the Codex plugin | `docs/CODEX_PLUGIN.md`, `.codex-plugin/plugin.json`, `.mcp.json`, `skills/legax/SKILL.md` |

## Verification Commands

```bash
npm run check:docs
npm run check:node
npm run test:e2e
npm run ci
```

Use `npm run check:docs` for documentation-only changes. Use `npm run ci` before claiming a code branch is ready to merge.
