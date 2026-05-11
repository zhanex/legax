# Roadmap

English | [Simplified Chinese](ROADMAP.zh-CN.md)

This roadmap describes likely priorities, not a commitment to ship dates. Security, correctness, and operator control take precedence over convenience.

## Near Term

- Harden the relay browser experience: clearer device management, pairing feedback, and offline diagnostics.
- Keep Telegram interaction complete and low-noise for CLI, project or chat, and session selection.
- Improve cross-platform daemon setup documentation for Windows, macOS, and Linux.
- Expand E2E coverage for full Telegram flows and browser relay flows.

## Medium Term

- Add more adapter contracts for agent CLIs that expose structured IO.
- Improve release automation and artifact verification.
- Add optional CI checks for packaging and Windows execution.
- Document reverse proxy examples for HTTPS relay deployment.

## Non-Goals

- Auto-approving native agent security prompts.
- Scraping TUI screens as the default integration path.
- Building a programming client, IDE, terminal replacement, diff workspace, or full web coding environment.
- Making an official shared relay service or official shared Telegram bot the default deployment model.
