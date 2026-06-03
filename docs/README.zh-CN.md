# 文档索引

[English](README.md) | 简体中文

用这个索引查找稳定项目文档。Agent 上下文路由归 [LLM 上下文](context_for_llms.zh-CN.md)；验证路由归 [变更矩阵](CHANGE_MATRIX.zh-CN.md)。

## 如何使用这棵树

- 编码 Agent 从 `AGENTS.md` 开始，再使用 [LLM 上下文](context_for_llms.zh-CN.md)。
- 人类贡献者按工作范围使用本索引。小改动不需要阅读所有设计文档。
- 架构和契约文档在各自领域内是必须遵守的规范，即使某个任务只把其中一部分加载进上下文。
- 如果一个变更跨越多个领域，加载相关分支文档的并集。

```text
docs/
  README.zh-CN.md            文档树
  context_for_llms.zh-CN.md  Agent 精简地图
  CHANGE_MATRIX.zh-CN.md     变更路径到聚焦测试
  ARCHITECTURE.zh-CN.md      全局职责模型
  ENGINEERING_GUIDE.zh-CN.md 命名、常量、职责和模式
  CONFIGURATION.zh-CN.md     配置与 YAML parser 契约
  RELAY_API.zh-CN.md         relay endpoint 契约
  RELAY_STORE.zh-CN.md       relay 侧持久记录
  RUNTIME_STATE.zh-CN.md     本地 daemon/adapter 协调
  STATE_MACHINES.zh-CN.md    mode、approval、command、workflow 转换
  OBSERVABILITY.zh-CN.md     日志、health、status、audit、diagnostics
  DOCUMENTATION.zh-CN.md     文档语言配对与审查规则
  adr/                       已接受的架构决策
```

## 用户文档

| 文档 | 用途 |
| --- | --- |
| [用户手册](USER_MANUAL.zh-CN.md) | 全新安装、relay 设置、手机配对、Telegram 设置、健康检查和排障。 |
| [AI 安装指南](AI_INSTALL.zh-CN.md) | 让 Agent 或自动化助手替人类操作者安装 Legax。 |
| [Codex 插件指南](CODEX_PLUGIN.zh-CN.md) | 安装 Codex 插件、检查发布前元数据，以及确认是否已具备提交 Plugin Directory 的条件。 |
| [飞书与 Lark 通道](FEISHU_LARK.zh-CN.md) | 飞书/Lark 自建应用 bot、事件回调、路由和安全边界。 |
| [适配器指南](ADAPTERS.zh-CN.md) | Codex、Claude Code、Gemini CLI、OpenCode、桌面镜像、运行模式和审批边界。 |
| [Claude Code 集成](CLAUDE_CODE_INTEGRATION.zh-CN.md) | Claude Code 适配器、permission-prompt MCP 流程、安全边界和生态审查问题。 |

## 设计与扩展文档

| 文档 | 用途 |
| --- | --- |
| [架构](ARCHITECTURE.zh-CN.md) | 控制面、能力面、通信面、relay 接管的 Telegram/飞书路由、daemon、运行时状态和适配器设计。 |
| [功能边界](FUNCTIONAL_BOUNDARIES.zh-CN.md) | Legax 负责什么、刻意不负责什么，以及非目标。 |
| [工程规范](ENGINEERING_GUIDE.zh-CN.md) | 命名、常量、目录职责、设计模式、禁止模式、错误处理和测试规则。 |
| [变更矩阵](CHANGE_MATRIX.zh-CN.md) | 面向编码 Agent 和维护者，把变更路径映射到聚焦验证命令。 |
| [配置契约](CONFIGURATION.zh-CN.md) | YAML 子集、配置段落、路径规则、transport 字段和 adapter 字段类别。 |
| [Relay API](RELAY_API.zh-CN.md) | Relay HTTP 端点、鉴权类别、状态码，以及 retry/stale-token 行为。 |
| [Relay Store](RELAY_STORE.zh-CN.md) | `legax.relay/1` 中的会话、generation、lease、handoff、artifact、主机、命令、收件箱和工作流记录。 |
| [Runtime State](RUNTIME_STATE.zh-CN.md) | 本地 daemon/adapter 协调 schema、queue、cursor、mode、launch request 和 lock 规则。 |
| [Legax 协议](LEGAX_PROTOCOL.zh-CN.md) | 跨适配器事件契约、配对信息、可迁移会话、checkpoint artifact 和受限工作流 API。 |
| [状态机](STATE_MACHINES.zh-CN.md) | Runtime mode、daemon、approval、lease、handoff、command、workflow 和 session 选择转换。 |
| [兼容性矩阵](COMPATIBILITY.zh-CN.md) | 外部 CLI 和远端 surface 的兼容性假设与审查清单。 |
| [LLM 上下文](context_for_llms.zh-CN.md) | 供编码 Agent 修改仓库时使用的仓库地图与安全规则。 |
| [Adapter 一致性要求](ADAPTER_CONFORMANCE.zh-CN.md) | 路由、会话、审批、重启行为和测试方面的共享适配器要求。 |
| [扩展 Legax](EXTENDING.zh-CN.md) | 添加适配器、传输、配置字段和测试。 |
| [架构决策记录](adr/README.zh-CN.md) | 塑造项目架构的持久决策与约束。 |

## 维护者文档

| 文档 | 用途 |
| --- | --- |
| [文档规范](DOCUMENTATION.zh-CN.md) | 语言配对、编码、密钥扫描和审查清单。 |
| [可观测性](OBSERVABILITY.zh-CN.md) | 日志、audit、health、status、retention 和诊断规则。 |
| [发布指南](RELEASE.zh-CN.md) | 本地发布检查和包发布流程。 |
| [路线图](ROADMAP.zh-CN.md) | 可能的优先级和明确的非目标。 |
| [隐私说明](PRIVACY.zh-CN.md) | 数据处理、存储、第三方传输和操作者选择。 |
| [使用条款](TERMS.zh-CN.md) | 预期用途、禁止用途、免责声明和第三方服务说明。 |

## 社区文件

GitHub 会从 `.github/` 展示仓库社区文件：

- [贡献指南](../.github/CONTRIBUTING.zh-CN.md)
- [行为准则](../.github/CODE_OF_CONDUCT.zh-CN.md)
- [安全策略](../.github/SECURITY.zh-CN.md)
- [支持说明](../.github/SUPPORT.zh-CN.md)
- [Pull Request 模板](../.github/PULL_REQUEST_TEMPLATE.zh-CN.md)

Issue 表单位于 [`.github/ISSUE_TEMPLATE/`](../.github/ISSUE_TEMPLATE/)。
