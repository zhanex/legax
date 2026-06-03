# 变更矩阵

[English](CHANGE_MATRIX.md) | 简体中文

在阅读 [LLM 上下文](context_for_llms.zh-CN.md) 后使用本矩阵。上下文路由归 LLM 上下文维护；本文只把变更路径映射到聚焦验证。

代码变更后始终运行 `npm run check:node`。文档、示例配置或 skill 文本变更后始终运行 `npm run check:docs`。声称分支可合并前运行 `npm run ci`，除非明确说明未运行原因。

| 变更文件 | 聚焦验证 |
| --- | --- |
| `scripts/*-link.mjs`、`scripts/codex-attach.mjs`、adapter E2E 文件 | 对应 `node --test tests/e2e/<adapter>.e2e.mjs`，然后 `npm run check:node` |
| `scripts/legax-daemon.mjs`、`scripts/daemon-control.mjs` | `node --test tests/e2e/daemon.e2e.mjs tests/e2e/runtime-state.e2e.mjs`，然后 `npm run check:node` |
| `scripts/mcp-server.mjs`、`scripts/claude-permission-mcp-server.mjs`、`.mcp.json` | `node --test tests/e2e/mcp-server.e2e.mjs tests/e2e/claude-permission-mcp.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/adapter-contract.mjs`、`scripts/lib/codex-features.mjs` | Adapter 相关 E2E、`node --test tests/e2e/daemon.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/runtime-state.mjs` | `node --test tests/e2e/runtime-state.e2e.mjs tests/e2e/daemon.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/menu-groups.mjs`、`scripts/lib/project-browser.mjs` | `node --test tests/e2e/daemon.e2e.mjs tests/e2e/relay.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/relay-server-core.mjs`、`self-hosted-relay/server.mjs`、`self-hosted-relay/lib/relay-server-core.mjs` | `node --test tests/e2e/relay.e2e.mjs`，加相关 relay 功能测试，然后 `npm run check:node` |
| `scripts/lib/outbound-transports.mjs`、`scripts/lib/inbound-transports.mjs`、`scripts/lib/telegram-transport.mjs`、飞书/Lark transport 代码 | `node --test tests/e2e/inbound-transports.e2e.mjs tests/e2e/feishu-transport.e2e.mjs tests/e2e/relay.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/yaml.mjs`、`self-hosted-relay/lib/yaml.mjs`、`config.example.yaml`、`config.example.zh-CN.yaml`、`self-hosted-relay/config.example.yaml`、`self-hosted-relay/config.example.zh-CN.yaml` | `npm run check:docs`、相关配置消费 E2E，然后 `npm run check:node` |
| `scripts/lib/legax-protocol.mjs` | `node --test tests/e2e/legax-protocol.e2e.mjs tests/e2e/relay.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/checkpoint-artifacts.mjs` | `node --test tests/e2e/checkpoint-artifacts.e2e.mjs tests/e2e/relay.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/lps-actions.mjs`、workflow definition、workflow API 代码 | `node --test tests/e2e/lps-tdd-actions.e2e.mjs tests/e2e/workflows.e2e.mjs tests/e2e/relay.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/worktree-lite.mjs`、worktree CLI 行为 | `node --test tests/e2e/legax-cli.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/paths.mjs`、install-mode 路径、package bin | `node --test tests/e2e/install-mode.e2e.mjs tests/e2e/workspace-packages.e2e.mjs`，然后 `npm run check:node` |
| `scripts/legax-cli.mjs`、`scripts/relay-setup.mjs`、`scripts/simple-relay-server.mjs`、`scripts/configure-telegram-chat.mjs`、`scripts/smoke-test.mjs`、`scripts/real-local-message-smoke.mjs` | `node --test tests/e2e/legax-cli.e2e.mjs tests/e2e/install-mode.e2e.mjs`；真实本地消息行为变更时运行 `npm run test:real:messages`，然后 `npm run check:node` |
| `scripts/lib/version.mjs`、`scripts/check-workspace-versions.mjs`、`packages/*`、`scripts/package-workspace.mjs`、version metadata | `npm run check:versions`、`npm run test:pack`；打包行为变更时运行 `npm run release:dry-run` |
| `scripts/check-docs.mjs`、`scripts/check-doc-context-budget.mjs` | `npm run check:docs`、`node --test tests/e2e/docs.e2e.mjs tests/e2e/docs-context-budget.e2e.mjs`，然后 `npm run check:node` |
| `.codex-plugin/*`、`.agents/plugins/*`、`skills/legax/*` | `node --test tests/e2e/plugin-manifest.e2e.mjs tests/e2e/mcp-server.e2e.mjs`，然后 `npm run check:docs` |
| `.github/workflows/*`、CI 或安全 workflow 文件 | `node --test tests/e2e/workflows.e2e.mjs`，然后 `npm run check:docs` |
| `self-hosted-relay/install.sh`、`self-hosted-relay/uninstall.sh`、service 文件 | `npm run check:shell`、`node --test tests/e2e/install-mode.e2e.mjs` |
| `self-hosted-relay/lib/lps-actions.mjs`、`self-hosted-relay/lib/menu-groups.mjs`、`self-hosted-relay/lib/outbound-transports.mjs`、`self-hosted-relay/lib/paths.mjs`、`self-hosted-relay/lib/telegram-transport.mjs` | Source 与 deployable copy 行为检查，然后 `npm run check:node` |
| `docs/*`、`README*`、`.github/*.md`、`examples/**/*.md` | `npm run check:docs`；文档 gate 行为变更时运行 `node --test tests/e2e/docs.e2e.mjs` |

## 审查说明

- 如果一个变更命中多行，运行覆盖被改行为的聚焦测试并集。
- 如果某行指向 `self-hosted-relay/lib/*`，同时更新匹配的 source 文件和 standalone copy。
- 如果新增脚本或 E2E 文件，先加入 `package.json` 显式列表，再运行 gate。
- 真实外部 CLI 覆盖仍通过 `LEGAX_REAL_CLIENTS=1 npm run test:e2e:real` 选择性运行。
