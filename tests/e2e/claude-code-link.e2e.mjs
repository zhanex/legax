import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { dataDir, fetchJson, pluginRoot, removeTempFiles, startRelay, waitFor, writeTempConfig } from "./helpers.mjs";

test("Claude Code link dry-run adds continue for existing session mode", async (t) => {
  const relay = await startRelay(t, { sessionId: "claude-existing-dry-run-e2e" });
  const fakeClaude = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-claude-code.mjs").replaceAll("\\", "/");
  const mcpConfigPath = path.join(dataDir, "claude-existing-dry-run-e2e-mcp.json").replaceAll("\\", "/");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
claude:
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeClaude}
    - -p
    - --input-format
    - stream-json
    - --output-format
    - stream-json
  useExisting: true
  continueLatest: true
  mcpConfigPath: ${mcpConfigPath}
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath, mcpConfigPath));

  const result = await runNode(["scripts/claude-code-link.mjs", "--dry-run"], {
    LEGAX_CONFIG: configPath,
    LEGAX_SECRET: relay.desktopSecret
  });
  assert.equal(result.code, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.claude.useExisting, true);
  assert.ok(body.claude.effectiveArgs.includes("--continue"));
  assert.ok(body.claude.effectiveArgs.includes("--mcp-config"));
});

test("Claude Code link forwards phone text to stream-json CLI and relays assistant output", async (t) => {
  const relay = await startRelay(t, { sessionId: "claude-link-e2e" });
  const fakeClaude = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-claude-code.mjs").replaceAll("\\", "/");
  const mcpConfigPath = path.join(dataDir, "claude-link-e2e-mcp.json").replaceAll("\\", "/");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
claude:
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeClaude}
  cwd: .
  pollIntervalMs: 100
  mcpConfigPath: ${mcpConfigPath}
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath, mcpConfigPath));

  const link = spawn(process.execPath, ["scripts/claude-code-link.mjs"], {
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
    assert.ok(events.events.some((event) => event.kind === "status" && /Claude Code link connected/.test(event.text)));
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
      type: "text",
      text: "hello claude"
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "echo: hello claude"), stderr);
  }, { timeoutMs: 7000 });
});

test("Claude Code link keeps polling when the CLI process exits between messages", async (t) => {
  const relay = await startRelay(t, { sessionId: "claude-exit-between-messages-e2e" });
  const fakeClaude = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-claude-code.mjs").replaceAll("\\", "/");
  const mcpConfigPath = path.join(dataDir, "claude-exit-between-messages-e2e-mcp.json").replaceAll("\\", "/");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
claude:
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeClaude}
  cwd: .
  pollIntervalMs: 100
  mcpConfigPath: ${mcpConfigPath}
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath, mcpConfigPath));

  const link = spawn(process.execPath, ["scripts/claude-code-link.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret,
      LEGAX_FAKE_CLAUDE_EXIT_AFTER_MESSAGE: "1"
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
    assert.ok(events.events.some((event) => event.kind === "status" && /Claude Code link connected/.test(event.text)));
  }, { timeoutMs: 7000 });

  await postClaudeText(relay, "first claude turn");
  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "echo: first claude turn"), detail);
  }, { timeoutMs: 7000 });

  await postClaudeText(relay, "second claude turn");
  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "echo: second claude turn"), detail);
  }, { timeoutMs: 7000 });
});

async function postClaudeText(relay, text) {
  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "claude-code",
      type: "text",
      text
    })
  });
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

test("Claude Code selection activates interactive mode before phone text", async (t) => {
  const relay = await startRelay(t, { sessionId: "claude-selection-mode-e2e" });
  const fakeClaude = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-claude-code.mjs").replaceAll("\\", "/");
  const mcpConfigPath = path.join(dataDir, "claude-selection-mode-e2e-mcp.json").replaceAll("\\", "/");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
claude:
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeClaude}
  cwd: .
  mode: approval-only
  pollIntervalMs: 100
  mcpConfigPath: ${mcpConfigPath}
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath, mcpConfigPath));

  const link = spawn(process.execPath, ["scripts/claude-code-link.mjs"], {
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
    assert.ok(events.events.some((event) => event.kind === "status" && /Claude Code link connected/.test(event.text)));
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
      targetAgentId: "claude-code",
      type: "text",
      text: "after claude selection"
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => /Remote mode is interactive/.test(event.text)), detail);
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "echo: after claude selection"), detail);
    assert.ok(!events.events.some((event) => /Phone text ignored/.test(event.text)), detail);
  }, { timeoutMs: 7000 });
});

test("Claude Code link lists and selects persisted project sessions", async (t) => {
  const relay = await startRelay(t, { sessionId: "claude-session-list-e2e" });
  const fakeClaude = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-claude-code.mjs").replaceAll("\\", "/");
  const historyRoot = path.join(dataDir, `claude-history-${process.pid}-${Date.now()}`);
  const mcpConfigPath = path.join(dataDir, "claude-session-list-e2e-mcp.json").replaceAll("\\", "/");
  const sessionId = "11111111-1111-4111-8111-111111111111";
  await writeClaudeSession(historyRoot, sessionId, "Persisted Claude session from fixture");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
claude:
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeClaude}
  cwd: .
  pollIntervalMs: 100
  mcpConfigPath: ${mcpConfigPath}
  sessionHistoryRoot: ${historyRoot.replaceAll("\\", "/")}
  sessionListCwd: all
`);
  t.after(async () => {
    await removeTempFiles(configPath, statePath, runtimeStatePath, mcpConfigPath);
    await fs.rm(historyRoot, { recursive: true, force: true });
  });

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "claude-code",
      type: "control",
      action: "list_agent_sessions",
      createdAt: "2020-01-01T00:00:00.000Z"
    })
  });

  const link = spawn(process.execPath, ["scripts/claude-code-link.mjs"], {
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
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    const menu = events.events.find((event) => /Choose a Claude Code session/.test(event.text));
    assert.ok(menu, detail);
    assert.ok(menu.metadata.telegramReplyMarkup.inline_keyboard.flat().some((item) => item.callback_data === `legax:session:claude-code:${sessionId}`), detail);
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
      targetAgentId: "claude-code",
      type: "text",
      text: "after claude session select"
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => /Claude Code session selected/.test(event.text)), detail);
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "echo: after claude session select"), detail);
  }, { timeoutMs: 7000 });
});

test("Claude Code link lists standalone and cwd-only history in Chats", async (t) => {
  const relay = await startRelay(t, { sessionId: "claude-chat-sessions-e2e" });
  const fakeClaude = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-claude-code.mjs").replaceAll("\\", "/");
  const historyRoot = path.join(dataDir, `claude-chat-history-${process.pid}-${Date.now()}`);
  const mcpConfigPath = path.join(dataDir, "claude-chat-sessions-e2e-mcp.json").replaceAll("\\", "/");
  const chatSessionId = "chat-session-1";
  await writeClaudeSession(historyRoot, "project-session-1", "Project Claude session from fixture");
  await writeClaudeSession(historyRoot, chatSessionId, "Standalone Claude chat from fixture", {
    includeCwd: false,
    projectDirName: "chats"
  });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
claude:
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeClaude}
  cwd: .
  pollIntervalMs: 100
  mcpConfigPath: ${mcpConfigPath}
  sessionHistoryRoot: ${historyRoot.replaceAll("\\", "/")}
  sessionListCwd: all
`);
  t.after(async () => {
    await removeTempFiles(configPath, statePath, runtimeStatePath, mcpConfigPath);
    await fs.rm(historyRoot, { recursive: true, force: true });
  });

  const link = spawn(process.execPath, ["scripts/claude-code-link.mjs"], {
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

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "claude-code",
      type: "control",
      action: "list_agent_projects",
      selectedAgentId: "claude-code"
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    const menu = events.events.find((event) => /Choose a Claude Code project\/chat/.test(event.text));
    assert.ok(menu, detail);
    assert.match(menu.text, /Chats \(2\)/);
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
      type: "control",
      action: "list_agent_sessions",
      selectedAgentId: "claude-code",
      projectRef: "chats"
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    const menu = events.events.find((event) => /Standalone Claude chat from fixture/.test(event.text));
    assert.ok(menu, detail);
    assert.match(menu.text, /Project Claude session from fixture/);
    const callbacks = menu.metadata.telegramReplyMarkup.inline_keyboard.flat().map((item) => item.callback_data);
    assert.ok(callbacks.includes(`legax:session:claude-code:${chatSessionId}`), detail);
    assert.ok(callbacks.includes("legax:new:claude-code"), detail);
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
      type: "control",
      action: "new_session",
      selectedAgentId: "claude-code"
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => /New Claude Code session selected/.test(event.text)), detail);
  }, { timeoutMs: 7000 });
});

test("Claude Code link shows cwd-only sessions in Chats, filters archived sessions, and paginates", async (t) => {
  const relay = await startRelay(t, { sessionId: "claude-chat-pagination-e2e" });
  const fakeClaude = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-claude-code.mjs").replaceAll("\\", "/");
  const historyRoot = path.join(dataDir, `claude-chat-pagination-history-${process.pid}-${Date.now()}`);
  const mcpConfigPath = path.join(dataDir, "claude-chat-pagination-e2e-mcp.json").replaceAll("\\", "/");
  for (let index = 1; index <= 12; index += 1) {
    await writeClaudeSession(historyRoot, `chat-page-${index}`, `Claude cwd chat ${String(index).padStart(2, "0")}`, {
      archived: index === 12
    });
  }
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
claude:
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeClaude}
  cwd: .
  pollIntervalMs: 100
  mcpConfigPath: ${mcpConfigPath}
  sessionHistoryRoot: ${historyRoot.replaceAll("\\", "/")}
  sessionListCwd: all
  sessionListLimit: 20
`);
  t.after(async () => {
    await removeTempFiles(configPath, statePath, runtimeStatePath, mcpConfigPath);
    await fs.rm(historyRoot, { recursive: true, force: true });
  });

  const link = spawn(process.execPath, ["scripts/claude-code-link.mjs"], {
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

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "claude-code",
      type: "control",
      action: "list_agent_sessions",
      selectedAgentId: "claude-code",
      projectRef: "chats"
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    const menu = events.events.find((event) => /Claude cwd chat 11/.test(event.text));
    assert.ok(menu, detail);
    assert.match(menu.text, /Page 1\/2/);
    assert.doesNotMatch(menu.text, /Claude cwd chat 12/);
    const buttons = menu.metadata.telegramReplyMarkup.inline_keyboard.flat();
    assert.ok(buttons.some((item) => item.callback_data === "legax:project:claude-code:chats:2"), detail);
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
      type: "control",
      action: "list_agent_sessions",
      selectedAgentId: "claude-code",
      projectRef: "chats",
      page: 2
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    const menu = events.events.find((event) => /Claude cwd chat 01/.test(event.text) && /Page 2\/2/.test(event.text));
    assert.ok(menu, detail);
    assert.doesNotMatch(menu.text, /Claude cwd chat 11/);
    assert.doesNotMatch(menu.text, /Claude cwd chat 12/);
  }, { timeoutMs: 7000 });
});

async function writeClaudeSession(root, sessionId, prompt, {
  cwd = pluginRoot,
  includeCwd = true,
  projectDirName = "project",
  archived = false
} = {}) {
  const projectDir = path.join(root, projectDirName);
  await fs.mkdir(projectDir, { recursive: true });
  const filePath = path.join(projectDir, `${sessionId}.jsonl`);
  const timestamp = "2026-05-07T12:00:00.000Z";
  const userEvent = {
    type: "user",
    timestamp,
    sessionId,
    message: {
      role: "user",
      content: [{ type: "text", text: prompt }]
    }
  };
  if (includeCwd) userEvent.cwd = cwd;
  await fs.writeFile(filePath, [
    JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp, sessionId }),
    JSON.stringify(userEvent),
    JSON.stringify({ type: "last-prompt", lastPrompt: prompt, sessionId }),
    ...(archived ? [JSON.stringify({ type: "session", sessionId, archived: true })] : [])
  ].join("\n"), "utf8");
}
