# Legax

English | [Simplified Chinese](README.zh-CN.md)

The name `Legax` expands to `Local-first Embedded Gateway for Agent eXchange`. It reflects the project's scope: a small local gateway that lets existing agent CLIs exchange messages, approvals, and session context with a phone without becoming a hosted IDE or a new agent platform.

Legax is a local-first remote interaction layer for coding agents and developer assistants. It lets a desktop agent send important events to a phone, receive phone replies, and resolve approval or user-input requests through self-hosted or third-party transports.

The project is agent-neutral. Codex, Claude Code, Gemini CLI, and OpenCode are first-class adapters, but the internal model is designed for more CLIs and runtimes.

## Architecture

The project uses a CLI + MCP model:

- CLI is the control plane. It owns process lifecycle, sessions, structured output parsing, task completion, and cancellation.
- MCP is the capability plane. It adds remote approval, remote input, and remote notification tools when an agent supports or needs them.
- Relay and third-party transports are the communication plane.
- TUI or PTY hosting is a fallback only. The default path stays structured CLI plus MCP capability tools.

See [Architecture](docs/ARCHITECTURE.md) and [Functional Boundaries](docs/FUNCTIONAL_BOUNDARIES.md) for details.

## Project Goal

Legax is a lightweight remote interaction layer for existing coding agents. It helps you select a CLI, project, and session from a phone or other mobile terminal, send short replies, review important messages, and approve native permission prompts while keeping the real coding workflow in your own agent, editor, terminal, and Git workflow.

Legax is built for mobile-first vibe coding, not for replacing your development environment. It is not a programming client, IDE, terminal replacement, or hosted agent platform. It does not provide, and does not plan to provide, a code editor, diff workspace, terminal emulator, or full web coding environment. Those capabilities belong in Codex, Claude Code, Gemini CLI, OpenCode, your editor, your terminal, and your Git hosting platform.

You can install any supported CLI plus Legax on your own VPS, NAS, Raspberry Pi, or other lightweight machine, then code comfortably from a mobile device. The expected workflow is simple: let the agent work remotely, review the resulting PR in Git, and avoid staying in front of a desktop just to keep the session moving.

## Privacy and Deployment Stance

Legax is designed around operator-owned infrastructure. Remote control touches sensitive session context, approval decisions, local project paths, and sometimes command output, so data security and privacy are part of the product boundary, not an optional add-on.

For that reason, the project does not currently provide an official shared relay service or official shared Telegram bot. The recommended setup is to deploy your own relay and create your own Telegram bot token. If there is strong demand later, the project may explore an official hosted option, but it is not the default or preferred deployment model today.

## Quick Start

Most users should install the all-in-one CLI package:

```bash
npm install -g legax
legax init
legax doctor --offline
legax relay start
legax daemon start
```

For a guided deployment path, see [User Manual](docs/USER_MANUAL.md). If an AI assistant is installing Legax for you, point it at [AI Install Guide](docs/AI_INSTALL.md).

`legax init` writes `config.yaml` under the Legax home directory by default. Set `LEGAX_HOME` to choose a different operator-owned directory, or pass `--config <path>` for a single command.

Legax is published as three fixed-version packages: `legax`, `@legax/daemon`, and `@legax/relay` always share the same version. For split deployments, install `@legax/relay` on the public server and `legax` or `@legax/daemon` on the development machine:

```bash
# relay server
npm install -g @legax/relay
legax-relay --config /path/to/relay.config.yaml

# development machine
npm install -g legax
legax relay init --domain relay.example.com
legax daemon start
```

## Features

- Send agent status, completion summaries, and approval requests to a phone.
- Accept phone replies and route them to the selected agent.
- Run Codex, Claude Code, Gemini CLI, and OpenCode adapters in one local daemon.
- Pair browsers with a short QR-based protocol offer instead of a memorized token.
- Open a new project from Telegram through the relay-hosted Mini App when HTTPS relay access and local project roots are configured.
- Query a unified attention inbox for approvals, input requests, errors, completions, and active context.
- Initialize and diagnose local installs with `legax init` and `legax doctor`.
- Create, check, list, and archive managed Git worktrees with `legax worktree`.
- Choose between interactive, approval-only, monitor, and paused modes per agent.
- Use a self-hosted relay, Telegram Bot API, or outbound webhooks.
- Keep configuration in YAML, with real secrets inline only in gitignored local config files.
- Use low-noise notifications by default for Codex: approvals and user-input prompts are immediate; normal agent text is sent when a turn completes.

## Layout

- `.codex-plugin/plugin.json`, `.mcp.json` — plugin manifest and MCP server registration.
- `config.example.yaml`, `config.example.zh-CN.yaml` — full YAML configuration templates.
- `examples/config.example.minimal.yaml` (+ zh-CN) — single-agent + single-transport quick-start template.
- `scripts/` — daemon, per-agent adapters, generic MCP server, self-hosted relay, CLI helpers.
- `scripts/lib/` — shared modules (YAML parser, Legax protocol, runtime state, transport plumbing).
- `self-hosted-relay/` — standalone Linux relay installer and service files.
- `skills/legax/` — MCP skill documentation surfaced to host agents.
- `tests/e2e/` — end-to-end tests for relay, adapters, and runtime state.
- `docs/` — user manual, AI install guide, architecture, functional boundaries, protocol, release process, roadmap, documentation standards, privacy notice, terms of use.
- `.github/` — CI workflow, contributing guide, security policy, support guide, code of conduct.

## Configuration

Create `config.yaml` from `config.example.yaml`, or let the CLI create a local copy with generated secrets:

```bash
legax init
```

JSON configuration is intentionally not supported.

> **Never commit `config.yaml`.** It usually contains a Telegram bot token, relay secret, or webhook secret. The file is ignored by `.gitignore`; if a real secret ever lands in a tracked file, rotate it before pushing. See [Local files and secrets](#local-files-and-secrets).

For concurrent Codex, Claude Code, Gemini, and OpenCode work, keep one shared `sessionId`, give each agent a stable `agentId`, and select the target agent in Telegram or the phone page before replying.

```yaml
sessionId: default
displayName: Desktop Agent

remote:
  enabled: true
  defaultMode: interactive
  pauseAll: false

approvals:
  enabled: true
  allowFromPhone: true
  timeoutMs: 300000
  defaultOnTimeout: deny

codex:
  enabled: true
  agentId: codex-cli
  agentLabel: Codex CLI
  cliBackend: app-server-ws
  useExisting: true
  appServerUrl: ws://127.0.0.1:18779/rpc
  sharedServerMode: connect-or-start
  autoStartSharedServer: true
  mcpEnabled: true
  mode: interactive

claude:
  enabled: true
  autoStart: true
  agentId: claude-code
  agentLabel: Claude Code
  supportsSessions: true
  cliBackend: stream-json
  useExisting: true
  continueLatest: true
  sessionListCwd: cwd
  mcpEnabled: true
  mcpAutoConfigure: true
  mcpRole: permission-prompt
  mode: approval-only

gemini:
  enabled: true
  autoStart: true
  agentId: gemini-cli
  agentLabel: Gemini CLI
  supportsSessions: true
  cliBackend: stream-json
  useExisting: true
  resumeExisting: latest
  sessionListArgs:
    - --list-sessions
  mcpEnabled: true
  mcpAutoConfigure: true
  mode: monitor

opencode:
  enabled: true
  autoStart: false
  agentId: opencode
  agentLabel: OpenCode
  supportsSessions: true
  cliBackend: server-http
  useExisting: true
  serverUrl: http://127.0.0.1:4096
  serverMode: connect-or-start
  mcpEnabled: false
  mode: monitor
```

Modes:

- `interactive`: forward output, accept phone text, and accept phone approval decisions.
- `approval-only`: forward output and approvals, but ignore phone text.
- `monitor`: forward output only.
- `paused`: ignore phone text and approval decisions until the mode changes again.

Startup behavior:

- `enabled: true` makes the adapter available in the phone or Telegram menu.
- `autoStart: true` starts the adapter when the daemon starts.
- `autoStart: false` keeps the adapter available but starts it only when a phone or Telegram action targets it.
- `mcpAutoConfigure: true` writes the required MCP config before launching Claude Code or Gemini CLI. Claude Code uses the configured `mcpConfigPath`; Gemini CLI defaults to `.gemini/settings.json` under its configured `cwd`. OpenCode uses its HTTP server for the current adapter and does not auto-write MCP config yet.
- `useExisting: true` avoids creating a fresh history target when the CLI supports reuse. Codex uses a shared `codex app-server --listen ws://...` backend and connects through `app-server-ws`; Claude Code adds `--continue` or `--resume`; Gemini CLI adds `--resume latest` unless a specific `resumeSession` is configured; OpenCode sends text to the selected server session through `/session/:id/message`.
- `supportsSessions: true` enables the session picker. Claude Code sessions are discovered from local persisted project history; Gemini CLI sessions are listed with `gemini --list-sessions`; OpenCode sessions are listed through its server API.
- For Codex local visibility, start Codex CLI with `codex --remote ws://127.0.0.1:18779`. The desktop app's embedded stdio app-server does not expose the local control socket by default; the shared websocket backend is the supported local multi-client path for this project.
- `gemini.trustWorkspace: true` is required for Gemini CLI headless/daemon runs unless the directory has already been trusted interactively. Only enable it for directories you would trust in Gemini CLI itself.
- Selecting Claude Code, Gemini CLI, or OpenCode from Telegram or the phone page activates `interactive` mode and returns a project/chat picker before the session list. `paused` remains a hard stop and must be changed with `/mode <agentId> interactive`.

Telegram's new-project flow requires an enabled relay transport, `relay.publicBaseUrl` set to a public HTTPS URL, and at least one readable `daemon.projectRoots` entry. If the relay is down, not HTTPS, only reachable as `localhost` / a private address, or missing project roots, the daemon replies in Telegram with the exact fix instead of opening a broken Mini App.

Normal relay messaging can work over a private HTTP URL for local development. The Telegram Mini App new-project picker cannot: it requires `relay.publicBaseUrl` to be a public `https://` URL.

## Self-hosted Relay

For a Linux server, use the standalone installer:

```bash
cd self-hosted-relay
sudo ./install.sh
```

For npm-based relay-only installs:

```bash
npm install -g @legax/relay
legax-relay --config /path/to/relay.config.yaml
```

For local development the relay reads its `host` / `port` / `secret` from the `relay:` section of `config.yaml` (no environment variables involved). Browsers pair with a short daemon-generated code:

```yaml
relay:
  host: 127.0.0.1
  port: 8787
  publicBaseUrl: https://YOUR_RELAY_HOST
  secret: replace-with-a-long-random-secret
```

Then start the relay:

```bash
node scripts/simple-relay-server.mjs
```

Browser pairing:

```bash
npm run daemon:pair
```

Scan the QR code printed by the command from the phone, or open `http://YOUR_RELAY_HOST:8787/` in the browser and enter the one-time pairing code manually. The QR contains a short-lived pairing offer with session id, pairing id, daemon public-key metadata, and nonce; it does not contain the relay desktop secret. Use HTTPS when exposing the relay outside a trusted LAN.

Health checks:

```bash
legax doctor
legax doctor --json
```

`doctor` checks the config file, relay health, Telegram configuration, and enabled adapter commands without printing secrets.

## Legax Protocol and Worktrees

The cross-adapter event contract is documented in [Legax Protocol](docs/LEGAX_PROTOCOL.md). It standardizes active context, approval requests, input requests, summaries, session lists, and attention items so new adapters do not need to mimic a specific CLI's native output.

The local worktree helper is intentionally small:

```bash
legax worktree list
legax worktree create --name fix-approval --base HEAD
legax worktree check --name fix-approval -- npm test
legax worktree archive --name fix-approval --delete-branch
```

Managed worktrees are created under `data/worktrees/`, and archive refuses to remove paths outside that directory.

## Telegram

Enable the Telegram transport in `config.yaml` and paste `botToken` / `chatId` inline. The project has no `.env` layer — every credential lives in `config.yaml` (which is gitignored).

Telegram outbound noise is controlled separately from the relay UI. The
effective policy is merged in this order: daemon-wide defaults, CLI-specific
defaults, then the remote transport's own settings.

```yaml
daemon:
  notifications:
    telegram:
      messageDetail: important   # all | important | actionable | final | none

claude:
  notifications:
    telegram:
      messageDetail: actionable

transports:
  - name: telegram
    type: telegram
    notifications:
      maxMessageChars: 3900      # split before Telegram's 4096 char limit
      splitLongMessages: true
      maxParts: 8
      perAgent:
        gemini-cli:
          messageDetail: final
```

`important` sends approval requests, user-input requests, menu/status actions,
errors, and final answers. `actionable` only sends items that need a reply or
button tap. The `perAgent` map scopes notification overrides to one CLI. Long
Telegram messages are HTML-formatted and split into multiple `sendMessage`
calls; overflow beyond `maxParts` is truncated with a notice.

Common commands:

```text
/start
/projects codex-cli
/sessions codex-cli
/sessions claude-code
/sessions gemini-cli
/sessions opencode
/use codex-cli 1
/new codex-cli
/new-project codex-cli
/mode codex-cli approval-only
/approve <requestId>
/deny <requestId>
/answer <requestId> <answer>
```

When the daemon is running, it owns Telegram `getUpdates` and relay inbound polling. Adapter processes only consume their per-agent inbox, so `/start`, session selection, and on-demand launches do not depend on Codex being alive.

Telegram flow:

1. `/start` returns the installed/enabled CLI adapters.
2. Tapping Codex, Claude Code, Gemini CLI, or OpenCode returns that adapter's project/chat picker. If the adapter is not running, the daemon starts it and preserves the original project-list request.
3. Tapping a project/chat returns the session list for that scope. `/sessions <agentId>` can also list sessions directly.
4. Tapping a session selects it and future phone text goes to that CLI/session. Completion, approval, and input-request notifications include session/project actions so you can switch back quickly.
5. Tapping **New project** or sending `/new-project <agentId>` runs the relay preflight and, when it passes, opens a Telegram Mini App project picker backed by the daemon's local `projectRoots`.

## Codex Bidirectional Visibility

Codex's `app-server` broadcasts thread / turn notifications to **all** WebSocket clients connected to the same backend. To make phone-driven turns appear in your local Codex TUI (and TUI-driven turns flow back to the phone), the daemon and the TUI must share one app-server. The launch order matters.

### Recommended setup (CLI TUI)

By default `codex.autoStart: false` — the daemon does **not** launch the codex adapter at boot. The daemon still handles the remote menu and routing itself; the shared `codex app-server` only comes up when you actually choose or message Codex. This matches the rest of the daemon's on-demand model and avoids stranded background processes if you never touch codex on a given session.

1. Start the daemon (no codex spawned yet):

   ```bash
   npm run daemon          # foreground, ctrl-C to stop
   # or: npm run daemon:bg
   ```

2. In a separate terminal, attach your TUI. The TUI starts before any phone message and is what triggers the shared backend on first turn:

   ```bash
   node scripts/codex-attach.mjs   # reads config.yaml, runs `codex --remote ws://...`
   ```

3. Send a phone message (or interact in the TUI). On the first activity routed to codex, the daemon launches the codex adapter, which performs `sharedServerMode: connect-or-start` against `appServerUrl`. The first phone-driven turn has slightly higher latency for this reason; subsequent turns are fast.

If you prefer the shared backend up at daemon boot (e.g., for early port-conflict diagnostics), set `codex.autoStart: true` in your `config.yaml`.

### Why the desktop app does not work the same way

The Codex desktop app embeds its own stdio app-servers per session window and does not accept `--remote`. There is no documented way today to make it share state with an external WebSocket app-server. OpenAI is actively building a `remote_control` framework for this purpose (visible in `codex features list` as `remote_control: under development`), but it has not graduated to stable as of this writing. See [docs/EXTENDING.md](docs/EXTENDING.md) for the long-term plan.

### Read-only fallback for desktop-app users

If you primarily use the Codex desktop app and only want the phone to **observe** activity (no remote control), enable the optional `codexDesktopMirror` adapter. It tails the desktop app's session JSONL files and forwards user/assistant messages, command runs, and tool calls to the phone. It cannot inject phone messages back into the desktop session — that is a Codex limitation, not a Legax one. See `config.example.yaml` for the section.

### Diagnostics — TUI does not refresh

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Phone sends a turn, TUI is silent | TUI was started without `--remote` (default stdio app-server). Two parallel codex backends, no shared state. | Stop the TUI, restart with `codex --remote ws://...` or use `codex-attach`. |
| Daemon prints "WebSocket handshake failed" | Stale `codex app-server` from a previous session is bound to the port. | `Stop-Process` / `kill` the orphan, or pick a new `appServerUrl` port. |
| TUI sees turns but phone never receives | daemon was not running when the TUI sent the turn, or `routing.defaultTarget` is unset. | Verify daemon is up; check `data/runtime-state.json` for cursors. |
| Approval prompt arrives on phone but pressing the button does nothing locally | The adapter restarted between request and decision; the in-memory `pendingApprovals` was lost. | Look at daemon stderr for the `[legax] orphan permission_decision` line; trigger the action again to receive a fresh prompt. |

## Running Adapters

The daemon supervises every enabled adapter from one process. Common life-cycle and pairing commands are packaged as npm scripts:

```bash
npm run daemon          # foreground, ctrl-C to stop. Use this while iterating on config/code.
npm run daemon:bg       # detach, write data/daemon.pid, redirect stderr to data/daemon.err.log
npm run daemon:status   # print the running pid (or "not running") and exit
npm run daemon:stop     # stop the daemon process tree and clean up the pid file (escalates after 5s)
npm run daemon:pair     # create a short-lived browser pairing code for the relay web UI
```

Why a pid file. The control script refuses to start a second daemon while a previous one is alive (no port collisions, no duplicate Telegram pollers). A stale `data/daemon.pid` from a crashed process is detected via `process.kill(pid, 0)` liveness check and cleaned up automatically on the next start.

Logs. Foreground mode inherits the terminal. Background mode appends stderr to `data/daemon.err.log` (no rotation today; rotate manually or with `logrotate` for long-running deployments). Adapters' own stderr is prefixed by adapter name (`[codex]`, `[claude]`, `[gemini]`, `[opencode]`).

Dry run (does not spawn anything; prints the resolved config):

```bash
node scripts/legax-daemon.mjs --dry-run
```

Run a single adapter without the daemon (no on-demand sibling launches in this mode):

```bash
node scripts/codex-app-server-link.mjs
node scripts/claude-code-link.mjs
node scripts/gemini-cli-link.mjs
node scripts/opencode-link.mjs
```

For local Codex visibility, see [Codex Bidirectional Visibility](#codex-bidirectional-visibility). On Windows, if direct `codex` calls are blocked by PowerShell execution policy, set `codex.command: codex.cmd` in `config.yaml`.

### When you actually need a system service

`npm run daemon:bg` is enough for "leave it running on my dev box." If you want it to survive reboots / be supervised by the OS:

- **Linux**: model your unit on `self-hosted-relay/legax-relay.service`. The daemon needs the repo as its working directory and `LEGAX_CONFIG` pointing at your `config.yaml`. Not shipped as an installer yet — track this if you need it.
- **macOS**: use a launchd plist that runs `node scripts/legax-daemon.mjs` with `WorkingDirectory` set to the repo.
- **Windows**: use NSSM or Task Scheduler. Background-detached `npm run daemon:bg` works for "log in and forget" but does not survive reboot.

## Permission Model

Legax does not bypass native security prompts. It mirrors approval requests to the phone, collects a decision, and returns that decision through the available structured path:

- Codex: App Server JSON-RPC approval callbacks.
- Claude Code: permission prompt MCP tool.
- Gemini CLI: Gemini's own approval mode; MCP capability tools can still be used for agent-initiated approval or input requests when supported.
- OpenCode: this adapter currently sends prompts and reads sessions through OpenCode's HTTP server. Permission callback bridging is not implemented yet, so do not rely on phone approvals for OpenCode-native permission prompts.

Phone approval decisions are only honored in `interactive` and `approval-only` modes.

## Testing

```bash
npm run ci
```

Run E2E only:

```bash
npm run test:e2e
```

Run optional real-client checks:

```bash
LEGAX_REAL_CLIENTS=1 npm run test:e2e:real
```

The suite covers relay auth and routing, MCP send and poll, Codex approvals and user-input requests, Claude permission MCP, Gemini stream-json bridging, OpenCode server API bridging, runtime state persistence, and daemon startup for concurrent adapters.

## CI

`npm run ci` runs locally and in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) on Linux against Node 18 / 20 / 22, plus a Windows Node 20 smoke matrix. The job runs `npm test` (`check:node`, `check:shell`, `test:e2e`) and then `check:docs`. The opt-in real-CLI suite (`LEGAX_REAL_CLIENTS=1 npm run test:e2e:real`) is not part of CI because it requires the actual `codex`, `claude`, and `gemini` binaries.

## Contributing

Contributions are welcome when they keep Legax lightweight, local-first, and agent-neutral. Good first areas are new structured CLI adapters, Telegram and relay UX polish, self-hosted deployment hardening, cross-platform daemon setup notes, and focused E2E coverage.

Read [CONTRIBUTING](.github/CONTRIBUTING.md) before opening a PR. Documentation and config examples ship as English and Simplified Chinese pairs, and the full local gate is `npm run ci`.

## Local files and secrets

The repository tracks templates and source only. The following are runtime artifacts and must stay out of version control — they are listed in `.gitignore`:

| Path | What's in it | Why it must not be committed |
| --- | --- | --- |
| `config.yaml` | Active configuration for the daemon, adapters, and relay. Holds the relay secret, Telegram `botToken` / `chatId`, webhook URLs — all inline. There is no `.env` layer. | Plaintext credentials |
| `data/` | `runtime-state.json`, `relay-store.json`, `mcp-state.json`, `relay-audit.jsonl`, e2e leftovers, daemon logs | Inbound message queues, relay event/message queues, audit metadata, conversation cursors |
| `.claude/settings.local.json` | Per-machine Claude Code MCP enablement | Anthropic convention is "local-only"; may include workspace-specific paths |
| `.gemini/settings.json` | Auto-written by `mcpAutoConfigure` | Contains absolute paths to your `node` binary |
| `/etc/legax-relay/config.yaml` (when self-hosted-relay is installed) | Standalone relay's own config (same `relay:` schema as the project root yaml) | Long random relay secret |
| Anything matching `*.secret`, `*.secret.*`, `secrets/` | Out-of-band secret material | Catch-all for future secret files |

If a secret ever leaks into a tracked file (config snapshot, log paste, screenshot, or commit message), **rotate it outside the repository first**, then scrub the file. `npm run check:docs` scans documentation for Telegram bot tokens (`\d{8,}:[A-Za-z0-9_-]{30,}`), OpenAI-style keys (`sk-...`), and GitHub PATs (`gh[pousr]_...`); run it before pushing changes.

For shareable templates, use the `*.example.*` pairs already in the repo (`config.example.yaml`, `config.example.zh-CN.yaml`) and never check in a populated counterpart.

## Documentation Standards

Documentation is split by language:

- English: `*.md`
- Simplified Chinese: `*.zh-CN.md`

Do not mix English and Chinese in the same prose document except for short cross-links. All documentation files must be UTF-8 without BOM. See [Documentation Standards](docs/DOCUMENTATION.md).
