# 隐私说明

[English](PRIVACY.md) | 简体中文

Legax 是一个用户自行安装的工具，项目作者不运营任何托管后端。本说明描述软件处理的数据、流向、以及作为运维者与手机端用户你拥有的选择。

## 角色

- **运维者**：安装桌面 daemon、配置 transport 的人。数据流向由运维者决定。
- **手机端用户**：接收通知、回复或审批的人。手机端用户通常就是运维者本人。
- **维护者**：本软件的作者与贡献者。除非运维者主动共享（例如在 bug 报告中），维护者无法接触运维者数据。

## 软件处理的数据

软件在运维者机器上以及传向配置好的 transport 时会处理以下数据：

| 数据 | 来源 | 流向 |
| --- | --- | --- |
| Agent stdout/stderr 文本（助手消息、工具输出） | 本机 CLI Agent（Codex / Claude Code / Gemini CLI） | 已启用的 transport：self-hosted relay、Telegram Bot API、飞书/Lark 自建应用 bot、webhook URL |
| 审批请求（命令、工作目录、说明） | Agent 提供的回调 | 同上 |
| 手机端回复（文本与审批决策） | 手机客户端经 relay、Telegram 或飞书/Lark | 返回给桌面 Agent |
| 会话元数据（session id、agent id、thread id、mode、游标） | 本机 runtime state | 存放在 `data/runtime-state.json`；仅在路由必要时进入 transport 载荷 |
| Telegram bot token、飞书/Lark app secret、飞书/Lark verification token、relay 密钥、已配对浏览器设备 cookie | 运维者配置与 relay 配对流程 | 第三方应用凭据与 relay 密钥 inline 存放在运维者已被 gitignore 的 YAML 配置中（`config.yaml` 或 `/etc/legax-relay/config.yaml`）；已配对浏览器设备哈希存放在 relay store 中，并且只以 cookie 形式发送给你的 relay |
| Relay 队列、配对状态与 workflow 元数据 | 经过 self-hosted relay 的 Agent 与手机流量 | 存放在 `relay.storePath` 的 `legax.relay/1` relay store；启用审计时追加到 `relay.audit.path`。审计默认记录元数据和可配置的短文本预览，不记录完整消息正文 |

软件**不会**把数据发回给项目维护者。没有遥测、统计、崩溃上报、更新探测。

## 存储

- daemon 和 MCP 的持久化状态默认位于运维者本地文件系统的 `data/` 下（可通过 `runtimeStatePath`、`storagePath` 配置）。
- 开发用 relay 默认把 `legax.relay/1` store 写到 `./data/relay-store.json`；独立部署 relay 默认写到 `/var/lib/legax-relay/relay-store.json`。两者都可通过 `relay.storePath` 修改。
- relay 审计启用后是 append-only，会把元数据写入 `relay.audit.path`；`relay.audit.textPreview` 默认为 `0`，显式开启的预览写入前会先做脱敏。
- 默认不会单独写日志；如果运维者把 stderr 重定向到文件，该文件可能包含状态行和错误栈（默认不含消息正文）。

## 第三方 transport

运维者启用某个 transport 时，消息正文和元数据会流向该第三方：

- **Telegram Bot API**：受 [Telegram 隐私策略](https://telegram.org/privacy)约束。Telegram 会获得 bot token、chat id、消息正文、行内按钮回调。
- **飞书/Lark**：受相应飞书或 Lark 服务条款与隐私政策约束。飞书/Lark 会在 token 交换时获得应用凭据，并获得 receive id、消息正文和交互卡片回调 value。
- **Webhook**：由运维者提供 URL，接收方看到的载荷与 relay 接到的相同。
- **Self-hosted relay**：除非运维者把 relay 对外暴露，否则数据不离开你的基础设施。维护者不为你运行任何 relay。

## Redact

MCP 服务器默认对出站文本做正则脱敏（`security.redactByDefault: true`）。脱敏是护栏不是保证——运维者仍应自行审视消息，避免把密钥粘贴到 Agent prompt 里。需要时可在单次调用中关闭（`allowSensitive: true`）。

## 运维者可选项

- 在 `config.yaml` 把 `enabled: false` 关掉任意 transport。
- 通过 [@BotFather](https://t.me/BotFather) 轮换 Telegram bot token；在开发者后台轮换飞书/Lark app secret 与 verification token；relay 密钥通过编辑 YAML 配置并重启 relay 来轮换；已配对浏览器设备可从 relay 设备列表撤销。
- daemon 停止后删除 `data/` 即可清空本机状态。
- 自部署 relay 以保证数据留在自有基础设施。

## 手机端用户可选项

- 哪台手机、浏览器、Telegram chat 或飞书/Lark chat 收通知由运维者决定。如果你收到了未授权的会话通知，请联系运维者撤销已配对浏览器设备、Telegram chat 或飞书/Lark 应用配置。
- 手机端回复与审批决策会保存在 relay 队列中，直到有界保留策略淘汰旧条目。桌面端通过 cursor 避免轮询后重复处理旧消息。它们也可能按桌面 Agent 自身的数据处理策略出现在 Agent 会话历史里。

## 儿童数据

Legax 是开发者工具，不面向未成年人，也不会主动处理儿童数据。

## 本说明的变更

本说明描述软件当前行为。行为变化时本文件在同一次提交中改动，无单独通知机制——请通过仓库历史跟踪变更。

## 联系方式

不涉及敏感信息的隐私问题请使用仓库 issue tracker。安全问题请改走 [`SECURITY.zh-CN.md`](../.github/SECURITY.zh-CN.md) 而非本说明。
