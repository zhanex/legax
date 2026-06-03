# LLM 上下文

[English](context_for_llms.md) | 简体中文

编码代理的紧凑地图：优先最小上下文，并标明长期事实的 canonical owner。

## 阅读预算

- 默认只读 `AGENTS.md`、本文和最多一条任务路由。
- 优先读 `Agent Summary`；只有修改契约或消除歧义时读全文。
- 默认读英文文档；只有翻译、中文文档或双语检查时才读中文配对。
- 不要批量读取 `docs/` 或加载整张路由表。跨区域变更只读最小有用并集。

## 不可违反的规则

- 只使用 Node 18+ 标准库；不要随意新增依赖、bundler 或 JSON 配置。
- 本地协调状态属于 `scripts/lib/runtime-state.mjs`；relay 状态属于 relay store。
- MCP 是能力层，不是生命周期管理器。
- 不得绕过原生 approval policy，也不得模拟 approval。
- 英文和简体中文文档必须成对维护。
- 新脚本和 E2E 文件必须加入 `package.json` 显式列表。

## 任务路由

| 任务 | 编辑前读取 |
| --- | --- |
| 架构、所有权、生命周期、范围 | `docs/ARCHITECTURE.md`、`docs/FUNCTIONAL_BOUNDARIES.md` |
| Adapter 脚本或测试 | `docs/ADAPTERS.md`、`docs/ADAPTER_CONFORMANCE.md` |
| Daemon、模式、launch、本地队列 | `docs/RUNTIME_STATE.md`、`docs/STATE_MACHINES.md` |
| Relay endpoint 或浏览器/手机路由 | `docs/RELAY_API.md`；改持久记录时加 `docs/RELAY_STORE.md` |
| Event、portable session、workflow、checkpoint | `docs/LEGAX_PROTOCOL.md`，再加被修改的 endpoint 或 store owner |
| Config 字段、示例或 YAML parser | `docs/CONFIGURATION.md`、`docs/DOCUMENTATION.md` |
| Telegram、飞书/Lark、webhook | `docs/CONFIGURATION.md`、`docs/FEISHU_LARK.md`、`docs/COMPATIBILITY.md` |
| MCP 工具、permission MCP、plugin 或 skill 元数据 | `docs/CODEX_PLUGIN.md`、`skills/legax/SKILL.md` |
| 日志、health、audit、诊断、隐私 | `docs/OBSERVABILITY.md`；数据处理时加 `docs/PRIVACY.md` |
| 纯文档变更 | `docs/DOCUMENTATION.md`、`docs/README.md` |
| Release、package 或发布 | `docs/RELEASE.md` |

选择上下文后，用 `docs/CHANGE_MATRIX.md` 选择聚焦测试。

## Canonical Owner

| 事实 | Owner |
| --- | --- |
| Control/capability/communication plane | `docs/ARCHITECTURE.md` |
| 范围、非目标、安全边界 | `docs/FUNCTIONAL_BOUNDARIES.md` |
| Relay HTTP endpoint/auth | `docs/RELAY_API.md` |
| Relay 持久记录 | `docs/RELAY_STORE.md` |
| 跨 adapter protocol shape | `docs/LEGAX_PROTOCOL.md` |
| 本地 daemon/adapter runtime state | `docs/RUNTIME_STATE.md` |
| Config key 与 YAML parser 行为 | `docs/CONFIGURATION.md` |
| 文档放置和语言规则 | `docs/DOCUMENTATION.md` |

## 验证

- 纯文档：按 `docs/DOCUMENTATION.md` 审查，然后 `npm run check:docs`。
- 代码：按 `docs/CHANGE_MATRIX.md` 跑窄 E2E，然后 `npm run check:node`。
- 分支可合并：运行 `npm run ci`，或说明未运行原因。
