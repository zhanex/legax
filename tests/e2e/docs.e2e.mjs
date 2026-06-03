import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { pluginRoot } from "./helpers.mjs";

async function createDocsCheckRoot(t, name) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `legax-docs-${name}-`));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const rootPackage = JSON.parse(await fs.readFile(path.join(pluginRoot, "package.json"), "utf8"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ version: rootPackage.version }, null, 2), "utf8");
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  return { root, version: rootPackage.version };
}

function runDocsCheck(root) {
  return spawnSync(process.execPath, [path.join(pluginRoot, "scripts", "check-docs.mjs")], {
    cwd: root,
    encoding: "utf8"
  });
}

test("documentation gate rejects current package version outside changelog", async (t) => {
  const { root, version } = await createDocsCheckRoot(t, "version");
  await fs.writeFile(path.join(root, "docs", "version-guard-fixture.md"), `# Version Guard\n\nDo not write ${version} in docs.\n`, "utf8");
  await fs.writeFile(
    path.join(root, "docs", "version-guard-fixture.zh-CN.md"),
    `# \u7248\u672c\u5b88\u536b\n\n\u4e0d\u8981\u5728\u6587\u6863\u91cc\u5199\u6b7b ${version}\u3002\n`,
    "utf8"
  );

  const result = runDocsCheck(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not hard-code current package version/);
});

test("documentation gate rejects broken local links and image references", async (t) => {
  const { root } = await createDocsCheckRoot(t, "links");
  await fs.writeFile(
    path.join(root, "docs", "broken-link-fixture.md"),
    "# Broken Link Fixture\n\nSee [missing](./missing-doc-fixture.md).\n\n![missing](./image/missing-fixture.png)\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(root, "docs", "broken-link-fixture.zh-CN.md"),
    "# \u5931\u6548\u94fe\u63a5\u5939\u5177\n\n\u67e5\u770b [\u7f3a\u5931\u6587\u6863](./missing-doc-fixture.md)\u3002\n\n![\u7f3a\u5931\u56fe\u7247](./image/missing-fixture.png)\n",
    "utf8"
  );

  const result = runDocsCheck(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /broken local .*reference/);
});

test("documentation gate rejects machine-specific workspace paths", async (t) => {
  const { root } = await createDocsCheckRoot(t, "paths");
  const machinePath = ["F:", "workspace"].join("/");
  await fs.writeFile(path.join(root, "config.example.yaml"), `daemon:\n  projectRoots:\n    - ${machinePath}\n`, "utf8");
  await fs.writeFile(path.join(root, "config.example.zh-CN.yaml"), `daemon:\n  projectRoots:\n    - ${machinePath}\n`, "utf8");

  const result = runDocsCheck(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /machine-specific local path/);
});

test("documentation gate rejects Chinese mojibake from codepage rewrites", async (t) => {
  const { root } = await createDocsCheckRoot(t, "mojibake");
  const mojibake = "\u7ba1\u20ac\u6d63\u64b2\u4e2d\u93c2\u56e8\u6a7b\u6587\u5997\uff43\u20ac?";
  await fs.writeFile(path.join(root, "docs", "mojibake-fixture.md"), "# Mojibake Fixture\n\nEnglish content.\n", "utf8");
  await fs.writeFile(path.join(root, "docs", "mojibake-fixture.zh-CN.md"), `# \u4e71\u7801\u5939\u5177\n\n${mojibake}\n`, "utf8");

  const result = runDocsCheck(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /contains mojibake or replacement characters/);
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
