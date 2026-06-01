# Change Matrix

English | [Simplified Chinese](CHANGE_MATRIX.zh-CN.md)

Use this matrix after `AGENTS.md` and [Context For LLMs](context_for_llms.md) to choose the smallest useful context and verification set for a change. It is a routing aid, not a replacement for the deeper contract documents.

Always run `npm run check:node` after code changes and `npm run check:docs` after documentation, example config, or skill text changes. Run `npm run ci` before claiming a branch is merge-ready unless you explicitly state why it was not run.

| Changed files | Required docs | Focused verification |
| --- | --- | --- |
| `scripts/*-link.mjs`, `scripts/codex-attach.mjs`, adapter E2E files | `docs/ADAPTERS.md`, `docs/ADAPTER_CONFORMANCE.md`, `docs/EXTENDING.md`, `docs/STATE_MACHINES.md` | Matching `node --test tests/e2e/<adapter>.e2e.mjs`, then `npm run check:node` |
| `scripts/legax-daemon.mjs`, `scripts/daemon-control.mjs` | `docs/ARCHITECTURE.md`, `docs/RUNTIME_STATE.md`, `docs/STATE_MACHINES.md`, `docs/OBSERVABILITY.md` | `node --test tests/e2e/daemon.e2e.mjs tests/e2e/runtime-state.e2e.mjs`, then `npm run check:node` |
| `scripts/mcp-server.mjs`, `scripts/claude-permission-mcp-server.mjs`, `.mcp.json` | `docs/CODEX_PLUGIN.md`, `docs/ARCHITECTURE.md`, `docs/OBSERVABILITY.md`, `skills/legax/SKILL.md` | `node --test tests/e2e/mcp-server.e2e.mjs tests/e2e/claude-permission-mcp.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/adapter-contract.mjs`, `scripts/lib/codex-features.mjs` | `docs/ARCHITECTURE.md`, `docs/ADAPTER_CONFORMANCE.md`, `docs/EXTENDING.md`, `docs/COMPATIBILITY.md` | Adapter-specific E2E tests, `node --test tests/e2e/daemon.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/runtime-state.mjs` | `docs/RUNTIME_STATE.md`, `docs/STATE_MACHINES.md` | `node --test tests/e2e/runtime-state.e2e.mjs tests/e2e/daemon.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/menu-groups.mjs`, `scripts/lib/project-browser.mjs` | `docs/ARCHITECTURE.md`, `docs/FUNCTIONAL_BOUNDARIES.md`, `docs/CONFIGURATION.md`, `docs/STATE_MACHINES.md` | `node --test tests/e2e/daemon.e2e.mjs tests/e2e/relay.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/relay-server-core.mjs`, `self-hosted-relay/server.mjs`, `self-hosted-relay/lib/relay-server-core.mjs` | `docs/RELAY_API.md`, `docs/RELAY_STORE.md`, `docs/LEGAX_PROTOCOL.md`, `docs/OBSERVABILITY.md` | `node --test tests/e2e/relay.e2e.mjs`, plus any feature-specific relay tests, then `npm run check:node` |
| `scripts/lib/outbound-transports.mjs`, `scripts/lib/inbound-transports.mjs`, `scripts/lib/telegram-transport.mjs`, Feishu/Lark transport code | `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`, `docs/FEISHU_LARK.md`, `docs/COMPATIBILITY.md` | `node --test tests/e2e/inbound-transports.e2e.mjs tests/e2e/feishu-transport.e2e.mjs tests/e2e/relay.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/yaml.mjs`, `self-hosted-relay/lib/yaml.mjs`, `config.example.yaml`, `config.example.zh-CN.yaml`, `self-hosted-relay/config.example.yaml`, `self-hosted-relay/config.example.zh-CN.yaml` | `docs/CONFIGURATION.md`, `docs/DOCUMENTATION.md` | `npm run check:docs`, relevant config-consuming E2E tests, then `npm run check:node` |
| `scripts/lib/legax-protocol.mjs` | `docs/LEGAX_PROTOCOL.md`, `docs/RELAY_API.md`, `docs/RELAY_STORE.md` | `node --test tests/e2e/legax-protocol.e2e.mjs tests/e2e/relay.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/checkpoint-artifacts.mjs` | `docs/LEGAX_PROTOCOL.md`, `docs/RELAY_STORE.md`, `docs/RELAY_API.md` | `node --test tests/e2e/checkpoint-artifacts.e2e.mjs tests/e2e/relay.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/lps-actions.mjs`, workflow definitions, workflow API code | `docs/LEGAX_PROTOCOL.md`, `docs/RELAY_API.md`, `docs/RELAY_STORE.md`, `docs/STATE_MACHINES.md` | `node --test tests/e2e/lps-tdd-actions.e2e.mjs tests/e2e/workflows.e2e.mjs tests/e2e/relay.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/worktree-lite.mjs`, worktree CLI behavior | `docs/LEGAX_PROTOCOL.md`, `docs/FUNCTIONAL_BOUNDARIES.md`, `docs/ENGINEERING_GUIDE.md` | `node --test tests/e2e/legax-cli.e2e.mjs`, then `npm run check:node` |
| `scripts/lib/paths.mjs`, install-mode paths, package bins | `docs/CONFIGURATION.md`, `docs/RELEASE.md` | `node --test tests/e2e/install-mode.e2e.mjs tests/e2e/workspace-packages.e2e.mjs`, then `npm run check:node` |
| `scripts/legax-cli.mjs`, `scripts/relay-setup.mjs`, `scripts/simple-relay-server.mjs`, `scripts/configure-telegram-chat.mjs`, `scripts/smoke-test.mjs`, `scripts/real-local-message-smoke.mjs` | `docs/USER_MANUAL.md`, `docs/AI_INSTALL.md`, `docs/CONFIGURATION.md`, `docs/OBSERVABILITY.md` | `node --test tests/e2e/legax-cli.e2e.mjs tests/e2e/install-mode.e2e.mjs`, `npm run test:real:messages` when real local messaging changes, then `npm run check:node` |
| `scripts/lib/version.mjs`, `scripts/check-workspace-versions.mjs`, `packages/*`, `scripts/package-workspace.mjs`, version metadata | `docs/RELEASE.md`, `docs/DOCUMENTATION.md` | `npm run check:versions`, `npm run test:pack`, `npm run release:dry-run` when packaging behavior changes |
| `scripts/check-docs.mjs` | `docs/DOCUMENTATION.md`, `docs/README.md` | `npm run check:docs`, `node --test tests/e2e/docs.e2e.mjs`, then `npm run check:node` |
| `.codex-plugin/*`, `.agents/plugins/*`, `skills/legax/*` | `docs/CODEX_PLUGIN.md`, `docs/DOCUMENTATION.md`, `skills/legax/SKILL.md` | `node --test tests/e2e/plugin-manifest.e2e.mjs tests/e2e/mcp-server.e2e.mjs`, then `npm run check:docs` |
| `.github/workflows/*`, CI or security workflow files | `.github/CONTRIBUTING.md`, `docs/RELEASE.md`, `docs/DOCUMENTATION.md` | `node --test tests/e2e/workflows.e2e.mjs`, then `npm run check:docs` |
| `self-hosted-relay/install.sh`, `self-hosted-relay/uninstall.sh`, service files | `docs/USER_MANUAL.md`, `docs/RELEASE.md`, `self-hosted-relay/README.md` | `npm run check:shell`, `node --test tests/e2e/install-mode.e2e.mjs` |
| `self-hosted-relay/lib/lps-actions.mjs`, `self-hosted-relay/lib/menu-groups.mjs`, `self-hosted-relay/lib/outbound-transports.mjs`, `self-hosted-relay/lib/paths.mjs`, `self-hosted-relay/lib/telegram-transport.mjs` | `docs/ENGINEERING_GUIDE.md`, plus the matching source-file row above | Source and deployable-copy behavior checks, then `npm run check:node` |
| `docs/*`, `README*`, `.github/*.md`, `examples/**/*.md` | `docs/DOCUMENTATION.md`, `docs/README.md` | `npm run check:docs`, and `node --test tests/e2e/docs.e2e.mjs` when docs gate behavior changes |

## Review Notes

- If a change touches more than one row, load the union of the listed docs and run the union of focused tests that cover the changed behavior.
- If a row points at `self-hosted-relay/lib/*`, update the matching source file and standalone copy together.
- If a change adds a new script or E2E file, append it to the explicit `package.json` lists before running the gate.
- Real external CLI coverage remains opt-in with `LEGAX_REAL_CLIENTS=1 npm run test:e2e:real`.
