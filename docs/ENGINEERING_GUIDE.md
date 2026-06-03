# Engineering Guide

English | [Simplified Chinese](ENGINEERING_GUIDE.zh-CN.md)

## Agent Summary

This is the owner for day-to-day engineering rules: naming, constants, directory ownership, shared-code boundaries, patterns, anti-patterns, error handling, and test expectations. Read it before non-trivial code changes. It does not replace architecture or protocol contracts; use the relevant owner document when changing behavior.

This guide defines day-to-day engineering rules for Legax contributors. It complements [Architecture](ARCHITECTURE.md), [Adapter Conformance](ADAPTER_CONFORMANCE.md), and [Extending Legax](EXTENDING.md) by turning the architecture into naming, directory, pattern, and review rules.

## Scope

These rules apply to code, tests, examples, and maintainer documentation. User-facing setup instructions still belong in [User Manual](USER_MANUAL.md), and formal protocol or store shapes belong in [Legax Protocol](LEGAX_PROTOCOL.md), [Relay API](RELAY_API.md), and [Relay Store](RELAY_STORE.md).

## Naming

| Thing | Rule | Examples |
| --- | --- | --- |
| Adapter config key | Short, stable, lowercase where possible, no version suffix, no synonym keys. Existing camelCase keys remain stable. | `codex`, `claude`, `gemini`, `opencode`, `codexDesktopMirror` |
| `agentId` | Stable public routing id. Use a clear CLI-facing name and avoid local machine details. | `codex-cli`, `claude-code`, `gemini-cli` |
| Adapter script | `scripts/<name>-link.mjs`; one long-lived adapter entry per CLI runtime. | `scripts/opencode-link.mjs` |
| Shared library | `scripts/lib/<domain>.mjs`; name the domain, not the caller. | `runtime-state.mjs`, `outbound-transports.mjs` |
| Relay event kind | Lower snake case for portable protocol kinds. Legacy relay kinds may continue during migration. | `active_context`, `approval_request` |
| Relay store schema | Reverse-domain style with an integer major version. | `legax.relay/1` |
| Workflow schema | Same schema style as relay records. | `legax.workflow/1` |
| Command ref | Lower dot-separated action name. It must identify an allowlisted built-in, not a shell command. | `legax.ping`, `workflow.run_check` |
| Request id | Prefix with the domain that owns matching and dedupe. | `perm_...`, `cmd_...`, `lease_...` |
| YAML fields | camelCase for nested config fields; do not add duplicate spellings for the same behavior. | `runtimeStatePath`, `mcpAutoConfigure` |

When adding a public name, treat it as durable. Prefer adding a new explicit field over changing the meaning of an old one.

## Constants and Literals

Behavioral constants must be named, scoped, and reviewed. Do not add hard-coded values casually.

- Use named constants for timeouts, intervals, retry counts, TTLs, ports, body-size limits, schema versions, event kinds, modes, status strings, command refs, path names, and environment variable names.
- Include units in constant names where relevant, especially `_MS`, `_SECONDS`, `_BYTES`, or `_COUNT`.
- Keep constants in the module that owns the behavior. Promote them to a shared `scripts/lib/<domain>.mjs` module only when more than one owner needs the same contract.
- Avoid a broad catch-all `constants.mjs`; it hides ownership and encourages unrelated coupling.
- Inline literals are acceptable only when they are trivial local values, such as `0`, `1`, `-1`, `true`, `false`, `null`, empty arrays or objects, or string fragments with no behavioral meaning.
- New or changed hard-coded values require human review. If a value must stay inline for readability, the diff should make that reason clear.
- Do not duplicate the same literal contract in tests and implementation. Import or share the contract when it is part of behavior; duplicate only when the test intentionally asserts an external public value.

Examples:

```js
const DEFAULT_RELAY_POLL_INTERVAL_MS = 2000;
const MAX_RELAY_REQUEST_BODY_BYTES = 1024 * 1024;
const RUNTIME_STATE_SCHEMA = "legax.runtime/1";
```

## JavaScript Style

- Use plain JavaScript ESM and the Node 18+ standard library.
- Use two-space indentation, double quotes, and semicolons.
- Match the surrounding file before introducing a new local pattern.
- Prefer small pure helpers in `scripts/lib/<domain>.mjs` when behavior is shared.
- Keep package `bin` files thin; they should delegate to source scripts instead of duplicating business logic.
- Do not introduce TypeScript, transpilation, a bundler, or formatting-only churn without an accepted design.
- Do not add npm dependencies unless an accepted design explains why the Node standard library is insufficient.

## Directory Ownership

| Path | Owns | Must not own |
| --- | --- | --- |
| `scripts/*-link.mjs` | Adapter process entry points, CLI command lines, structured output parsing, session selection, native approval bridging. | Daemon supervision, sibling adapter startup, relay store schema definitions. |
| `scripts/legax-daemon.mjs` | Adapter supervision, remote routing, on-demand launches, host heartbeats, relay command worker. | CLI-specific stream parsing or provider-specific approval protocol internals. |
| `scripts/lib/*.mjs` | Shared parser, path, protocol, runtime state, transport, menu, workflow, artifact, and helper code. | User-facing setup prose or npm package wrapper logic. |
| `scripts/lib/relay-server-core.mjs` | Relay HTTP APIs, relay store mutations, browser page, Telegram/Feishu ingress, pairing, attention inbox. | Adapter lifecycle and direct CLI process management. |
| `self-hosted-relay/lib/*` | Standalone relay copies required for deployable relay mode. | Divergent behavior from the matching shared relay library. |
| `packages/*/bin` | Thin npm package entry points. | Core business logic. |
| `tests/e2e/*.e2e.mjs` | Behavior coverage for adapters, relay, daemon, protocol, packaging, and docs gates. | Hidden test-only behavior not reachable through public scripts. |
| `docs/*.md` | Durable contracts, design rationale, and operator or maintainer guidance. | Secrets, machine-specific config, or unpaired language-only updates. |
| `docs/adr/*.md` | Architecture decision records and accepted constraints. | Step-by-step user setup or active implementation plans. |

New code should follow the existing ownership boundary before adding a new directory. If a change needs a new owner, document the boundary first.

## Deployable Copies

The standalone relay can be installed by copying only `self-hosted-relay/`, so several shared source files have deployable copies. Keep these pairs behaviorally identical unless a documented release constraint explains the difference.

| Source file | Deployable copy |
| --- | --- |
| `scripts/lib/relay-server-core.mjs` | `self-hosted-relay/lib/relay-server-core.mjs` |
| `scripts/lib/lps-actions.mjs` | `self-hosted-relay/lib/lps-actions.mjs` |
| `scripts/lib/telegram-transport.mjs` | `self-hosted-relay/lib/telegram-transport.mjs` |
| `scripts/lib/outbound-transports.mjs` | `self-hosted-relay/lib/outbound-transports.mjs` |
| `scripts/lib/menu-groups.mjs` | `self-hosted-relay/lib/menu-groups.mjs` |
| `scripts/lib/yaml.mjs` | `self-hosted-relay/lib/yaml.mjs` |
| `scripts/lib/paths.mjs` | `self-hosted-relay/lib/paths.mjs` |

When changing a source file in this table, check whether the copy must change in the same commit. When changing a copy directly, check whether the source file must change first.

## Core Patterns

- Use structured CLI protocols before terminal control. JSON-RPC, HTTP APIs, and stream-json are preferred over PTY or TUI scraping.
- Keep adapters as independent processes. The daemon supervises them, but CLI-specific behavior stays inside the adapter.
- Keep MCP as a capability plane. MCP tools may notify, poll, or request permission, but they must not start or stop adapter processes.
- Put cross-process adapter coordination in `scripts/lib/runtime-state.mjs` only.
- Put portable task/session truth in the `legax.relay/1` relay store only.
- Send outbound remote events through shared transport code so notification policy, formatting, and delivery behavior stay consistent.
- Treat relay commands and workflow steps as allowlisted command refs, never arbitrary remote shell.
- Make relay store writes idempotent where callers can retry. Use fencing tokens, lease tokens, claim tokens, or idempotency keys where stale writers are possible.
- Keep examples copyable. If a config field appears in an example, the related docs and tests should use the same spelling.

## Anti-Patterns

Do not introduce these patterns without first changing the architecture contract:

- Per-adapter private state files for cursors, selected sessions, modes, or launch requests.
- JSON config support, a YAML dependency, or ad hoc config parsing outside `scripts/lib/yaml.mjs`.
- npm dependencies for problems that the Node standard library can solve cleanly.
- UI click simulation, terminal prompt scraping, or shell input as an approval bridge.
- Remote workflow fields such as `shell`, `script`, `eval`, `prompt`, `command`, or free-form executable args.
- Transport-specific routing logic duplicated inside adapters when shared relay or inbound helpers can handle it.
- Logging secrets, full unredacted prompts, or provider tokens in docs, tests, or examples.
- Adding a script, test, or deployable copy without wiring it into the explicit CI lists.
- Scattering magic numbers, status strings, event names, modes, or timeout values instead of naming the contract they represent.

## Error Handling

- Network calls must have a timeout or abort path.
- Relay APIs should return `{ "ok": false, "error": "message" }` for JSON failures.
- Use `400` for invalid input, `401` for missing or invalid authentication, `403` for authenticated but ineligible actions, `404` for missing records, `409` for stale state or invalid state transitions, and `413` for oversized request bodies.
- Orphan `permission_decision` and `user_input_response` messages must be visible to the remote user through a status event; do not silently drop them.
- Adapter restarts must not replay old phone messages. Use cursors and runtime state.
- Timeout defaults must be fail-closed for approvals unless the operator explicitly configures otherwise.

## Testing

- For documentation-only changes, run `npm run check:docs`.
- For code changes, run the narrow affected E2E file first, then `npm run check:node`, and then the relevant broader gate.
- New files under `scripts/` and `tests/e2e/` must be appended to `package.json`; the lists are explicit.
- New relay endpoints need tests for auth, success, validation errors, stale-token or stale-fence behavior where relevant, and idempotent retry behavior when the API promises it.
- New YAML parser capability needs parser coverage and an example-config use case.
- Changes copied into `self-hosted-relay/lib/*` need source and standalone copies checked together.
- Tests that use real agent CLIs must remain behind the real-client opt-in gate.

## Review Checklist

Before merging a technical change, reviewers should be able to answer:

- Which plane owns this behavior: control, capability, communication, relay store, or local runtime state?
- Is the public name stable and consistent with the naming table?
- Did the change add a config field, event kind, command ref, schema field, or state transition that needs documentation?
- Did the change add or modify any hard-coded value, and has a human reviewer accepted it as intentional?
- Are retries safe, or does the write require a fence, lease token, claim token, or idempotency key?
- Does any remote input become shell, filesystem, or approval authority?
- Which exact command proves the changed behavior?
