import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { pluginRoot } from "./helpers.mjs";
import { packageVersion, serverInfo } from "../../scripts/lib/version.mjs";

test("runtime version is derived from the root package metadata", async () => {
  const rootPackage = JSON.parse(await fs.readFile(path.join(pluginRoot, "package.json"), "utf8"));

  assert.equal(packageVersion(), rootPackage.version);
  assert.deepEqual(serverInfo("legax-test"), {
    name: "legax-test",
    version: rootPackage.version
  });
});

test("runtime scripts do not duplicate the package version string", async () => {
  const rootPackage = JSON.parse(await fs.readFile(path.join(pluginRoot, "package.json"), "utf8"));
  const runtimeFiles = [
    "scripts/mcp-server.mjs",
    "scripts/claude-permission-mcp-server.mjs",
    "scripts/codex-app-server-link.mjs",
    "scripts/claude-code-link.mjs"
  ];

  for (const file of runtimeFiles) {
    const source = await fs.readFile(path.join(pluginRoot, file), "utf8");
    assert.equal(source.includes(rootPackage.version), false, `${file} must not hard-code ${rootPackage.version}`);
  }
});
