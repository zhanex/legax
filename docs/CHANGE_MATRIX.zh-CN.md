# 变更矩阵

[English](CHANGE_MATRIX.md) | 简体中文

在阅读 `AGENTS.md` 和 [LLM 上下文](context_for_llms.zh-CN.md) 后，用这张矩阵为变更选择最小有用上下文和验证集合。它是路由辅助，不替代更深入的契约文档。

代码变更后始终运行 `npm run check:node`。文档、示例配置或 skill 文本变更后始终运行 `npm run check:docs`。声称分支可合并前运行 `npm run ci`，除非明确说明为什么没有运行。

| 变更文件 | 必读文档 | 聚焦验证 |
| --- | --- | --- |
| `scripts/*-link.mjs`、`scripts/codex-attach.mjs`、adapter E2E 文件 | `docs/ADAPTERS.zh-CN.md`、`docs/ADAPTER_CONFORMANCE.zh-CN.md`、`docs/EXTENDING.zh-CN.md`、`docs/STATE_MACHINES.zh-CN.md` | 对应的 `node --test tests/e2e/<adapter>.e2e.mjs`，然后 `npm run check:node` |
| `scripts/legax-daemon.mjs`、`scripts/daemon-control.mjs` | `docs/ARCHITECTURE.zh-CN.md`、`docs/RUNTIME_STATE.zh-CN.md`、`docs/STATE_MACHINES.zh-CN.md`、`docs/OBSERVABILITY.zh-CN.md` | `node --test tests/e2e/daemon.e2e.mjs tests/e2e/runtime-state.e2e.mjs`，然后 `npm run check:node` |
| `scripts/mcp-server.mjs`、`scripts/claude-permission-mcp-server.mjs`、`.mcp.json` | `docs/CODEX_PLUGIN.zh-CN.md`、`docs/ARCHITECTURE.zh-CN.md`、`docs/OBSERVABILITY.zh-CN.md`、`skills/legax/SKILL.zh-CN.md` | `node --test tests/e2e/mcp-server.e2e.mjs tests/e2e/claude-permission-mcp.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/adapter-contract.mjs`、`scripts/lib/codex-features.mjs` | `docs/ARCHITECTURE.zh-CN.md`、`docs/ADAPTER_CONFORMANCE.zh-CN.md`、`docs/EXTENDING.zh-CN.md`、`docs/COMPATIBILITY.zh-CN.md` | Adapter 相关 E2E 测试、`node --test tests/e2e/daemon.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/runtime-state.mjs` | `docs/RUNTIME_STATE.zh-CN.md`、`docs/STATE_MACHINES.zh-CN.md` | `node --test tests/e2e/runtime-state.e2e.mjs tests/e2e/daemon.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/menu-groups.mjs`、`scripts/lib/project-browser.mjs` | `docs/ARCHITECTURE.zh-CN.md`、`docs/FUNCTIONAL_BOUNDARIES.zh-CN.md`、`docs/CONFIGURATION.zh-CN.md`、`docs/STATE_MACHINES.zh-CN.md` | `node --test tests/e2e/daemon.e2e.mjs tests/e2e/relay.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/relay-server-core.mjs`、`self-hosted-relay/server.mjs`、`self-hosted-relay/lib/relay-server-core.mjs` | `docs/RELAY_API.zh-CN.md`、`docs/RELAY_STORE.zh-CN.md`、`docs/LEGAX_PROTOCOL.zh-CN.md`、`docs/OBSERVABILITY.zh-CN.md` | `node --test tests/e2e/relay.e2e.mjs`，加相关功能的 relay 测试，然后 `npm run check:node` |
| `scripts/lib/outbound-transports.mjs`、`scripts/lib/inbound-transports.mjs`、`scripts/lib/telegram-transport.mjs`、飞书/Lark transport 代码 | `docs/ARCHITECTURE.zh-CN.md`、`docs/CONFIGURATION.zh-CN.md`、`docs/FEISHU_LARK.zh-CN.md`、`docs/COMPATIBILITY.zh-CN.md` | `node --test tests/e2e/inbound-transports.e2e.mjs tests/e2e/feishu-transport.e2e.mjs tests/e2e/relay.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/i18n.mjs`、`self-hosted-relay/lib/i18n.mjs` | `docs/CONFIGURATION.zh-CN.md`、`docs/DOCUMENTATION.zh-CN.md`、`docs/RELAY_API.zh-CN.md` | `node --test tests/e2e/relay-ui-interactions.e2e.mjs tests/e2e/daemon.e2e.mjs`、`npm run check:docs`，然后 `npm run check:node` |
| `scripts/lib/relay-ui-actions.mjs`、`self-hosted-relay/lib/relay-ui-actions.mjs` | `docs/RELAY_API.zh-CN.md`、`docs/FUNCTIONAL_BOUNDARIES.zh-CN.md`、`docs/LEGAX_PROTOCOL.zh-CN.md` | `node --test tests/e2e/relay-ui-interactions.e2e.mjs tests/e2e/relay.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/yaml.mjs`、`self-hosted-relay/lib/yaml.mjs`、`config.example.yaml`、`config.example.zh-CN.yaml`、`self-hosted-relay/config.example.yaml`、`self-hosted-relay/config.example.zh-CN.yaml` | `docs/CONFIGURATION.zh-CN.md`、`docs/DOCUMENTATION.zh-CN.md` | `npm run check:docs`，相关消费配置的 E2E 测试，然后 `npm run check:node` |
| `scripts/lib/legax-protocol.mjs` | `docs/LEGAX_PROTOCOL.zh-CN.md`、`docs/RELAY_API.zh-CN.md`、`docs/RELAY_STORE.zh-CN.md` | `node --test tests/e2e/legax-protocol.e2e.mjs tests/e2e/relay.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/checkpoint-artifacts.mjs` | `docs/LEGAX_PROTOCOL.zh-CN.md`、`docs/RELAY_STORE.zh-CN.md`、`docs/RELAY_API.zh-CN.md` | `node --test tests/e2e/checkpoint-artifacts.e2e.mjs tests/e2e/relay.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/lps-actions.mjs`、workflow definition、workflow API 代码 | `docs/LEGAX_PROTOCOL.zh-CN.md`、`docs/RELAY_API.zh-CN.md`、`docs/RELAY_STORE.zh-CN.md`、`docs/STATE_MACHINES.zh-CN.md` | `node --test tests/e2e/lps-tdd-actions.e2e.mjs tests/e2e/workflows.e2e.mjs tests/e2e/relay.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/worktree-lite.mjs`、worktree CLI 行为 | `docs/LEGAX_PROTOCOL.zh-CN.md`、`docs/FUNCTIONAL_BOUNDARIES.zh-CN.md`、`docs/ENGINEERING_GUIDE.zh-CN.md` | `node --test tests/e2e/legax-cli.e2e.mjs`，然后 `npm run check:node` |
| `scripts/lib/paths.mjs`、install-mode 路径、package bin | `docs/CONFIGURATION.zh-CN.md`、`docs/RELEASE.zh-CN.md` | `node --test tests/e2e/install-mode.e2e.mjs tests/e2e/workspace-packages.e2e.mjs`，然后 `npm run check:node` |
| `scripts/legax-cli.mjs`、`scripts/relay-setup.mjs`、`scripts/simple-relay-server.mjs`、`scripts/configure-telegram-chat.mjs`、`scripts/smoke-test.mjs`、`scripts/real-local-message-smoke.mjs` | `docs/USER_MANUAL.zh-CN.md`、`docs/AI_INSTALL.zh-CN.md`、`docs/CONFIGURATION.zh-CN.md`、`docs/OBSERVABILITY.zh-CN.md` | `node --test tests/e2e/legax-cli.e2e.mjs tests/e2e/install-mode.e2e.mjs`；真实本地消息行为变化时运行 `npm run test:real:messages`，然后 `npm run check:node` |
| `scripts/lib/version.mjs`、`scripts/check-workspace-versions.mjs`、`packages/*`、`scripts/package-workspace.mjs`、version metadata | `docs/RELEASE.zh-CN.md`、`docs/DOCUMENTATION.zh-CN.md` | `npm run check:versions`、`npm run test:pack`；打包行为变化时运行 `npm run release:dry-run` |
| `scripts/check-docs.mjs` | `docs/DOCUMENTATION.zh-CN.md`、`docs/README.zh-CN.md` | `npm run check:docs`、`node --test tests/e2e/docs.e2e.mjs`，然后 `npm run check:node` |
| `.codex-plugin/*`、`.agents/plugins/*`、`skills/legax/*` | `docs/CODEX_PLUGIN.zh-CN.md`、`docs/DOCUMENTATION.zh-CN.md`、`skills/legax/SKILL.zh-CN.md` | `node --test tests/e2e/plugin-manifest.e2e.mjs tests/e2e/mcp-server.e2e.mjs`，然后 `npm run check:docs` |
| `.github/workflows/*`、CI 或安全 workflow 文件 | `.github/CONTRIBUTING.zh-CN.md`、`docs/RELEASE.zh-CN.md`、`docs/DOCUMENTATION.zh-CN.md` | `node --test tests/e2e/workflows.e2e.mjs`，然后 `npm run check:docs` |
| `self-hosted-relay/install.sh`、`self-hosted-relay/uninstall.sh`、service 文件 | `docs/USER_MANUAL.zh-CN.md`、`docs/RELEASE.zh-CN.md`、`self-hosted-relay/README.zh-CN.md` | `npm run check:shell`、`node --test tests/e2e/install-mode.e2e.mjs` |
| `self-hosted-relay/lib/lps-actions.mjs`、`self-hosted-relay/lib/menu-groups.mjs`、`self-hosted-relay/lib/outbound-transports.mjs`、`self-hosted-relay/lib/paths.mjs`、`self-hosted-relay/lib/telegram-transport.mjs` | `docs/ENGINEERING_GUIDE.zh-CN.md`，以及上方匹配的 source 文件行 | Source 与可部署副本行为检查，然后 `npm run check:node` |
| `docs/*`、`README*`、`.github/*.md`、`examples/**/*.md` | `docs/DOCUMENTATION.zh-CN.md`、`docs/README.zh-CN.md` | `npm run check:docs`；文档门禁行为变化时运行 `node --test tests/e2e/docs.e2e.mjs` |

## 审查说明

- 如果一个变更命中多行，加载相关文档的并集，并运行覆盖被改行为的聚焦测试并集。
- 如果某行指向 `self-hosted-relay/lib/*`，同时更新匹配的 source 文件和 standalone 副本。
- 如果新增脚本或 E2E 文件，先追加到 `package.json` 的显式清单，再运行门禁。
- 真实外部 CLI 覆盖仍通过 `LEGAX_REAL_CLIENTS=1 npm run test:e2e:real` 选择性运行。
