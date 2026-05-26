import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import test from "node:test";
import { closeHttpServer, fetchJson, getFreePort, pluginRoot, removeTempFiles, startRelay, waitFor, writeTempConfig } from "./helpers.mjs";

test("OpenCode link dry-run reports server-http configuration", async (t) => {
  const relay = await startRelay(t, { sessionId: "opencode-dry-run-e2e" });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
opencode:
  serverUrl: http://127.0.0.1:4096
  serverMode: connect
  sessionHistoryOnSelectLimit: 2
  pollIntervalMs: 100
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const result = await runNode(["scripts/opencode-link.mjs", "--dry-run"], {
    LEGAX_CONFIG: configPath,
    LEGAX_SECRET: relay.desktopSecret
  });
  assert.equal(result.code, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.opencode.agentId, "opencode");
  assert.equal(body.opencode.cliBackend, "server-http");
  assert.equal(body.opencode.serverUrl, "http://127.0.0.1:4096");
  assert.equal(body.opencode.serverMode, "connect");
  assert.equal(body.opencode.sessionHistoryOnSelectLimit, 2);
});

test("OpenCode link lists projects, selects a session, replays history, and sends phone text", async (t) => {
  const relay = await startRelay(t, { sessionId: "opencode-session-e2e" });
  const openCode = await startFakeOpenCodeServer(t, {
    sessions: [
      {
        id: "oc-project-1",
        title: "Project Alpha thread",
        cwd: "F:/work/project-alpha",
        updatedAt: "2026-05-01T11:00:00.000Z"
      },
      {
        id: "oc-chat-1",
        title: "Loose chat",
        updatedAt: "2026-05-01T10:00:00.000Z"
      },
      {
        id: "oc-archived",
        title: "Archived thread",
        cwd: "F:/work/project-alpha",
        archived: true,
        updatedAt: "2026-05-01T12:00:00.000Z"
      }
    ],
    messages: {
      "oc-project-1": [
        openCodeMessage("user", "Show me the current status."),
        openCodeMessage("assistant", "Project Alpha is healthy.\nNo deployment blockers.")
      ]
    },
    replyText: (text) => `opencode echo: ${text}`
  });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
opencode:
  serverUrl: ${openCode.baseUrl}
  serverMode: connect
  pollIntervalMs: 100
  sessionHistoryOnSelectLimit: 2
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const link = spawn(process.execPath, ["scripts/opencode-link.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret,
      LEGAX_DAEMON_ROUTER: ""
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  link.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => link.kill());

  await waitFor(async () => {
    const events = await relayEvents(relay);
    assert.ok(events.events.some((event) => event.kind === "status" && /OpenCode link connected/.test(event.text)), stderr);
  }, { timeoutMs: 7000 });

  await postRelayMessage(relay, {
    targetAgentId: "opencode",
    type: "control",
    action: "list_agent_projects"
  });

  await waitFor(async () => {
    const events = await relayEvents(relay);
    const menu = events.events.find((event) => event.kind === "status" && /Choose a OpenCode project\/chat/.test(event.text));
    assert.ok(menu, `${stderr}\n${JSON.stringify(events.events, null, 2)}`);
    const buttons = menu.metadata.telegramReplyMarkup.inline_keyboard.flat().map((button) => button.callback_data);
    assert.ok(buttons.includes("legax:project:opencode:chats"), JSON.stringify(buttons));
    assert.ok(buttons.includes("legax:project:opencode:1"), JSON.stringify(buttons));
  }, { timeoutMs: 7000 });

  await postRelayMessage(relay, {
    targetAgentId: "opencode",
    type: "control",
    action: "list_agent_sessions",
    projectRef: "1"
  });

  await waitFor(async () => {
    const events = await relayEvents(relay);
    const menu = events.events.find((event) => event.kind === "status" && /Project Alpha thread/.test(event.text));
    assert.ok(menu, `${stderr}\n${JSON.stringify(events.events, null, 2)}`);
    assert.ok(!menu.text.includes("Archived thread"));
    const callbacks = menu.metadata.telegramReplyMarkup.inline_keyboard.flat().map((button) => button.callback_data);
    assert.ok(callbacks.includes("legax:session:opencode:oc-project-1"), JSON.stringify(callbacks));
  }, { timeoutMs: 7000 });

  await postRelayMessage(relay, {
    targetAgentId: "opencode",
    type: "control",
    action: "select_session",
    threadRef: "oc-project-1"
  });

  await waitFor(async () => {
    const events = await relayEvents(relay);
    const history = events.events.filter((event) => event.kind === "agent_text" && event.metadata?.sessionHistory === true);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.equal(history.length, 2, detail);
    assert.equal(history[0].metadata.author, "user");
    assert.equal(history[0].text, "Show me the current status.");
    assert.equal(history[1].metadata.author, "agent");
    assert.equal(history[1].text, "Project Alpha is healthy.\nNo deployment blockers.");
    assert.equal(history[1].metadata.cwd, "F:/work/project-alpha");
  }, { timeoutMs: 7000 });

  await postRelayMessage(relay, {
    targetAgentId: "opencode",
    type: "text",
    text: "please update"
  });

  await waitFor(async () => {
    const events = await relayEvents(relay);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "opencode echo: please update"), detail);
    assert.deepEqual(openCode.requests.messages.at(-1), {
      sessionId: "oc-project-1",
      text: "please update"
    });
  }, { timeoutMs: 7000 });
});

test("OpenCode link creates a new server session before the first phone text", async (t) => {
  const relay = await startRelay(t, { sessionId: "opencode-new-session-e2e" });
  const openCode = await startFakeOpenCodeServer(t, {
    sessions: [],
    messages: {},
    replyText: (text) => `new opencode echo: ${text}`
  });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
opencode:
  serverUrl: ${openCode.baseUrl}
  serverMode: connect
  pollIntervalMs: 100
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  const link = spawn(process.execPath, ["scripts/opencode-link.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret,
      LEGAX_DAEMON_ROUTER: ""
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  link.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => link.kill());

  await waitFor(async () => {
    const events = await relayEvents(relay);
    assert.ok(events.events.some((event) => event.kind === "status" && /OpenCode link connected/.test(event.text)), stderr);
  }, { timeoutMs: 7000 });

  await postRelayMessage(relay, {
    targetAgentId: "opencode",
    type: "control",
    action: "new_session"
  });
  await postRelayMessage(relay, {
    targetAgentId: "opencode",
    type: "text",
    text: "start fresh"
  });

  await waitFor(async () => {
    const events = await relayEvents(relay);
    const detail = `${stderr}\n${JSON.stringify(events.events, null, 2)}`;
    assert.equal(openCode.requests.createdSessions.length, 1, detail);
    assert.deepEqual(openCode.requests.messages.at(-1), {
      sessionId: "oc-created-1",
      text: "start fresh"
    });
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "new opencode echo: start fresh"), detail);
  }, { timeoutMs: 7000 });
});

function openCodeMessage(role, text) {
  return {
    info: {
      id: `${role}-${Math.random().toString(16).slice(2)}`,
      role
    },
    parts: [
      {
        id: `${role}-part`,
        type: "text",
        text
      }
    ]
  };
}

async function startFakeOpenCodeServer(t, { sessions, messages, replyText }) {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const state = {
    sessions: sessions.map((session) => ({ ...session })),
    messages: Object.fromEntries(Object.entries(messages).map(([key, value]) => [key, [...value]])),
    requests: {
      createdSessions: [],
      messages: []
    }
  };

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, baseUrl);
      if (request.method === "GET" && url.pathname === "/global/health") {
        return json(response, { healthy: true, version: "fake-opencode" });
      }
      if (request.method === "GET" && url.pathname === "/session") {
        return json(response, state.sessions);
      }
      if (request.method === "POST" && url.pathname === "/session") {
        const body = await readJson(request);
        const id = `oc-created-${state.requests.createdSessions.length + 1}`;
        const session = {
          id,
          title: body.title ?? "New OpenCode session",
          createdAt: "2026-05-02T10:00:00.000Z"
        };
        state.sessions.push(session);
        state.messages[id] = [];
        state.requests.createdSessions.push({ body, session });
        return json(response, session);
      }
      const messageMatch = url.pathname.match(/^\/session\/([^/]+)\/message$/);
      if (messageMatch && request.method === "GET") {
        const rows = state.messages[decodeURIComponent(messageMatch[1])] ?? [];
        const limit = Number(url.searchParams.get("limit"));
        return json(response, Number.isFinite(limit) && limit >= 0 ? rows.slice(-limit) : rows);
      }
      if (messageMatch && request.method === "POST") {
        const sessionId = decodeURIComponent(messageMatch[1]);
        const body = await readJson(request);
        const text = body.parts?.find((part) => part.type === "text")?.text ?? body.text ?? "";
        state.requests.messages.push({ sessionId, text });
        const user = openCodeMessage("user", text);
        const assistant = openCodeMessage("assistant", replyText(text));
        state.messages[sessionId] ??= [];
        state.messages[sessionId].push(user, assistant);
        return json(response, assistant);
      }
      response.statusCode = 404;
      response.end("not found");
    } catch (error) {
      response.statusCode = 500;
      response.end("internal server error");
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  t.after(() => closeHttpServer(server));
  return {
    baseUrl,
    requests: state.requests
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

function json(response, body) {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function relayEvents(relay) {
  return fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
}

function postRelayMessage(relay, body) {
  return fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      ...body
    })
  });
}

function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: pluginRoot,
      env: { ...process.env, LEGAX_DAEMON_ROUTER: "", ...env },
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
