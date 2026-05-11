# Security Policy

English | [Simplified Chinese](SECURITY.zh-CN.md)

Legax bridges a desktop coding agent to a phone, including approval decisions for shell commands and patches. Treat it as a sensitive component in your developer workflow.

## Threat Model

| Asset | Risk | Mitigation in this project |
| --- | --- | --- |
| Telegram bot token | Full takeover of the bot's chat surface; ability to impersonate the desktop agent on the phone | Stored inline in `config.yaml` (gitignored); no env layer; redaction patterns scan outbound text for accidental leaks |
| Self-hosted relay desktop secret | Anyone holding it can post events as the desktop or fetch phone replies | Constant-time compare; refusal to start without `relay.secret` set in `config.yaml` unless explicit `relay.allowInsecureDev: true`, in which case the relay binds to `127.0.0.1` only |
| Paired browser device cookie | Anyone holding an active paired-device cookie can read relay traffic for that browser session and submit phone-side replies or approvals | Browser access is paired with daemon-generated one-time codes; device tokens are stored only as relay-secret-derived hashes and can be revoked from the relay device list |
| Approval pipeline (Codex JSON-RPC, Claude permission MCP, Gemini approval mode) | Auto-approve of dangerous commands | Decisions are mirrored, never bypassed; `paused` and `monitor` modes hard-block phone approvals |
| `data/` runtime files (runtime-state, relay-store, mcp-state, relay-audit) | Leak of conversation cursors, queued relay messages, and audit metadata | Local filesystem only; gitignored; should be on the same trust boundary as `config.yaml` |

Out-of-scope (the project does not defend against these):

- A compromised desktop machine. The relay process and the agent CLIs run with the user's privileges; if those privileges are compromised, all approval decisions can be forged at the source.
- Compromise of the Telegram or webhook provider.
- Phone or browser compromise while a relay device remains paired. Revoke the paired browser device from the relay device list and rotate `relay.secret` if you suspect the desktop secret or relay store also leaked.
- Network-level eavesdropping when the relay is exposed without TLS termination.

## Hardening Checklist for Operators

- Run the self-hosted relay behind a TLS terminator (nginx, Caddy, Cloudflare Tunnel) when it is reachable outside `localhost`.
- Set `relay.secret` to a long random value (`openssl rand -base64 36`) and keep it on the desktop/daemon side only.
- Pair browsers with `npm run daemon:pair`; do not share the one-time pairing code outside the target device.
- Revoke lost, shared, or stale browser devices from the relay device list.
- Prefer header-based auth (`X-Legax-Secret`) for desktop-side relay API calls. Do not put secrets in URLs; query strings appear in proxy access logs and browser history.
- Keep the redaction patterns enabled (`security.redactByDefault: true`) and review them when you adopt new secret formats. The defaults cover OpenAI / Anthropic / GitHub / AWS / Slack / Telegram / generic `key=value` forms.
- Avoid `relay.allowInsecureDev: true` outside of throwaway local testing. When set, the relay binds to `127.0.0.1` and prints a startup warning, but it accepts unauthenticated requests from anything that can reach the loopback interface (which on shared dev hosts may be more than you).
- Treat `tests/e2e/real-clients.e2e.mjs` as a privileged test: it spawns real `codex`, `claude`, and `gemini` processes against your local credentials.
- Do not commit `config.yaml`, `.claude/settings.local.json`, `.gemini/settings.json`, or anything in `data/`. The `.gitignore` covers these; `npm run check:docs` additionally scans tracked documentation for Telegram bot tokens, OpenAI-style keys, and GitHub PATs.

## Reporting a Vulnerability

Do **not** open a public GitHub issue for security reports.

Use GitHub private vulnerability reporting for this repository when available. If it is not enabled, contact the repository owner through their GitHub profile and ask for a private disclosure channel before sending exploit details. Include:

- A description of the issue and the affected file paths.
- A minimal reproduction (commands, sample payloads, or test case).
- Your assessment of impact (confidentiality / integrity / availability).
- Whether you are willing to be credited in the eventual disclosure.

We aim to acknowledge within 5 business days and to resolve or mitigate within 30 days for high-severity issues. Coordinated disclosure timing is negotiable.

## Known Limitations Tracked Publicly

- Relay audit is metadata-oriented, append-only, and local to the relay host. It is not a remote device/session revocation system; tune `relay.audit.textPreview` or disable audit if metadata retention is not acceptable.
- Paired-browser revocation is relay-local. It invalidates browser device cookies stored in the relay store, but it does not rotate `relay.secret` or credentials held by third-party transports such as Telegram.
- Cross-process state coordination uses a lockfile (`scripts/lib/runtime-state.mjs`); a stale lockfile from a crashed process is recovered after a bounded retry, not by external lock cleanup.

These are tracked as project limitations rather than vulnerabilities; if you can demonstrate exploitation of one, please report through the private vulnerability reporting process described above.
