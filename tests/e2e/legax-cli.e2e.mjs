import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { dataDir, pluginRoot, removeTempFiles, startRelay, writeTempConfig } from "./helpers.mjs";

function runLegax(args, env = {}) {
  return spawnSync(process.execPath, ["scripts/legax-cli.mjs", ...args], {
    cwd: pluginRoot,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

test("legax init creates a local config with matching generated relay secrets", async (t) => {
  await fs.mkdir(dataDir, { recursive: true });
  const configPath = path.join(dataDir, `legax-init-e2e-${process.pid}-${Date.now()}.yaml`);
  t.after(() => removeTempFiles(configPath));

  const result = runLegax(["init", "--config", configPath, "--relay-secret", "init-secret"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Created config/);

  const text = await fs.readFile(configPath, "utf8");
  assert.match(text, /secret: init-secret/);
  assert.doesNotMatch(text, /replace-with-a-long-random-secret/);

  const overwrite = runLegax(["init", "--config", configPath]);
  assert.equal(overwrite.status, 1);
  assert.match(overwrite.stderr, /already exists/);
});

test("legax doctor reports relay, Telegram, and adapter health without leaking secrets", async (t) => {
  const relay = await startRelay(t, { sessionId: "doctor-e2e" });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
codex:
  enabled: true
  autoStart: false
  command: ${process.execPath.replaceAll("\\", "/")}
claude:
  enabled: false
gemini:
  enabled: false
opencode:
  enabled: false
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const result = runLegax(["doctor", "--config", configPath, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.configPath, configPath);
  assert.ok(body.checks.some((check) => check.name === "relay.health" && check.status === "ok"));
  assert.ok(body.checks.some((check) => check.name === "adapter.codex-cli.command" && check.status === "ok"));
  assert.ok(body.checks.some((check) => check.name === "telegram.transport" && check.status === "skipped"));
  assert.ok(body.checks.some((check) => check.name === "feishu.transport" && check.status === "skipped"));
  assert.doesNotMatch(result.stdout, new RegExp(relay.desktopSecret));
});

test("legax worktree supports create, list, check, and archive", async (t) => {
  const name = `legax-e2e-${process.pid}-${Date.now()}`;
  const result = runLegax(["worktree", "create", "--name", name, "--base", "HEAD", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const created = JSON.parse(result.stdout);
  assert.equal(created.ok, true);
  assert.equal(created.worktree.name, name);
  t.after(() => {
    runLegax(["worktree", "archive", "--name", name, "--delete-branch", "--json"]);
  });

  const listed = runLegax(["worktree", "list", "--json"]);
  assert.equal(listed.status, 0, listed.stderr);
  const listBody = JSON.parse(listed.stdout);
  assert.ok(listBody.worktrees.some((entry) => entry.name === name));

  const checked = runLegax(["worktree", "check", "--name", name, "--json", "--", process.execPath, "--version"]);
  assert.equal(checked.status, 0, checked.stderr);
  const checkBody = JSON.parse(checked.stdout);
  assert.equal(checkBody.ok, true);
  assert.equal(checkBody.exitCode, 0);

  const archived = runLegax(["worktree", "archive", "--name", name, "--delete-branch", "--json"]);
  assert.equal(archived.status, 0, archived.stderr);
  assert.equal(JSON.parse(archived.stdout).ok, true);
});
