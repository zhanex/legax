# Adapter 一致性要求

[English](ADAPTER_CONFORMANCE.md) | 简体中文

这份清单定义每个 Legax 编码 Agent adapter 应满足的行为。它面向想要添加、审查或维护 adapter，同时不削弱共享远端交互模型的贡献者。

实现指南见[扩展 Legax](EXTENDING.zh-CN.md)。三平面架构见[架构](ARCHITECTURE.zh-CN.md)。

## 必须保留的边界

每个 adapter 都必须保持这些边界：

- daemon 负责生命周期监督、远程入站路由和按需启动。
- adapter 负责一个 CLI runtime 及其会话模型。
- MCP 暴露能力工具；它不启动或停止 adapter 进程。
- 跨进程 adapter 协同状态归 `scripts/lib/runtime-state.mjs` 管理；可迁移的 relay session 状态归 `legax.relay/1` relay store 管理。
- 当 CLI 提供原生结构化 callback 时，审批决策必须走该路径。
- PTY 或 TUI 兜底控制必须视为高信任远程终端控制。

## 行为清单

| 范围 | 要求 |
| --- | --- |
| 启动 | 读取 YAML 配置、归一化默认值、校验 adapter contract，并且不依赖隐藏全局状态即可启动或连接。 |
| 身份 | 为 relay 和 Telegram 菜单暴露稳定的 `agentId` 与可读的 `agentLabel`。 |
| 模式 | 一致遵守 `interactive`、`approval-only`、`monitor` 和 `paused`。 |
| 会话列表 | 当 CLI 有会话概念时提供有界列表；不支持会话发现时要明确说明。 |
| 会话选择 | 通过 runtime state 持久化选中的项目/聊天/会话 metadata，不使用私有状态文件。 |
| 手机文本 | 只有 `interactive` 模式接受手机文本，并将其路由到选中会话或新会话路径。 |
| 审批 | 只有 `interactive` 或 `approval-only` 模式接受手机审批。 |
| 孤儿消息 | 当决策或输入回复找不到 pending request 时，记录日志并向手机发回 status 事件。 |
| 重启行为 | 使用 cursor 和 runtime state，避免 adapter 重启后重放旧手机消息。 |
| 脱敏 | 使用共享 outbound transport 脱敏，除非调用方明确允许敏感文本。 |
| 通知 | 大量原始 agent 输出必须受配置控制；默认不要刷屏。 |
| 停止 | daemon 停止 adapter 时应干净退出，并避免留下无人管理的子进程。 |

## 原生审批要求

只有当 CLI 暴露受支持的 callback 或权限机制时，adapter 才能声明支持手机审批。

| Adapter | 原生审批路径 | 当前状态 |
| --- | --- | --- |
| Codex | JSON-RPC approval callback，例如 `requestApproval` | 已支持 |
| Claude Code | Permission-prompt MCP 工具结果 | 已支持 |
| Gemini CLI | Gemini approval mode | 已支持 |
| OpenCode | 原生权限 callback bridge | 尚未实现 |

Adapter 不能：

- 模拟 UI 点击
- 抓取终端审批提示
- 自动批准提示
- 将手机审批翻译成 shell 输入，除非后端被明确记录为高信任 terminal backend

## 测试期望

adapter 变更应尽量包含聚焦测试：

```bash
npm run check:node
npm run check:docs
node --test tests/e2e/<adapter-or-transport>.e2e.mjs
```

共享行为使用更宽的门禁覆盖：

```bash
npm run test:e2e
```

真实 CLI 兼容性仍然是 opt-in：

```bash
LEGAX_REAL_CLIENTS=1 npm run test:e2e:real
```

## 审查问题

合并 adapter 变更前，reviewer 应能回答：

- 哪个进程负责 CLI 生命周期？
- 选中会话状态持久化在哪里？
- 哪些模式接受或忽略手机文本和审批？
- 如果权限请求 pending 时 adapter 重启，会发生什么？
- 审批路径是原生路径，还是已经记录清楚的高信任兜底路径？
- 哪条具体命令证明被修改的行为？
