# Configuration Contract

English | [Simplified Chinese](CONFIGURATION.zh-CN.md)

## Agent Summary

This is the owner for config keys, YAML parser limits, config path resolution, example config structure, and compatibility rules for adding fields. Read it before changing `config.example*.yaml`, `scripts/lib/yaml.mjs`, install defaults, or adapter config shape. It does not own runtime behavior beyond config interpretation.

Legax uses one operator-owned YAML config file. The examples are user-facing templates, but this document is the maintainer contract for adding, parsing, and documenting config fields.


Legax uses one operator-owned YAML config file. The examples are user-facing templates, but this document is the maintainer contract for adding, parsing, and documenting config fields.

## Sources

| Runtime | Config path source |
| --- | --- |
| Installed CLI and daemon | `--config`, then `LEGAX_CONFIG`, then the platform default under Legax home. |
| Source checkout scripts | `LEGAX_CONFIG` or the default config path; some developer tools may fall back to `config.example.yaml` for dry-run inspection. |
| Standalone relay | `--config`, then `LEGAX_CONFIG`, then `/etc/legax-relay/config.yaml`. |

Runtime state files are resolved from the active config path. Do not assume the current working directory is the operator's runtime directory.

## YAML Subset

The parser in `scripts/lib/yaml.mjs` is intentionally minimal. Supported shapes are:

- top-level scalars
- indentation-based nested objects used by the example configs
- lists introduced by `- `, including lists of scalars and objects
- per-key scalar lists
- inline comments outside quotes
- booleans, null, numbers, single-quoted strings, double-quoted strings, and unquoted strings

Unsupported YAML features include anchors, tags, multiline scalars, and flow style. New config shapes must fit this subset or first extend the shared parser and the standalone relay copy in lockstep.

## Top-Level Sections

| Section | Owner | Purpose |
| --- | --- | --- |
| `sessionId` | Shared | Default relay session id used by daemon, adapters, MCP, and relay. |
| `displayName` | Daemon/MCP | Human-readable host or agent label. |
| `storagePath` | MCP | Generic MCP state path. |
| `runtimeStatePath` | Daemon/adapters | Local cross-process coordination state path. |
| `relay` | Relay | HTTP listener, public URL, desktop secret, store, audit, and request limits. |
| `mcp` | MCP | Generic capability server identity and enablement. |
| `remote` | Shared | Global remote enablement, default mode, and pause-all switch. |
| `routing` | Daemon/adapters | Default target and broadcast policy. |
| `approvals` | Shared | Phone approval enablement, timeout, and timeout default. |
| `daemon` | Daemon | Supervision, polling, host registration, command queue, project roots, and notification defaults. |
| `security` | MCP | Redaction default and redaction patterns for MCP tool forwarding. |
| `transports` | Relay/adapters/MCP | Outbound and inbound transport definitions. |
| Adapter sections | Daemon/adapters | CLI-specific enablement, command, backend, sessions, approvals, MCP, and notification policy. |

Adapter section names are public config keys. Adding or renaming them requires updating the adapter contract, examples, docs, and tests together.

## Paths

- `config.yaml` contains secrets and must stay local.
- Relative runtime paths such as `storagePath`, `runtimeStatePath`, relay store paths, audit paths, MCP config paths, and adapter cwd-like fields should be resolved with shared path helpers.
- Installed mode must keep package files separate from operator config and runtime state.
- `self-hosted-relay/config.example.yaml` is for standalone relay installs and intentionally contains only relay-side fields.

## Relay Section

| Field | Type | Notes |
| --- | --- | --- |
| `host` | string | Listener host. Insecure development mode must bind to loopback only. |
| `port` | number | Listener port. |
| `publicBaseUrl` | string | Public HTTPS URL for phone-facing flows such as Telegram Mini App project selection. |
| `secret` | string | Desktop-side relay secret. Must match relay transport secrets used by daemon/adapters. |
| `storePath` | string | Path to `legax.relay/1` store. |
| `allowInsecureDev` | boolean | Local-only unauthenticated development mode. Do not use for exposed relays. |
| `maxRequestBodyBytes` | number | Request body cap. Oversized bodies return `413`. |
| `audit.enabled` | boolean | Enables metadata-oriented audit log. |
| `audit.path` | string | Audit JSONL output path. |
| `audit.maxTail` | number | Maximum returned audit tail records. |
| `audit.textPreview` | number | Preview length; default `0` keeps audit metadata-only. Values above `0` are redacted before writing. |

## Transport Entries

Every transport entry has `name`, `type`, `enabled`, and optional `timeoutMs`. Type-specific fields are:

| Type | Required fields | Notes |
| --- | --- | --- |
| `relay` | `baseUrl`, `secret` | Desktop-authenticated relay path. |
| `telegram` | `botToken`, `chatId` when enabled for outbound | With relay enabled, relay owns polling or webhook ingress. |
| `feishu` | `appId`, `appSecret`, `receiveId`, `verificationToken` | `platform: lark` or `apiBaseUrl` selects Lark global. |
| `webhook` | `url` | Outbound by default. Optional `secret` is sent to the receiving service. Relay inbound webhooks require explicit `inboundEnabled: true` and a separate `inboundSecret`. |

Transport-local `notifications` override daemon-wide and adapter-level notification defaults for that transport only.

## Adapter Sections

All adapters should share these field classes where applicable:

| Field class | Examples | Rule |
| --- | --- | --- |
| Identity | `agentId`, `agentLabel` | Stable and user-visible. |
| Enablement | `enabled`, `autoStart`, `mode` | Daemon honors `autoStart`; runtime mode may be changed through control messages. |
| Backend | `cliBackend`, `command`, `args`, `cwd` | Must describe the real CLI protocol. |
| Session model | `useExisting`, `resumeSession`, `sessionListLimit`, `sessionHistoryOnSelectLimit` | Persist selections through runtime state. |
| MCP | `mcpEnabled`, `mcpAutoConfigure`, `mcpRole`, `mcpConfigPath` | MCP is capability setup, not lifecycle. |
| Approval | `approvalTimeoutMs`, adapter-specific decision values | Only claim support when a native callback path exists. |
| Notifications | `notifications.telegram.messageDetail` | Keep high-volume streams behind config gates. |

New adapter fields must be added to:

1. the adapter's config normalization
2. `config.example.yaml`
3. `config.example.zh-CN.yaml`
4. targeted docs
5. relevant E2E coverage

## Compatibility Rules

- JSON config is not supported.
- Do not add environment-variable fallbacks for secrets. Secrets live in gitignored YAML config.
- Do not create multiple spellings for one field.
- Deprecating a field requires a migration note and backward-compatible normalization for at least one release cycle.
- Example defaults should be safe: disabled for optional third-party transports, fail-closed for approvals, and low-noise for chat notifications.
