import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { pluginRoot } from "./helpers.mjs";

const pinnedActionRef = /^[a-f0-9]{40}$/;
const workflowNames = ["ci.yml", "codeql.yml", "publish-npm.yml", "security-scanning.yml"];

function assertActionsPinned(workflow) {
  const matches = [...workflow.matchAll(/uses:\s*([^@\s#]+)@([^\s#]+)/g)];
  assert.notEqual(matches.length, 0);

  for (const [, action, ref] of matches) {
    assert.match(ref, pinnedActionRef, `${action} must be pinned to a commit SHA`);
  }
}

test("workflows avoid GitHub Actions Node 20 deprecation warnings", async () => {
  const workflows = await Promise.all(
    workflowNames.map(async (name) => {
      const workflowPath = path.join(pluginRoot, ".github", "workflows", name);
      return fs.readFile(workflowPath, "utf8");
    }),
  );
  const combined = workflows.join("\n");

  assert.doesNotMatch(combined, /actions\/checkout@[a-f0-9]{40}\s*# v4\.2\.2/);
  assert.doesNotMatch(combined, /gitleaks\/gitleaks-action@/);
  assert.match(combined, /actions\/checkout@[a-f0-9]{40}\s*# v6\.0\.0/);
});

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

test("npm publish workflow supports manual beta publishes only", async () => {
  const workflowPath = path.join(pluginRoot, ".github", "workflows", "publish-npm.yml");
  const workflow = await fs.readFile(workflowPath, "utf8");

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /version:/);
  assert.match(workflow, /LEGAX_RELEASE_VERSION:\s*\$\{\{\s*inputs\.version\s*\}\}/);
  assert.doesNotMatch(workflow, /VERSION="\$\{\{\s*inputs\.version\s*\}\}"/);
  assert.match(workflow, /Manual npm publishing is limited to prerelease versions/);
  assert.match(workflow, /Package versions must all equal/);
  assert.match(workflow, /already published; skipping this immutable package/);
  assert.match(workflow, /LEGAX_RELAY_ALREADY_PUBLISHED=true/);
  assert.match(workflow, /env\.LEGAX_RELAY_ALREADY_PUBLISHED != 'true'/);
  assert.match(workflow, /npm publish --workspace @legax\/relay --access public --provenance --tag beta/);
  assert.match(workflow, /npm publish --workspace @legax\/daemon --access public --provenance --tag beta/);
  assert.match(workflow, /npm publish --workspace legax --access public --provenance --tag beta/);
  assert.doesNotMatch(workflow, /--tag latest/);
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
  assert.match(workflow, /GITLEAKS_VERSION:\s*"8\.30\.1"/);
  assert.match(workflow, /GITLEAKS_LINUX_X64_SHA256:\s*"551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"/);
  assert.match(workflow, /sha256sum --check gitleaks\.sha256/);
  assert.match(workflow, /gitleaks detect --source \. --redact --verbose/);
  assert.match(workflow, /raven-actions\/actionlint@[a-f0-9]{40}\s*# v2\.1\.2/);
  assert.match(workflow, /shellcheck self-hosted-relay\/install\.sh self-hosted-relay\/uninstall\.sh/);
  assert.match(workflow, /shellcheck -s sh -e SC2034 self-hosted-relay\/openrc\/legax-relay/);
});
