# 工程规范

[English](ENGINEERING_GUIDE.md) | 简体中文

本规范面向 Legax 贡献者，定义日常工程维护规则。它补充[架构](ARCHITECTURE.zh-CN.md)、[Adapter 一致性要求](ADAPTER_CONFORMANCE.zh-CN.md)和[扩展 Legax](EXTENDING.zh-CN.md)，把架构约束落到命名、目录、设计模式和审查规则上。

## 范围

这些规则适用于代码、测试、示例和维护者文档。面向用户的安装说明仍放在[用户手册](USER_MANUAL.zh-CN.md)，正式协议和存储结构放在 [Legax 协议](LEGAX_PROTOCOL.zh-CN.md)、[Relay API](RELAY_API.zh-CN.md)和 [Relay Store](RELAY_STORE.zh-CN.md)。

## 命名

| 对象 | 规则 | 示例 |
| --- | --- | --- |
| Adapter 配置 key | 短、稳定，尽量小写，不带版本后缀，不新增同义 key；已有 camelCase key 保持稳定。 | `codex`、`claude`、`gemini`、`opencode`、`codexDesktopMirror` |
| `agentId` | 稳定的公开路由 id。使用清晰的 CLI 名称，不带本机信息。 | `codex-cli`、`claude-code`、`gemini-cli` |
| Adapter 脚本 | `scripts/<name>-link.mjs`；每个 CLI runtime 一个常驻 adapter 入口。 | `scripts/opencode-link.mjs` |
| 共享库 | `scripts/lib/<domain>.mjs`；名称描述领域，不描述调用者。 | `runtime-state.mjs`、`outbound-transports.mjs` |
| Relay event kind | 可迁移协议类型使用小写 snake case；迁移期间可保留 legacy relay kind。 | `active_context`、`approval_request` |
| Relay store schema | 反向域名风格加整数主版本。 | `legax.relay/1` |
| Workflow schema | 与 relay 记录一致的 schema 风格。 | `legax.workflow/1` |
| Command ref | 小写点分隔动作名。它标识 allowlist 内置动作，不是 shell 命令。 | `legax.ping`、`workflow.run_check` |
| Request id | 使用拥有匹配和去重逻辑的领域前缀。 | `perm_...`、`cmd_...`、`lease_...` |
| YAML 字段 | 嵌套配置字段使用 camelCase；不要给同一行为新增多个拼写。 | `runtimeStatePath`、`mcpAutoConfigure` |

新增公开名称时，把它当成长期契约。改变旧字段语义通常比新增一个明确字段风险更高。

## 常量与字面量

行为常量必须具名、明确归属并经过审查。不要随意新增硬编码值。

- timeout、interval、retry 次数、TTL、端口、请求体大小限制、schema version、event kind、mode、status 字符串、command ref、路径名和环境变量名应使用具名常量。
- 常量名在相关时要带单位，尤其是 `_MS`、`_SECONDS`、`_BYTES` 或 `_COUNT`。
- 常量应放在拥有该行为的模块中。只有多个 owner 需要同一个契约时，才提升到共享的 `scripts/lib/<domain>.mjs` 模块。
- 避免宽泛的 `constants.mjs` 大杂烩；它会隐藏职责归属并鼓励无关耦合。
- 只有明显局部且无行为含义的值可以内联，例如 `0`、`1`、`-1`、`true`、`false`、`null`、空数组或空对象，以及没有行为含义的字符串片段。
- 新增或修改硬编码值需要人工审查。如果某个值为了可读性必须保留内联，diff 应能清楚说明原因。
- 不要在测试和实现中重复同一个字面量契约。行为契约应导入或共享；只有测试刻意断言外部公开值时才重复。

示例：

```js
const DEFAULT_RELAY_POLL_INTERVAL_MS = 2000;
const MAX_RELAY_REQUEST_BODY_BYTES = 1024 * 1024;
const RUNTIME_STATE_SCHEMA = "legax.runtime/1";
```

## JavaScript 风格

- 使用纯 JavaScript ESM 和 Node 18+ 标准库。
- 使用 2 空格缩进、双引号和分号。
- 引入新的局部模式前，先匹配周围文件风格。
- 行为需要共享时，优先在 `scripts/lib/<domain>.mjs` 中写小的纯 helper。
- `packages/*/bin` 文件保持很薄；它们应委托 source script，而不是复制业务逻辑。
- 未经接受的设计，不要引入 TypeScript、transpilation、bundler 或纯格式化 churn。
- 不要新增 npm 依赖，除非已接受的设计说明 Node 标准库为什么不足。

## 目录职责

| 路径 | 负责 | 不应负责 |
| --- | --- | --- |
| `scripts/*-link.mjs` | Adapter 进程入口、CLI 命令行、结构化输出解析、session 选择、原生审批桥接。 | Daemon 监督、启动兄弟 adapter、relay store schema 定义。 |
| `scripts/legax-daemon.mjs` | Adapter 监督、远端路由、按需启动、host 心跳、relay command worker。 | CLI 专属流解析或 provider 专属审批协议内部细节。 |
| `scripts/lib/*.mjs` | 共享 parser、路径、协议、runtime state、transport、菜单、workflow、artifact 和 helper。 | 面向用户的安装说明或 npm 包入口逻辑。 |
| `scripts/lib/relay-server-core.mjs` | Relay HTTP API、relay store 修改、浏览器页面、Telegram/飞书入口、配对、attention inbox。 | Adapter 生命周期和直接 CLI 进程管理。 |
| `self-hosted-relay/lib/*` | 独立部署 relay 需要的副本。 | 与匹配共享库产生行为分叉。 |
| `packages/*/bin` | 很薄的 npm 包入口。 | 核心业务逻辑。 |
| `tests/e2e/*.e2e.mjs` | Adapter、relay、daemon、协议、打包和文档门禁的行为覆盖。 | 只有测试能访问、公开脚本不能访问的隐藏行为。 |
| `docs/*.md` | 持久契约、设计原因、操作者或维护者说明。 | 密钥、机器专属配置、未配对语言版本的更新。 |
| `docs/adr/*.md` | 架构决策记录和已接受约束。 | 逐步安装说明或活跃实施计划。 |

新增代码应先匹配现有职责边界。确实需要新 owner 时，先写清边界。

## 可部署副本

独立 relay 可以只复制 `self-hosted-relay/` 安装，因此若干共享源文件有可部署副本。除非文档化的发布约束说明差异原因，否则这些文件对应关系应保持行为一致。

| Source 文件 | 可部署副本 |
| --- | --- |
| `scripts/lib/relay-server-core.mjs` | `self-hosted-relay/lib/relay-server-core.mjs` |
| `scripts/lib/lps-actions.mjs` | `self-hosted-relay/lib/lps-actions.mjs` |
| `scripts/lib/telegram-transport.mjs` | `self-hosted-relay/lib/telegram-transport.mjs` |
| `scripts/lib/outbound-transports.mjs` | `self-hosted-relay/lib/outbound-transports.mjs` |
| `scripts/lib/menu-groups.mjs` | `self-hosted-relay/lib/menu-groups.mjs` |
| `scripts/lib/yaml.mjs` | `self-hosted-relay/lib/yaml.mjs` |
| `scripts/lib/paths.mjs` | `self-hosted-relay/lib/paths.mjs` |

修改表中的 source 文件时，检查副本是否必须在同一个 commit 中更新。直接修改副本时，先检查 source 文件是否也应修改。

## 核心模式

- 优先使用结构化 CLI 协议。JSON-RPC、HTTP API 和 stream-json 优先于 PTY 或 TUI 抓屏。
- Adapter 保持独立进程。Daemon 负责监督，CLI 专属行为留在 adapter 内。
- MCP 保持能力面。MCP tool 可以通知、轮询或请求权限，但不能启动或停止 adapter 进程。
- 跨进程 adapter 协调状态只放在 `scripts/lib/runtime-state.mjs`。
- 可迁移任务/session 事实只放在 `legax.relay/1` relay store。
- 远端出站 event 必须经过共享 transport 代码，以保持通知策略、格式化和投递行为一致。
- Relay command 和 workflow step 使用 allowlist command ref，绝不使用任意远程 shell。
- Relay store 写入在调用方可能重试时要保持幂等。存在过期写入风险时，使用 fencing token、lease token、claim token 或 idempotency key。
- 示例必须可复制。配置字段出现在示例中时，相关文档和测试应使用同一拼写。

## 禁止模式

除非先修改架构契约，否则不要引入这些模式：

- 为 cursor、已选 session、mode 或 launch request 新增 per-adapter 私有状态文件。
- 支持 JSON config、增加 YAML 依赖，或在 `scripts/lib/yaml.mjs` 外写临时配置解析。
- 为 Node 标准库能清晰解决的问题增加 npm 依赖。
- 用 UI 点击模拟、终端提示抓取或 shell 输入作为审批桥接。
- 让远端 workflow 接受 `shell`、`script`、`eval`、`prompt`、`command` 或自由可执行参数。
- 当共享 relay 或 inbound helper 能处理时，在 adapter 内复制 transport 专属路由逻辑。
- 在文档、测试或示例中记录真实 secret、完整未脱敏 prompt 或 provider token。
- 新增脚本、测试或独立部署副本却不接入显式 CI 清单。
- 到处散落 magic number、status 字符串、event 名称、mode 或 timeout 值，而不是命名其代表的契约。

## 错误处理

- 网络调用必须有 timeout 或 abort 路径。
- Relay API 的 JSON 失败应返回 `{ "ok": false, "error": "message" }`。
- `400` 表示无效输入，`401` 表示缺失或无效鉴权，`403` 表示已鉴权但无资格执行，`404` 表示记录不存在，`409` 表示过期状态或非法状态转换，`413` 表示请求体过大。
- 孤儿 `permission_decision` 和 `user_input_response` 必须通过 status event 告知远端用户，不得静默丢弃。
- Adapter 重启后不能重放旧手机消息。使用 cursor 和 runtime state。
- 审批超时默认必须 fail closed，除非操作者明确配置其它行为。

## 测试

- 纯文档改动运行 `npm run check:docs`。
- 代码改动先跑受影响的窄 E2E 文件，再跑 `npm run check:node`，最后跑相关更宽门禁。
- `scripts/` 和 `tests/e2e/` 下新增文件必须追加到 `package.json`；这些清单是显式的。
- 新 relay endpoint 需要覆盖 auth、成功路径、校验错误、相关 stale token 或 stale fence 行为，以及承诺幂等时的重试行为。
- 新 YAML parser 能力需要 parser 覆盖和 example config 使用场景。
- 复制到 `self-hosted-relay/lib/*` 的变更需要同时检查 source 和 standalone 副本。
- 使用真实 Agent CLI 的测试必须继续放在 real-client opt-in 门禁后。

## 审查清单

合并技术改动前，reviewer 应能回答：

- 这个行为归哪个 plane 所有：control、capability、communication、relay store 还是本地 runtime state？
- 公开名称是否稳定，并符合命名表？
- 是否新增了配置字段、event kind、command ref、schema 字段或状态转换，需要补文档？
- 是否新增或修改了硬编码值，并且人工 reviewer 已确认它是有意的？
- 重试是否安全，还是需要 fence、lease token、claim token 或 idempotency key？
- 是否有远端输入变成 shell、文件系统或审批权限？
- 哪条具体命令证明改动行为？
