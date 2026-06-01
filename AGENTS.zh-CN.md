# AGENTS.zh-CN.md

[English](AGENTS.md) | 简体中文

本文件是 AI 编码 Agent 在 Legax 仓库中工作的仓库级指令契约，适用于 Codex、Claude Code、Gemini CLI、OpenCode 以及其他 LLM 编码工具。它适用于受支持的 LLM Agent 环境。

使用本文件作为入口，然后只加载下方列出的最短任务相关文档。某个文档即使没有被加载进上下文，在对应领域内也仍然是必须遵守的规范；编辑该领域前要加载相关文档。

如果用户或工作上下文使用简体中文，Agent 可以把本文件作为 `AGENTS.md` 的等价翻译来阅读。它不是另一套规则；如果两个文件出现分歧，以 `AGENTS.md` 为事实来源，并同步修正两边。

## 必须遵守的运行规则

- 本仓库的架构和安全边界优先于本地风格偏好。
- 保持项目零依赖：没有 `node_modules`、没有 bundler，除非设计已经被明确接受，否则不要新增 npm 依赖。
- 运行环境基于 Node 18+ 标准库。
- 配置保持 YAML-only。使用 `scripts/lib/yaml.mjs`；不要随意增加 JSON config 支持或 YAML 依赖。
- 跨进程 adapter 协调状态保持在 `scripts/lib/runtime-state.mjs`；不要为 cursor、selected session、mode 或 launch request 创建旁路状态文件。
- MCP 保持能力层定位。MCP tool 可以通知、轮询或请求权限，但不能启动或停止 adapter 进程。
- 不要模拟 UI 点击、自动批准原生 prompt，或绕过 agent 的安全策略。
- 不要把远端 workflow 输入路由到任意 shell、`eval`、script、prompt、command 或自由可执行参数。
- 不要随意硬编码行为常量。除 `0`、`1`、`-1`、`true`、`false`、`null` 这类明显局部的简单字面量外，新增硬编码值需要人工审查。
- 文档语言版本必须成对维护：英文 `.md` 配 `.zh-CN.md`，`config.example*.yaml` 配匹配的 `config.example*.zh-CN.yaml`。
- 被 git 跟踪的文档必须是发行质量文档。不要把实施计划、草稿、临时 spec、scratch notes、audit notes 或 Agent 执行 transcript 作为 docs 提交。
- 在 staging、提交、创建 PR 或声明文档变更已就绪前，必须按 `docs/DOCUMENTATION.zh-CN.md` 审计已修改文档；不要只依赖 `npm run check:docs` 判断内容归属、写作规范或结构问题。
- 如果新增脚本或 E2E 测试文件，把它追加到 `package.json` 中显式的检查或测试清单。

## 必需文档路由

| 工作范围 | 编辑前加载 |
| --- | --- |
| 任意非平凡代码变更 | `docs/context_for_llms.zh-CN.md`、`docs/ENGINEERING_GUIDE.zh-CN.md`、`docs/CHANGE_MATRIX.zh-CN.md` |
| 架构、生命周期或 plane 归属 | `docs/ARCHITECTURE.zh-CN.md`、`docs/FUNCTIONAL_BOUNDARIES.zh-CN.md`、`docs/adr/README.zh-CN.md` |
| Adapter 行为 | `docs/ADAPTERS.zh-CN.md`、`docs/ADAPTER_CONFORMANCE.zh-CN.md`、`docs/EXTENDING.zh-CN.md` |
| MCP tool、permission MCP 或 skill/plugin metadata | `docs/CODEX_PLUGIN.zh-CN.md`、`skills/legax/SKILL.zh-CN.md`、`docs/OBSERVABILITY.zh-CN.md` |
| Daemon 监督、mode、launch request、本地 queue | `docs/RUNTIME_STATE.zh-CN.md`、`docs/STATE_MACHINES.zh-CN.md` |
| Relay HTTP API | `docs/RELAY_API.zh-CN.md`、`docs/RELAY_STORE.zh-CN.md`、`docs/LEGAX_PROTOCOL.zh-CN.md` |
| Relay store schema 或 portable session | `docs/RELAY_STORE.zh-CN.md`、`docs/LEGAX_PROTOCOL.zh-CN.md` |
| Config 字段或 parser 行为 | `docs/CONFIGURATION.zh-CN.md`、`config.example.yaml`、`config.example.zh-CN.yaml` |
| Transport、Telegram、飞书/Lark、webhook 路由 | `docs/ARCHITECTURE.zh-CN.md`、`docs/CONFIGURATION.zh-CN.md`、`docs/FEISHU_LARK.zh-CN.md`、`docs/COMPATIBILITY.zh-CN.md` |
| Workflow、checkpoint artifact、worktree-lite | `docs/LEGAX_PROTOCOL.zh-CN.md`、`docs/RELAY_API.zh-CN.md`、`docs/RELAY_STORE.zh-CN.md`、`docs/STATE_MACHINES.zh-CN.md` |
| 鉴权、secret、隐私、公开暴露 relay | `docs/RELAY_API.zh-CN.md`、`docs/OBSERVABILITY.zh-CN.md`、`docs/PRIVACY.zh-CN.md`、`.github/SECURITY.zh-CN.md` |
| Logging、health、status、audit、diagnostics | `docs/OBSERVABILITY.zh-CN.md` |
| 文档变更 | `docs/DOCUMENTATION.zh-CN.md`、`docs/README.zh-CN.md` |
| Release、packages、publishing | `docs/RELEASE.zh-CN.md` |
| Commit 或 PR 准备 | `.github/CONTRIBUTING.zh-CN.md` |

使用 [docs/README.zh-CN.md](docs/README.zh-CN.md) 作为完整文档树。使用 [docs/context_for_llms.zh-CN.md](docs/context_for_llms.zh-CN.md) 作为编码 Agent 的精简地图。

## 命令

这是一个零依赖 Node.js 项目。

```bash
npm run ci                            # 完整 CI 门禁：npm test + check:docs
npm test                              # 本地代码门禁：check:node + check:shell + test:e2e
npm run check:node                    # 对每个脚本运行 node --check，只检查语法
npm run check:docs                    # docs/i18n/secret/BOM 门禁
npm run check:shell                   # 对 installer 和 service 脚本运行 bash -n
npm run test:e2e                      # 对 tests/e2e/*.e2e.mjs 运行 node --test，不含 real clients
npm run test:e2e:real                 # 选择性运行：需要 LEGAX_REAL_CLIENTS=1 且真实 CLI 在 PATH 中
npm run test:real:messages            # real-local-message smoke test
```

运行单个 E2E 文件：

```bash
node --test tests/e2e/<name>.e2e.mjs
```

按名称运行单个 E2E 测试：

```bash
node --test --test-name-pattern '<substring>' tests/e2e/<name>.e2e.mjs
```

不启动真实 CLI，只 dry-run supervisor：

```bash
node scripts/legax-daemon.mjs --dry-run
```

`npm run ci` 是合并契约。纯文档变更可以运行 `npm run check:docs`；代码变更应先运行受影响的窄范围测试，再运行相关的更大门禁。

## 架构提醒

Legax 是面向 Agent CLI 的 session 管理与工作流编排层。保持这些职责边界分离：

- 控制平面：`scripts/*-link.mjs` 下的 CLI adapter 负责进程交互、session 选择、结构化输出解析和原生 approval callback 集成。
- 能力平面：MCP server 暴露 tool 和 permission prompt，但不管理 adapter 生命周期。
- 通信平面：relay、Telegram、飞书/Lark、webhook、inbound helper 和 outbound transport 负责远端消息投递与路由。
- Runtime state：`scripts/lib/runtime-state.mjs` 是本地 daemon/adapter 协调的事实来源。
- Relay store：`data/relay-store.json` 使用 `legax.relay/1`，负责 relay 侧可迁移状态。

## 常量策略

行为常量应具名、明确作用域，并经过审查。

- timeout、interval、retry 次数、TTL、端口、请求体大小限制、schema version、event kind、mode、command ref、status 字符串、路径名和环境变量名优先使用具名常量。
- 名称在相关时包含单位，例如 `DEFAULT_RELAY_POLL_INTERVAL_MS`。
- 常量放在拥有该行为的模块附近。只有多个 owner 需要同一个契约时，才通过 domain module 共享。
- 不要创建宽泛的大杂烩 constants 文件。
- 如果某个值为了可读性必须保留内联，reviewer 必须能看出它为什么不是行为常量。

## 贡献与提交

staging 或提交前遵循 `.github/CONTRIBUTING.zh-CN.md`。

- staging 前检查 `git status --short` 和完整 diff。
- 推送或创建 PR 前，先 fetch 远端目标分支，并确认目标分支是否已经推进。如果已经推进，按仓库约定的 merge 或 rebase 策略把当前工作分支更新到最新目标分支，本地解决冲突，并在推送前重新运行相关检查。
- 不要在脏工作区中盲目执行 `git pull`；优先使用 `git fetch origin`，然后显式决定 merge 还是 rebase。
- 不要 stage 本地运行产物、大二进制、`data/` 残留、机器相关配置、lock 文件或已跟踪密钥。
- 文档语言版本必须在同一个 commit 中成对维护。
- 提交标题使用简短祈使句。有助于扫描时可以加主题前缀。
- 只有当原因无法从标题和 diff 直接看出时，才写 commit body。

## 验证

- 纯文档变更先按 `docs/DOCUMENTATION.zh-CN.md` 审计已修改文档，再运行 `npm run check:docs`。
- 修改文档门禁、路由、索引、`AGENTS.md`、`docs/CHANGE_MATRIX.md` 或 `scripts/check-docs.mjs` 时，还要运行 `node --test tests/e2e/docs.e2e.mjs`。
- 代码变更先运行受影响的 E2E 文件或窄范围检查，再运行 `npm run check:node`，最后运行相关的更大门禁。
- 声称分支可合并前，运行 `npm run ci`，或明确说明为什么没有运行。
