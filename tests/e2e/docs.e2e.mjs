import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { pluginRoot } from "./helpers.mjs";

test("documentation gate rejects current package version outside changelog", async () => {
  const rootPackage = JSON.parse(await fs.readFile(path.join(pluginRoot, "package.json"), "utf8"));
  const englishPath = path.join(pluginRoot, "docs", "version-guard-fixture.md");
  const chinesePath = path.join(pluginRoot, "docs", "version-guard-fixture.zh-CN.md");
  await fs.writeFile(englishPath, `# Version Guard\n\nDo not write ${rootPackage.version} in docs.\n`, "utf8");
  await fs.writeFile(chinesePath, `# 版本守卫\n\n不要在文档里写死 ${rootPackage.version}。\n`, "utf8");
  try {
    const result = spawnSync(process.execPath, ["scripts/check-docs.mjs"], {
      cwd: pluginRoot,
      encoding: "utf8"
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not hard-code current package version/);
  } finally {
    await fs.rm(englishPath, { force: true });
    await fs.rm(chinesePath, { force: true });
  }
});

test("documentation gate rejects broken local links and image references", async () => {
  const englishPath = path.join(pluginRoot, "docs", "broken-link-fixture.md");
  const chinesePath = path.join(pluginRoot, "docs", "broken-link-fixture.zh-CN.md");
  await fs.writeFile(
    englishPath,
    "# Broken Link Fixture\n\nSee [missing](./missing-doc-fixture.md).\n\n![missing](./image/missing-fixture.png)\n",
    "utf8"
  );
  await fs.writeFile(
    chinesePath,
    "# 失效链接夹具\n\n查看 [缺失文档](./missing-doc-fixture.md)。\n\n![缺失图片](./image/missing-fixture.png)\n",
    "utf8"
  );
  try {
    const result = spawnSync(process.execPath, ["scripts/check-docs.mjs"], {
      cwd: pluginRoot,
      encoding: "utf8"
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /broken local .*reference/);
  } finally {
    await fs.rm(englishPath, { force: true });
    await fs.rm(chinesePath, { force: true });
  }
});

test("documentation gate ignores gitignored process notes", async () => {
  const ignoredDir = path.join(pluginRoot, "docs", "superpowers", "check-docs-fixture");
  const ignoredPath = path.join(ignoredDir, "temporary-plan.md");
  await fs.mkdir(ignoredDir, { recursive: true });
  await fs.writeFile(ignoredPath, "# Ignored Process Note\n\nsk-testfixturesecretthatwouldfailifscanned\n", "utf8");
  try {
    const result = spawnSync(process.execPath, ["scripts/check-docs.mjs"], {
      cwd: pluginRoot,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
  } finally {
    await fs.rm(ignoredDir, { recursive: true, force: true });
  }
});

test("change matrix covers tracked implementation and config files", async () => {
  const tracked = spawnSync("git", [
    "ls-files",
    "-z",
    "scripts",
    "self-hosted-relay",
    "packages",
    "tests",
    "skills",
    ".github",
    ".codex-plugin",
    ".agents",
    ".mcp.json",
    "package.json"
  ], {
    cwd: pluginRoot,
    encoding: "buffer"
  });

  assert.equal(tracked.status, 0, tracked.stderr.toString("utf8"));

  const matrix = await fs.readFile(path.join(pluginRoot, "docs", "CHANGE_MATRIX.md"), "utf8");
  const patterns = [
    /^scripts\/.*-link\.mjs$/,
    /^tests\/e2e\/.*\.e2e\.mjs$/,
    /^tests\/e2e\/fixtures\//,
    /^tests\/e2e\/helpers\.mjs$/,
    /^self-hosted-relay\/(install|uninstall)\.sh$/,
    /^self-hosted-relay\/.*\/legax-relay$/,
    /^self-hosted-relay\/.*\.service$/,
    /^self-hosted-relay\/config\.example.*\.yaml$/,
    /^packages\/[^/]+\/bin\//,
    /^packages\/[^/]+\/package\.json$/,
    /^\.github\/workflows\//,
    /^\.github\/ISSUE_TEMPLATE\//,
    /^\.codex-plugin\//,
    /^\.agents\/plugins\//,
    /^skills\/legax\//,
    /^package\.json$/,
    /^\.mcp\.json$/
  ];

  const files = tracked.stdout.toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.endsWith(".md") && !file.endsWith("LICENSE"));

  const uncovered = files.filter((file) => {
    return !matrix.includes(file) && !patterns.some((pattern) => pattern.test(file));
  });

  assert.deepEqual(uncovered, []);
});

test("tracked documentation excludes process artifacts", () => {
  const tracked = spawnSync("git", ["ls-files", "-z", "--", "*.md"], {
    cwd: pluginRoot,
    encoding: "buffer"
  });

  assert.equal(tracked.status, 0, tracked.stderr.toString("utf8"));

  const allowed = new Set([
    "CHANGELOG.md",
    "CHANGELOG.zh-CN.md",
    "docs/ROADMAP.md",
    "docs/ROADMAP.zh-CN.md",
    "docs/RELEASE.md",
    "docs/RELEASE.zh-CN.md"
  ]);
  const processPathPattern = /(^|\/)(superpowers|plans|specs|drafts|scratch|tmp|temp)(\/|$)/i;
  const processFilePattern = /(^|[-_.])(draft|wip|scratch|tmp|temp|audit-notes|meeting-notes)([-_.]|$)/i;
  const planFilePattern = /(^|[-_.])plan([-_.]|$)/i;

  const files = tracked.stdout.toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"));

  const forbidden = files.filter((file) => {
    if (allowed.has(file)) return false;
    const basename = path.basename(file);
    return processPathPattern.test(file)
      || processFilePattern.test(basename)
      || (planFilePattern.test(basename) && !file.startsWith("docs/adr/"));
  });

  assert.deepEqual(forbidden, []);
});
