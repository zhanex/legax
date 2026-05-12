# Documentation Standards

English | [Simplified Chinese](DOCUMENTATION.zh-CN.md)

These rules apply to prose documentation, skill documentation, and commented example files in Legax.

## Repository Shape

- Keep the root README focused on what the project does, why it is useful, how to start, where to get help, and who maintains it.
- Move long setup, architecture, adapter, plugin, and maintainer material into focused documents under `docs/`.
- Keep `docs/README.md` as the documentation index so GitHub readers can navigate without scanning the whole tree.
- Keep community health files under `.github/`: contributing guide, code of conduct, security policy, support guide, issue forms, and PR template.
- Use relative links for repository-local files so links work in clones, branches, and forks.

## Language Files

- English documentation uses `*.md`.
- Simplified Chinese documentation uses `*.zh-CN.md`.
- Root and special files follow the same pairing rule, for example `README.md` and `README.zh-CN.md`, `SKILL.md` and `SKILL.zh-CN.md`, and every `config.example*.yaml` file with its matching `config.example*.zh-CN.yaml`.
- Do not mix English and Chinese prose in the same document except for short language links, product names, CLI commands, API names, config keys, and code examples.
- When changing a document, update its language pair in the same change whenever the content applies to both audiences.

## Encoding

- All documentation and commented examples must be UTF-8 without BOM.
- Avoid editor or shell commands that silently rewrite UTF-8 as a local code page.
- On Windows PowerShell 5.1, prefer Node.js, a modern editor, or `.NET` `UTF8Encoding(false)` when rewriting files.
- Run `npm run check:docs` before submitting documentation changes.

## Version References

- Do not hard-code the current package version in README or docs prose. Use package metadata, `latest`, or placeholders such as `vX.Y.Z`.
- Changelog headings may keep historical released versions because they are part of the release record.

## Security

- Never put real bot tokens, API keys, relay secrets, paired-device cookies, chat IDs, session secrets, or user credentials in documentation.
- Use placeholders such as `replace-with-a-long-random-secret`, `YOUR_RELAY_HOST`, and `TELEGRAM_BOT_TOKEN`.
- If a real secret appears in a document or example, remove it from the file and rotate it outside the repository.

## Review Checklist

- The English and Simplified Chinese files both exist.
- The two files describe the same behavior and use the same config keys.
- English files do not contain Chinese prose.
- Chinese files do not contain untranslated English paragraphs.
- Links between language versions work.
- No mojibake or replacement characters are present.
- No file starts with a UTF-8 BOM.
- Current package versions appear only in changelog history.
