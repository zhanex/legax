# Support

English | [Simplified Chinese](SUPPORT.zh-CN.md)

## Where to Ask

- Bugs and reproducible failures: open a GitHub issue with logs, config excerpts with secrets removed, operating system, Node version, and the agent CLI involved.
- Feature requests: open a GitHub issue and describe the workflow, the transport, and the expected user interaction.
- Documentation fixes: open a PR when the fix is clear, or an issue when the behavior is unclear.
- Security issues: do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## What to Include

- The command you ran.
- The expected behavior and actual behavior.
- The relevant adapter: Codex, Claude Code, Gemini CLI, relay, Telegram, webhook, or MCP.
- Sanitized logs or payloads. Remove bot tokens, relay secrets, webhook URLs, chat IDs, and local conversation content that should not be shared.

## Scope

The maintainers support Legax itself. Upstream agent CLI bugs, Telegram outages, reverse proxy configuration, and operating-system service managers may require upstream or platform-specific support.
