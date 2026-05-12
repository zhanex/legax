import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { pluginRoot } from "./helpers.mjs";

test("npm publish workflow bounds CI runtime and uses CI relay secret placeholder", async () => {
  const workflowPath = path.join(pluginRoot, ".github", "workflows", "publish-npm.yml");
  const workflow = await fs.readFile(workflowPath, "utf8");

  assert.match(workflow, /^\s{4}timeout-minutes:\s*\d+\s*$/m);
  assert.match(
    workflow,
    /- name: Run CI gate\r?\n\s+env:\r?\n\s+LEGAX_SECRET:\s*ci-placeholder-secret\r?\n\s+run: npm run ci/m,
  );
  assert.match(workflow, /package-manager-cache:\s*false/);
});

test("npm publish workflow uses public provenance publishes for every workspace", async () => {
  const workflowPath = path.join(pluginRoot, ".github", "workflows", "publish-npm.yml");
  const workflow = await fs.readFile(workflowPath, "utf8");

  assert.match(workflow, /npm publish --workspace @legax\/relay --access public --provenance/);
  assert.match(workflow, /npm publish --workspace @legax\/daemon --access public --provenance/);
  assert.match(workflow, /npm publish --workspace legax --access public --provenance/);
});
