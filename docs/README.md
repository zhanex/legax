# Documentation Index

English | [Simplified Chinese](README.zh-CN.md)

Use this index to find stable project documentation. Agent context routing lives in [Context For LLMs](context_for_llms.md); verification routing lives in [Change Matrix](CHANGE_MATRIX.md).

## How To Use This Tree

- Coding agents start with `AGENTS.md`, then use [Context For LLMs](context_for_llms.md).
- Human contributors use this index by work area. Do not read every design document for a small change.
- Architecture and contract documents are binding for their areas even when a task only loads a subset into context.
- When a change crosses areas, load the union of the relevant branch documents.

```text
docs/
  README.md                  documentation tree
  context_for_llms.md        compact agent map
  CHANGE_MATRIX.md           changed paths to focused tests
  ARCHITECTURE.md            global ownership model
  ENGINEERING_GUIDE.md       naming, constants, ownership, patterns
  CONFIGURATION.md           config and YAML parser contract
  RELAY_API.md               relay endpoint contract
  RELAY_STORE.md             relay-side persistent records
  RUNTIME_STATE.md           local daemon/adapter coordination
  STATE_MACHINES.md          mode, approval, command, workflow transitions
  OBSERVABILITY.md           logs, health, status, audit, diagnostics
  DOCUMENTATION.md           docs language-pair and review rules
  adr/                       accepted architecture decisions
```

## User Docs

| Document | Use it for |
| --- | --- |
| [User Manual](USER_MANUAL.md) | Fresh install, relay setup, phone pairing, Telegram setup, health checks, troubleshooting. |
| [AI Install Guide](AI_INSTALL.md) | An agent or automation assistant installing Legax for a human operator. |
| [Codex Plugin Guide](CODEX_PLUGIN.md) | Installing the Codex plugin, reviewing release-candidate metadata, and understanding Plugin Directory readiness. |
| [Feishu and Lark Transport](FEISHU_LARK.md) | Feishu/Lark app-bot setup, event callbacks, routing, and safety boundaries. |
| [Adapter Guide](ADAPTERS.md) | Codex, Claude Code, Gemini CLI, OpenCode, desktop mirror, runtime modes, and approval boundaries. |
| [Claude Code Integration](CLAUDE_CODE_INTEGRATION.md) | Claude Code adapter, permission-prompt MCP flow, safety boundaries, and ecosystem review questions. |

## Design and Extension Docs

| Document | Use it for |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Control, capability, communication, relay-owned Telegram/Feishu routing, daemon, runtime-state, and adapter design. |
| [Functional Boundaries](FUNCTIONAL_BOUNDARIES.md) | What Legax owns, what it intentionally does not own, and non-goals. |
| [Engineering Guide](ENGINEERING_GUIDE.md) | Naming, constants, directory ownership, design patterns, anti-patterns, error handling, and testing rules. |
| [Change Matrix](CHANGE_MATRIX.md) | Changed paths to focused verification commands for coding agents and maintainers. |
| [Configuration Contract](CONFIGURATION.md) | YAML subset, config sections, path rules, transport fields, and adapter field classes. |
| [Relay API](RELAY_API.md) | Relay HTTP endpoints, auth classes, status codes, and retry/stale-token behavior. |
| [Relay Store](RELAY_STORE.md) | `legax.relay/1` sessions, generations, leases, handoffs, artifacts, hosts, commands, inbox, and workflow records. |
| [Runtime State](RUNTIME_STATE.md) | Local daemon/adapter coordination schema, queues, cursors, modes, launch requests, and lock rules. |
| [Legax Protocol](LEGAX_PROTOCOL.md) | Cross-adapter event contracts, pairing offers, portable sessions, checkpoint artifacts, and restricted workflow APIs. |
| [State Machines](STATE_MACHINES.md) | Runtime mode, daemon, approval, lease, handoff, command, workflow, and session-selection transitions. |
| [Compatibility Matrix](COMPATIBILITY.md) | External CLI and remote-surface compatibility assumptions and review checklist. |
| [Context For LLMs](context_for_llms.md) | Repository map and safety rules for coding agents making changes. |
| [Adapter Conformance](ADAPTER_CONFORMANCE.md) | Shared adapter requirements for routing, sessions, approvals, restart behavior, and tests. |
| [Extending Legax](EXTENDING.md) | Adding adapters, transports, config fields, and tests. |
| [Architecture Decision Records](adr/README.md) | Durable decisions and constraints that shape the project architecture. |

## Maintainer Docs

| Document | Use it for |
| --- | --- |
| [Documentation Standards](DOCUMENTATION.md) | Language pairs, encoding, secret scanning, and review checklist. |
| [Observability](OBSERVABILITY.md) | Logging, audit, health, status, retention, and diagnostics rules. |
| [Release Guide](RELEASE.md) | Local release checks and package publishing flow. |
| [Roadmap](ROADMAP.md) | Likely priorities and explicit non-goals. |
| [Privacy Notice](PRIVACY.md) | Data handling, storage, third-party transports, and operator choices. |
| [Terms of Use](TERMS.md) | Intended use, prohibited use, warranty, and third-party service notes. |

## Community Files

GitHub surfaces the repository community files from `.github/`:

- [Contributing](../.github/CONTRIBUTING.md)
- [Code of Conduct](../.github/CODE_OF_CONDUCT.md)
- [Security Policy](../.github/SECURITY.md)
- [Support](../.github/SUPPORT.md)
- [Pull Request Template](../.github/PULL_REQUEST_TEMPLATE.md)

Issue forms live under [`.github/ISSUE_TEMPLATE/`](../.github/ISSUE_TEMPLATE/).
