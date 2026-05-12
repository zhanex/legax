# Adapter Conformance

English | [Simplified Chinese](ADAPTER_CONFORMANCE.zh-CN.md)

This checklist defines the behavior expected from every Legax coding-agent adapter. It is written for contributors who want to add, review, or maintain adapters without weakening the shared remote-control model.

For implementation guidance, read [Extending Legax](EXTENDING.md). For the three-plane architecture, read [Architecture](ARCHITECTURE.md).

## Required Boundaries

Every adapter must keep these boundaries intact:

- The daemon owns lifecycle supervision, inbound routing, and on-demand launches.
- The adapter owns one CLI runtime and its session model.
- MCP exposes capabilities; it does not start or stop adapter processes.
- Cross-process state belongs in `scripts/lib/runtime-state.mjs`.
- Approval decisions must flow through native structured callbacks when available.
- Fallback PTY or TUI control must be treated as high-trust remote terminal control.

## Behavior Checklist

| Area | Requirement |
| --- | --- |
| Startup | Read YAML config, normalize defaults, validate adapter contract, and start or connect without requiring hidden global state. |
| Identity | Expose a stable `agentId` and human-readable `agentLabel` for relay and Telegram menus. |
| Modes | Respect `interactive`, `approval-only`, `monitor`, and `paused` consistently. |
| Session listing | Provide a bounded session list when the CLI has sessions; clearly report unsupported session discovery. |
| Session selection | Persist selected project/chat/session metadata through runtime state, not a private state file. |
| Phone text | Accept phone text only in `interactive` mode and route it to the selected session or new-session path. |
| Approvals | Accept phone approvals only in `interactive` or `approval-only` mode. |
| Orphans | When a decision or input response has no pending request, log it and send a status event back to the phone. |
| Restart behavior | Use cursors and runtime state so old phone messages are not replayed after adapter restart. |
| Redaction | Use shared outbound transport redaction unless a caller explicitly allows sensitive text. |
| Notifications | Keep verbose agent output behind config gates; do not spam high-volume raw streams by default. |
| Shutdown | Exit cleanly when the daemon stops the adapter and avoid leaving child processes unmanaged. |

## Native Approval Requirements

An adapter may claim phone approval support only when the CLI exposes a supported callback or permission mechanism.

| Adapter | Native approval path | Current status |
| --- | --- | --- |
| Codex | JSON-RPC approval callbacks such as `requestApproval` | Supported |
| Claude Code | Permission-prompt MCP tool result | Supported |
| Gemini CLI | Gemini approval mode | Supported |
| OpenCode | Native permission callback bridge | Not implemented |

Adapters must not:

- simulate UI clicks
- scrape terminal approval prompts
- auto-approve prompts
- translate phone approval into shell input unless the backend is explicitly documented as a high-trust terminal backend

## Test Expectations

Adapter changes should include focused tests where practical:

```bash
npm run check:node
npm run check:docs
node --test tests/e2e/<adapter-or-transport>.e2e.mjs
```

Broad shared behavior should be covered by:

```bash
npm run test:e2e
```

Real CLI compatibility remains opt-in:

```bash
LEGAX_REAL_CLIENTS=1 npm run test:e2e:real
```

## Review Questions

Before merging adapter work, reviewers should be able to answer:

- Which process owns the CLI lifecycle?
- Where is selected session state persisted?
- Which modes accept or ignore phone text and approvals?
- What happens if the adapter restarts while a permission request is pending?
- Is the approval path native, or is it a documented high-trust fallback?
- Which exact command proves the touched behavior?
