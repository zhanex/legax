# AI 安装配置指南

[English](AI_INSTALL.md) | 简体中文

本指南面向为人类操作者安装 Legax 的 AI 助手或自动化 agent。请把它当作执行清单使用。不要自行编造缺失的密钥、域名、chat id 或基础设施决策。

面向人的完整操作路径见[用户操作手册](USER_MANUAL.zh-CN.md)。内部设计见[架构文档](ARCHITECTURE.zh-CN.md)、[安全策略](../.github/SECURITY.zh-CN.md)、[隐私说明](PRIVACY.zh-CN.md)和[配置示例](../config.example.zh-CN.yaml)。

## 执行规则

- 不要打印真实 token、relay secret、webhook secret、cookie 或完整私有配置文件。
- 不要提交 `config.yaml`、运行时 `data/`、日志、本地 package tarball 或生成的机器配置。
- 只使用 YAML。项目刻意不支持 JSON 配置。
- 把运行时状态放在 `LEGAX_HOME` 或其他由操作者拥有且被忽略的路径下。
- 创建 DNS 记录、暴露端口、轮换密钥、修改 npm auth、选择 Telegram 目标 chat 前，必须停下来询问操作者。
- 只有本指南里的验证信号通过后，才能报告安装成功。

## 需要收集的输入

只有无法从本地发现时才询问这些值：

| 输入 | 何时需要 | 示例占位符 |
| --- | --- | --- |
| 部署方式 | 总是需要 | `local-all-in-one` 或 `split-relay-daemon` |
| `LEGAX_HOME` | 操作者要求非默认运行目录 | `/opt/legax` 或 `C:\Users\USER\AppData\Roaming\Legax` |
| 公网 relay URL | 手机或 Telegram 需要从 localhost 之外访问 relay | `https://YOUR_RELAY_HOST` |
| Relay secret | 分离部署或连接已有 relay | `replace-with-a-long-random-secret` |
| Telegram bot token | 启用 Telegram transport | `TELEGRAM_BOT_TOKEN` |
| Telegram chat id | 启用 Telegram transport | `123456789` |
| 要启用的 agent CLI | 需要真实 agent 路由 | `codex`、`claude`、`gemini`、`opencode` |

## 阶段 1：发现环境

运行：

```bash
node --version
npm --version
npm config get registry
npm whoami
```

预期：

- Node 主版本为 18 或更高。
- npm registry 可访问。
- 在只安装公开包的机器上，`npm whoami` 失败不一定阻塞安装。

检查可用的 agent CLI。未使用的 CLI 缺失是可以接受的：

```bash
codex --version
claude --version
gemini --version
opencode --version
```

Windows 下如果 `codex` 被 shell 拦截，计划在 `config.yaml` 中设置：

```yaml
codex:
  command: codex.cmd
```

## 阶段 2：选择运行路径

如果操作者给了运行目录，在当前 shell 和后续 service 或 daemon 环境中设置 `LEGAX_HOME`。

PowerShell：

```powershell
$env:LEGAX_HOME = "C:\Users\USER\AppData\Roaming\Legax"
```

POSIX shell：

```bash
export LEGAX_HOME="$HOME/.config/legax"
```

未设置 `LEGAX_HOME` 时的默认配置路径：

- Windows：`%APPDATA%\Legax\config.yaml`
- macOS：`~/Library/Application Support/Legax/config.yaml`
- Linux：`${XDG_CONFIG_HOME:-~/.config}/legax/config.yaml`

如果所选路径位于可能被提交的 Git 仓库内，立即停止。

## 阶段 3A：本机一体化安装

单机部署使用：

```bash
npm install -g legax
legax init
legax doctor --offline
```

预期：

- `legax init` 输出创建的配置路径。
- 只有已启用 adapter 命令可用且必要本地配置存在时，`legax doctor --offline` 才会退出 0。

如果 `legax init` 提示配置已存在，不要使用 `--force` 覆盖，除非操作者明确批准。

启动 relay：

```bash
legax relay start
```

如果手机不在同一台机器上，不要依赖 `127.0.0.1` pair URL。先使用分离部署，或配置手机可访问的 HTTPS relay URL。

在另一个终端启动 daemon：

```bash
legax daemon start
```

配对手机浏览器：

```bash
legax daemon pair
```

验证：

```bash
legax doctor
legax daemon status
```

手机应能打开 pair URL，并看到 Legax relay 页面。

## 阶段 3B：Relay 与 Daemon 分离安装

公网服务器运行 relay、开发机运行 daemon 时使用此路径。

Relay 服务器：

```bash
npm install -g @legax/relay
```

可用完整 CLI 时，用它生成 relay 配置和 HTTPS 反向代理引导：

```bash
npm install -g legax
legax relay init --domain YOUR_RELAY_HOST
```

预期生成物：

- 一个 relay 配置文件，通常复制到 `/etc/legax-relay/config.yaml`。
- 一个把 `YOUR_RELAY_HOST` 反向代理到本地 relay 端口的 Caddyfile。
- 一段包含相同 relay secret 的 daemon 配置片段。

启动 relay：

```bash
legax-relay --config /etc/legax-relay/config.yaml
```

验证公网 relay：

```bash
curl https://YOUR_RELAY_HOST/health
```

预期响应包含：

```json
{"ok":true}
```

开发机：

```bash
npm install -g legax
legax init
```

开发机优先使用完整 `legax` 包。如果人类明确要求 daemon-only 包，则安装 `@legax/daemon`，另行复制或生成 `config.yaml`，并使用 `legax-daemon-control start`、`legax-daemon-control status` 和 `legax-daemon-control pair`。

把 relay 服务器的 URL 和 secret 写入 daemon 配置：

```yaml
relay:
  publicBaseUrl: https://YOUR_RELAY_HOST
transports:
  - name: self-hosted-relay
    type: relay
    enabled: true
    baseUrl: https://YOUR_RELAY_HOST
    secret: replace-with-the-same-relay-secret
```

验证并启动：

```bash
legax doctor
legax daemon start
legax daemon pair
```

## 阶段 4：Telegram Transport

只有在人类提供 bot token，并批准目标 chat 后，才启用 Telegram。

必要步骤：

1. 人类通过 BotFather 创建 bot。
2. 人类向 bot 发送 `/start` 或任意消息。
3. 在 `config.yaml` 中配置 Telegram transport 的 `botToken` 和 `chatId`。
4. 运行 `legax doctor`，确认 `telegram.transport` 为 `OK`。

源码 checkout helper：

```bash
node scripts/configure-telegram-chat.mjs
```

npm 安装包路径：

- 使用 Telegram Bot API `getUpdates` 读取数字 chat id，或从源码运行 helper，并让 `LEGAX_CONFIG` 指向当前配置。

Telegram Mini App 项目选择还要求：

```yaml
relay:
  publicBaseUrl: https://YOUR_RELAY_HOST
```

如果只有 `localhost`、私有局域网 IP 或普通 HTTP，必须停止。

## 阶段 5：验证信号

报告成功前收集这些信号：

```bash
legax doctor --offline
legax doctor
legax daemon status
curl https://YOUR_RELAY_HOST/health
```

如果是仅本机 relay，把公网 curl 替换为：

```bash
curl http://127.0.0.1:8787/health
```

成功安装应满足：

- `config.file` 为 `OK`。
- Relay transport 已配置 secret。
- 非离线模式下 relay health 为 `OK`。
- 已启用 adapter 命令为 `OK`，或已明确关闭。
- 启用 Telegram 时，Telegram transport 为 `OK`。
- `legax daemon pair` 输出 pairing code 和 pair URL。
- 手机浏览器或 Telegram 往返消息能到达 daemon。

## 失败处理

| 失败 | 动作 |
| --- | --- |
| Node 低于 18 | 停止，并要求人类升级 Node。 |
| npm install 因 auth 或 registry 失败 | 停止，并询问 npm registry 或代理策略。 |
| 配置已存在 | 只在必要时读取非密钥结构；没有批准不要覆盖。 |
| Relay health 失败 | 检查进程、端口、防火墙、DNS、TLS 和反向代理。 |
| 怀疑 secret 不一致 | 让人类比较或轮换 secret；不要打印 secret。 |
| 缺少 Telegram chat id | 让人类给 bot 发消息，再发现数字 chat id。 |
| Agent CLI 缺失 | 只有被要求时才安装 CLI，否则关闭对应 adapter。 |
| Codex app-server 可见性缺失 | 按 README 的 Codex 共享 app-server 设置处理；不要假设桌面 App 内嵌 server 是共享的。 |

## 成功报告模板

只报告已脱敏事实：

```text
Legax 安装完成。
- 配置路径：<path>
- 部署方式：<local-all-in-one|split-relay-daemon>
- Relay 健康：<ok|failed|not checked>
- Daemon 状态：<running|not running>
- 已启用 agents：<list>
- 手机通道：<browser pairing|telegram|webhook>
- 剩余操作者动作：<none or list>
```
