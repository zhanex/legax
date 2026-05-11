import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import test from "node:test";
import { fetchJson, pluginRoot, removeTempFiles, startRelay, waitFor, writeTempConfig } from "./helpers.mjs";

test("Claude permission MCP server asks phone and returns allow behavior", async (t) => {
  const relay = await startRelay(t, { sessionId: "claude-permission-e2e" });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
claude:
  approvalTimeoutMs: 5000
  permissionBehaviorOnApprove: allow
  permissionBehaviorOnDeny: deny
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const server = spawn(process.execPath, ["scripts/claude-permission-mcp-server.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  t.after(() => server.kill());
  const rpc = createLineRpc(server);

  const init = await rpc.call("initialize", {});
  assert.equal(init.serverInfo.name, "legax-claude-permissions");

  const callPromise = rpc.call("tools/call", {
    name: "approval_prompt",
    arguments: {
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      reason: "Run tests"
    }
  });

  const permissionEvent = await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const event = events.events.find((candidate) => candidate.kind === "permission_request");
    assert.ok(event);
    return event;
  }, { timeoutMs: 7000 });

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "claude-code",
      type: "permission_decision",
      requestId: permissionEvent.metadata.requestId,
      decision: "approve",
      text: "approved"
    })
  });

  const result = await callPromise;
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.behavior, "allow");
});

test("Claude permission MCP respects approval switches from YAML", async (t) => {
  const relay = await startRelay(t, { sessionId: "claude-permission-switch-e2e" });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
approvals:
  enabled: true
  allowFromPhone: false
  defaultOnTimeout: deny
claude:
  approvalTimeoutMs: 5000
  permissionBehaviorOnApprove: allow
  permissionBehaviorOnDeny: deny
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const { rpc, server } = startPermissionServer(configPath, relay.desktopSecret);
  t.after(() => server.kill());
  await rpc.call("initialize", {});

  const result = await rpc.call("tools/call", {
    name: "approval_prompt",
    arguments: {
      tool_name: "Bash",
      tool_input: { command: "dangerous" }
    }
  });
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.behavior, "deny");
});

test("Claude permission MCP reads persisted paused mode before accepting phone approvals", async (t) => {
  const relay = await startRelay(t, { sessionId: "claude-permission-mode-e2e" });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
claude:
  approvalTimeoutMs: 5000
  permissionBehaviorOnApprove: allow
  permissionBehaviorOnDeny: deny
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));
  await fs.writeFile(runtimeStatePath, `${JSON.stringify({
    version: 1,
    sessions: {
      [relay.sessionId]: {
        agents: {
          "claude-code": { mode: "paused" }
        }
      }
    }
  }, null, 2)}\n`, "utf8");

  const { rpc, server } = startPermissionServer(configPath, relay.desktopSecret);
  t.after(() => server.kill());
  await rpc.call("initialize", {});

  const result = await rpc.call("tools/call", {
    name: "approval_prompt",
    arguments: {
      tool_name: "Write",
      tool_input: { file_path: "README.md" }
    }
  });
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.behavior, "deny");
});

function startPermissionServer(configPath, desktopSecret) {
  const server = spawn(process.execPath, ["scripts/claude-permission-mcp-server.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: desktopSecret
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  return { server, rpc: createLineRpc(server) };
}

function createLineRpc(child) {
  let nextId = 1;
  let buffer = "";
  const pending = new Map();
  let stderr = "";

  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    }
  });

  child.on("exit", (code, signal) => {
    const error = new Error(`Permission MCP server exited ${code ?? signal}: ${stderr}`);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });

  return {
    call(method, params) {
      const id = nextId++;
      const promise = waitForResponse(pending, id);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return promise;
    }
  };
}

function waitForResponse(pending, id) {
  const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  const timeout = new Promise((_, reject) => {
    setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for JSON-RPC response ${id}`));
    }, 7000);
  });
  return Promise.race([promise, timeout]);
}
