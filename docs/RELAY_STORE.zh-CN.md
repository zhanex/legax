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
| `leases` | 未来用于 workflow 和 host 归属协调的租约。 |
| `hosts` | 未来的 host 身份与能力记录。 |
| `devices` | 按 relay device id 索引的已配对浏览器设备，包含 token 哈希和撤销元数据。 |
| `transports` | relay 可见的 transport 运行时状态，包括 Telegram offset、去重 id 和当前目标选择。 |
| `inbox` | 未来用于 relay 路由和 workflow 编排的标准化入站项。 |
| `commands` | 未来由手机、Telegram、飞书/Lark 或 workflow action 创建的命令记录。 |
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

`events` 和 `messages` 是 `/api/events` 与 `/api/messages` 当前使用的 legacy 队列。它们会继续保留以维持兼容性。新的 workflow 编排应基于正式 relay 域构建，而不是把这些队列当作唯一 session 事实来源。

## 兼容与失败策略

- 缺失 store 文件：第一次写入时创建 `legax.relay/1` store。
- 没有 `schema` 且 `version: 1` 的 legacy store：添加 `schema: "legax.relay/1"` 和缺失的正式域，同时保留已有 sessions、devices、pairing codes、attention acknowledgements 和 TWA launch tokens。
- 已有 `schema: "legax.relay/1"`：校验必备域，只补齐缺失的可选域。
- 不支持的 schema、不支持的 version、无效 JSON、根节点不是 object、或已有域类型错误：请求失败，并返回包含 store path 的清晰错误。Relay 不会静默重新初始化或覆盖这些文件。
- 写入使用临时文件加原子 rename，并对 Windows 上可能出现的 `EPERM`、`EACCES`、`EBUSY` rename 竞争做短重试。
