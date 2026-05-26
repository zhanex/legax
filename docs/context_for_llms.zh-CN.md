# LLM 上下文

[English](context_for_llms.md) | 简体中文

本文件为编码 Agent 提供足够的仓库上下文，避免在修改 Legax 时混淆控制平面、能力平面和通信平面。

## 一段话理解项目

Legax 是面向 AI 编码 Agent CLI 的 local-first 远程控制与 relay 层。它让手机或 Telegram 用户可以监看 Agent 事件、选择 CLI/项目/会话、回复选中的 Agent，并批准或拒绝受支持的原生权限提示。它不是托管 IDE、终端 UI 自动化层，也不是绕过 Agent 安全策略的通道。

## 核心边界

- 控制平面：`scripts/` 下每个受支持 CLI 对应一个 adapter 进程。
- 能力平面：`scripts/mcp-server.mjs` 暴露 `legax_send`、`legax_poll`、`legax_request_permission` 和 `legax_status`。
- 通信平面：`scripts/lib/outbound-transports.mjs`、`scripts/lib/inbound-transports.mjs`、relay server、Telegram 和 webhook。
- 运行时状态：`scripts/lib/runtime-state.mjs` 是跨进程共享状态的唯一 owner。不要为 adapter 协调新增旁路状态文件。
- Relay store：`data/relay-store.json` 使用 `legax.relay/1`，拥有可迁移 relay session 状态。它必须和 runtime-state 协同状态分开。
- 配置格式：仅支持 YAML。使用 `scripts/lib/yaml.mjs`；不要随意引入 JSON config 支持或 YAML 依赖。

## 当前 Adapter 事实

| Adapter | 关键行为 |
| --- | --- |
| Codex | 使用共享 app-server websocket 模式提供本地可见性，并通过 JSON-RPC approval callback 处理审批。 |
| Claude Code | 使用 `claude -p` stream-json，并通过 Claude permission-prompt MCP 处理审批。 |
| Gemini CLI | 每条手机消息运行一次 headless turn，并使用 Gemini 自己的 approval mode。 |
| OpenCode | 使用 `opencode serve` HTTP API 进行会话列表和文本路由。原生权限回调桥接尚未实现。 |

## 安全贡献清单

1. 编辑前阅读 `AGENTS.md` 和相关文档。
2. 英文与简体中文文档配对必须放在同一个变更中。
3. 不要提交 `config.yaml`、`data/`、日志、本地包 tarball、生成的机器配置或密钥。
4. 不要模拟 UI 点击、自动批准提示，或绕过 Agent 原生安全策略。
5. 如果新增脚本或 E2E 文件，更新 `package.json` 中的显式列表。
6. 先运行相关的窄范围检查；文档变更运行 `npm run check:docs`，广泛代码变更运行 `npm run ci`。

## 常用入口

| 任务 | 从这里开始 |
| --- | --- |
| 安装 Legax | `README.zh-CN.md`，然后读 `docs/USER_MANUAL.zh-CN.md` |
| 让 AI 安装 Legax | `docs/AI_INSTALL.zh-CN.md` |
| 理解架构 | `docs/ARCHITECTURE.zh-CN.md` |
| 理解产品边界 | `docs/FUNCTIONAL_BOUNDARIES.zh-CN.md` |
| 增加 adapter 或 transport | `docs/EXTENDING.zh-CN.md` |
| 查看协议形状 | `docs/LEGAX_PROTOCOL.zh-CN.md` |
| 修改 Codex 插件 | `docs/CODEX_PLUGIN.zh-CN.md`、`.codex-plugin/plugin.json`、`.mcp.json`、`skills/legax/SKILL.md` |

## 验证命令

```bash
npm run check:docs
npm run check:node
npm run test:e2e
npm run ci
```

纯文档变更使用 `npm run check:docs`。声称代码分支可合并前使用 `npm run ci`。
