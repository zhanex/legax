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

## Worktree-Lite

`legax worktree` 提供本地轻量工作树流程：

- `legax worktree list`
- `legax worktree create --name <name> --base HEAD`
- `legax worktree check --name <name> -- <command> [args...]`
- `legax worktree archive --name <name> --delete-branch`

受管理的 worktree 位于 `data/worktrees/`。归档命令会拒绝删除该目录之外的 worktree。
