# Extending Legax with a New Adapter

English | [Simplified Chinese](EXTENDING.zh-CN.md)

Legax ships four first-party CLI adapters (Codex, Claude Code, Gemini CLI, OpenCode). The daemon supervises them through a small contract declared in [`scripts/lib/adapter-contract.mjs`](../scripts/lib/adapter-contract.mjs). Adding another adapter — say Aider, Continue, OpenInterpreter, or something custom — is a matter of writing a long-lived script that follows the same conventions and registering it in the contract.

This document is the checklist. The contract module itself is the source of truth for the field shapes.

## What an Adapter Is

An adapter is a **separate Node.js process** owned by the daemon. It owns:

- The lifecycle of one CLI agent (spawn, restart, stop).
- Translating phone messages → CLI input.
- Translating CLI structured output → outbound transport events.
- Maintaining its own per-agent runtime coordination state via `scripts/lib/runtime-state.mjs`.
- Reporting errors and approvals through the relay or third-party transports.

The adapter does **not** call into the daemon — communication is one-way (daemon supervises, adapter runs). Cross-process adapter coordination state is exchanged exclusively through `data/runtime-state.json`. Do not use runtime state for portable relay-owned session truth; that belongs in the `legax.relay/1` relay store.

## Step-by-Step

### 1. Pick a CLI backend

Legax prefers structured CLI protocols over scraping a TUI. In order of preference:

1. **JSON-RPC over stdio or websocket** (Codex's `codex app-server --listen ws://...`).
2. **HTTP/OpenAPI server** (OpenCode's `opencode serve`).
3. **Stream-JSON** — line-delimited JSON over stdin/stdout (`claude -p --output-format stream-json`, `gemini --output-format stream-json`).
4. **Per-turn headless invocation** with structured output (`gemini --prompt '...' --output-format stream-json`).
5. **PTY scraping** — a last resort. Treat it as high-trust remote terminal control. Permissions, completion detection, and session listing all become unreliable.

If the CLI offers a structured server or JSON-RPC mode, use that. Don't reach for PTY just to avoid spec work.

### 2. Decide a canonical config key and `agentId`

The config key is the top-level YAML field users will write (e.g., `aider:`, `continue:`). Pick something short, lowercase, no underscores, no version suffix. The default `agentId` should match the user-facing agent name (e.g., `aider-cli`, `continue-cli`).

These two strings are stable across versions. Treat them as part of the public contract.

### 3. Implement `scripts/<name>-link.mjs`

Copy `scripts/opencode-link.mjs` if your CLI has an HTTP server, `scripts/claude-code-link.mjs` if your CLI is stream-json, or `scripts/codex-app-server-link.mjs` if it is JSON-RPC. Strip the agent-specific bits and refit. The file should be **independently runnable** — `node scripts/<name>-link.mjs` must work without bootstrapping a shared module.

Reuse the shared modules:

- `scripts/lib/yaml.mjs` — for `readYaml(path)`.
- `scripts/lib/runtime-state.mjs` — for cursors, modes, queues, Telegram selections.
- `scripts/lib/menu-groups.mjs` — for project/chat grouping and Telegram/relay menu callbacks.
- `scripts/lib/outbound-transports.mjs` — for relay POST + Telegram + Feishu/Lark + webhook.
- `scripts/lib/inbound-transports.mjs` — for inbox draining, Telegram parsing, and routing helpers. Feishu/Lark callbacks enter through the relay and then reuse the relay message path.

Implement at minimum:

- A poll loop that drains `pollInboundTransports(...)` when launched by the daemon (`LEGAX_DAEMON_ROUTER=1`), and falls back to direct `/api/messages` polling when the adapter is run standalone.
- A handler for `permission_decision` and `user_input_response` that **does not silently drop orphans**: when the request id has no matching pending entry, log to stderr and send a `status` event back so the phone user knows the request expired.
- Mode handling via `applyControlMessages`, `canAcceptText`, `canAcceptApproval`.
- A graceful shutdown on `SIGINT` / `SIGTERM`.

### 4. Register the contract

Add an entry to `ADAPTERS` in `scripts/lib/adapter-contract.mjs`:

```js
{
  key: "aider",
  name: "aider",
  defaultAgentId: "aider-cli",
  label: "Aider",
  script: "scripts/aider-link.mjs",
  cliBackend: "stream-json",
  mcpEnabled: false,
  autoStart: false
}
```

Run `validateAllAdapters` is automatic at daemon startup; you only need to make sure your fields are well-formed.

### 5. Add a config section

Append a section to `config.example.yaml` and its `zh-CN` pair. Mirror the existing adapter sections — same key style, same comment density. Users copy this template, so make the defaults sensible (don't `enabled: true` something that requires extra installation).

### 6. Add an E2E test

Create `tests/e2e/<name>-link.e2e.mjs`. It should cover at minimum:

- Dry-run / startup health.
- Phone text → CLI stdin forwarding.
- CLI output → relay event forwarding.
- Mode switching from a phone control message.
- Approval round-trip if applicable.

Reuse `tests/e2e/helpers.mjs` for spawn / port allocation / temp config writing.

### 7. Wire the new files into CI

Append:

- `node --check scripts/<name>-link.mjs` to `package.json` `check:node`.
- `tests/e2e/<name>-link.e2e.mjs` to `package.json` `test:e2e`.

CI is explicit, not glob-driven; missing entries here mean the new file is silently excluded from the gate.

### 8. Document and translate

Update:

- `README.md` and `README.zh-CN.md` Layout / Configuration sections (mention the new adapter).
- `docs/ARCHITECTURE.md` and zh-CN — add a Components subsection.
- `docs/EXTENDING.md` and zh-CN if your adapter introduces a new pattern (PTY, stateful streaming, etc.) other contributors should know about.

## Anti-Patterns

- **Don't put the adapter in the daemon process.** The supervisor design assumes adapters are restartable in isolation.
- **Don't write per-adapter state outside `runtime-state.mjs`.** Sibling state files break cross-process coordination on Windows and orphan on crash.
- **Don't bypass the redaction layer.** All outbound text goes through `mcp-server.mjs` redaction unless `allowSensitive: true` is explicitly set per call.
- **Don't simulate UI clicks** to auto-approve a native security prompt. Mirror it through the agent's structured callback or refuse to forward.
- **Don't make `cliBackend` something other than the actual transport** (e.g., labeling stream-json as "app-server" because it sounds nicer). Operators rely on this string to debug.

## Reference

- Contract module: [`scripts/lib/adapter-contract.mjs`](../scripts/lib/adapter-contract.mjs)
- Daemon: [`scripts/legax-daemon.mjs`](../scripts/legax-daemon.mjs)
- Existing adapters: `scripts/codex-app-server-link.mjs`, `scripts/claude-code-link.mjs`, `scripts/gemini-cli-link.mjs`, `scripts/opencode-link.mjs`
- Architecture overview: [`ARCHITECTURE.md`](ARCHITECTURE.md)
