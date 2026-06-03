# Context For LLMs

English | [Simplified Chinese](context_for_llms.zh-CN.md)

Compact map for coding agents: smallest useful context first, canonical owner for durable facts.

## Read Budget

- Default: read `AGENTS.md`, this file, and at most one task row.
- Prefer `Agent Summary`; read full docs only when editing that contract or resolving ambiguity.
- Default to English docs. Load Chinese pairs only for translation, Chinese docs, or pair checks.
- Do not bulk-read `docs/` or load whole routing tables. Cross-area changes use the smallest useful union.

## Non-Negotiable Rules

- Dependency-free Node 18+ only; no casual package, bundler, or JSON config support.
- Runtime coordination lives in `scripts/lib/runtime-state.mjs`; relay state lives in relay store.
- MCP is a capability layer, not a lifecycle manager.
- Never bypass native approval policy or simulate approvals.
- Keep English and Simplified Chinese docs paired.
- New scripts and E2E files must be added to the explicit `package.json` lists.

## Task Routing

| Task | Read before editing |
| --- | --- |
| Architecture, ownership, lifecycle, scope | `docs/ARCHITECTURE.md`, `docs/FUNCTIONAL_BOUNDARIES.md` |
| Adapter scripts or adapter tests | `docs/ADAPTERS.md`, `docs/ADAPTER_CONFORMANCE.md` |
| Daemon, modes, launches, local queues | `docs/RUNTIME_STATE.md`, `docs/STATE_MACHINES.md` |
| Relay endpoints or browser/phone routing | `docs/RELAY_API.md`; add `docs/RELAY_STORE.md` for persisted records |
| Events, portable sessions, workflows, checkpoints | `docs/LEGAX_PROTOCOL.md`, plus changed endpoint or store owner |
| Config fields, examples, or YAML parser | `docs/CONFIGURATION.md`, `docs/DOCUMENTATION.md` |
| Telegram, Feishu/Lark, webhooks | `docs/CONFIGURATION.md`, `docs/FEISHU_LARK.md`, `docs/COMPATIBILITY.md` |
| MCP tools, permission MCP, plugin or skill metadata | `docs/CODEX_PLUGIN.md`, `skills/legax/SKILL.md` |
| Logs, health, audit, diagnostics, privacy | `docs/OBSERVABILITY.md`; add `docs/PRIVACY.md` for data handling |
| Documentation-only changes | `docs/DOCUMENTATION.md`, `docs/README.md` |
| Release, package, or publishing work | `docs/RELEASE.md` |

Use `docs/CHANGE_MATRIX.md` after choosing context to select focused tests.

## Canonical Owners

| Fact | Owner |
| --- | --- |
| Control/capability/communication planes | `docs/ARCHITECTURE.md` |
| Scope, non-goals, safety boundaries | `docs/FUNCTIONAL_BOUNDARIES.md` |
| Relay HTTP endpoints/auth | `docs/RELAY_API.md` |
| Relay persisted records | `docs/RELAY_STORE.md` |
| Cross-adapter protocol shapes | `docs/LEGAX_PROTOCOL.md` |
| Local daemon/adapter runtime state | `docs/RUNTIME_STATE.md` |
| Config keys and YAML parser behavior | `docs/CONFIGURATION.md` |
| Documentation placement and language rules | `docs/DOCUMENTATION.md` |

## Verification

- Docs-only: audit against `docs/DOCUMENTATION.md`, then `npm run check:docs`.
- Code: run the narrow E2E from `docs/CHANGE_MATRIX.md`, then `npm run check:node`.
- Branch-ready: run `npm run ci`, or state why not.
