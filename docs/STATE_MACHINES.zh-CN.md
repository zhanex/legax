# 状态机

[English](STATE_MACHINES.md) | 简体中文

## Agent Summary

本文是状态转换的事实源，包括 adapter runtime mode、daemon 与 adapter lifecycle、approval、lease、handoff、command、workflow 和 session selection。修改 transition rule 或 terminal state 前先读本文。本文补充存储和 endpoint 契约，但不维护字段级 schema。

本文档集中记录 Legax 的状态转换；这些转换原本分散在架构、relay store、daemon 和 adapter 代码中。

## Adapter Runtime Mode

| Mode | 输出转发 | 手机文本 | 手机审批 | 退出条件 |
| --- | --- | --- | --- | --- |
| `interactive` | 是 | 接受 | 接受 | 控制消息设置其它 mode。 |
| `approval-only` | 是 | 忽略 | 接受 | 控制消息设置其它 mode。 |
| `monitor` | 是 | 忽略 | 忽略 | 控制消息设置其它 mode。 |
| `paused` | 忽略 | 忽略 | 忽略 | 只能通过显式 `/mode <agentId> interactive` 或等价动作清除。 |

选择 adapter 只有在 adapter 未处于 `paused` 时才可以激活 `interactive`。

## Daemon 与 Adapter 生命周期

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

Daemon 拥有监督和按需启动。Adapter 不启动兄弟 adapter。

## Approval 生命周期

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

审批只在 `interactive` 和 `approval-only` mode 下接受。除非明确配置，否则超时默认必须 fail closed。

## User Input 生命周期

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

孤儿响应不是静默丢弃；adapter 必须向远端 surface 回报 status。

## Portable Lease 生命周期

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

Lease-protected 写入需要当前 `hostId`、`fencingToken` 和 `leaseToken`。过期写入返回 `409`。

## Handoff 生命周期

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

Transition 必须按顺序发生。重复同一 transition 是幂等的；跳步会被拒绝。

## Relay Command 生命周期

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

Result 上报需要当前 `claimedBy` 和 `claimToken`。重复上报同一 terminal result 是幂等的；过期上报返回 `409`。

## Workflow Run 生命周期

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

Workflow step 只派发已知内置 command ref。会修改工作区的 step 需要 active generation lease。

## Adapter Session 选择

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

普通文本只有在路由解析出 target agent 后才应到达 adapter。需要 session 的 adapter 应通过 runtime state 持久化所选 session。
