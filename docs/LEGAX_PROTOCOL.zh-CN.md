# Legax 协议

[English](LEGAX_PROTOCOL.md) | 简体中文

Legax 是 Legax adapter、daemon、relay、Telegram 与后续第三方集成之间使用的轻量事件契约。它刻意比任何单个 CLI 的原生协议更窄，只保留跨工具需要共享的语义。

## 事件信封

跨 adapter 事件使用版本 `1` 和稳定的 `kind`：

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

必填字段是 `v`、`kind` 和 `sessionId`。事件属于某个 CLI adapter 时，应带上 `agentId`。

## 标准类型

- `active_context`：当前激活的 CLI、项目与 session。Telegram 可以置顶，Web UI 可以显示在输入框上方。
- `approval_request`：镜像到远端界面的 CLI 原生审批请求。
- `input_request`：需要用户补充信息的请求。
- `agent_summary`：值得通知的完成或进度摘要。
- `session_list`：标准化的项目、聊天与 session 列表。
- `attention_item`：已经整理好的远端待处理事项。

迁移期间，adapter 仍可以发送 `permission_request` 等旧 relay 事件。relay attention inbox 会把它们映射到标准待处理模型。

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

## Portable Sessions 与 Leases

relay 拥有的 portable sessions 使用以下桌面鉴权接口：

- `POST /api/sessions`：创建或更新稳定 relay session。
- `GET /api/sessions/:id`：读取 session，并在存在时返回当前 generation 和 active lease。
- `POST /api/generations`：创建 generation，并把它设为 session 的当前 generation。
- `GET /api/generations/:id`：读取 generation。
- `POST /api/generations/:id/update`：修改受 lease 保护的 generation 字段。必须携带当前 `hostId`、`fencingToken` 和 `leaseToken`。
- `POST /api/generations/:id/fork`：从父 generation checkpoint 创建子 generation，且不修改父 generation。必须携带当前 lease 凭据。
- `POST /api/leases/claim`：claim 一个 generation 的 active execution ownership。
- `GET /api/leases/:id`：读取 lease，并刷新过期状态。
- `POST /api/leases/:id/renew`：延长 active lease。必须携带当前 lease 凭据。
- `POST /api/leases/:id/release`：释放 active lease。必须携带当前 lease 凭据。
- `POST /api/handoffs`：创建 handoff 记录。
- `GET /api/handoffs/:id`：读取 handoff 记录。
- `POST /api/handoffs/:id/transition`：按文档化状态序列推进 handoff。

受 lease 保护的写入使用两层 fence。`fencingToken` 在每个 generation 内单调递增，用于在 reclaim 后拒绝旧 owner。`leaseToken` 是返回给 active holder 的不透明 secret。过期 host、过期 fencing token 或过期 lease token 都会返回 `409`，且不会修改 generation。

handoff transition 顺序为：`requested -> checkpointed -> uploaded -> released -> claimed -> restored -> resumed`。`failed` 是显式 terminal failure 状态。`checkpointed` transition 可以包含 `artifactId`，用于告诉接收 host 应该拉取哪个加密 checkpoint。fork 保持父 generation 不变，并通过 `baseGenerationId` 关联子 generation；创建 fork 时也可以通过子 generation 的 `checkpoint.artifactId` 携带 `artifactId`。

## Checkpoint Artifacts

checkpoint bundle 使用 `legax.checkpoint/1` schema。daemon 在本地创建 bundle，过滤不安全文件，用 AES-256-GCM 加密 JSON payload，并通过 X25519、HKDF-SHA256 和 AES-256-GCM 为已授权 daemon device 包装每个 artifact 的 data key。relay 不接收明文文件内容。

桌面鉴权 artifact API：

- `POST /api/artifacts`：保存加密 checkpoint artifact 记录。请求中如果包含 `plaintext`、`bundle`、`payload`、`files` 或 `content` 等明文字段，会被拒绝。
- `GET /api/artifacts/:id`：读取加密 artifact metadata、ciphertext 和 wrapped keys。

本地 bundle 创建默认排除 credential 文件、private key、database 文件、symlink、binary 文件、超大文件、绝对路径和路径穿越。restore 写入前会校验每个路径，拒绝 symlink escape，校验内容 hash，并且在调用方没有显式启用覆盖时拒绝覆盖有冲突的本地文件。device revoke 会阻止后续继续为该 device 包装 key；已经为该 key 包装过的历史 artifact 仍遵循既有信任模型，持有匹配 private key 的一方仍可读取。

## Worktree-Lite

`legax worktree` 提供本地轻量工作树流程：

- `legax worktree list`
- `legax worktree create --name <name> --base HEAD`
- `legax worktree check --name <name> -- <command> [args...]`
- `legax worktree archive --name <name> --delete-branch`

受管理的 worktree 位于 `data/worktrees/`。归档命令会拒绝删除该目录之外的 worktree。
