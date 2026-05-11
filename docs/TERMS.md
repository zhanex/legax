# Terms of Use

English | [Simplified Chinese](TERMS.zh-CN.md)

Legax is open-source software distributed under the [MIT License](../LICENSE). This document is a brief, non-legal summary of how the project expects the software to be used. The MIT License is the authoritative legal text.

## Acceptance

By installing, running, or modifying Legax, you accept the terms in [LICENSE](../LICENSE) and the operational expectations described below.

## Intended Use

Legax is intended to bridge a desktop coding agent CLI to a phone-side surface (self-hosted relay, Telegram bot, or webhook) for **a single operator's own desktop sessions**. Typical uses:

- Mirroring agent status and approval requests to the operator's phone.
- Letting the operator reply to or approve agent actions while away from the keyboard.
- Building higher-level workflows on top of the MCP capability tools.

## Use You Must Not Make of This Software

- Do not use it to surveil people who have not consented (for example, by routing another developer's agent traffic to your phone without their knowledge).
- Do not use it to bypass an organization's security controls. The approval-mirror behavior intentionally surfaces decisions to the operator; it does not auto-approve native security prompts.
- Do not redistribute Telegram bot tokens, relay secrets, or other operator credentials in forks, screenshots, or bug reports. Rotate first if exposure occurs.
- Do not represent the software as offering the warranties or service levels of a hosted product. The maintainers operate no backend.

## No Warranty

The software is provided "as is" without warranty of any kind, as stated in the MIT License. The maintainers are not liable for outages, data loss, security incidents, or downstream effects of approval decisions made through the relay.

## Third-Party Services

When you enable a third-party transport (Telegram Bot API, webhook endpoint), your use of that transport is also governed by its own terms (for example, [Telegram's Terms of Service](https://telegram.org/tos)). Legax does not reduce or alter those terms.

## Trademarks

"Codex", "Claude", and "Gemini" are trademarks of their respective owners. Legax is not affiliated with, endorsed by, or sponsored by Anthropic, Google, or OpenAI. References in this repository describe the supported CLI integrations only.

## Changes

These terms can change with the software. Changes ship in the same commit as the corresponding code change. There is no separate notification mechanism; track changes through the repository history.

## Contact

For terms and licensing questions, use the repository issue tracker when the question is not sensitive. For security issues, follow [`SECURITY.md`](../.github/SECURITY.md). For privacy details, see [`PRIVACY.md`](PRIVACY.md).
