# AI Install Guide

English | [Simplified Chinese](AI_INSTALL.zh-CN.md)

This guide is written for an AI assistant or automation agent that is installing Legax for a human operator. Follow it as an execution checklist. Do not invent missing secrets, domains, chat ids, or infrastructure decisions.

For the human-facing walkthrough, see [User Manual](USER_MANUAL.md). For internals, see [Architecture](ARCHITECTURE.md), [Security Policy](../.github/SECURITY.md), [Privacy Notice](PRIVACY.md), and [Configuration Examples](../config.example.yaml).

## Operating Rules

- Never print real tokens, relay secrets, Feishu/Lark app secrets, webhook secrets, cookies, or full private config files.
- Never commit `config.yaml`, runtime `data/`, logs, local package tarballs, or generated machine config.
- Use YAML only. JSON config is intentionally unsupported.
- Put runtime state under `LEGAX_HOME` or another operator-owned ignored path.
- Stop and ask the human before creating DNS records, exposing a port, rotating a secret, changing npm auth, or choosing a Telegram or Feishu/Lark chat target.
- Do not claim success until the validation signals in this guide pass.

## Inputs to Collect

Ask for these values only when they are not discoverable locally:

| Input | Required when | Example placeholder |
| --- | --- | --- |
| Deployment mode | Always | `local-all-in-one` or `split-relay-daemon` |
| `LEGAX_HOME` | Operator wants a non-default runtime directory | `/opt/legax` or `C:\Users\USER\AppData\Roaming\Legax` |
| Public relay URL | Phone or Telegram must reach the relay outside localhost | `https://YOUR_RELAY_HOST` |
| Relay secret | Split deployment or existing relay | `replace-with-a-long-random-secret` |
| Telegram bot token | Telegram transport is enabled | `TELEGRAM_BOT_TOKEN` |
| Telegram chat id | Telegram transport is enabled | `123456789` |
| Feishu/Lark app id, app secret, receive id, verification token | Feishu/Lark transport is enabled | `FEISHU_APP_ID`, `FEISHU_CHAT_ID` |
| Agent CLIs to enable | Real agent routing is needed | `codex`, `claude`, `gemini`, `opencode` |

## Phase 1: Discover the Environment

Run:

```bash
node --version
npm --version
npm config get registry
npm whoami
```

Expected:

- Node major version is 18 or newer.
- npm registry is reachable.
- `npm whoami` may fail on machines that only install public packages; this is not fatal for installation.

Check available agent CLIs. It is acceptable for unused CLIs to be missing:

```bash
codex --version
claude --version
gemini --version
opencode --version
```

On Windows, if `codex` is blocked by the shell, plan to set this in `config.yaml`:

```yaml
codex:
  command: codex.cmd
```

## Phase 2: Select Runtime Paths

If the operator gives a runtime directory, set `LEGAX_HOME` for the current shell and for the future service or daemon environment.

PowerShell:

```powershell
$env:LEGAX_HOME = "C:\Users\USER\AppData\Roaming\Legax"
```

POSIX shell:

```bash
export LEGAX_HOME="$HOME/.config/legax"
```

Default config paths when `LEGAX_HOME` is not set:

- Windows: `%APPDATA%\Legax\config.yaml`
- macOS: `~/Library/Application Support/Legax/config.yaml`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/legax/config.yaml`

Stop if the chosen path is inside a Git repository that may be committed.

## Phase 3A: Local All-in-One Install

Use this for a single-machine setup:

```bash
npm install -g legax
legax init
legax doctor --offline
```

Expected:

- `legax init` prints the created config path.
- `legax doctor --offline` exits 0 only when enabled adapters have available commands and required local config exists.

If `legax init` reports that config already exists, do not overwrite it with `--force` unless the human explicitly approves.

Start the relay:

```bash
legax relay start
```

If the phone is not on the same machine, do not rely on a `127.0.0.1` pair URL. Use the split deployment path or configure a reachable HTTPS relay URL first.

In another terminal, start the daemon:

```bash
legax daemon start
```

Pair a phone browser:

```bash
legax daemon pair
```

Validation:

```bash
legax doctor
legax daemon status
```

The phone should open the pair URL and show the Legax relay page.

## Phase 3B: Split Relay and Daemon Install

Use this when the relay runs on a public server and the daemon runs on the development machine.

Relay server:

```bash
npm install -g @legax/relay
```

Generate relay config and HTTPS reverse-proxy guidance with the full CLI when available:

```bash
npm install -g legax
legax relay init --domain YOUR_RELAY_HOST
```

Expected generated artifacts:

- A relay config file, commonly copied to `/etc/legax-relay/config.yaml`.
- A Caddyfile that reverse proxies `YOUR_RELAY_HOST` to the local relay port.
- A daemon config snippet containing the same relay secret.

Start the relay:

```bash
legax-relay --config /etc/legax-relay/config.yaml
```

Validate the public relay:

```bash
curl https://YOUR_RELAY_HOST/health
```

Expected response contains:

```json
{"ok":true}
```

Development machine:

```bash
npm install -g legax
legax init
```

Prefer the full `legax` package on the development machine. If the human requires the daemon-only package, install `@legax/daemon`, copy or generate `config.yaml` separately, and use `legax-daemon-control start`, `legax-daemon-control status`, and `legax-daemon-control pair`.

Update the daemon config with the relay URL and secret from the relay server:

```yaml
relay:
  publicBaseUrl: https://YOUR_RELAY_HOST
transports:
  - name: self-hosted-relay
    type: relay
    enabled: true
    baseUrl: https://YOUR_RELAY_HOST
    secret: replace-with-the-same-relay-secret
```

Validate and start:

```bash
legax doctor
legax daemon start
legax daemon pair
```

## Phase 4: Telegram Transport

Only enable Telegram when the human provides a bot token and approves the target chat.

Required steps:

1. Human creates a bot with BotFather.
2. Human sends `/start` or any message to the bot.
3. Configure the Telegram transport in `config.yaml` with `botToken` and `chatId`.
4. Run `legax doctor` and confirm `telegram.transport` is `OK`.

Source checkout helper:

```bash
node scripts/configure-telegram-chat.mjs
```

Installed package path:

- Use Telegram Bot API `getUpdates` to read the numeric chat id, or run the source helper with `LEGAX_CONFIG` pointing at the active config.

Telegram Mini App project selection also requires:

```yaml
relay:
  publicBaseUrl: https://YOUR_RELAY_HOST
```

Stop if the only available URL is `localhost`, a private LAN IP, or plain HTTP.

## Phase 4A: Feishu/Lark Transport

Only enable Feishu/Lark when the human provides self-built app credentials, approves the receive chat, and has a public HTTPS relay URL for event callbacks.

Required steps:

1. Human creates a Feishu/Lark self-built app and enables bot capability.
2. Human grants the app permission to message the target chat.
3. Configure the `feishu` transport in `config.yaml` with `appId`, `appSecret`, `receiveId`, and `verificationToken`.
4. Configure the app event subscription request URL as `https://YOUR_RELAY_HOST/api/feishu/events?sessionId=default`.
5. Confirm a test message or approval card reaches the chat and returns through the relay.

Set `platform: lark` or `apiBaseUrl: https://open.larksuite.com` for Lark global.

## Phase 5: Validation Signals

Collect these signals before reporting success:

```bash
legax doctor --offline
legax doctor
legax daemon status
curl https://YOUR_RELAY_HOST/health
```

For a local-only relay, replace the public curl with:

```bash
curl http://127.0.0.1:8787/health
```

A successful setup has:

- `config.file` is `OK`.
- Relay transport has a configured secret.
- Relay health is `OK` when not offline.
- Enabled adapter commands are `OK`, or intentionally disabled.
- Telegram transport is `OK` when enabled.
- Feishu/Lark transport has app credentials, receive id, and verification token when enabled.
- `legax daemon pair` prints a pairing code and pair URL.
- A phone browser, Telegram, or Feishu/Lark round trip reaches the daemon.

## Failure Handling

| Failure | Action |
| --- | --- |
| Node is older than 18 | Stop and ask the human to upgrade Node. |
| npm install fails with auth or registry errors | Stop and ask about npm registry or proxy policy. |
| Config already exists | Read only non-secret structure if needed; do not overwrite without approval. |
| Relay health fails | Check process, port, firewall, DNS, TLS, and reverse proxy. |
| Secret mismatch is suspected | Ask the human to compare or rotate secrets; do not print them. |
| Telegram chat id is missing | Ask the human to message the bot, then discover the numeric chat id. |
| Feishu/Lark callback is unauthorized | Check the configured verification token and request URL; do not print the token. |
| Agent CLI missing | Install the CLI only if requested, or disable the adapter. |
| Codex app-server visibility is missing | Follow the README Codex shared app-server setup; do not assume the desktop embedded server is shared. |

## Success Report Template

Report only redaction-safe facts:

```text
Legax install completed.
- Config path: <path>
- Deployment: <local-all-in-one|split-relay-daemon>
- Relay health: <ok|failed|not checked>
- Daemon status: <running|not running>
- Enabled agents: <list>
- Phone path: <browser pairing|telegram|feishu/lark|webhook>
- Remaining operator actions: <none or list>
```
