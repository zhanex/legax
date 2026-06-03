# Legax Protocol

English | [Simplified Chinese](LEGAX_PROTOCOL.zh-CN.md)

## Agent Summary

This is the owner for portable cross-adapter protocol shapes: event envelopes, pairing offers, portable sessions, checkpoint artifacts, workflow action contracts, and shared semantic fields. Read it before changing event kinds or fields shared across adapters, daemon, relay, and transports. Endpoint mechanics belong in `RELAY_API.md`; persisted storage belongs in `RELAY_STORE.md`.

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

## Portable Sessions And Leases

Relay-owned portable sessions use these desktop-authenticated endpoints:

- `POST /api/sessions`: create or update a stable relay session.
- `GET /api/sessions/:id`: read the session plus current generation and active lease, if present.
- `POST /api/generations`: create a generation and make it current for its session.
- `GET /api/generations/:id`: read a generation.
- `POST /api/generations/:id/update`: mutate lease-protected generation fields. Requires current `hostId`, `fencingToken`, and `leaseToken`.
- `POST /api/generations/:id/fork`: create a child generation from the parent checkpoint without mutating the parent. Requires current lease credentials.
- `POST /api/leases/claim`: claim active execution ownership for a generation.
- `GET /api/leases/:id`: read a lease and refresh expiry.
- `POST /api/leases/:id/renew`: extend an active lease. Requires current lease credentials.
- `POST /api/leases/:id/release`: release an active lease. Requires current lease credentials.
- `POST /api/handoffs`: create a handoff record.
- `GET /api/handoffs/:id`: read a handoff record.
- `POST /api/handoffs/:id/transition`: move a handoff through its documented state sequence.

Lease-protected writes use two fences. `fencingToken` is monotonically increasing per generation and rejects stale owners after reclaim. `leaseToken` is the opaque secret returned to the active holder. A stale host, stale fencing token, or stale lease token returns `409` and does not mutate the generation.

Handoff transitions are ordered: `requested -> checkpointed -> uploaded -> released -> claimed -> restored -> resumed`. `failed` is an explicit terminal failure state. The `checkpointed` transition can include `artifactId`, which tells the receiving host which encrypted checkpoint to fetch. Forks preserve parent generation immutability and link the child with `baseGenerationId`; fork creation can also carry `artifactId` through the child generation's `checkpoint.artifactId`.

## Checkpoint Artifacts

Checkpoint bundles use schema `legax.checkpoint/1`. A daemon creates the bundle locally, filters unsafe files, encrypts the JSON payload with AES-256-GCM, and wraps a per-artifact data key for authorized daemon devices with X25519, HKDF-SHA256, and AES-256-GCM. The relay never receives plaintext file content.

Desktop-authenticated artifact APIs:

- `POST /api/artifacts`: store an encrypted checkpoint artifact record. Requests containing plaintext fields such as `plaintext`, `bundle`, `payload`, `files`, or `content` are rejected.
- `GET /api/artifacts/:id`: read encrypted artifact metadata, ciphertext, and wrapped keys.

Default local bundle creation excludes credential files, private keys, database files, symlinks, binary files, oversized files, absolute paths, and path traversal. Restore validates every path before writing, rejects symlink escapes, verifies content hashes, and refuses to overwrite conflicting local files unless the caller explicitly opts into overwrite behavior. Device revocation prevents future key wrapping for that device; historical artifacts already wrapped for that key remain readable by holders of the matching private key.

## Restricted Workflows

Workflow definitions use schema `legax.workflow/1`. The relay validates definitions before storing them: step ids must be unique, `needs` must form a DAG, `uses` must reference a known built-in action, and forbidden fields such as `shell`, `script`, `eval`, `prompt`, `command`, and free-form args are rejected. Definitions describe metadata, typed inputs and defaults, steps, gate policy, retry/timeout policy, artifact references, and required evidence.

Desktop-authenticated workflow APIs:

- `POST /api/workflow-definitions`: validate and register a restricted workflow definition.
- `GET /api/workflow-definitions/:id`: read a definition.
- `POST /api/workflow-runs`: create a run from a registered definition and schedule ready steps.
- `GET /api/workflow-runs/:id`: read a run and refresh timeouts.
- `POST /api/workflow-runs/:id/steps/:stepId/result`: record an idempotent step result, retry when policy allows, and schedule dependent steps.
- `POST /api/workflow-runs/:id/gates/:stepId`: approve or deny a waiting gate.
- `POST /api/workflow-runs/:id/cancel`: cancel a non-terminal run.

The relay never executes workflow actions directly. A ready step creates a relay command with the step's `uses` value as `commandRef`; daemon hosts can claim it only if the command ref is present in their local allowlist. Gate waits are stored as transport-neutral `workflow_gate` inbox items and can be resumed through the gate endpoint.

Built-in LPS TDD action contracts are available through `GET /api/workflow-actions`. Each contract declares required inputs, required outputs, required evidence, whether the action may mutate the workspace, and any policy gates. The initial action set is:

- `requirements.capture`
- `design.basic`
- `design.detail`
- `test.spec`
- `tdd.red`
- `tdd.review_red`
- `tdd.green`
- `tdd.review_green`
- `tdd.refactor`
- `workflow.run_check`
- `review.self`
- `pr.prepare`
- `pr.create`

The built-in workflow definition `lps-tdd` runs from requirements capture through `pr.prepare`. It intentionally excludes `pr.create`; PR creation is disabled by default, must be behind a before-gate when used, and is draft-first even when enabled. Workspace-mutating actions (`tdd.red`, `tdd.green`, and `tdd.refactor`) require a valid generation lease. `workflow.run_check` accepts an approved `checkRef` and never accepts a free-form command string from the workflow definition.

## Worktree-Lite

`legax worktree` exposes a small, local-only workflow:

- `legax worktree list`
- `legax worktree create --name <name> --base HEAD`
- `legax worktree check --name <name> -- <command> [args...]`
- `legax worktree archive --name <name> --delete-branch`

Managed worktrees live under `data/worktrees/`. Archive refuses to remove worktrees outside that managed directory.
