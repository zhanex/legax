import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  dataDir,
  fetchJson,
  pluginRoot,
  removeTempFiles,
  spawnNodeForTest,
  startRelay,
  stopProcessTree,
  waitFor,
  writeTempConfig
} from "./helpers.mjs";

const LPS_ACTION_IDS = [
  "requirements.capture",
  "design.basic",
  "design.detail",
  "test.spec",
  "tdd.red",
  "tdd.review_red",
  "tdd.green",
  "tdd.review_green",
  "tdd.refactor",
  "workflow.run_check",
  "review.self",
  "pr.prepare",
  "pr.create"
];

const DEFAULT_LPS_STEP_IDS = [
  "requirements",
  "design_basic",
  "design_detail",
  "test_spec",
  "red",
  "review_red",
  "green",
  "review_green",
  "refactor",
  "run_check",
  "self_review",
  "pr_prepare"
];

const OUTPUT_KEY_BY_ACTION = {
  "requirements.capture": "requirementsDocument",
  "design.basic": "basicDesignDocument",
  "design.detail": "detailedDesignDocument",
  "test.spec": "testPlanDocument",
  "tdd.red": "testPatch",
  "tdd.review_red": "redReview",
  "tdd.green": "implementationPatch",
  "tdd.review_green": "greenReview",
  "tdd.refactor": "refactorPatch",
  "workflow.run_check": "checkResult",
  "review.self": "selfReview",
  "pr.prepare": "prPreparation",
  "pr.create": "pullRequest"
};

function desktopHeaders(relay) {
  return {
    "content-type": "application/json",
    "x-legax-secret": relay.desktopSecret
  };
}

async function setupLeasedGeneration(relay, { sessionId, hostId = "lps-host" } = {}) {
  const headers = desktopHeaders(relay);
  await fetchJson(`${relay.baseUrl}/api/sessions`, {
    method: "POST",
    headers,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId,
      title: "LPS TDD session",
      selectedAgentId: "gemini-cli"
    })
  });
  const generationResponse = await fetchJson(`${relay.baseUrl}/api/generations`, {
    method: "POST",
    headers,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId,
      hostId,
      adapterId: "gemini-cli",
      nativeSession: { provider: "gemini", id: `native-${sessionId}` },
      worktree: { path: path.join(dataDir, `lps-worktree-${sessionId}`) }
    })
  });
  const leaseResponse = await fetchJson(`${relay.baseUrl}/api/leases/claim`, {
    method: "POST",
    headers,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId,
      generationId: generationResponse.generation.id,
      hostId,
      ttlMs: 30000
    })
  });
  return {
    generation: generationResponse.generation,
    lease: leaseResponse.lease
  };
}

function successfulStepBody(run, stepId, overrides = {}) {
  const step = run.steps[stepId];
  const outputKey = OUTPUT_KEY_BY_ACTION[step.commandRef] ?? "document";
  const actionEvidence = {};
  if (step.commandRef === "tdd.red") {
    actionEvidence.expectedFailure = true;
    actionEvidence.failureReason = "expected red failure";
  } else if (step.commandRef === "tdd.review_red") {
    actionEvidence.redVerified = true;
    actionEvidence.expectedFailure = true;
    actionEvidence.vacuous = false;
  } else if (step.commandRef === "tdd.review_green") {
    actionEvidence.greenVerified = true;
    actionEvidence.edgeCasesReviewed = true;
  } else if (step.commandRef === "workflow.run_check") {
    actionEvidence.checkRef = "ci";
    actionEvidence.exitCode = 0;
  } else if (step.commandRef === "pr.create") {
    actionEvidence.draft = true;
  }
  return {
    commandId: step.commandId,
    state: "succeeded",
    leaseHostId: run.leaseHostId,
    fencingToken: run.fencingToken,
    leaseToken: run.leaseToken,
    result: {
      actionId: step.commandRef,
      summary: `${step.commandRef} completed`,
      outputs: { [outputKey]: `${stepId}.md` },
      [outputKey]: `${stepId}.md`,
      ...overrides.result
    },
    evidence: {
      actionId: step.commandRef,
      summary: `${step.commandRef} completed`,
      outputRefs: [`artifact://${stepId}`],
      ...actionEvidence,
      ...overrides.evidence
    }
  };
}

async function completeStep(relay, run, stepId, overrides = {}) {
  const response = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${run.id}/steps/${stepId}/result`, {
    method: "POST",
    headers: desktopHeaders(relay),
    skipRelayCookie: true,
    body: JSON.stringify(successfulStepBody(run, stepId, overrides))
  });
  return response.run;
}

async function createDefaultRun(relay, {
  runId,
  sessionId,
  hostId = "lps-host",
  inputs = {},
  registerHost = true
} = {}) {
  const headers = desktopHeaders(relay);
  const { generation, lease } = await setupLeasedGeneration(relay, { sessionId, hostId });
  if (registerHost) {
    await fetchJson(`${relay.baseUrl}/api/hosts`, {
      method: "POST",
      headers,
      skipRelayCookie: true,
      body: JSON.stringify({
        hostId,
        commandRefs: LPS_ACTION_IDS.filter((actionId) => actionId !== "pr.create"),
        ttlMs: 30000
      })
    });
  }
  const created = await fetchJson(`${relay.baseUrl}/api/workflow-runs`, {
    method: "POST",
    headers,
    skipRelayCookie: true,
    body: JSON.stringify({
      runId,
      definitionId: "lps-tdd",
      sessionId,
      generationId: generation.id,
      targetHostId: hostId,
      leaseHostId: hostId,
      fencingToken: lease.fencingToken,
      leaseToken: lease.token,
      inputs: {
        scope: "Implement the requested issue",
        acceptanceCriteria: ["tests fail before implementation", "CI passes"],
        checkRef: "ci",
        ...inputs
      }
    })
  });
  return { run: created.run, generation, lease };
}

test("relay exposes LPS action contracts and enforces default workflow safety policy", async (t) => {
  const relay = await startRelay(t, { sessionId: "lps-contract-e2e" });
  const headers = desktopHeaders(relay);

  const actions = await fetchJson(`${relay.baseUrl}/api/workflow-actions`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  assert.deepEqual(actions.actions.map((action) => action.id), LPS_ACTION_IDS);
  for (const action of actions.actions) {
    assert.ok(Array.isArray(action.inputs.required), action.id);
    assert.ok(action.inputs.required.length > 0, action.id);
    assert.ok(Array.isArray(action.outputs.required), action.id);
    assert.ok(action.outputs.required.length > 0, action.id);
    assert.ok(Array.isArray(action.evidence.required), action.id);
    assert.ok(action.evidence.required.includes("summary"), action.id);
  }
  const prCreate = actions.actions.find((action) => action.id === "pr.create");
  assert.equal(prCreate.policy.disabledByDefault, true);
  assert.equal(prCreate.policy.requiresGate, true);
  assert.equal(prCreate.policy.draftFirst, true);

  const defaultWorkflow = await fetchJson(`${relay.baseUrl}/api/workflow-definitions/lps-tdd`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  assert.equal(defaultWorkflow.definition.schema, "legax.workflow/1");
  assert.deepEqual(defaultWorkflow.definition.steps.map((step) => step.id), DEFAULT_LPS_STEP_IDS);
  assert.equal(defaultWorkflow.definition.steps.find((step) => step.id === "green").gate.before, true);
  assert.equal(defaultWorkflow.definition.steps.some((step) => step.uses === "pr.create"), false);

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/workflow-definitions`, {
      method: "POST",
      headers,
      skipRelayCookie: true,
      body: JSON.stringify({
        id: "unsafe-pr-create",
        schema: "legax.workflow/1",
        version: "1.0.0",
        steps: [{ id: "create", uses: "pr.create" }]
      })
    }),
    { status: 400 }
  );

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/workflow-definitions`, {
      method: "POST",
      headers,
      skipRelayCookie: true,
      body: JSON.stringify({
        id: "unsafe-run-check",
        schema: "legax.workflow/1",
        version: "1.0.0",
        steps: [{
          id: "check",
          uses: "workflow.run_check",
          artifacts: { command: "npm test" }
        }]
      })
    }),
    { status: 400 }
  );
});

test("relay runs default LPS TDD workflow through PR preparation with lease-bound mutating actions", async (t) => {
  const relay = await startRelay(t, { sessionId: "lps-success-e2e" });
  let { run, lease } = await createDefaultRun(relay, {
    runId: "lps-success-run",
    sessionId: "lps-success-e2e",
    hostId: "lps-success-host"
  });

  assert.equal(run.state, "running");
  assert.equal(run.steps.requirements.commandRef, "requirements.capture");
  for (const stepId of ["requirements", "design_basic", "design_detail", "test_spec", "red", "review_red"]) {
    const evidence = stepId === "review_red"
      ? { redVerified: true, expectedFailure: true, vacuous: false }
      : {};
    run = await completeStep(relay, run, stepId, { evidence });
  }

  assert.equal(run.state, "waiting_gate");
  assert.equal(run.steps.green.state, "waiting_gate");
  assert.equal(run.gates.green.state, "waiting");

  let store = JSON.parse(await fs.readFile(relay.storePath, "utf8"));
  assert.equal(store.commands[run.steps.red.commandId].leaseToken, lease.token);

  const approved = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${run.id}/gates/green`, {
    method: "POST",
    headers: desktopHeaders(relay),
    skipRelayCookie: true,
    body: JSON.stringify({ decision: "approved", decidedBy: "tester" })
  });
  run = approved.run;
  assert.equal(run.steps.green.state, "running");
  for (const stepId of ["green", "review_green", "refactor", "run_check", "self_review", "pr_prepare"]) {
    const evidence = stepId === "review_green"
      ? { greenVerified: true, edgeCasesReviewed: true }
      : {};
    run = await completeStep(relay, run, stepId, { evidence });
  }
  assert.equal(run.state, "succeeded");
  assert.equal(run.steps.pr_prepare.state, "succeeded");

  store = JSON.parse(await fs.readFile(relay.storePath, "utf8"));
  assert.equal(store.commands[run.steps.green.commandId].leaseToken, lease.token);
  assert.equal(store.commands[run.steps.refactor.commandId].leaseToken, lease.token);
});

test("relay blocks green when red or green verification fails and cancels on gate denial", async (t) => {
  const relay = await startRelay(t, { sessionId: "lps-failure-e2e" });

  let redFailure = await createDefaultRun(relay, {
    runId: "lps-red-failure",
    sessionId: "lps-red-failure",
    hostId: "lps-red-host"
  });
  let run = redFailure.run;
  for (const stepId of ["requirements", "design_basic", "design_detail", "test_spec", "red"]) {
    run = await completeStep(relay, run, stepId);
  }
  const redReviewFailed = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${run.id}/steps/review_red/result`, {
    method: "POST",
    headers: desktopHeaders(relay),
    skipRelayCookie: true,
    body: JSON.stringify({
      commandId: run.steps.review_red.commandId,
      state: "failed",
      error: { code: "red_not_verified", message: "red did not fail for the expected reason" }
    })
  });
  assert.equal(redReviewFailed.run.state, "failed");
  assert.equal(redReviewFailed.run.steps.green.state, "cancelled");

  let gateDenied = await createDefaultRun(relay, {
    runId: "lps-gate-denied",
    sessionId: "lps-gate-denied",
    hostId: "lps-gate-host"
  });
  run = gateDenied.run;
  for (const stepId of ["requirements", "design_basic", "design_detail", "test_spec", "red", "review_red"]) {
    const evidence = stepId === "review_red"
      ? { redVerified: true, expectedFailure: true, vacuous: false }
      : {};
    run = await completeStep(relay, run, stepId, { evidence });
  }
  const denied = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${run.id}/gates/green`, {
    method: "POST",
    headers: desktopHeaders(relay),
    skipRelayCookie: true,
    body: JSON.stringify({ decision: "denied", decidedBy: "tester", reason: "implementation not approved" })
  });
  assert.equal(denied.run.state, "cancelled");
  assert.equal(denied.run.steps.green.state, "cancelled");

  let greenFailure = await createDefaultRun(relay, {
    runId: "lps-green-failure",
    sessionId: "lps-green-failure",
    hostId: "lps-green-host"
  });
  run = greenFailure.run;
  for (const stepId of ["requirements", "design_basic", "design_detail", "test_spec", "red", "review_red"]) {
    const evidence = stepId === "review_red"
      ? { redVerified: true, expectedFailure: true, vacuous: false }
      : {};
    run = await completeStep(relay, run, stepId, { evidence });
  }
  run = (await fetchJson(`${relay.baseUrl}/api/workflow-runs/${run.id}/gates/green`, {
    method: "POST",
    headers: desktopHeaders(relay),
    skipRelayCookie: true,
    body: JSON.stringify({ decision: "approved", decidedBy: "tester" })
  })).run;
  run = await completeStep(relay, run, "green");
  const greenReviewFailed = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${run.id}/steps/review_green/result`, {
    method: "POST",
    headers: desktopHeaders(relay),
    skipRelayCookie: true,
    body: JSON.stringify({
      commandId: run.steps.review_green.commandId,
      state: "failed",
      error: { code: "green_not_verified", message: "green behavior did not meet edge cases" }
    })
  });
  assert.equal(greenReviewFailed.run.state, "failed");
  assert.equal(greenReviewFailed.run.steps.refactor.state, "cancelled");
});

test("relay rejects stale lease tokens on direct LPS mutating step results", async (t) => {
  const relay = await startRelay(t, { sessionId: "lps-stale-lease-e2e" });
  let { run } = await createDefaultRun(relay, {
    runId: "lps-stale-lease-run",
    sessionId: "lps-stale-lease-e2e",
    hostId: "lps-stale-lease-host"
  });

  for (const stepId of ["requirements", "design_basic", "design_detail", "test_spec"]) {
    run = await completeStep(relay, run, stepId);
  }
  assert.equal(run.steps.red.state, "running");

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/workflow-runs/${run.id}/steps/red/result`, {
      method: "POST",
      headers: desktopHeaders(relay),
      skipRelayCookie: true,
      body: JSON.stringify({
        ...successfulStepBody(run, "red"),
        leaseHostId: run.leaseHostId,
        fencingToken: run.fencingToken,
        leaseToken: "stale-lease-token"
      })
    }),
    { status: 409 }
  );
});

test("daemon executes LPS TDD actions and resumes workflow state after restart", async (t) => {
  const relay = await startRelay(t, { sessionId: "lps-daemon-e2e" });
  const fakeGemini = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-gemini-cli.mjs").replaceAll("\\", "/");
  const nodePath = process.execPath.replaceAll("\\", "/");
  const hostId = `lps-daemon-host-${process.pid}`;
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
daemon:
  restart: false
  launchOnDemand: false
  remotePollIntervalMs: 100
  hostId: ${hostId}
  commandPollIntervalMs: 100
  commandClaimTtlMs: 5000
codex:
  enabled: false
claude:
  enabled: false
gemini:
  enabled: true
  autoStart: false
  command: ${nodePath}
  args:
    - ${fakeGemini}
    - --output-format
    - stream-json
  cwd: .
  promptFlag: --prompt
  approvalMode: default
opencode:
  enabled: false
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const created = await createDefaultRun(relay, {
    runId: "lps-daemon-run",
    sessionId: "lps-daemon-e2e",
    hostId,
    registerHost: false
  });

  let daemon = spawnNodeForTest(t, ["scripts/legax-daemon.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  daemon.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  await waitFor(async () => {
    const response = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${created.run.id}`, {
      headers: { "x-legax-secret": relay.desktopSecret },
      skipRelayCookie: true
    });
    assert.equal(response.run.state, "waiting_gate", `${stderr}\n${JSON.stringify(response.run, null, 2)}`);
    assert.equal(response.run.steps.green.state, "waiting_gate");
  }, { timeoutMs: 12000, intervalMs: 100 });

  await stopProcessTree(daemon);

  const approved = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${created.run.id}/gates/green`, {
    method: "POST",
    headers: desktopHeaders(relay),
    skipRelayCookie: true,
    body: JSON.stringify({ decision: "approved", decidedBy: "tester" })
  });
  assert.equal(approved.run.steps.green.state, "running");

  daemon = spawnNodeForTest(t, ["scripts/legax-daemon.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  daemon.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  await waitFor(async () => {
    const response = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${created.run.id}`, {
      headers: { "x-legax-secret": relay.desktopSecret },
      skipRelayCookie: true
    });
    assert.equal(response.run.state, "succeeded", `${stderr}\n${JSON.stringify(response.run, null, 2)}`);
    assert.equal(response.run.steps.pr_prepare.state, "succeeded");
    assert.equal(response.run.steps.pr_prepare.result.actionId, "pr.prepare");
  }, { timeoutMs: 12000, intervalMs: 100 });
});
