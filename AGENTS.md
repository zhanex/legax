# AGENTS.md

English | [Simplified Chinese](AGENTS.zh-CN.md)

This file is the repository instruction contract for AI coding agents working on Legax, including Codex, Claude Code, Gemini CLI, OpenCode, and other LLM coding tools. It applies across supported LLM agent environments.

Use this file as the entry point, then load only the shortest task-relevant documents listed below. A document can be binding even when you do not load it into context; load the relevant one before editing that area.

If the user or working context uses Simplified Chinese, agents may read `AGENTS.zh-CN.md` as the equivalent translation. It is not a separate rule set; if the two files diverge, treat this file as the source of truth and update both.

## Required Operating Rules

- Follow the repository architecture and safety boundaries before local style preferences.
- Keep the project dependency-free: no `node_modules`, no bundler, and no new npm dependency unless the design has been explicitly accepted.
- Run against the Node 18+ standard library.
- Keep configuration YAML-only. Use `scripts/lib/yaml.mjs`; do not add JSON config support or a YAML dependency casually.
- Keep cross-process adapter coordination in `scripts/lib/runtime-state.mjs`; do not create sibling state files for cursors, selected sessions, modes, or launch requests.
- Keep MCP as a capability layer. MCP tools may notify, poll, or request permission, but must not start or stop adapter processes.
- Never simulate UI clicks, auto-approve native prompts, or bypass an agent's security policy.
- Do not route remote workflow input to arbitrary shell, `eval`, script, prompt, command, or free-form executable args.
- Do not hard-code behavioral constants casually. New hard-coded values require human review unless they are trivial local literals such as `0`, `1`, `-1`, `true`, `false`, or `null`.
- Keep documentation language pairs together: English `.md` with `.zh-CN.md`, and `config.example*.yaml` with matching `config.example*.zh-CN.yaml`.
- Keep tracked documentation release-quality. Do not commit implementation plans, drafts, temporary specs, scratch notes, audit notes, or agent execution transcripts as docs.
- Before staging, committing, opening a PR, or claiming documentation changes are ready, audit changed documentation against `docs/DOCUMENTATION.md`; do not rely on `npm run check:docs` alone for content placement, writing-standard, or structure issues.
- If you add a script or E2E test file, append it to the explicit `package.json` check or test list.

## Required Document Routing

| Work area | Load before editing |
| --- | --- |
| Any non-trivial code change | `docs/context_for_llms.md`, `docs/ENGINEERING_GUIDE.md`, `docs/CHANGE_MATRIX.md` |
| Architecture, lifecycle, or plane ownership | `docs/ARCHITECTURE.md`, `docs/FUNCTIONAL_BOUNDARIES.md`, `docs/adr/README.md` |
| Adapter behavior | `docs/ADAPTERS.md`, `docs/ADAPTER_CONFORMANCE.md`, `docs/EXTENDING.md` |
| MCP tools, permission MCP, or skill/plugin metadata | `docs/CODEX_PLUGIN.md`, `skills/legax/SKILL.md`, `docs/OBSERVABILITY.md` |
| Daemon supervision, modes, launch requests, local queues | `docs/RUNTIME_STATE.md`, `docs/STATE_MACHINES.md` |
| Relay HTTP API | `docs/RELAY_API.md`, `docs/RELAY_STORE.md`, `docs/LEGAX_PROTOCOL.md` |
| Relay store schema or portable sessions | `docs/RELAY_STORE.md`, `docs/LEGAX_PROTOCOL.md` |
| Config fields or parser behavior | `docs/CONFIGURATION.md`, `config.example.yaml`, `config.example.zh-CN.yaml` |
| Transports, Telegram, Feishu/Lark, webhook routing | `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`, `docs/FEISHU_LARK.md`, `docs/COMPATIBILITY.md` |
| Workflows, checkpoint artifacts, worktree-lite | `docs/LEGAX_PROTOCOL.md`, `docs/RELAY_API.md`, `docs/RELAY_STORE.md`, `docs/STATE_MACHINES.md` |
| Authentication, secrets, privacy, public relay exposure | `docs/RELAY_API.md`, `docs/OBSERVABILITY.md`, `docs/PRIVACY.md`, `.github/SECURITY.md` |
| Logging, health, status, audit, diagnostics | `docs/OBSERVABILITY.md` |
| Documentation changes | `docs/DOCUMENTATION.md`, `docs/README.md` |
| Release, packages, publishing | `docs/RELEASE.md` |
| Commits or PR preparation | `.github/CONTRIBUTING.md` |

Use [docs/README.md](docs/README.md) as the full documentation tree. Use [docs/context_for_llms.md](docs/context_for_llms.md) as the compact map for coding agents.

## Commands

This is a dependency-free Node.js project.

```bash
npm run ci                            # full CI gate: npm test + check:docs
npm test                              # local code gate: check:node + check:shell + test:e2e
npm run check:node                    # node --check on every script (syntax only)
npm run check:docs                    # docs/i18n/secret/BOM gate
npm run check:shell                   # bash -n on installer + service scripts
npm run test:e2e                      # node --test over tests/e2e/*.e2e.mjs, excluding real clients
npm run test:e2e:real                 # opt-in: requires LEGAX_REAL_CLIENTS=1 and real CLIs on PATH
npm run test:real:messages            # real-local-message smoke test
```

Run one E2E file:

```bash
node --test tests/e2e/<name>.e2e.mjs
```

Run one E2E test by name:

```bash
node --test --test-name-pattern '<substring>' tests/e2e/<name>.e2e.mjs
```

Dry-run the supervisor without spawning real CLIs:

```bash
node scripts/legax-daemon.mjs --dry-run
```

`npm run ci` is the merge contract. Documentation-only changes may use `npm run check:docs`; code changes should run the narrow affected test first, then the relevant broader gate.

## Architecture Reminder

Legax is a session-management and workflow orchestration layer for agent CLIs. Keep these ownership boundaries separate:

- Control plane: CLI adapters under `scripts/*-link.mjs` own process interaction, session selection, structured-output parsing, and native approval callback integration.
- Capability plane: MCP servers expose tools and permission prompts, but do not manage adapter lifecycle.
- Communication plane: relay, Telegram, Feishu/Lark, webhook, inbound helpers, and outbound transports own remote message delivery and routing.
- Runtime state: `scripts/lib/runtime-state.mjs` is the local daemon/adapter coordination source of truth.
- Relay store: `data/relay-store.json` uses `legax.relay/1` and owns portable relay-side state.

## Constant Policy

Behavioral constants should be named, scoped, and reviewed.

- Prefer named constants for timeouts, intervals, retry counts, TTLs, ports, body-size limits, schema versions, event kinds, modes, command refs, status strings, path names, and environment variable names.
- Include units in names where relevant, for example `DEFAULT_RELAY_POLL_INTERVAL_MS`.
- Keep constants near the module that owns the behavior. Share them through a domain module only when multiple owners need the same contract.
- Do not create a broad catch-all constants file.
- If a value must stay inline for readability, the reviewer must be able to see why it is not a behavioral constant.

## Contribution and Commits

Follow `.github/CONTRIBUTING.md` before staging or committing.

- Inspect `git status --short` and the full diff before staging.
- Before pushing or opening a PR, fetch the remote target branch and confirm whether it has advanced. If it has, update the working branch against the latest target branch using the repository's chosen merge or rebase strategy, resolve conflicts locally, and rerun the relevant checks before pushing.
- Do not run `git pull` blindly in a dirty worktree; prefer `git fetch origin` followed by an explicit merge or rebase decision.
- Do not stage local runtime artifacts, large binaries, `data/` residue, machine-specific config, lock files, or tracked secrets.
- Keep documentation pairs in the same commit.
- Use short imperative commit subjects. A topic prefix is welcome when it helps scanning.
- Use a commit body only when the reason is not clear from the subject and diff.

## Verification

- For docs-only changes, audit changed documentation against `docs/DOCUMENTATION.md`, then run `npm run check:docs`.
- When changing documentation gates, routing, indexes, `AGENTS.md`, `docs/CHANGE_MATRIX.md`, or `scripts/check-docs.mjs`, also run `node --test tests/e2e/docs.e2e.mjs`.
- For code changes, run the affected E2E file or narrow check first, then `npm run check:node`, then the relevant broader gate.
- Before claiming a branch is ready, run `npm run ci` or explicitly state why it was not run.
