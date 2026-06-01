# Compatibility Matrix

English | [Simplified Chinese](COMPATIBILITY.zh-CN.md)

This document records what Legax expects from each supported external CLI or platform. It is not a vendor guarantee; it is the maintainer checklist for compatibility-sensitive changes.

## Runtime Baseline

| Component | Required baseline | Notes |
| --- | --- | --- |
| Node.js | 18 or newer | Standard library only; no project `node_modules` is required for runtime scripts. |
| Shell scripts | POSIX shell syntax checked by `bash -n` | Installer and service scripts must stay syntax-checkable. |
| Config | Legax YAML subset | JSON config is intentionally unsupported. |

## Agent CLIs

| Adapter | Backend | Required external capability | Session support | Approval support | Known limits |
| --- | --- | --- | --- | --- | --- |
| Codex CLI | `app-server-ws` | Shared `codex app-server --listen ws://...` JSON-RPC endpoint. | Lists, resumes, and starts threads through app-server APIs. | Supported through JSON-RPC approval callbacks such as `requestApproval`. | Codex desktop embedded stdio app-server is not a shared backend unless Codex exposes a supported listener. |
| Codex Desktop Mirror | `session-jsonl-tail` | Readable Codex desktop session JSONL files. | Observes latest or selected JSONL activity. | Not supported; read-only mirror. | Cannot inject phone text into desktop sessions. |
| Claude Code | `stream-json` | `claude -p` with stream-json input/output. | Existing-session mode uses `--continue` or `--resume <id>` from persisted history. | Supported through Claude permission-prompt MCP. | Foreground TUI may not live-update from a headless resumed turn. |
| Gemini CLI | `stream-json` per headless turn | `gemini --output-format stream-json` and `--prompt`. | Existing-session mode uses `--resume latest` or configured id; list uses `--list-sessions`. | Controlled by Gemini CLI approval mode. | Untrusted directories require `trustWorkspace: true` for daemon/headless use. |
| OpenCode | `server-http` | `opencode serve` HTTP API. | Lists sessions through `GET /session`; sends text through `POST /session/:id/message`. | Native permission callback bridge is not implemented. | Server auth is Basic Auth when `serverPassword` is configured. |

## Remote Surfaces

| Surface | Required capability | Ingress owner | Notes |
| --- | --- | --- | --- |
| Relay browser | HTTP(S), paired device cookie | Relay | Browser never receives the desktop secret. |
| Telegram | Bot API polling or webhook | Relay when relay transport is enabled; direct polling only as no-relay fallback | Telegram callback data must stay compact and target-aware. |
| Feishu/Lark | App bot send APIs and event subscription | Relay | Encrypted callbacks require an upstream decrypting gateway today. |
| Webhook | Operator-owned HTTP endpoint | Outbound by default; inbound only with explicit `inboundEnabled` + `inboundSecret` | Receiver sees the configured event payload. |

## Compatibility Change Rules

- If an external CLI changes protocol shape, update the adapter, focused E2E fixture, real-client notes if applicable, and this matrix.
- Do not claim approval support for an adapter until the CLI exposes a native callback or permission mechanism.
- Any fallback to PTY/TUI control must be documented as high-trust remote terminal control.
- Keep real-client tests opt-in with `LEGAX_REAL_CLIENTS=1`.
- If a documented command line changes, update English and Simplified Chinese docs in the same change.

## Review Checklist

Before merging compatibility-sensitive work:

- Which external version or protocol behavior was exercised?
- Is there a fake fixture test for the behavior?
- Is a real-client smoke test needed or already covered?
- What happens when the external CLI binary is missing?
- What happens when session listing is unsupported or empty?
- Does the fallback preserve the permission boundary?
