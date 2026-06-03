# AGENTS.md

English | [Simplified Chinese](AGENTS.zh-CN.md)

This is the repository instruction contract for AI coding agents working on Legax. Start here, then read [Context For LLMs](docs/context_for_llms.md). Do not load every document by default.

## Hard Rules

- Keep the project dependency-free: Node 18+ standard library only, no bundler, and no new npm dependency unless the design has been accepted.
- Keep configuration YAML-only. Use `scripts/lib/yaml.mjs`; do not add JSON config support or a YAML dependency casually.
- Keep cross-process daemon and adapter coordination in `scripts/lib/runtime-state.mjs`; do not create sibling state files for cursors, selected sessions, modes, or launch requests.
- Keep MCP as a capability layer. MCP tools may notify, poll, or request permission, but must not start or stop adapter processes.
- Never simulate UI clicks, auto-approve native prompts, or bypass an agent's security policy.
- Do not route remote workflow input to arbitrary shell, `eval`, script, prompt, command, or free-form executable args.
- Keep documentation language pairs together: English `.md` with `.zh-CN.md`, and `config.example*.yaml` with matching `config.example*.zh-CN.yaml`.
- Keep tracked documentation and commented examples UTF-8 without BOM; do not rewrite them through locale-dependent shell encodings.
- Do not commit implementation plans, drafts, scratch notes, audit notes, or agent transcripts as tracked docs. Use ignored process directories or external task systems.
- If you add a script or E2E file, append it to the explicit `package.json` `check:node` or `test:e2e` list.

## Context Loading

- Read [docs/context_for_llms.md](docs/context_for_llms.md) for the task routing table and canonical owners.
- Default to English docs. Load `.zh-CN` pairs only for translation, Chinese documentation work, or pair consistency checks.
- For non-trivial code changes, use the smallest task-specific context set from `docs/context_for_llms.md`, then use `docs/CHANGE_MATRIX.md` for focused verification.
- If docs conflict with this file, stop and surface the conflict before editing.

## Commands

```bash
npm run ci
npm test
npm run check:node
npm run check:docs
npm run check:shell
npm run test:e2e
node --test tests/e2e/<name>.e2e.mjs
node scripts/legax-daemon.mjs --dry-run
```

`npm run ci` is the merge contract. For focused work, run the narrow affected tests first, then the relevant broader gate.

## Git And Review

- Inspect `git status --short` and the full diff before staging.
- Never revert user or unrelated local changes unless explicitly requested.
- Do not stage local runtime artifacts, large binaries, `data/` residue, machine-specific config, lock files, or tracked secrets.
- Follow `.github/CONTRIBUTING.md` before committing or opening a PR.
- Before claiming a branch is ready, run `npm run ci` or state exactly why it was not run.
