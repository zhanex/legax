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

test("CodeQL workflow runs security-and-quality queries for JavaScript and Actions", async () => {
  const workflowPath = path.join(pluginRoot, ".github", "workflows", "codeql.yml");
  const workflow = await fs.readFile(workflowPath, "utf8");

  assert.match(workflow, /security-events:\s*write/);
  assert.match(workflow, /language:\s*\[javascript-typescript,\s*actions\]/);
  assert.match(workflow, /queries:\s*\+security-and-quality/);
  assert.match(workflow, /github\/codeql-action\/init@v4/);
  assert.match(workflow, /github\/codeql-action\/analyze@v4/);
});

test("security scanning workflow covers workflow, shell, and secret scanners", async () => {
  const workflowPath = path.join(pluginRoot, ".github", "workflows", "security-scanning.yml");
  const workflow = await fs.readFile(workflowPath, "utf8");

  assert.match(workflow, /zizmorcore\/zizmor-action@v0\.5\.6/);
  assert.match(workflow, /gitleaks\/gitleaks-action@v2\.3\.9/);
  assert.match(workflow, /GITLEAKS_ENABLE_COMMENTS:\s*"false"/);
  assert.match(workflow, /raven-actions\/actionlint@v2\.1\.2/);
  assert.match(workflow, /shellcheck self-hosted-relay\/install\.sh self-hosted-relay\/uninstall\.sh/);
  assert.match(workflow, /shellcheck -s sh self-hosted-relay\/openrc\/legax-relay/);
});
