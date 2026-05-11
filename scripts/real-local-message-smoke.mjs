#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, "..");
const dataDir = path.resolve(pluginRoot, "data");
const sessionId = `real-local-${Date.now()}`;
const desktopSecret = `desktop-${Math.random().toString(16).slice(2)}`;
const timeoutMs = Number(process.env.LEGAX_REAL_MESSAGE_TIMEOUT_MS ?? 120000);
const pollIntervalMs = 500;
let phoneCookie = "";

const commandNames = process.platform === "win32"
  ? { codex: "codex.cmd", claude: "claude.cmd", gemini: "gemini.cmd" }
  : { codex: "codex", claude: "claude", gemini: "gemini" };

const allClients = [
  {
    name: "codex",
    targetAgentId: "codex-cli",
    script: "scripts/codex-app-server-link.mjs",
    marker: "LEGAX-CODEX-PONG",
    prompt: "Reply exactly with LEGAX-CODEX-PONG and no other words."
  },
  {
    name: "claude",
    targetAgentId: "claude-code",
    script: "scripts/claude-code-link.mjs",
    marker: "LEGAX-CLAUDE-PONG",
    prompt: "Reply exactly with LEGAX-CLAUDE-PONG and no other words."
  },
  {
    name: "gemini",
    targetAgentId: "gemini-cli",
    script: "scripts/gemini-cli-link.mjs",
    marker: "LEGAX-GEMINI-PONG",
    prompt: "Reply exactly with LEGAX-GEMINI-PONG and no other words."
  }
];
const requestedClients = new Set(String(process.env.LEGAX_REAL_MESSAGE_CLIENTS ?? "codex,claude,gemini")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean));
const clients = allClients.filter((client) => requestedClients.has(client.name));

function log(message) {
  process.stderr.write(`[real-local-smoke] ${message}\n`);
}

function tail(text, max = 2500) {
  if (!text) return "";
  return text.length > max ? text.slice(-max) : text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(fn, label, timeout = timeoutMs) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await sleep(pollIntervalMs);
    }
  }
  throw lastError ?? new Error(`Timed out waiting for ${label}`);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { text };
    }
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
  return body;
}

async function pairBrowser(relayBaseUrl) {
  const code = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
  await fetchJson(`${relayBaseUrl}/api/pairing-codes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": desktopSecret
    },
    body: JSON.stringify({ code, sessionId, label: "real local smoke" })
  });
  const response = await fetch(`${relayBaseUrl}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, label: "real local smoke" })
  });
  const cookie = response.headers.get("set-cookie");
  if (!response.ok || !cookie) throw new Error(`Relay pairing failed: HTTP ${response.status}`);
  return cookie.split(";")[0];
}

function startProcess(command, args, { env = {}, stdio = ["ignore", "pipe", "pipe"] } = {}) {
  const child = spawn(command, args, {
    cwd: pluginRoot,
    env: { ...process.env, ...env },
    stdio,
    shell: false
  });
  const output = { stdout: "", stderr: "" };
  child.stdout?.on("data", (chunk) => {
    output.stdout += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    output.stderr += chunk;
  });
  return { child, output };
}

function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  child.kill();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function writeConfig(configPath, relayBaseUrl) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `sessionId: ${sessionId}
displayName: Real Local Smoke
storagePath: ./data/real-local-smoke-mcp-state.json
runtimeStatePath: ./data/real-local-smoke-runtime-state.json

remote:
  enabled: true
  defaultMode: interactive
  pauseAll: false

approvals:
  enabled: true
  allowFromPhone: true
  timeoutMs: 30000
  defaultOnTimeout: deny

relay:
  host: 127.0.0.1
  port: ${new URL(relayBaseUrl).port}
  secret: ${desktopSecret}
  storePath: ./data/real-local-smoke-relay-store.json
  audit:
    enabled: false

transports:
  - name: real-local-relay
    type: relay
    enabled: true
    baseUrl: ${relayBaseUrl}
    secretEnv: LEGAX_SECRET
    timeoutMs: 15000

codex:
  enabled: true
  agentId: codex-cli
  agentLabel: Codex CLI
  command: ${commandNames.codex}
  args:
    - app-server
    - --listen
    - stdio://
  cwd: .
  threadCwd: .
  pollIntervalMs: 500
  approvalTimeoutMs: 30000

claude:
  enabled: true
  agentId: claude-code
  agentLabel: Claude Code
  command: ${commandNames.claude}
  args:
    - -p
    - --input-format
    - stream-json
    - --output-format
    - stream-json
    - --verbose
  cwd: .
  pollIntervalMs: 500
  approvalTimeoutMs: 30000
  mcpConfigPath: ./data/real-local-smoke-claude-mcp.json

gemini:
  enabled: true
  agentId: gemini-cli
  agentLabel: Gemini CLI
  command: ${commandNames.gemini}
  args:
    - --output-format
    - stream-json
  cwd: .
  promptFlag: --prompt
  approvalMode: default
  trustWorkspace: true
  pollIntervalMs: 500
`, "utf8");
}

function phoneHeaders(extra = {}) {
  return { ...extra, cookie: phoneCookie };
}

async function phoneEvents(relayBaseUrl) {
  return await fetchJson(`${relayBaseUrl}/api/events?sessionId=${encodeURIComponent(sessionId)}&after=0`, {
    headers: phoneHeaders()
  });
}

async function postPhoneMessage(relayBaseUrl, targetAgentId, text) {
  return await fetchJson(`${relayBaseUrl}/api/messages`, {
    method: "POST",
    headers: phoneHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      sessionId,
      targetAgentId,
      type: "text",
      text
    })
  });
}

async function testClient(client, relayBaseUrl, configPath) {
  log(`starting ${client.name} adapter`);
  const { child, output } = startProcess(process.execPath, [client.script], {
    env: {
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: desktopSecret
    }
  });
  const startedAt = new Date().toISOString();
  try {
    log(`waiting for ${client.name} connected status`);
    await waitFor(async () => {
      const events = await phoneEvents(relayBaseUrl);
      const connected = events.events?.some((event) => event.agentId === client.targetAgentId
        && event.kind === "status"
        && /connected/i.test(event.text ?? ""));
      if (!connected) throw new Error(`No connected status yet for ${client.name}`);
      return true;
    }, `${client.name} connected`, 45000);

    log(`sending phone message to ${client.name}`);
    await postPhoneMessage(relayBaseUrl, client.targetAgentId, client.prompt);

    log(`waiting for ${client.name} marker ${client.marker}`);
    const event = await waitFor(async () => {
      const events = await phoneEvents(relayBaseUrl);
      const found = events.events?.find((candidate) => candidate.agentId === client.targetAgentId
        && candidate.kind === "agent_text"
        && String(candidate.text ?? "").includes(client.marker));
      if (!found) throw new Error(`No ${client.marker} response yet for ${client.name}`);
      return found;
    }, `${client.name} response`);

    log(`${client.name} received marker`);
    return {
      name: client.name,
      ok: true,
      targetAgentId: client.targetAgentId,
      marker: client.marker,
      responseText: event.text,
      startedAt,
      stderrTail: tail(output.stderr)
    };
  } catch (error) {
    log(`${client.name} failed: ${error.message}`);
    let events = [];
    try {
      events = (await phoneEvents(relayBaseUrl)).events ?? [];
    } catch {
      events = [];
    }
    return {
      name: client.name,
      ok: false,
      targetAgentId: client.targetAgentId,
      marker: client.marker,
      error: error.message,
      startedAt,
      recentEvents: events
        .filter((event) => event.agentId === client.targetAgentId)
        .slice(-8)
        .map((event) => ({
          kind: event.kind,
          text: event.text,
          metadata: event.metadata
        })),
      stdoutTail: tail(output.stdout),
      stderrTail: tail(output.stderr)
    };
  } finally {
    log(`stopping ${client.name} adapter`);
    await stopProcess(child);
  }
}

async function main() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (clients.length === 0) throw new Error("No clients selected. Set LEGAX_REAL_MESSAGE_CLIENTS=codex,claude,gemini.");
  const port = await getFreePort();
  const relayBaseUrl = `http://127.0.0.1:${port}`;
  const storePath = path.resolve(dataDir, "real-local-smoke-relay-store.json");
  const configPath = path.resolve(dataDir, "real-local-smoke-config.yaml");
  const cleanupFiles = [
    storePath,
    configPath,
    path.resolve(dataDir, "real-local-smoke-mcp-state.json"),
    path.resolve(dataDir, "real-local-smoke-runtime-state.json"),
    path.resolve(dataDir, "real-local-smoke-claude-mcp.json")
  ];

  for (const file of cleanupFiles) fs.rmSync(file, { force: true });
  writeConfig(configPath, relayBaseUrl);

  log(`starting relay on ${relayBaseUrl}`);
  const relay = startProcess(process.execPath, ["scripts/simple-relay-server.mjs"], {
    env: {
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: desktopSecret,
      LEGAX_STORE: storePath
    }
  });

  try {
    log("waiting for relay health");
    await waitFor(async () => {
      const health = await fetchJson(`${relayBaseUrl}/health`);
      if (!health.ok) throw new Error("Relay health returned not ok");
      return health;
    }, "relay health", 10000);
    phoneCookie = await pairBrowser(relayBaseUrl);

    const results = [];
    for (const client of clients) {
      const result = await testClient(client, relayBaseUrl, configPath);
      results.push(result);
      log(`${client.name} result: ${result.ok ? "ok" : "failed"}`);
    }

    const ok = results.every((result) => result.ok);
    const summary = {
      ok,
      relayBaseUrl,
      sessionId,
      timeoutMs,
      results
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.stderr.write(`[real-local-smoke-summary] ${JSON.stringify(summary)}\n`);
    process.exitCode = ok ? 0 : 1;
  } catch (error) {
    const summary = {
      ok: false,
      relayBaseUrl,
      sessionId,
      error: error.message,
      relayStderrTail: tail(relay.output.stderr)
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.stderr.write(`[real-local-smoke-summary] ${JSON.stringify(summary)}\n`);
    process.exitCode = 1;
  } finally {
    log("stopping relay and cleaning temp files");
    await stopProcess(relay.child);
    for (const file of cleanupFiles) fs.rmSync(file, { force: true });
    for (const entry of fs.readdirSync(dataDir)) {
      if (entry.startsWith("real-local-smoke-") && entry.endsWith(".tmp")) {
        fs.rmSync(path.join(dataDir, entry), { force: true });
      }
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
