# Runtime State

[English](RUNTIME_STATE.md) | 简体中文

`data/runtime-state.json` 是 daemon 与 adapter 进程共享的本地协调文件。它不是可迁移任务事实来源；后者归 [Relay Store](RELAY_STORE.zh-CN.md) 中记录的 relay store 所有。

## 归属边界

Runtime state 拥有：

- per-agent message cursor
- 动态 runtime mode
- 已选择的本地 CLI/project/session metadata
- per-transport target selection
- daemon 写入的 per-agent inbox queue
- 按需启动 adapter 的 launch request
- standalone fallback polling 使用的 per-agent transport cursor

Runtime state 不拥有：

- 可迁移 relay session identity
- generation、lease、handoff、fork、workflow、artifact、host 或 command 事实
- relay device trust
- 原生 CLI history record

## 文件形状

根结构如下：

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

`sessionId` key 对应本地协调范围。它不能替代 relay-owned portable session。

## Agent State

每个 `sessions[sessionId].agents[agentId]` 记录可以包含：

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

`selectedThread` 有意只保存摘要。不要在这里持久化完整原生 history 或 message body。

## Transport Selection

`transportSelections` 保存浏览器、Telegram chat、飞书/Lark chat 或 fallback transport 选择的 active target：

```json
{
  "telegram:main": {
    "targetAgentId": "codex-cli",
    "updatedAt": "2026-05-26T00:00:00.000Z"
  }
}
```

路由优先使用显式 message target，然后是 transport selection，最后才是配置默认值。

## Inbox Queue

Daemon 把已路由的入站 message 写入目标 agent inbox：

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

由 daemon 启动的 adapter 只 drain 自己的 inbox，不应直接 poll relay-owned inbound channel。没有 daemon router 时，standalone adapter 可以使用 fallback polling。

## Launch Request

`launchRequests` 让 daemon 在远端动作命中 `autoStart: false` adapter 后启动它：

```json
{
  "opencode": {
    "agentId": "opencode",
    "requestedAt": "2026-05-26T00:00:00.000Z",
    "reason": "remote-message"
  }
}
```

Daemon 消费并清空 launch request。Launch request 只是本地唤醒信号，不是 execution lease。

## Mode

Runtime mode 取值：

- `interactive`
- `approval-only`
- `monitor`
- `paused`

无效 mode 会归一化为 `interactive`。`paused` 是 sticky 的：远端 UI 选择 adapter 不得清除它。

## 并发

所有 read-modify-write 操作必须使用 `scripts/lib/runtime-state.mjs` 中的 `mutateRuntimeState`。该 helper 会：

1. 通过 exclusive create 创建磁盘 lock file
2. 在有界阈值后把 stale lock file 视为可恢复
3. 读取当前 JSON state
4. 应用 mutator
5. 写入临时 JSON 文件
6. 通过短重试 rename 到目标路径，以处理 Windows `EPERM`、`EACCES` 和 `EBUSY`
7. 删除 lock file

不要直接读写 runtime state 文件。

## 兼容性

- 缺失 runtime state 文件时，首次 mutation 创建 `{ "version": 1, "sessions": {} }`。
- Reader 应容忍缺失可选字段。
- 旧 reader 可忽略的新字段可以直接添加。
- 重命名或改变已有字段语义需要兼容计划和 targeted E2E 覆盖。
- Runtime state migration 不得静默丢弃 queue、cursor、mode 或 selected session。

## 审查清单

新增 runtime state 前，先回答：

- 哪个进程写它？
- 哪个进程读它？
- 它能否改从 relay store 推导？
- 它是否包含 secret 或完整 message body？
- 写入后进程崩溃会怎样？
- 字段缺失时旧 adapter 如何表现？
