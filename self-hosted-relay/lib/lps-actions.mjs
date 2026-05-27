export const LPS_TDD_WORKFLOW_ID = "lps-tdd";

export const LPS_ACTIONS = Object.freeze([
  {
    id: "requirements.capture",
    title: "Capture Requirements",
    mutatesWorkspace: false,
    inputs: { required: ["scope"], optional: ["nonGoals", "constraints", "risks", "acceptanceCriteria"] },
    outputs: { required: ["requirementsDocument"], optional: ["riskRegister"] },
    evidence: { required: ["actionId", "summary", "outputRefs"], optional: ["acceptanceCriteria"] },
    policy: {}
  },
  {
    id: "design.basic",
    title: "Basic Design",
    mutatesWorkspace: false,
    inputs: { required: ["requirements"], optional: ["affectedModules"] },
    outputs: { required: ["basicDesignDocument"], optional: ["moduleMap"] },
    evidence: { required: ["actionId", "summary", "outputRefs"], optional: ["affectedModules"] },
    policy: {}
  },
  {
    id: "design.detail",
    title: "Detailed Design",
    mutatesWorkspace: false,
    inputs: { required: ["basicDesign"], optional: ["stateTransitions", "migrationNotes"] },
    outputs: { required: ["detailedDesignDocument"], optional: ["apiContracts", "failureModes"] },
    evidence: { required: ["actionId", "summary", "outputRefs"], optional: ["stateTransitions"] },
    policy: {}
  },
  {
    id: "test.spec",
    title: "Test Specification",
    mutatesWorkspace: false,
    inputs: { required: ["detailedDesign"], optional: ["acceptanceCriteria"] },
    outputs: { required: ["testPlanDocument"], optional: ["redAssertions"] },
    evidence: { required: ["actionId", "summary", "outputRefs"], optional: ["testPlan"] },
    policy: {}
  },
  {
    id: "tdd.red",
    title: "TDD Red",
    mutatesWorkspace: true,
    requiresLease: true,
    inputs: { required: ["testPlan"], optional: ["targetFiles"] },
    outputs: { required: ["testPatch"], optional: ["expectedFailure"] },
    evidence: { required: ["actionId", "summary", "outputRefs", "expectedFailure"], optional: ["failureReason"] },
    policy: { requiresLease: true }
  },
  {
    id: "tdd.review_red",
    title: "Review Red",
    mutatesWorkspace: false,
    inputs: { required: ["redResult"], optional: ["expectedFailure"] },
    outputs: { required: ["redReview"], optional: ["vacuityReport"] },
    evidence: { required: ["actionId", "summary", "outputRefs", "redVerified", "expectedFailure", "vacuous"], optional: ["failureReason"] },
    policy: { requiredEvidence: { redVerified: true, expectedFailure: true, vacuous: false } }
  },
  {
    id: "tdd.green",
    title: "TDD Green",
    mutatesWorkspace: true,
    requiresLease: true,
    inputs: { required: ["redReview"], optional: ["implementationNotes"] },
    outputs: { required: ["implementationPatch"], optional: ["changedFiles"] },
    evidence: { required: ["actionId", "summary", "outputRefs"], optional: ["changedFiles"] },
    policy: { requiresLease: true }
  },
  {
    id: "tdd.review_green",
    title: "Review Green",
    mutatesWorkspace: false,
    inputs: { required: ["greenResult"], optional: ["edgeCases"] },
    outputs: { required: ["greenReview"], optional: ["edgeCaseReport"] },
    evidence: { required: ["actionId", "summary", "outputRefs", "greenVerified", "edgeCasesReviewed"], optional: ["regressions"] },
    policy: { requiredEvidence: { greenVerified: true, edgeCasesReviewed: true } }
  },
  {
    id: "tdd.refactor",
    title: "TDD Refactor",
    mutatesWorkspace: true,
    requiresLease: true,
    inputs: { required: ["greenReview"], optional: ["cleanupTargets"] },
    outputs: { required: ["refactorPatch"], optional: ["changedFiles"] },
    evidence: { required: ["actionId", "summary", "outputRefs"], optional: ["behaviorPreserved"] },
    policy: { requiresLease: true }
  },
  {
    id: "workflow.run_check",
    title: "Run Approved Check",
    mutatesWorkspace: false,
    inputs: { required: ["checkRef"], optional: ["checkProfile"] },
    outputs: { required: ["checkResult"], optional: ["durationMs"] },
    evidence: { required: ["actionId", "summary", "outputRefs", "checkRef"], optional: ["exitCode"] },
    policy: { commandRefOnly: true }
  },
  {
    id: "review.self",
    title: "Self Review",
    mutatesWorkspace: false,
    inputs: { required: ["checkResult"], optional: ["diffSummary"] },
    outputs: { required: ["selfReview"], optional: ["testGaps"] },
    evidence: { required: ["actionId", "summary", "outputRefs"], optional: ["securityReview"] },
    policy: {}
  },
  {
    id: "pr.prepare",
    title: "Prepare Pull Request",
    mutatesWorkspace: false,
    inputs: { required: ["selfReview"], optional: ["issueRefs"] },
    outputs: { required: ["prPreparation"], optional: ["branchStatus", "diffSummary"] },
    evidence: { required: ["actionId", "summary", "outputRefs"], optional: ["issueRefs"] },
    policy: {}
  },
  {
    id: "pr.create",
    title: "Create Pull Request",
    mutatesWorkspace: false,
    inputs: { required: ["prPreparation"], optional: ["baseBranch"] },
    outputs: { required: ["pullRequest"], optional: ["url"] },
    evidence: { required: ["actionId", "summary", "outputRefs", "draft"], optional: ["url"] },
    policy: { disabledByDefault: true, requiresGate: true, draftFirst: true }
  }
]);

export const LPS_ACTION_IDS = Object.freeze(LPS_ACTIONS.map((action) => action.id));
const ACTION_BY_ID = new Map(LPS_ACTIONS.map((action) => [action.id, action]));
const SAFE_CHECK_REF_PATTERN = /^[A-Za-z0-9._:/-]{1,160}$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function lpsActionById(actionId) {
  return ACTION_BY_ID.get(String(actionId ?? "")) ?? null;
}

export function lpsActionContracts() {
  return clone(LPS_ACTIONS);
}

function defaultStep(id, uses, extra = {}) {
  const action = lpsActionById(uses);
  return {
    id,
    uses,
    needs: extra.needs ?? [],
    gate: extra.gate ?? null,
    retry: { maxAttempts: extra.maxAttempts ?? 1 },
    timeoutMs: extra.timeoutMs ?? 30000,
    artifacts: extra.artifacts ?? {},
    evidence: { required: action?.evidence.required ?? ["summary"] }
  };
}

export function lpsDefaultWorkflowDefinition(now = new Date().toISOString()) {
  return {
    id: LPS_TDD_WORKFLOW_ID,
    schema: "legax.workflow/1",
    version: "1.0.0",
    builtIn: true,
    metadata: {
      title: "LPS Documented TDD",
      description: "Strict document-driven TDD flow from requirements capture through PR preparation."
    },
    inputs: {
      scope: { type: "string", default: "" },
      acceptanceCriteria: { type: "array", default: [] },
      checkRef: { type: "string", default: "ci" },
      issueRefs: { type: "array", default: [] }
    },
    steps: [
      defaultStep("requirements", "requirements.capture"),
      defaultStep("design_basic", "design.basic", { needs: ["requirements"] }),
      defaultStep("design_detail", "design.detail", { needs: ["design_basic"] }),
      defaultStep("test_spec", "test.spec", { needs: ["design_detail"] }),
      defaultStep("red", "tdd.red", { needs: ["test_spec"], timeoutMs: 60000 }),
      defaultStep("review_red", "tdd.review_red", { needs: ["red"] }),
      defaultStep("green", "tdd.green", {
        needs: ["review_red"],
        timeoutMs: 60000,
        gate: {
          before: true,
          reason: "Approve implementation after red verification",
          policy: "manual"
        }
      }),
      defaultStep("review_green", "tdd.review_green", { needs: ["green"] }),
      defaultStep("refactor", "tdd.refactor", { needs: ["review_green"], timeoutMs: 60000 }),
      defaultStep("run_check", "workflow.run_check", { needs: ["refactor"], timeoutMs: 120000 }),
      defaultStep("self_review", "review.self", { needs: ["run_check"] }),
      defaultStep("pr_prepare", "pr.prepare", { needs: ["self_review"] })
    ],
    createdAt: now,
    updatedAt: now
  };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireEvidence(evidence, key, expected, actionId) {
  if (!hasOwn(evidence, key)) throw new Error(`${actionId} evidence missing ${key}`);
  if (expected !== undefined && evidence[key] !== expected) throw new Error(`${actionId} evidence ${key} must be ${expected}`);
}

export function validateLpsActionResult(actionId, state, body) {
  const action = lpsActionById(actionId);
  if (!action || state !== "succeeded") return;
  const result = body.result && typeof body.result === "object" ? body.result : {};
  const evidence = body.evidence && typeof body.evidence === "object" ? body.evidence : {};
  for (const key of action.outputs.required) {
    if (!hasOwn(result, key) && !hasOwn(result.outputs ?? {}, key)) {
      throw new Error(`${actionId} result missing ${key}`);
    }
  }
  for (const key of action.evidence.required) {
    requireEvidence(evidence, key, undefined, actionId);
  }
  for (const [key, expected] of Object.entries(action.policy.requiredEvidence ?? {})) {
    requireEvidence(evidence, key, expected, actionId);
  }
  if (action.policy.draftFirst) requireEvidence(evidence, "draft", true, actionId);
}

function dependency(command, stepId) {
  return command.payload?.dependencies?.[stepId] ?? {};
}

function baseResult(actionId, summary, outputKey, outputValue, evidence = {}) {
  return {
    actionId,
    summary,
    outputs: { [outputKey]: outputValue },
    [outputKey]: outputValue,
    evidence: {
      actionId,
      summary,
      outputRefs: [`workflow://${actionId}`],
      ...evidence
    }
  };
}

function safeCheckRef(value) {
  const checkRef = String(value ?? "ci").trim() || "ci";
  if (!SAFE_CHECK_REF_PATTERN.test(checkRef)) throw new Error("workflow.run_check checkRef must be an approved command reference");
  return checkRef;
}

export function executeLpsAction(command, { hostId = "", prCreateEnabled = false } = {}) {
  const actionId = String(command.commandRef ?? "");
  const inputs = command.payload?.inputs ?? {};
  if (actionId === "requirements.capture") {
    return baseResult(actionId, "Captured scope, constraints, risks, and acceptance criteria.", "requirementsDocument", "requirements.md", {
      acceptanceCriteria: inputs.acceptanceCriteria ?? []
    });
  }
  if (actionId === "design.basic") {
    return baseResult(actionId, "Produced high-level architecture and affected modules.", "basicDesignDocument", "design-basic.md", {
      affectedModules: inputs.affectedModules ?? []
    });
  }
  if (actionId === "design.detail") {
    return baseResult(actionId, "Defined APIs, state transitions, failure modes, and migration notes.", "detailedDesignDocument", "design-detail.md", {
      stateTransitions: ["pending", "running", "succeeded", "failed"]
    });
  }
  if (actionId === "test.spec") {
    return baseResult(actionId, "Wrote the test plan before implementation.", "testPlanDocument", "test-plan.md", {
      testPlan: inputs.acceptanceCriteria ?? []
    });
  }
  if (actionId === "tdd.red") {
    return baseResult(actionId, "Added failing tests only.", "testPatch", "patches/red.diff", {
      expectedFailure: true,
      failureReason: "expected red failure"
    });
  }
  if (actionId === "tdd.review_red") {
    const redEvidence = dependency(command, "red").evidence ?? {};
    if (inputs.forceRedVerificationFailure === true || redEvidence.expectedFailure !== true) {
      throw new Error("red tests did not fail for the expected reason");
    }
    return baseResult(actionId, "Verified red tests fail for the intended reason and are not vacuous.", "redReview", "reviews/red.md", {
      redVerified: true,
      expectedFailure: true,
      vacuous: false
    });
  }
  if (actionId === "tdd.green") {
    return baseResult(actionId, "Implemented the minimum code to satisfy the agreed red tests.", "implementationPatch", "patches/green.diff");
  }
  if (actionId === "tdd.review_green") {
    if (inputs.forceGreenVerificationFailure === true) throw new Error("green behavior did not meet the agreed edge cases");
    return baseResult(actionId, "Verified green behavior, edge cases, and evidence.", "greenReview", "reviews/green.md", {
      greenVerified: true,
      edgeCasesReviewed: true
    });
  }
  if (actionId === "tdd.refactor") {
    return baseResult(actionId, "Cleaned up implementation without changing behavior.", "refactorPatch", "patches/refactor.diff", {
      behaviorPreserved: true
    });
  }
  if (actionId === "workflow.run_check") {
    const checkRef = safeCheckRef(inputs.checkRef);
    return baseResult(actionId, `Ran approved check ${checkRef}.`, "checkResult", "checks/result.json", {
      checkRef,
      exitCode: 0
    });
  }
  if (actionId === "review.self") {
    return baseResult(actionId, "Reviewed regressions, security, docs, and test gaps.", "selfReview", "reviews/self.md", {
      securityReview: true
    });
  }
  if (actionId === "pr.prepare") {
    return baseResult(actionId, "Prepared branch status, diff summary, test evidence, and issue references.", "prPreparation", "pr/prepare.json", {
      issueRefs: inputs.issueRefs ?? [],
      hostId
    });
  }
  if (actionId === "pr.create") {
    if (prCreateEnabled !== true) throw new Error("pr.create is disabled by default");
    return baseResult(actionId, "Prepared a draft pull request creation request.", "pullRequest", "pr/draft.json", {
      draft: true
    });
  }
  throw new Error(`unsupported LPS action: ${actionId}`);
}
