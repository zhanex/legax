# Relay Store

English | [Simplified Chinese](RELAY_STORE.zh-CN.md)

The relay store is the relay-owned persistence file behind `relay.storePath`. Development mode defaults to `./data/relay-store.json`; the standalone relay defaults to `/var/lib/legax-relay/relay-store.json`.

`legax.relay/1` is the first formal relay store schema. It is not a V2 format because Legax has not shipped a stable V1 release.

## Ownership Boundary

- `data/relay-store.json` is portable relay state. It owns relay sessions, generation metadata, devices, inbox/command/event metadata, artifacts, and workflow definitions/runs.
- `data/runtime-state.json` is local daemon and adapter coordination state. It owns cursors, dynamic modes, selected local sessions, per-agent queues, and launch requests.
- CLI-native history remains owned by Codex, Claude Code, Gemini CLI, and OpenCode. Native CLI session ids are implementation details inside relay generations, not stable relay session ids.

## Top-Level Shape

```json
{
  "schema": "legax.relay/1",
  "version": 1,
  "sessions": {},
  "generations": {},
  "leases": {},
  "handoffs": {},
  "hosts": {},
  "devices": {},
  "transports": {},
  "inbox": {},
  "commands": {},
  "events": [],
  "artifacts": {},
  "workflowDefinitions": {},
  "workflowRuns": {},
  "pairingCodes": {},
  "attentionAcks": {},
  "twaLaunchTokens": {}
}
```

Required formal domains:

| Domain | Purpose |
| --- | --- |
| `sessions` | Stable relay sessions keyed by relay `sessionId`. Current records keep legacy event/message queues while the portable generation model is introduced. |
| `generations` | Relay-owned generation records. A generation may map to CLI-native sessions, turns, or resumes, but those native ids are not the public relay id. |
| `leases` | Active execution ownership records with host id, generation id, fencing token, lease token, expiry, renewal, release, and reclaim state. |
| `handoffs` | Auditable handoff records for moving execution from one host to another through checkpoint, upload, release, claim, restore, and resume transitions. |
| `hosts` | Daemon host identity, capability, adapter, command allowlist, group, and heartbeat records. |
| `devices` | Paired browser devices keyed by relay device id, with token hashes and revocation metadata. |
| `transports` | Relay-visible transport runtime state, including Telegram offset, dedupe ids, and current target selection. |
| `inbox` | Future normalized inbound items for relay routing and workflow orchestration. |
| `commands` | Relay-owned command records created by phone, Telegram, Feishu/Lark, workflow actions, or desktop tools and executed only by eligible daemon hosts. |
| `events` | Relay metadata event stream for append/update paths. This is separate from per-session agent-visible event queues. |
| `artifacts` | Encrypted checkpoint artifact records generated or referenced by handoffs, forks, and workflows. |
| `workflowDefinitions` | Restricted `legax.workflow/1` workflow definitions validated by the relay. |
| `workflowRuns` | Relay-owned workflow run, step, retry, timeout, and gate state. |

Compatibility domains retained by current APIs:

| Domain | Purpose |
| --- | --- |
| `pairingCodes` | One-time browser pairing code records, keyed by relay-secret hash. |
| `attentionAcks` | Per-device acknowledgements for derived attention inbox items. |
| `twaLaunchTokens` | Short-lived tokens used by Telegram Web App project selection flows. |

## Session Records

A session record is keyed by a stable relay `sessionId` and normalized to include:

```json
{
  "id": "default",
  "status": "active",
  "title": "",
  "selectedAgentId": "",
  "createdAt": "2026-05-26T00:00:00.000Z",
  "updatedAt": "2026-05-26T00:00:00.000Z",
  "currentGenerationId": "",
  "generationIds": [],
  "handoffFromGenerationId": "",
  "forkedFromGenerationId": "",
  "transportBindings": {},
  "metadata": {},
  "nativeSessions": {},
  "events": [],
  "messages": [],
  "nextEventSeq": 1,
  "nextMessageSeq": 1
}
```

`events` and `messages` are the legacy queues used by `/api/events` and `/api/messages`. They remain in place for compatibility. New workflow orchestration should build on formal relay domains instead of treating those queues as the only source of session truth.

## Generation Records

A generation is one execution attempt or branch under a portable relay session:

```json
{
  "id": "gen_abc123",
  "sessionId": "default",
  "baseGenerationId": "",
  "hostId": "host-desktop-1",
  "adapterId": "gemini-cli",
  "agentId": "gemini-cli",
  "nativeSession": {
    "provider": "gemini",
    "id": "native-cli-session"
  },
  "worktree": {
    "path": "F:/workspace/project"
  },
  "checkpoint": {
    "artifactId": "checkpoint-1"
  },
  "state": "created",
  "result": null,
  "error": null,
  "leaseId": "",
  "leaseIds": [],
  "createdAt": "2026-05-26T00:00:00.000Z",
  "updatedAt": "2026-05-26T00:00:00.000Z"
}
```

Native CLI ids belong in `nativeSession` only. They are not stable relay `sessionId` values and should not be exposed as the primary user-facing identity.

`POST /api/generations` creates a generation and makes it the session's `currentGenerationId`. `POST /api/generations/:id/update` mutates lease-protected fields such as `state`, `checkpoint`, `worktree`, `nativeSession`, `result`, and `error`; it requires the active lease holder's `hostId`, `fencingToken`, and `leaseToken`.

## Lease Records

A lease fences active execution ownership for one generation:

```json
{
  "id": "lease_abc123",
  "sessionId": "default",
  "generationId": "gen_abc123",
  "hostId": "host-desktop-1",
  "adapterId": "gemini-cli",
  "state": "active",
  "fencingToken": 1,
  "token": "lease_secret_token",
  "createdAt": "2026-05-26T00:00:00.000Z",
  "updatedAt": "2026-05-26T00:00:00.000Z",
  "renewedAt": "2026-05-26T00:00:00.000Z",
  "expiresAt": "2026-05-26T00:00:30.000Z",
  "releasedAt": "",
  "expiredAt": "",
  "reclaimedAt": ""
}
```

Lease state is one of `active`, `released`, `expired`, or `reclaimed`.

- `POST /api/leases/claim` creates an active lease when the generation has no active lease.
- An expired lease can be reclaimed only when the caller passes `reclaimExpired: true`; the new lease gets a higher `fencingToken`.
- `POST /api/leases/:id/renew` extends expiry and requires the current `hostId`, `fencingToken`, and `leaseToken`.
- `POST /api/leases/:id/release` moves the active lease to `released` and also requires the current `hostId`, `fencingToken`, and `leaseToken`.
- Stale host ids, stale fencing tokens, and stale lease tokens fail with `409` and do not mutate the generation.

## Fork And Handoff Records

`POST /api/generations/:id/fork` creates a child generation whose `baseGenerationId` points at the parent. The parent generation is not mutated; audit is appended only to the relay metadata event stream. Fork requires the current lease holder's `leaseHostId`, `fencingToken`, and `leaseToken`.

`POST /api/handoffs` creates a handoff record:

```json
{
  "id": "handoff_abc123",
  "sessionId": "default",
  "generationId": "gen_abc123",
  "fromHostId": "host-a",
  "toHostId": "host-b",
  "checkpointArtifactId": "artifact_abc123",
  "artifactIds": ["artifact_abc123"],
  "state": "requested",
  "transitions": [
    { "state": "requested", "at": "2026-05-26T00:00:00.000Z" }
  ],
  "error": null,
  "createdAt": "2026-05-26T00:00:00.000Z",
  "updatedAt": "2026-05-26T00:00:00.000Z"
}
```

`GET /api/handoffs/:id` reads the current handoff record. `POST /api/handoffs/:id/transition` accepts only the documented sequence: `requested -> checkpointed -> uploaded -> released -> claimed -> restored -> resumed`. `failed` is an explicit terminal failure state. The `checkpointed` transition may carry an `artifactId`, which is stored as `checkpointArtifactId` and appended to `artifactIds` so the target host knows which encrypted checkpoint to fetch. Retrying the same transition is idempotent and does not append a duplicate event. Each new transition appends a `handoff.<state>` metadata event so handoff progress remains auditable.

## Artifact Records

Checkpoint artifacts are encrypted before upload. The relay stores ciphertext and metadata only:

```json
{
  "id": "artifact_abc123",
  "sessionId": "default",
  "generationId": "gen_abc123",
  "type": "checkpoint.bundle",
  "state": "available",
  "metadata": {
    "schema": "legax.checkpoint/1",
    "sessionId": "default",
    "generationId": "gen_abc123",
    "fileCount": 2
  },
  "encryption": {
    "algorithm": "AES-256-GCM",
    "keyWrap": "X25519-HKDF-SHA256+A256GCM"
  },
  "ciphertext": {
    "algorithm": "AES-256-GCM",
    "iv": "base64url",
    "tag": "base64url",
    "ciphertext": "base64url"
  },
  "wrappedKeys": [
    {
      "recipientKid": "host-key-1",
      "algorithm": "X25519-HKDF-SHA256+A256GCM",
      "ephemeralPublicKey": { "kty": "OKP", "crv": "X25519", "x": "base64url" },
      "iv": "base64url",
      "tag": "base64url",
      "ciphertext": "base64url"
    }
  ],
  "createdAt": "2026-05-26T00:00:00.000Z",
  "updatedAt": "2026-05-26T00:00:00.000Z"
}
```

`POST /api/artifacts` rejects plaintext fields such as `plaintext`, `bundle`, `payload`, `files`, or `content`. `GET /api/artifacts/:id` returns the encrypted record so an authorized daemon can unwrap the data key locally and restore the checkpoint after validating paths and hashes.

## Workflow Definition And Run Records

Workflow definitions are stored only after schema validation:

```json
{
  "id": "lps-tdd",
  "schema": "legax.workflow/1",
  "version": "1.0.0",
  "metadata": { "title": "Documented TDD" },
  "inputs": { "issue": { "type": "number", "default": 0 } },
  "steps": [
    {
      "id": "requirements",
      "uses": "requirements.capture",
      "needs": [],
      "gate": null,
      "retry": { "maxAttempts": 1 },
      "timeoutMs": 30000,
      "artifacts": {},
      "evidence": {}
    }
  ],
  "createdAt": "2026-05-26T00:00:00.000Z",
  "updatedAt": "2026-05-26T00:00:00.000Z"
}
```

Definitions reject forbidden executable fields, duplicate step ids, unknown built-in actions, missing dependencies, and cycles. A run expands a definition into step state:

```json
{
  "id": "wfrun_abc123",
  "definitionId": "lps-tdd",
  "schema": "legax.workflow/1",
  "sessionId": "default",
  "state": "running",
  "inputs": { "issue": 27 },
  "steps": {
    "requirements": {
      "id": "requirements",
      "commandRef": "requirements.capture",
      "state": "running",
      "attempts": 1,
      "maxAttempts": 1,
      "commandId": "cmd_abc123",
      "timeoutAt": "2026-05-26T00:00:30.000Z"
    }
  },
  "gates": {}
}
```

Ready steps create relay command records whose `commandRef` is copied from `uses`; daemons still need a matching local command allowlist before they can claim the command. Gate waits are recorded in `gates` and also as `workflow_gate` records under `inbox` so transports can surface a neutral approval item.

## Host Records

Daemon hosts register or refresh themselves through `POST /api/hosts` with the desktop relay secret. Relay persists the latest heartbeat under `hosts[hostId]`:

```json
{
  "id": "host-desktop-1",
  "displayName": "Desktop Agent",
  "version": "PACKAGE_VERSION",
  "capabilities": {
    "platform": "win32",
    "arch": "x64",
    "commandQueue": true
  },
  "adapters": [
    {
      "agentId": "gemini-cli",
      "agentLabel": "Gemini CLI",
      "key": "gemini",
      "cliBackend": "stream-json",
      "autoStart": false
    }
  ],
  "commandRefs": ["legax.ping", "agent.list", "legax.daemon.status"],
  "groups": ["default"],
  "publicKey": null,
  "createdAt": "2026-05-26T00:00:00.000Z",
  "updatedAt": "2026-05-26T00:00:00.000Z",
  "lastSeenAt": "2026-05-26T00:00:00.000Z",
  "ttlMs": 30000,
  "expiresAt": "2026-05-26T00:00:30.000Z"
}
```

`GET /api/hosts` returns the persisted host fields plus a computed `status` of `online` or `offline`. Liveness is derived from `expiresAt`; the relay does not need a background sweeper to mark hosts offline. `commandRefs` is the daemon's allowlist, and `groups` lets command creators target a class of eligible hosts without naming one host id.

## Command Records

Relay commands are coordination records. The relay stores, claims, expires, and reports them; it never executes shell commands or adapter logic directly.

```json
{
  "id": "cmd_abc123",
  "sessionId": "default",
  "commandRef": "legax.ping",
  "state": "pending",
  "targetHostId": "",
  "targetGroup": "default",
  "target": {},
  "generationId": "",
  "leaseToken": "",
  "payload": {},
  "idempotencyKey": "client-command-1",
  "createdAt": "2026-05-26T00:00:00.000Z",
  "updatedAt": "2026-05-26T00:00:00.000Z",
  "expiresAt": "2026-05-26T00:05:00.000Z",
  "maxAttempts": 1,
  "attempts": 0,
  "claimedBy": "",
  "claimToken": "",
  "claimExpiresAt": "",
  "startedAt": "",
  "completedAt": "",
  "result": null,
  "error": null
}
```

Command state is one of `pending`, `running`, `succeeded`, `failed`, `cancelled`, or `expired`.

- `POST /api/commands` creates a pending command. A repeated `idempotencyKey` returns the existing command with `idempotent: true`.
- `GET /api/commands?hostId=...&commandRefs=...` lists pending commands that the host may run. Eligibility requires a live host, a matching `commandRef`, and either a matching `targetHostId`, a matching `targetGroup`, or no explicit target.
- `POST /api/commands/:id/claim` moves `pending -> running`, assigns `claimedBy`, increments `attempts`, creates a `claimToken`, and sets `claimExpiresAt`.
- `POST /api/commands/:id/result` accepts only the current `claimedBy` and `claimToken`. Replaying the same terminal result is idempotent; stale host, stale token, or stale `leaseToken` reports fail with `409` and do not mutate the command.
- `GET /api/commands/:id` refreshes expiry and returns the command. Expired pending commands become `expired`; expired running claims either return to `pending` for another attempt or become `failed` after `maxAttempts`.

## Compatibility And Failure Policy

- Missing store file: create a `legax.relay/1` store on the first write.
- Legacy store without `schema` and with `version: 1`: add `schema: "legax.relay/1"` and any missing formal domains while preserving existing sessions, devices, pairing codes, attention acknowledgements, and TWA launch tokens.
- Existing `schema: "legax.relay/1"`: validate required domains and fill only missing optional domains.
- Unsupported schema, unsupported version, invalid JSON, non-object root, or wrong existing domain type: fail the request with a clear error containing the store path. The relay does not silently reinitialize or overwrite these files.
- Writes use a temporary file plus atomic rename, with short retries for Windows `EPERM`, `EACCES`, and `EBUSY` rename races.
