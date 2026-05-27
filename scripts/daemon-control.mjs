#!/usr/bin/env node
// Lightweight start/stop/status helper for the Legax daemon. Backs the
// `npm run daemon[:bg|:status|:stop]` scripts. Cross-platform and zero-dep.
//
// Conventions:
//   data/daemon.pid       - PID of the running daemon (or stale entry awaiting cleanup)
//   data/daemon.err.log   - stderr of background daemon (foreground inherits the terminal)
//
// Foreground vs background:
//   start      - inherits stdio; ctrl-C terminates the daemon and clears the pid file
//   start:bg   - detaches and writes pid; logs to data/daemon.err.log
//
// On Windows, stopping uses taskkill /T so daemon-owned adapter and CLI child
// processes do not survive a hard TerminateProcess of the parent daemon.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  defaultDataDir,
  packageAssetPath,
  packageRoot,
  resolveConfigPath as resolveInstalledConfigPath
} from "./lib/paths.mjs";
import { readYaml } from "./lib/yaml.mjs";


const DAEMON_SCRIPT = packageAssetPath("scripts", "legax-daemon.mjs");
const PAIRING_CODE_PATTERN = /^\d{6,8}$/;
const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000;

function resolveConfigPath() {
  return resolveInstalledConfigPath(optionValue("--config"));
}

function dataDir() {
  return defaultDataDir();
}

function pidFile() {
  return path.join(dataDir(), "daemon.pid");
}

function logFile() {
  return path.join(dataDir(), "daemon.err.log");
}

function optionValue(name) {
  const prefix = `${name}=`;
  for (let index = 3; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === name) return process.argv[index + 1] || "";
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return "";
}

function firstRelayTransport(config) {
  const transports = Array.isArray(config.transports) ? config.transports : [];
  return transports.find((transport) => transport && transport.type === "relay" && transport.enabled !== false && transport.baseUrl) || null;
}

function relayBaseUrl(config) {
  const transport = firstRelayTransport(config);
  if (transport?.baseUrl) return String(transport.baseUrl).replace(/\/+$/, "");
  const relay = config.relay || {};
  const port = Number(relay.port ?? 8787);
  const host = String(relay.host ?? "127.0.0.1");
  const shownHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  return `http://${shownHost}:${port}`;
}

function isLoopbackHostname(hostname) {
  const value = String(hostname ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost"
    || value === "::1"
    || value === "0:0:0:0:0:0:0:1"
    || /^127(?:\.\d{1,3}){3}$/.test(value);
}

function assertSafeRelayBaseUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("relay baseUrl must use HTTPS or loopback HTTP.");
  }
  if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
    throw new Error("relay baseUrl must use HTTPS or loopback HTTP.");
  }
}

function relaySecret(config) {
  const transport = firstRelayTransport(config);
  return String(config.relay?.secret ?? transport?.secret ?? "");
}

function randomPairingCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function formatDuration(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

async function pairBrowser() {
  const configPath = resolveConfigPath();
  const config = readYaml(configPath) ?? {};
  const baseUrl = relayBaseUrl(config);
  try {
    assertSafeRelayBaseUrl(baseUrl);
  } catch (error) {
    process.stderr.write(`[daemon-control] ${error.message}\n`);
    process.exit(2);
  }
  const secret = relaySecret(config);
  if (!secret) {
    process.stderr.write(`[daemon-control] relay.secret is empty in ${configPath}; cannot create a pairing code.\n`);
    process.exit(1);
  }

  const code = optionValue("--code") || randomPairingCode();
  if (!PAIRING_CODE_PATTERN.test(code)) {
    process.stderr.write("[daemon-control] --code must be 6 to 8 digits.\n");
    process.exit(2);
  }

  const ttlOption = optionValue("--ttl-ms") || optionValue("--expires-in-ms");
  const expiresInMs = ttlOption ? Number(ttlOption) : DEFAULT_PAIRING_TTL_MS;
  if (!Number.isFinite(expiresInMs) || expiresInMs <= 0) {
    process.stderr.write("[daemon-control] --ttl-ms must be a positive number.\n");
    process.exit(2);
  }

  const sessionId = optionValue("--session") || String(config.sessionId ?? "default");
  const label = optionValue("--label") || "Browser";
  // codeql[js/file-access-to-http] Pairing requests intentionally use the operator-configured relay URL and secret.
  const response = await fetch(`${baseUrl}/api/pairing-codes`, {
    method: "POST",
    // codeql[js/file-access-to-http] The relay secret is read from operator-owned local config.
    headers: {
      "content-type": "application/json",
      "x-legax-secret": secret
    },
    // codeql[js/file-access-to-http] Pairing metadata is explicit local CLI input sent to the validated relay URL.
    body: JSON.stringify({ code, expiresInMs, label, sessionId })
  });
  let responseBody = {};
  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      detail = response.statusText;
    }
    process.stderr.write(`[daemon-control] relay rejected pairing code registration (${response.status}): ${detail}\n`);
    process.exit(1);
  }
  try {
    responseBody = await response.json();
  } catch {
    responseBody = {};
  }

  const pairUrl = responseBody.pairUrl || `${baseUrl}/#pair=${encodeURIComponent(code)}`;
  process.stdout.write(`Pairing code: ${code}\n`);
  process.stdout.write(`Open: ${baseUrl}/\n`);
  process.stdout.write(`Pair URL: ${pairUrl}\n`);
  if (Array.isArray(responseBody.qrTerminal) && responseBody.qrTerminal.length) {
    process.stdout.write("Scan QR from the phone:\n");
    process.stdout.write(`${responseBody.qrTerminal.join("\n")}\n`);
  }
  process.stdout.write(`Expires in: ${formatDuration(expiresInMs)}\n`);
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // Signal 0 is the "is this pid alive?" probe across POSIX and Node-on-Windows.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the pid exists but we lack permission to signal it; still alive.
    return error.code === "EPERM";
  }
}

function stopProcessTree(pid, signal = "SIGTERM") {
  if (process.platform !== "win32") {
    process.kill(pid, signal);
    return;
  }
  const result = spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
    stdio: "ignore",
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    process.kill(pid, signal);
  }
}

function readPid() {
  try {
    const raw = fs.readFileSync(pidFile(), "utf8").trim();
    const n = Number(raw);
    return Number.isInteger(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writePid(pid) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(pidFile(), `${pid}\n`, "utf8");
}

function clearPid() {
  try { fs.unlinkSync(pidFile()); } catch { /* ignore */ }
}

function ensureNoExistingDaemon() {
  const pid = readPid();
  if (pid && isAlive(pid)) {
    process.stderr.write(`[daemon-control] daemon already running (pid ${pid}). Run 'npm run daemon:stop' first.\n`);
    process.exit(1);
  }
  if (pid) {
    process.stderr.write(`[daemon-control] cleaning stale pid file at ${pidFile()} (pid ${pid} is dead)\n`);
    clearPid();
  }
}

function daemonEnv() {
  return {
    ...process.env,
    LEGAX_CONFIG: resolveConfigPath()
  };
}

function startForeground() {
  ensureNoExistingDaemon();
  const child = spawn(process.execPath, [DAEMON_SCRIPT], {
    cwd: packageRoot,
    env: daemonEnv(),
    stdio: "inherit"
  });
  writePid(child.pid);
  let exiting = false;
  const onShutdown = () => {
    if (exiting) return;
    exiting = true;
    try { stopProcessTree(child.pid, "SIGTERM"); } catch { /* ignore */ }
  };
  process.on("SIGINT", onShutdown);
  process.on("SIGTERM", onShutdown);
  child.on("exit", (code, signal) => {
    clearPid();
    process.exit(code ?? (signal ? 130 : 0));
  });
  child.on("error", (error) => {
    clearPid();
    process.stderr.write(`[daemon-control] spawn failed: ${error.message}\n`);
    process.exit(127);
  });
}

function startBackground() {
  ensureNoExistingDaemon();
  fs.mkdirSync(dataDir(), { recursive: true });
  const errFd = fs.openSync(logFile(), "a");
  const child = spawn(process.execPath, [DAEMON_SCRIPT], {
    cwd: packageRoot,
    env: daemonEnv(),
    stdio: ["ignore", "ignore", errFd],
    detached: true,
    windowsHide: true
  });
  // Closing our handle to the log fd is fine; the kernel keeps the child's
  // dup alive until the child exits.
  fs.closeSync(errFd);
  writePid(child.pid);
  child.unref();
  process.stderr.write(`[daemon-control] daemon started in background (pid ${child.pid})\n`);
  process.stderr.write(`[daemon-control] logs: ${logFile()}\n`);
  process.stderr.write(`[daemon-control] stop with: npm run daemon:stop\n`);
}

function statusCheck() {
  fs.mkdirSync(dataDir(), { recursive: true });
  const pid = readPid();
  if (!pid) {
    process.stderr.write("[daemon-control] not running (no pid file)\n");
    process.exit(1);
  }
  if (!isAlive(pid)) {
    process.stderr.write(`[daemon-control] not running (pid ${pid} from ${pidFile()} is dead)\n`);
    process.exit(1);
  }
  process.stderr.write(`[daemon-control] running (pid ${pid})\n`);
  process.stderr.write(`[daemon-control] logs: ${logFile()}\n`);
}

async function stopDaemon() {
  const pid = readPid();
  if (!pid) {
    process.stderr.write("[daemon-control] no pid file; nothing to stop\n");
    return;
  }
  if (!isAlive(pid)) {
    process.stderr.write(`[daemon-control] pid ${pid} already dead; cleaning pid file\n`);
    clearPid();
    return;
  }
  try {
    stopProcessTree(pid, "SIGTERM");
  } catch (error) {
    process.stderr.write(`[daemon-control] failed to send SIGTERM to ${pid}: ${error.message}\n`);
    process.exit(1);
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) {
      clearPid();
      process.stderr.write(`[daemon-control] daemon stopped (pid ${pid})\n`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // Did not exit within 5s; escalate to hard kill so a wedged daemon does not
  // block subsequent npm runs.
  try { stopProcessTree(pid, "SIGKILL"); } catch { /* ignore */ }
  clearPid();
  process.stderr.write(`[daemon-control] daemon force-killed (pid ${pid}) after timeout\n`);
}

const action = process.argv[2];
switch (action) {
  case "start":
    startForeground();
    break;
  case "start:bg":
    startBackground();
    break;
  case "status":
    statusCheck();
    break;
  case "stop":
    await stopDaemon();
    break;
  case "pair":
    await pairBrowser();
    break;
  default:
    process.stderr.write("usage: node scripts/daemon-control.mjs <start|start:bg|status|stop|pair>\n");
    process.exit(2);
}
