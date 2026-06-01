# LLM 上下文

[English](context_for_llms.md) | 简体中文

本文件为编码 Agent 提供足够的仓库上下文，避免在修改 Legax 时混淆控制平面、能力平面和通信平面。

## 一段话理解项目

Legax 管理多个 Agent CLI 之间的 session 路由、任务身份、审批、交接和受控工作流。远端交互入口可以监看 Agent 事件、选择 CLI/项目/session、回复选中的 Agent，并批准或拒绝受支持的原生权限提示。托管 IDE、终端 UI 自动化和绕过 Agent 安全策略不属于项目范围。

## 核心边界

- 控制平面：`scripts/` 下每个受支持 CLI 对应一个 adapter 进程。
- 能力平面：`scripts/mcp-server.mjs` 暴露 `legax_send`、`legax_poll`、`legax_request_permission` 和 `legax_status`。
- 通信平面：`scripts/lib/outbound-transports.mjs`、`scripts/lib/inbound-transports.mjs`、relay server、Telegram 和 webhook。
- 运行时状态：`scripts/lib/runtime-state.mjs` 是跨进程共享状态的唯一 owner。不要为 adapter 协调新增旁路状态文件。
- Relay store：`data/relay-store.json` 使用 `legax.relay/1`，拥有可迁移 relay session 状态。它必须和 runtime-state 协同状态分开。
- 配置格式：仅支持 YAML。使用 `scripts/lib/yaml.mjs`；不要随意引入 JSON config 支持或 YAML 依赖。
- 工程规则：命名、常量、目录职责、设计模式和禁止模式遵循 `docs/ENGINEERING_GUIDE.zh-CN.md`。

## 文档加载规则

不要默认加载所有设计文档。根据将要编辑的文件加载最小相关集合；表中列出的文档在对应领域内仍是必须遵守的规范。

| 编辑范围 | 必需上下文 |
| --- | --- |
| 任意非平凡代码变更 | `AGENTS.md`、本文档、`docs/ENGINEERING_GUIDE.zh-CN.md`、`docs/CHANGE_MATRIX.zh-CN.md` |
| 架构、职责归属或范围决策 | `docs/ARCHITECTURE.zh-CN.md`、`docs/FUNCTIONAL_BOUNDARIES.zh-CN.md`、`docs/adr/` 下相关 ADR |
| Adapter 脚本或 adapter 测试 | `docs/ADAPTERS.zh-CN.md`、`docs/ADAPTER_CONFORMANCE.zh-CN.md`、`docs/EXTENDING.zh-CN.md` |
| MCP tool、permission MCP、skill 或 plugin metadata | `docs/CODEX_PLUGIN.zh-CN.md`、`skills/legax/SKILL.zh-CN.md`、`docs/OBSERVABILITY.zh-CN.md` |
| Daemon、mode、launch request、runtime queue | `docs/RUNTIME_STATE.zh-CN.md`、`docs/STATE_MACHINES.zh-CN.md` |
| Relay endpoint 或 relay 侧记录 | `docs/RELAY_API.zh-CN.md`、`docs/RELAY_STORE.zh-CN.md`、`docs/LEGAX_PROTOCOL.zh-CN.md` |
| Config 形状、YAML parser、示例 | `docs/CONFIGURATION.zh-CN.md`、`config.example.yaml`、`config.example.zh-CN.yaml` |
| Transport、Telegram、飞书/Lark、webhook 路由 | `docs/ARCHITECTURE.zh-CN.md`、`docs/CONFIGURATION.zh-CN.md`、`docs/FEISHU_LARK.zh-CN.md`、`docs/COMPATIBILITY.zh-CN.md` |
| Workflow、checkpoint artifact、worktree-lite | `docs/LEGAX_PROTOCOL.zh-CN.md`、`docs/RELAY_API.zh-CN.md`、`docs/RELAY_STORE.zh-CN.md`、`docs/STATE_MACHINES.zh-CN.md` |
| 鉴权、secret、隐私、公开暴露 relay | `docs/RELAY_API.zh-CN.md`、`docs/OBSERVABILITY.zh-CN.md`、`docs/PRIVACY.zh-CN.md`、`.github/SECURITY.zh-CN.md` |
| 日志、health、status、audit、diagnostics | `docs/OBSERVABILITY.zh-CN.md` |
| 纯文档变更 | `docs/DOCUMENTATION.zh-CN.md`、`docs/README.zh-CN.md` |
| 发布或包维护 | `docs/RELEASE.zh-CN.md` |

如果一个变更跨越多个领域，加载相关行的并集。如果某个文档与 `AGENTS.md` 冲突，先停止并暴露冲突，再继续编辑。

## 当前 Adapter 事实

| Adapter | 关键行为 |
| --- | --- |
| Codex | 使用共享 app-server websocket 模式提供本地可见性，并通过 JSON-RPC approval callback 处理审批。 |
| Claude Code | 使用 `claude -p` stream-json，并通过 Claude permission-prompt MCP 处理审批。 |
| Gemini CLI | 每条手机消息运行一次 headless turn，并使用 Gemini 自己的 approval mode。 |
| OpenCode | 使用 `opencode serve` HTTP API 进行会话列表和文本路由。原生权限回调桥接尚未实现。 |

## 安全贡献清单

1. 编辑前阅读 `AGENTS.md` 和路由表中的相关文档。
2. 英文与简体中文文档配对必须放在同一个变更中。
3. 不要提交 `config.yaml`、`data/`、日志、本地包 tarball、生成的机器配置或密钥。
4. 不要模拟 UI 点击、自动批准提示，或绕过 Agent 原生安全策略。
5. 如果新增脚本或 E2E 文件，更新 `package.json` 中的显式列表。
6. 行为常量应具名，不要到处散落硬编码值；新增硬编码值需要人工审查。
7. 使用 `docs/CHANGE_MATRIX.zh-CN.md` 选择聚焦验证，再运行更宽门禁。
8. 先运行相关的窄范围检查；文档变更运行 `npm run check:docs`，广泛代码变更运行 `npm run ci`。

## 常用入口

| 任务 | 从这里开始 |
| --- | --- |
| 安装 Legax | `README.zh-CN.md`，然后读 `docs/USER_MANUAL.zh-CN.md` |
| 让 AI 安装 Legax | `docs/AI_INSTALL.zh-CN.md` |
| 理解架构 | `docs/ARCHITECTURE.zh-CN.md` |
| 遵循工程规则 | `docs/ENGINEERING_GUIDE.zh-CN.md` |
| 为代码变更选择文档和测试 | `docs/CHANGE_MATRIX.zh-CN.md` |
| 审查配置字段 | `docs/CONFIGURATION.zh-CN.md` |
| 审查 Relay HTTP API | `docs/RELAY_API.zh-CN.md` |
| 审查 runtime state | `docs/RUNTIME_STATE.zh-CN.md` |
| 审查状态转换 | `docs/STATE_MACHINES.zh-CN.md` |
| 审查兼容性假设 | `docs/COMPATIBILITY.zh-CN.md` |
| 理解产品边界 | `docs/FUNCTIONAL_BOUNDARIES.zh-CN.md` |
| 增加 adapter 或 transport | `docs/EXTENDING.zh-CN.md` |
| 查看协议形状 | `docs/LEGAX_PROTOCOL.zh-CN.md` |
| 审查诊断与 audit 行为 | `docs/OBSERVABILITY.zh-CN.md` |
| 修改 Codex 插件 | `docs/CODEX_PLUGIN.zh-CN.md`、`.codex-plugin/plugin.json`、`.mcp.json`、`skills/legax/SKILL.md` |

## 验证命令

```bash
npm run check:docs
npm run check:node
npm run test:e2e
npm run ci
```

纯文档变更使用 `npm run check:docs`。声称代码分支可合并前使用 `npm run ci`。
