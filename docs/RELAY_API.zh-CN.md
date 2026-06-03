# Relay API

[English](RELAY_API.md) | 简体中文


## 约定

- 除 HTML 页面外，所有 API 请求和响应体都是 JSON。
- 命令式成功响应包含 `ok: true`。部分读取端点把记录放在 `ok: true` envelope 中返回。
- JSON 失败使用 `{ "ok": false, "error": "message" }`。
- 兼容端点省略 `sessionId` 时使用配置中的默认 session。
- 记录 id 使用保守 safe-id 字符集。无效 id 返回 `400`。
- 会修改共享状态的端点，如果暴露 idempotency key 或 stale-token 检查，应支持安全重试。

## 状态码

| 状态码 | 含义 |
| --- | --- |
| `200` | 请求成功。 |
| `400` | 请求体、id、schema 或状态转换请求无效。 |
| `401` | 缺失或无效 desktop secret、phone cookie、pairing secret 或 launch token。 |
| `403` | 已鉴权调用方没有请求的 command 或 target 资格。 |
| `404` | 请求的 relay 记录不存在。 |
| `409` | 过期状态、重复 id、active lease 冲突、stale token 或非法状态转换。 |
| `413` | 请求体超过 `relay.maxRequestBodyBytes`。 |
| `500` | 未预期 relay 错误。 |

## 鉴权类别

| 类别 | 机制 | 端点 |
| --- | --- | --- |
| Health | 无 | `GET /health`、`GET /healthz` |
| Desktop | `x-legax-secret` header | Daemon、adapter、relay 管理、可迁移 session、artifact、workflow、host、command、audit 和 desktop pairing API。 |
| Browser device | `legax_device` HttpOnly cookie | ??? event?message?attention?host list?agent list ? logout API? |
| Telegram webhook | 配置后使用 `x-telegram-bot-api-secret-token` | `POST /api/telegram/events` |
| Feishu/Lark callback | callback body 中的 `verificationToken` | `POST /api/feishu/events` |
| TWA launch token | desktop-authenticated daemon 流程颁发的短期 token | `/api/twa/*` 项目选择 API |

`relay.allowInsecureDev: true` 仅限 loopback 开发，不能视为生产鉴权模式。

## Desktop API

| 方法和路径 | 目的 | 说明 |
| --- | --- | --- |
| `POST /api/events` | 向 relay session 追加出站 event。 | 也会通过 relay-owned transport fan out。 |
| `GET /api/messages` | ? daemon ? adapter ?????? message? | ?? cursor?agent/task ? `hostId` ????? |
| `POST /api/pairing-codes` | 创建短期浏览器 pairing offer。 | 需要 desktop secret。 |
| `GET /api/devices` | 列出已配对浏览器设备。 | 只返回公开设备 metadata。 |
| `DELETE /api/devices/:id` | 撤销已配对浏览器设备。 | 不会轮换 relay 或第三方凭据。 |
| `GET /api/audit` | 读取 relay audit tail。 | 以 metadata 为主；正文预览可配置。 |

## Browser API

| 方法和路径 | 目的 |
| --- | --- |
| `GET /api/events` | 按 sequence 轮询 session event。 |
| `POST /api/messages` | 提交文本、控制消息、审批或输入响应。 |
| `GET /api/hosts` | ?? daemon host ???????? online/offline ?????????? |
| `GET /api/agents` | 读取 session 已知 agent target。 |
| `GET /api/attention` | 读取派生出的审批、输入、错误和完成事项。 |
| `POST /api/attention/ack` | 为当前已配对设备确认 attention item。 |
| `POST /api/logout` | 清除浏览器设备 cookie。 |

?????? message ???? `targetHostId` ? `targetAgentId`?relay ????????? daemon ??? callback ????????????????????????? desktop relay secret?

浏览器永远不会收到或保存 desktop relay secret。

## Pairing 与 TWA API

| 方法和路径 | 目的 |
| --- | --- |
| `POST /api/pair` | 使用 pairing offer 或手动 code 完成浏览器配对。 |
| `POST /api/twa/launch-tokens` | 颁发短期 Telegram Web App launch token。 |
| `GET /api/twa/bootstrap` | 校验 launch token 并返回 bootstrap data。 |
| `POST /api/twa/project-children` | 排队 daemon-owned 项目目录列表请求。 |
| `POST /api/twa/open-project` | 排队 daemon-owned 项目打开请求。 |
| `GET /api/twa/responses/:requestId` | 轮询 TWA 请求的 daemon 响应。 |

Relay 不直接列本地文件。它把请求排队给符合条件的 daemon，由 daemon 按配置的 project roots 校验路径。

## 可迁移 Session API

| 方法和路径 | 目的 | 状态保护 |
| --- | --- | --- |
| `POST /api/sessions` | 创建或更新可迁移 relay session。 | Desktop auth。 |
| `GET /api/sessions/:id` | 读取 session、current generation 和 active lease。 | Desktop auth。 |
| `POST /api/generations` | 创建 generation 并设为 current。 | 拒绝重复 generation id。 |
| `GET /api/generations/:id` | 读取 generation。 | Desktop auth。 |
| `POST /api/generations/:id/update` | 修改 lease-protected generation 字段。 | 需要当前 host id、fencing token 和 lease token。 |
| `POST /api/generations/:id/fork` | 从父 generation 创建子 generation。 | 需要当前 lease 凭据。 |
| `POST /api/leases/claim` | 认领 active execution ownership。 | 拒绝 active lease 冲突。 |
| `GET /api/leases/:id` | 读取并刷新 lease 状态。 | Desktop auth。 |
| `POST /api/leases/:id/renew` | 延长 active lease 过期时间。 | 需要当前 lease 凭据。 |
| `POST /api/leases/:id/release` | 释放 active lease。 | 需要当前 lease 凭据。 |
| `POST /api/handoffs` | 创建 handoff 记录。 | 检查 generation/session 一致性。 |
| `GET /api/handoffs/:id` | 读取 handoff 记录。 | Desktop auth。 |
| `POST /api/handoffs/:id/transition` | 推进 handoff transition。 | 有序状态机；过期或非法转换返回 `409`。 |

## Artifact API

| 方法和路径 | 目的 |
| --- | --- |
| `POST /api/artifacts` | 保存加密 checkpoint artifact metadata、ciphertext 和 wrapped keys。 |
| `GET /api/artifacts/:id` | 读取加密 artifact 记录。 |

Artifact 上传会拒绝 metadata 中任何类似明文的字段，例如 `plaintext`、`bundle`、`payload`、`files` 或 `content`。

## Workflow API

| 方法和路径 | 目的 |
| --- | --- |
| `GET /api/workflow-actions` | 列出内置 allowlisted action contract。 |
| `POST /api/workflow-definitions` | 校验并注册受限 workflow definition。 |
| `GET /api/workflow-definitions/:id` | 读取 workflow definition。 |
| `POST /api/workflow-runs` | 创建 workflow run 并调度 ready step。 |
| `GET /api/workflow-runs/:id` | 读取 run 并刷新 timeout 状态。 |
| `POST /api/workflow-runs/:id/steps/:stepId/result` | 记录幂等 step result。 |
| `POST /api/workflow-runs/:id/gates/:stepId` | approve 或 deny 等待中的 workflow gate。 |
| `POST /api/workflow-runs/:id/cancel` | 取消非终态 run。 |

Workflow definition 不能包含自由可执行字段。Ready step 变成 relay command 记录；daemon 只执行本地 allowlist 中存在的 command ref。

## Host 与 Command API

| 方法和路径 | 目的 |
| --- | --- |
| `POST /api/hosts` | 注册或刷新 daemon host metadata 和 heartbeat。 |
| `GET /api/hosts` | ?? host???????? online/offline ????????????????????????????????? |
| `POST /api/commands` | 创建 pending relay command。 |
| `GET /api/commands` | 列出某个 host 和 command-ref allowlist 可执行的 command。 |
| `GET /api/commands/:id` | 读取并刷新 command expiry 状态。 |
| `POST /api/commands/:id/claim` | 认领 pending command。 |
| `POST /api/commands/:id/result` | 上报 terminal command result。 |

Command result 上报需要当前 `claimedBy` host 和 `claimToken`。过期上报返回 `409`，且不修改 command。

## Transport Callback API

| 方法和路径 | 目的 |
| --- | --- |
| `POST /api/telegram/events` | 把 Telegram message 和 callback 归一化为 relay message。 |
| `POST /api/feishu/events` | 把飞书/Lark 文本回复和审批卡片动作归一化为 relay message。 |

Relay-owned transport callback 应进入浏览器和 daemon 路由共用的 `/api/messages` 队列。它们不得直接启动 adapter。
