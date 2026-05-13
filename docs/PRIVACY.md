# Privacy Notice

English | [Simplified Chinese](PRIVACY.zh-CN.md)

Legax is a self-installed tool. It does not operate any hosted backend run by the project authors. This notice describes what data the software handles, where that data goes, and the choices you have as the operator and as the phone-side user.

## Roles

- **Operator**: the person who installs the desktop daemon and configures transports. The operator chooses where data is sent.
- **Phone user**: the person who receives notifications and submits replies or approvals. Often the operator and the phone user are the same person.
- **Maintainers**: the authors and contributors of this software. Maintainers do not have access to operator data unless the operator explicitly shares it (for example, in a bug report).

## What Data the Software Processes

The software handles the following data on the operator's machine and in transit to the configured transport:

| Data | Source | Where it goes |
| --- | --- | --- |
| Agent stdout/stderr text (assistant messages, tool outputs) | The local CLI agent (Codex / Claude Code / Gemini CLI) | The configured transport(s): self-hosted relay, Telegram Bot API, Feishu/Lark app bot, or webhook URL |
| Approval requests (command, working directory, reason) | Agent-mediated callbacks | Same as above |
| Phone replies (text and approval decisions) | Phone client over relay, Telegram, or Feishu/Lark | Returned to the desktop agent |
| Session metadata (session id, agent id, thread id, mode, cursors) | Local runtime state | Stored under `data/runtime-state.json`; included in transport payloads only as needed for routing |
| Telegram bot token, Feishu/Lark app secret, Feishu/Lark verification token, relay secret, paired browser device cookie | Operator configuration and relay pairing | Third-party app credentials and relay secrets are stored inline in the operator's gitignored YAML config (`config.yaml` or `/etc/legax-relay/config.yaml`); paired browser device hashes are stored in the relay store and transmitted only to your relay as cookies |
| Relay queues and audit metadata | Agent and phone traffic through the self-hosted relay | Stored in `relay.storePath` and, when audit is enabled, appended to `relay.audit.path`; audit records metadata and an optional short text preview, not full message bodies by default |

The software **does not** transmit data to the project maintainers. There is no telemetry, analytics, crash reporter, or update beacon.

## Storage

- Persistent daemon and MCP state is on the operator's local filesystem under `data/` by default (configurable via `runtimeStatePath` and `storagePath`).
- The development relay stores event/message queues in `./data/relay-store.json` by default; the standalone relay stores them in `/var/lib/legax-relay/relay-store.json` by default. Both can be changed with `relay.storePath`.
- Relay audit is append-only when enabled. It writes metadata to `relay.audit.path` and may include a configurable short `textPreview`; set `relay.audit.textPreview: 0` to omit previews.
- Logs are not produced by default beyond what the daemon prints to stderr; if the operator redirects stderr to a file, that file may contain status lines and error stacks (no message bodies by default).

## Third-Party Transports

When the operator enables a transport, message bodies and metadata flow to that third party:

- **Telegram Bot API**: governed by [Telegram's privacy policy](https://telegram.org/privacy). Telegram receives the bot token, chat id, message bodies, and inline-button callbacks.
- **Feishu/Lark**: governed by the relevant Feishu or Lark service terms and privacy policies. Feishu/Lark receives app credentials during token exchange, receive ids, message bodies, and interactive-card callback values.
- **Webhook**: the operator-supplied URL. The receiving service sees the same payloads as the relay would.
- **Self-hosted relay**: data only leaves the operator's infrastructure if the operator exposes the relay externally. The maintainers operate no relay on your behalf.

## Redaction

The MCP server applies regex-based redaction to outbound text by default (`security.redactByDefault: true`). Redaction is a guardrail, not a guarantee — operators should still review messages and avoid pasting secrets into agent prompts. Redaction can be disabled per call (`allowSensitive: true`) when the operator explicitly needs raw content forwarded.

## Operator Choices

- Disable any transport by setting `enabled: false` in `config.yaml`.
- Rotate Telegram bot tokens via [@BotFather](https://t.me/BotFather), rotate Feishu/Lark app secrets and verification tokens in the developer console, rotate the relay secret by editing the YAML config and restarting the relay, and revoke paired browser devices from the relay device list.
- Wipe local state by removing the `data/` directory while the daemon is stopped.
- Self-host the relay to keep data inside your own infrastructure.

## Phone User Choices

- The operator controls which phone, browser, Telegram chat, or Feishu/Lark chat receives notifications. If you receive notifications for a session you did not authorize, contact the operator to revoke the paired browser device, Telegram chat, or Feishu/Lark app configuration.
- Phone replies and approval decisions are stored in the relay queue until bounded retention removes older entries. The desktop tracks cursors so old messages are not replayed after polling. Replies and decisions may also appear in the desktop agent's own session history per that agent's data handling.

## Children's Data

Legax is a developer tool. It is not directed at users under 16, and it does not knowingly process children's data.

## Changes to This Notice

This notice describes the current behavior of the software. When the behavior changes, this file changes in the same commit. There is no separate notification mechanism — track changes through the repository history.

## Contact

For non-sensitive privacy questions, use the repository issue tracker. For security issues, follow [`SECURITY.md`](../.github/SECURITY.md) instead of this notice.
