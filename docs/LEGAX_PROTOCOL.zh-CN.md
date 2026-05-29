# Legax 协议

[English](LEGAX_PROTOCOL.md) | 简体中文

Legax 协议是适配器、daemon、relay、Telegram 以及后续第三方集成之间使用的轻量事件契约。它刻意比任何单个 CLI 的原生协议更窄，只保留跨工具需要共享的语义。

## 事件信封

跨适配器事件使用版本 `1` 和稳定的 `kind`：

```json
{
  "v": 1,
  "id": "legax_evt_xxx",
  "kind": "active_context",
  "sessionId": "default",
  "agentId": "codex-cli",
  "agentLabel": "Codex CLI",
  "projectId": "project-id",
  "projectName": "legax",
  "threadId": "thread-id",
  "threadName": "Session name",
  "text": "Human-readable body",
  "metadata": {},
  "createdAt": "2026-05-11T00:00:00.000Z"
}
```

必填字段是 `v`、`kind` 和 `sessionId`。事件属于某个 CLI 适配器时，应带上 `agentId`。

## 标准类型

- `active_context`：当前激活的 CLI、项目与 session。Telegram 可以置顶，Web UI 可以显示在输入框上方。
- `approval_request`：镜像到远端界面的 CLI 原生审批请求。
- `input_request`：需要用户补充信息的请求。
- `agent_summary`：值得通知的完成或进度摘要。
- `session_list`：标准化的项目、聊天与 session 列表。
- `attention_item`：已经整理好的远端待处理事项。

迁移期间，适配器仍可以发送 `permission_request` 等旧 relay 事件。relay 的待办收件箱会把它们映射到标准待处理模型。

## 配对 Offer

relay 浏览器配对返回协议化 offer：

```json
{
  "type": "legax.pairing.offer",
  "v": 1,
  "relayUrl": "https://relay.example.com",
  "sessionId": "default",
  "pairingId": "pair_xxx",
  "pairingSecret": "123456",
  "daemonPublicKey": "base64url-public-key",
  "nonce": "base64url-nonce",
  "expiresAt": "2026-05-11T00:05:00.000Z",
  "features": ["browser_pairing", "attention_inbox", "relay_messages"]
}
```

二维码编码的是同一个短期 offer 的紧凑形式。浏览器在 Web Crypto 可用时生成临时公钥，并随 `POST /api/pair` 一起发送。relay 最终只设置配对设备的 HttpOnly cookie，不会把桌面端 relay secret 暴露给浏览器。

当前加密边界：配对阶段已经交换公钥材料和 nonce 元数据，但普通 relay event/message payload 仍是 relay 终止的 JSON。这为下一阶段端到端消息加密提供稳定协议面，同时不破坏现有浏览器和 Telegram 流程。

## Attention Inbox

`GET /api/attention?sessionId=<id>` 返回从 relay 事件推导出的待处理事项：

- `approval`：来自 `permission_request` 或 `approval_request`。
- `input`：来自 `input_request` 或 `user_input_request`。
- `error`：来自 `error`，或 `metadata.severity: "error"` 的 status 事件。
- `completion`：来自 `agent_summary`、完成事件或完成摘要。

`POST /api/attention/ack` 接收 `{ "sessionId": "...", "ids": ["..."] }`，并仅为当前已配对浏览器设备隐藏这些事项。

## 可迁移会话与 Lease

由 relay 维护的可迁移会话使用以下桌面鉴权接口：

- `POST /api/sessions`：创建或更新稳定的 relay 会话。
- `GET /api/sessions/:id`：读取会话，并在存在时返回当前 generation 和有效 lease。
- `POST /api/generations`：创建 generation，并把它设为会话的当前 generation。
- `GET /api/generations/:id`：读取 generation。
- `POST /api/generations/:id/update`：修改受 lease 保护的 generation 字段。必须携带当前 `hostId`、`fencingToken` 和 `leaseToken`。
- `POST /api/generations/:id/fork`：从父 generation checkpoint 创建子 generation，且不修改父 generation。必须携带当前 lease 凭据。
- `POST /api/leases/claim`：认领某个 generation 的执行权。
- `GET /api/leases/:id`：读取 lease，并刷新过期状态。
- `POST /api/leases/:id/renew`：延长有效 lease。必须携带当前 lease 凭据。
- `POST /api/leases/:id/release`：释放有效 lease。必须携带当前 lease 凭据。
- `POST /api/handoffs`：创建 handoff 记录。
- `GET /api/handoffs/:id`：读取 handoff 记录。
- `POST /api/handoffs/:id/transition`：按文档化状态序列推进 handoff。

受 lease 保护的写入使用两层防护。`fencingToken` 在每个 generation 内单调递增，用来在重新认领后拒绝旧持有者。`leaseToken` 是返回给当前持有者的不透明密钥。过期 host、过期 fencing token 或过期 lease token 都会返回 `409`，且不会修改 generation。

handoff 的状态顺序为：`requested -> checkpointed -> uploaded -> released -> claimed -> restored -> resumed`。`failed` 表示明确失败并结束。`checkpointed` 这一步可以包含 `artifactId`，告诉接收方应该拉取哪个加密 checkpoint。fork 不会修改父 generation，只会通过 `baseGenerationId` 关联到新的子 generation；创建 fork 时也可以通过子 generation 的 `checkpoint.artifactId` 携带 `artifactId`。

## Checkpoint Artifact

checkpoint 包使用 `legax.checkpoint/1` schema。daemon 在本地创建包，过滤不安全文件，用 AES-256-GCM 加密 JSON payload，并通过 X25519、HKDF-SHA256 和 AES-256-GCM 为已授权 daemon 设备包装每个 artifact 的 data key。relay 不接收明文文件内容。

桌面鉴权 artifact API：

- `POST /api/artifacts`：保存加密 checkpoint artifact 记录。请求中如果包含 `plaintext`、`bundle`、`payload`、`files` 或 `content` 等明文字段，会被拒绝。
- `GET /api/artifacts/:id`：读取加密 artifact 元数据、密文和已包装的 keys。

本地创建 checkpoint 包时，默认排除凭据文件、私钥、数据库文件、符号链接、二进制文件、超大文件、绝对路径和路径穿越。restore 写入前会校验每个路径，拒绝符号链接逃逸，校验内容 hash；如果调用方没有显式允许覆盖，遇到有冲突的本地文件会直接拒绝。撤销设备后，后续不会再为该设备包装 key；已经为该 key 包装过的历史 artifact 仍按原有信任模型处理，持有匹配私钥的一方仍可读取。

## 受限工作流

工作流定义使用 `legax.workflow/1` schema。relay 会在保存前校验定义：step id 必须唯一，`needs` 必须组成 DAG，`uses` 必须引用已知内置动作，并且会拒绝 `shell`、`script`、`eval`、`prompt`、`command` 和自由参数等字段。定义内容包括元数据、带默认值的类型化输入、步骤、审批门策略、重试/超时策略、artifact 引用和完成所需的验收证据。

桌面鉴权 workflow API：

- `POST /api/workflow-definitions`：校验并注册受限工作流定义。
- `GET /api/workflow-definitions/:id`：读取工作流定义。
- `POST /api/workflow-runs`：从已注册定义创建 run，并调度可执行步骤。
- `GET /api/workflow-runs/:id`：读取 run，并刷新超时状态。
- `POST /api/workflow-runs/:id/steps/:stepId/result`：记录幂等步骤结果，在策略允许时重试，并调度依赖步骤。
- `POST /api/workflow-runs/:id/gates/:stepId`：批准或拒绝等待中的审批门。
- `POST /api/workflow-runs/:id/cancel`：取消尚未进入终态的 run。

relay 永远不直接执行工作流动作。可执行步骤会创建 relay command，并把 step 的 `uses` 值作为 `commandRef`；daemon host 只有在本地白名单包含该命令引用时才能认领。等待审批门时，relay 会生成与通道无关的 `workflow_gate` 收件箱事项，并通过审批门接口恢复执行。

内置 LPS TDD 动作契约可通过 `GET /api/workflow-actions` 获取。每个契约都会声明必需输入、必需输出、必需验收证据、是否可能修改工作区，以及对应的策略门。初始动作集包括：

- `requirements.capture`
- `design.basic`
- `design.detail`
- `test.spec`
- `tdd.red`
- `tdd.review_red`
- `tdd.green`
- `tdd.review_green`
- `tdd.refactor`
- `workflow.run_check`
- `review.self`
- `pr.prepare`
- `pr.create`

内置工作流定义 `lps-tdd` 会从需求捕获执行到 `pr.prepare`。它刻意不包含 `pr.create`；PR 创建默认禁用，使用时必须放在 before-gate 后面，并且即使启用也必须先创建 draft。会修改工作区的动作（`tdd.red`、`tdd.green` 和 `tdd.refactor`）必须持有有效的 generation lease。`workflow.run_check` 只接受已批准的 `checkRef`，绝不从工作流定义接收自由命令字符串。

## Worktree-Lite

`legax worktree` 提供本地轻量工作树流程：

- `legax worktree list`
- `legax worktree create --name <name> --base HEAD`
- `legax worktree check --name <name> -- <command> [args...]`
- `legax worktree archive --name <name> --delete-branch`

受管理的 worktree 位于 `data/worktrees/`。归档命令会拒绝删除该目录之外的 worktree。
