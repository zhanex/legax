# 文档规范

[English](DOCUMENTATION.md) | 简体中文

这些规则适用于 Legax 的正文文档、skill 文档，以及带注释的示例文件。

## 仓库形态

- 根目录 README 只聚焦项目做什么、为什么有用、如何开始、在哪里获得帮助，以及谁维护它。
- 较长的安装、架构、适配器、插件和维护者材料放到 `docs/` 下的聚焦文档中。
- 保持 `docs/README.md` 作为文档索引，让 GitHub 读者不必扫描整棵目录树。
- 保持 `docs/context_for_llms.md` 作为唯一 agent 路由图。`AGENTS.md` 只做紧凑规则入口，`docs/CHANGE_MATRIX.md` 只负责验证选择。
- 将 community health 文件放在 `.github/`：贡献指南、行为准则、安全策略、支持说明、issue 表单和 PR 模板。
- 仓库内部文件使用相对链接，保证在 clone、branch 和 fork 中都能工作。

## 只提交发行版文档

被 git 跟踪的文档必须是发行质量材料：用户指南、维护者指南、稳定契约、架构决策、changelog 条目、roadmap 条目、示例或政策文档。

不要把过程产物作为仓库文档提交：

- 实施计划
- 临时 spec
- 草稿
- scratch notes
- 会议记录
- 临时 audit notes
- Agent 执行 transcript
- 只描述某个已完成本地任务的 checklist 文件

过程材料应保存在 issue、pull request、当前 Agent 线程、外部任务系统，或 `docs/superpowers/` 这类已 gitignore 的本地目录中。如果过程记录包含持久决策，应先把决策转换成 ADR、契约文档或维护者指南，再提交。

## 内容归属

把内容放到拥有对应读者任务的最小稳定文档中：

| 内容 | 归属位置 |
| --- | --- |
| 项目概览、快速开始、支持方式和维护者身份 | 根目录 `README.zh-CN.md` |
| 文档导航 | `docs/README.zh-CN.md` |
| Agent 上下文路由 | `docs/context_for_llms.zh-CN.md` |
| 用户安装和日常操作 | `docs/USER_MANUAL.zh-CN.md` 或具体集成的用户文档 |
| 架构边界、职责归属和生命周期 | `docs/ARCHITECTURE.zh-CN.md`、`docs/FUNCTIONAL_BOUNDARIES.zh-CN.md` 或 ADR |
| 稳定协议、API、配置、状态或 adapter 契约 | `docs/` 下匹配的契约文档 |
| 已接受的架构决策和重新评估条件 | `docs/adr/NNNN-short-topic.zh-CN.md` |
| 编码和维护者实践 | `docs/ENGINEERING_GUIDE.zh-CN.md` |
| 面向 Agent 和维护者的变更到测试路由 | `docs/CHANGE_MATRIX.zh-CN.md` |
| 尚未实现的未发布意图 | `docs/ROADMAP.zh-CN.md` |
| 发布历史 | `CHANGELOG.zh-CN.md` |

不要在多个文档中重复同一份契约。保留一个规范归属文档，然后从概览、路由或快速开始材料中链接过去。

## 写作规范

- 面向需要完成任务或维护契约的读者写作，不要面向刚完成某次实现的人写作。
- 描述已发布行为、已接受设计或明确的 roadmap 意图。不要把本地尝试、临时实现顺序或未决头脑风暴写成产品文档。
- 每篇文档开头应说明范围和读者，除非标题和目录已经足够明确。
- 使用精确名词，少用“新”“旧”“当前”“最近”“临时”这类容易过期的宽泛描述。
- 对受支持行为使用现在时；只有 roadmap 内容使用将来意图。
- CLI 命令、配置键、文件路径、API 字段、mode、event name 和环境变量都应作为字面量写在反引号中。
- 如果前置条件会影响命令是否可运行，应在命令前说明。
- 示例应尽量小、有效，并且不包含真实密钥。
- 本地项目和 workspace 示例使用占位符或相对路径。只有记录稳定的 OS 级安装默认值时才使用绝对路径，例如 `/etc/legax-relay/config.yaml`、`/var/lib/legax-relay/relay-store.json`，或平台 home 示例。
- 链接到规范归属文档，避免重复大段安装、架构或协议细节。
- 如果文档引入稳定 enum、状态值、配置键、endpoint 或文件格式，应在相关位置说明归属、合法值和兼容性注意事项。

## 文档结构

- 使用一个与文档用途匹配的 `#` 一级标题。
- 语言切换链接放在标题下方。
- Agent 工作流常加载的长契约文档，应在语言切换后放置简短的 `## Agent Summary`。
- 使用简短、面向任务的章节标题。
- 映射和矩阵使用表格；短规则使用项目符号；只有有顺序要求的过程才使用编号列表。
- 命令、配置、JSON、YAML 和 shell 片段使用带语言标记的 fenced code block。
- 截图和图片默认放在 `docs/image/`，除非存在更具体的文档资产目录。
- 只有在能减少重复或帮助读者路由时，才增加“相关文档”一类章节。

## 格式例外

有些仓库 Markdown 文件会被外部工具渲染或解析，因此可以使用受限结构：

- 根目录 `README.zh-CN.md` 可以使用面向 GitHub 的 HTML hero 区块。可见标题和语言切换仍应靠近文件顶部。
- `.github/PULL_REQUEST_TEMPLATE*.md` 可以直接从任务章节开始，而不使用标题，这样生成的 pull request 正文更简洁。
- `skills/legax/SKILL*.md` 必须在 Markdown 标题前保留 skill front matter。语言切换链接放在 front matter 之后的标题下方。
- `packages/*/` 下被忽略的生成版 README 是 package artifact，不是规范归属的源文档。
- YAML 示例文件遵循配置示例结构，不遵循 Markdown 标题结构。

新增例外时，应说明哪个外部渲染器、package 格式或工具解析器需要这种结构。

## 语言文件

- 英文文档使用 `*.md`。
- 简体中文文档使用 `*.zh-CN.md`。
- 根目录和特殊文件也遵循同样的配对规则，例如 `README.md` 与 `README.zh-CN.md`、`AGENTS.md` 与 `AGENTS.zh-CN.md`、`SKILL.md` 与 `SKILL.zh-CN.md`，以及每个 `config.example*.yaml` 与匹配的 `config.example*.zh-CN.yaml`。
- 除短语言切换链接、产品名、CLI 命令、API 名称、配置键和代码示例外，不要在同一份文档正文中混写中英文。
- 修改文档时，如果内容同时面向中英文用户，应在同一次变更中更新对应的语言版本。

## 编码

- 所有文档和带注释的示例文件必须使用 UTF-8 且不带 BOM。
- 避免使用会把 UTF-8 静默改写为本地代码页的编辑器或 shell 命令。
- 在 Windows PowerShell 5.1 中重写文件时，优先使用 Node.js、现代编辑器，或 `.NET` 的 `UTF8Encoding(false)`。
- 提交文档变更前运行 `npm run check:docs`。
- `npm run check:docs` 包含上下文预算 gate，用于检查紧凑 agent 入口文档和 `Agent Summary` 覆盖。

## 版本引用

- 不要在 README 或 docs 正文中写死当前 package 版本。使用 package metadata、`latest`，或 `vX.Y.Z` 这类占位符。
- Changelog 标题可以保留已发布的历史版本，因为它们属于发布记录。

## 安全

- 不要把真实 bot token、API key、relay secret、已配对设备 cookie、chat ID、session secret 或用户凭据写入文档。
- 示例统一使用 `replace-with-a-long-random-secret`、`YOUR_RELAY_HOST`、`TELEGRAM_BOT_TOKEN` 这类占位符。
- 如果真实密钥已经出现在文档或示例中，应从文件中移除，并在仓库外完成轮换。

## 审查清单

- 内容属于当前文档的规范归属；否则应链接到归属文档，而不是重复内容。
- Agent 路由属于 `docs/context_for_llms.md`；验证路由属于 `docs/CHANGE_MATRIX.md`。
- 文档描述的是已发布行为、已接受设计或明确的 roadmap 意图，而不是过程记录。
- 文档遵循标题、语言切换、章节和 fenced code block 规则，或符合已记录的格式例外。
- 英文和简体中文文件都存在。
- 两份文件描述的是同一套行为，并使用相同的配置键。
- 英文文件不包含中文正文。
- 中文文件不存在未翻译的英文段落。
- 语言版本之间的互链可用。
- 命令、配置键、API 字段、状态、mode、文件路径和环境变量都已标记为字面量。
- 稳定 enum、状态值、配置键、endpoint 和文件格式在相关位置说明了归属、合法值和兼容性注意事项。
- 示例尽量小、有效，并使用占位符而不是真实密钥。
- 本地项目和 workspace 示例不包含机器相关的绝对路径。
- 不存在乱码或替换字符。
- 文件开头没有 UTF-8 BOM。
- 当前 package 版本只出现在 changelog 历史记录中。
