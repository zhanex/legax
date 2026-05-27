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
| `leases` | Future coordination leases for workflow and host ownership. |
| `hosts` | Future host identity and capability records. |
| `devices` | Paired browser devices keyed by relay device id, with token hashes and revocation metadata. |
| `transports` | Future relay-visible transport identity and routing metadata. |
| `inbox` | Future normalized inbound items for relay routing and workflow orchestration. |
| `commands` | Future command records created by phone, Telegram, Feishu/Lark, or workflow actions. |
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

## Compatibility And Failure Policy

- Missing store file: create a `legax.relay/1` store on the first write.
- Legacy store without `schema` and with `version: 1`: add `schema: "legax.relay/1"` and any missing formal domains while preserving existing sessions, devices, pairing codes, attention acknowledgements, and TWA launch tokens.
- Existing `schema: "legax.relay/1"`: validate required domains and fill only missing optional domains.
- Unsupported schema, unsupported version, invalid JSON, non-object root, or wrong existing domain type: fail the request with a clear error containing the store path. The relay does not silently reinitialize or overwrite these files.
- Writes use a temporary file plus atomic rename, with short retries for Windows `EPERM`, `EACCES`, and `EBUSY` rename races.
