# Adapter Guide

English | [Simplified Chinese](ADAPTERS.zh-CN.md)

Legax uses one adapter per supported coding-agent runtime. The daemon supervises adapters, routes phone messages through runtime state, and keeps MCP as a capability layer rather than a lifecycle manager.

For the full architecture, see [Architecture](ARCHITECTURE.md). For config keys, start from [`../config.example.yaml`](../config.example.yaml).

## Runtime Modes

| Mode | Output forwarding | Phone text | Phone approvals |
| --- | --- | --- | --- |
| `interactive` | Yes | Accepted | Accepted |
| `approval-only` | Yes | Ignored | Accepted |
| `monitor` | Yes | Ignored | Ignored |
| `paused` | Ignored | Ignored | Ignored |

`paused` is a hard stop. Selecting an adapter from the phone does not clear it; use `/mode <agentId> interactive`.

## Codex

Codex uses the shared app-server websocket backend when `cliBackend: app-server-ws`.

For local visibility, start Codex with:

```bash
codex --remote ws://127.0.0.1:18779
```

The desktop app's embedded stdio app-server is not a shared local backend. Legax should not treat it as a multi-client control socket unless Codex exposes a supported listener.

Codex approval requests are answered through JSON-RPC callbacks such as `requestApproval`. Legax must return the phone decision through that native path rather than simulating UI clicks.

## Codex Desktop Mirror

The optional `codexDesktopMirror` adapter tails Codex desktop session JSONL files and forwards observed activity to the phone. It is read-only by design. It cannot inject phone messages into the desktop session.

Use it when the user primarily wants phone visibility into Codex desktop activity, not remote steering.

## Claude Code

Claude Code runs in print mode with stream-json. Existing-session mode adds `--continue` or `--resume <id>` so remote turns land in persisted Claude Code history.

The daemon can write Claude's permission-prompt MCP config when `mcpAutoConfigure: true`. That MCP server mirrors permission requests to the phone and returns `allow` or `deny` through Claude's permission hook.

## Gemini CLI

Gemini CLI runs one headless turn per phone message with `--prompt`. Existing-session mode uses `--resume latest` or a configured session id. Sessions are listed through `gemini --list-sessions`.

Daemon or headless runs in untrusted directories require:

```yaml
gemini:
  trustWorkspace: true
```

Only enable that for directories you would trust in Gemini CLI itself.

## OpenCode

OpenCode connects to `opencode serve` through `cliBackend: server-http`. With `serverMode: connect-or-start`, Legax can start the HTTP server on demand.

Phone text is sent to `POST /session/:id/message`. OpenCode-native permission callback bridging is not implemented yet.

## On-Demand Launches

Adapters with `autoStart: false` remain visible in phone and Telegram menus. The daemon owns launch requests in runtime state and starts the target adapter when a phone action selects it.

If only a standalone adapter is running without the daemon, it cannot start sibling adapters.

## Permission Boundary

Legax mirrors approval prompts and returns decisions through supported structured callbacks:

- Codex JSON-RPC approval callbacks.
- Claude Code permission-prompt MCP.
- Gemini CLI's own approval mode.

Legax must not auto-approve, bypass, or scrape native approval UI. PTY or TUI backends are fallback-only and should be treated as high-trust remote terminal control.
