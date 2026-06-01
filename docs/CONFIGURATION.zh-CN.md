# 配置契约

[English](CONFIGURATION.md) | 简体中文

Legax 使用一份操作者拥有的 YAML 配置文件。示例配置是面向用户的模板；本文档是维护者新增、解析和记录配置字段时遵循的契约。

## 来源

| Runtime | 配置路径来源 |
| --- | --- |
| 已安装 CLI 和 daemon | `--config`，然后 `LEGAX_CONFIG`，再使用 Legax home 下的平台默认路径。 |
| 源码 checkout 脚本 | `LEGAX_CONFIG` 或默认配置路径；部分开发工具为了 dry-run 检查可回退到 `config.example.yaml`。 |
| 独立 relay | `--config`，然后 `LEGAX_CONFIG`，再使用 `/etc/legax-relay/config.yaml`。 |

运行时状态文件根据当前配置路径解析。不要假定当前工作目录就是操作者运行目录。

## YAML 子集

`scripts/lib/yaml.mjs` 中的 parser 有意保持很小。支持的形状包括：

- 顶层 scalar
- 示例配置使用的基于缩进的嵌套 object
- 用 `- ` 引入的 list，包括 scalar list 和 object list
- 每个 key 下的 scalar list
- 引号外 inline comment
- boolean、null、number、单引号字符串、双引号字符串和未加引号字符串

不支持 anchor、tag、多行 scalar 和 flow style。新配置形状必须适配这个子集；否则先同步扩展共享 parser 和独立 relay 副本。

## 顶层段落

| 段落 | Owner | 目的 |
| --- | --- | --- |
| `sessionId` | 共享 | daemon、adapter、MCP 和 relay 使用的默认 relay session id。 |
| `displayName` | Daemon/MCP | 人类可读的 host 或 agent 标签。 |
| `storagePath` | MCP | 通用 MCP 状态路径。 |
| `runtimeStatePath` | Daemon/adapter | 本地跨进程协调状态路径。 |
| `relay` | Relay | HTTP listener、public URL、desktop secret、store、audit 和请求限制。 |
| `mcp` | MCP | 通用 capability server 身份和开关。 |
| `remote` | 共享 | 全局远端开关、默认 mode 和 pause-all。 |
| `routing` | Daemon/adapter | 默认目标和 broadcast 策略。 |
| `approvals` | 共享 | 手机审批开关、超时和超时默认行为。 |
| `daemon` | Daemon | 监督、轮询、host 注册、command queue、project roots 和通知默认值。 |
| `security` | MCP | MCP tool forwarding 使用的默认 redaction 和 redaction pattern。 |
| `transports` | Relay/adapter/MCP | 出站与入站 transport 定义。 |
| Adapter 段落 | Daemon/adapter | CLI 专属开关、命令、backend、session、approval、MCP 和通知策略。 |

Adapter 段落名是公开配置 key。新增或重命名必须同时更新 adapter contract、示例、文档和测试。

## 路径

- `config.yaml` 包含 secret，必须保留在本地。
- `storagePath`、`runtimeStatePath`、relay store 路径、audit 路径、MCP 配置路径和 adapter cwd 类字段等相对运行时路径，应使用共享路径 helper 解析。
- installed mode 必须把 package 文件与操作者配置和运行时状态分开。
- `self-hosted-relay/config.example.yaml` 面向独立 relay 安装，故意只包含 relay 侧字段。

## Relay 段落

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `host` | string | 监听 host。insecure development mode 必须只绑定 loopback。 |
| `port` | number | 监听端口。 |
| `publicBaseUrl` | string | 手机侧流程使用的公网 HTTPS URL，例如 Telegram Mini App 项目选择。 |
| `secret` | string | desktop-side relay secret。必须与 daemon/adapter 使用的 relay transport secret 匹配。 |
| `storePath` | string | `legax.relay/1` store 路径。 |
| `allowInsecureDev` | boolean | 仅限本机开发的无鉴权模式。不要用于对外暴露的 relay。 |
| `maxRequestBodyBytes` | number | 请求体上限。超限返回 `413`。 |
| `audit.enabled` | boolean | 启用 metadata-oriented audit log。 |
| `audit.path` | string | Audit JSONL 输出路径。 |
| `audit.maxTail` | number | API 返回的最大 audit tail 数。 |
| `audit.textPreview` | number | 预览长度；默认 `0`，audit 只保留 metadata。大于 `0` 时写入前会先做脱敏。 |

## Transport 条目

每个 transport 条目都有 `name`、`type`、`enabled` 和可选 `timeoutMs`。类型专属字段如下：

| 类型 | 必填字段 | 说明 |
| --- | --- | --- |
| `relay` | `baseUrl`、`secret` | desktop-authenticated relay 路径。 |
| `telegram` | 启用出站时需要 `botToken`、`chatId` | 启用 relay 后，polling 或 webhook ingress 归 relay 所有。 |
| `feishu` | `appId`、`appSecret`、`receiveId`、`verificationToken` | `platform: lark` 或 `apiBaseUrl` 选择 Lark global。 |
| `webhook` | `url` | 默认仅出站。可选 `secret` 会发送给接收服务；relay 入站 webhook 必须显式设置 `inboundEnabled: true` 和独立的 `inboundSecret`。 |

Transport-local `notifications` 只覆盖该 transport，优先级高于 daemon-wide 和 adapter-level 通知默认值。

## Adapter 段落

所有 adapter 在适用时共享这些字段类别：

| 字段类别 | 示例 | 规则 |
| --- | --- | --- |
| 身份 | `agentId`、`agentLabel` | 稳定且用户可见。 |
| 开关 | `enabled`、`autoStart`、`mode` | Daemon 尊重 `autoStart`；runtime mode 可通过控制消息改变。 |
| Backend | `cliBackend`、`command`、`args`、`cwd` | 必须描述真实 CLI 协议。 |
| Session 模型 | `useExisting`、`resumeSession`、`sessionListLimit`、`sessionHistoryOnSelectLimit` | 选择状态通过 runtime state 持久化。 |
| MCP | `mcpEnabled`、`mcpAutoConfigure`、`mcpRole`、`mcpConfigPath` | MCP 是能力设置，不是生命周期管理。 |
| Approval | `approvalTimeoutMs`、adapter 专属 decision value | 只有存在原生 callback 路径时才能声明支持。 |
| 通知 | `notifications.telegram.messageDetail` | 高频输出必须放在配置门后。 |

新增 adapter 字段必须同步更新：

1. adapter 配置归一化
2. `config.example.yaml`
3. `config.example.zh-CN.yaml`
4. 相关文档
5. 相关 E2E 覆盖

## 兼容规则

- 不支持 JSON config。
- 不为 secret 增加环境变量 fallback。Secret 存放在 gitignored YAML 配置中。
- 不为一个字段创建多个拼写。
- 废弃字段需要迁移说明，并至少在一个发布周期内保留向后兼容归一化。
- 示例默认值应保持安全：可选第三方 transport 默认关闭、审批默认 fail-closed、聊天通知默认低噪音。
