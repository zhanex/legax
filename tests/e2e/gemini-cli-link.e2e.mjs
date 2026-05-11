import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { dataDir, fetchJson, pluginRoot, removeTempFiles, startRelay, waitFor, writeTempConfig } from "./helpers.mjs";

test("Gemini CLI link dry-run adds resume latest for existing session mode", async (t) => {
  const relay = await startRelay(t, { sessionId: "gemini-existing-dry-run-e2e" });
  const fakeGemini = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-gemini-cli.mjs").replaceAll("\\", "/");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
gemini:
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeGemini}
    - --output-format
    - stream-json
  useExisting: true
  resumeExisting: latest
  promptFlag: --prompt
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const result = await runNode(["scripts/gemini-cli-link.mjs", "--dry-run"], {
    LEGAX_CONFIG: configPath,
    LEGAX_SECRET: relay.desktopSecret
  });
  assert.equal(result.code, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.gemini.useExisting, true);
  assert.ok(body.gemini.effectiveArgsForPrompt.includes("--resume"));
  assert.ok(body.gemini.effectiveArgsForPrompt.includes("latest"));
});

test("Gemini CLI link forwards phone text to stream-json CLI and relays output", async (t) => {
  const relay = await startRelay(t, { sessionId: "gemini-link-e2e" });
  const fakeGemini = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-gemini-cli.mjs").replaceAll("\\", "/");
  const mcpConfigPath = tempGeminiMcpConfigPath("gemini-link-e2e");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
gemini:
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeGemini}
    - --output-format
    - stream-json
  cwd: .
  promptFlag: --prompt
  approvalMode: default
  pollIntervalMs: 100
  forwardToolEvents: true
  mcpConfigPath: ${mcpConfigPath}
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath, mcpConfigPath));

  const link = spawn(process.execPath, ["scripts/gemini-cli-link.mjs"], {
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
    assert.ok(events.events.some((event) => event.kind === "status" && /Gemini CLI link connected/.test(event.text)));
  }, { timeoutMs: 7000 });

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "gemini-cli",
      type: "text",
      text: "hello gemini"
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "gemini echo: hello gemini"), detail);
    assert.ok(events.events.some((event) => event.kind === "status" && /Gemini CLI tool use/.test(event.text)), detail);
  }, { timeoutMs: 7000 });
});

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

function tempGeminiMcpConfigPath(label) {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return path.join(dataDir, `${label}-mcp-${stamp}.json`).replaceAll("\\", "/");
}

test("Gemini CLI link supports positional prompts and explicit approval modes", async (t) => {
  const relay = await startRelay(t, { sessionId: "gemini-link-positional-e2e" });
  const fakeGemini = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-gemini-cli.mjs").replaceAll("\\", "/");
  const mcpConfigPath = tempGeminiMcpConfigPath("gemini-link-positional-e2e");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
gemini:
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeGemini}
    - --output-format
    - stream-json
  cwd: .
  promptFlag: ""
  approvalMode: plan
  pollIntervalMs: 100
  forwardToolEvents: true
  mcpConfigPath: ${mcpConfigPath}
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath, mcpConfigPath));

  const link = spawn(process.execPath, ["scripts/gemini-cli-link.mjs"], {
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
    assert.ok(events.events.some((event) => event.kind === "status" && /Gemini CLI link connected/.test(event.text)));
  }, { timeoutMs: 7000 });

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "gemini-cli",
      type: "text",
      text: "positional gemini"
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "gemini echo: positional gemini"), detail);
    assert.ok(events.events.some((event) => event.kind === "status" && event.text.includes('"approvalMode": "plan"')), detail);
    assert.ok(events.events.some((event) => event.kind === "status" && event.text.includes('"promptMode": "positional"')), detail);
  }, { timeoutMs: 7000 });
});

test("Gemini CLI link switches remote mode from phone control messages", async (t) => {
  const relay = await startRelay(t, { sessionId: "gemini-link-switch-e2e" });
  const fakeGemini = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-gemini-cli.mjs").replaceAll("\\", "/");
  const mcpConfigPath = tempGeminiMcpConfigPath("gemini-link-switch-e2e");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
gemini:
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeGemini}
    - --output-format
    - stream-json
  cwd: .
  mode: monitor
  pollIntervalMs: 100
  mcpConfigPath: ${mcpConfigPath}
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath, mcpConfigPath));

  const link = spawn(process.execPath, ["scripts/gemini-cli-link.mjs"], {
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
    assert.ok(events.events.some((event) => event.kind === "status" && /Gemini CLI link connected/.test(event.text)));
  }, { timeoutMs: 7000 });

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "gemini-cli",
      type: "control",
      action: "set_mode",
      mode: "interactive"
    })
  });

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "gemini-cli",
      type: "text",
      text: "after switch"
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => event.kind === "status" && /remote mode switched to interactive/.test(event.text)), detail);
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "gemini echo: after switch"), detail);
  }, { timeoutMs: 7000 });
});

test("Gemini CLI selection activates interactive mode before phone text", async (t) => {
  const relay = await startRelay(t, { sessionId: "gemini-selection-mode-e2e" });
  const fakeGemini = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-gemini-cli.mjs").replaceAll("\\", "/");
  const mcpConfigPath = tempGeminiMcpConfigPath("gemini-selection-mode-e2e");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
gemini:
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeGemini}
    - --output-format
    - stream-json
  cwd: .
  mode: monitor
  pollIntervalMs: 100
  mcpConfigPath: ${mcpConfigPath}
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath, mcpConfigPath));

  const link = spawn(process.execPath, ["scripts/gemini-cli-link.mjs"], {
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
    assert.ok(events.events.some((event) => event.kind === "status" && /Gemini CLI link connected/.test(event.text)));
  }, { timeoutMs: 7000 });

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "gemini-cli",
      type: "control",
      action: "list_agent_sessions"
    })
  });

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "gemini-cli",
      type: "text",
      text: "after gemini selection"
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => /Remote mode is interactive/.test(event.text)), detail);
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "gemini echo: after gemini selection"), detail);
    assert.ok(!events.events.some((event) => /Phone text ignored/.test(event.text)), detail);
  }, { timeoutMs: 7000 });
});

test("Gemini CLI link lists sessions, selects one, and resumes it on the next turn", async (t) => {
  const relay = await startRelay(t, { sessionId: "gemini-session-list-e2e" });
  const fakeGemini = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-gemini-cli.mjs").replaceAll("\\", "/");
  const mcpConfigPath = tempGeminiMcpConfigPath("gemini-session-list-e2e");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
gemini:
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeGemini}
    - --output-format
    - stream-json
  cwd: .
  promptFlag: --prompt
  approvalMode: default
  pollIntervalMs: 100
  mcpConfigPath: ${mcpConfigPath}
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath, mcpConfigPath));

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "gemini-cli",
      type: "control",
      action: "list_agent_sessions",
      createdAt: "2020-01-01T00:00:00.000Z"
    })
  });

  const link = spawn(process.execPath, ["scripts/gemini-cli-link.mjs"], {
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

  const sessionId = "11111111-1111-4111-8111-111111111111";
  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    const menu = events.events.find((event) => /Choose a Gemini CLI session/.test(event.text));
    assert.ok(menu, detail);
    assert.ok(menu.metadata.telegramReplyMarkup.inline_keyboard.flat().some((item) => item.callback_data === `legax:session:gemini-cli:${sessionId}`), detail);
  }, { timeoutMs: 7000 });

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "gemini-cli",
      type: "control",
      action: "select_session",
      threadRef: sessionId
    })
  });

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "gemini-cli",
      type: "text",
      text: "after gemini session select"
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => /Gemini CLI session selected/.test(event.text)), detail);
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "gemini echo: after gemini session select"), detail);
    assert.ok(events.events.some((event) => event.kind === "status" && event.text.includes('"resumeTarget": "1"')), detail);
  }, { timeoutMs: 7000 });
});
