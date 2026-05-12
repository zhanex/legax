# 用户操作手册

[English](USER_MANUAL.md) | 简体中文

本手册给出从一台新机器到可用 Legax 部署的最短安全路径。按这里的步骤安装 Legax、启动 relay、连接手机，并验证手机回复可以到达本地 agent daemon。

实现细节见[架构文档](ARCHITECTURE.zh-CN.md)、[功能边界](FUNCTIONAL_BOUNDARIES.zh-CN.md)、[安全策略](../.github/SECURITY.zh-CN.md)和[隐私说明](PRIVACY.zh-CN.md)。

## 选择部署方式

| 部署方式 | 适用场景 | 安装包 |
| --- | --- | --- |
| 本机一体化部署 | 在一台机器上试用 Legax，或 relay 暂时不需要公网访问。 | `legax` |
| Relay 与 daemon 分离部署 | relay 放在公网 VPS、NAS 或服务器上，agent CLI 放在另一台开发机上。 | 服务器安装 `@legax/relay`，开发机安装 `legax` 或 `@legax/daemon` |

手机必须能访问 relay。Telegram Mini App 的项目选择能力要求 `relay.publicBaseUrl` 是公网 `https://` 地址。

## 开始前准备

先准备：

- Node.js 18 或更高版本。
- 可访问公网 npm registry。
- 如果需要真实 agent 路由，至少安装一个受支持的 agent CLI：Codex、Claude Code、Gemini CLI 或 OpenCode。
- 一个本地 Legax 运行目录。不想使用平台默认目录时，设置 `LEGAX_HOME`。
- 一个足够长的 relay secret。`legax init` 和 `legax relay init` 都可以自动生成。
- 可选：通过 BotFather 创建的 Telegram bot token，以及要接收消息的数字 Telegram chat id。

默认配置路径：

- Windows：`%APPDATA%\Legax\config.yaml`
- macOS：`~/Library/Application Support/Legax/config.yaml`
- Linux：`${XDG_CONFIG_HOME:-~/.config}/legax/config.yaml`

不要提交 `config.yaml`。它包含本地密钥，仓库也会刻意忽略这个文件。

## 本机一体化部署

安装 all-in-one CLI：

```bash
npm install -g legax
```

初始化本地操作者配置：

```bash
legax init
```

启动任何进程前，先运行离线诊断：

```bash
legax doctor --offline
```

预期结果：

- `node.version` 为 `OK`。
- `config.file` 为 `OK`。
- 已启用 adapter 的命令检查：已安装的 CLI 为 `OK`，尚未安装或需要关闭的 CLI 可能为 `ERROR`。
- 离线模式会跳过 relay 网络健康检查。

在一个终端启动 relay：

```bash
legax relay start
```

默认 relay transport 可能指向 `127.0.0.1`，这只适合同一台机器访问。如果真实手机在另一张网络上，请使用分离部署，或先把 relay URL 改成手机可访问的 HTTPS 入口。

在第二个终端启动 daemon：

```bash
legax daemon start
```

relay 运行后创建浏览器配对码：

```bash
legax daemon pair
```

用手机打开输出的 pair URL，或扫描终端里的二维码。Pair URL 有短有效期；过期后重新执行 `legax daemon pair`。

relay 可访问后运行完整诊断：

```bash
legax doctor
```

## 可选 Codex 插件

当你希望 Codex 从插件目录获得 Legax skill 和 MCP 工具时，安装 Codex 插件。插件不会启动 daemon，也不会创建操作者配置；上面的 CLI 设置仍然是运行时路径。

在本地 checkout 中运行：

```bash
codex plugin marketplace add .
```

然后重启 Codex，选择 `Legax Plugins` marketplace，并安装 `Legax`。发布候选和 Git-backed 安装说明见 [Codex 插件指南](CODEX_PLUGIN.zh-CN.md)。

## Relay 与 Daemon 分离部署

当手机需要稳定公网 relay，而 agent CLI 运行在私有开发机时，使用这种部署。

在 relay 服务器安装 relay 包：

```bash
npm install -g @legax/relay
```

如果任意机器上可以安装完整 `legax` CLI，用它生成 relay 配置和 Caddy 引导：

```bash
npm install -g legax
legax relay init --domain YOUR_RELAY_HOST
```

把生成的 relay 配置复制到 relay 服务器。常见服务器路径是：

```text
/etc/legax-relay/config.yaml
```

启动 relay：

```bash
legax-relay --config /etc/legax-relay/config.yaml
```

通过 HTTPS 暴露 relay。使用 Caddy 时，可以采用生成的 Caddyfile，或创建类似反向代理：

```text
YOUR_RELAY_HOST {
  reverse_proxy 127.0.0.1:8787
}
```

检查公网 relay 健康端点：

```bash
curl https://YOUR_RELAY_HOST/health
```

预期响应包含：

```json
{"ok":true}
```

在开发机安装并初始化 Legax：

```bash
npm install -g legax
legax init
```

开发机推荐安装完整 `legax` 包，因为它包含 `init`、`doctor`、relay helper、daemon control 和配对命令。如果只安装 `@legax/daemon`，需要另行生成或复制 `config.yaml`，然后使用 `legax-daemon-control start`、`legax-daemon-control status` 和 `legax-daemon-control pair`，而不是 `legax daemon ...` 包装命令。

编辑开发机 `config.yaml`，让 relay 设置与服务器匹配：

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

运行诊断并启动 daemon：

```bash
legax doctor
legax daemon start
```

在开发机发起手机配对：

```bash
legax daemon pair
```

## Telegram 设置

Telegram 是可选通道。需要 bot 消息、回复和 Mini App 入口时再启用。

1. 通过 BotFather 创建 bot，并复制 bot token。
2. 在 Telegram 打开这个 bot，发送 `/start` 或任意消息。
3. 在 `config.yaml` 的 Telegram transport 中写入 `botToken` 和 `chatId`。
4. 保持 `config.yaml` 仅存在于本地，并继续让它被 gitignore。

如果使用源码 checkout，可以在 bot 收到消息后用 helper 发现最近的 chat id：

```bash
node scripts/configure-telegram-chat.mjs
```

如果使用 npm 安装包，可以从源码 checkout 运行 helper，并让 `LEGAX_CONFIG` 指向当前配置；也可以通过 Telegram Bot API 的 `getUpdates` 读取 chat id。

Telegram Mini App 项目选择还需要配置：

```yaml
relay:
  publicBaseUrl: https://YOUR_RELAY_HOST
```

这个值必须是公网 HTTPS，不能是 `localhost`、私有局域网地址或普通 HTTP。

## 第一次手机交互

relay 和 daemon 都运行后：

1. 用 `legax daemon pair` 配对浏览器，或打开 Telegram bot。
2. 如果启用了多个 adapter，先选择目标 agent。
3. 从手机发送一条简短回复。
4. 确认 daemon 收到并路由了这条消息。
5. 触发一次 agent 审批，确认 Legax 是镜像原生审批请求，而不是绕过它。

Legax 只会镜像原生审批提示，并通过受支持的结构化路径返回决策。它不能模拟 UI 点击，也不能自动批准 agent 安全提示。

## 健康检查

部署时常用检查：

```bash
legax doctor --offline
legax doctor
legax daemon status
curl https://YOUR_RELAY_HOST/health
```

`legax doctor` 会脱敏输出：它只报告密钥是否已配置，不会打印密钥值。

## 故障排查

| 现象 | 检查 | 处理 |
| --- | --- | --- |
| Relay 健康检查失败 | `curl https://YOUR_RELAY_HOST/health` | 启动 `legax-relay`，检查防火墙规则和 HTTPS 反向代理。 |
| Relay 拒绝消息 | Relay secret 是否不一致 | 在 relay 配置和 daemon `transports` 中使用同一个长 secret。 |
| `legax doctor` 提示缺少 Telegram chat id | Telegram transport 有 `botToken` 但没有 `chatId` | 先给 bot 发消息，再发现并写入数字 `chatId`。 |
| Mini App 项目选择无法打开 | `relay.publicBaseUrl` 是私有地址或不是 HTTPS | 设置公网 `https://` 地址，并使用可信证书暴露 relay。 |
| Agent 命令缺失 | `legax doctor` 的 adapter 命令检查为 `ERROR` | 安装对应 CLI，把它放入 `PATH`，或在 `config.yaml` 关闭该 adapter。 |
| 本地看不到 Codex 活动 | Codex app-server 不是共享后端 | 按 README 的共享 app-server 流程启动或 attach。桌面 App 内嵌 stdio server 不是共享后端。 |
| Windows 下 daemon 无法运行 `codex` | PowerShell 执行策略拦截 shim | 在 `config.yaml` 设置 `codex.command: codex.cmd`。 |
| Daemon 提示已经运行 | pid 文件仍有效或残留 | 先运行 `legax daemon status`，需要重启时再运行 `legax daemon stop`。 |

## 后续阅读

- [架构文档](ARCHITECTURE.zh-CN.md)：control plane、capability plane 和 communication plane。
- [Legax 协议](LEGAX_PROTOCOL.zh-CN.md)：跨 adapter 事件契约。
- [功能边界](FUNCTIONAL_BOUNDARIES.zh-CN.md)：Legax 负责和不负责的范围。
- [隐私说明](PRIVACY.zh-CN.md)：数据处理方式。
- [使用条款](TERMS.zh-CN.md)：操作者责任。
