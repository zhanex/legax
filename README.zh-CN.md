# Legax

[English](README.md) | 简体中文

`Legax` 取自 `Local-first Embedded Gateway for Agent eXchange`：本地优先、嵌入在现有工作流里的 Agent 交换网关。这个名字对应项目边界：它只做一层轻量连接，让现有 CLI Agent 与手机交换消息、审批和 session 上下文，而不是变成托管 IDE 或新的 Agent 平台。

Legax 是一个本地优先的远程交互层，用于连接编码 Agent 和开发助手。它可以把桌面 Agent 的关键事件发送到手机，接收手机回复，并通过自部署或第三方通讯通道处理权限确认和用户输入请求。

项目保持 Agent 中立。Codex、Claude Code、Gemini CLI 和 OpenCode 是当前的一等适配器，但内部模型可以继续扩展到更多 CLI 和运行时。

## 架构

项目采用 CLI + MCP 模型：

- CLI 是控制面：负责进程生命周期、会话、结构化输出解析、任务完成和取消。
- MCP 是能力面：在 Agent 支持或需要时，提供远程审批、远程输入和远程通知工具。
- Relay 和第三方通讯通道是通信面。
- TUI 或 PTY 托管只作为兜底方案；默认链路保持结构化 CLI + MCP 能力工具。

更多细节见 [架构文档](docs/ARCHITECTURE.zh-CN.md) 和 [功能边界](docs/FUNCTIONAL_BOUNDARIES.zh-CN.md)。

## 项目目标

Legax 是现有编码 Agent 的轻量远程交互层。它让你可以在手机等移动终端上选择 CLI、项目和 session，发送简短回复，查看重要消息，并处理原生权限请求，同时把真正的编码工作流保留在你自己的 Agent、编辑器、终端和 Git 流程里。

Legax 面向移动端 vibe coding，而不是替代你的开发环境。它不是编程客户端、IDE、终端替代品或托管 Agent 平台。它现在不提供，未来也不计划提供代码编辑器、diff 工作台、终端模拟器或完整 Web 编程环境。这些能力应由 Codex、Claude Code、Gemini CLI、OpenCode、你的编辑器、终端和 Git 托管平台承担。

你可以在自己的 VPS、NAS、树莓派或其它轻量机器上安装任意受支持的 CLI 和 Legax，然后愉快地用移动终端编码。推荐工作流很简单：让 Agent 在远端持续工作，在 Git 上审核最终 PR，不必为了推动 session 随时坐在电脑前，从而明显减轻工作负担。

## 隐私与部署立场

Legax 围绕用户自有基础设施设计。远程控制会接触敏感的 session 上下文、审批决策、本地项目路径，有时还包括命令输出，所以数据安全和隐私保护是项目边界的一部分，而不是可选附加项。

因此，本项目目前不提供官方共享 relay 服务，也不提供官方共享 Telegram bot。推荐做法是自行部署属于自己的 relay，并开通自己的 Telegram bot token。后续如果需求强烈，项目可能会探索官方托管选项，但这不是当前默认或首选的部署模式。

## 快速开始

多数用户直接安装 all-in-one CLI 包即可：

```bash
npm install -g legax
legax init
legax doctor --offline
legax relay start
legax daemon start
```

Legax 以三个 fixed-version packages 发布：`legax`、`@legax/daemon`、`@legax/relay` 始终使用同一个版本号。分离部署时，在公网服务器安装 `@legax/relay`，在开发机安装 `legax` 或 `@legax/daemon`：

```bash
# relay 服务器
npm install -g @legax/relay
legax-relay --config /path/to/relay.config.yaml

# 开发机
npm install -g legax
legax relay init --domain relay.example.com
legax daemon start
```

`legax init` 默认会把 `config.yaml` 写入 Legax home 目录。你可以设置 `LEGAX_HOME` 来选择自己的运行目录，也可以在单次命令中传入 `--config <path>`。

## 功能

- 将 Agent 状态、完成摘要和权限请求发送到手机。
- 接收手机回复，并路由到选中的 Agent。
- 使用一个本地 daemon 同时运行 Codex、Claude Code、Gemini CLI 和 OpenCode 适配器。
- 使用短期二维码协议 offer 完成浏览器配对，不要求用户记忆 token。
- 在 relay HTTPS 入口和本地项目根目录配置完成后，通过 Telegram Mini App 打开新项目。
- 通过统一 attention inbox 查看审批、输入请求、错误、完成摘要和当前上下文。
- 使用 `legax init` 与 `legax doctor` 初始化和诊断本地安装。
- 使用 `legax worktree` 创建、检查、列出和归档受管理的 Git worktree。
- 为每个 Agent 切换 `interactive`、`approval-only`、`monitor` 和 `paused` 模式。
- 支持自部署 relay、Telegram Bot API 和出站 webhook。
- 使用 YAML 配置，真实密钥只 inline 写入已被 gitignore 的本地配置文件。
- Codex 默认采用低噪声通知：权限审批和用户输入请求立即发送，普通 Agent 文本在 turn 完成时发送。

## 目录布局

- `.codex-plugin/plugin.json`、`.mcp.json`——插件清单与 MCP 服务注册。
- `config.example.yaml`、`config.example.zh-CN.yaml`——完整 YAML 配置模板。
- `examples/config.example.minimal.yaml`（+ zh-CN）——单 Agent + 单 transport 快速上手模板。
- `scripts/`——daemon、各 Agent 适配器、通用 MCP 服务、自部署 relay、CLI 辅助脚本。
- `scripts/lib/`——共享模块（YAML 解析器、Legax 协议、runtime state、transport 管道）。
- `self-hosted-relay/`——独立 Linux Relay 安装器和服务文件。
- `skills/legax/`——给宿主 Agent 暴露的 MCP 技能文档。
- `tests/e2e/`——relay、Adapter、运行时状态的端到端测试。
- `docs/`——架构说明、功能边界、协议、发布流程、路线图、文档规范、隐私说明、使用条款。
- `.github/`——CI 工作流、贡献指南、安全策略、支持说明、行为准则。

## 配置

从 `config.example.zh-CN.yaml` 或 `config.example.yaml` 创建 `config.yaml`，也可以让 CLI 生成带随机密钥的本地配置：

```bash
legax init
```

项目不支持 JSON 配置。

> **`config.yaml` 严禁入库。** 该文件通常包含 Telegram bot token、relay 密钥或 webhook 密钥。`.gitignore` 已经将其排除；如果发现真实密钥意外出现在已跟踪文件中，请在推送前先轮换密钥。详见 [本机文件与密钥](#本机文件与密钥)。

如果同时运行 Codex、Claude Code、Gemini 和 OpenCode，请共用一个 `sessionId`，并为每个 Agent 设置稳定的 `agentId`；在 Telegram 或手机网页回复前先选择目标 Agent。

```yaml
sessionId: default
displayName: Desktop Agent

remote:
  enabled: true
  defaultMode: interactive
  pauseAll: false

approvals:
  enabled: true
  allowFromPhone: true
  timeoutMs: 300000
  defaultOnTimeout: deny

codex:
  enabled: true
  agentId: codex-cli
  agentLabel: Codex CLI
  cliBackend: app-server-ws
  useExisting: true
  appServerUrl: ws://127.0.0.1:18779/rpc
  sharedServerMode: connect-or-start
  autoStartSharedServer: true
  mcpEnabled: true
  mode: interactive

claude:
  enabled: true
  autoStart: true
  agentId: claude-code
  agentLabel: Claude Code
  supportsSessions: true
  cliBackend: stream-json
  useExisting: true
  continueLatest: true
  sessionListCwd: cwd
  mcpEnabled: true
  mcpAutoConfigure: true
  mcpRole: permission-prompt
  mode: approval-only

gemini:
  enabled: true
  autoStart: true
  agentId: gemini-cli
  agentLabel: Gemini CLI
  supportsSessions: true
  cliBackend: stream-json
  useExisting: true
  resumeExisting: latest
  sessionListArgs:
    - --list-sessions
  mcpEnabled: true
  mcpAutoConfigure: true
  mode: monitor

opencode:
  enabled: true
  autoStart: false
  agentId: opencode
  agentLabel: OpenCode
  supportsSessions: true
  cliBackend: server-http
  useExisting: true
  serverUrl: http://127.0.0.1:4096
  serverMode: connect-or-start
  mcpEnabled: false
  mode: monitor
```

模式说明：

- `interactive`：转发输出，接受手机文本，也接受手机权限决策。
- `approval-only`：转发输出和权限请求，但忽略手机文本。
- `monitor`：只转发输出。
- `paused`：忽略手机文本和权限决策，直到再次切换模式。

启动行为：

- `enabled: true` 表示该适配器会出现在手机或 Telegram 菜单中。
- `autoStart: true` 表示 daemon 启动时立即启动该适配器。
- `autoStart: false` 表示该适配器仍可被选择，但只有手机或 Telegram 操作指向它时才会按需启动。
- `mcpAutoConfigure: true` 表示启动 Claude Code 或 Gemini CLI 前自动写入所需 MCP 配置。Claude Code 使用配置的 `mcpConfigPath`；Gemini CLI 默认使用其 `cwd` 下的 `.gemini/settings.json`。OpenCode 当前通过 HTTP server 交互，暂不自动写 MCP 配置。
- `useExisting: true` 表示在 CLI 支持时复用已有历史目标。Codex 使用共享的 `codex app-server --listen ws://...` 后端，并通过 `app-server-ws` 连接；Claude Code 自动加 `--continue` 或 `--resume`；Gemini CLI 在未配置具体 `resumeSession` 时自动加 `--resume latest`；OpenCode 会通过 `/session/:id/message` 把文本发送到已选 server session。
- `supportsSessions: true` 会启用会话选择器。Claude Code 会从本地持久化项目历史中发现 sessions；Gemini CLI 会通过 `gemini --list-sessions` 获取 sessions；OpenCode 会通过 server API 获取 sessions。
- 如果希望 Codex CLI 本地可见同一段会话，请用 `codex --remote ws://127.0.0.1:18779` 启动 CLI。Codex 桌面 App 当前嵌入的是 stdio app-server，默认不暴露本地 control socket；本项目的本地多客户端路径使用共享 websocket 后端。
- `gemini.trustWorkspace: true` 是 Gemini CLI headless/daemon 运行所需配置，除非该目录已经在交互模式中被信任。只应对你愿意在 Gemini CLI 中信任的目录启用它。
- 从 Telegram 或手机页面选择 Claude Code / Gemini CLI / OpenCode 时，会激活 `interactive` 模式，并先返回 project/chat 选择器，再进入 session 列表。`paused` 仍是硬暂停，需要用 `/mode <agentId> interactive` 手动恢复。

Telegram 的新项目流程要求启用 relay transport，`relay.publicBaseUrl` 必须是公网 HTTPS 地址，且 `daemon.projectRoots` 至少包含一个可读目录。如果 relay 未启动、不是 HTTPS、只有 `localhost` / 内网地址可访问，或没有配置 project roots，daemon 会在 Telegram 中返回明确修复提示，而不是打开一个不可用的 Mini App。

普通 relay 消息在本地开发时可以使用私有 HTTP URL。Telegram Mini App 的 new project 选择器不行：它要求 `relay.publicBaseUrl` 是公网 `https://` URL。

## 自部署 Relay

Linux 服务器可以使用独立安装器：

```bash
cd self-hosted-relay
sudo ./install.sh
```

如果只想通过 npm 安装 relay：

```bash
npm install -g @legax/relay
legax-relay --config /path/to/relay.config.yaml
```

本地开发时 relay 从 `config.yaml` 的 `relay:` 段读取 `host` / `port` / `secret`（不涉及环境变量）。浏览器访问使用 daemon 生成的短配对码：

```yaml
relay:
  host: 127.0.0.1
  port: 8787
  publicBaseUrl: https://YOUR_RELAY_HOST
  secret: replace-with-a-long-random-secret
```

然后启动 relay：

```bash
node scripts/simple-relay-server.mjs
```

浏览器配对：

```bash
npm run daemon:pair
```

用手机扫描命令打印的二维码，或在浏览器打开 `http://YOUR_RELAY_HOST:8787/` 并手动输入一次性配对码。二维码包含短期有效的配对 offer，其中有 session id、pairing id、daemon 公钥元数据和 nonce；它不包含桌面端 relay secret。如果 relay 暴露到可信局域网之外，请使用 HTTPS。

健康检查：

```bash
legax doctor
legax doctor --json
```

`doctor` 会检查配置文件、relay 健康状态、Telegram 配置和已启用 adapter 的命令可用性，并且不会打印密钥。

## Legax 协议与 Worktree

跨 adapter 事件契约见 [Legax 协议](docs/LEGAX_PROTOCOL.zh-CN.md)。它统一 active context、审批请求、输入请求、摘要、session 列表和 attention item，使新增 adapter 不需要模拟某个特定 CLI 的原生输出。

本地 worktree helper 保持轻量：

```bash
legax worktree list
legax worktree create --name fix-approval --base HEAD
legax worktree check --name fix-approval -- npm test
legax worktree archive --name fix-approval --delete-branch
```

受管理的 worktree 创建在 `data/worktrees/` 下，归档命令会拒绝删除该目录之外的路径。

## Telegram

在 `config.yaml` 中启用 Telegram transport 并 inline 写入 `botToken` 与 `chatId`。项目不存在 `.env` 层，所有凭据都在 `config.yaml`（已 gitignore）里。

Telegram 出站噪声可以独立控制，不影响 relay 网页完整事件流。最终策略按
daemon 全局默认、CLI 自身默认、远端 transport 自身配置的顺序合并：

```yaml
daemon:
  notifications:
    telegram:
      messageDetail: important   # all | important | actionable | final | none

claude:
  notifications:
    telegram:
      messageDetail: actionable

transports:
  - name: telegram
    type: telegram
    notifications:
      maxMessageChars: 3900      # 低于 Telegram 4096 字符硬限制，给格式化留余量
      splitLongMessages: true
      maxParts: 8
      perAgent:
        gemini-cli:
          messageDetail: final
```

`important` 会推送权限请求、用户输入请求、菜单/状态操作、错误和最终结论。
`actionable` 只推需要回复或点击按钮的内容。`perAgent` 用于把通知覆盖规则限定到某个 CLI。长 Telegram 消息会用 HTML 格式美化并拆成多条 `sendMessage`；超过 `maxParts` 的部分会在最后一条里截断并提示。

常用命令：

```text
/start
/projects codex-cli
/sessions codex-cli
/sessions claude-code
/sessions gemini-cli
/sessions opencode
/use codex-cli 1
/new codex-cli
/new-project codex-cli
/mode codex-cli approval-only
/approve <requestId>
/deny <requestId>
/answer <requestId> <answer>
```

daemon 运行时由 daemon 自己负责 Telegram `getUpdates` 和 relay 入站轮询。各 adapter 只消费自己的 per-agent inbox，因此 `/start`、session 选择和按需启动不依赖 Codex 已经存活。

Telegram 使用链路：

1. `/start` 返回已启用/已安装的 CLI 适配器。
2. 点击 Codex、Claude Code、Gemini CLI 或 OpenCode 后返回该适配器的 project/chat 选择器。如果适配器尚未运行，daemon 会先启动它，并保留最初的 project-list 请求。
3. 点击某个 project/chat 后返回该范围内的 session 列表。`/sessions <agentId>` 也可以直接列出 session。
4. 点击某个 session 后完成选择，后续手机文本会进入对应 CLI/session。执行完成、权限请求和用户输入请求通知都会带 session/project 操作按钮，方便快速切换回来。
5. 点击 **New project** 或发送 `/new-project <agentId>` 会先做 relay 预检；通过后打开 Telegram Mini App 项目选择器，目录来自 daemon 本机配置的 `projectRoots`。

## Codex 双向可见性

Codex `app-server` 把 thread / turn 通知**广播给所有**连到同一后端的 WebSocket 客户端。要让手机触发的 turn 在本地 Codex TUI 里实时出现（同时本地 TUI 输入也能镜像回手机），daemon 与 TUI 必须接同一个 app-server。启动顺序很关键。

### 推荐配置（CLI TUI 模式）

默认 `codex.autoStart: false`——daemon 启动时**不会**拉起 codex 适配器。远端菜单和路由仍由 daemon 自己处理；共享 `codex app-server` 只在你**真的选择或消息发给 Codex**时才起来。这与项目整体的 on-demand 设计一致，也避免了"明明这次没用 codex 却留下后台进程"的尴尬。

1. 启动 daemon（此时还没碰 codex）：

   ```bash
   npm run daemon          # 前台，ctrl-C 停
   # 或：npm run daemon:bg
   ```

2. 另开一个终端，把 TUI 拉起来。TUI 先于手机消息启动；首次 turn 会触发共享后端：

   ```bash
   node scripts/codex-attach.mjs   # 读 config.yaml，跑 `codex --remote ws://...`
   ```

3. 发一条手机消息（或在 TUI 里直接键入）。第一次路由到 codex 的活动到来时，daemon 才拉起 codex 适配器，适配器再按 `sharedServerMode: connect-or-start` 处理 `appServerUrl`。**第一个**手机触发的 turn 因此延迟略高；之后就快了。

如果你希望 daemon 启动时就把共享后端拉起来（便于早期端口冲突诊断），把 `config.yaml` 里的 `codex.autoStart` 改回 `true`。

### 为什么桌面 App 现在做不到

Codex 桌面 App 为每个会话窗口内嵌一个 stdio app-server，且**不接受 `--remote` 参数**。当前没有任何已公开机制能让它与外部 WebSocket app-server 共享状态。OpenAI 正在搭建 `remote_control` 框架（在 `codex features list` 里能看到 `remote_control: under development`），但截至本次发布尚未进 stable。长线计划见 [docs/EXTENDING.md](docs/EXTENDING.md)。

### 桌面 App 用户的只读回退

如果你主用 Codex 桌面 App、手机端只需要**旁观**进度（不需要远程操作），启用可选适配器 `codexDesktopMirror`。它会 tail 桌面 App 的会话 JSONL，把用户消息、助手消息、命令执行、工具调用转发到手机。它**无法**把手机消息注入回桌面 App 会话——这是 Codex 自身的限制，不是 Legax 的。配置段见 `config.example.yaml`。

### 诊断 — TUI 不刷新

| 现象 | 常见成因 | 处理 |
| --- | --- | --- |
| 手机发了 turn，TUI 静默 | TUI 没用 `--remote` 启动（走的默认 stdio app-server）。两个并行 codex 后端，状态不共享。 | 停掉 TUI 改用 `codex --remote ws://...`，或用 `codex-attach`。 |
| daemon 打印 "WebSocket handshake failed" | 上一轮残留的 `codex app-server` 还占着端口。 | 用 `Stop-Process` / `kill` 终结孤儿进程，或换一个 `appServerUrl` 端口。 |
| TUI 能看到 turn，手机一直收不到 | TUI 发 turn 时 daemon 不在线，或 `routing.defaultTarget` 没设。 | 确认 daemon 在跑；查看 `data/runtime-state.json` 的游标。 |
| 手机点了审批按钮但本地没反应 | 适配器在请求与决策之间重启了，内存里的 `pendingApprovals` 丢了。 | 看 daemon stderr 是否有 `[legax] orphan permission_decision` 行；重新触发动作以拿到一份新提示。 |

## 运行适配器

daemon 用单进程监督所有启用的 Adapter。常用生命周期和配对命令打包成 npm 脚本，按需选用：

```bash
npm run daemon          # 前台运行，ctrl-C 停。改 config / 改代码迭代时用这个。
npm run daemon:bg       # 后台运行，pid 写到 data/daemon.pid，stderr 重定向到 data/daemon.err.log
npm run daemon:status   # 打印当前 pid（或 "not running"）后退出
npm run daemon:stop     # 停止 daemon 进程树并清理 pid 文件（5s 内不退出则升级）
npm run daemon:pair     # 为 relay Web UI 创建短期有效的浏览器配对码
```

为什么有 pid 文件。控制脚本会拒绝在已有活动 daemon 时再起一个（避免端口冲突、Telegram 重复 poll）。崩溃留下的陈旧 `data/daemon.pid`，下次启动时会用 `process.kill(pid, 0)` 探活并自动清掉。

日志位置。前台模式直接打到当前终端。后台模式追加到 `data/daemon.err.log`（不会自动轮转；长期跑请手动或用 `logrotate`）。各 Adapter 的 stderr 会带前缀（`[codex]`、`[claude]`、`[gemini]`、`[opencode]`）。

干跑（不拉起任何子进程，只打印解析后的配置）：

```bash
node scripts/legax-daemon.mjs --dry-run
```

不带 daemon 单独跑某个 Adapter（这种模式下不会按需拉起兄弟 CLI）：

```bash
node scripts/codex-app-server-link.mjs
node scripts/claude-code-link.mjs
node scripts/gemini-cli-link.mjs
node scripts/opencode-link.mjs
```

Codex 的本地双向可见性参见 [Codex 双向可见性](#codex-双向可见性)。Windows 上如果 PowerShell 执行策略阻止直接调用 `codex`，请把 `config.yaml` 中的 `codex.command` 设为 `codex.cmd`。

### 什么时候才真的需要系统服务

"开发机上挂着别管"用 `npm run daemon:bg` 就够了。如果想让它**重启后自动恢复**、由系统监督：

- **Linux**：参考 `self-hosted-relay/legax-relay.service` 自己写一份 unit。daemon 工作目录必须是仓库根，并通过 `LEGAX_CONFIG` 指向你的 `config.yaml`。当前没出对应 installer，要的话单独提需求。
- **macOS**：用 launchd plist 运行 `node scripts/legax-daemon.mjs`，`WorkingDirectory` 设到仓库根。
- **Windows**：用 NSSM 或任务计划程序。`npm run daemon:bg` 后台模式适合"登录后挂着"，但不能重启自动恢复。

## 权限模型

Legax 不会绕过原生安全提示。它会把权限请求同步到手机，收集决策，并通过可用的结构化路径返回决策：

- Codex：App Server JSON-RPC approval callback。
- Claude Code：permission prompt MCP tool。
- Gemini CLI：Gemini 自身的 approval mode；在支持时，MCP 能力工具仍可用于 Agent 主动发起的审批或输入请求。
- OpenCode：当前适配器通过 OpenCode HTTP server 发送 prompt 并读取 sessions。尚未实现 OpenCode 原生 permission callback 桥接，因此不要依赖手机端审批 OpenCode 原生权限提示。

手机权限决策只会在 `interactive` 和 `approval-only` 模式下生效。

## 测试

```bash
npm run ci
```

只运行 E2E：

```bash
npm run test:e2e
```

运行可选真实本地客户端检查：

```bash
LEGAX_REAL_CLIENTS=1 npm run test:e2e:real
```

测试覆盖 relay 鉴权和路由、MCP 发送和轮询、Codex 权限和用户输入请求、Claude permission MCP、Gemini stream-json 桥接、OpenCode server API 桥接、runtime state 持久化，以及并发适配器的 daemon 启动。

## CI

`npm run ci` 在本地与 [`.github/workflows/ci.yml`](.github/workflows/ci.yml) 中运行，矩阵为 Linux × Node 18 / 20 / 22，另加 Windows × Node 20 烟测。它先跑 `npm test`（`check:node`、`check:shell`、`test:e2e`），再跑 `check:docs`。可选的真实 CLI 套件（`LEGAX_REAL_CLIENTS=1 npm run test:e2e:real`）不进 CI，因为它需要本机有真实的 `codex`、`claude`、`gemini`。

## 参与贡献

欢迎围绕轻量、本地优先、Agent 中立的方向贡献代码。适合切入的方向包括新的结构化 CLI adapter、Telegram 和 relay 交互优化、自部署加固、跨平台 daemon 设置说明，以及聚焦的 E2E 覆盖。

提交 PR 前请先阅读 [贡献指南](.github/CONTRIBUTING.zh-CN.md)。文档和配置样例需要同时维护英文与简体中文版本，完整本地门禁是 `npm run ci`。

## 本机文件与密钥

仓库只跟踪模板和源码。下列运行期产物属于本机数据，必须留在版本控制之外，已经写入 `.gitignore`：

| 路径 | 内容 | 为什么不能入库 |
| --- | --- | --- |
| `config.yaml` | daemon、Adapter、relay 的实际配置。包含 relay 密钥、Telegram `botToken` / `chatId`、webhook URL——全部 inline。项目不存在 `.env` 层。 | 明文凭据 |
| `data/` | `runtime-state.json`、`relay-store.json`、`mcp-state.json`、`relay-audit.jsonl`、E2E 临时文件、daemon 日志 | 入站消息队列、relay event/message 队列、审计元数据、会话游标 |
| `.claude/settings.local.json` | 本机 Claude Code MCP 启用配置 | Anthropic 约定为 "local only"，可能包含工作区绝对路径 |
| `.gemini/settings.json` | `mcpAutoConfigure` 自动写入 | 含 `node` 可执行文件的绝对路径 |
| `/etc/legax-relay/config.yaml`（self-hosted-relay 安装后的位置） | 独立 relay 自己的配置（与项目根 yaml 同样使用 `relay:` 段） | 长随机 relay 密钥 |
| `*.secret`、`*.secret.*`、`secrets/` | 任何带外密钥文件 | 兜底规则，覆盖未来新增的密钥来源 |

一旦真实密钥落到已跟踪文件里（配置快照、日志粘贴、截图、提交说明等），**先在仓库之外轮换密钥**，再清洗对应文件。`npm run check:docs` 会扫描文档中的 Telegram bot token（`\d{8,}:[A-Za-z0-9_-]{30,}`）、OpenAI 风格密钥（`sk-...`）、GitHub PAT（`gh[pousr]_...`），推送前请先跑一遍。

如需共享配置模板，使用仓库内已有的 `*.example.*` 文件对（如 `config.example.yaml`、`config.example.zh-CN.yaml`），不要把填好真实数据的副本入库。

## 文档规范

文档按语言拆分：

- 英文：`*.md`
- 简体中文：`*.zh-CN.md`

除简短互链外，不要在同一篇正文文档中混写中英文。所有文档文件必须使用 UTF-8 无 BOM。见 [文档规范](docs/DOCUMENTATION.zh-CN.md)。
