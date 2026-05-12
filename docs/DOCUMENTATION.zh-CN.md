# 文档规范

[English](DOCUMENTATION.md) | 简体中文

这些规则适用于 Legax 的正文文档、skill 文档，以及带注释的示例文件。

## 仓库形态

- 根目录 README 只聚焦项目做什么、为什么有用、如何开始、在哪里获得帮助，以及谁维护它。
- 较长的安装、架构、适配器、插件和维护者材料放到 `docs/` 下的聚焦文档中。
- 保持 `docs/README.md` 作为文档索引，让 GitHub 读者不必扫描整棵目录树。
- 将 community health 文件放在 `.github/`：贡献指南、行为准则、安全策略、支持说明、issue 表单和 PR 模板。
- 仓库内部文件使用相对链接，保证在 clone、branch 和 fork 中都能工作。

## 语言文件

- 英文文档使用 `*.md`。
- 简体中文文档使用 `*.zh-CN.md`。
- 根目录和特殊文件也遵循同样的配对规则，例如 `README.md` 与 `README.zh-CN.md`、`SKILL.md` 与 `SKILL.zh-CN.md`，以及每个 `config.example*.yaml` 与匹配的 `config.example*.zh-CN.yaml`。
- 除短语言切换链接、产品名、CLI 命令、API 名称、配置键和代码示例外，不要在同一份文档正文中混写中英文。
- 修改文档时，如果内容同时面向中英文用户，应在同一次变更中更新对应的语言版本。

## 编码

- 所有文档和带注释的示例文件必须使用 UTF-8 且不带 BOM。
- 避免使用会把 UTF-8 静默改写为本地代码页的编辑器或 shell 命令。
- 在 Windows PowerShell 5.1 中重写文件时，优先使用 Node.js、现代编辑器，或 `.NET` 的 `UTF8Encoding(false)`。
- 提交文档变更前运行 `npm run check:docs`。

## 版本引用

- 不要在 README 或 docs 正文中写死当前 package 版本。使用 package metadata、`latest`，或 `vX.Y.Z` 这类占位符。
- Changelog 标题可以保留已发布的历史版本，因为它们属于发布记录。

## 安全

- 不要把真实 bot token、API key、relay secret、已配对设备 cookie、chat ID、session secret 或用户凭据写入文档。
- 示例统一使用 `replace-with-a-long-random-secret`、`YOUR_RELAY_HOST`、`TELEGRAM_BOT_TOKEN` 这类占位符。
- 如果真实密钥已经出现在文档或示例中，应从文件中移除，并在仓库外完成轮换。

## 审查清单

- 英文和简体中文文件都存在。
- 两份文件描述的是同一套行为，并使用相同的配置键。
- 英文文件不包含中文正文。
- 中文文件不存在未翻译的英文段落。
- 语言版本之间的互链可用。
- 不存在乱码或替换字符。
- 文件开头没有 UTF-8 BOM。
- 当前 package 版本只出现在 changelog 历史记录中。
