# ADR 0001：核心架构约束

[English](0001-core-architecture-constraints.md) | 简体中文

Status：Accepted

## Context

Legax 把本地 Agent CLI 连接到远端 surface，使远端可以发送文本、审批、输入响应和 workflow action。项目运行在操作者机器上，必须易于检查、打包和运行，并且不依赖构建系统。

仓库中反复出现几个实现选择：无运行时依赖、YAML-only config、daemon-owned process lifecycle、MCP 作为 capability plane、relay-owned transport ingress、严格 state ownership，以及原生 approval mirroring。它们需要一份持久决策记录，避免未来改动无意削弱模型。

## Decision

Legax 保持以下约束：

1. 运行时脚本只使用 Node.js 标准库。
2. 操作者配置只支持 YAML，并通过共享 minimal parser 解析。
3. CLI adapter 是由 daemon 监督的独立常驻进程。
4. MCP tool 暴露 capability，永远不拥有 process lifecycle。
5. Relay-owned Telegram 和飞书/Lark ingress 进入浏览器 message 共用的 relay message queue。
6. `runtime-state.json` 只拥有本地跨进程协调状态。
7. `legax.relay/1` 拥有可迁移 task/session 事实。
8. 支持时，approval decision 必须通过原生结构化 callback 返回。
9. PTY/TUI control 只作为 fallback，并且必须记录为 high-trust remote terminal control。
10. 远端 workflow execution 限于 allowlisted command ref，不接受任意 shell。

## Consequences

- 贡献者必须更新共享 helper，而不是新增并行 parser、状态文件或 transport-specific routing path。
- 新增依赖需要显式架构讨论，不能只基于局部便利。
- 新 adapter 必须符合 daemon supervision 模型和 adapter conformance checklist。
- 新 relay API 必须记录 auth class、request/response shape、error behavior 和 state ownership。
- 某些集成需要更多前置协议工作，因为 UI automation 不能作为 approval 的快捷路径。

## Reopen When

只有在以下情况出现时才重新评估本 ADR：

- Node 标准库无法提供受支持功能所需的安全关键 primitive。
- 稳定 config schema 超出手写 YAML 子集，且迁移成本合理。
- 某个主要受支持 CLI 只暴露 terminal interface 且无结构化协议，同时项目接受已文档化 high-trust backend 的风险。
- Relay store 获得正式多版本 migration system，并改变 state ownership 规则。
