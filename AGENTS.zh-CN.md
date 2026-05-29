# AGENTS.md

本文件为 Codex（Codex.ai/code）在本仓库中工作时提供指引。

## 命令

这是一个**零依赖 Node.js 项目**（没有 `node_modules`，没有 bundler）。所有内容都运行在 Node 18+ 标准库之上。

```bash
npm run ci                            # 完整 CI 门禁：npm test + check:docs
npm test                              # 本地代码门禁：check:node + check:shell + test:e2e
npm run check:node                    # 对每个脚本运行 node --check（只检查语法）
npm run check:docs                    # docs/i18n/secret/BOM 门禁（scripts/check-docs.mjs）
npm run check:shell                   # 对 installer + service 脚本运行 bash -n
npm run test:e2e                      # 对 tests/e2e/*.e2e.mjs 运行 node --test（不含 real-clients）
npm run test:e2e:real                 # 选择性运行：需要 LEGAX_REAL_CLIENTS=1 且真实 codex/Codex/gemini CLI 在 PATH 中
npm run test:real:messages            # real-local-message smoke test
```

运行单个 E2E 文件：`node --test tests/e2e/<name>.e2e.mjs`。运行其中的单个测试：`node --test --test-name-pattern '<substring>' tests/e2e/<name>.e2e.mjs`。

`npm run ci` 是 CI 强制执行的契约；如果新增脚本或测试文件，也要把它追加到 `package.json` 中对应的 `check:node` / `test:e2e` 列表。这里的列表是显式维护的，不按 glob 自动发现。

不启动真实 CLI、只 dry-run supervisor：`node scripts/legax-daemon.mjs --dry-run`。

## 贡献与提交

准备提交时遵循 `.github/CONTRIBUTING.zh-CN.md`：

- 把 `npm run ci` 视为完整合并门禁（`npm test` 加 `check:docs`）。处理定向 bugfix 时，先跑窄范围回归测试，再跑相关的更大门禁；如果完整门禁失败，必须明确说明失败项，不要暗示 CI 干净。
- 仅文档变更本地可以跑 `npm run check:docs`；代码提交至少要跑受影响的 E2E 文件、`npm run check:node`，以及被改动 daemon/transport 相关集成测试。
- 文档配对必须在同一 commit 中完成：英文 `.md` 配 `.zh-CN.md`，`config.example.yaml` 配 `config.example.zh-CN.yaml`。
- staging 前检查 `git status --short` 和完整 diff。不要把本地运行产物、大二进制、`data/` 残留、机器相关配置、lock 文件或已跟踪密钥加入提交。
- 提交标题使用简短祈使句。不强制 Conventional Commits；有助于扫描时优先使用主题前缀，例如 `telegram: refresh active pinned context`、`daemon: route opencode launches`、`docs: clarify relay pairing`。
- 只有当 *why* 无法从标题和 diff 直接看出时，才写 commit body。

## 架构

本项目是面向 Agent CLI 的 session 管理与工作流编排层，通过 relay、Telegram、飞书/Lark 或 webhook 等通道连接受支持的 Agent CLI 和远端交互入口。先阅读 `docs/ARCHITECTURE.md`。设计上分为**三个平面**，改代码时不能混淆：

- **控制平面（CLI adapters）**：负责进程生命周期、会话选择/继续、结构化输出解析。`scripts/` 下每个 agent 一个 adapter：`codex-app-server-link.mjs`（基于 WebSocket app-server 的 JSON-RPC）、`claude-code-link.mjs`（`claude -p` stream-json）、`gemini-cli-link.mjs`（`gemini` stream-json）、`opencode-link.mjs`（OpenCode HTTP server）。每个 adapter 都是长生命周期进程，由 daemon 监督。
- **能力平面（MCP）**：`scripts/mcp-server.mjs` 是通用 stdio MCP server，暴露 `legax_send/poll/request_permission/status`。`scripts/claude-permission-mcp-server.mjs` 是 Claude 专用的 permission-prompt MCP，会把权限请求镜像到手机，并通过 Claude 的 permission hook 返回决定。MCP 是**能力层，不是生命周期管理器**，不要用它启动/停止进程。
- **通信平面（transports）**：`scripts/lib/outbound-transports.mjs`（relay POST、Telegram sendMessage、通用 webhook）和 `scripts/lib/inbound-transports.mjs`（Telegram 解析/路由 helper）。daemon 运行时负责轮询 relay `/api/messages` 和 Telegram `getUpdates`，把消息写入每个 agent 的 inbox 队列；由 daemon 启动的 adapter 只读取自己的 inbox。独立运行的 adapter 保留旧的单 poller 兜底路径。

用户通常运行的是**统一 daemon**（`scripts/legax-daemon.mjs`）。它读取一个 `config.yaml`，负责远端入站路由，监督所有启用的 adapter，以有界 backoff 重启崩溃进程，在启动前写入每个 adapter 的 MCP 配置（`mcpAutoConfigure`），并通过 runtime state 中的 launch request 处理 `autoStart: false` adapter 的**按需启动**。如果只运行某个单独 adapter，它不能启动 sibling adapter。

### 通过 runtime state 跨进程协调

`scripts/lib/runtime-state.mjs` 是 daemon 与所有 adapter 共享的**单一事实来源**。它把 adapter cursor、动态 mode、Telegram chat 选择、已选择的 Codex thread metadata、每个 agent 的 inbound queue、pending launch request 持久化到 `data/runtime-state.json`（可通过 `runtimeStatePath` 配置）。写入使用 temp-file + retrying atomic rename，以容忍 Windows 上并发写入时的 EPERM/EACCES/EBUSY。新增跨进程状态时，扩展这个模块，不要创建旁路状态文件。relay 自己的状态单独位于 `data/relay-store.json`；通用 MCP server 的状态位于 `data/mcp-state.json`。

### 每个 adapter 的会话模型（差异很重要）

- **Codex**：existing-session 模式通过 WebSocket 连接共享的 `codex app-server --listen ws://...`（`cliBackend: app-server-ws`）。如需本地可见性，用户必须启动 `codex --remote ws://127.0.0.1:18779`；desktop app 内嵌的 stdio app-server 不是共享 backend。审批走 JSON-RPC `requestApproval`。
- **Claude Code**：启动 `claude -p` 并使用 stream-json。existing-session 模式添加 `--continue` 或 `--resume <id>`，并从本地持久化 JSONL 历史中发现 session。权限通过配置为 Claude permission-prompt MCP 的 `claude-permission-mcp-server.mjs` 传递。
- **Gemini CLI**：手机每条消息触发一次 headless turn，通过 `--prompt` 传入；resume 使用 `--resume latest` 或配置的 id；session 来自 `gemini --list-sessions`。daemon/headless 在不受信任目录中运行时需要 `trustWorkspace: true`（设置 `GEMINI_CLI_TRUST_WORKSPACE=true`）。
- **OpenCode**：通过 `cliBackend: server-http` 连接 `opencode serve`；`serverMode: connect-or-start` 可以按需启动 server。session 来自 `GET /session`；手机文本通过 `POST /session/:id/message` 发送。尚未实现 OpenCode 原生 permission callback 桥接。

手机端 approval decision 只在 `interactive` 和 `approval-only` 模式下生效。`paused` 是硬停止，不能通过选择 adapter 清除；只有 `/mode <agentId> interactive` 能清除。通过 Telegram/手机选择 adapter 会为非 paused adapter 激活 `interactive`，并返回其 session 列表。

### 手写 YAML parser

项目**没有 YAML library**。仓库内脚本使用 `scripts/lib/yaml.mjs` 中的共享手写 parser；独立部署 relay 保留一份 inline copy，因为 installer 可以只复制 `self-hosted-relay/server.mjs`。parser 支持示例配置使用的子集：顶层 scalar、两层嵌套 object、带子列表的 `transports:` list，以及引号外 inline comment。**项目刻意不支持 JSON config**，用户必须使用 YAML。如果需要新的配置形状，请同步扩展共享 parser 和任何独立 inline copy，并补覆盖。

## 文档规则（由 `check:docs` 强制）

- 每个 prose `.md` 和每个 `config.example*.yaml` 文件都必须有**语言配对**：`*.md`（英文）+ `*.zh-CN.md`（简体中文），`config.example*.yaml` + 匹配的 `config.example*.zh-CN.yaml`。修改其中一个时，同一 commit 必须修改另一个。
- 文件必须是 UTF-8 **无 BOM**。不要在 `.zh-CN.md` 中混入英文 prose（反之亦然），但短 cross-link、产品名、CLI 命令、config key、代码块可以保留原文。
- doc gate 还会扫描意外提交的 Telegram bot token、OpenAI 风格 `sk-...` key、GitHub `gh[pousr]_...` token。统一使用占位符（`replace-with-a-long-random-secret`、`YOUR_RELAY_HOST`、`TELEGRAM_BOT_TOKEN`）。
- 完整 review checklist 见 `docs/DOCUMENTATION.md`。

## 测试说明

- E2E tests 会启动真实 adapter 进程以及 fake relay/Codex app-server（`tests/e2e/fixtures/`）。它们共享 `tests/e2e/helpers.mjs` 中的 spawn、端口分配、临时配置生成 helper。
- `tests/e2e/real-clients.e2e.mjs` 受 `LEGAX_REAL_CLIENTS=1` gate 控制，且只有真实 `codex`、`Codex`、`gemini` binary 在 PATH 中时才运行；它不属于 `npm test`。
- 在 Windows 上，如果直接调用 `codex` 被 execution policy 阻止，请在测试/开发配置中设置 `codex.command: codex.cmd`。

## 权限模型（不要破坏）

Legax 会在 adapter 支持时把原生 approval prompt **镜像**到手机，并通过 agent 的结构化回调返回决定（Codex JSON-RPC、Claude permission-prompt MCP、Gemini 自己的 approval mode）。它绝不能模拟 UI 点击、自动批准原生 prompt，或绕过 agent 的安全策略。TUI/PTY backend 只能作为兜底路径，且必须视为高信任远程终端控制。
