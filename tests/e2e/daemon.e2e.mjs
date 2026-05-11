import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { dataDir, fetchJson, getFreePort, pluginRoot, removeTempFiles, startRelay, waitFor, writeTempConfig } from "./helpers.mjs";

test("daemon starts enabled Codex, Claude, and Gemini adapters from one YAML config", async (t) => {
  const relay = await startRelay(t, { sessionId: "daemon-e2e" });
  const fakeCodex = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-codex-app-server.mjs").replaceAll("\\", "/");
  const fakeClaude = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-claude-code.mjs").replaceAll("\\", "/");
  const fakeGemini = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-gemini-cli.mjs").replaceAll("\\", "/");
  const mcpConfigPath = path.join(dataDir, `daemon-claude-mcp-${process.pid}-${Date.now()}.json`).replaceAll("\\", "/");
  const geminiMcpConfigPath = path.join(dataDir, `daemon-gemini-mcp-${process.pid}-${Date.now()}.json`).replaceAll("\\", "/");
  const nodePath = process.execPath.replaceAll("\\", "/");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
daemon:
  restart: false
codex:
  command: ${nodePath}
  args:
    - ${fakeCodex}
  cwd: .
  threadCwd: .
  pollIntervalMs: 100
  approvalTimeoutMs: 5000
  notifyOnConnection: true
claude:
  command: ${nodePath}
  args:
    - ${fakeClaude}
  cwd: .
  pollIntervalMs: 100
  mcpConfigPath: ${mcpConfigPath}
gemini:
  command: ${nodePath}
  args:
    - ${fakeGemini}
    - --output-format
    - stream-json
  cwd: .
  promptFlag: --prompt
  approvalMode: default
  pollIntervalMs: 100
  mcpConfigPath: ${geminiMcpConfigPath}
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath, mcpConfigPath, geminiMcpConfigPath));

  const daemon = spawn(process.execPath, ["scripts/legax-daemon.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  daemon.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => daemon.kill());

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const texts = events.events.map((event) => event.text);
    assert.ok(texts.some((text) => /Codex App Server connected/.test(text)), `${stderr}\n${texts.join("\n")}`);
    assert.ok(texts.some((text) => /Claude Code link connected/.test(text)), `${stderr}\n${texts.join("\n")}`);
    assert.ok(texts.some((text) => /Gemini CLI link connected/.test(text)), `${stderr}\n${texts.join("\n")}`);
  }, { timeoutMs: 9000 });

  for (const [targetAgentId, text] of [["claude-code", "from daemon to claude"], ["gemini-cli", "from daemon to gemini"]]) {
    await fetchJson(`${relay.baseUrl}/api/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: relay.phoneCookie
      },
      body: JSON.stringify({
        sessionId: relay.sessionId,
        targetAgentId,
        type: "text",
        text
      })
    });
  }

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "echo: from daemon to claude"), detail);
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "gemini echo: from daemon to gemini"), detail);
  }, { timeoutMs: 9000 });
});

test("daemon dry-run reports enabled adapters without starting clients", async (t) => {
  const relay = await startRelay(t, { sessionId: "daemon-dry-run-e2e" });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const result = await runNode(["scripts/legax-daemon.mjs", "--dry-run"], {
    LEGAX_CONFIG: configPath,
    LEGAX_SECRET: relay.desktopSecret
  });
  assert.equal(result.code, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, true);
  assert.deepEqual(body.adapters.map((adapter) => adapter.name).sort(), ["claude", "codex", "gemini", "opencode"]);
  assert.deepEqual(body.adapters.map((adapter) => adapter.cliBackend).sort(), ["app-server", "server-http", "stream-json", "stream-json"]);
  assert.ok(body.adapters.filter((adapter) => adapter.name !== "opencode").every((adapter) => adapter.mcpEnabled === true));
  assert.equal(body.adapters.find((adapter) => adapter.name === "opencode").autoStart, false);
});

test("daemon launches Claude and Gemini on demand and writes MCP configs", async (t) => {
  const relay = await startRelay(t, { sessionId: "daemon-on-demand-e2e" });
  const fakeClaude = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-claude-code.mjs").replaceAll("\\", "/");
  const fakeGemini = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-gemini-cli.mjs").replaceAll("\\", "/");
  const nodePath = process.execPath.replaceAll("\\", "/");
  const stamp = `${process.pid}-${Date.now()}`;
  const claudeMcpConfigPath = path.join(dataDir, `daemon-on-demand-claude-mcp-${stamp}.json`).replaceAll("\\", "/");
  const geminiCwd = path.join(dataDir, `daemon-on-demand-gemini-${stamp}`).replaceAll("\\", "/");
  const geminiMcpConfigPath = path.join(geminiCwd, ".gemini", "settings.json");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
daemon:
  restart: false
  launchPollIntervalMs: 100
codex:
  enabled: false
claude:
  autoStart: false
  command: ${nodePath}
  args:
    - ${fakeClaude}
  cwd: .
  pollIntervalMs: 100
  mcpConfigPath: ${claudeMcpConfigPath}
gemini:
  autoStart: false
  command: ${nodePath}
  args:
    - ${fakeGemini}
    - --output-format
    - stream-json
  cwd: ${geminiCwd}
  promptFlag: --prompt
  pollIntervalMs: 100
`);
  await fs.mkdir(path.dirname(runtimeStatePath), { recursive: true });
  await fs.mkdir(geminiCwd, { recursive: true });
  await fs.writeFile(runtimeStatePath, `${JSON.stringify({
    version: 1,
    sessions: {
      [relay.sessionId]: {
        agents: {},
        launchRequests: {
          "claude-code": {
            agentId: "claude-code",
            reason: "list_agent_sessions",
            requestedAt: new Date().toISOString()
          },
          "gemini-cli": {
            agentId: "gemini-cli",
            reason: "list_agent_sessions",
            requestedAt: new Date().toISOString()
          }
        }
      }
    }
  }, null, 2)}\n`, "utf8");
  t.after(async () => {
    await removeTempFiles(configPath, statePath, runtimeStatePath, claudeMcpConfigPath, geminiMcpConfigPath);
    await fs.rm(geminiCwd, { recursive: true, force: true });
  });

  const daemon = spawn(process.execPath, ["scripts/legax-daemon.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  daemon.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => daemon.kill());

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const texts = events.events.map((event) => event.text);
    assert.ok(texts.some((text) => /Starting Claude Code/.test(text)), `${stderr}\n${texts.join("\n")}`);
    assert.ok(texts.some((text) => /Claude Code link connected/.test(text)), `${stderr}\n${texts.join("\n")}`);
    assert.ok(texts.some((text) => /Starting Gemini CLI/.test(text)), `${stderr}\n${texts.join("\n")}`);
    assert.ok(texts.some((text) => /Gemini CLI link connected/.test(text)), `${stderr}\n${texts.join("\n")}`);
  }, { timeoutMs: 9000 });

  const claudeMcp = JSON.parse(await fs.readFile(claudeMcpConfigPath, "utf8"));
  assert.ok(claudeMcp.mcpServers.legax_permissions);
  const geminiMcp = JSON.parse(await fs.readFile(geminiMcpConfigPath, "utf8"));
  assert.ok(geminiMcp.mcpServers["legax"]);
});

test("daemon remote router handles relay menu and on-demand text without Codex", async (t) => {
  const relay = await startRelay(t, { sessionId: "daemon-router-no-codex-e2e" });
  const fakeClaude = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-claude-code.mjs").replaceAll("\\", "/");
  const nodePath = process.execPath.replaceAll("\\", "/");
  const claudeMcpConfigPath = path.join(
    dataDir,
    `daemon-router-no-codex-claude-mcp-${process.pid}-${Date.now()}.json`
  ).replaceAll("\\", "/");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
daemon:
  restart: false
  launchPollIntervalMs: 100
  remotePollIntervalMs: 100
codex:
  enabled: false
claude:
  autoStart: false
  command: ${nodePath}
  args:
    - ${fakeClaude}
  cwd: .
  pollIntervalMs: 100
  mcpConfigPath: ${claudeMcpConfigPath}
gemini:
  enabled: false
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath, claudeMcpConfigPath));

  const daemon = spawn(process.execPath, ["scripts/legax-daemon.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  daemon.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => daemon.kill());

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "codex-cli",
      type: "control",
      action: "list_agents",
      text: "/start"
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const texts = events.events.map((event) => event.text);
    assert.ok(texts.some((text) => /Choose a CLI adapter/.test(text) && /Claude Code/.test(text)), `${stderr}\n${texts.join("\n")}`);
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
      text: "router to claude"
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => /Starting Claude Code/.test(event.text ?? "")), detail);
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "echo: router to claude"), detail);
  }, { timeoutMs: 9000 });
});

test("daemon preflights relay TWA project picker and brokers local project directories", async (t) => {
  const relay = await startRelay(t, { sessionId: "daemon-twa-project-e2e" });
  const stamp = `${process.pid}-${Date.now()}`;
  const projectRoot = path.join(dataDir, `daemon-twa-root-${stamp}`);
  const childProject = path.join(projectRoot, "sample-app");
  await fs.mkdir(childProject, { recursive: true });
  await fs.writeFile(path.join(projectRoot, "README.txt"), "not a directory", "utf8");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
relay:
  publicBaseUrl: https://relay.example.test
  telegramWebAppLaunchTokenTtlMs: 300000
daemon:
  restart: false
  launchOnDemand: false
  remotePollIntervalMs: 100
  projectRoots:
    - ${projectRoot.replaceAll("\\", "/")}
codex:
  enabled: true
  autoStart: false
claude:
  enabled: false
gemini:
  enabled: false
opencode:
  enabled: false
`);
  t.after(async () => {
    await removeTempFiles(configPath, statePath, runtimeStatePath);
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const daemon = spawn(process.execPath, ["scripts/legax-daemon.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  daemon.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => daemon.kill());

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "legax-daemon",
      type: "control",
      action: "new_project_preflight",
      selectedAgentId: "codex-cli",
      text: "/new-project codex-cli"
    })
  });

  const preflight = await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const found = events.events.find((event) => /Open project picker/i.test(event.text ?? ""));
    assert.ok(found, `${stderr}\n${JSON.stringify(events.events, null, 2)}`);
    return found;
  }, { timeoutMs: 7000 });
  const openButton = preflight.metadata.replyMarkup.inline_keyboard[0][0];
  assert.equal(openButton.text, "Open project picker");
  assert.match(openButton.web_app.url, /^https:\/\/relay\.example\.test\/twa\/new-project\?token=/);

  const listRequestId = "twa-list-e2e";
  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "legax-daemon",
      type: "control",
      action: "list_project_children",
      selectedAgentId: "codex-cli",
      requestId: listRequestId,
      rootId: "root-1",
      relativePath: ""
    })
  });

  const children = await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const found = events.events.find((event) => event.metadata?.twaRequestId === listRequestId);
    assert.ok(found, `${stderr}\n${JSON.stringify(events.events, null, 2)}`);
    return found.metadata;
  }, { timeoutMs: 7000 });
  assert.equal(children.ok, true);
  assert.equal(children.twaResponseType, "project_children");
  assert.deepEqual(children.entries.map((entry) => entry.name), ["sample-app"]);

  const escapeRequestId = "twa-escape-e2e";
  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "legax-daemon",
      type: "control",
      action: "list_project_children",
      selectedAgentId: "codex-cli",
      requestId: escapeRequestId,
      rootId: "root-1",
      relativePath: "../"
    })
  });

  const escaped = await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const found = events.events.find((event) => event.metadata?.twaRequestId === escapeRequestId);
    assert.ok(found, `${stderr}\n${JSON.stringify(events.events, null, 2)}`);
    return found.metadata;
  }, { timeoutMs: 7000 });
  assert.equal(escaped.ok, false);
  assert.match(escaped.error, /outside the configured project root/);

  const openRequestId = "twa-open-e2e";
  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "legax-daemon",
      type: "control",
      action: "open_project",
      selectedAgentId: "codex-cli",
      requestId: openRequestId,
      rootId: "root-1",
      relativePath: "sample-app"
    })
  });

  const opened = await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const found = events.events.find((event) => event.metadata?.twaRequestId === openRequestId);
    assert.ok(found, `${stderr}\n${JSON.stringify(events.events, null, 2)}`);
    return found.metadata;
  }, { timeoutMs: 7000 });
  assert.equal(opened.ok, true);
  assert.equal(opened.twaResponseType, "open_project");
  assert.equal(path.normalize(opened.projectPath), path.normalize(childProject));

  await waitFor(async () => {
    const state = JSON.parse(await fs.readFile(runtimeStatePath, "utf8"));
    const request = state.sessions[relay.sessionId].launchRequests["codex-cli"];
    assert.equal(request.reason, "new_session");
    assert.equal(path.normalize(request.projectPath), path.normalize(childProject));
  }, { timeoutMs: 3000 });
});

test("daemon returns actionable TWA preflight errors", async (t) => {
  const relay = await startRelay(t, { sessionId: "daemon-twa-preflight-error-e2e" });
  const projectRoot = path.join(dataDir, `daemon-twa-error-root-${process.pid}-${Date.now()}`);
  await fs.mkdir(projectRoot, { recursive: true });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
daemon:
  restart: false
  launchOnDemand: false
  remotePollIntervalMs: 100
  projectRoots:
    - ${projectRoot.replaceAll("\\", "/")}
codex:
  enabled: true
  autoStart: false
claude:
  enabled: false
gemini:
  enabled: false
opencode:
  enabled: false
`);
  t.after(async () => {
    await removeTempFiles(configPath, statePath, runtimeStatePath);
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const daemon = spawn(process.execPath, ["scripts/legax-daemon.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  daemon.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => daemon.kill());

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "legax-daemon",
      type: "control",
      action: "new_project_preflight",
      selectedAgentId: "codex-cli"
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const found = events.events.find((event) => /relay\.publicBaseUrl is not configured/.test(event.text ?? ""));
    assert.ok(found, `${stderr}\n${JSON.stringify(events.events, null, 2)}`);
    assert.equal(found.metadata.severity, "error");
  }, { timeoutMs: 7000 });
});

test("daemon launches OpenCode on demand and routes text through the server API", async (t) => {
  const relay = await startRelay(t, { sessionId: "daemon-opencode-on-demand-e2e" });
  const openCode = await startFakeOpenCodeServer(t, (text) => `opencode daemon echo: ${text}`);
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
daemon:
  restart: false
  launchPollIntervalMs: 100
  remotePollIntervalMs: 100
codex:
  enabled: false
claude:
  enabled: false
gemini:
  enabled: false
opencode:
  autoStart: false
  serverUrl: ${openCode.baseUrl}
  serverMode: connect
  pollIntervalMs: 100
  sessionHistoryOnSelectLimit: 0
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const daemon = spawn(process.execPath, ["scripts/legax-daemon.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  daemon.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => daemon.kill());

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "opencode",
      type: "text",
      text: "router to opencode"
    })
  });

  await waitFor(async () => {
    const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => /Starting OpenCode/.test(event.text ?? "")), detail);
    assert.equal(openCode.requests.createdSessions.length, 1, detail);
    assert.deepEqual(openCode.requests.messages.at(-1), {
      sessionId: "oc-daemon-created-1",
      text: "router to opencode"
    });
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "opencode daemon echo: router to opencode"), detail);
  }, { timeoutMs: 9000 });
});

test("daemon routes the full Telegram CLI/project/session/text flow", async (t) => {
  const telegram = await startFakeTelegram(t);
  const fakeGemini = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-gemini-cli.mjs").replaceAll("\\", "/");
  const nodePath = process.execPath.replaceAll("\\", "/");
  const stamp = `${process.pid}-${Date.now()}`;
  const runtimeStatePath = path.join(dataDir, `daemon-telegram-flow-runtime-${stamp}.json`).replaceAll("\\", "/");
  const configPath = path.join(dataDir, `daemon-telegram-flow-config-${stamp}.yaml`).replaceAll("\\", "/");
  const geminiCwd = path.join(dataDir, `daemon-telegram-flow-gemini-${stamp}`).replaceAll("\\", "/");
  await fs.mkdir(geminiCwd, { recursive: true });
  await fs.writeFile(configPath, `
sessionId: telegram-flow-e2e
runtimeStatePath: ${runtimeStatePath}
daemon:
  restart: false
  remotePollIntervalMs: 100
  launchPollIntervalMs: 100
codex:
  enabled: false
claude:
  enabled: false
gemini:
  autoStart: false
  command: ${nodePath}
  args:
    - ${fakeGemini}
    - --output-format
    - stream-json
  cwd: ${geminiCwd}
  promptFlag: --prompt
  pollIntervalMs: 100
transports:
  - name: telegram
    type: telegram
    enabled: true
    botToken: test-token
    chatId: 42
    apiBaseUrl: ${telegram.apiBaseUrl}
    timeoutMs: 1000
`, "utf8");
  t.after(async () => {
    await removeTempFiles(configPath, runtimeStatePath);
    await fs.rm(geminiCwd, { recursive: true, force: true });
  });

  const daemon = spawn(process.execPath, ["scripts/legax-daemon.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_FAKE_GEMINI_PROJECT_SESSIONS: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  daemon.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => daemon.kill());

  telegram.pushMessage("/start");
  const menu = await telegram.waitForSend((body) => /Choose a CLI adapter/.test(body.text ?? ""), { detail: () => stderr });
  assert.match(menu.text, /Gemini CLI/);
  assert.equal(menu.reply_markup.inline_keyboard[0][0].callback_data, "legax:agent:gemini-cli");
  assert.deepEqual(lastRow(menu).map((item) => item.text), ["CLI"]);

  telegram.pushCallback("legax:agent:gemini-cli");
  const projectMenu = await telegram.waitForSend((body) => /project\/chat/i.test(body.text ?? "") && /Gemini CLI/i.test(body.text ?? ""), { detail: () => stderr });
  assert.deepEqual(lastRow(projectMenu).map((item) => item.text), ["CLI", "Prj"]);
  const projectCallbacks = (projectMenu.reply_markup?.inline_keyboard ?? []).flat().map((item) => item.callback_data);
  assert.ok(projectCallbacks.some((callback) => /^legax:project:gemini-cli:/.test(callback)), JSON.stringify(projectMenu.reply_markup));
  assert.ok(!projectCallbacks.some((callback) => /^legax:(?:session|sessions|new):/.test(callback ?? "")), JSON.stringify(projectMenu.reply_markup));
  assert.match(projectMenu.text, /alpha/);
  assert.match(projectMenu.text, /beta/);
  assert.match(projectMenu.text, /Chats/);
  const chatButton = firstButton(projectMenu, (item) => /\bChats \(1\)$/.test(item.text ?? ""));
  assert.ok(chatButton, JSON.stringify(projectMenu.reply_markup));

  telegram.pushCallback(chatButton.callback_data);
  const chatSessionMenu = await telegram.waitForSend((body) => /General chat session/.test(body.text ?? ""), { detail: () => stderr });
  assert.doesNotMatch(chatSessionMenu.text, /Alpha build session/);
  assert.doesNotMatch(chatSessionMenu.text, /Beta release session/);

  telegram.pushCallback("legax:projects:gemini-cli");
  const projectMenuAgain = await telegram.waitForSend((body) => /project\/chat/i.test(body.text ?? "") && /Gemini CLI/i.test(body.text ?? ""), { detail: () => stderr });
  const projectButton = firstButton(projectMenuAgain, (item) => /^\d+\. alpha /.test(item.text ?? ""));
  assert.ok(projectButton, JSON.stringify(projectMenuAgain.reply_markup));

  telegram.pushCallback(projectButton.callback_data);
  const sessionMenu = await telegram.waitForSend((body) => /Alpha build session/.test(body.text ?? ""), { detail: () => stderr });
  assert.deepEqual(lastRow(sessionMenu).map((item) => item.text), ["CLI", "Prj", "Session"]);
  assert.doesNotMatch(sessionMenu.text, /Beta release session/);
  const sessionCallbacks = (sessionMenu.reply_markup?.inline_keyboard ?? []).flat().map((item) => item.callback_data);
  assert.ok(sessionCallbacks.some((callback) => /^legax:session:gemini-cli:/.test(callback ?? "")), JSON.stringify(sessionMenu.reply_markup));
  const sessionButton = firstCallback(sessionMenu, /^legax:session:gemini-cli:/);
  assert.ok(sessionButton, JSON.stringify(sessionMenu.reply_markup));

  telegram.pushCallback(sessionButton.callback_data);
  await telegram.waitForSend((body) => /Gemini CLI session selected/.test(body.text ?? ""), { detail: () => stderr });

  telegram.pushMessage("hello from tg");
  await telegram.waitForSend((body) => /gemini echo: hello from tg/.test(body.text ?? ""), { detail: () => stderr, timeoutMs: 9000 });

  assert.ok(
    !telegram.sendMessages.some((body) => /Gemini CLI link connected/.test(body.text ?? "")),
    telegram.sendMessages.map((body) => body.text).join("\n---\n")
  );
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

async function startFakeTelegram(t) {
  const port = await getFreePort();
  const pendingUpdates = [];
  const sendMessages = [];
  const waiters = [];
  let nextUpdateId = 1000;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? JSON.parse(raw) : {};
    const method = String(req.url || "").split("/").pop();
    if (method === "getUpdates") {
      const result = pendingUpdates.splice(0, pendingUpdates.length);
      sendJsonResponse(res, { ok: true, result });
      return;
    }
    if (method === "sendMessage") {
      sendMessages.push(body);
      for (const waiter of [...waiters]) waiter();
      sendJsonResponse(res, { ok: true, result: { message_id: sendMessages.length } });
      return;
    }
    if (method === "answerCallbackQuery") {
      sendJsonResponse(res, { ok: true, result: true });
      return;
    }
    sendJsonResponse(res, { ok: false, description: `unexpected method ${method}` }, 404);
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  function pushMessage(text) {
    pendingUpdates.push({
      update_id: nextUpdateId++,
      message: {
        date: Math.floor(Date.now() / 1000),
        chat: { id: 42 },
        text
      }
    });
  }

  function pushCallback(data) {
    pendingUpdates.push({
      update_id: nextUpdateId++,
      callback_query: {
        id: `cb-${nextUpdateId}`,
        data,
        from: { id: 42 },
        message: { chat: { id: 42 } }
      }
    });
  }

  async function waitForSend(predicate, { timeoutMs = 7000, detail = () => "" } = {}) {
    return await waitFor(async () => {
      const found = sendMessages.find(predicate);
      assert.ok(found, `${detail()}\n${sendMessages.map((body) => body.text).join("\n---\n")}`);
      return found;
    }, { timeoutMs, intervalMs: 100 });
  }

  return {
    apiBaseUrl: `http://127.0.0.1:${port}/bot`,
    pushMessage,
    pushCallback,
    waitForSend,
    sendMessages
  };
}

function sendJsonResponse(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function firstCallback(payload, pattern) {
  return firstButton(payload, (button) => pattern.test(button.callback_data ?? ""));
}

function firstButton(payload, predicate) {
  for (const row of payload.reply_markup?.inline_keyboard ?? []) {
    for (const button of row ?? []) {
      if (predicate(button)) return button;
    }
  }
  return null;
}

function lastRow(payload) {
  const rows = payload.reply_markup?.inline_keyboard ?? [];
  return rows[rows.length - 1] ?? [];
}

async function startFakeOpenCodeServer(t, replyText) {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const state = {
    messages: {},
    requests: {
      createdSessions: [],
      messages: []
    }
  };
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, baseUrl);
      if (request.method === "GET" && url.pathname === "/global/health") {
        sendJsonResponse(response, { healthy: true, version: "fake-opencode" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/session") {
        sendJsonResponse(response, []);
        return;
      }
      if (request.method === "POST" && url.pathname === "/session") {
        const body = await readJson(request);
        const id = `oc-daemon-created-${state.requests.createdSessions.length + 1}`;
        const session = { id, title: body.title ?? "New OpenCode session" };
        state.messages[id] = [];
        state.requests.createdSessions.push({ body, session });
        sendJsonResponse(response, session);
        return;
      }
      const messageMatch = url.pathname.match(/^\/session\/([^/]+)\/message$/);
      if (messageMatch && request.method === "POST") {
        const sessionId = decodeURIComponent(messageMatch[1]);
        const body = await readJson(request);
        const text = body.parts?.find((part) => part.type === "text")?.text ?? body.text ?? "";
        state.requests.messages.push({ sessionId, text });
        const assistant = openCodeMessage("assistant", replyText(text));
        state.messages[sessionId] ??= [];
        state.messages[sessionId].push(openCodeMessage("user", text), assistant);
        sendJsonResponse(response, assistant);
        return;
      }
      sendJsonResponse(response, { error: "not found" }, 404);
    } catch (error) {
      response.statusCode = 500;
      response.end(error.stack);
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    baseUrl,
    requests: state.requests
  };
}

function openCodeMessage(role, text) {
  return {
    info: { role },
    parts: [{ type: "text", text }]
  };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}
