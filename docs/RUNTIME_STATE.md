# Runtime State

English | [Simplified Chinese](RUNTIME_STATE.zh-CN.md)

`data/runtime-state.json` is the local coordination file shared by the daemon and adapter processes. It is not portable task truth; that belongs in the relay store documented in [Relay Store](RELAY_STORE.md).

## Ownership Boundary

Runtime state owns:

- per-agent message cursors
- dynamic runtime modes
- selected local CLI/project/session metadata
- per-transport target selection
- per-agent inbox queues written by the daemon
- on-demand adapter launch requests
- per-agent transport cursors for standalone fallback polling

Runtime state must not own:

- portable relay session identity
- generation, lease, handoff, fork, workflow, artifact, host, or command truth
- relay device trust
- native CLI history records

## File Shape

The root shape is:

```json
{
  "version": 1,
  "sessions": {
    "default": {
      "agents": {},
      "transportSelections": {},
      "launchRequests": {}
    }
  }
}
```

`sessionId` keys correspond to local coordination scope. They are not a replacement for relay-owned portable sessions.

## Agent State

Each `sessions[sessionId].agents[agentId]` record may contain:

```json
{
  "mode": "interactive",
  "afterMessageSeq": 42,
  "selectedThreadId": "native-session-id",
  "selectedThread": {
    "id": "native-session-id",
    "name": "Session name",
    "preview": "Last message preview",
    "resumeRef": "native-resume-ref",
    "cwd": "PROJECT_PATH",
    "updatedAt": "2026-05-26T00:00:00.000Z",
    "createdAt": "2026-05-26T00:00:00.000Z",
    "source": "cli"
  },
  "inbox": [],
  "transportCursors": {},
  "updatedAt": "2026-05-26T00:00:00.000Z"
}
```

`selectedThread` is intentionally summarized. Do not persist full native history or message bodies here.

## Transport Selection

`transportSelections` stores the active target chosen by a browser, Telegram chat, Feishu/Lark chat, or fallback transport:

```json
{
  "telegram:main": {
    "targetAgentId": "codex-cli",
    "updatedAt": "2026-05-26T00:00:00.000Z"
  }
}
```

Routing uses explicit message targets first, then transport selection, then configured defaults.

## Inbox Queues

The daemon writes routed inbound messages into the target agent inbox:

```json
{
  "seq": 12,
  "type": "text",
  "text": "Continue the task",
  "targetAgentId": "codex-cli",
  "createdAt": "2026-05-26T00:00:00.000Z",
  "queuedAt": "2026-05-26T00:00:01.000Z"
}
```

Adapters launched by the daemon drain their own inbox and should not poll relay-owned inbound channels directly. Standalone adapters may use fallback polling when the daemon router is not active.

## Launch Requests

`launchRequests` lets the daemon start `autoStart: false` adapters after a remote action targets them:

```json
{
  "opencode": {
    "agentId": "opencode",
    "requestedAt": "2026-05-26T00:00:00.000Z",
    "reason": "remote-message"
  }
}
```

The daemon consumes and clears launch requests. A launch request is a local wake-up signal only; it is not an execution lease.

## Modes

Runtime mode values are:

- `interactive`
- `approval-only`
- `monitor`
- `paused`

Invalid mode values normalize to `interactive`. `paused` is sticky: choosing an adapter from the remote UI must not clear it.

## Concurrency

All read-modify-write operations must use `mutateRuntimeState` in `scripts/lib/runtime-state.mjs`. The helper:

1. creates an on-disk lock file with exclusive create
2. treats stale lock files as recoverable after a bounded threshold
3. loads the current JSON state
4. applies the mutator
5. writes a temporary JSON file
6. renames it into place with short retries for Windows `EPERM`, `EACCES`, and `EBUSY`
7. removes the lock file

Do not edit runtime state by reading and writing the file directly.

## Compatibility

- Missing runtime state file creates `{ "version": 1, "sessions": {} }` on first mutation.
- Readers should tolerate missing optional fields.
- Adding fields is allowed when old readers can ignore them.
- Renaming or changing semantics of an existing field requires a compatibility plan and targeted E2E coverage.
- Runtime state migrations must not silently discard queues, cursors, modes, or selected sessions.

## Review Checklist

Before adding runtime state, answer:

- Which process writes it?
- Which process reads it?
- Could it be derived from relay store instead?
- Does it contain secrets or full message bodies?
- What happens if the process crashes after writing it?
- How does an old adapter behave when the field is missing?
