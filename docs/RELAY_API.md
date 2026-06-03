# Relay API

English | [Simplified Chinese](RELAY_API.zh-CN.md)

## Agent Summary

This is the owner for Relay HTTP endpoints, auth classes, request and response behavior, status codes, and browser or daemon API compatibility. Read it before changing `scripts/lib/relay-server-core.mjs` routes. It does not own persisted record structure or portable event semantics; use `RELAY_STORE.md` and `LEGAX_PROTOCOL.md` for those.

This document summarizes the HTTP API contract implemented by `scripts/lib/relay-server-core.mjs`. It complements [Legax Protocol](LEGAX_PROTOCOL.md), which describes portable event and workflow concepts, and [Relay Store](RELAY_STORE.md), which describes persisted records.


## Conventions

- All API request and response bodies are JSON unless the endpoint serves HTML.
- JSON success responses include `ok: true` when the endpoint is command-like. Some read endpoints return records directly inside an `ok: true` envelope.
- JSON failures use `{ "ok": false, "error": "message" }`.
- `sessionId` defaults to the configured session when omitted on compatibility endpoints.
- Record ids use a conservative safe-id character set. Invalid ids return `400`.
- Endpoints that mutate shared state should be safe for retries when they expose an idempotency key or stale-token check.

## Status Codes

| Code | Meaning |
| --- | --- |
| `200` | Request succeeded. |
| `400` | Invalid request body, invalid id, invalid schema, or invalid transition request. |
| `401` | Missing or invalid desktop secret, phone cookie, pairing secret, or launch token. |
| `403` | Authenticated caller is not eligible for the requested command or target. |
| `404` | Requested relay record does not exist. |
| `409` | Stale state, duplicate id, active lease conflict, stale token, or invalid state transition. |
| `413` | Request body exceeds `relay.maxRequestBodyBytes`. |
| `500` | Unexpected relay error. |

## Authentication Classes

| Class | Mechanism | Endpoints |
| --- | --- | --- |
| Health | None | `GET /health`, `GET /healthz` |
| Desktop | `x-legax-secret` header | Daemon, adapter, relay administration, portable session, artifact, workflow, host, command, audit, and desktop pairing APIs. |
| Browser device | `legax_device` HttpOnly cookie | Browser event, message, attention, host list, agent list, and logout APIs. |
| Telegram webhook | `x-telegram-bot-api-secret-token` when configured | `POST /api/telegram/events` |
| Feishu/Lark callback | `verificationToken` in the callback body | `POST /api/feishu/events` |
| TWA launch token | Short-lived token issued by desktop-authenticated daemon flow | `/api/twa/*` project picker APIs |

`relay.allowInsecureDev: true` is only for loopback development and must not be treated as a production auth mode.

## Desktop APIs

| Method and path | Purpose | Notes |
| --- | --- | --- |
| `POST /api/events` | Append outbound event to a relay session. | Also fans out through relay-owned transports. |
| `GET /api/messages` | Poll inbound messages for daemon or adapter routing. | Supports cursor, agent/task, and `hostId` target filtering. |
| `POST /api/pairing-codes` | Create a short-lived browser pairing offer. | Desktop secret required. |
| `GET /api/devices` | List paired browser devices. | Returns public device metadata only. |
| `DELETE /api/devices/:id` | Revoke a paired browser device. | Does not rotate relay or third-party credentials. |
| `GET /api/audit` | Read the relay audit tail. | Metadata-oriented; body previews are configurable. |

## Browser APIs

| Method and path | Purpose |
| --- | --- |
| `GET /api/events` | Poll session events after a sequence number. |
| `POST /api/messages` | Submit text, control messages, approvals, or input responses. |
| `GET /api/hosts` | Read daemon host records and computed online/offline state for machine switching. |
| `GET /api/agents` | Read known agent targets for the session. |
| `GET /api/attention` | Read derived approval, input, error, and completion items. |
| `POST /api/attention/ack` | Acknowledge attention items for the current paired device. |
| `POST /api/logout` | Clear the browser device cookie. |

Browser-submitted messages can include `targetHostId` and `targetAgentId`; the relay preserves those fields so the daemon and transport callbacks route actions to the selected machine. The browser never receives or stores the desktop relay secret.

## Pairing And TWA APIs

| Method and path | Purpose |
| --- | --- |
| `POST /api/pair` | Complete browser pairing from a pairing offer or manual code. |
| `POST /api/twa/launch-tokens` | Issue a short-lived Telegram Web App launch token. |
| `GET /api/twa/bootstrap` | Validate launch token and return bootstrap data. |
| `POST /api/twa/project-children` | Queue a daemon-owned project directory listing request. |
| `POST /api/twa/open-project` | Queue a daemon-owned project open request. |
| `GET /api/twa/responses/:requestId` | Poll daemon response for a TWA request. |

The relay does not list local files itself. It queues requests for an eligible daemon, and the daemon validates paths against configured project roots.

## Portable Session APIs

| Method and path | Purpose | State protection |
| --- | --- | --- |
| `POST /api/sessions` | Create or update a portable relay session. | Desktop auth. |
| `GET /api/sessions/:id` | Read a session, current generation, and active lease. | Desktop auth. |
| `POST /api/generations` | Create a generation and make it current. | Rejects duplicate generation ids. |
| `GET /api/generations/:id` | Read a generation. | Desktop auth. |
| `POST /api/generations/:id/update` | Mutate lease-protected generation fields. | Requires current host id, fencing token, and lease token. |
| `POST /api/generations/:id/fork` | Create a child generation from the parent. | Requires current lease credentials. |
| `POST /api/leases/claim` | Claim active execution ownership. | Rejects active lease conflicts. |
| `GET /api/leases/:id` | Read and refresh lease state. | Desktop auth. |
| `POST /api/leases/:id/renew` | Extend active lease expiry. | Requires current lease credentials. |
| `POST /api/leases/:id/release` | Release active lease. | Requires current lease credentials. |
| `POST /api/handoffs` | Create a handoff record. | Generation/session consistency is checked. |
| `GET /api/handoffs/:id` | Read a handoff record. | Desktop auth. |
| `POST /api/handoffs/:id/transition` | Advance a handoff transition. | Ordered state machine; stale or invalid transitions return `409`. |

## Artifact APIs

| Method and path | Purpose |
| --- | --- |
| `POST /api/artifacts` | Store encrypted checkpoint artifact metadata, ciphertext, and wrapped keys. |
| `GET /api/artifacts/:id` | Read encrypted artifact record. |

Artifact upload rejects plaintext-like fields such as `plaintext`, `bundle`, `payload`, `files`, or `content` anywhere in metadata.

## Workflow APIs

| Method and path | Purpose |
| --- | --- |
| `GET /api/workflow-actions` | List built-in allowlisted action contracts. |
| `POST /api/workflow-definitions` | Validate and register a restricted workflow definition. |
| `GET /api/workflow-definitions/:id` | Read a workflow definition. |
| `POST /api/workflow-runs` | Create a workflow run and schedule ready steps. |
| `GET /api/workflow-runs/:id` | Read a run and refresh timeout state. |
| `POST /api/workflow-runs/:id/steps/:stepId/result` | Record an idempotent step result. |
| `POST /api/workflow-runs/:id/gates/:stepId` | Approve or deny a waiting workflow gate. |
| `POST /api/workflow-runs/:id/cancel` | Cancel a non-terminal run. |

Workflow definitions cannot contain executable free-form fields. Ready steps become relay command records; daemons execute only command refs present in their local allowlist.

## Host And Command APIs

| Method and path | Purpose |
| --- | --- |
| `POST /api/hosts` | Register or refresh daemon host metadata and heartbeat. |
| `GET /api/hosts` | List hosts with computed online/offline status. Paired browsers can read this endpoint for machine switching; mutation remains desktop-authenticated. |
| `POST /api/commands` | Create a pending relay command. |
| `GET /api/commands` | List commands eligible for a host and command-ref allowlist. |
| `GET /api/commands/:id` | Read and refresh command expiry state. |
| `POST /api/commands/:id/claim` | Claim a pending command. |
| `POST /api/commands/:id/result` | Report terminal command result. |

Command result reporting requires the current `claimedBy` host and `claimToken`. Stale reports return `409` and do not mutate the command.

## Transport Callback APIs

| Method and path | Purpose |
| --- | --- |
| `POST /api/telegram/events` | Normalize Telegram messages and callbacks into relay messages. |
| `POST /api/feishu/events` | Normalize Feishu/Lark text replies and approval card actions into relay messages. |

Relay-owned transport callbacks should feed the same `/api/messages` queue used by browser and daemon routing. They must not start adapters directly.
