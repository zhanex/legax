# State Machines

English | [Simplified Chinese](STATE_MACHINES.zh-CN.md)

## Agent Summary

This is the owner for state transitions: adapter runtime modes, daemon and adapter lifecycle, approvals, leases, handoffs, commands, workflows, and session selection. Read it before changing transition rules or terminal states. It complements storage and endpoint contracts but does not own their field-level schemas.

This document centralizes Legax state transitions that are otherwise spread across architecture, relay store, daemon, and adapter code.

## Adapter Runtime Modes

| Mode | Output forwarding | Phone text | Phone approvals | Exit condition |
| --- | --- | --- | --- | --- |
| `interactive` | Yes | Accepted | Accepted | Control message sets another mode. |
| `approval-only` | Yes | Ignored | Accepted | Control message sets another mode. |
| `monitor` | Yes | Ignored | Ignored | Control message sets another mode. |
| `paused` | Ignored | Ignored | Ignored | Only explicit `/mode <agentId> interactive` or equivalent clears it. |

Selecting an adapter may activate `interactive` only when the adapter is not already `paused`.

## Daemon And Adapter Lifecycle

```mermaid
stateDiagram-v2
  [*] --> configured
  configured --> supervised: enabled and autoStart
  configured --> sleeping: enabled and autoStart false
  sleeping --> launch_requested: remote action targets agent
  launch_requested --> supervised: daemon starts adapter
  supervised --> healthy: process runs past healthy threshold
  supervised --> crashed: process exits unexpectedly
  crashed --> restarting: restart allowed and circuit closed
  restarting --> supervised
  crashed --> stopped: restart disabled or circuit open
  supervised --> stopped: daemon shutdown
```

The daemon owns supervision and on-demand launch. Adapters do not start siblings.

## Approval Lifecycle

```mermaid
stateDiagram-v2
  [*] --> native_request
  native_request --> mirrored: adapter or permission MCP posts remote request
  mirrored --> decided: phone approves or denies in allowed mode
  mirrored --> timed_out: approval timeout expires
  decided --> returned: decision returned through native callback
  timed_out --> returned: configured timeout decision returned
  mirrored --> orphaned: adapter restarted or request no longer pending
  orphaned --> reported: status event tells remote user
  returned --> [*]
  reported --> [*]
```

Approvals are accepted only in `interactive` and `approval-only` modes. Timeout defaults must fail closed unless explicitly configured otherwise.

## User Input Lifecycle

```mermaid
stateDiagram-v2
  [*] --> input_request
  input_request --> mirrored
  mirrored --> answered: remote user replies with request id
  mirrored --> orphaned: pending request disappears
  answered --> returned
  orphaned --> reported
  returned --> [*]
  reported --> [*]
```

Orphan responses are not silent drops; adapters must report status back to the remote surface.

## Portable Lease Lifecycle

```mermaid
stateDiagram-v2
  [*] --> active: claim
  active --> active: renew
  active --> released: release
  active --> expired: expiry observed
  expired --> reclaimed: reclaimExpired claim
  reclaimed --> active: new lease record active
  released --> [*]
```

Lease-protected writes require the current `hostId`, `fencingToken`, and `leaseToken`. Stale writers return `409`.

## Handoff Lifecycle

```mermaid
stateDiagram-v2
  [*] --> requested
  requested --> checkpointed
  checkpointed --> uploaded
  uploaded --> released
  released --> claimed
  claimed --> restored
  restored --> resumed
  requested --> failed
  checkpointed --> failed
  uploaded --> failed
  released --> failed
  claimed --> failed
  restored --> failed
  resumed --> [*]
  failed --> [*]
```

Transitions must occur in order. Retrying the same transition is idempotent; skipping forward is rejected.

## Relay Command Lifecycle

```mermaid
stateDiagram-v2
  [*] --> pending: create
  pending --> running: eligible host claims
  running --> succeeded: result
  running --> failed: result or attempts exhausted
  running --> cancelled: result
  pending --> expired: expiry observed
  running --> pending: claim expires and attempts remain
  succeeded --> [*]
  failed --> [*]
  cancelled --> [*]
  expired --> [*]
```

Result reporting requires the current `claimedBy` and `claimToken`. Replaying the same terminal result is idempotent; stale reports return `409`.

## Workflow Run Lifecycle

```mermaid
stateDiagram-v2
  [*] --> running: create
  running --> waiting: before gate
  waiting --> running: gate approved
  waiting --> failed: gate denied
  running --> running: step succeeds and schedules next steps
  running --> failed: step fails after retry policy
  running --> cancelled: cancel
  running --> succeeded: all terminal steps succeeded
  succeeded --> [*]
  failed --> [*]
  cancelled --> [*]
```

Workflow steps dispatch only known built-in command refs. Mutating steps require an active generation lease.

## Adapter Session Selection

```mermaid
stateDiagram-v2
  [*] --> no_target
  no_target --> agent_selected: choose CLI
  agent_selected --> project_selected: choose project or Chats
  project_selected --> session_selected: choose session
  session_selected --> session_selected: send text or refresh list
  session_selected --> project_selected: choose different project
  project_selected --> agent_selected: choose different CLI
```

Plain text should reach an adapter only after routing resolves a target agent. Session-specific adapters should persist the selected session through runtime state.
