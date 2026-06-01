# Observability

English | [Simplified Chinese](OBSERVABILITY.zh-CN.md)

Legax observability is intentionally local and low-noise. The project should help operators diagnose routing, pairing, and adapter health without turning logs into a second transcript store.

## Signals

| Signal | Owner | Purpose |
| --- | --- | --- |
| Process stderr | Daemon, adapters, relay | Local status, warnings, startup summaries, and error stacks. |
| Relay `/health` and `/healthz` | Relay | Basic HTTP liveness. |
| Daemon status | `scripts/daemon-control.mjs` and daemon dry-run/status paths | Local runtime, config, and process visibility. |
| Relay host records | Relay store | Multi-host online/offline status from heartbeat expiry. |
| Relay audit JSONL | Relay | Metadata-oriented request/event audit tail. |
| Attention inbox | Relay | Actionable approvals, input requests, errors, and completions. |
| Transport delivery results | Shared outbound transport helpers | Per-transport send success/failure diagnostics. |

## Logging Rules

- Do not log real secrets, bot tokens, relay secrets, paired-device cookies, lease tokens, claim tokens, or plaintext checkpoint content.
- Do not make full prompts, full command output, or full message bodies part of default logs.
- Startup summaries should report presence of secrets, not values.
- Error messages should name the failing component and next actionable context, such as config path, transport name, agent id, or endpoint path.
- Adapter stdout/stderr forwarding must stay configurable and low-noise by default.

## Audit Log

Relay audit is append-only JSONL when `relay.audit.enabled` is true. It records metadata and, only when explicitly configured, a redacted text preview:

- `relay.audit.path` controls the file path.
- `relay.audit.maxTail` controls how many records the API returns.
- `relay.audit.textPreview` controls preview length and defaults to `0`.
- `relay.audit.textPreview: 0` omits body previews; values above `0` are redacted before writing.

Audit is not a compliance archive or a revocation system. It is local relay-host diagnostics.

## Health And Status

- `/health` and `/healthz` should stay cheap, unauthenticated, and side-effect free.
- Host online/offline state is derived from heartbeat `expiresAt`; the relay does not need a background sweeper.
- Daemon status and dry-run output should be redaction-safe.
- Remote UI offline states should point the user to relay URL, pairing, daemon startup, and adapter configuration checks.

## Retention

- Relay session event and message queues are bounded by relay configuration.
- Runtime cursors prevent old phone messages from replaying after restart.
- Audit retention is file-based and operator-managed beyond the `maxTail` read limit.
- Paired-device revocation invalidates browser access but does not rotate relay or third-party transport credentials.

## Metrics Policy

Legax does not ship telemetry to maintainers. If operators add external monitoring around relay or daemon processes, they are responsible for keeping secrets and message bodies out of those systems.

## Review Checklist

For changes that add diagnostics:

- Does the signal help answer a concrete operator question?
- Is it redaction-safe by default?
- Does it avoid storing full transcript content unless the operator explicitly configured that behavior?
- Is the signal available at the component that owns the state?
- Does the documentation explain retention and security tradeoffs?
