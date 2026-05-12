# Release Process

English | [Simplified Chinese](RELEASE.zh-CN.md)

This repository is source-first. Public releases should be cut only after the repository is clean, secrets are excluded, and the full CI gate passes.

## Release Checklist

1. Confirm the version in `package.json` and every workspace package under `packages/*/package.json`.
2. Update `../CHANGELOG.md` and `../CHANGELOG.zh-CN.md`.
3. Run:

   ```bash
   npm run ci
   ```

4. Check the repository boundary:

   ```bash
   git status --short --ignored
   git ls-files
   ```

5. Verify `config.yaml`, `data/`, `.claude/`, `.gemini/`, `.codex/`, and local logs are not staged.
6. Create a signed or annotated tag when practical:

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   ```

7. Publish release notes from the changelog and call out any security-relevant migration steps.

## NPM Release

1. Confirm the package names on npm:

   ```bash
   npm view legax name version --json
   npm view @legax/daemon name version --json
   npm view @legax/relay name version --json
   ```

   A 404 means the name is currently unclaimed. If any name returns an unrelated package, switch that package to a scoped name before publishing.

2. Run the local release gate:

   ```bash
   npm run ci
   npm run release:dry-run
   ```

3. Configure npm trusted publishing for each public npm package: `legax`, `@legax/daemon`, and `@legax/relay`. Use GitHub organization/user `zhanex`, repository `legax`, and workflow filename `publish-npm.yml`.

   npm asks for the workflow filename only, not the full `.github/workflows/publish-npm.yml` path. Keep maintainer accounts protected with 2FA.

4. Publish by creating a GitHub Release. The release workflow publishes `@legax/relay`, `@legax/daemon`, and `legax` in that order through OIDC trusted publishing and does not require an `NPM_TOKEN` secret.

5. If the release workflow fails with `E404` on `npm publish`, treat it as an npm authorization or trusted-publisher mismatch for the package named in the failing step. Recheck package write access, the package-specific trusted publisher, and the exact workflow filename before rerunning the failed workflow.

6. Verify install from the public registry:

   ```bash
   npm install -g legax
   npm install -g @legax/relay
   legax --version
   legax doctor --offline
   ```

## Release Artifacts

The default artifacts are the GitHub release and three same-version npm packages: `legax`, `@legax/daemon`, and `@legax/relay`. The standalone relay remains available under `self-hosted-relay/` for operators who prefer copying or service-manager installation.
