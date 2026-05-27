# 适配器指南

[English](ADAPTERS.md) | 简体中文

Legax 为每个受支持的编码 Agent runtime 使用一个适配器。daemon 负责监督适配器、通过 runtime state 路由远端消息；MCP 保持能力层角色，进程生命周期由 daemon 和 adapter 管理。

完整架构见[架构](ARCHITECTURE.zh-CN.md)。配置键从 [`../config.example.zh-CN.yaml`](../config.example.zh-CN.yaml) 开始查看。

## 运行模式

| 模式 | 转发输出 | 手机文本 | 手机审批 |
| --- | --- | --- | --- |
| `interactive` | 是 | 接受 | 接受 |
| `approval-only` | 是 | 忽略 | 接受 |
| `monitor` | 是 | 忽略 | 忽略 |
| `paused` | 忽略 | 忽略 | 忽略 |

`paused` 是硬停止。仅从手机选择适配器不会清除它；需要使用 `/mode <agentId> interactive`。

## Codex

当 `cliBackend: app-server-ws` 时，Codex 使用共享 app-server websocket 后端。

如果需要本地可见性，使用：

```bash
codex --remote ws://127.0.0.1:18779
```

桌面应用内嵌的 stdio app-server 不是共享本地后端。除非 Codex 暴露受支持的监听器，否则 Legax 不应把它当作多客户端控制 socket。

Codex 审批请求通过 `requestApproval` 等 JSON-RPC callback 返回。Legax 必须通过该原生路径返回远端决策，禁止模拟 UI 点击。

## Codex Desktop Mirror

可选的 `codexDesktopMirror` 适配器会 tail Codex desktop session JSONL 文件，并把观察到的活动转发到手机。它按设计是只读的，不能把手机消息注入桌面会话。

当用户主要希望从远端观察 Codex desktop 活动、且不需要写入桌面会话时使用它。

## Claude Code

Claude Code 以 print mode 和 stream-json 运行。existing-session 模式会添加 `--continue` 或 `--resume <id>`，让远程 turn 进入持久化的 Claude Code 历史。

当 `mcpAutoConfigure: true` 时，daemon 可以写入 Claude 的 permission-prompt MCP 配置。该 MCP server 会把权限请求镜像到手机，并通过 Claude 的 permission hook 返回 `allow` 或 `deny`。

## Gemini CLI

Gemini CLI 对每条手机消息运行一次带 `--prompt` 的 headless turn。existing-session 模式使用 `--resume latest` 或配置的 session id。session 通过 `gemini --list-sessions` 列出。

在未信任目录中运行 daemon 或 headless 时需要：

```yaml
gemini:
  trustWorkspace: true
```

只应对你愿意在 Gemini CLI 中信任的目录启用它。

## OpenCode

OpenCode 通过 `cliBackend: server-http` 连接到 `opencode serve`。当 `serverMode: connect-or-start` 时，Legax 可以按需启动 HTTP server。

手机文本发送到 `POST /session/:id/message`。OpenCode 原生权限 callback 桥接尚未实现。

## 按需启动

`autoStart: false` 的适配器仍会显示在手机和 Telegram 菜单中。daemon 在 runtime state 中拥有 launch request，并在手机动作选中目标适配器时启动它。

如果只运行某个独立适配器而没有 daemon，它不能启动其他同级适配器。

## 权限边界

Legax 镜像审批提示，并通过受支持的结构化 callback 返回决策：

- Codex JSON-RPC approval callback。
- Claude Code permission-prompt MCP。
- Gemini CLI 自身的 approval mode。

Legax 不能自动批准、绕过或抓取原生审批 UI。PTY 或 TUI 后端只能作为兜底方案，并应被视为高信任远程终端控制。
