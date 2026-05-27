# 扩展 Legax：新增 Adapter

[English](EXTENDING.md) | 简体中文

Legax 内置四个一等 CLI Adapter（Codex、Claude Code、Gemini CLI、OpenCode）。daemon 通过 [`scripts/lib/adapter-contract.mjs`](../scripts/lib/adapter-contract.mjs) 中声明的小型契约来监督它们。新增其它 Adapter——比如 Aider、Continue、OpenInterpreter 或自研产物——只需要写一个遵循同样约定的常驻脚本，并在契约中注册。

本文是 checklist。契约模块本身才是字段形态的事实标准。

## 什么是 Adapter

Adapter 是 daemon 拥有的一个**独立 Node.js 进程**。它负责：

- 一个 CLI Agent 的生命周期（启动、重启、停止）。
- 把手机消息翻译为 CLI 输入。
- 把 CLI 结构化输出翻译为出站 transport 事件。
- 通过 `scripts/lib/runtime-state.mjs` 维护自己的 per-agent 运行时协同状态。
- 通过 relay 或第三方 transport 上报错误与权限请求。

Adapter **不调用** daemon——通信单向（daemon 监督，adapter 执行）。跨进程 adapter 协同状态只通过 `data/runtime-state.json` 交换。不要把 runtime state 当作可迁移 relay session 的事实来源；这类状态归 `legax.relay/1` relay store。

## 步骤

### 1. 选 CLI backend

Legax 优先使用结构化 CLI 协议，避免抓取 TUI 屏幕。优先级从高到低：

1. **stdio 或 websocket 上的 JSON-RPC**（Codex 的 `codex app-server --listen ws://...`）。
2. **HTTP/OpenAPI server**（OpenCode 的 `opencode serve`）。
3. **stream-json**——stdin/stdout 上的行式 JSON（`claude -p --output-format stream-json`、`gemini --output-format stream-json`）。
4. **每回合一次的 headless 调用** + 结构化输出（`gemini --prompt '...' --output-format stream-json`）。
5. **PTY 抓屏**——最后手段。视为"高信任远程终端控制"。权限、完成检测、会话列表都会变得不可靠。

如果该 CLI 提供结构化 server 或 JSON-RPC 模式，就用它。不要为了省规格工作而退到 PTY。

### 2. 定 canonical 配置 key 与 `agentId`

配置 key 是用户写在 YAML 顶层的字段名（如 `aider:`、`continue:`）。短、小写、无下划线、无版本后缀。默认 `agentId` 与用户感知的 agent 名一致（如 `aider-cli`、`continue-cli`）。

这两个字符串是跨版本稳定的。把它们当作公开契约的一部分。

### 3. 实现 `scripts/<name>-link.mjs`

HTTP server 型 CLI 抄 `scripts/opencode-link.mjs`；stream-json 的 CLI 抄 `scripts/claude-code-link.mjs`；JSON-RPC 的 CLI 抄 `scripts/codex-app-server-link.mjs`。删掉 agent 专属逻辑，再重写。这个文件必须**可独立运行**——`node scripts/<name>-link.mjs` 必须能直接跑，不依赖 bootstrap 共享模块。

复用共享模块：

- `scripts/lib/yaml.mjs`——`readYaml(path)`。
- `scripts/lib/runtime-state.mjs`——游标、mode、队列、Telegram 选择。
- `scripts/lib/menu-groups.mjs`——project/chat 分组以及 Telegram/relay 菜单回调。
- `scripts/lib/outbound-transports.mjs`——relay POST + Telegram + 飞书/Lark + webhook。
- `scripts/lib/inbound-transports.mjs`——inbox drain、Telegram 解析与路由辅助。飞书/Lark 回调先进入 relay，然后复用 relay message 路径。

至少实现：

- poll 循环：被 daemon 启动时（`LEGAX_DAEMON_ROUTER=1`）只 drain `pollInboundTransports(...)`；单独运行 adapter 时再兜底为直接轮询 `/api/messages`。
- `permission_decision` 与 `user_input_response` 的处理函数**不能静默吞掉孤儿决策**：当 requestId 没有匹配的 pending 项时，记 stderr，并向手机回一条 `status`，让用户知道这个请求已经过期。
- 通过 `applyControlMessages`、`canAcceptText`、`canAcceptApproval` 处理 mode。
- `SIGINT` / `SIGTERM` 优雅关闭。

### 4. 注册契约

在 `scripts/lib/adapter-contract.mjs` 的 `ADAPTERS` 数组里添一项：

```js
{
  key: "aider",
  name: "aider",
  defaultAgentId: "aider-cli",
  label: "Aider",
  script: "scripts/aider-link.mjs",
  cliBackend: "stream-json",
  mcpEnabled: false,
  autoStart: false
}
```

daemon 启动会自动跑 `validateAllAdapters`，你只需要保证字段类型正确。

### 5. 加配置示例段

在 `config.example.yaml` 与 `zh-CN` 对加一段。镜像现有 Adapter 的写法——同样的 key 风格、同样的注释密度。用户会复制这个模板，所以默认值要合理（不要把"还得装其他东西"的能力默认 `enabled: true`）。

### 6. 加 E2E 测试

新建 `tests/e2e/<name>-link.e2e.mjs`。至少覆盖：

- dry-run / 启动健康。
- 手机文本 → CLI stdin。
- CLI 输出 → relay 事件。
- 通过手机控制消息切换 mode。
- 如适用：审批往返。

复用 `tests/e2e/helpers.mjs` 的进程拉起 / 端口分配 / 临时配置写入工具。

### 7. 把新文件接进 CI

把以下条目追加进 `package.json`：

- `node --check scripts/<name>-link.mjs` 进 `check:node`。
- `tests/e2e/<name>-link.e2e.mjs` 进 `test:e2e`。

CI 是显式枚举不是通配符；忘记追加就等于把新文件悄悄踢出闸门。

### 8. 文档与翻译

更新：

- `README.md` 和 `README.zh-CN.md` 的 Layout / Configuration 段（提及新 Adapter）。
- `docs/ARCHITECTURE.md` 和 zh-CN——加一个 Components 小节。
- `docs/EXTENDING.md` 和 zh-CN：如果你的 Adapter 引入了新的模式（PTY、有状态流、特殊审批等）值得让其他贡献者知道，写在这里。

## 反模式

- **不要把 Adapter 塞进 daemon 进程**。supervisor 设计前提是 adapter 可以独立重启。
- **不要在 `runtime-state.mjs` 之外写 per-adapter 状态**。并行状态文件会破坏跨进程协调（特别是 Windows 上），并在崩溃时变孤儿。
- **不要绕过 redact 层**。所有出站文本都要走 `mcp-server.mjs` 的 redact，除非显式设 `allowSensitive: true`。
- **不要模拟 UI 点击**自动放行原生安全提示。要么通过 agent 自身的结构化回调镜像，要么干脆拒绝转发。
- **不要把 `cliBackend` 写成与实际传输不一致的字符串**（比如 stream-json 标成 "app-server" 因为听着更高大）。运维者靠这个字符串排查问题。

## 参考

- 契约模块：[`scripts/lib/adapter-contract.mjs`](../scripts/lib/adapter-contract.mjs)
- daemon：[`scripts/legax-daemon.mjs`](../scripts/legax-daemon.mjs)
- 现有 Adapter：`scripts/codex-app-server-link.mjs`、`scripts/claude-code-link.mjs`、`scripts/gemini-cli-link.mjs`、`scripts/opencode-link.mjs`
- 架构总览：[`ARCHITECTURE.zh-CN.md`](ARCHITECTURE.zh-CN.md)
