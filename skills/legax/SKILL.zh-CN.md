---
name: legax
description: 当用户希望把 Agent 会话桥接到手机、轮询远程回复，或让 Agent 在敏感操作前向手机请求确认时使用。
---

# Legax 技能

[English](SKILL.md) | 简体中文

使用 `legax` MCP 工具，把当前 Agent 与用户手机或已配置的远程通讯通道连接起来。

## 工具

- `legax_send`：发送 Agent 文本、状态更新或系统通知。
- `legax_poll`：拉取远程回复和权限决策。
- `legax_request_permission`：请求手机端批准或拒绝某个拟执行动作。
- `legax_status`：查看通讯配置和待处理的权限请求。

## 使用规则

1. 当用户要求连接远程会话时，先向手机发送简短状态消息，再在需要时轮询回复。
2. 对用户希望远程处理的高风险动作，先调用 `legax_request_permission`，并提供清晰标题、原因、风险等级和动作摘要。
3. `approve` 表示同意继续执行由 Agent 承载的动作；`deny` 或超时表示停止。
4. 不要声称该工具可以绕过原生权限 UI。原生升级权限仍遵循宿主应用的安全策略。
5. 避免发送密钥。MCP 服务默认会脱敏常见 token 模式；只有在用户明确要求发送原文时，才设置 `allowSensitive`。

## 回复处理

手机端文本回复应视为当前会话中的用户指令，并遵循“最新消息优先”的规则。

当多个适配器共享一个 Relay 会话时，回复可能包含 `targetAgentId`。只有当回复目标是当前 Agent、目标是 `*`，或该回复来自已经按当前 Agent 过滤过的通道时，才应视为发给当前 Agent。

权限决策结构：

```json
{
  "type": "permission_decision",
  "requestId": "uuid",
  "decision": "approve"
}
```
