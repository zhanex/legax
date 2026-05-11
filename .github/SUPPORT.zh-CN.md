# 支持说明

[English](SUPPORT.md) | 简体中文

## 去哪里提问

- Bug 和可复现失败：提交 GitHub issue，附上日志、已移除密钥的配置片段、操作系统、Node 版本和涉及的 Agent CLI。
- 功能请求：提交 GitHub issue，说明工作流、transport 和期望的用户交互。
- 文档修复：修法明确时直接提交 PR；行为不明确时先开 issue。
- 安全问题：不要开公开 issue。请按照 [SECURITY.zh-CN.md](SECURITY.zh-CN.md) 处理。

## 需要提供什么

- 运行过的命令。
- 预期行为和实际行为。
- 相关 adapter：Codex、Claude Code、Gemini CLI、relay、Telegram、webhook 或 MCP。
- 已脱敏的日志或 payload。移除 bot token、relay 密钥、webhook URL、chat ID，以及不应公开的本地会话内容。

## 支持范围

维护者支持 Legax 本身。上游 Agent CLI bug、Telegram 故障、反向代理配置和操作系统服务管理器问题，可能需要上游或平台侧支持。
