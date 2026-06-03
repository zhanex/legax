import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { pluginRoot } from "./helpers.mjs";

const summaryDocs = [
  "docs/ARCHITECTURE.md",
  "docs/ARCHITECTURE.zh-CN.md",
  "docs/FUNCTIONAL_BOUNDARIES.md",
  "docs/FUNCTIONAL_BOUNDARIES.zh-CN.md",
  "docs/RELAY_API.md",
  "docs/RELAY_API.zh-CN.md",
  "docs/RELAY_STORE.md",
  "docs/RELAY_STORE.zh-CN.md",
  "docs/LEGAX_PROTOCOL.md",
  "docs/LEGAX_PROTOCOL.zh-CN.md",
  "docs/ENGINEERING_GUIDE.md",
  "docs/ENGINEERING_GUIDE.zh-CN.md",
  "docs/CONFIGURATION.md",
  "docs/CONFIGURATION.zh-CN.md",
  "docs/RUNTIME_STATE.md",
  "docs/RUNTIME_STATE.zh-CN.md",
  "docs/STATE_MACHINES.md",
  "docs/STATE_MACHINES.zh-CN.md"
];

function runBudgetCheck(cwd = pluginRoot) {
  return spawnSync(process.execPath, [path.join(pluginRoot, "scripts", "check-doc-context-budget.mjs")], {
    cwd,
    encoding: "utf8"
  });
}

async function createBudgetFixture(t, name) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `legax-doc-budget-${name}-`));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.writeFile(path.join(root, "AGENTS.md"), "# AGENTS\n\nRead docs/context_for_llms.md.\n", "utf8");
  await fs.writeFile(path.join(root, "AGENTS.zh-CN.md"), "# AGENTS\n\n\u8bf7\u8bfb docs/context_for_llms.zh-CN.md\u3002\n", "utf8");
  await fs.writeFile(path.join(root, "docs", "context_for_llms.md"), "# Context For LLMs\n\nEnglish | [Simplified Chinese](context_for_llms.zh-CN.md)\n\n## Read Budget\n\nRead this file and one task document.\n", "utf8");
  await fs.writeFile(path.join(root, "docs", "context_for_llms.zh-CN.md"), "# LLM \u4e0a\u4e0b\u6587\n\n[English](context_for_llms.md) | \u7b80\u4f53\u4e2d\u6587\n\n## \u9605\u8bfb\u9884\u7b97\n\n\u53ea\u8bfb\u672c\u6587\u548c\u4e00\u4e2a\u4efb\u52a1\u6587\u6863\u3002\n", "utf8");
  await fs.writeFile(path.join(root, "docs", "README.md"), "# Documentation Index\n\nUse context_for_llms.md for agent routing.\n", "utf8");
  await fs.writeFile(path.join(root, "docs", "README.zh-CN.md"), "# \u6587\u6863\u7d22\u5f15\n\nAgent \u8def\u7531\u8bf7\u7528 context_for_llms.zh-CN.md\u3002\n", "utf8");
  for (const relPath of summaryDocs) {
    await fs.mkdir(path.dirname(path.join(root, relPath)), { recursive: true });
    await fs.writeFile(path.join(root, relPath), "# Contract\n\n## Agent Summary\n\nThis file owns one compact contract summary.\n", "utf8");
  }
  return root;
}

test("documentation context budget checker passes the current repository", () => {
  const result = runBudgetCheck();
  assert.equal(result.status, 0, result.stderr);
});

test("documentation context budget checker rejects oversized agent entry docs", async (t) => {
  const root = await createBudgetFixture(t, "oversized");
  await fs.writeFile(path.join(root, "AGENTS.md"), `# AGENTS\n\n${"x".repeat(5000)}\n`, "utf8");

  const result = runBudgetCheck(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AGENTS\.md is .* over the 4096 byte/);
});

test("documentation context budget checker rejects missing summaries", async (t) => {
  const root = await createBudgetFixture(t, "summary");
  await fs.writeFile(path.join(root, "docs", "RELAY_API.md"), "# Relay API\n\nNo summary here.\n", "utf8");

  const result = runBudgetCheck(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /docs\/RELAY_API\.md is missing a ## Agent Summary section/);
});

test("documentation context budget checker rejects default routing to Chinese pairs", async (t) => {
  const root = await createBudgetFixture(t, "zh-routing");
  await fs.writeFile(
    path.join(root, "docs", "context_for_llms.md"),
    "# Context For LLMs\n\nEnglish | [Simplified Chinese](context_for_llms.zh-CN.md)\n\n## Read Budget\n\nDefault work should read docs/ARCHITECTURE.zh-CN.md.\n",
    "utf8"
  );

  const result = runBudgetCheck(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not route default agent work to \.zh-CN\.md files/);
});
