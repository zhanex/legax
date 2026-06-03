# 功能边界

[English](FUNCTIONAL_BOUNDARIES.md) | 简体中文


## 产品边界

Legax 管理 Agent CLI 的跨设备 session 路由、任务身份、远端交互、审批决策、任务交接和受控工作流步骤。

职责边界：

- 进程生命周期归 daemon 和 adapter。
- 远端交互归 relay、Telegram、飞书/Lark、浏览器和 webhook 通道。
- MCP 工具只在宿主 Agent 显式调用时提供能力。
- 原生 CLI 安全策略仍是审批决策的权威边界。
- 多用户 SaaS 托管、托管式 Agent 执行和终端 UI 自动化不属于项目范围。

## 参与角色

- 操作者：拥有一台或多台工作站，负责配置密钥、启动 relay 和 daemon hosts、配对浏览器设备。
- 远端用户：通过 relay 网页、Telegram bot 或飞书/Lark 应用 bot 选择会话目标并发送动作。
- Daemon：监管某台执行主机上已启用的 CLI adapter，轮询入站通道，路由消息，并创建按需启动请求。多台 daemon host 可以连接同一个 relay。
- Adapter：负责一个 CLI 进程和该 CLI 的 session 模型。它列出项目/session、启动或恢复 session、把文本送入 CLI、解析结构化输出，并在 CLI 暴露受支持回调时镜像原生权限请求。
- Relay：保存事件、入站消息、配对码、已配对设备、主机记录和审计记录，支持一个或多个 `sessionId`。
- Telegram transport：格式化出站通知；启用 relay 时，由 relay 把入站消息和 inline 按钮转换成与浏览器 UI 相同的消息模型。
- 飞书/Lark transport：格式化自建应用 bot 出站通知，并让 relay 把事件回调转换成浏览器 UI 使用的同一套消息模型。
- MCP server：暴露通知、轮询和权限工具。它不负责启动或停止 CLI 进程。

## 数据归属

- `config.yaml`：本机操作者配置。保存 relay URL、relay secret、Telegram bot token、飞书/Lark 应用凭据、webhook URL 和 adapter 设置。
- `data/runtime-state.json`：daemon 与 adapter 的协同状态。保存游标、已选 session、模式、inbox 队列和启动请求。它是本地运行时协同状态，不是可迁移 relay session 的事实来源。
- `data/relay-store.json`：relay 拥有的状态，使用 `legax.relay/1` schema。保存 sessions、generations、leases、handoffs、hosts、devices、transports、inbox、commands、metadata events、artifacts、workflow definitions/runs、legacy event/message 队列、配对码和浏览器配对状态。它是跨设备可迁移任务/session 身份的事实来源；CLI 原生历史仍归 adapter 和对应 CLI。
- `data/mcp-state.json`：通用 MCP 工具状态。
- CLI 原生历史：受支持的 Agent CLI 各自拥有 session 历史。Legax 只通过各 CLI 支持的接口读取或恢复。

## 鉴权边界

桌面侧 relay API 使用 `x-legax-secret`。这些 API 面向 daemon、adapter 和桌面配对命令：

- `POST /api/events`
- `GET /api/messages`
- `POST /api/sessions`
- `GET /api/sessions/:id`
- `POST /api/generations`
- `GET /api/generations/:id`
- `POST /api/generations/:id/update`
- `POST /api/generations/:id/fork`
- `POST /api/leases/claim`
- `GET /api/leases/:id`
- `POST /api/leases/:id/renew`
- `POST /api/leases/:id/release`
- `POST /api/handoffs`
- `GET /api/handoffs/:id`
- `POST /api/handoffs/:id/transition`
- `POST /api/artifacts`
- `GET /api/artifacts/:id`
- `POST /api/workflow-definitions`
- `GET /api/workflow-definitions/:id`
- `GET /api/workflow-actions`
- `POST /api/workflow-runs`
- `GET /api/workflow-runs/:id`
- `POST /api/workflow-runs/:id/steps/:stepId/result`
- `POST /api/workflow-runs/:id/gates/:stepId`
- `POST /api/workflow-runs/:id/cancel`
- `POST /api/hosts`
- `GET /api/hosts`
- `POST /api/commands`
- `GET /api/commands`
- `GET /api/commands/:id`
- `POST /api/commands/:id/claim`
- `POST /api/commands/:id/result`
- `POST /api/pairing-codes`
- `GET /api/devices`
- `DELETE /api/devices/:id`
- `GET /api/audit`

浏览器侧 relay API 只使用已配对的 `legax_device` HttpOnly cookie：

- `GET /api/events`
- `GET /api/agents`
- `GET /api/attention`
- `POST /api/attention/ack`
- `POST /api/messages`
- `POST /api/logout`

浏览器不使用 URL token，也不要求用户记忆共享 token。配对从桌面端发起，生成一次性短码，在浏览器端完成。撤销设备会让服务端不再信任该浏览器 cookie。

## 业务流程

### 1. 安装与配置

目标：得到一个本地 `config.yaml` 和一个可访问的 relay。

1. 操作者把 `config.example.yaml` 复制为 `config.yaml`。
2. 操作者设置 `relay.baseUrl` 和 `relay.secret`，用于桌面到 relay 的通信。
3. 操作者在 `codex`、`claude`、`gemini`、`opencode` 下启用需要的 adapter。
4. 如需 Telegram，操作者设置 `botToken`、`chatId` 和通知策略。
5. 如需飞书/Lark，操作者设置 `appId`、`appSecret`、`receiveId`、`verificationToken` 和通知策略。
6. 操作者启动 relay 和 daemon。

闭环标准：`node scripts/legax-daemon.mjs --status` 能输出已启用的 transport 和 adapter，relay `/health` 可访问。

### 2. 浏览器配对

目标：让浏览器获得访问权，同时不暴露 relay secret。

1. 操作者运行 `npm run daemon:pair`。
2. 桌面端携带 relay secret 调用 `POST /api/pairing-codes`。
3. Relay 保存短时有效的配对码哈希，并向桌面端返回协议化 pairing offer 与二维码载荷。offer 包含 session id、pairing id、pairing secret、daemon 公钥元数据、nonce、过期时间和功能标记。
4. 桌面端打印二维码和一次性配对码。
5. 用户用手机扫描二维码，或打开 relay 根地址并手动输入配对码。
6. 用户点击 **Pair browser**。
7. 浏览器调用 `POST /api/pair`；Web Crypto 可用时还会发送临时浏览器公钥。relay 校验 offer 或手动配对码，并写入 `legax_device` cookie。
8. 浏览器跳转到 `/`，进入会话页面。

闭环标准：浏览器可以读取事件、列出 Agent、向对应 `sessionId` 投递消息。

### 2A. 查看 Attention Inbox

目标：让浏览器、Telegram 和飞书/Lark 共享同一套待处理事项模型，避免各自重复拼接逻辑。

1. Adapter 写入审批、输入、错误、完成和 active-context 事件。
2. Relay 从这些事件推导 attention items，并暴露 `GET /api/attention`。
3. 浏览器或后续 PWA 读取 inbox，并按当前 CLI/project/session 组织展示。
4. 用户处理或忽略某个事项。
5. 浏览器调用 `POST /api/attention/ack`，携带已处理的 item id。

闭环标准：未处理的审批、输入提示、错误和最近完成摘要能在一个 inbox 中看到，并且可以按已配对设备单独确认。

### 3. 启动 Daemon

目标：集中处理生命周期和远端入站路由。

1. 操作者启动 `node scripts/legax-daemon.mjs` 或项目 daemon 脚本。
2. Daemon 读取 `config.yaml`，校验适配器契约，并输出已脱敏的通道摘要。
3. Daemon 启动 `autoStart: true` 的适配器。
4. Relay 负责 Telegram `getUpdates` 轮询或 `/api/telegram/events` webhook，以及飞书/Lark 回调，然后把归一化后的动作写入 `/api/messages`。
5. Daemon 轮询 relay `/api/messages`，并把入站消息按目标写入每个 Agent 的收件箱。
6. Daemon 向 `/api/hosts` 发送心跳，携带 host id、groups、已启用适配器元数据和支持的命令引用。
7. Daemon 轮询 relay `/api/commands`，认领符合条件且在白名单内的命令，在本机执行安全内置动作，并用当前 claim token 上报终态结果。LPS TDD 动作把软件开发拆成工程步骤，并以文档和验收证据作为输入；它不暴露任意远程 shell 执行，且在可能修改工作区文件时必须持有 generation lease。
8. 如果用户选择的适配器尚未运行且 `daemon.launchOnDemand` 已启用，daemon 会记录启动请求并启动该适配器。

闭环标准：即使某个 CLI 适配器尚未启动，远端菜单动作也能触发它按需启动，并且 relay 可以观察 daemon host 的存活状态和命令队列进度。

### 3A. 管理可迁移会话

目标：让面向用户的任务身份可以跨主机迁移，同时把 CLI 原生 session id 留作适配器专属元数据。

1. Relay 通过 `POST /api/sessions` 创建或更新稳定会话。
2. Relay 通过 `POST /api/generations` 创建 generation。generation 记录主机、适配器、CLI 原生元数据、worktree 元数据、checkpoint 元数据和结果状态。
3. daemon host 通过 `POST /api/leases/claim` 认领执行权。
4. lease 持有者用当前 `hostId`、`fencingToken` 和 `leaseToken` 续租或释放 lease。
5. generation 更新必须来自当前 lease 持有者。过期 fencing token 返回 `409`。
6. handoff 按 `requested -> checkpointed -> uploaded -> released -> claimed -> restored -> resumed` 记录，也可以进入 `failed`。
7. fork 从既有 generation checkpoint 创建子 generation，且不修改父 generation。

闭环标准：relay 可以展示可迁移会话 id、当前 generation、lease 持有者、handoff 历史和 fork lineage，而不会把 CLI 原生 id 当作主要身份。

### 4. 在 Relay 网页中选择机器、CLI、项目和 Session

目标：每条出站消息都有明确目标。

当前机器显示在顶部连接状态控件中，包含机器名和明确的 Online/Offline 文本。点击后打开机器选择器。在线机器可以成为当前目标；离线机器保留用于诊断，但不能接收新的浏览器消息。

- **CLI 区域**：显示所选机器报告的所有支持 CLI adapter，包括尚未启动的 adapter。选择 CLI 后设置当前 CLI，向该机器的 adapter 请求 session 列表，然后打开 project 选择器。
- **Project 区域**：展示当前 CLI 下已知的 project/chat。**Chats** 始终存在，作为直接对话范围；没有项目元数据的 session 归到 **Chats** 下；Claude 只有 cwd、没有显式 project 元数据的历史也会出现在 **Chats** 下，方便从手机继续普通 Claude 对话；Codex app-server session 如果没有显式 project id 或 project name，也归到 **Chats** 下；OpenCode session 在 server 返回 cwd/project path 时按项目展示，否则归到 **Chats** 下。选择 project/chat 后设置范围，并进入 session 选择。没有项目上下文时，**Load sessions** 会请求适配器列出 session。
- **Session 区域**：展示当前 CLI 与 project 下的 session。选择后投递 `select_session`，后续文本进入该 session。已归档 session 不显示；列表每页最多 10 条，超过后显示 **Previous** / **Next** 翻页按钮。

选择器动作按钮：

- **Refresh CLI list**：向 daemon 投递 `list_agents`。
- **Load sessions**：为当前 CLI 投递 `list_agent_sessions`。
- **Refresh sessions**：为当前 CLI 以及已知项目上下文投递 `list_agent_sessions`。
- **New session**：为当前 CLI 投递 `new_session`。

闭环标准：只有存在 CLI 目标时输入框才可用；用户选择 session 后，具备 session 能力的适配器会先收到 `select_session`，再接收普通文本。

### 5. 在 Relay 网页阅读与回复

目标：保持远端对话清晰，同时保留底层 Agent 事件。

1. Relay 事件按 CLI、项目、session 分组展示。
2. 状态、普通消息、权限请求、用户输入请求有不同的视觉样式。
3. 可见消息体去除重复 transport 头部，项目/session 上下文放在周围 UI 中。
4. 用户在回复框输入文本并点击 **Send**。
5. 浏览器发送 `POST /api/messages`，包含 `targetHostId`、`targetAgentId` 和文本。
6. Daemon 把消息路由到已选 adapter。
7. Adapter 把文本送入当前 CLI/session，并把新事件写回 relay。

闭环标准：回复进入选中的 CLI/session，Agent 输出再回到 relay 页面。

### 6. 同意或拒绝权限请求

目标：在所选 adapter 暴露受支持回调时，镜像 CLI 原生审批，并保持原生审批边界。

1. Adapter 从 CLI 收到原生权限回调。
2. Adapter 写入 `permission_request` 事件，包含 request id、标题、目标 Agent 和上下文。
3. Relay 网页展示 **Approve** 和 **Deny** 按钮。
4. 启用 Telegram 时，Telegram 消息展示 inline **Approve** 和 **Deny** 按钮。
5. 启用飞书/Lark 时，飞书/Lark 显示带 **Approve** 和 **Deny** 按钮的交互卡片。
6. 用户点击其中一个动作。
7. Relay、Telegram 或飞书/Lark 发送 `permission_decision` 消息，消息保留 host、adapter 和 request id。
8. Adapter 等待该决定，并通过 CLI 原生审批通道返回。

闭环标准：CLI 通过自己的结构化回调收到明确的同意或拒绝。没有原生回调的 adapter（例如当前 OpenCode bridge）不得声称支持手机端审批。

### 7. 回答用户输入请求

目标：让 Agent 在缺少信息时可以远端询问用户。

1. Adapter 或 MCP 工具写入 `user_input_request` 事件，包含 request id 和问题。
2. Relay 页面展示输入请求和上下文。
3. Telegram 消息包含 `/answer <requestId> <answer>` 提示。
4. 用户通过 relay 输入框、Telegram 命令或飞书/Lark chat 回答。
5. Adapter 收到 `user_input_response`，返回给等待中的 CLI 或工具调用。

闭环标准：被阻塞的 Agent 操作用用户答案继续执行。

### 8. 使用 Telegram

目标：不打开浏览器也能完成同样的目标选择和动作闭环。

主按钮流程：

1. 用户发送 `/start`。
2. Relay 接收 Telegram update，校验允许的 chat，去重，将其归一化写入 `/api/messages`，并在需要时确认 callback query。
3. Daemon 路由归一化消息，并把状态/菜单事件写回 relay。
4. Relay 将这些事件分发到 Telegram，因此 bot 会返回已启用的 CLI 按钮。
5. 用户点击某个 CLI。Daemon 在需要时启动适配器，并通过同一条 relay 分发路径返回 project/chat 按钮。
6. 用户点击某个 project/chat。Adapter 返回该范围内的 session 按钮；已归档 session 不显示；没有项目元数据的 session 显示在 **Chats** 下；Claude cwd-only session 也会出现在 **Chats** 下；Codex app-server session 在没有显式 project 元数据时也显示在 **Chats** 下；OpenCode session 在 server 返回 cwd/project metadata 时按项目展示。超过 10 条时，回复包含 **Previous** / **Next** 翻页按钮。
7. 用户点击某个 session。Adapter 标记该 session 为当前选择。
8. 用户发送普通文本。Daemon 路由到已选 CLI/session。
9. Adapter 把完成结果、已支持的权限请求和用户输入请求通过 relay 拥有的 Telegram 投递发回。

支持的命令流程：

- `/start`、`/agents`、`/menu`：展示 CLI 按钮。
- `/projects <agentId>` 或 `/chats <agentId>`：展示 project/chat 选择。
- `/sessions <agentId> [projectRef]`：展示 session。
- `/use <agentId> <sessionRef>`：选择 session。
- `/new <agentId>`：新建 session。
- `/to <agentId> <text>`：发送一次定向消息。
- `/mode <agentId> interactive|approval-only|monitor|paused`：切换 adapter 模式。
- `/approve <requestId>` 与 `/deny <requestId>`：回复权限请求。
- `/answer <requestId> <answer>`：回复用户输入请求。

闭环标准：完整 Telegram 路径可以从没有活跃 adapter 开始，完成 CLI、project/chat、session 选择，发送文本并收到 CLI 回复。

### 8A. 通过 Telegram Mini App 打开新项目

目标：让 Telegram 用户可以打开一个本机新项目，同时不让 relay 直接暴露任意文件系统访问。

1. project/chat 菜单中显示 **New project**。它首先是一条普通 Telegram 回调，不是直接打开 Web App 的按钮。
2. daemon 先做 relay 预检：必须存在启用的 relay transport，`relay.publicBaseUrl` 必须是公网 HTTPS 地址，relay `/healthz` 必须可访问，且 `daemon.projectRoots` 至少包含一个可读的本机目录。
3. 如果预检失败，daemon 在 Telegram 中返回明确原因和修复步骤。例如缺少 `relay.publicBaseUrl`、URL 不是 HTTPS、使用 localhost/内网地址导致手机不可访问、relay 不可达，或没有配置 project roots。
4. 如果预检通过，daemon 向 relay 申请短期 TWA 启动令牌，并发送 **Open project picker** Web App 按钮。
5. TWA 使用该短期令牌鉴权。用户不需要记忆 token，桌面端 relay secret 也不会暴露给浏览器。
6. TWA 向 relay 请求目录子项。relay 将 `list_project_children` 控制消息排队给 `legax-daemon`；daemon 从配置的本机 `projectRoots` 列目录，解析真实路径，过滤隐藏目录，并拒绝越过 root 的路径。
7. 用户选择文件夹并点击 **Open this folder**。relay 将 `open_project` 排队给 `legax-daemon`。
8. daemon 再次校验路径，然后把请求转换成目标 adapter 的 `new_session`，并附带 `projectPath`。
9. adapter 在该项目 cwd 下选择一个新 session。Codex 会以 cwd 创建 thread；Claude、Gemini 和 OpenCode 会把内存中的 cwd 切到该目录，用于下一次新 session/turn。

闭环标准：当前 CLI 收到 project-scoped 的新 session 请求，Telegram/Web App 用户能看到明确成功或失败状态。

### 8B. 使用飞书/Lark

目标：为使用飞书中国区或 Lark 国际区的团队提供企业聊天入口。

1. 操作者配置飞书/Lark 自建应用 bot 和事件订阅 URL。
2. Adapter 通过应用 bot 发送状态、完成、受支持的审批和输入请求通知。
3. 权限请求显示为带 **Approve** 和 **Deny** 按钮的交互卡片。
4. 飞书/Lark 向 `/api/feishu/events` 投递事件回调；relay 校验 `verificationToken`。
5. Relay 把文本回复和卡片动作写入普通 relay message 队列。
6. Daemon 轮询 relay `/api/messages` 并把消息路由给目标 adapter。

闭环标准：飞书/Lark 可以投递文本回复和审批决策，同时不绕过 CLI 原生审批回调。

### 9. 离线与恢复

目标：故障状态必须能指导下一步操作。

Relay 网页状态行为：

- **Connecting**：首次事件轮询尚未完成。
- **Online** 或最近状态文本：relay 轮询正常。
- **Auth required**：浏览器未配对或设备已撤销；使用 `npm run daemon:pair` 重新配对。
- **Offline**：relay 可访问，但 daemon/adapter 没有产生事件，或轮询失败。点击 **Offline** 会展开 daemon 启动和配置检查提示。

恢复流程：

1. 检查 `config.yaml` 中的 relay URL 和 secret。
2. 检查浏览器配对状态。
3. 启动或重启 daemon。
4. 使用 **Refresh CLI list** 或 `/start` 确认 daemon 可以路由远端动作。
5. 使用 **Load sessions** 或 `/sessions <agentId>` 确认目标 adapter 可以响应。

闭环标准：远端目标选择和消息发送都恢复可用。

## 组件职责边界

- Daemon 负责进程监管、远端轮询、按需启动和跨 Agent 路由。
- Adapter 负责 CLI 命令行、结构化输出解析、session 发现、session 选择和可用时的原生权限回调。
- Relay 负责 HTTP 鉴权、事件/消息队列、浏览器 UI、协议化配对信息、设备、待办收件箱推导和审计。
- Relay 接管的 Telegram 通道负责 Telegram API 格式化、轮询/webhook 入站、回调解析、回调确认和事件分发，不负责适配器生命周期。
- 飞书/Lark transport 负责应用 bot 格式化和 relay 事件回调解析，不负责 adapter 生命周期。
- MCP 负责暴露工具能力，不负责 daemon 生命周期或 session 选择。
- `legax` CLI 负责本地初始化诊断和受管理 worktree helper 命令。
- 文档负责面向操作者的契约：配置、架构、功能行为、隐私和条款。

## 验收清单

- 新操作者可以根据示例配置 relay、Telegram 或飞书/Lark，以及至少一个 CLI。
- 浏览器可以在不共享、不记忆 token 的情况下完成配对。
- Pairing offer 携带 session/key/nonce 元数据，同时不把桌面端 relay secret 暴露给浏览器。
- Attention inbox 可以展示并确认审批、输入、错误和完成事项。
- Relay 网页可以通过三个可点击目标分段选择 CLI/project/session。
- Telegram 可以完成 `/start -> relay 归一化消息 -> CLI -> project/chat -> session -> text -> relay 拥有的 response`。
- Telegram Mini App 只有在 relay HTTPS 与 daemon project-root 预检通过后，才会打开项目选择器。
- 飞书/Lark 可以发送应用 bot 通知，并把文本回复或审批卡片动作经 relay `/api/messages` 路由回来。
- 权限请求在 adapter 支持原生回调时必须有明确的远端决定，并通过 CLI 原生回调返回。
- 用户输入请求可以远端回答，并解除等待中的操作。
- 未运行的 adapter 可以被 daemon 按需启动。
- Daemon 会注册为 relay host，心跳过期后变为 offline，并且只执行已知的 relay 命令引用，结果通过 claim token 上报。`pr.create` 是可选能力，默认禁用，并且必须先创建 draft。
- Portable sessions、generations、leases、handoffs 和 forks 保存在 relay 状态中；过期 fencing token 不能修改 active generation。
- 离线和鉴权失败都能给出明确下一步操作。
