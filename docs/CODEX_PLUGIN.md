# Codex Plugin Guide

English | [Simplified Chinese](CODEX_PLUGIN.zh-CN.md)

Legax ships as a Codex plugin bundle in this repository. The plugin packages:

- A manifest at [`../.codex-plugin/plugin.json`](../.codex-plugin/plugin.json).
- A repo marketplace at [`../.agents/plugins/marketplace.json`](../.agents/plugins/marketplace.json).
- A skill under [`../skills/legax/`](../skills/legax/).
- An MCP server registration in [`../.mcp.json`](../.mcp.json).
- Install-surface assets under [`../assets/`](../assets/).

The plugin does not replace the Legax daemon or relay packages. Use the plugin to give Codex the skill and MCP capability tools; use the npm packages to install and run the daemon, relay, and operator config.

## Install from a Local Checkout

From the repository root:

```bash
codex plugin marketplace add .
```

Restart Codex, open the plugin directory, choose the `Legax Plugins` marketplace, and install `Legax`.

If Codex already tracks this marketplace, refresh it after local changes:

```bash
codex plugin marketplace upgrade legax
```

## Install from GitHub

After the branch is merged, a user can add this repository as a Git-backed marketplace:

```bash
codex plugin marketplace add zhanex/legax --ref main
```

For a release branch or tag, replace `main` with the pinned ref. Pinning is recommended for teams that need reproducible plugin installs.

## Runtime Setup

The bundled `.mcp.json` runs:

```bash
node ./scripts/mcp-server.mjs
```

It intentionally does not set `LEGAX_CONFIG`. The server uses the default Legax config path unless the operator sets `LEGAX_CONFIG` outside the plugin.

Initialize the operator config and daemon separately:

```bash
npm install -g legax
legax init
legax doctor --offline
legax relay start
legax daemon start
```

If no operator config exists, the MCP server can still start, but transport calls will use example defaults and will not be useful for real phone routing.

## MCP Tool Review Metadata

The generic MCP server exposes:

| Tool | Read-only | Open world | Destructive | Reason |
| --- | --- | --- | --- | --- |
| `legax_send` | No | Yes | No | Sends an agent message to configured transports such as relay, Telegram, or webhook. |
| `legax_poll` | No | No | No | Polls replies and records local cursor/message state. |
| `legax_request_permission` | No | Yes | No | Sends a permission request to the phone and may wait for a decision. |
| `legax_status` | Yes | No | No | Reads redacted config and pending permission state; optional pings do not mutate state. |

Every tool declares an `outputSchema` and returns `structuredContent` alongside text content.

The Claude permission-prompt MCP server also declares explicit annotations and an output schema for its `approval_prompt` tool. It is configured by the daemon for Claude Code permission bridging, not by the root plugin `.mcp.json`.

## Release-Candidate Checklist

Before treating the plugin as a release candidate:

- `plugin.json` has stable publisher metadata, legal links, prompts, visual assets, and plugin component paths.
- `.mcp.json` does not point at a repo-local `config.yaml`.
- The repo marketplace contains `policy.installation`, `policy.authentication`, and `category`.
- All MCP tools declare `readOnlyHint`, `openWorldHint`, `destructiveHint`, and `outputSchema`.
- Root README links to setup, plugin, security, support, and contribution docs.
- English and Simplified Chinese documentation pairs are updated together.
- `npm run check:docs`, targeted MCP tests, and the full CI gate pass.

## Official Plugin Directory Status

OpenAI's Codex plugin documentation currently says official Plugin Directory self-serve publishing is coming soon. Until that opens, Legax should be distributed through a repo or personal marketplace and treated as publication-ready source material rather than a self-submitted official listing.

## Security Boundary

The plugin can send messages and permission requests to configured transports. It must not claim to bypass Codex, Claude Code, Gemini CLI, OpenCode, or host application approval policies.

Use `legax_request_permission` only for agent-mediated checks where the user wants phone confirmation. Native escalated approvals still follow the host application's security model.
