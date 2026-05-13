# 使用条款

[English](TERMS.md) | 简体中文

Legax 是按 [MIT 协议](../LICENSE)发布的开源软件。本文是项目对使用方式的非法律性概述，正式法律文本以 MIT 协议为准。

## 接受

安装、运行或修改 Legax 即视为接受 [LICENSE](../LICENSE) 及下列使用预期。

## 预期用途

本软件用于把桌面编码 Agent CLI 桥接到手机端通道（self-hosted relay、Telegram bot、飞书/Lark 自建应用 bot、webhook），**面向单个运维者自己的桌面会话**。常见用例：

- 把 Agent 状态与审批请求镜像到运维者手机。
- 不在键盘前时回复 Agent 或审批其动作。
- 基于 MCP 能力工具搭建更上层的工作流。

## 禁止的使用方式

- 禁止用于未经同意的人员监视（例如把他人的 Agent 流量路由到你的手机）。
- 禁止用于绕过组织的安全控制。审批镜像行为意在把决策展示给运维者，而非自动放行原生安全提示。
- 禁止在 fork、截图、bug 报告中再分发 Telegram bot token、飞书/Lark 应用凭据、relay 密钥或其他凭据。一旦暴露请先轮换。
- 禁止把本软件标榜为带有托管产品级保证或 SLA 的产品。维护者不运行任何后端。

## 无保证

如 MIT 协议所述，软件按"现状"提供，不含任何形式保证。维护者对宕机、数据丢失、安全事件，以及通过 relay 做出的审批决策的下游影响概不负责。

## 第三方服务

启用第三方 transport（Telegram Bot API、飞书/Lark 自建应用 bot、webhook 端点）时，相关使用同时受其自身条款约束（例如 [Telegram 服务条款](https://telegram.org/tos)）。Legax 不减损、不改变这些条款。

## 商标

"Codex"、"Claude"、"Gemini" 是各自所有者的商标。Legax 不附属于、未被认可于、也未被赞助于 Anthropic、Google 或 OpenAI。仓库中的相关引用仅用于描述受支持的 CLI 集成。

## 变更

条款可随软件演进。变更在对应代码变更的同一次提交中落地，无单独通知机制；请通过仓库历史跟踪变更。

## 联系方式

条款与授权问题如不涉及敏感信息，请使用仓库 issue tracker。安全问题：参见 [`SECURITY.zh-CN.md`](../.github/SECURITY.zh-CN.md)。隐私问题：参见 [`PRIVACY.zh-CN.md`](PRIVACY.zh-CN.md)。
