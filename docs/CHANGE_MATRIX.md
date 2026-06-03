# Change Matrix

English | [Simplified Chinese](CHANGE_MATRIX.zh-CN.md)

Use this matrix after [Context For LLMs](context_for_llms.md). Context routing lives there; this file only maps changed paths to focused verification.

Always run `npm run check:node` after code changes and `npm run check:docs` after documentation, example config, or skill text changes. Run `npm run ci` before claiming a branch is merge-ready unless you state why it was not run.

| Changed files | Focused verification |
| --- | --- |
| `scripts/*-link.mjs`, `scripts/codex-attach.mjs`, adapter E2E files | Matching `node --test tests/e2e/<adapter>.e2e.mjs`, then `npm run check:node` |
| `scripts/legax-daemon.mjs`, `scripts/daemon-control.mjs` | `node --test tests/e2e/daemon.e2e.mjs tests/e2e/runtime-state.e2e.mjs`, then `npm run check:node` |
| `scripts/mcp-server.mjs`, `scripts/claude-permission-mcp-server.mjs`, `.mcp.json` | `node --test tests/e2e/mcp-server.e2e.mjs tests/e2e/claude-permission-mcp.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/adapter-contract.mjs`, `scripts/lib/codex-features.mjs` | Adapter-specific E2E tests, `node --test tests/e2e/daemon.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/runtime-state.mjs` | `node --test tests/e2e/runtime-state.e2e.mjs tests/e2e/daemon.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/menu-groups.mjs`, `scripts/lib/project-browser.mjs` | `node --test tests/e2e/daemon.e2e.mjs tests/e2e/relay.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/relay-server-core.mjs`, `self-hosted-relay/server.mjs`, `self-hosted-relay/lib/relay-server-core.mjs` | `node --test tests/e2e/relay.e2e.mjs`, plus feature-specific relay tests, then `npm run check:node` |
| `scripts/lib/outbound-transports.mjs`, `scripts/lib/inbound-transports.mjs`, `scripts/lib/telegram-transport.mjs`, Feishu/Lark transport code | `node --test tests/e2e/inbound-transports.e2e.mjs tests/e2e/feishu-transport.e2e.mjs tests/e2e/relay.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/yaml.mjs`, `self-hosted-relay/lib/yaml.mjs`, `config.example.yaml`, `config.example.zh-CN.yaml`, `self-hosted-relay/config.example.yaml`, `self-hosted-relay/config.example.zh-CN.yaml` | `npm run check:docs`, relevant config-consuming E2E tests, then `npm run check:node` |
| `scripts/lib/legax-protocol.mjs` | `node --test tests/e2e/legax-protocol.e2e.mjs tests/e2e/relay.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/checkpoint-artifacts.mjs` | `node --test tests/e2e/checkpoint-artifacts.e2e.mjs tests/e2e/relay.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/lps-actions.mjs`, workflow definitions, workflow API code | `node --test tests/e2e/lps-tdd-actions.e2e.mjs tests/e2e/workflows.e2e.mjs tests/e2e/relay.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/worktree-lite.mjs`, worktree CLI behavior | `node --test tests/e2e/legax-cli.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/paths.mjs`, install-mode paths, package bins | `node --test tests/e2e/install-mode.e2e.mjs tests/e2e/workspace-packages.e2e.mjs`, then `npm run check:node` |
| `scripts/legax-cli.mjs`, `scripts/relay-setup.mjs`, `scripts/simple-relay-server.mjs`, `scripts/configure-telegram-chat.mjs`, `scripts/smoke-test.mjs`, `scripts/real-local-message-smoke.mjs` | `node --test tests/e2e/legax-cli.e2e.mjs tests/e2e/install-mode.e2e.mjs`, `npm run test:real:messages` when real local messaging changes, then `npm run check:node` |
| `scripts/lib/version.mjs`, `scripts/check-workspace-versions.mjs`, `packages/*`, `scripts/package-workspace.mjs`, version metadata | `npm run check:versions`, `npm run test:pack`, `npm run release:dry-run` when packaging behavior changes |
| `scripts/check-docs.mjs`, `scripts/check-doc-context-budget.mjs` | `npm run check:docs`, `node --test tests/e2e/docs.e2e.mjs tests/e2e/docs-context-budget.e2e.mjs`, then `npm run check:node` |
| `.codex-plugin/*`, `.agents/plugins/*`, `skills/legax/*` | `node --test tests/e2e/plugin-manifest.e2e.mjs tests/e2e/mcp-server.e2e.mjs`, then `npm run check:docs` |
| `.github/workflows/*`, CI or security workflow files | `node --test tests/e2e/workflows.e2e.mjs`, then `npm run check:docs` |
| `self-hosted-relay/install.sh`, `self-hosted-relay/uninstall.sh`, service files | `npm run check:shell`, `node --test tests/e2e/install-mode.e2e.mjs` |
| `self-hosted-relay/lib/lps-actions.mjs`, `self-hosted-relay/lib/menu-groups.mjs`, `self-hosted-relay/lib/outbound-transports.mjs`, `self-hosted-relay/lib/paths.mjs`, `self-hosted-relay/lib/telegram-transport.mjs` | Source and deployable-copy behavior checks, then `npm run check:node` |
| `docs/*`, `README*`, `.github/*.md`, `examples/**/*.md` | `npm run check:docs`, and `node --test tests/e2e/docs.e2e.mjs` when docs gate behavior changes |

## Review Notes

- If a change touches more than one row, run the union of focused tests that cover the changed behavior.
- If a row points at `self-hosted-relay/lib/*`, update the matching source file and standalone copy together.
- If a change adds a new script or E2E file, append it to the explicit `package.json` lists before running the gate.
- Real external CLI coverage remains opt-in with `LEGAX_REAL_CLIENTS=1 npm run test:e2e:real`.
