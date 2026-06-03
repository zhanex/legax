# Contributing

English | [Simplified Chinese](CONTRIBUTING.zh-CN.md)

Thanks for considering a contribution. This project is small, opinionated, and dependency-free; the rules below exist to keep it that way.

## Before You Open a PR

1. Run the full local gate:

   ```bash
   npm run ci
   ```

   `npm run ci` runs `npm test` plus `check:docs`. `npm test` covers `check:node` (syntax), `check:shell` (`bash -n` on installer scripts), and `test:e2e` (the standard end-to-end suite). `check:docs` covers i18n pairs, secret patterns, mojibake, and UTF-8 BOM checks. CI runs `npm run ci`.

2. If you added a new script under `scripts/` or `tests/e2e/`, **also append it** to the corresponding list in `package.json`. The lists are explicit, not glob-driven.

3. If your change is documentation only, `npm run check:docs` is enough locally, but PRs still need the full CI gate before merge.

4. For agent-assisted work, load only the smallest task-relevant documentation set. Do not load both English and zh-CN document pairs unless the PR is translation parity or divergence review work.

## Documentation Pairing (Hard Rule)

Every prose `.md` and every `config.example*.yaml` file ships as **a language pair**: `*.md` (English) and `*.zh-CN.md` (Simplified Chinese), or `config.example*.yaml` and matching `config.example*.zh-CN.yaml`. The `check:docs` script enforces this and will fail your PR if a pair is incomplete.

If you cannot write Chinese, mark the PR title with `[needs-zh]` and either ask in the PR for help or omit doc edits in this PR. Do **not** copy the English text into the `.zh-CN.md` placeholder. `check:docs` enforces file pairing and catches several encoding/secret mistakes, but reviewers are still responsible for translation quality.

Other rules:

- All documentation files are UTF-8 **without BOM**.
- English documentation is the canonical contract. Simplified Chinese files are localized mirrors; if the two diverge, update the English contract first and then mirror it.
- Do not put real Telegram bot tokens, OpenAI-style `sk-...` keys, GitHub PATs, AWS keys, or relay secrets in any tracked file. Use placeholders such as `replace-with-a-long-random-secret`, `YOUR_RELAY_HOST`, `TELEGRAM_BOT_TOKEN`. The doc gate scans for these patterns.

## Code Style

- Plain JavaScript, ESM, Node 18+ standard library only. No TypeScript build, no bundler, no `node_modules`.
- Two-space indent, double quotes, semicolons. Match the surrounding file rather than introducing a new style.
- Avoid adding dependencies. If you genuinely need one, open an issue first describing what you tried with stdlib.
- Each script under `scripts/` is **independently runnable** without bootstrapping a shared module. The duplication of `parseSimpleYaml` was originally intentional for this reason; the shared parser at `scripts/lib/yaml.mjs` is the modern path — use it for new scripts and remove inline copies when you touch an old one.
- Follow the naming, constant, directory ownership, design-pattern, and anti-pattern rules in [Engineering Guide](../docs/ENGINEERING_GUIDE.md). New hard-coded behavioral values require human review.

## Adding a New Adapter

First-party adapters live in `scripts/<agent>-link.mjs` and are registered through `scripts/lib/adapter-contract.mjs`. To add another adapter:

1. Decide the **CLI backend**. Most modern CLIs expose either stream-json (line-delimited JSON over stdin/stdout) or a JSON-RPC service (stdio or websocket). Avoid PTY / TUI scraping.
2. Pick a **canonical config key** (e.g. `aider`, `continue`) and a default `agentId`. Add the corresponding section to `config.example.yaml` and its zh-CN pair.
3. Implement the adapter as a long-lived process: read `config.yaml`, hold one (or more) child CLI processes, translate inbound phone messages into the CLI's input format, translate the CLI's structured output into outbound transport events.
4. Reuse the shared modules:
   - `scripts/lib/yaml.mjs` for config parsing.
   - `scripts/lib/runtime-state.mjs` for adapter coordination such as cursors, modes, queues, and Telegram selections.
   - `scripts/lib/outbound-transports.mjs` for sending events.
   - `scripts/lib/inbound-transports.mjs` for polling phone replies.
5. Register the adapter in `scripts/lib/adapter-contract.mjs` so the daemon can supervise it. Honor `autoStart`, `useExisting`, `mcpAutoConfigure`, and the adapter conformance checklist.
6. Add an E2E test under `tests/e2e/<agent>-link.e2e.mjs` that covers: stdin→relay forwarding, relay→stdin handling, mode switching, and (if the CLI has approval) the approval round-trip. Append it to `test:e2e` and `check:node` in `package.json`.

## Commit Messages

Short imperative subject, optional body explaining the *why*. We do not enforce Conventional Commits, but a topic prefix (`relay:`, `codex:`, `daemon:`, `docs:`) is appreciated.

## Self-Review on the PR Itself

Before requesting review, perform a self-review **on the GitHub PR diff page** — not just locally. The PR diff exposes things a local diff hides (line breaks, file moves, large hunks, accidentally tracked files). Concretely:

- Re-read every changed hunk on `Files changed` and ask "would a reviewer understand *why* this changed?"
- For any non-obvious change — surprising control flow, a workaround for an external bug, a load-bearing constant, an intentional regression in one path — leave a **review comment on that line yourself**, addressed to the eventual reviewer. Format: a one-line "why" plus a link or issue id when relevant.
- Do not paraphrase what the code does (the code already says that). Only annotate the *why*, the *risk*, or the *intentional weirdness*.
- Look explicitly for files you didn't mean to commit (large binaries, `data/` artifacts, machine-specific config, `.lock` files); if any slipped in, drop them in a follow-up commit before tagging reviewers.
- Confirm the PR description states the user-visible behavior change in plain prose. If you can't write it in two sentences, the PR is probably doing too much.

This is about reducing review latency, not signaling effort. A reviewer should never have to ask "why is this line here?" if the answer is non-obvious — your self-comment should already say it.

## Reporting Issues

Bugs and feature requests: regular GitHub issues. Security: do **not** open a public issue — see [SECURITY.md](SECURITY.md).

## License

Contributions are accepted under the project's [MIT License](../LICENSE). By submitting a PR you agree your contribution is licensed under the same terms.
