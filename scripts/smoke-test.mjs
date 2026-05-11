#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, "..");
const port = Number(process.env.LEGAX_SMOKE_PORT ?? 18878);
const desktopSecret = "dev-secret";
const relayUrl = `http://127.0.0.1:${port}`;
const dataDir = path.resolve(pluginRoot, "data");
const smokeConfigPath = path.resolve(dataDir, "smoke-config.yaml");

fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(smokeConfigPath, `sessionId: smoke
displayName: Agent Smoke Test
storagePath: ./data/smoke-mcp-state.json
runtimeStatePath: ./data/smoke-runtime-state.json
relay:
  host: 127.0.0.1
  port: ${port}
  secret: ${desktopSecret}
  storePath: ./data/smoke-relay-store.json
  audit:
    enabled: false
transports:
  - name: smoke-relay
    type: relay
    enabled: true
    baseUrl: ${relayUrl}
    secretEnv: LEGAX_SECRET
    timeoutMs: 5000
`, "utf8");

function runNode(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: pluginRoot,
      env: {
        ...process.env,
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`node ${args.join(" ")} exited ${code}\n${stderr}`));
    });
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${relayUrl}/health`);
      if (response.ok) return await response.json();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error("relay did not become healthy");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
  return body;
}

const relay = spawn(process.execPath, ["./scripts/simple-relay-server.mjs"], {
  cwd: pluginRoot,
  env: {
    ...process.env,
    LEGAX_CONFIG: smokeConfigPath,
    LEGAX_SECRET: desktopSecret
  },
  stdio: ["ignore", "ignore", "pipe"]
});

let relayStderr = "";
relay.stderr.on("data", (chunk) => { relayStderr += chunk; });

try {
  const health = await waitForHealth();
  const send = await runNode(["./scripts/mcp-server.mjs", "--send-test", "hello from smoke test"], {
    LEGAX_CONFIG: smokeConfigPath,
    LEGAX_SECRET: desktopSecret
  });
  const sendBody = JSON.parse(send.stdout);
  const phoneHeaders = { cookie: await pairBrowser() };
  const events = await fetchJson(`${relayUrl}/api/events?sessionId=smoke&after=0`, {
    headers: phoneHeaders
  });
  await fetchJson(`${relayUrl}/api/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", ...phoneHeaders },
    body: JSON.stringify({
      sessionId: "smoke",
      type: "text",
      text: "reply from phone smoke test"
    })
  });
  const messages = await fetchJson(`${relayUrl}/api/messages?sessionId=smoke&after=0`, {
    headers: { "x-legax-secret": desktopSecret }
  });
  const ok = Boolean(health.ok)
    && Boolean(sendBody.ok)
    && events.events?.length === 1
    && messages.messages?.[0]?.text === "reply from phone smoke test";
  const result = {
    ok,
    healthOk: Boolean(health.ok),
    sendOk: Boolean(sendBody.ok),
    eventCount: events.events?.length ?? 0,
    messageCount: messages.messages?.length ?? 0
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  if (relayStderr) process.stderr.write(`relay stderr:\n${relayStderr}\n`);
  process.exitCode = 1;
} finally {
  relay.kill();
}

async function pairBrowser() {
  const code = "314159";
  await fetchJson(`${relayUrl}/api/pairing-codes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": desktopSecret
    },
    body: JSON.stringify({ code, sessionId: "smoke", label: "smoke browser" })
  });
  const response = await fetch(`${relayUrl}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, label: "smoke browser" })
  });
  const cookie = response.headers.get("set-cookie");
  if (!response.ok || !cookie) throw new Error(`pairing failed: HTTP ${response.status}`);
  return cookie.split(";")[0];
}
