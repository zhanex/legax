import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { pluginRoot } from "./helpers.mjs";

const pinnedActionRef = /^[a-f0-9]{40}$/;

function assertActionsPinned(workflow) {
  const matches = [...workflow.matchAll(/uses:\s*([^@\s#]+)@([^\s#]+)/g)];
  assert.notEqual(matches.length, 0);

  for (const [, action, ref] of matches) {
    assert.match(ref, pinnedActionRef, `${action} must be pinned to a commit SHA`);
  }
}

test("CI workflow pins actions and avoids checkout credential persistence", async () => {
  const workflowPath = path.join(pluginRoot, ".github", "workflows", "ci.yml");
  const workflow = await fs.readFile(workflowPath, "utf8");

  assertActionsPinned(workflow);
  assert.match(workflow, /persist-credentials:\s*false/);
});

test("npm publish workflow bounds CI runtime and uses CI relay secret placeholder", async () => {
  const workflowPath = path.join(pluginRoot, ".github", "workflows", "publish-npm.yml");
  const workflow = await fs.readFile(workflowPath, "utf8");

  assertActionsPinned(workflow);
  assert.match(workflow, /persist-credentials:\s*false/);
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
  assertActionsPinned(workflow);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /github\/codeql-action\/init@[a-f0-9]{40}\s*# v4\.30\.9/);
  assert.match(workflow, /github\/codeql-action\/analyze@[a-f0-9]{40}\s*# v4\.30\.9/);
});

test("security scanning workflow covers workflow, shell, and secret scanners", async () => {
  const workflowPath = path.join(pluginRoot, ".github", "workflows", "security-scanning.yml");
  const workflow = await fs.readFile(workflowPath, "utf8");

  assertActionsPinned(workflow);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /zizmorcore\/zizmor-action@[a-f0-9]{40}\s*# v0\.5\.6/);
  assert.match(workflow, /gitleaks\/gitleaks-action@[a-f0-9]{40}\s*# v2\.3\.9/);
  assert.match(workflow, /GITLEAKS_ENABLE_COMMENTS:\s*"false"/);
  assert.match(workflow, /raven-actions\/actionlint@[a-f0-9]{40}\s*# v2\.1\.2/);
  assert.match(workflow, /shellcheck self-hosted-relay\/install\.sh self-hosted-relay\/uninstall\.sh/);
  assert.match(workflow, /shellcheck -s sh -e SC2034 self-hosted-relay\/openrc\/legax-relay/);
});
