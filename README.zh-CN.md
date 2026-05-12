# Legax

[English](README.md) | 简体中文

Legax 是一个 local-first 的远程交互层，服务于编码 Agent 和开发助手。它可以把桌面 Agent 的重要事件发送到手机，接收手机回复，并通过自托管或第三方传输通道处理审批和用户输入请求。

名称 `Legax` 来自 `Local-first Embedded Gateway for Agent eXchange`。Legax 不是托管 IDE、终端替代品或编程客户端。真实编码流程仍然留在 Codex、Claude Code、Gemini CLI、OpenCode、编辑器、终端和 Git 托管平台中。

项目保持 Agent 中立。Codex、Claude Code、Gemini CLI 和 OpenCode 是当前的首批适配器，但内部模型可以继续扩展到更多 CLI 和运行时。

![Legax 项目概览](docs/image/legax-overview.png)

## 功能

- 将 Agent 状态、完成摘要和审批请求发送到手机。
- 接收手机回复，并路由到选中的 Agent。
- 在一个本地 daemon 中运行 Codex、Claude Code、Gemini CLI 和 OpenCode 适配器。
- 提供 Codex 插件包，包含 skill 和 MCP 工具，用于手机 relay 工作流。
- 支持自托管 relay、Telegram Bot API 和 outbound webhook。
- 将密钥保存在本地 YAML 配置中，不写入受跟踪的示例文件，也不依赖环境变量兜底。

## 快速开始

多数用户应安装一体化 CLI 包：

```bash
npm install -g legax
legax init
legax doctor --offline
legax relay start
legax daemon start
```

`legax init` 默认会在 Legax home 目录下写入 `config.yaml`。可以设置 `LEGAX_HOME` 选择其他由操作者拥有的目录，也可以对单次命令传入 `--config <path>`。

逐步安装请阅读[用户手册](docs/USER_MANUAL.zh-CN.md)。如果希望让 AI 助手执行安装，把下面这段提示词复制给你的编码 Agent：

```text
Install and configure Legax for me.

Use the AI-facing install guide as your execution checklist:
- If you are working in a local Legax checkout, read docs/AI_INSTALL.md.
- Otherwise, read https://github.com/zhanex/legax/blob/main/docs/AI_INSTALL.md.

Follow the guide exactly. Do not print secrets or commit local config/runtime files. Ask me before creating DNS records, exposing ports, rotating secrets, changing npm auth, or selecting a Telegram chat. Finish by running the validation commands from the guide and summarize the config paths, enabled transports, enabled agent CLIs, and any remaining manual steps.
```

## Codex 插件

本仓库也已经按可安装 Codex 插件组织：

- [`.codex-plugin/plugin.json`](.codex-plugin/plugin.json) 是插件清单。
- [`.mcp.json`](.mcp.json) 注册 Legax MCP server。
- [`skills/legax/SKILL.md`](skills/legax/SKILL.md) 告诉 Codex 何时以及如何使用手机 relay 工具。
- [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json) 通过仓库 marketplace 暴露根目录插件，便于本地或团队测试。

安装命令、发布候选检查项和当前官方 Plugin Directory 状态见 [Codex 插件指南](docs/CODEX_PLUGIN.zh-CN.md)。

## 文档

先阅读[文档索引](docs/README.zh-CN.md)。

| 需求 | 阅读 |
| --- | --- |
| 安装和运行 Legax | [用户手册](docs/USER_MANUAL.zh-CN.md) |
| 让 Agent 帮你安装 Legax | [AI 安装指南](docs/AI_INSTALL.zh-CN.md) |
| 理解适配器行为 | [适配器指南](docs/ADAPTERS.zh-CN.md) |
| 安装或审查 Codex 插件 | [Codex 插件指南](docs/CODEX_PLUGIN.zh-CN.md) |
| 理解架构 | [架构](docs/ARCHITECTURE.zh-CN.md) |
| 理解产品边界 | [功能边界](docs/FUNCTIONAL_BOUNDARIES.zh-CN.md) |
| 扩展项目 | [扩展 Legax](docs/EXTENDING.zh-CN.md) |
| 发布包 | [发布指南](docs/RELEASE.zh-CN.md) |

## 安全与隐私

Legax 会处理敏感的本地 Agent 上下文、审批请求、路径，有时还包括命令输出。项目维护者不运营托管后端、共享 relay 或共享 Telegram bot。

- 数据处理见[隐私说明](docs/PRIVACY.zh-CN.md)。
- 威胁模型和漏洞报告流程见[安全策略](.github/SECURITY.zh-CN.md)。
- 不要提交 `config.yaml`、运行时 `data/`、日志、本地包 tarball 或生成的机器配置。
- Legax 只镜像原生审批提示。它不能模拟 UI 点击、自动批准提示，或绕过 Agent 的安全策略。

## 开发

这是一个零依赖 Node.js 项目。所有内容都基于 Node 18+ 标准库运行。

```bash
npm run ci
```

`npm run ci` 是完整合并门禁。做定向修改时，先跑窄回归测试，再跑相关的更大门禁。

常用命令：

```bash
npm test
npm run check:node
npm run check:docs
npm run test:e2e
node scripts/legax-daemon.mjs --dry-run
```

如果新增脚本或 E2E 文件，需要追加到 `package.json` 中的显式列表。

## 贡献

提交 PR 前请阅读[贡献指南](.github/CONTRIBUTING.zh-CN.md)。Bug 和功能请求使用 GitHub issue。安全报告必须使用[安全策略](.github/SECURITY.zh-CN.md)中的私密流程，不要开公开 issue。

文档和配置示例必须成对提供英文与简体中文版本。修改文档后运行 `npm run check:docs`。
