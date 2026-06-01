# 贡献指南

[English](CONTRIBUTING.md) | 简体中文

感谢愿意贡献。项目体量小、风格固定、零依赖；下面的规矩就是为了让它保持这样。

## 提 PR 前

1. 跑一遍完整本地闸门：

   ```bash
   npm run ci
   ```

   `npm run ci` 会运行 `npm test` 和 `check:docs`。`npm test` 覆盖 `check:node`（语法）、`check:shell`（对安装器跑 `bash -n`）和 `test:e2e`（标准端到端套件）。`check:docs` 覆盖语言配对、密钥 pattern、乱码和 UTF-8 BOM 检查。CI 跑的就是 `npm run ci`。

2. 在 `scripts/` 或 `tests/e2e/` 下新增脚本，请**同时**把它追加到 `package.json` 对应清单里。清单是显式枚举，不是通配符。

3. 仅改文档时，本地跑 `npm run check:docs` 即可；但 PR 合并前仍需要通过完整 CI 闸门。

## 文档成对（硬性规则）

所有 `.md` 散文文档与每个 `config.example*.yaml` 文件必须成**语言对**：`*.md`（英文）与 `*.zh-CN.md`（简体中文），或 `config.example*.yaml` 与匹配的 `config.example*.zh-CN.yaml`。`check:docs` 强制此规则，缺一份就让 PR 红。

如果你写不了中文，请在 PR 标题加 `[needs-zh]`，并在 PR 里请人协助或本次 PR 不动文档。**不要**把英文段落复制到 `.zh-CN.md` 凑数。`check:docs` 会强制文件配对，并捕捉一部分编码/密钥错误，但翻译质量仍需要 reviewer 人工确认。

其它规则：

- 所有文档文件 UTF-8 **不带 BOM**。
- 任何已跟踪文件中不得出现真实的 Telegram bot token、OpenAI 风格 `sk-...` 密钥、GitHub PAT、AWS 凭据、relay 密钥。使用占位符如 `replace-with-a-long-random-secret`、`YOUR_RELAY_HOST`、`TELEGRAM_BOT_TOKEN`。文档闸门会扫这些 pattern。

## 代码风格

- 纯 JavaScript、ESM、仅用 Node 18+ 标准库。无 TypeScript 构建、无打包器、无 `node_modules`。
- 2 空格缩进、双引号、分号。优先匹配周围文件，不要引入新风格。
- 不要引入依赖。如果确实需要，请先开 issue 说明用标准库尝试过哪些方案。
- `scripts/` 下每个脚本都**可以独立运行**，不需要先 bootstrap 共享模块。`parseSimpleYaml` 早期被有意复制就是为此；现在的现代路径是共享解析器 `scripts/lib/yaml.mjs`——新脚本用它、动到旧脚本时顺手把内联副本删掉。
- 遵守[工程规范](../docs/ENGINEERING_GUIDE.zh-CN.md)中的命名、常量、目录职责、设计模式和禁止模式规则。新增硬编码行为值需要人工审查。

## 新增 Adapter

第一方 adapter 位于 `scripts/<agent>-link.mjs`，并通过 `scripts/lib/adapter-contract.mjs` 注册。新增 adapter 的路径：

1. 选 **CLI backend**。多数现代 CLI 提供 stream-json（行式 JSON over stdin/stdout）或 JSON-RPC 服务（stdio 或 websocket）。**不要**走 PTY / TUI 抓屏。
2. 定一个 **canonical 配置 key**（如 `aider`、`continue`）和默认 `agentId`。在 `config.example.yaml` 与对应 zh-CN 加一节。
3. Adapter 实现为常驻进程：读 `config.yaml`，持有一到多个 CLI 子进程，把入站手机消息翻译为 CLI 输入格式，把 CLI 结构化输出翻译为出站 transport 事件。
4. 复用共享模块：
   - `scripts/lib/yaml.mjs` 解析配置。
   - `scripts/lib/runtime-state.mjs` 处理 adapter 协同状态，例如游标、mode、队列、Telegram 选择。
   - `scripts/lib/outbound-transports.mjs` 发事件。
   - `scripts/lib/inbound-transports.mjs` 拉取手机回复。
5. 在 `scripts/lib/adapter-contract.mjs` 中注册，以便 daemon 监督。按需尊重 `autoStart`、`useExisting`、`mcpAutoConfigure` 和 adapter conformance checklist。
6. 在 `tests/e2e/<agent>-link.e2e.mjs` 加 E2E 测试，覆盖：stdin→relay 转发、relay→stdin 处理、mode 切换、（如有审批）审批往返。把它追加到 `package.json` 的 `test:e2e` 与 `check:node` 列表。

## 提交说明

短的祈使句标题，可选 body 说明 *why*。不强制 Conventional Commits，但建议加主题前缀（`relay:`、`codex:`、`daemon:`、`docs:`）。

## 在 PR 上自检

请求他人 review 前，**在 GitHub PR 的 diff 页面上**做一遍自检——不要只看本地 diff。GitHub 的 diff 页会暴露本地看不出来的东西（换行、文件移动、大块 hunk、误入库的文件）。具体动作：

- 在 `Files changed` 标签页逐个 hunk 重新读一遍，问自己一句"reviewer 能看懂这里**为什么**改吗？"
- 任何不显而易见的改动——出人意料的控制流、对外部 bug 的临时绕过、起承重作用的常量、某一条路径有意的回退——都**自己在那一行留一条 review comment**，写给将来的 reviewer。格式：一句 "why"，必要时附 issue id 或链接。
- 不要复述代码做了什么（代码自己会说）。只标注 *为什么*、*风险点*、*故意的怪异之处*。
- 显式检查有没有不该入库的文件（大二进制、`data/` 残留、机器相关配置、`.lock` 文件等）；发现就在 follow-up commit 里删掉，再 @reviewer。
- 确认 PR 描述用平铺直叙的话写出了"用户能看到的行为变化"。如果两句话讲不完，多半是这个 PR 装太多了。

这条规矩是为了缩短 review 延迟，不是为了表演用功。如果某行的"为什么"不是显而易见的，reviewer 就不该需要问出口——你自己的自评论应当先把答案写好。

## 上报问题

Bug 与功能请求：常规 GitHub issue。安全问题：**不要**开公开 issue，参见 [SECURITY.zh-CN.md](SECURITY.zh-CN.md)。

## 协议

贡献接受按本项目 [MIT 协议](../LICENSE)。提 PR 即表示你的贡献按同等条款授权。
