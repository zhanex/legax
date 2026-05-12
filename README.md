# Legax

English | [Simplified Chinese](README.zh-CN.md)

Legax is a local-first remote interaction layer for coding agents and developer assistants. It lets a desktop agent send important events to a phone, receive phone replies, and resolve approval or user-input requests through self-hosted or third-party transports.

The project is agent-neutral. Codex, Claude Code, Gemini CLI, and OpenCode are first-class adapters, but the internal model is designed for more CLIs and runtimes.

![Legax overview](docs/image/legax-overview.png)

## What It Does

- Sends agent status, completion summaries, and approval requests to a phone.
- Accepts phone replies and routes them to the selected agent.
- Runs Codex, Claude Code, Gemini CLI, and OpenCode adapters in one local daemon.
- Provides a Codex plugin bundle with a skill and MCP tools for phone relay workflows.
- Supports a self-hosted relay, Telegram Bot API, and outbound webhooks.
- Keeps secrets in local YAML config files, not in tracked examples or environment fallbacks.

## Quick Start

Most users should install the all-in-one CLI package:

```bash
npm install -g legax
legax init
legax doctor --offline
legax relay start
legax daemon start
```

`legax init` writes `config.yaml` under the Legax home directory by default. Set `LEGAX_HOME` to choose a different operator-owned directory, or pass `--config <path>` for a single command.

For a step-by-step setup, read the [User Manual](docs/USER_MANUAL.md). For AI-assisted setup, copy this prompt into your coding agent:

```text
Install and configure Legax for me.

Use the AI-facing install guide as your execution checklist:
- If you are working in a local Legax checkout, read docs/AI_INSTALL.md.
- Otherwise, read https://github.com/zhanex/legax/blob/main/docs/AI_INSTALL.md.

Follow the guide exactly. Do not print secrets or commit local config/runtime files. Ask me before creating DNS records, exposing ports, rotating secrets, changing npm auth, or selecting a Telegram chat. Finish by running the validation commands from the guide and summarize the config paths, enabled transports, enabled agent CLIs, and any remaining manual steps.
```

## Codex Plugin

This repository is also structured as an installable Codex plugin:

- [`.codex-plugin/plugin.json`](.codex-plugin/plugin.json) is the plugin manifest.
- [`.mcp.json`](.mcp.json) registers the Legax MCP server.
- [`skills/legax/SKILL.md`](skills/legax/SKILL.md) tells Codex when and how to use the phone relay tools.
- [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json) exposes the root plugin through a repo marketplace for local or team testing.

See [Codex Plugin Guide](docs/CODEX_PLUGIN.md) for install commands, release-candidate checks, and the current official Plugin Directory status.

## Documentation

Start with [Documentation Index](docs/README.md).

| Need | Read |
| --- | --- |
| Install and operate Legax | [User Manual](docs/USER_MANUAL.md) |
| Ask an agent to install Legax | [AI Install Guide](docs/AI_INSTALL.md) |
| Understand adapter behavior | [Adapter Guide](docs/ADAPTERS.md) |
| Install or review the Codex plugin | [Codex Plugin Guide](docs/CODEX_PLUGIN.md) |
| Understand architecture | [Architecture](docs/ARCHITECTURE.md) |
| Understand product boundaries | [Functional Boundaries](docs/FUNCTIONAL_BOUNDARIES.md) |
| Extend the project | [Extending Legax](docs/EXTENDING.md) |
| Release packages | [Release Guide](docs/RELEASE.md) |

## Security and Privacy

Legax handles sensitive local agent context, approval requests, paths, and sometimes command output. The project does not operate a hosted backend, shared relay, or shared Telegram bot.

- Read the [Privacy Notice](docs/PRIVACY.md) for data handling.
- Read the [Security Policy](.github/SECURITY.md) for the threat model and vulnerability reporting.
- Never commit `config.yaml`, runtime `data/`, logs, local package tarballs, or generated machine config.
- Legax mirrors native approval prompts. It must not simulate UI clicks, auto-approve prompts, or bypass an agent's security policy.

## Development

This is a dependency-free Node.js project. Everything runs against the Node 18+ standard library.

```bash
npm run ci
```

`npm run ci` is the full merge gate. For targeted work, run the narrow regression tests first, then the relevant broader gate.

Common commands:

```bash
npm test
npm run check:node
npm run check:docs
npm run test:e2e
node scripts/legax-daemon.mjs --dry-run
```

If you add a new script or E2E file, append it to the explicit lists in `package.json`.

## Contributing

Read [Contributing](.github/CONTRIBUTING.md) before opening a PR. Bugs and feature requests belong in GitHub issues. Security reports must use the private process in [Security Policy](.github/SECURITY.md), not public issues.

Documentation and config examples ship as English and Simplified Chinese pairs. Run `npm run check:docs` after documentation changes.
