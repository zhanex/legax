import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
export const pluginRoot = path.resolve(path.dirname(__filename), "..", "..");
export const dataDir = path.join(pluginRoot, "data");
const relayCookies = new Map();

export async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

export async function waitFor(fn, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await sleep(intervalMs);
    }
  }
  throw lastError ?? new Error("waitFor timed out");
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function installedBin(prefix, name) {
  return process.platform === "win32"
    ? path.join(prefix, `${name}.cmd`)
    : path.join(prefix, "bin", name);
}

export function closeHttpServer(server) {
  return new Promise((resolve) => {
    server.close(resolve);
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

export function spawnNodeForTest(t, args, options = {}) {
  const child = spawnNodeProcess(args, options);
  t.after(() => stopProcessTree(child));
  return child;
}

function spawnNodeProcess(args, options = {}) {
  return spawn(process.execPath, args, {
    ...options,
    detached: process.platform !== "win32"
  });
}

export async function stopProcessTree(child, { timeoutMs = 3000 } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("close", resolve);
  });

  killProcessTree(child, "SIGTERM");
  const exited = await Promise.race([
    closed.then(() => true),
    sleep(timeoutMs).then(() => false)
  ]);
  if (exited) return;

  killProcessTree(child, "SIGKILL");
  await Promise.race([closed, sleep(1000)]);
}

function killProcessTree(child, signal) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    if (!result.error && result.status === 0) return;
  } else {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through to killing the direct child if it was not a process group.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Best-effort test cleanup.
  }
}

export async function fetchJson(url, options = {}) {
  const { skipRelayCookie = false, ...fetchOptions } = options;
  const headers = { ...(fetchOptions.headers ?? {}) };
  if (!skipRelayCookie && !hasHeader(headers, "cookie") && !hasHeader(headers, "x-legax-secret")) {
    const urlText = String(url);
    for (const [baseUrl, cookie] of relayCookies.entries()) {
      if (urlText.startsWith(baseUrl)) {
        headers.cookie = cookie;
        break;
      }
    }
  }
  const response = await fetch(url, { ...fetchOptions, headers });
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { text };
    }
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${text}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function hasHeader(headers, name) {
  const wanted = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === wanted);
}

export async function startRelay(t, {
  script = "self-hosted-relay/server.mjs",
  sessionId = "e2e",
  host = "127.0.0.1",
  desktopSecret = "desktop-secret",
  allowInsecureDev = false,
  configBom = false
} = {}) {
  await fs.mkdir(dataDir, { recursive: true });
  const port = await getFreePort();
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const storePath = path.join(dataDir, `relay-e2e-${stamp}.json`);
  const relayConfigPath = path.join(dataDir, `relay-cfg-e2e-${stamp}.yaml`);
  // Write a self-contained relay yaml — the relay reads only this file (no env).
  const yamlString = (value) => JSON.stringify(String(value));
  const yaml = `sessionId: ${yamlString(sessionId)}\n`
    + `relay:\n`
    + `  host: ${yamlString(host)}\n`
    + `  port: ${port}\n`
    + `  secret: ${yamlString(desktopSecret)}\n`
    + `  storePath: ${yamlString(storePath.replaceAll("\\", "/"))}\n`
    + `  allowInsecureDev: ${allowInsecureDev ? "true" : "false"}\n`
    + `  audit:\n`
    + `    enabled: false\n`;
  await fs.writeFile(relayConfigPath, configBom ? `\uFEFF${yaml}` : yaml, "utf8");
  const child = spawnNodeProcess([path.join(pluginRoot, script)], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      // Only the config-path pointer survives; everything else (secrets/host/port/store)
      // comes from the yaml above.
      LEGAX_CONFIG: relayConfigPath
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(async () => {
    await stopProcessTree(child);
    relayCookies.delete(`http://127.0.0.1:${port}`);
    await fs.rm(storePath, { force: true });
    await fs.rm(relayConfigPath, { force: true });
  });
  await waitFor(async () => {
    const health = await fetchJson(`http://127.0.0.1:${port}/health`);
    assert.equal(health.ok, true);
    return health;
  }, { timeoutMs: 7000 });
  const baseUrl = `http://127.0.0.1:${port}`;
  const phoneCookie = await pairRelayDevice({
    baseUrl,
    desktopSecret,
    sessionId,
    label: "e2e browser"
  });
  relayCookies.set(baseUrl, phoneCookie);
  return {
    baseUrl,
    port,
    storePath,
    configPath: relayConfigPath,
    desktopSecret,
    phoneCookie,
    sessionId,
    child,
    stderr: () => stderr
  };
}

export async function pairRelayDevice(relayOrOptions, {
  code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0"),
  sessionId = relayOrOptions.sessionId,
  label = "e2e browser",
  expiresInMs = 300000
} = {}) {
  const baseUrl = relayOrOptions.baseUrl;
  const desktopSecret = relayOrOptions.desktopSecret;
  const createResult = await fetchJson(`${baseUrl}/api/pairing-codes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": desktopSecret
    },
    body: JSON.stringify({ code, sessionId, label, expiresInMs })
  });
  assert.equal(createResult.ok, true);

  const response = await fetch(`${baseUrl}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, label })
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /legax_device=/);
  return cookie.split(";")[0];
}

export async function writeTempConfig(relay, extra = "") {
  await fs.mkdir(dataDir, { recursive: true });
  const configPath = path.join(dataDir, `config-e2e-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.yaml`);
  const statePath = path.join(dataDir, `mcp-state-e2e-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`).replaceAll("\\", "/");
  const runtimeStatePath = path.join(dataDir, `runtime-state-e2e-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`).replaceAll("\\", "/");
  const yaml = `sessionId: ${relay.sessionId}
displayName: E2E Agent
storagePath: ${statePath}
runtimeStatePath: ${runtimeStatePath}
transports:
  - name: e2e-relay
    type: relay
    enabled: true
    baseUrl: ${relay.baseUrl}
    secret: ${relay.desktopSecret}
    timeoutMs: 5000
${extra}`;
  await fs.writeFile(configPath, yaml, "utf8");
  return { configPath, statePath, runtimeStatePath };
}

export async function removeTempFiles(...files) {
  await Promise.all(files.filter(Boolean).map(async (file) => {
    await fs.rm(file, { force: true });
    const dir = path.dirname(file);
    const base = path.basename(file);
    let entries = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    await Promise.all(entries
      .filter((entry) => entry.startsWith(`${base}.`) && (entry.endsWith(".tmp") || entry.endsWith(".lock")))
      .map((entry) => fs.rm(path.join(dir, entry), { force: true })));
  }));
}

// One-shot orphan cleanup. Sweeps `data/` for E2E artifact files older than the
// stale window. This catches the residue from prior tests that were SIGKILLed or
// crashed before t.after() ran. We only match files whose names follow the
// e2e naming convention so production data is never touched.
const ORPHAN_PATTERN = /^(?:relay-e2e|config-e2e|mcp-state-e2e|runtime-state-e2e|claude-permission-mcp-e2e|gemini-mcp-e2e)-\d+-\d+/;
const ORPHAN_STALE_MS = 60_000;

async function reapDataOrphans() {
  let entries = [];
  try {
    entries = await fs.readdir(dataDir);
  } catch {
    return;
  }
  const now = Date.now();
  await Promise.all(entries
    .filter((entry) => ORPHAN_PATTERN.test(entry))
    .map(async (entry) => {
      const target = path.join(dataDir, entry);
      try {
        const stat = await fs.stat(target);
        if (now - stat.mtimeMs > ORPHAN_STALE_MS) {
          await fs.rm(target, { force: true });
        }
      } catch {
        // ignore — best-effort cleanup
      }
    }));
}

// Fire-and-forget at module import so any test file picks this up automatically.
void reapDataOrphans();
