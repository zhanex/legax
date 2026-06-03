# AGENTS.md

[English](AGENTS.md) | 简体中文

这是 AI 编码代理在 Legax 仓库中工作的指令契约。先读本文，再读 [LLM 上下文](docs/context_for_llms.zh-CN.md)。不要默认加载所有文档。

## 硬性规则

- 项目保持零依赖：只使用 Node 18+ 标准库；除非设计已被接受，不新增 npm 依赖、bundler 或 `node_modules`。
- 配置保持 YAML-only。使用 `scripts/lib/yaml.mjs`；不要随意增加 JSON 配置或 YAML 依赖。
- daemon 与 adapter 的跨进程协调状态只放在 `scripts/lib/runtime-state.mjs`；不要新增并列状态文件。
- MCP 是能力层。MCP 工具可以通知、轮询、请求权限，但不能启动或停止 adapter 进程。
- 不得模拟 UI 点击、自动批准原生提示，或绕过 agent 安全策略。
- 不得把远程 workflow 输入路由到任意 shell、`eval`、脚本、prompt、command 或自由可执行参数。
- 文档必须成对维护：英文 `.md` 对应 `.zh-CN.md`，`config.example*.yaml` 对应 `config.example*.zh-CN.yaml`。
- 被跟踪的文档和带注释示例必须使用 UTF-8 且不带 BOM；不要通过依赖本地代码页的 shell 编码重写它们。
- 不要把实现计划、草稿、临时说明、审计笔记或 agent 执行记录提交为跟踪文档。
- 新增脚本或 E2E 文件时，必须加入 `package.json` 的显式 `check:node` 或 `test:e2e` 列表。

## 上下文加载

- 任务路由和 canonical owner 以 [docs/context_for_llms.zh-CN.md](docs/context_for_llms.zh-CN.md) 为准。
- 默认读取英文文档；只有翻译、中文文档修改或双语一致性检查时才读取 `.zh-CN` 配对。
- 英文文档是 canonical contract；中文文档是本地化镜像。两者分歧时以英文为准，并同步更新两边。
- 非平凡代码变更按 `docs/context_for_llms.zh-CN.md` 选择最小任务上下文，再用 `docs/CHANGE_MATRIX.zh-CN.md` 选择聚焦验证。
- 如果其他文档与本文冲突，先停止并报告冲突。

## 命令

```bash
npm run ci
npm test
npm run check:node
npm run check:docs
npm run check:shell
npm run test:e2e
node --test tests/e2e/<name>.e2e.mjs
node scripts/legax-daemon.mjs --dry-run
```

`npm run ci` 是合并契约。聚焦修改先跑窄测试，再跑相关 broader gate。

## Git 与审查

- staging 前检查 `git status --short` 和完整 diff。
- 除非用户明确要求，不要回滚用户或无关本地改动。
- 不要 staging 本地运行产物、大二进制、`data/` 残留、机器配置、lock 文件或跟踪密钥。
- 提交或开 PR 前遵循 `.github/CONTRIBUTING.md`。
- 声称分支可合并前，运行 `npm run ci`，或明确说明没有运行的原因。
