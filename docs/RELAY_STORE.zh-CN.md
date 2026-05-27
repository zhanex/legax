# Relay Store

[English](RELAY_STORE.md) | 简体中文

Relay store 是 `relay.storePath` 指向的 relay 持久化文件。开发模式默认写到 `./data/relay-store.json`；独立部署 relay 默认写到 `/var/lib/legax-relay/relay-store.json`。

`legax.relay/1` 是第一个正式 relay store schema。它不是 V2 格式，因为 Legax 还没有发布稳定 V1。

## 归属边界

- `data/relay-store.json` 是可迁移的 relay 状态。它拥有 relay sessions、generation 元数据、设备、inbox/command/event 元数据、artifacts、workflow definitions/runs。
- `data/runtime-state.json` 是本地 daemon 和 adapter 协同状态。它拥有游标、动态模式、本地已选 sessions、per-agent 队列和启动请求。
- CLI 原生历史仍归 Codex、Claude Code、Gemini CLI 和 OpenCode 拥有。CLI 原生 session id 是 relay generation 内部的实现细节，不是稳定的 relay session id。

## 顶层结构

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

正式必备域：

| 域 | 用途 |
| --- | --- |
| `sessions` | 按 relay `sessionId` 索引的稳定 relay sessions。当前记录仍保留 legacy event/message 队列，同时逐步引入可迁移 generation 模型。 |
| `generations` | relay 拥有的 generation 记录。一个 generation 可以映射到 CLI 原生 session、turn 或 resume 目标，但这些原生 id 不是公开 relay id。 |
| `leases` | 当前执行归属记录，包含 host id、generation id、fencing token、lease token、过期时间、续租、释放和 reclaim 状态。 |
| `handoffs` | 可审计的 handoff 记录，用于通过 checkpoint、upload、release、claim、restore、resume 等状态把执行从一个 host 转移到另一个 host。 |
| `hosts` | daemon host 身份、能力、adapter、命令 allowlist、分组和心跳记录。 |
| `devices` | 按 relay device id 索引的已配对浏览器设备，包含 token 哈希和撤销元数据。 |
| `transports` | relay 可见的 transport 运行时状态，包括 Telegram offset、去重 id 和当前目标选择。 |
| `inbox` | 未来用于 relay 路由和 workflow 编排的标准化入站项。 |
| `commands` | relay 拥有的命令记录，可由手机、Telegram、飞书/Lark、workflow action 或桌面工具创建，只能由符合条件的 daemon host 执行。 |
| `events` | relay metadata event stream，用于记录 append/update 路径。它和 per-session 的 Agent 可见 event 队列分开。 |
| `artifacts` | 未来由 workflow 生成或引用的 artifact 元数据。 |
| `workflowDefinitions` | 未来 relay 侧 workflow 定义。 |
| `workflowRuns` | 未来 relay 侧 workflow run 状态。 |

当前 API 保留的兼容域：

| 域 | 用途 |
| --- | --- |
| `pairingCodes` | 一次性浏览器配对码记录，按 relay secret 哈希后的 code 索引。 |
| `attentionAcks` | 派生 attention inbox item 的按设备确认记录。 |
| `twaLaunchTokens` | Telegram Web App 选择项目流程使用的短期 token。 |

## Session 记录

Session 记录按稳定 relay `sessionId` 索引，并规范化为包含：

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

`events` 和 `messages` 是 `/api/events` 与 `/api/messages` 当前使用的 legacy 队列。它们会继续保留以维持兼容性。新的 workflow 编排应基于正式 relay 域构建，而不是把这些队列当作唯一 session 事实来源。

## Generation 记录

generation 是一个 portable relay session 下的一次执行尝试或分支：

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

CLI 原生 id 只属于 `nativeSession`。它们不是稳定的 relay `sessionId`，也不应作为主要面向用户的身份。

`POST /api/generations` 创建 generation，并把它设为 session 的 `currentGenerationId`。`POST /api/generations/:id/update` 可修改受 lease 保护的字段，例如 `state`、`checkpoint`、`worktree`、`nativeSession`、`result` 和 `error`；调用方必须携带当前 lease holder 的 `hostId`、`fencingToken` 和 `leaseToken`。

## Lease 记录

lease 用于隔离一个 generation 的当前执行归属：

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

lease 状态只能是 `active`、`released`、`expired` 或 `reclaimed`。

- `POST /api/leases/claim` 在 generation 没有 active lease 时创建 active lease。
- 过期 lease 只有在调用方显式传入 `reclaimExpired: true` 时才能被 reclaim；新的 lease 会得到更高的 `fencingToken`。
- `POST /api/leases/:id/renew` 延长过期时间，并要求当前 `hostId`、`fencingToken` 和 `leaseToken`。
- `POST /api/leases/:id/release` 把 active lease 变为 `released`，同样要求当前 `hostId`、`fencingToken` 和 `leaseToken`。
- 过期 host id、过期 fencing token 和过期 lease token 都会返回 `409`，且不会修改 generation。

## Fork 与 Handoff 记录

`POST /api/generations/:id/fork` 创建一个子 generation，其 `baseGenerationId` 指向父 generation。父 generation 不会被修改；审计只追加到 relay metadata event stream。fork 要求当前 lease holder 的 `leaseHostId`、`fencingToken` 和 `leaseToken`。

`POST /api/handoffs` 创建 handoff 记录：

```json
{
  "id": "handoff_abc123",
  "sessionId": "default",
  "generationId": "gen_abc123",
  "fromHostId": "host-a",
  "toHostId": "host-b",
  "state": "requested",
  "transitions": [
    { "state": "requested", "at": "2026-05-26T00:00:00.000Z" }
  ],
  "error": null,
  "createdAt": "2026-05-26T00:00:00.000Z",
  "updatedAt": "2026-05-26T00:00:00.000Z"
}
```

`GET /api/handoffs/:id` 读取当前 handoff 记录。`POST /api/handoffs/:id/transition` 只接受文档化顺序：`requested -> checkpointed -> uploaded -> released -> claimed -> restored -> resumed`。`failed` 是显式 terminal failure 状态。重复提交相同 transition 是幂等的，不会追加重复 event。每次新的 transition 都会追加 `handoff.<state>` metadata event，让 handoff 进度保持可审计。

## Host 记录

daemon host 通过携带桌面端 relay secret 调用 `POST /api/hosts` 注册或刷新自身。relay 会把最新心跳持久化到 `hosts[hostId]`：

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

`GET /api/hosts` 会返回持久化的 host 字段，并附加计算得出的 `status`：`online` 或 `offline`。存活状态由 `expiresAt` 推导，relay 不需要后台 sweeper 才能把 host 标为离线。`commandRefs` 是 daemon 的命令 allowlist，`groups` 允许命令创建方把命令投递给一类 host，而不是必须指定单个 host id。

## Command 记录

relay command 是协调记录。relay 负责保存、claim、过期和结果上报；它本身永远不执行 shell 命令，也不直接执行 adapter 逻辑。

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

命令状态只能是 `pending`、`running`、`succeeded`、`failed`、`cancelled` 或 `expired`。

- `POST /api/commands` 创建 pending 命令。重复的 `idempotencyKey` 会返回已有命令，并带上 `idempotent: true`。
- `GET /api/commands?hostId=...&commandRefs=...` 列出该 host 可执行的 pending 命令。可执行条件包括 host 仍在线、`commandRef` 匹配，并且 `targetHostId` 匹配、`targetGroup` 匹配或命令没有显式目标。
- `POST /api/commands/:id/claim` 将 `pending -> running`，写入 `claimedBy`，递增 `attempts`，生成 `claimToken`，并设置 `claimExpiresAt`。
- `POST /api/commands/:id/result` 只接受当前 `claimedBy` 和 `claimToken`。重复上报同一个 terminal result 是幂等的；过期 host、过期 token 或过期 `leaseToken` 会返回 `409`，且不会修改命令。
- `GET /api/commands/:id` 会刷新过期状态并返回命令。过期的 pending 命令会变成 `expired`；过期的 running claim 会根据 `maxAttempts` 回到 `pending` 等待重试，或变成 `failed`。

## 兼容与失败策略

- 缺失 store 文件：第一次写入时创建 `legax.relay/1` store。
- 没有 `schema` 且 `version: 1` 的 legacy store：添加 `schema: "legax.relay/1"` 和缺失的正式域，同时保留已有 sessions、devices、pairing codes、attention acknowledgements 和 TWA launch tokens。
- 已有 `schema: "legax.relay/1"`：校验必备域，只补齐缺失的可选域。
- 不支持的 schema、不支持的 version、无效 JSON、根节点不是 object、或已有域类型错误：请求失败，并返回包含 store path 的清晰错误。Relay 不会静默重新初始化或覆盖这些文件。
- 写入使用临时文件加原子 rename，并对 Windows 上可能出现的 `EPERM`、`EACCES`、`EBUSY` rename 竞争做短重试。
