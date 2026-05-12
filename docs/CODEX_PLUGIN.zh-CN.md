# Codex 插件指南

[English](CODEX_PLUGIN.md) | 简体中文

Legax 在本仓库中以 Codex 插件包形式提供。插件包含：

- 位于 [`../.codex-plugin/plugin.json`](../.codex-plugin/plugin.json) 的清单。
- 位于 [`../.agents/plugins/marketplace.json`](../.agents/plugins/marketplace.json) 的仓库 marketplace。
- 位于 [`../skills/legax/`](../skills/legax/) 的 skill。
- 位于 [`../.mcp.json`](../.mcp.json) 的 MCP server 注册。
- 位于 [`../assets/`](../assets/) 的安装展示资产。

插件不会替代 Legax daemon 或 relay 包。插件用于让 Codex 获得 skill 和 MCP 能力工具；npm 包用于安装和运行 daemon、relay 与操作者配置。

## 从本地 checkout 安装

在仓库根目录运行：

```bash
codex plugin marketplace add .
```

重启 Codex，打开插件目录，选择 `Legax Plugins` marketplace，然后安装 `Legax`。

如果 Codex 已经跟踪这个 marketplace，本地修改后刷新：

```bash
codex plugin marketplace upgrade legax
```

## 从 GitHub 安装

分支合并后，用户可以把本仓库作为 Git-backed marketplace 添加：

```bash
codex plugin marketplace add zhanex/legax --ref main
```

如果使用发布分支或 tag，将 `main` 替换为固定 ref。团队需要可复现安装时建议固定 ref。

## 运行时设置

打包的 `.mcp.json` 会运行：

```bash
node ./scripts/mcp-server.mjs
```

它有意不设置 `LEGAX_CONFIG`。server 默认使用 Legax 的默认配置路径，除非操作者在插件外部设置 `LEGAX_CONFIG`。

需要单独初始化操作者配置和 daemon：

```bash
npm install -g legax
legax init
legax doctor --offline
legax relay start
legax daemon start
```

如果没有操作者配置，MCP server 仍可启动，但传输调用会使用示例默认值，无法用于真实手机路由。

## MCP 工具审查元数据

通用 MCP server 暴露：

| 工具 | 只读 | Open world | 破坏性 | 原因 |
| --- | --- | --- | --- | --- |
| `legax_send` | 否 | 是 | 否 | 将 Agent 消息发送到配置的 relay、Telegram 或 webhook 等传输。 |
| `legax_poll` | 否 | 否 | 否 | 拉取回复并记录本地 cursor 和消息状态。 |
| `legax_request_permission` | 否 | 是 | 否 | 向手机发送权限请求，并可等待决策。 |
| `legax_status` | 是 | 否 | 否 | 读取脱敏配置和待处理权限状态；可选 ping 不改变状态。 |

每个工具都声明 `outputSchema`，并在文本内容之外返回 `structuredContent`。

Claude permission-prompt MCP server 也为 `approval_prompt` 工具声明了显式 annotations 和 output schema。它由 daemon 为 Claude Code 权限桥接配置，不在根插件 `.mcp.json` 中注册。

## 发布候选清单

将插件视为发布候选前，确认：

- `plugin.json` 具有稳定的发布者元数据、法律链接、提示语、视觉资产和组件路径。
- `.mcp.json` 不指向仓库本地 `config.yaml`。
- 仓库 marketplace 包含 `policy.installation`、`policy.authentication` 和 `category`。
- 所有 MCP 工具声明 `readOnlyHint`、`openWorldHint`、`destructiveHint` 和 `outputSchema`。
- 根 README 链接到安装、插件、安全、支持和贡献文档。
- 英文和简体中文文档成对更新。
- `npm run check:docs`、定向 MCP 测试和完整 CI 门禁通过。

## 官方 Plugin Directory 状态

OpenAI 的 Codex 插件文档当前说明官方 Plugin Directory 自助发布即将推出。在开放前，Legax 应通过仓库或个人 marketplace 分发，并将当前内容视为可发布源码材料，而不是已经自助提交的官方列表项。

## 安全边界

插件可以把消息和权限请求发送到配置的传输。它不能声称绕过 Codex、Claude Code、Gemini CLI、OpenCode 或宿主应用的审批策略。

仅在用户希望手机确认 agent-mediated 检查时使用 `legax_request_permission`。原生提升审批仍遵循宿主应用的安全模型。
