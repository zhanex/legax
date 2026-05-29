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
    "utf8",
  );
  await fs.writeFile(
    chinesePath,
    "# 失效链接夹具\n\n查看 [缺失文档](./missing-doc-fixture.md)。\n\n![缺失图片](./image/missing-fixture.png)\n",
    "utf8",
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
