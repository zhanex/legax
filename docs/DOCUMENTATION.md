# Documentation Standards

English | [Simplified Chinese](DOCUMENTATION.zh-CN.md)

These rules apply to prose documentation, skill documentation, and commented example files in Legax.

## Repository Shape

- Keep the root README focused on what the project does, why it is useful, how to start, where to get help, and who maintains it.
- Move long setup, architecture, adapter, plugin, and maintainer material into focused documents under `docs/`.
- Keep `docs/README.md` as the documentation index so GitHub readers can navigate without scanning the whole tree.
- Keep `docs/context_for_llms.md` as the only agent routing map. `AGENTS.md` stays a compact rule entry point, and `docs/CHANGE_MATRIX.md` stays focused on verification.
- Keep community health files under `.github/`: contributing guide, code of conduct, security policy, support guide, issue forms, and PR template.
- Use relative links for repository-local files so links work in clones, branches, and forks.

## Published Documentation Only

Tracked documentation must be release-quality material: user guides, maintainer guides, stable contracts, architecture decisions, changelog entries, roadmap entries, examples, or policy documents.

Do not commit process artifacts as repository documentation:

- implementation plans
- temporary specs
- drafts
- scratch notes
- meeting notes
- ad hoc audit notes
- agent execution transcripts
- checklist files that only describe one completed local task

Keep process material in issues, pull requests, the active agent thread, an external task system, or a gitignored local directory such as `docs/superpowers/`. If a process note contains a durable decision, convert the decision into an ADR, contract document, or maintainer guide before committing it.

## Content Placement

Put content in the narrowest stable document that owns the reader task:

| Content | Destination |
| --- | --- |
| Project overview, quick start, support, and maintainer identity | Root `README.md` |
| Documentation navigation | `docs/README.md` |
| Agent context routing | `docs/context_for_llms.md` |
| User setup and daily operation | `docs/USER_MANUAL.md` or integration-specific user docs |
| Architecture boundaries, ownership, and lifecycle | `docs/ARCHITECTURE.md`, `docs/FUNCTIONAL_BOUNDARIES.md`, or an ADR |
| Stable protocol, API, config, state, or adapter contracts | The matching contract document under `docs/` |
| Accepted architectural decisions and reopen criteria | `docs/adr/NNNN-short-topic.md` |
| Coding and maintainer practices | `docs/ENGINEERING_GUIDE.md` |
| Change-to-test routing for agents and maintainers | `docs/CHANGE_MATRIX.md` |
| Unreleased intent that is not yet implemented | `docs/ROADMAP.md` |
| Release history | `CHANGELOG.md` |

Do not duplicate a contract across multiple documents. Keep one canonical owner, then link to it from overview, routing, or quick-start material.

## Writing Standard

- Write for the reader who needs to complete a task or preserve a contract, not for the person who just implemented a change.
- Describe shipped behavior, accepted design, or explicit roadmap intent. Do not describe local attempts, temporary implementation order, or unresolved brainstorming as product documentation.
- Start each document with its scope and audience unless the title and directory already make that obvious.
- Prefer precise nouns over broad labels such as "new", "old", "current", "recent", or "temporary"; those words age quickly.
- Use present tense for supported behavior and future tense only in roadmap content.
- Treat CLI commands, config keys, file paths, API fields, modes, event names, and environment variables as literals wrapped in backticks.
- State prerequisites before commands when they affect whether the command works.
- Keep examples minimal, valid, and free of real secrets.
- Use placeholders or relative paths for local project and workspace examples. Only use absolute paths when documenting stable OS-level install defaults, such as `/etc/legax-relay/config.yaml` and `/var/lib/legax-relay/relay-store.json`, or platform home examples.
- Link to canonical docs instead of repeating long setup, architecture, or protocol details.
- If a document introduces a stable enum, state value, config key, endpoint, or file format, include ownership, valid values, and compatibility notes where relevant.

## Document Structure

- Use one `#` title that matches the document purpose.
- Put the language switch link immediately below the title.
- Long contract documents that agent workflows commonly load should put a short `## Agent Summary` after the language switch.
- Use short, task-oriented section headings.
- Use tables for mappings and matrices; use bullets for short rules; use numbered lists only for ordered procedures.
- Use fenced code blocks with a language tag for commands, config, JSON, YAML, and shell snippets.
- Keep screenshots and images under `docs/image/` unless a more specific document-owned asset directory exists.
- Add a "Related Documents" or similar section only when it prevents duplication or helps route readers.

## Format Exceptions

Some repository Markdown files are rendered or parsed by external tools and may use a constrained structure:

- The root `README.md` may use a GitHub-oriented HTML hero block. Keep the visible title and language switch near the top.
- `.github/PULL_REQUEST_TEMPLATE*.md` may start with task sections instead of a title so the generated pull request body stays concise.
- `skills/legax/SKILL*.md` must keep skill front matter before the Markdown title. Put the language switch immediately below the title after that front matter.
- Ignored generated package README files under `packages/*/` are package artifacts, not canonical source documentation.
- YAML example files follow config example structure, not Markdown title structure.

When adding an exception, document why an external renderer, package format, or tool parser requires it.

## Language Files

- English documentation uses `*.md`.
- Simplified Chinese documentation uses `*.zh-CN.md`.
- Root and special files follow the same pairing rule, for example `README.md` and `README.zh-CN.md`, `AGENTS.md` and `AGENTS.zh-CN.md`, `SKILL.md` and `SKILL.zh-CN.md`, and every `config.example*.yaml` file with its matching `config.example*.zh-CN.yaml`.
- Do not mix English and Chinese prose in the same document except for short language links, product names, CLI commands, API names, config keys, and code examples.
- When changing a document, update its language pair in the same change whenever the content applies to both audiences.

## Encoding

- All documentation and commented examples must be UTF-8 without BOM.
- Avoid editor or shell commands that silently rewrite UTF-8 as a local code page.
- On Windows PowerShell 5.1, prefer Node.js, a modern editor, or `.NET` `UTF8Encoding(false)` when rewriting files.
- Run `npm run check:docs` before submitting documentation changes.
- `npm run check:docs` includes the context-budget gate for compact agent entry docs and `Agent Summary` coverage.

## Version References

- Do not hard-code the current package version in README or docs prose. Use package metadata, `latest`, or placeholders such as `vX.Y.Z`.
- Changelog headings may keep historical released versions because they are part of the release record.

## Security

- Never put real bot tokens, API keys, relay secrets, paired-device cookies, chat IDs, session secrets, or user credentials in documentation.
- Use placeholders such as `replace-with-a-long-random-secret`, `YOUR_RELAY_HOST`, and `TELEGRAM_BOT_TOKEN`.
- If a real secret appears in a document or example, remove it from the file and rotate it outside the repository.

## Review Checklist

- The content belongs in this document's canonical owner; otherwise link to the owner instead of duplicating it.
- Agent routing belongs in `docs/context_for_llms.md`; verification routing belongs in `docs/CHANGE_MATRIX.md`.
- The document describes shipped behavior, accepted design, or explicit roadmap intent rather than process notes.
- The document follows the title, language-switch, heading, and fenced-code rules, or matches a documented format exception.
- The English and Simplified Chinese files both exist.
- The two files describe the same behavior and use the same config keys.
- English files do not contain Chinese prose.
- Chinese files do not contain untranslated English paragraphs.
- Links between language versions work.
- Commands, config keys, API fields, states, modes, file paths, and environment variables are marked as literals.
- Stable enums, state values, config keys, endpoints, and file formats include ownership, valid values, and compatibility notes where relevant.
- Examples are minimal, valid, and use placeholders instead of real secrets.
- Local project and workspace examples do not contain machine-specific absolute paths.
- No mojibake or replacement characters are present.
- No file starts with a UTF-8 BOM.
- Current package versions appear only in changelog history.
