import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { closeHttpServer, dataDir, fetchJson, getFreePort, pluginRoot, removeTempFiles, startRelay, waitFor, writeTempConfig } from "./helpers.mjs";

test("Codex App Server link dry-run reads YAML config without starting codex", async (t) => {
  const relay = await startRelay(t, { sessionId: "codex-link-e2e" });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
codex:
  cliBackend: app-server
  command: codex.cmd
  args:
    - app-server
    - --listen
    - stdio://
  cwd: .
  threadCwd: .
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const result = await runNode(["scripts/codex-app-server-link.mjs", "--dry-run"], {
    LEGAX_CONFIG: configPath,
    LEGAX_SECRET: relay.desktopSecret
  });
  assert.equal(result.code, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.sessionId, relay.sessionId);
  assert.equal(body.relay.baseUrl, relay.baseUrl);
  assert.equal(body.codex.command, "codex.cmd");
  assert.equal(body.codex.cliBackend, "app-server");
  assert.equal(body.codex.mcpEnabled, true);
});

test("Codex App Server link dry-run builds proxy args for existing app-server mode", async (t) => {
  const relay = await startRelay(t, { sessionId: "codex-existing-proxy-e2e" });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
codex:
  command: codex.cmd
  cliBackend: app-server-proxy
  useExisting: true
  cwd: .
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const result = await runNode(["scripts/codex-app-server-link.mjs", "--dry-run"], {
    LEGAX_CONFIG: configPath,
    LEGAX_SECRET: relay.desktopSecret
  });
  assert.equal(result.code, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.codex.useExisting, true);
  assert.equal(body.codex.cliBackend, "app-server-proxy");
  assert.deepEqual(body.codex.args, ["app-server", "proxy"]);
});

test("Codex App Server link dry-run describes shared websocket mode", async (t) => {
  const relay = await startRelay(t, { sessionId: "codex-existing-ws-dry-run-e2e" });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
codex:
  command: codex.cmd
  cliBackend: app-server-ws
  useExisting: true
  appServerUrl: ws://127.0.0.1:18779/rpc
  sharedServerMode: connect-or-start
  autoStartSharedServer: true
  cwd: .
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const result = await runNode(["scripts/codex-app-server-link.mjs", "--dry-run"], {
    LEGAX_CONFIG: configPath,
    LEGAX_SECRET: relay.desktopSecret
  });
  assert.equal(result.code, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.codex.useExisting, true);
  assert.equal(body.codex.cliBackend, "app-server-ws");
  assert.equal(body.codex.appServerUrl, "ws://127.0.0.1:18779/rpc");
  assert.equal(body.codex.sharedServerMode, "connect-or-start");
  assert.equal(body.codex.autoStartSharedServer, true);
  assert.deepEqual(body.codex.args, ["app-server", "--listen", "ws://127.0.0.1:18779"]);
});

test("Codex App Server shared websocket mode completes custom app-server args", async (t) => {
  const relay = await startRelay(t, { sessionId: "codex-existing-ws-custom-args-e2e" });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
codex:
  command: codex.cmd
  cliBackend: app-server-ws
  useExisting: true
  appServerUrl: ws://127.0.0.1:18781/rpc
  sharedServerMode: connect-or-start
  autoStartSharedServer: true
  args:
    - app-server
  cwd: .
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const result = await runNode(["scripts/codex-app-server-link.mjs", "--dry-run"], {
    LEGAX_CONFIG: configPath,
    LEGAX_SECRET: relay.desktopSecret
  });
  assert.equal(result.code, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.deepEqual(body.codex.args, ["app-server", "--listen", "ws://127.0.0.1:18781"]);
});

test("Codex App Server connect-only mode does not imply shared server autostart", async (t) => {
  const relay = await startRelay(t, { sessionId: "codex-connect-only-dry-run-e2e" });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
codex:
  command: codex.cmd
  cliBackend: app-server-ws
  useExisting: true
  appServerUrl: ws://127.0.0.1:18779/rpc
  sharedServerMode: connect-only
  cwd: .
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const result = await runNode(["scripts/codex-app-server-link.mjs", "--dry-run"], {
    LEGAX_CONFIG: configPath,
    LEGAX_SECRET: relay.desktopSecret
  });
  assert.equal(result.code, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.codex.sharedServerMode, "connect-only");
  assert.equal(body.codex.autoStartSharedServer, false);
});

test("Codex App Server link connects to an existing shared websocket app-server", async (t) => {
  const relay = await startRelay(t, { sessionId: "codex-existing-ws-e2e" });
  const fakeServer = await startFakeCodexWebSocketServer(t);
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
codex:
  cliBackend: app-server-ws
  useExisting: true
  appServerUrl: ${fakeServer.url}
  sharedServerMode: connect-only
  cwd: .
  threadCwd: .
  pollIntervalMs: 100
  approvalTimeoutMs: 5000
  startThreadOnStartup: true
  notifyOnConnection: true
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const link = spawn(process.execPath, ["scripts/codex-app-server-link.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  link.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => link.kill());

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const event = events.events.find((candidate) => candidate.kind === "status" && /Codex App Server connected/.test(candidate.text));
    assert.ok(event, stderr);
    assert.equal(event.metadata.telegramSuppress, true);
  }, { timeoutMs: 7000 });

  await postPhoneMessage(relay, {
    targetAgentId: "codex-cli",
    type: "text",
    text: "hello websocket codex"
  });

  const permissionEvent = await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const event = events.events.find((candidate) => candidate.kind === "permission_request");
    assert.ok(event, `${stderr}\n${JSON.stringify(events.events, null, 2)}`);
    return event;
  }, { timeoutMs: 7000 });

  await postPhoneMessage(relay, {
    targetAgentId: "codex-cli",
    type: "permission_decision",
    requestId: permissionEvent.metadata.requestId,
    decision: "approve",
    text: "approved"
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => event.kind === "agent_text"
      && event.text === "codex websocket approved: hello websocket codex"), detail);
  }, { timeoutMs: 7000 });
});

test("Codex App Server link forwards phone text and resolves approval requests", async (t) => {
  const relay = await startRelay(t, { sessionId: "codex-app-server-fake-e2e" });
  const fakeCodex = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-codex-app-server.mjs").replaceAll("\\", "/");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
codex:
  cliBackend: app-server
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeCodex}
  cwd: .
  threadCwd: .
  pollIntervalMs: 100
  approvalTimeoutMs: 5000
  startThreadOnStartup: true
  notifyOnConnection: true
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const link = spawn(process.execPath, ["scripts/codex-app-server-link.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  link.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => link.kill());

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    assert.ok(events.events.some((event) => event.kind === "status" && /Codex App Server connected/.test(event.text)));
  }, { timeoutMs: 7000 });

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "codex-cli",
      type: "text",
      text: "hello codex"
    })
  });

  const permissionEvent = await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const event = events.events.find((candidate) => candidate.kind === "permission_request");
    assert.ok(event, `${stderr}\n${JSON.stringify(events.events, null, 2)}`);
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
      targetAgentId: "codex-cli",
      type: "permission_decision",
      requestId: permissionEvent.metadata.requestId,
      decision: "approve",
      text: "approved"
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "codex approved: hello codex"), detail);
  }, { timeoutMs: 7000 });
});

test("Codex App Server link keeps normal agent text quiet until a turn completes", async (t) => {
  const relay = await startRelay(t, { sessionId: "codex-low-noise-e2e" });
  const fakeCodex = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-codex-app-server.mjs").replaceAll("\\", "/");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
codex:
  cliBackend: app-server
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeCodex}
  cwd: .
  threadCwd: .
  pollIntervalMs: 100
  approvalTimeoutMs: 1000
  startThreadOnStartup: true
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const link = spawn(process.execPath, ["scripts/codex-app-server-link.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  link.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => link.kill());

  await new Promise((resolve) => setTimeout(resolve, 300));
  await postPhoneMessage(relay, {
    targetAgentId: "codex-cli",
    type: "text",
    text: "agent-message-only"
  });

  await new Promise((resolve) => setTimeout(resolve, 700));
  const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
  const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
  assert.ok(!events.events.some((event) => event.kind === "agent_text" && /codex progress/.test(event.text)), detail);
  assert.ok(!events.events.some((event) => event.kind === "status" && /Turn completed/.test(event.text)), detail);
});

test("Codex App Server link supports approvals and tool user-input requests", async (t) => {
  const relay = await startRelay(t, { sessionId: "codex-approval-e2e" });
  const fakeCodex = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-codex-app-server.mjs").replaceAll("\\", "/");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
codex:
  cliBackend: app-server
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeCodex}
  cwd: .
  threadCwd: .
  pollIntervalMs: 100
  approvalTimeoutMs: 5000
  startThreadOnStartup: true
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const link = spawn(process.execPath, ["scripts/codex-app-server-link.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  link.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => link.kill());

  await new Promise((resolve) => setTimeout(resolve, 300));
  await postPhoneMessage(relay, {
    targetAgentId: "codex-cli",
    type: "text",
    text: "approval please"
  });

  const approval = await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const event = events.events.find((candidate) => candidate.kind === "permission_request"
      && candidate.metadata?.approvalMethod === "item/commandExecution/requestApproval");
    assert.ok(event, `${stderr}\n${JSON.stringify(events.events, null, 2)}`);
    return event;
  }, { timeoutMs: 7000 });

  await postPhoneMessage(relay, {
    targetAgentId: "codex-cli",
    type: "permission_decision",
    requestId: approval.metadata.requestId,
    decision: "approve",
    text: "approved"
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "codex approved: approval please"), detail);
  }, { timeoutMs: 7000 });

  await postPhoneMessage(relay, {
    targetAgentId: "codex-cli",
    type: "text",
    text: "request input please"
  });

  const inputRequest = await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const event = events.events.find((candidate) => candidate.kind === "user_input_request");
    assert.ok(event, `${stderr}\n${JSON.stringify(events.events, null, 2)}`);
    assert.match(event.text, /\/answer/);
    return event;
  }, { timeoutMs: 7000 });

  await postPhoneMessage(relay, {
    targetAgentId: "codex-cli",
    type: "user_input_response",
    requestId: inputRequest.metadata.requestId,
    text: "beta"
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "codex approved: input beta"), detail);
  }, { timeoutMs: 7000 });
});

test("Codex App Server link lets phone choose CLI and resume a session before chatting", async (t) => {
  const relay = await startRelay(t, { sessionId: "codex-session-menu-e2e" });
  const fakeCodex = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-codex-app-server.mjs").replaceAll("\\", "/");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
codex:
  cliBackend: app-server
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeCodex}
  cwd: .
  threadCwd: .
  pollIntervalMs: 100
  approvalTimeoutMs: 5000
  listThreadsOnStartup: false
  startThreadOnStartup: false
  resumeSelectedThreadOnStartup: false
  sessionHistoryOnSelectLimit: 2
  notifyOnConnection: true
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const link = spawn(process.execPath, ["scripts/codex-app-server-link.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  link.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => link.kill());

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    assert.ok(events.events.some((event) => event.kind === "status" && /Use \/start/.test(event.text)), stderr);
  }, { timeoutMs: 7000 });

  await postPhoneMessage(relay, {
    targetAgentId: "codex-cli",
    type: "control",
    action: "list_agents",
    text: "/start"
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    assert.ok(events.events.some((event) => /Choose a CLI adapter/.test(event.text)), stderr);
  }, { timeoutMs: 7000 });

  await postPhoneMessage(relay, {
    targetAgentId: "codex-cli",
    type: "control",
    action: "list_agent_projects",
    selectedAgentId: "codex-cli",
    text: "/projects codex-cli"
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    const menu = events.events.find((event) => /Choose a Codex project\/chat/.test(event.text));
    assert.ok(menu, detail);
    const callbacks = menu.metadata.telegramReplyMarkup.inline_keyboard.flat().map((item) => item.callback_data);
    assert.ok(callbacks.includes("legax:project:codex-cli:chats"), detail);
    assert.ok(callbacks.includes("legax:project:codex-cli:1"), detail);
  }, { timeoutMs: 7000 });

  await postPhoneMessage(relay, {
    targetAgentId: "codex-cli",
    type: "control",
    action: "list_agent_sessions",
    selectedAgentId: "codex-cli",
    projectRef: "1",
    text: "/sessions codex-cli 1"
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => /Legax smoke/.test(event.text) && !/Second fake session/.test(event.text)), detail);
  }, { timeoutMs: 7000 });

  await postPhoneMessage(relay, {
    targetAgentId: "codex-cli",
    type: "control",
    action: "list_agent_sessions",
    selectedAgentId: "codex-cli",
    projectRef: "chats",
    text: "/sessions codex-cli chats"
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    const menu = events.events.find((event) => /Second fake session/.test(event.text) && !/Legax smoke/.test(event.text));
    assert.ok(menu, detail);
    const callbacks = menu.metadata.telegramReplyMarkup.inline_keyboard.flat().map((item) => item.callback_data);
    assert.ok(callbacks.includes("legax:new:codex-cli"), detail);
  }, { timeoutMs: 7000 });

  await postPhoneMessage(relay, {
    targetAgentId: "codex-cli",
    type: "control",
    action: "select_session",
    threadRef: "1",
    text: "/use codex-cli 1"
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => event.kind === "status" && /Selected Codex session: Second fake session/.test(event.text)), detail);
    assert.ok(events.events.some((event) => event.kind === "agent_text"
      && event.metadata?.sessionHistory === true
      && event.metadata?.author === "user"
      && event.text === "summarize task two"), detail);
    assert.ok(events.events.some((event) => event.kind === "agent_text"
      && event.metadata?.sessionHistory === true
      && event.metadata?.author === "agent"
      && /task two is ready/.test(event.text)
      && /final untruncated marker$/.test(event.text)), detail);
  }, { timeoutMs: 7000 });

  await postPhoneMessage(relay, {
    targetAgentId: "codex-cli",
    type: "text",
    text: "hello selected session"
  });

  const permissionEvent = await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const event = events.events.find((candidate) => candidate.kind === "permission_request");
    assert.ok(event, `${stderr}\n${JSON.stringify(events.events, null, 2)}`);
    return event;
  }, { timeoutMs: 7000 });

  await postPhoneMessage(relay, {
    targetAgentId: "codex-cli",
    type: "permission_decision",
    requestId: permissionEvent.metadata.requestId,
    decision: "approve",
    text: "approved"
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => event.kind === "agent_text"
      && event.text === "codex approved: hello selected session"
      && event.metadata?.threadId === "thread-second"), detail);
  }, { timeoutMs: 7000 });
});

test("Codex App Server link filters archived chat sessions and paginates chats", async (t) => {
  await fs.mkdir(dataDir, { recursive: true });
  const relay = await startRelay(t, { sessionId: "codex-chat-pagination-e2e" });
  const fakeCodex = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-codex-app-server.mjs").replaceAll("\\", "/");
  const configPath = path.join(dataDir, `config-codex-chat-pagination-${process.pid}-${Date.now()}.yaml`);
  const statePath = path.join(dataDir, `mcp-state-codex-chat-pagination-${process.pid}-${Date.now()}.json`).replaceAll("\\", "/");
  const runtimeStatePath = path.join(dataDir, `runtime-state-codex-chat-pagination-${process.pid}-${Date.now()}.json`).replaceAll("\\", "/");
  await fs.writeFile(configPath, `sessionId: codex-chat-pagination-e2e
displayName: Codex Chat Pagination E2E
storagePath: ${statePath}
runtimeStatePath: ${runtimeStatePath}
transports:
  - name: e2e-relay
    type: relay
    enabled: true
    baseUrl: ${relay.baseUrl}
    secret: ${relay.desktopSecret}
codex:
  cliBackend: app-server
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeCodex}
  cwd: .
  threadCwd: .
  pollIntervalMs: 100
  listThreadsOnStartup: false
  startThreadOnStartup: false
  resumeSelectedThreadOnStartup: false
`, "utf8");
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const link = spawn(process.execPath, ["scripts/codex-app-server-link.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret,
      LEGAX_FAKE_CODEX_MANY_CHAT_SESSIONS: "1"
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  link.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => link.kill());

  await postPhoneMessage(relay, {
    targetAgentId: "codex-cli",
    type: "control",
    action: "list_agent_sessions",
    selectedAgentId: "codex-cli",
    projectRef: "chats",
    text: "/sessions codex-cli chats"
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    const menu = events.events.find((event) => /Chat history 01/.test(event.text));
    assert.ok(menu, detail);
    assert.match(menu.text, /Page 1\/2/);
    assert.doesNotMatch(menu.text, /Chat history 12/);
    const buttons = menu.metadata.telegramReplyMarkup.inline_keyboard.flat();
    assert.ok(buttons.some((item) => item.callback_data === "legax:project:codex-cli:chats:2"), detail);
  }, { timeoutMs: 7000 });

  await postPhoneMessage(relay, {
    targetAgentId: "codex-cli",
    type: "control",
    action: "list_agent_sessions",
    selectedAgentId: "codex-cli",
    projectRef: "chats",
    page: 2,
    text: "/sessions codex-cli chats"
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    const menu = events.events.find((event) => /Chat history 10/.test(event.text) && /Page 2\/2/.test(event.text));
    assert.ok(menu, detail);
    assert.match(menu.text, /Chat history 11/);
    assert.doesNotMatch(menu.text, /Chat history 12/);
    const buttons = menu.metadata.telegramReplyMarkup.inline_keyboard.flat();
    assert.ok(buttons.some((item) => item.callback_data === "legax:project:codex-cli:chats:1"), detail);
  }, { timeoutMs: 7000 });
});

test("Codex App Server link can start when relay is down but another outbound transport works", async (t) => {
  await fs.mkdir(dataDir, { recursive: true });
  const webhook = await startWebhook(t);
  const missingRelayPort = await getFreePort();
  const fakeCodex = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-codex-app-server.mjs").replaceAll("\\", "/");
  const configPath = path.join(dataDir, `config-codex-relay-down-${process.pid}-${Date.now()}.yaml`);
  const statePath = path.join(dataDir, `mcp-state-codex-relay-down-${process.pid}-${Date.now()}.json`).replaceAll("\\", "/");
  const runtimeStatePath = path.join(dataDir, `runtime-state-codex-relay-down-${process.pid}-${Date.now()}.json`).replaceAll("\\", "/");
  await fs.writeFile(configPath, `sessionId: codex-relay-down-e2e
displayName: Codex Relay Down E2E
storagePath: ${statePath}
runtimeStatePath: ${runtimeStatePath}
transports:
  - name: missing-relay
    type: relay
    enabled: true
    baseUrl: http://127.0.0.1:${missingRelayPort}
    timeoutMs: 100
  - name: local-webhook
    type: webhook
    enabled: true
    url: ${webhook.url}
    timeoutMs: 1000
codex:
  cliBackend: app-server
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeCodex}
  cwd: .
  threadCwd: .
  pollIntervalMs: 200
  notifyOnConnection: true
`, "utf8");
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const link = spawn(process.execPath, ["scripts/codex-app-server-link.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  link.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => link.kill());

  await waitFor(async () => {
    assert.ok(webhook.events.some((event) => event.kind === "status" && /Codex App Server connected/.test(event.text)), stderr);
  }, { timeoutMs: 7000 });
});

async function startWebhook(t) {
  const events = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (body) events.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  const port = await getFreePort();
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  t.after(() => closeHttpServer(server));
  return {
    url: `http://127.0.0.1:${port}/agent-link`,
    events
  };
}

async function startFakeCodexWebSocketServer(t) {
  let nextTurn = 1;
  let nextRequest = 100;
  let activeThreadId = "thread-ws-e2e";
  const pending = new Map();
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    if (request.url === "/healthz" || request.url === "/readyz") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.on("upgrade", (request, socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const key = request.headers["sec-websocket-key"];
    const accept = cryptoAccept(String(key ?? ""));
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      ""
    ].join("\r\n"));
    let buffer = Buffer.alloc(0);
    const send = (message) => {
      socket.write(encodeServerWebSocketFrame(JSON.stringify(message)));
    };
    const finishTurn = (turnId, text, approved) => {
      send({
        method: "item/completed",
        params: {
          threadId: activeThreadId,
          turnId,
          item: {
            id: `agent-${turnId}`,
            type: "agentMessage",
            text: approved ? `codex websocket approved: ${text}` : `codex websocket denied: ${text}`
          }
        }
      });
      send({
        method: "turn/completed",
        params: {
          threadId: activeThreadId,
          turn: { id: turnId, status: "completed" }
        }
      });
    };
    const handle = (message) => {
      if (message.method === "initialize") {
        send({
          id: message.id,
          result: {
            userAgent: "fake-codex-websocket/0.0.0",
            codexHome: pluginRoot,
            platformFamily: "windows",
            platformOs: "windows"
          }
        });
        send({
          method: "remoteControl/status/changed",
          params: { status: "disabled", environmentId: null }
        });
        return;
      }
      if (message.method === "thread/start") {
        const thread = {
          id: activeThreadId,
          name: "Fake websocket session",
          preview: "",
          createdAt: 1700000500,
          updatedAt: 1700000500,
          cwd: process.cwd(),
          source: "appServer",
          turns: []
        };
        send({ id: message.id, result: { thread } });
        return;
      }
      if (message.method === "turn/start") {
        activeThreadId = message.params?.threadId ?? activeThreadId;
        const turnId = `turn-ws-${nextTurn++}`;
        const text = textFromCodexInput(message.params?.input);
        send({ id: message.id, result: { turn: { id: turnId } } });
        const requestId = nextRequest++;
        pending.set(requestId, { turnId, text });
        setTimeout(() => send({
          id: requestId,
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: activeThreadId,
            turnId,
            itemId: `cmd-${turnId}`,
            reason: "Fake websocket approval",
            cwd: process.cwd(),
            command: ["node", "--version"]
          }
        }), 20);
        return;
      }
      if (message.id !== undefined && !message.method && pending.has(message.id)) {
        const item = pending.get(message.id);
        pending.delete(message.id);
        finishTurn(item.turnId, item.text, message.result?.decision === "accept");
        return;
      }
      if (message.id !== undefined) send({ id: message.id, result: {} });
    };
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const decoded = decodeClientWebSocketFrames(buffer);
      buffer = decoded.rest;
      for (const frame of decoded.frames) {
        if (frame.opcode === 0x1) handle(JSON.parse(frame.text));
        if (frame.opcode === 0x8) socket.end();
        if (frame.opcode === 0x9) socket.write(encodeServerWebSocketFrame(frame.payload, 0xA));
      }
    });
  });
  const port = await getFreePort();
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return closeHttpServer(server);
  });
  return { url: `ws://127.0.0.1:${port}/rpc` };
}

function cryptoAccept(key) {
  return crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

function encodeServerWebSocketFrame(value, opcode = 0x1) {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]);
  const header = Buffer.alloc(4);
  header[0] = 0x80 | opcode;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function decodeClientWebSocketFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    let length = second & 0x7f;
    let position = offset + 2;
    if (length === 126) {
      if (buffer.length - position < 2) break;
      length = buffer.readUInt16BE(position);
      position += 2;
    } else if (length === 127) {
      if (buffer.length - position < 8) break;
      length = Number(buffer.readBigUInt64BE(position));
      position += 8;
    }
    if (buffer.length - position < 4) break;
    const mask = buffer.subarray(position, position + 4);
    position += 4;
    if (buffer.length - position < length) break;
    const payload = Buffer.alloc(length);
    for (let index = 0; index < length; index += 1) {
      payload[index] = buffer[position + index] ^ mask[index % 4];
    }
    frames.push({ opcode, payload, text: payload.toString("utf8") });
    offset = position + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

function textFromCodexInput(input = []) {
  return input
    .map((item) => item?.text ?? item?.content ?? "")
    .filter(Boolean)
    .join("\n");
}

function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: pluginRoot,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("exit", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function postPhoneMessage(relay, message) {
  return await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      ...message
    })
  });
}
