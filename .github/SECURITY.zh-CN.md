# 安全策略

[English](SECURITY.md) | 简体中文

Legax 把桌面端编码 Agent 与手机连起来，包括对 Shell 命令和补丁的审批决策。请按"开发流程中的敏感组件"看待它。

## 威胁模型

| 资产 | 风险 | 项目内的缓解 |
| --- | --- | --- |
| Telegram bot token | bot 聊天通道完全被接管；可在手机端冒充桌面 Agent | inline 存放在 `config.yaml`（已 gitignore），不存在 `.env` 层；redact 规则扫描出站文本捕捉意外泄露 |
| 飞书/Lark app secret 与 verification token | 暴露后可用配置的应用 bot 发消息，或伪造入站回调 | inline 存放在 `config.yaml`（已 gitignore）；不要把真实值写进文档、日志或 issue payload |
| Self-hosted relay 桌面密钥 | 持有者可作为桌面身份发事件、读取手机回复 | 常量时间比较；`config.yaml` 中 `relay.secret` 为空时拒绝启动，除非显式 `relay.allowInsecureDev: true`，此时 relay 仅绑定 `127.0.0.1` |
| 已配对浏览器设备 cookie | 持有有效设备 cookie 的人可以读取该浏览器会话的 relay 流量，并提交手机侧回复或审批 | 浏览器通过 daemon 生成的一次性配对码接入；设备 token 只以 relay secret 派生哈希形式保存，可在 relay 设备列表中撤销 |
| 审批管道（Codex JSON-RPC、Claude permission MCP、Gemini 审批模式） | 自动放行危险命令 | 决策只镜像、不绕过；`paused` 与 `monitor` 模式硬阻断手机端审批 |
| `data/` 运行期文件（runtime-state、relay-store、mcp-state、relay-audit） | 会话游标、relay 消息队列、已配对设备元数据、workflow 元数据和审计元数据泄漏 | 仅本机文件系统；已 gitignore；与 `config.yaml` 同一信任域 |

明确不防御以下场景：

- 桌面被攻陷。Relay 进程与各 Agent CLI 以当前用户权限运行；该用户被攻陷后，所有审批决策都可能在源头被伪造。
- Telegram、飞书/Lark 或 webhook 服务方被攻陷。
- 手机或浏览器被攻陷且 relay 设备仍处于配对状态。请先在 relay 设备列表撤销该浏览器设备；如果怀疑桌面密钥或 relay store 也泄漏，再轮换 `relay.secret`。
- 没有 TLS 终结的情况下，relay 暴露到本机以外时的网络层窃听。

## 运维加固清单

- Relay 暴露到 `localhost` 之外时，前置 TLS 终结（nginx / Caddy / Cloudflare Tunnel）。
- 把 `relay.secret` 设成长随机值（`openssl rand -base64 36`），且只保存在桌面端 / daemon 侧。
- 使用 `npm run daemon:pair` 配对浏览器；不要把一次性配对码转发给目标设备以外的人。
- 对丢失、共用或过期的浏览器设备，在 relay 设备列表中撤销。
- 桌面侧 relay API 优先使用请求头 `X-Legax-Secret`。不要把密钥放在 URL 里；query string 会进入反向代理日志和浏览器历史。
- 保持 `security.redactByDefault: true`，新增密钥形态时检视一遍。默认规则覆盖 OpenAI / Anthropic / GitHub / AWS / Slack / Telegram / 通用 `key=value`。
- 不要在临时本地测试以外开 `relay.allowInsecureDev: true`。开启后 relay 仅绑定 `127.0.0.1` 并打印启动警告，但任何能访问回环接口的进程都会被无认证放行（在共享开发主机上可能比你想得多）。
- 把 `tests/e2e/real-clients.e2e.mjs` 视为特权测试：它会用你本地凭证拉起真实的 `codex`、`claude`、`gemini` 进程。
- 不要把 `config.yaml`、`.claude/settings.local.json`、`.gemini/settings.json`、`data/` 下任何内容入库。`.gitignore` 已覆盖；`npm run check:docs` 还会扫描已跟踪文档里是否含 Telegram bot token、OpenAI 风格密钥、GitHub PAT。

## 漏洞上报

请**不要**通过公开 GitHub issue 上报安全问题。

优先使用本仓库的 GitHub private vulnerability reporting。若仓库尚未启用该功能，请先通过仓库 owner 的 GitHub profile 联系维护者，确认私密披露渠道后再发送利用细节。请提供：

- 问题描述与受影响的文件路径。
- 最小化复现（命令、payload、测试用例）。
- 你对影响的判断（机密性 / 完整性 / 可用性）。
- 是否愿意在最终披露中署名。

我们承诺 5 个工作日内确认收到，对高严重度问题在 30 天内修复或缓解。协调披露时间可商议。

## 已公开追踪的局限

- Relay 审计是面向元数据的本机 append-only 日志，不是远程设备或会话撤销系统；如果不能接受元数据保留，请调整 `relay.audit.textPreview` 或关闭审计。
- 浏览器设备撤销只在 relay 本地生效。它会让 relay store 中的浏览器设备 cookie 失效，但不会轮换 `relay.secret`，也不会轮换 Telegram 或飞书/Lark 等第三方 transport 凭据。
- 跨进程状态使用 lockfile 协调（`scripts/lib/runtime-state.mjs`）；崩溃残留的 lockfile 会在有界重试后被恢复，但不会被外部清理任务清掉。

这些被作为项目局限而非漏洞跟踪；如果你能演示其可被利用，请通过上文描述的私密漏洞上报流程提交。
