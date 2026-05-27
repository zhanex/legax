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
| `leases` | Coordination lease records for future workflow and host ownership expansion. |
| `hosts` | Daemon host identity, capability, adapter, command allowlist, group, and heartbeat records. |
| `devices` | Paired browser devices keyed by relay device id, with token hashes and revocation metadata. |
| `transports` | Relay-visible transport runtime state, including Telegram offset, dedupe ids, and current target selection. |
| `inbox` | Future normalized inbound items for relay routing and workflow orchestration. |
| `commands` | Relay-owned command records created by phone, Telegram, Feishu/Lark, workflow actions, or desktop tools and executed only by eligible daemon hosts. |
| `events` | Relay metadata event stream for append/update paths. This is separate from per-session agent-visible event queues. |
| `artifacts` | Future artifact metadata generated or referenced by workflows. |
| `workflowDefinitions` | Future relay-side workflow definitions. |
| `workflowRuns` | Future relay-side workflow run state. |

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
  "createdAt": "2026-05-26T00:00:00.000Z",
  "updatedAt": "2026-05-26T00:00:00.000Z",
  "currentGenerationId": "",
  "nativeSessions": {},
  "events": [],
  "messages": [],
  "nextEventSeq": 1,
  "nextMessageSeq": 1
}
```

`events` and `messages` are the legacy queues used by `/api/events` and `/api/messages`. They remain in place for compatibility. New workflow orchestration should build on formal relay domains instead of treating those queues as the only source of session truth.

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
