# 发布流程

[English](RELEASE.md) | 简体中文

本仓库以源码发布为主。只有在仓库干净、密钥已排除、完整 CI 门禁通过后，才应创建公开 release。

## 发布检查清单

1. 确认 `package.json` 以及 `packages/*/package.json` 中的版本号一致。
2. 更新 `../CHANGELOG.md` 和 `../CHANGELOG.zh-CN.md`。
3. 运行：

   ```bash
   npm run ci
   ```

4. 检查仓库边界：

   ```bash
   git status --short --ignored
   git ls-files
   ```

5. 确认 `config.yaml`、`data/`、`.claude/`、`.gemini/`、`.codex/` 和本地日志没有被 staged。
6. 条件允许时创建签名或 annotated tag：

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   ```

7. 根据 changelog 发布 release notes，并明确任何安全相关迁移步骤。

## npm 发布

1. 确认 npm 包名：

   ```bash
   npm view legax name version --json
   npm view @legax/daemon name version --json
   npm view @legax/relay name version --json
   ```

   返回 404 说明名称当前未被占用。如果任一名称返回了不属于本项目的包，请先把对应 package 切换到 scoped package。

2. 运行本地发布门禁：

   ```bash
   npm run ci
   npm run release:dry-run
   ```

3. 首次 trusted publish 前，需要在 npm 上为这个 GitHub 仓库和 workflow 路径 `.github/workflows/publish-npm.yml` 配置 Trusted Publisher。维护者账号必须开启 2FA。

4. 创建 GitHub Release 后，发布 workflow 会依次发布 `@legax/relay`、`@legax/daemon`、`legax`，并通过 OIDC trusted publishing 发布到 npm，不需要配置 `NPM_TOKEN` secret。

5. 从公开 registry 验证安装：

   ```bash
   npm install -g legax
   npm install -g @legax/relay
   legax --version
   legax doctor --offline
   ```

## 发布产物

默认发布产物是 GitHub Release 和三个同版本 npm package：`legax`、`@legax/daemon`、`@legax/relay`。独立 relay 仍保留在 `self-hosted-relay/`，供希望复制文件或安装系统服务的运维者使用。
