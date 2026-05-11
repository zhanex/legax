# Legax Protocol

English | [Simplified Chinese](LEGAX_PROTOCOL.zh-CN.md)

The Legax protocol is the small event contract used between Legax adapters, the daemon, relay, Telegram, and future third-party integrations. It is intentionally narrower than any single CLI's native protocol.

## Event Envelope

Every cross-adapter event uses version `1` and a stable `kind`:

```json
{
  "v": 1,
  "id": "legax_evt_xxx",
  "kind": "active_context",
  "sessionId": "default",
  "agentId": "codex-cli",
  "agentLabel": "Codex CLI",
  "projectId": "project-id",
  "projectName": "legax",
  "threadId": "thread-id",
  "threadName": "Session name",
  "text": "Human-readable body",
  "metadata": {},
  "createdAt": "2026-05-11T00:00:00.000Z"
}
```

Required fields are `v`, `kind`, and `sessionId`. `agentId` should be present whenever an event belongs to one CLI adapter.

## Standard Kinds

- `active_context`: the currently active CLI/project/session. Telegram can pin this and the web UI can display it above the composer.
- `approval_request`: a native CLI approval request mirrored to remote surfaces.
- `input_request`: a request for missing user input.
- `agent_summary`: completion or progress summary worth notifying.
- `session_list`: a normalized project/chat/session list.
- `attention_item`: a prebuilt actionable item for the remote inbox.

Adapters may still post legacy relay kinds such as `permission_request` while migrating. Relay attention inbox maps those into the standard attention model.

## Pairing Offer

Relay browser pairing returns a protocolized offer:

```json
{
  "type": "legax.pairing.offer",
  "v": 1,
  "relayUrl": "https://relay.example.com",
  "sessionId": "default",
  "pairingId": "pair_xxx",
  "pairingSecret": "123456",
  "daemonPublicKey": "base64url-public-key",
  "nonce": "base64url-nonce",
  "expiresAt": "2026-05-11T00:05:00.000Z",
  "features": ["browser_pairing", "attention_inbox", "relay_messages"]
}
```

The QR code encodes a compact form of the same short-lived offer. The browser generates an ephemeral public key when Web Crypto is available and sends it with `POST /api/pair`. The relay still sets only a paired-device HttpOnly cookie; it never exposes the desktop relay secret to the browser.

Current encryption boundary: pairing now exchanges public-key material and nonce metadata, but normal relay event/message payloads remain relay-terminated JSON. This gives the project a stable protocol surface for the next E2E message-encryption milestone without breaking existing browser and Telegram flows.

## Attention Inbox

`GET /api/attention?sessionId=<id>` returns actionable items derived from relay events:

- `approval`: from `permission_request` or `approval_request`.
- `input`: from `input_request` or `user_input_request`.
- `error`: from `error` or status events with `metadata.severity: "error"`.
- `completion`: from `agent_summary`, completion events, or completed summaries.

`POST /api/attention/ack` accepts `{ "sessionId": "...", "ids": ["..."] }` and hides acknowledged items for the paired browser device.

## Worktree-Lite

`legax worktree` exposes a small, local-only workflow:

- `legax worktree list`
- `legax worktree create --name <name> --base HEAD`
- `legax worktree check --name <name> -- <command> [args...]`
- `legax worktree archive --name <name> --delete-branch`

Managed worktrees live under `data/worktrees/`. Archive refuses to remove worktrees outside that managed directory.
