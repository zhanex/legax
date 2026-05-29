# Changelog

English | [Simplified Chinese](CHANGELOG.zh-CN.md)

All notable project changes should be recorded here. The format follows a simple Keep a Changelog style, and versions follow semver once public releases begin.

## Unreleased

## 0.0.3

- Added user-facing deployment manuals and an AI-oriented install guide linked from the README.
- Prevented daemon restart storms when adapters repeatedly fail during startup.
- Hardened the npm publish workflow with a bounded CI gate and matching relay test environment.

## 0.0.2

- Prepared the GitHub repository for public release, including documentation layout cleanup and npm Trusted Publishing workflow support.
- Published follow-up package metadata for `legax`, `@legax/daemon`, and `@legax/relay`.

- Prepared the repository for public development with package metadata, community files, CI documentation, and security model updates.
- Kept `npm test` as the local code gate and `npm run ci` as the full CI gate including documentation checks.
- Documented the current browser pairing model instead of the removed phone-token model.
- Added Telegram and relay documentation for the Mini App new-project picker, active session flow, and operator-owned deployment stance.
- Isolated Gemini MCP config writes in E2E tests to avoid shared `.gemini/settings.json` races on Windows.
- Added npm installed-mode quick start, `legax relay` packaging, and tarball install smoke coverage.
- Split npm publishing into fixed-version workspaces for `legax`, `@legax/daemon`, and `@legax/relay`, with shared runtime modules bundled into each package.
- Added `legax relay init` guidance for public HTTPS relay deployments and Caddy reverse proxy setup.

## 0.0.1

- Initial relay, daemon, MCP, Telegram, supported agent CLI adapters, and self-hosted relay implementation.
