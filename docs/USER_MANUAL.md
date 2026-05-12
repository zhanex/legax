# User Manual

English | [Simplified Chinese](USER_MANUAL.zh-CN.md)

This manual is the shortest safe path from a fresh machine to a working Legax deployment. Use it when you want to install Legax, start a relay, connect a phone, and verify that phone replies can reach your local agent daemon.

For implementation details, see [Architecture](ARCHITECTURE.md), [Functional Boundaries](FUNCTIONAL_BOUNDARIES.md), [Security Policy](../.github/SECURITY.md), and [Privacy Notice](PRIVACY.md).

## Choose a Deployment

| Deployment | Use it when | Packages |
| --- | --- | --- |
| Local all-in-one | You are trying Legax on one machine, or your relay does not need public access yet. | `legax` |
| Split relay and daemon | You have a public VPS, NAS, or server for the relay, and a separate development machine for agent CLIs. | `@legax/relay` on the server, `legax` or `@legax/daemon` on the development machine |

The relay must be reachable from the phone. Telegram Mini App project selection requires a public `https://` `relay.publicBaseUrl`.

## Before You Start

Install or prepare:

- Node.js 18 or newer.
- npm access to the public npm registry.
- At least one supported agent CLI if you want real agent routing: Codex, Claude Code, Gemini CLI, or OpenCode.
- A local directory for Legax runtime files. Set `LEGAX_HOME` if you do not want the platform default.
- A long relay secret. `legax init` and `legax relay init` can generate one for you.
- Optional: your own Telegram bot token from BotFather and the numeric Telegram chat id that should receive messages.

Default config locations:

- Windows: `%APPDATA%\Legax\config.yaml`
- macOS: `~/Library/Application Support/Legax/config.yaml`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/legax/config.yaml`

Never commit `config.yaml`. It contains local secrets and is intentionally ignored by the repository.

## Local All-in-One Setup

Install the all-in-one CLI:

```bash
npm install -g legax
```

Initialize the local operator config:

```bash
legax init
```

Run an offline diagnostic before starting anything:

```bash
legax doctor --offline
```

Expected result:

- `node.version` is `OK`.
- `config.file` is `OK`.
- Enabled adapter command checks are either `OK` for CLIs you installed or `ERROR` for CLIs you still need to install or disable.
- Relay network health is skipped in offline mode.

Start the relay in one terminal:

```bash
legax relay start
```

The default relay transport may point at `127.0.0.1`, which only works from the same machine. For a real phone on another network, use the split deployment path or change the relay URL to a reachable HTTPS endpoint.

Start the daemon in a second terminal:

```bash
legax daemon start
```

Create a browser pairing code after the relay is running:

```bash
legax daemon pair
```

Open the printed pair URL from your phone, or scan the printed QR code. The pair URL expires quickly; rerun `legax daemon pair` when needed.

Run a full diagnostic after the relay is reachable:

```bash
legax doctor
```

## Optional Codex Plugin

Install the Codex plugin when you want Codex to have the Legax skill and MCP tools available from the plugin directory. The plugin does not start the daemon or create operator config; keep the CLI setup above as the runtime path.

From a local checkout:

```bash
codex plugin marketplace add .
```

Then restart Codex, choose the `Legax Plugins` marketplace, and install `Legax`. See [Codex Plugin Guide](CODEX_PLUGIN.md) for release-candidate and Git-backed install notes.

## Split Relay and Daemon Setup

Use this layout when the phone needs a stable public relay URL while the agent CLIs run on a private development machine.

On the relay server, install the relay package:

```bash
npm install -g @legax/relay
```

If the full `legax` CLI is available on any machine, generate relay config and Caddy guidance:

```bash
npm install -g legax
legax relay init --domain YOUR_RELAY_HOST
```

Copy the generated relay config to the relay server. A common server path is:

```text
/etc/legax-relay/config.yaml
```

Start the relay:

```bash
legax-relay --config /etc/legax-relay/config.yaml
```

Expose it through HTTPS. With Caddy, use the generated Caddyfile or create a reverse proxy like:

```text
YOUR_RELAY_HOST {
  reverse_proxy 127.0.0.1:8787
}
```

Check the public relay health endpoint:

```bash
curl https://YOUR_RELAY_HOST/health
```

Expected response includes:

```json
{"ok":true}
```

On the development machine, install and initialize Legax:

```bash
npm install -g legax
legax init
```

The full `legax` package is recommended on the development machine because it includes `init`, `doctor`, relay helpers, daemon control, and pairing commands. If you install only `@legax/daemon`, generate or copy `config.yaml` separately, then use `legax-daemon-control start`, `legax-daemon-control status`, and `legax-daemon-control pair` instead of the `legax daemon ...` wrapper.

Edit the development machine `config.yaml` and make the relay settings match the server:

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

Run diagnostics and start the daemon:

```bash
legax doctor
legax daemon start
```

Pair the phone from the development machine:

```bash
legax daemon pair
```

## Telegram Setup

Telegram is optional. Use it when you want bot messages, replies, and Mini App entry points.

1. Create a bot with BotFather and copy the bot token.
2. Open the bot in Telegram and send `/start` or any message.
3. Add the token and chat id to the Telegram transport in `config.yaml`.
4. Keep `config.yaml` local and gitignored.

When working from a source checkout, the helper can discover the latest chat id after the bot receives a message:

```bash
node scripts/configure-telegram-chat.mjs
```

If you are using an installed npm package, either run the helper from a cloned source checkout with `LEGAX_CONFIG` pointing at your active config, or read the chat id from Telegram Bot API `getUpdates`.

For Telegram Mini App project selection, also configure:

```yaml
relay:
  publicBaseUrl: https://YOUR_RELAY_HOST
```

The value must be public HTTPS, not `localhost`, a private LAN address, or plain HTTP.

## First Phone Interaction

After the relay and daemon are running:

1. Pair the browser with `legax daemon pair`, or open the Telegram bot.
2. Select the target agent if more than one adapter is enabled.
3. Send a short reply from the phone.
4. Confirm the daemon receives and routes the message.
5. Trigger an approval from the agent and confirm that Legax mirrors the native approval request instead of bypassing it.

Legax only mirrors native approval prompts and sends the returned decision through supported structured paths. It must not simulate UI clicks or auto-approve agent security prompts.

## Health Checks

Use these checks during setup:

```bash
legax doctor --offline
legax doctor
legax daemon status
curl https://YOUR_RELAY_HOST/health
```

`legax doctor` is redaction-safe: it reports whether secrets are configured without printing the secret values.

## Troubleshooting

| Symptom | Check | Fix |
| --- | --- | --- |
| Relay health fails | `curl https://YOUR_RELAY_HOST/health` | Start `legax-relay`, check firewall rules, and check the HTTPS reverse proxy. |
| Relay rejects messages | Relay secret mismatch | Use the same long secret in the relay config and daemon `transports` entry. |
| `legax doctor` says Telegram chat id is missing | Telegram transport has `botToken` but no `chatId` | Send a message to the bot, then discover and set the numeric `chatId`. |
| Mini App project selection does not open | `relay.publicBaseUrl` is private or not HTTPS | Set a public `https://` URL and expose the relay through a trusted certificate. |
| Agent command is missing | `legax doctor` adapter command check is `ERROR` | Install the CLI, put it on `PATH`, or disable that adapter in `config.yaml`. |
| Codex activity is not visible locally | Codex app-server is not shared | Start or attach to the shared app-server flow documented in the README. The desktop app embedded stdio server is not shared. |
| Windows cannot run `codex` from the daemon | PowerShell execution policy blocks the shim | Set `codex.command: codex.cmd` in `config.yaml`. |
| Daemon says it is already running | Stale or active pid file | Run `legax daemon status`, then `legax daemon stop` if you intend to restart it. |

## Next Reading

- [Architecture](ARCHITECTURE.md) for control, capability, and communication planes.
- [Legax Protocol](LEGAX_PROTOCOL.md) for cross-adapter event contracts.
- [Functional Boundaries](FUNCTIONAL_BOUNDARIES.md) for what Legax does and does not own.
- [Privacy Notice](PRIVACY.md) for data handling.
- [Terms of Use](TERMS.md) for operator responsibilities.
