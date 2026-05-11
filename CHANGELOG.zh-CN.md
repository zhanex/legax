# 更新日志

[English](CHANGELOG.md) | 简体中文

项目的重要变更都应记录在这里。格式采用简化的 Keep a Changelog 风格；公开发布后版本号遵循 semver。

## Unreleased

## 0.0.2

- 整理 GitHub 仓库用于公开发布，包括文档目录布局清理和 npm Trusted Publishing workflow 支持。
- 更新 `legax`、`@legax/daemon` 和 `@legax/relay` 的后续发布元数据。

- 为公开开发补齐包元数据、社区文件、CI 文档和安全模型说明。
- 保持 `npm test` 作为本地代码门禁，`npm run ci` 作为包含文档检查的完整 CI 门禁。
- 文档改为描述当前浏览器配对模型，不再描述已移除的 phone-token 模型。
- 补充 Telegram 与 relay 文档，覆盖 Mini App 新项目选择、active session 流程和用户自有部署立场。
- 隔离 E2E 测试中的 Gemini MCP 配置写入，避免 Windows 上共享 `.gemini/settings.json` 造成竞争。
- 增加 npm installed-mode 快速开始、`legax relay` 打包入口和 tarball 安装烟测覆盖。
- 将 npm 发布拆分为 fixed-version workspaces：`legax`、`@legax/daemon`、`@legax/relay`，共享运行时模块随各包内置。
- 增加 `legax relay init`，用于生成公网 HTTPS relay 和 Caddy 反向代理部署指引。

## 0.0.1

- 初始实现 local-first relay、daemon、MCP、Telegram、Codex、Claude Code、Gemini CLI 和 self-hosted relay。
