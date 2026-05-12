import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fetchJson, pluginRoot, removeTempFiles, startRelay, waitFor, writeTempConfig } from "./helpers.mjs";

test("MCP bridge sends to relay and polls phone replies", async (t) => {
  const relay = await startRelay(t, { sessionId: "mcp-e2e" });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const server = spawn(process.execPath, ["scripts/mcp-server.mjs"], {
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
  const initialize = await rpc.call("initialize", {
    clientInfo: { name: "e2e", version: "0.0.2" }
  });
  assert.equal(initialize.serverInfo.name, "legax");
  const rootPackage = JSON.parse(await fs.readFile(path.join(pluginRoot, "package.json"), "utf8"));
  assert.equal(initialize.serverInfo.version, rootPackage.version);

  const tools = await rpc.call("tools/list", {});
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    [
      "legax_poll",
      "legax_request_permission",
      "legax_send",
      "legax_status"
    ].sort()
  );
  for (const tool of tools.tools) {
    assert.deepEqual(
      Object.keys(tool.annotations ?? {}).sort(),
      ["destructiveHint", "openWorldHint", "readOnlyHint"].sort(),
      `${tool.name} must declare all review annotations`
    );
    assert.equal(tool.outputSchema?.type, "object", `${tool.name} must declare an object outputSchema`);
  }
  assert.deepEqual(tools.tools.find((tool) => tool.name === "legax_send").annotations, {
    readOnlyHint: false,
    openWorldHint: true,
    destructiveHint: false
  });
  assert.deepEqual(tools.tools.find((tool) => tool.name === "legax_poll").annotations, {
    readOnlyHint: false,
    openWorldHint: false,
    destructiveHint: false
  });
  assert.deepEqual(tools.tools.find((tool) => tool.name === "legax_request_permission").annotations, {
    readOnlyHint: false,
    openWorldHint: true,
    destructiveHint: false
  });
  assert.deepEqual(tools.tools.find((tool) => tool.name === "legax_status").annotations, {
    readOnlyHint: true,
    openWorldHint: false,
    destructiveHint: false
  });

  assert.deepEqual(await rpc.call("resources/list", {}), { resources: [] });
  assert.deepEqual(await rpc.call("resources/templates/list", {}), { resourceTemplates: [] });
  assert.deepEqual(await rpc.call("prompts/list", {}), { prompts: [] });

  const sendResult = await rpc.call("tools/call", {
    name: "legax_send",
    arguments: {
      kind: "status",
      text: "hello from mcp e2e"
    }
  });
  const sendBody = JSON.parse(sendResult.content[0].text);
  assert.equal(sendBody.ok, true);
  assert.equal(sendResult.structuredContent.ok, true);
  assert.equal(sendResult.structuredContent.event.text, "hello from mcp e2e");

  const phoneEvents = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
  assert.equal(phoneEvents.events.length, 1);
  assert.equal(phoneEvents.events[0].text, "hello from mcp e2e");

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "mcp-agent",
      type: "text",
      text: "reply from phone"
    })
  });

  const pollResult = await rpc.call("tools/call", {
    name: "legax_poll",
    arguments: {
      sessionId: relay.sessionId
    }
  });
  const pollBody = JSON.parse(pollResult.content[0].text);
  assert.equal(pollBody.messages.length, 1);
  assert.equal(pollBody.messages[0].text, "reply from phone");
  assert.equal(pollResult.structuredContent.messages.length, 1);
  assert.equal(pollResult.structuredContent.messages[0].text, "reply from phone");
});

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
    const error = new Error(`MCP server exited ${code ?? signal}: ${stderr}`);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });

  return {
    async call(method, params) {
      const id = nextId++;
      const promise = waitForResponse(pending, id);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return await promise;
    }
  };
}

async function waitForResponse(pending, id) {
  const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  const timeout = new Promise((_, reject) => {
    setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for JSON-RPC response ${id}`));
    }, 7000);
  });
  return await Promise.race([promise, timeout]);
}
