#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { spawn } from "node:child_process";
import { pollInboundTransports } from "./lib/inbound-transports.mjs";
import { dispatchAdditionalTransports } from "./lib/outbound-transports.mjs";
import {
  applyControlMessages,
  canAcceptApproval as runtimeCanAcceptApproval,
  canAcceptText as runtimeCanAcceptText,
  filterAgentMessages,
  getAgentRuntime,
  getAgentThreadSelection,
  messagesCreatedAfter,
  normalizeApprovals,
  setAgentCursor,
  setAgentThreadSelection,
  setAgentMode,
  shouldForwardRemoteEvent,
  timeoutDecision
} from "./lib/runtime-state.mjs";
import { readYaml } from "./lib/yaml.mjs";
import { probeCodexFeatures, hintsForFeatures } from "./lib/codex-features.mjs";
import { packageVersion } from "./lib/version.mjs";
import {
  buildProjectChoices,
  filterActiveItems,
  filterItemsByProject,
  formatPageLine,
  formatProjectList,
  buttonRows,
  hierarchyRows,
  normalizePage,
  paginateItems,
  projectsReplyMarkup,
  resolveProjectChoice
} from "./lib/menu-groups.mjs";
import { packageAssetPath, resolveConfigPath, resolveConfigRelative, resolveRuntimeFile } from "./lib/paths.mjs";


const VERSION = packageVersion();
let activeConfigPath = resolveConfigPath();


function resolveFromCwd(value) {
  if (!value) return value;
  return resolveConfigRelative(value, activeConfigPath);
}

function loadConfig() {
  const configPath = resolveConfigPath();
  activeConfigPath = configPath;
  const sourcePath = fs.existsSync(configPath) ? configPath : packageAssetPath("config.example.yaml");
  const raw = readYaml(sourcePath) ?? {};
  const remote = {
    enabled: true,
    defaultMode: "interactive",
    pauseAll: false,
    ...(raw.remote ?? {})
  };
  const approvals = normalizeApprovals(raw.approvals);
  const codexRaw = raw.codex ?? {};
  const claudeRaw = raw.claude ?? {};
  const geminiRaw = raw.gemini ?? {};
  const sharedServerMode = codexRaw.sharedServerMode
    ?? (codexRaw.autoStartSharedServer === false ? "connect-only" : "connect-or-start");
  const codexAppServer = {
    enabled: true,
    agentId: "codex-cli",
    agentLabel: "Codex CLI",
    cliBackend: codexRaw.cliBackend ?? "app-server-ws",
    useExisting: codexRaw.useExisting ?? false,
    appServerUrl: codexRaw.appServerUrl ?? codexRaw.wsUrl ?? "ws://127.0.0.1:18779/rpc",
    sharedServerMode,
    autoStartSharedServer: codexRaw.autoStartSharedServer ?? sharedServerMode !== "connect-only",
    stopSharedServerOnExit: codexRaw.stopSharedServerOnExit ?? false,
    mcpEnabled: true,
    mcpRole: "capability",
    mode: remote.defaultMode,
    command: "codex",
    cwd: ".",
    threadCwd: ".",
    listThreadsOnStartup: false,
    threadListLimit: 30,
    threadListCwd: "all",
    threadSourceKinds: [
      "cli",
      "vscode",
      "exec",
      "appServer",
      "subAgent",
      "subAgentReview",
      "subAgentCompact",
      "subAgentThreadSpawn",
      "subAgentOther",
      "unknown"
    ],
    resumeSelectedThreadOnStartup: true,
    startThreadOnStartup: false,
    startThreadOnFirstMessage: false,
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    pollIntervalMs: 1200,
    approvalTimeoutMs: 300000,
    approvalAcceptDecision: "accept",
    permissionApprovalScope: "turn",
    notifyOnConnection: false,
    notifyOnTurnCompleted: true,
    forwardAgentMessages: false,
    forwardCompletionMessages: true,
    forwardStatusEvents: false,
    sessionHistoryOnSelectLimit: 1,
    ...codexRaw
  };
  if (!Array.isArray(codexRaw.args)) {
    codexAppServer.args = defaultCodexAppServerArgs(codexAppServer);
  }
  const claudeCode = {
    enabled: claudeRaw.enabled ?? true,
    agentId: claudeRaw.agentId ?? "claude-code",
    agentLabel: claudeRaw.agentLabel ?? "Claude Code",
    mode: claudeRaw.mode ?? remote.defaultMode,
    command: "claude",
    supportsSessions: claudeRaw.supportsSessions ?? true,
    cliBackend: claudeRaw.cliBackend ?? "stream-json",
    mcpEnabled: claudeRaw.mcpEnabled ?? true,
    ...claudeRaw
  };
  const geminiCli = {
    enabled: geminiRaw.enabled ?? true,
    agentId: geminiRaw.agentId ?? "gemini-cli",
    agentLabel: geminiRaw.agentLabel ?? "Gemini CLI",
    mode: geminiRaw.mode ?? remote.defaultMode,
    command: "gemini",
    supportsSessions: geminiRaw.supportsSessions ?? true,
    cliBackend: geminiRaw.cliBackend ?? "stream-json",
    mcpEnabled: geminiRaw.mcpEnabled ?? true,
    ...geminiRaw
  };
  return {
    sessionId: raw.sessionId ?? "default",
    displayName: raw.displayName ?? "Desktop Agent",
    configPath,
    configSourcePath: sourcePath,
    runtimeStatePath: resolveRuntimeFile(raw.runtimeStatePath, configPath, "runtime-state.json"),
    remote,
    approvals,
    routing: raw.routing ?? {},
    transports: Array.isArray(raw.transports) ? raw.transports : [],
    codexAppServer,
    claudeCode,
    geminiCli
  };
}

function defaultCodexAppServerArgs(settings) {
  if (usesWebSocketAppServer(settings)) {
    return ["app-server", "--listen", sharedServerListenUrl(settings)];
  }
  if (usesExistingAppServer(settings)) {
    const args = ["app-server", "proxy"];
    const socketPath = settings.appServerSocketPath ?? settings.sock;
    if (socketPath) args.push("--sock", String(socketPath));
    return args;
  }
  return ["app-server", "--listen", "stdio://"];
}

function ensureListenArg(args, listenUrl) {
  const normalized = args.map(String);
  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (arg.startsWith("--listen=")) return normalized;
    if (arg === "--listen") {
      const next = normalized[index + 1];
      if (next && !next.startsWith("--")) return normalized;
      normalized.splice(index + 1, 0, listenUrl);
      return normalized;
    }
  }
  return [...normalized, "--listen", listenUrl];
}

function effectiveCodexAppServerArgs(settings) {
  const args = Array.isArray(settings.args)
    ? settings.args.map(String)
    : defaultCodexAppServerArgs(settings);
  return usesWebSocketAppServer(settings)
    ? ensureListenArg(args, sharedServerListenUrl(settings))
    : args;
}

function sharedServerStartArgs(settings) {
  const args = Array.isArray(settings.sharedServerArgs)
    ? settings.sharedServerArgs.map(String)
    : effectiveCodexAppServerArgs(settings);
  return ensureListenArg(args, sharedServerListenUrl(settings));
}

function usesExistingAppServer(settings) {
  return settings.useExisting === true
    || settings.cliBackend === "app-server-proxy"
    || settings.cliBackend === "existing-app-server"
    || usesWebSocketAppServer(settings);
}

function usesWebSocketAppServer(settings) {
  return settings.cliBackend === "app-server-ws"
    || settings.cliBackend === "app-server-websocket";
}

function sharedServerListenUrl(settings) {
  const raw = String(settings.sharedServerListenUrl ?? settings.appServerUrl ?? "ws://127.0.0.1:18779/rpc");
  const url = new URL(raw);
  return `${url.protocol}//${url.host}`;
}

// `codex --remote` accepts the host:port form without trailing /rpc path,
// so trim that off when synthesizing the connect-with hint.
function stripWsPath(rawUrl) {
  try {
    const url = new URL(String(rawUrl));
    return `${url.protocol}//${url.host}`;
  } catch {
    return String(rawUrl);
  }
}

function selectRelay(config) {
  const relay = config.transports.find((transport) => transport.enabled !== false && transport.type === "relay");
  if (!relay || !relay.baseUrl) return null;
  return {
    name: relay.name ?? "self-hosted-relay",
    baseUrl: relay.baseUrl,
    secret: relay.secret,
    timeoutMs: Number(relay.timeoutMs ?? 15000)
  };
}

async function httpJson(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers ?? {})
      }
    });
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
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

class RelayClient {
  constructor(config) {
    this.config = config;
    this.relay = selectRelay(config);
    const runtime = getAgentRuntime(config, config.codexAppServer);
    this.startedAtMs = Date.now();
    this.afterMessageSeq = Number(runtime.afterMessageSeq ?? 0);
    this.primeOnFirstPoll = runtime.afterMessageSeq === undefined;
    this.config.runtimeMode = runtime.mode;
  }

  headers() {
    return this.relay?.secret ? { "x-legax-secret": this.relay.secret } : {};
  }

  async send(kind, text, metadata = {}) {
    const settings = this.config.codexAppServer;
    const event = {
      id: crypto.randomUUID(),
      sessionId: this.config.sessionId,
      agentId: settings.agentId,
      agentLabel: settings.agentLabel,
      taskId: settings.taskId,
      source: "codex-app-server",
      sourceName: settings.agentLabel ?? this.config.displayName,
      kind,
      text,
      metadata: {
        agentId: settings.agentId,
        agentLabel: settings.agentLabel,
        taskId: settings.taskId,
        mode: this.config.runtimeMode ?? settings.mode,
        ...(process.env.LEGAX_DAEMON_HOST_ID ? { hostId: process.env.LEGAX_DAEMON_HOST_ID } : {}),
        ...metadata
      },
      createdAt: new Date().toISOString()
    };
    if (!shouldForwardRemoteEvent(event.metadata.mode, kind, event.metadata)) return event;
    const results = [];
    if (this.relay) {
      try {
        const url = new URL("/api/events", this.relay.baseUrl);
        const result = await httpJson(url, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(event)
        }, this.relay.timeoutMs);
        results.push({ transport: this.relay.name, type: "relay", ok: true, result });
      } catch (error) {
        results.push({ transport: this.relay.name, type: "relay", ok: false, error: error.message });
      }
    }
    results.push(...await dispatchAdditionalTransports(this.config, event, this.relay?.name));
    for (const result of results) {
      if (!result.ok) process.stderr.write(`[legax] ${result.transport} dispatch failed: ${result.error}\n`);
    }
    if (results.length && !results.some((result) => result.ok)) {
      throw new Error(`All outbound transports failed: ${results.map((result) => `${result.transport}: ${result.error}`).join("; ")}`);
    }
    return event;
  }

  async poll() {
    let rawMessages = [];
    const daemonRouterManaged = process.env.LEGAX_DAEMON_CHILD === "1"
      && process.env.LEGAX_DAEMON_ROUTER === "1";
    if (this.relay && !daemonRouterManaged) {
      try {
        const url = new URL("/api/messages", this.relay.baseUrl);
        url.searchParams.set("sessionId", this.config.sessionId);
        url.searchParams.set("after", String(this.afterMessageSeq));
        url.searchParams.set("agentId", this.config.codexAppServer.agentId);
        if (this.config.codexAppServer.taskId) url.searchParams.set("taskId", this.config.codexAppServer.taskId);
        const response = await httpJson(url, {
          headers: this.headers()
        }, this.relay.timeoutMs);
        rawMessages = response.messages ?? [];
      } catch (error) {
        process.stderr.write(`[legax] ${this.relay.name} poll failed: ${error.message}\n`);
      }
    }
    const inboundMessages = await pollInboundTransports(this.config, this.config.codexAppServer, {
      drainOnly: daemonRouterManaged
    });
    const messages = filterAgentMessages(this.config, this.config.codexAppServer, [...rawMessages, ...inboundMessages]);
    this.config.runtimeMode = applyControlMessages(this.config, this.config.codexAppServer, messages, this.config.runtimeMode);
    const maxSeq = Math.max(this.afterMessageSeq, ...rawMessages.map((message) => Number(message.seq) || 0));
    this.afterMessageSeq = maxSeq;
    setAgentCursor(this.config, this.config.codexAppServer, maxSeq);
    if (this.primeOnFirstPoll) {
      this.primeOnFirstPoll = false;
      return messagesCreatedAfter(messages, this.startedAtMs);
    }
    return messages;
  }
}

class MinimalWebSocketRpcTransport {
  constructor(url) {
    this.url = new URL(url);
    this.buffer = Buffer.alloc(0);
    this.connected = false;
    this.messageHandler = null;
  }

  connect(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const isTls = this.url.protocol === "wss:";
      if (this.url.protocol !== "ws:" && !isTls) {
        reject(new Error(`Unsupported app-server websocket protocol: ${this.url.protocol}`));
        return;
      }
      const port = Number(this.url.port || (isTls ? 443 : 80));
      const host = this.url.hostname;
      const pathAndQuery = `${this.url.pathname || "/"}${this.url.search || ""}`;
      const key = crypto.randomBytes(16).toString("base64");
      const expectedAccept = crypto
        .createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      const timer = setTimeout(() => {
        this.socket?.destroy();
        reject(new Error(`Timed out connecting to Codex app-server websocket at ${this.url.href}`));
      }, timeoutMs);
      const done = (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      this.socket = isTls
        ? tls.connect({ host, port, servername: host })
        : net.connect({ host, port });
      let handshake = Buffer.alloc(0);
      this.socket.on("connect", () => {
        this.socket.write([
          `GET ${pathAndQuery} HTTP/1.1`,
          `Host: ${this.url.host}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "",
          ""
        ].join("\r\n"));
      });
      this.socket.on("data", (chunk) => {
        if (!this.connected) {
          handshake = Buffer.concat([handshake, chunk]);
          const headerEnd = handshake.indexOf("\r\n\r\n");
          if (headerEnd < 0) return;
          const header = handshake.subarray(0, headerEnd).toString("utf8");
          const statusLine = header.split("\r\n")[0] ?? "";
          const headers = parseHttpHeaders(header);
          if (!/^HTTP\/1\.[01] 101\b/.test(statusLine)
            || headers["sec-websocket-accept"] !== expectedAccept) {
            this.socket.destroy();
            done(new Error(`Codex app-server websocket handshake failed: ${statusLine}`));
            return;
          }
          this.connected = true;
          done();
          const remaining = handshake.subarray(headerEnd + 4);
          if (remaining.length > 0) this.readFrames(remaining);
          return;
        }
        this.readFrames(chunk);
      });
      this.socket.on("error", (error) => {
        if (!this.connected) done(error);
      });
      this.socket.on("close", () => {
        this.connected = false;
      });
    });
  }

  readFrames(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        const bigLength = this.buffer.readBigUInt64BE(offset);
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.close();
          throw new Error("Codex app-server websocket frame is too large");
        }
        length = Number(bigLength);
        offset += 8;
      }
      let mask;
      if (second & 0x80) {
        if (this.buffer.length < offset + 4) return;
        mask = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (this.buffer.length < offset + length) return;
      let payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (mask) {
        const unmasked = Buffer.alloc(payload.length);
        for (let index = 0; index < payload.length; index += 1) {
          unmasked[index] = payload[index] ^ mask[index % 4];
        }
        payload = unmasked;
      }
      if (opcode === 0x1) {
        this.messageHandler?.(payload.toString("utf8"));
      } else if (opcode === 0x8) {
        this.close();
      } else if (opcode === 0x9) {
        this.socket.write(encodeWebSocketFrame(payload, 0xA));
      }
    }
  }

  send(text) {
    if (!this.connected) throw new Error("Codex app-server websocket is not connected");
    this.socket.write(encodeWebSocketFrame(Buffer.from(text, "utf8"), 0x1));
  }

  close() {
    if (this.socket && !this.socket.destroyed) {
      try {
        this.socket.write(encodeWebSocketFrame(Buffer.alloc(0), 0x8));
      } catch {
        // Best-effort close.
      }
      this.socket.end();
    }
  }
}

function parseHttpHeaders(header) {
  const headers = {};
  for (const line of header.split("\r\n").slice(1)) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

function encodeWebSocketFrame(payload, opcode) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | data.length]);
  } else if (data.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(data.length);
  for (let index = 0; index < data.length; index += 1) {
    masked[index] = data[index] ^ mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

// Map a child-startup failure (port collision, missing binary, etc.) to an
// actionable error message. Keeping this in one place because the cause is
// almost always the same and the diagnosis is platform-specific.
function formatSharedStartupError({ listenUrl, appServerUrl, stderrBuffer, childExitedWith }) {
  const url = new URL(appServerUrl ?? "ws://127.0.0.1:18779/rpc");
  const port = url.port || "18779";
  const stderrTail = (stderrBuffer ?? "").trim().slice(-1024);
  const lower = stderrTail.toLowerCase();
  const portInUse = /already in use|10048|eaddrinuse|address already in use/.test(lower);
  const lines = [];
  lines.push(`Codex shared app-server did not become healthy at ${listenUrl}.`);
  if (childExitedWith) {
    lines.push(`Child exited with code=${childExitedWith.code ?? "null"} signal=${childExitedWith.signal ?? "null"}.`);
  } else {
    lines.push(`Child did not exit, but /healthz never responded within the timeout window.`);
  }
  if (portInUse) {
    lines.push(`Port ${port} is already in use.`);
    lines.push(`Possible causes:`);
    lines.push(`  • A previous codex app-server is still running (or zombie). Find it and kill it:`);
    if (process.platform === "win32") {
      lines.push(`      Get-NetTCPConnection -LocalPort ${port} | Select-Object -Expand OwningProcess | Stop-Process -Force`);
    } else {
      lines.push(`      lsof -i :${port}    # or:  fuser -k ${port}/tcp`);
    }
    lines.push(`  • Another tool grabbed the port — change codex.appServerUrl to a free one (e.g. ws://127.0.0.1:18780/rpc) and update codex.args accordingly.`);
    lines.push(`  • A zombie socket on Windows can linger after the process dies; rebooting clears it.`);
  } else if (stderrTail) {
    lines.push(`Last stderr from the child:\n${stderrTail}`);
  }
  return lines.join("\n");
}

async function waitForSharedWebSocketServer(settings) {
  const url = new URL(settings.appServerUrl ?? "ws://127.0.0.1:18779/rpc");
  const healthUrl = `${url.protocol === "wss:" ? "https:" : "http:"}//${url.host}/healthz`;
  const timeoutMs = Number(settings.sharedServerHealthTimeoutMs ?? 5000);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(800) });
      if (response.ok) return true;
    } catch {
      // Keep polling until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

class AppServerRpc {
  constructor(config) {
    this.config = config;
    this.nextId = 1;
    this.pending = new Map();
    this.notificationHandler = null;
    this.requestHandler = null;
  }

  async start() {
    const settings = this.config.codexAppServer;
    if (settings.cliBackend === "app-server-remote-controller") {
      // Stub: this mode targets the upstream `remote_control` framework that
      // OpenAI is building (see codex features list). When that feature
      // graduates to stable, this branch will speak the controller-side of
      // remote_control_client_websocket / _enrollment to share state with the
      // running desktop app. Until then, refuse loudly so the operator does
      // not silently sit on a broken bridge.
      const probe = probeCodexFeatures(String(settings.command ?? "codex"));
      const remote = probe.features?.remote_control;
      const stage = remote?.stage ?? "unknown";
      throw new Error(
        `cliBackend: app-server-remote-controller is not yet implemented. ` +
        `It targets codex's remote_control feature, which is currently "${stage}" ` +
        `in ${probe.version || "the codex CLI on PATH"}. When remote_control reaches ` +
        `stable, this adapter will speak the controller side of ` +
        `remote_control_client_websocket. For now, use cliBackend: app-server-ws ` +
        `(with codex --remote ws://...) for full bidirectional bridge, or ` +
        `enable codexDesktopMirror for read-only desktop-app observation.`
      );
    }
    if (usesWebSocketAppServer(settings)) {
      await this.startWebSocket(settings);
      return;
    }
    const args = effectiveCodexAppServerArgs(settings);
    this.child = spawn(String(settings.command), args, {
      cwd: resolveFromCwd(settings.cwd ?? "."),
      env: process.env,
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.readStdout(chunk));
    this.child.stderr.on("data", (chunk) => process.stderr.write(`[codex-app-server] ${chunk}`));
    this.child.on("exit", (code, signal) => {
      const error = new Error(`codex app-server exited (${code ?? signal})`);
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
    });
    this.child.on("error", (error) => {
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
    });
  }

  async startWebSocket(settings) {
    const ready = await waitForSharedWebSocketServer(settings);
    if (!ready) {
      const mode = settings.sharedServerMode ?? (settings.autoStartSharedServer ? "connect-or-start" : "connect-only");
      if (mode === "connect-or-start" || mode === "start-owned") {
        const listenUrl = sharedServerListenUrl(settings);
        const command = String(settings.sharedServerCommand ?? settings.command);
        const args = sharedServerStartArgs(settings);
        this.sharedServerChild = spawn(command, args, {
          cwd: resolveFromCwd(settings.cwd ?? "."),
          env: process.env,
          shell: process.platform === "win32",
          windowsHide: true,
          stdio: ["ignore", "ignore", "pipe"]
        });
        // Buffer the first chunks of stderr so a fast-fail (port collision,
        // missing binary, etc.) gives the operator an actionable error instead
        // of an opaque "exited (1)" line.
        let stderrBuffer = "";
        let childExitedWith = null;
        this.sharedServerChild.stderr.setEncoding("utf8");
        this.sharedServerChild.stderr.on("data", (chunk) => {
          if (stderrBuffer.length < 4096) stderrBuffer += chunk;
          process.stderr.write(`[codex-app-server-shared] ${chunk}`);
        });
        this.sharedServerChild.on("exit", (code, signal) => {
          childExitedWith = { code, signal };
          process.stderr.write(`[codex-app-server-shared] exited (${code ?? signal})\n`);
        });
        const started = await waitForSharedWebSocketServer(settings);
        if (!started) {
          throw new Error(formatSharedStartupError({
            listenUrl,
            appServerUrl: settings.appServerUrl,
            stderrBuffer,
            childExitedWith
          }));
        }
      } else {
        throw new Error(`No shared Codex app-server is listening at ${settings.appServerUrl}. Set codex.sharedServerMode: connect-or-start or codex.autoStartSharedServer: true to spawn one.`);
      }
    }
    this.ws = new MinimalWebSocketRpcTransport(settings.appServerUrl ?? "ws://127.0.0.1:18779/rpc");
    this.ws.messageHandler = (text) => this.readJsonMessage(text);
    await this.ws.connect(Number(settings.websocketConnectTimeoutMs ?? 10000));
  }

  readStdout(chunk) {
    this.buffer = (this.buffer ?? "") + chunk;
    let newlineIndex;
    while ((newlineIndex = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        process.stderr.write(`[legax] invalid app-server JSON: ${error.message}\n`);
        continue;
      }
      void this.handleMessage(message);
    }
  }

  readJsonMessage(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch (error) {
      process.stderr.write(`[legax] invalid app-server websocket JSON: ${error.message}\n`);
      return;
    }
    void this.handleMessage(message);
  }

  async handleMessage(message) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      else pending.resolve(message.result ?? {});
      return;
    }

    if (message.id !== undefined && message.method) {
      try {
        if (!this.requestHandler) throw new Error(`No handler for server request ${message.method}`);
        const result = await this.requestHandler(message.method, message.params ?? {}, message.id);
        this.write({ id: message.id, result });
      } catch (error) {
        this.write({
          id: message.id,
          error: {
            code: -32000,
            message: error?.message ?? String(error)
          }
        });
      }
      return;
    }

    if (message.method && this.notificationHandler) {
      await this.notificationHandler(message.method, message.params ?? {});
    }
  }

  request(method, params = {}) {
    const id = this.nextId++;
    this.write({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  notify(method, params = {}) {
    this.write({ method, params });
  }

  write(message) {
    const text = JSON.stringify(message);
    if (this.ws) this.ws.send(text);
    else this.child.stdin.write(`${text}\n`);
  }

  stop() {
    this.ws?.close();
    this.child?.kill();
    if (this.config.codexAppServer.stopSharedServerOnExit === true) this.sharedServerChild?.kill();
  }
}

class CodexAppServerLink {
  constructor(config) {
    this.config = config;
    this.relay = new RelayClient(config);
    this.rpc = new AppServerRpc(config);
    this.rpc.notificationHandler = (method, params) => this.handleNotification(method, params);
    this.rpc.requestHandler = (method, params, id) => this.handleServerRequest(method, params, id);
    this.pendingApprovals = new Map();
    this.pendingUserInputs = new Map();
    this.agentBuffers = new Map();
    this.completedAgentMessages = [];
    this.activeTurnId = null;
    this.threadId = null;
    this.currentThread = null;
    this.threadChoices = [];
    this.projectChoices = [];
    this.polling = false;
    this.mode = config.runtimeMode ?? normalizeMode(config.codexAppServer.mode ?? config.remote?.defaultMode);
    this.config.runtimeMode = this.mode;
  }

  async start() {
    await this.rpc.start();
    await this.rpc.request("initialize", {
      clientInfo: {
        name: "legax",
        title: "Legax",
        version: VERSION
      },
      capabilities: {
        experimentalApi: true
      }
    });
    this.rpc.notify("initialized", {});

    const selection = getAgentThreadSelection(this.config, this.config.codexAppServer);
    if (selection.selectedThreadId && this.config.codexAppServer.resumeSelectedThreadOnStartup !== false) {
      try {
        await this.resumeThread(selection.selectedThreadId, { announce: false });
      } catch (error) {
        process.stderr.write(`[legax] resume selected thread failed: ${error.message}\n`);
      }
    }
    if (!this.threadId && this.config.codexAppServer.startThreadOnStartup === true) {
      await this.createThread({ announce: false });
    }
    // Always print the connect-with hint to stderr on first connection so the
    // operator can copy-paste it. This is a one-line breadcrumb, not a status
    // event; phone-side notification is still gated by notifyOnConnection.
    if (usesWebSocketAppServer(this.config.codexAppServer)) {
      const wsUrl = this.config.codexAppServer.appServerUrl ?? this.config.codexAppServer.wsUrl ?? "ws://127.0.0.1:18779/rpc";
      process.stderr.write(`[legax] codex shared app-server is at ${wsUrl}\n`);
      process.stderr.write(`[legax] to follow phone-driven turns in your local TUI, run: codex --remote ${stripWsPath(wsUrl)}\n`);
      process.stderr.write(`[legax] (or use the helper: node scripts/codex-attach.mjs)\n`);
      // One-time probe of upstream feature flags. If remote_control/enable_fanout
      // graduated to stable, surface the hint so the operator knows we can
      // upgrade the bridge mode. This never blocks startup; failures are silent.
      try {
        const probe = probeCodexFeatures(String(this.config.codexAppServer.command ?? "codex"));
        for (const hint of hintsForFeatures(probe)) {
          process.stderr.write(`[legax] codex feature ${hint.name} (${hint.level}): ${hint.message}\n`);
          if (hint.level === "ready") {
            await this.relay.send("status", hint.message, {
              adapter: "codex-app-server",
              codexFeature: hint.name,
              level: hint.level
            }).catch(() => undefined);
          }
        }
      } catch {
        // If codex isn't on PATH or features list fails, skip silently. The
        // operator already saw the connect-with hint — no need to spam.
      }
    }
    if (this.config.codexAppServer.notifyOnConnection === true) {
      await this.relay.send("status", "Codex App Server connected. Use /start to choose a CLI and session.", {
        adapter: "codex-app-server",
        threadId: this.threadId,
        mode: this.mode,
        telegramSuppress: true,
        allowWhenPaused: true
      });
    }
    if (this.config.codexAppServer.listThreadsOnStartup === true) {
      await this.sendAgentMenu();
    }
    this.startPolling();
  }

  startPolling() {
    if (this.polling) return;
    this.polling = true;
    const intervalMs = Number(this.config.codexAppServer.pollIntervalMs ?? 1200);
    const tick = async () => {
      try {
        const messages = await this.relay.poll();
        this.mode = this.config.runtimeMode ?? this.mode;
        for (const message of messages) {
          await this.handleRemoteMessage(message);
        }
      } catch (error) {
        process.stderr.write(`[legax] relay poll failed: ${error.message}\n`);
      } finally {
        if (this.polling) setTimeout(tick, intervalMs);
      }
    };
    void tick();
  }

  async handleRemoteMessage(message) {
    if (message.type === "permission_decision" && message.requestId) {
      if (!this.canAcceptApproval()) {
        await this.relay.send("status", `Phone approval ignored because remote mode is ${this.mode}.`, {
          adapter: "codex-app-server",
          mode: this.mode,
          requestId: message.requestId,
          allowWhenPaused: true
        });
        return;
      }
      const pendingUserInput = this.pendingUserInputs.get(message.requestId);
      if (pendingUserInput) {
        this.pendingUserInputs.delete(message.requestId);
        pendingUserInput.resolve(message.decision === "approve"
          ? answersFromText(pendingUserInput.params, message.text ?? "approved")
          : { answers: {} });
        return;
      }
      const pending = this.pendingApprovals.get(message.requestId);
      if (pending) {
        this.pendingApprovals.delete(message.requestId);
        pending.resolve(message.decision === "approve" ? "approve" : "deny");
        return;
      }
      // No matching pending entry. Most often this happens when the adapter or
      // the daemon restarted between issuing the request and the phone clicking
      // a button. Codex itself has already re-rolled or dropped the request, so
      // the decision can't be honored — but staying silent makes the phone look
      // bricked. Surface the orphan to both stderr and the phone.
      process.stderr.write(`[legax] orphan permission_decision (no pending approval) for requestId=${message.requestId} decision=${message.decision}\n`);
      await this.relay.send("status", `Phone decision ignored: no pending approval matches requestId ${message.requestId} (the adapter may have restarted since the request was sent). Issue the action again to receive a fresh prompt.`, {
        adapter: "codex-app-server",
        mode: this.mode,
        requestId: message.requestId,
        orphanDecision: message.decision,
        allowWhenPaused: true
      });
      return;
    }

    if (message.type === "user_input_response" && message.requestId) {
      if (!this.canAcceptApproval()) {
        await this.relay.send("status", `Phone input ignored because remote mode is ${this.mode}.`, {
          adapter: "codex-app-server",
          mode: this.mode,
          requestId: message.requestId,
          allowWhenPaused: true
        });
        return;
      }
      const pending = this.pendingUserInputs.get(message.requestId);
      if (pending) {
        this.pendingUserInputs.delete(message.requestId);
        pending.resolve(answersFromText(pending.params, message.text ?? ""));
        return;
      }
      process.stderr.write(`[legax] orphan user_input_response (no pending input) for requestId=${message.requestId}\n`);
      await this.relay.send("status", `Phone input ignored: no pending input matches requestId ${message.requestId} (the adapter may have restarted since the request was sent).`, {
        adapter: "codex-app-server",
        mode: this.mode,
        requestId: message.requestId,
        allowWhenPaused: true
      });
      return;
    }

    if (message.type === "control") {
      await this.handleControlMessage(message);
      return;
    }

    if (message.type !== "text" || !message.text?.trim()) return;
    if (this.pendingUserInputs.size === 1 && this.canAcceptApproval()) {
      const [requestId, pending] = this.pendingUserInputs.entries().next().value;
      this.pendingUserInputs.delete(requestId);
      pending.resolve(answersFromText(pending.params, message.text.trim()));
      return;
    }
    if (!this.canAcceptText()) {
      await this.relay.send("status", `Phone text ignored because remote mode is ${this.mode}.`, {
        adapter: "codex-app-server",
        mode: this.mode,
        allowWhenPaused: true
      });
      return;
    }
    await this.sendUserInput(message.text.trim());
  }

  canAcceptText() {
    return runtimeCanAcceptText(this.config, this.mode);
  }

  canAcceptApproval() {
    return runtimeCanAcceptApproval(this.config, this.mode);
  }

  async handleControlMessage(message) {
    if (message.action === "list_agents") {
      await this.sendAgentMenu();
      return;
    }
    if (message.action === "list_agent_projects") {
      await this.sendProjectMenu(message.page);
      return;
    }
    if (message.action === "list_agent_sessions" || message.action === "list_codex_threads") {
      await this.sendThreadMenu(message.projectRef, message.page);
      return;
    }
    if (message.action === "select_session" || message.action === "select_codex_thread") {
      await this.selectThread(message.threadRef);
      return;
    }
    if (message.action === "new_session" || message.action === "new_codex_thread") {
      await this.createThread({ announce: true, cwd: message.projectPath ?? message.cwd });
      return;
    }
    if (message.action === "set_mode") {
      const nextMode = setAgentMode(this.config, this.config.codexAppServer, message.mode);
      this.mode = nextMode;
      this.config.runtimeMode = nextMode;
      await this.relay.send("status", `Codex CLI remote mode switched to ${nextMode}.`, {
        adapter: "codex-app-server",
        mode: nextMode,
        controlMessageId: message.id,
        allowWhenPaused: true
      });
    }
  }

  async sendAgentMenu() {
    const agents = configuredAgents(this.config);
    const lines = [
      "Choose a CLI adapter:",
      ...agents.map((agent, index) => {
        const capability = agent.supportsSessions ? "sessions" : "live session only";
        return `${index + 1}. ${agent.agentLabel} (${agent.agentId}) - ${capability}`;
      })
    ];
    await this.relay.send("status", lines.join("\n"), {
      adapter: "codex-app-server",
      telegramReplyMarkup: agentsReplyMarkup(this.config)
    });
  }

  async sendProjectMenu(page = 1) {
    let threads;
    try {
      threads = await this.listThreads();
    } catch (error) {
      await this.relay.send("status", `Could not list Codex projects/chats: ${error.message}`, {
        adapter: "codex-app-server",
        telegramReplyMarkup: agentsReplyMarkup(this.config)
      });
      return;
    }
    this.projectChoices = buildProjectChoices(threads, CODEX_PROJECT_OPTIONS);
    this.threadChoices = [];
    const pagination = paginateItems(this.projectChoices, { page, pageSize: 10 });
    await this.relay.send("status", formatProjectList("Codex", pagination.items, pagination), {
      adapter: "codex-app-server",
      telegramReplyMarkup: projectsReplyMarkup(this.config.codexAppServer.agentId, this.projectChoices, {
        page: pagination.page
      })
    });
  }

  async sendThreadMenu(projectRef, page = 1) {
    let threads;
    try {
      threads = await this.listThreads();
    } catch (error) {
      await this.relay.send("status", `Could not list Codex sessions: ${error.message}`, {
        adapter: "codex-app-server",
        telegramReplyMarkup: agentsReplyMarkup(this.config)
      });
      return;
    }
    this.projectChoices = buildProjectChoices(threads, CODEX_PROJECT_OPTIONS);
    const project = resolveProjectChoice(projectRef, this.projectChoices);
    const visibleThreads = filterItemsByProject(threads, project, CODEX_PROJECT_OPTIONS);
    const pagination = paginateItems(visibleThreads, { page, pageSize: 10 });
    this.threadChoices = pagination.items;
    if (threads.length === 0) {
      await this.relay.send("status", "No Codex sessions were found. Use /new codex-cli to start one.", {
        adapter: "codex-app-server",
        telegramReplyMarkup: {
          inline_keyboard: [
            [{ text: "New session", callback_data: `legax:new:${encodeURIComponent(this.config.codexAppServer.agentId)}` }],
            ...hierarchyRows(this.config.codexAppServer.agentId, { level: "session" })
          ]
        }
      });
      return;
    }
    if (visibleThreads.length === 0) {
      if (project?.isChat) {
        await this.relay.send("status", "No Codex chat sessions were found. Start a new chat or choose another project/chat.", {
          adapter: "codex-app-server",
          projectId: project.key,
          projectName: project.label,
          telegramReplyMarkup: threadsReplyMarkup(this.config.codexAppServer.agentId, [], {
            projectRef: project.id
          })
        });
        return;
      }
      await this.relay.send("status", "No Codex sessions were found for that project/chat.", {
        adapter: "codex-app-server",
        telegramReplyMarkup: projectsReplyMarkup(this.config.codexAppServer.agentId, this.projectChoices)
      });
      return;
    }
    await this.relay.send("status", formatThreadList(pagination.items, this.threadId, project, pagination), {
      adapter: "codex-app-server",
      projectId: project?.key,
      projectName: project?.label,
      projectPath: project?.detail,
      telegramReplyMarkup: threadsReplyMarkup(this.config.codexAppServer.agentId, pagination.items, {
        projectRef: project?.id,
        pagination
      })
    });
  }

  async listThreads() {
    const settings = this.config.codexAppServer;
    const params = {
      archived: false,
      limit: Number(settings.threadListLimit ?? 10),
      sortDirection: "desc",
      sortKey: "updated_at",
      sourceKinds: Array.isArray(settings.threadSourceKinds) ? settings.threadSourceKinds : undefined
    };
    const cwd = threadListCwd(settings);
    if (cwd) params.cwd = cwd;
    for (const key of Object.keys(params)) {
      if (params[key] === undefined || params[key] === null || params[key] === "") delete params[key];
    }
    const response = await this.rpc.request("thread/list", params);
    return filterActiveItems(response.data ?? response.threads ?? []);
  }

  async selectThread(threadRef) {
    const thread = await this.resolveThreadRef(threadRef);
    if (!thread?.id) {
      await this.relay.send("status", `Codex session not found: ${threadRef}. Use /sessions codex-cli to refresh the list.`, {
        adapter: "codex-app-server",
        telegramReplyMarkup: agentsReplyMarkup(this.config)
      });
      return;
    }
    await this.resumeThread(thread.id, { announce: true });
  }

  async resolveThreadRef(threadRef) {
    const value = String(threadRef ?? "").trim();
    if (!value) return null;
    if (/^\d+$/.test(value)) {
      const index = Number(value) - 1;
      if (this.threadChoices[index]) return this.threadChoices[index];
    }
    const choices = this.threadChoices.length > 0 ? this.threadChoices : await this.listThreads();
    return choices.find((thread) => thread.id === value)
      ?? choices.find((thread) => thread.id?.startsWith(value))
      ?? { id: value };
  }

  async resumeThread(threadId, { announce }) {
    const response = await this.rpc.request("thread/resume", {
      threadId,
      ...this.turnOverrides()
    });
    const thread = response.thread;
    this.threadId = thread?.id ?? threadId;
    this.currentThread = thread ?? { id: this.threadId };
    this.projectCwd = thread?.cwd || undefined;
    this.activeTurnId = null;
    this.agentBuffers.clear();
    setAgentThreadSelection(this.config, this.config.codexAppServer, thread ?? { id: this.threadId });
    if (announce) {
      await this.relay.send("status", formatThreadResume(thread ?? { id: this.threadId }), {
        adapter: "codex-app-server",
        threadId: this.threadId,
        telegramReplyMarkup: sessionReplyMarkup(this.config.codexAppServer.agentId, this.threadId)
      });
      await this.sendThreadHistoryOnSelect(thread ?? { id: this.threadId });
    }
    return thread;
  }

  async sendThreadHistoryOnSelect(thread) {
    const settings = this.config.codexAppServer;
    const limit = sessionHistoryOnSelectLimit(settings);
    if (limit <= 0) return;
    const items = threadHistoryItems(thread, limit);
    for (const item of items) {
      await this.relay.send("agent_text", item.text, {
        adapter: "codex-app-server",
        threadId: thread.id ?? this.threadId,
        threadTitle: threadTitle(thread),
        cwd: thread.cwd ?? settings.threadCwd ?? settings.cwd,
        author: item.author,
        sessionHistory: true,
        telegramImportant: true
      });
    }
  }

  async createThread({ announce, cwd }) {
    const projectCwd = cwd ? resolveFromCwd(cwd) : undefined;
    const threadResponse = await this.rpc.request("thread/start", {
      ...this.turnOverrides(projectCwd)
    });
    this.threadId = threadResponse.thread?.id;
    if (!this.threadId) throw new Error(`thread/start did not return thread.id: ${JSON.stringify(threadResponse)}`);
    this.currentThread = threadResponse.thread ?? { id: this.threadId };
    this.projectCwd = threadResponse.thread?.cwd ?? projectCwd ?? this.projectCwd;
    this.activeTurnId = null;
    setAgentThreadSelection(this.config, this.config.codexAppServer, threadResponse.thread);
    if (announce) {
      await this.relay.send("status", `New Codex session selected: ${shortId(this.threadId)}`, {
        adapter: "codex-app-server",
        threadId: this.threadId,
        cwd: this.projectCwd,
        projectName: this.projectCwd ? path.basename(this.projectCwd) : undefined,
        telegramReplyMarkup: sessionReplyMarkup(this.config.codexAppServer.agentId, this.threadId)
      });
    }
    return threadResponse.thread;
  }

  currentThreadTitle(threadId) {
    if (!threadId || this.currentThread?.id !== threadId) return undefined;
    return threadTitle(this.currentThread);
  }

  turnOverrides(cwdOverride) {
    const settings = this.config.codexAppServer;
    const overrides = {
      cwd: cwdOverride ?? this.projectCwd ?? resolveFromCwd(settings.threadCwd ?? "."),
      approvalPolicy: settings.approvalPolicy,
      approvalsReviewer: settings.approvalsReviewer
    };
    for (const key of Object.keys(overrides)) {
      if (overrides[key] === undefined || overrides[key] === null || overrides[key] === "") delete overrides[key];
    }
    return overrides;
  }

  async sendUserInput(text) {
    if (!this.threadId) {
      if (this.config.codexAppServer.startThreadOnFirstMessage === true) {
        await this.createThread({ announce: true });
      } else {
        await this.relay.send("status", "Choose a Codex session first with /start, then send your message.", {
          adapter: "codex-app-server",
          telegramReplyMarkup: agentsReplyMarkup(this.config)
        });
        return;
      }
    }
    const input = [{ type: "text", text }];
    if (this.activeTurnId) {
      try {
        await this.rpc.request("turn/steer", {
          threadId: this.threadId,
          input,
          expectedTurnId: this.activeTurnId
        });
        if (this.config.codexAppServer.forwardStatusEvents === true) {
          await this.relay.send("status", "Added phone reply to the active turn.", {
            adapter: "codex-app-server",
            threadId: this.threadId,
            turnId: this.activeTurnId
          });
        }
        return;
      } catch (error) {
        process.stderr.write(`[legax] turn/steer failed; starting a new turn: ${error.message}\n`);
      }
    }
    const response = await this.rpc.request("turn/start", {
      threadId: this.threadId,
      input,
      ...this.turnOverrides()
    });
    this.activeTurnId = response.turn?.id ?? this.activeTurnId;
  }

  async handleNotification(method, params) {
    if (method === "turn/started") {
      this.activeTurnId = params.turn?.id ?? params.turnId ?? this.activeTurnId;
      return;
    }
    if (method === "turn/completed") {
      const turnId = params.turn?.id ?? params.turnId ?? this.activeTurnId;
      const completionText = this.consumeTurnAgentMessages(turnId);
      this.activeTurnId = null;
      if (completionText && this.config.codexAppServer.forwardAgentMessages === false
        && this.config.codexAppServer.forwardCompletionMessages !== false) {
        await this.relay.send("agent_text", completionText, {
          adapter: "codex-app-server",
          threadId: params.threadId ?? this.threadId,
          threadTitle: this.currentThreadTitle(params.threadId ?? this.threadId),
          turnId,
          deliveryReason: "turn_completed",
          completionStatus: params.turn?.status ?? params.status ?? "done"
        });
      } else if (this.config.codexAppServer.notifyOnTurnCompleted !== false) {
        await this.relay.send("status", `Turn completed: ${params.turn?.status ?? params.status ?? "done"}`, {
          adapter: "codex-app-server",
          threadId: params.threadId ?? this.threadId,
          threadTitle: this.currentThreadTitle(params.threadId ?? this.threadId),
          turnId
        });
      }
      return;
    }
    if (method === "item/agentMessage/delta") {
      const itemId = params.itemId ?? params.item?.id ?? "agent";
      this.agentBuffers.set(itemId, `${this.agentBuffers.get(itemId) ?? ""}${params.delta ?? ""}`);
      return;
    }
    if (method === "item/completed") {
      const item = params.item ?? {};
      if (item.type === "agentMessage") {
        const text = item.text ?? this.agentBuffers.get(item.id) ?? "";
        this.agentBuffers.delete(item.id);
        if (text && this.config.codexAppServer.forwardAgentMessages !== false) {
          await this.relay.send("agent_text", text, {
            adapter: "codex-app-server",
            threadId: params.threadId ?? this.threadId,
            threadTitle: this.currentThreadTitle(params.threadId ?? this.threadId),
            turnId: params.turnId,
            itemId: item.id
          });
        } else if (text) {
          this.completedAgentMessages.push({
            turnId: params.turnId ?? this.activeTurnId,
            itemId: item.id,
            text
          });
        }
      }
      return;
    }
    if (method === "warning" || method === "configWarning" || method === "error") {
      if (this.config.codexAppServer.forwardStatusEvents !== true) return;
      const text = params.message ?? params.summary ?? params.error?.message ?? JSON.stringify(params);
      await this.relay.send("status", text, {
        adapter: "codex-app-server",
        method
      });
    }
  }

  consumeTurnAgentMessages(turnId) {
    const texts = [];
    for (const [itemId, text] of this.agentBuffers.entries()) {
      if (text) {
        texts.push({ turnId, itemId, text });
      }
    }
    this.agentBuffers.clear();

    const remaining = [];
    for (const message of this.completedAgentMessages) {
      if (!turnId || !message.turnId || message.turnId === turnId) texts.push(message);
      else remaining.push(message);
    }
    this.completedAgentMessages = remaining;
    return texts.map((message) => message.text).filter(Boolean).join("\n\n").trim();
  }

  async flushAllAgentBuffers() {
    if (this.config.codexAppServer.forwardAgentMessages === false) {
      this.consumeTurnAgentMessages(this.activeTurnId);
      return;
    }
    for (const [itemId, text] of this.agentBuffers.entries()) {
      if (!text) continue;
      await this.relay.send("agent_text", text, {
        adapter: "codex-app-server",
        threadId: this.threadId,
        threadTitle: this.currentThreadTitle(this.threadId),
        itemId
      });
    }
    this.agentBuffers.clear();
  }

  async handleServerRequest(method, params, nativeRequestId) {
    if (method === "item/commandExecution/requestApproval"
      || method === "item/fileChange/requestApproval"
      || method === "item/permissions/requestApproval") {
      return await this.handleApprovalRequest(method, params, nativeRequestId);
    }

    if (method === "item/tool/requestUserInput") {
      return await this.handleUserInputRequest(method, params, nativeRequestId);
    }

    if (method === "mcpServer/elicitation/request") {
      if (!this.canAcceptApproval()) {
        return { action: "decline", content: null };
      }
      await this.relay.send("permission_request", formatElicitationRequest(params), {
        requestId: `codex-${nativeRequestId}`,
        adapter: "codex-app-server",
        approvalMethod: method,
        title: "MCP elicitation",
        choices: ["approve", "deny"]
      });
      const decision = await this.waitForApprovalDecision(`codex-${nativeRequestId}`);
      return decision === "approve"
        ? { action: "accept", content: null }
        : { action: "decline", content: null };
    }

    throw new Error(`Unsupported server request: ${method}`);
  }

  async handleUserInputRequest(method, params, nativeRequestId) {
    if (!this.canAcceptApproval()) return { answers: {} };
    const requestId = `codex-${nativeRequestId}`;
    await this.relay.send("user_input_request", formatUserInputRequest(params, requestId), {
      requestId,
      adapter: "codex-app-server",
      approvalMethod: method,
      nativeRequestId,
      threadId: params.threadId,
      threadTitle: this.currentThreadTitle(params.threadId),
      turnId: params.turnId,
      itemId: params.itemId,
      title: "User input requested"
    });
    return await this.waitForUserInputResponse(requestId, params);
  }

  async handleApprovalRequest(method, params, nativeRequestId) {
    if (!this.canAcceptApproval()) {
      if (method === "item/permissions/requestApproval") {
        return { scope: "turn", permissions: {} };
      }
      return { decision: "decline" };
    }
    const requestId = `codex-${nativeRequestId}`;
    await this.relay.send("permission_request", formatApprovalRequest(method, params), {
      requestId,
      adapter: "codex-app-server",
      approvalMethod: method,
      nativeRequestId,
      threadId: params.threadId,
      threadTitle: this.currentThreadTitle(params.threadId),
      turnId: params.turnId,
      itemId: params.itemId,
      title: approvalTitle(method),
      choices: ["approve", "deny"]
    });
    const decision = await this.waitForApprovalDecision(requestId);
    if (method === "item/permissions/requestApproval") {
      if (decision === "approve") {
        return {
          scope: this.config.codexAppServer.permissionApprovalScope ?? "turn",
          permissions: params.permissions ?? {}
        };
      }
      return { scope: "turn", permissions: {} };
    }
    return {
      decision: decision === "approve"
        ? (this.config.codexAppServer.approvalAcceptDecision ?? "accept")
        : "decline"
    };
  }

  waitForApprovalDecision(requestId) {
    const timeoutMs = Number(this.config.codexAppServer.approvalTimeoutMs ?? 300000);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(requestId);
        resolve(timeoutDecision(this.config));
      }, timeoutMs);
      this.pendingApprovals.set(requestId, {
        resolve: (decision) => {
          clearTimeout(timer);
          resolve(decision);
        }
      });
    });
  }

  waitForUserInputResponse(requestId, params) {
    const timeoutMs = Number(this.config.codexAppServer.approvalTimeoutMs ?? 300000);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingUserInputs.delete(requestId);
        resolve({ answers: {} });
      }, timeoutMs);
      this.pendingUserInputs.set(requestId, {
        params,
        resolve: (answers) => {
          clearTimeout(timer);
          resolve(answers);
        }
      });
    });
  }
}

function configuredAgents(config) {
  return [
    {
      key: "codexAppServer",
      agentId: config.codexAppServer?.agentId ?? "codex-cli",
      agentLabel: config.codexAppServer?.agentLabel ?? "Codex CLI",
      enabled: config.codexAppServer?.enabled !== false,
      supportsSessions: true
    },
    {
      key: "claudeCode",
      agentId: config.claudeCode?.agentId ?? "claude-code",
      agentLabel: config.claudeCode?.agentLabel ?? "Claude Code",
      enabled: config.claudeCode?.enabled !== false,
      supportsSessions: config.claudeCode?.supportsSessions === true
    },
    {
      key: "geminiCli",
      agentId: config.geminiCli?.agentId ?? "gemini-cli",
      agentLabel: config.geminiCli?.agentLabel ?? "Gemini CLI",
      enabled: config.geminiCli?.enabled !== false,
      supportsSessions: config.geminiCli?.supportsSessions === true
    }
  ].filter((agent) => agent.enabled);
}

function agentsReplyMarkup(config) {
  const rows = buttonRows(configuredAgents(config).map((agent) => ({
    text: agent.agentLabel,
    callback_data: `legax:agent:${encodeURIComponent(agent.agentId)}`
  })), 2);
  rows.push(...hierarchyRows(null, { level: "cli" }));
  return { inline_keyboard: rows };
}

const CODEX_PROJECT_OPTIONS = {
  defaultKey: "codex-default-project",
  defaultLabel: "Default project",
  keyKeys: ["projectId", "metadata.projectId"],
  pathKeys: ["projectPath", "workspacePath", "cwd", "metadata.projectPath", "metadata.workspacePath", "metadata.cwd", "project", "metadata.project"],
  labelKeys: ["projectName", "workspaceName", "metadata.projectName"],
  chatSourceKeys: ["source", "sourceKind", "metadata.source", "metadata.sourceKind"],
  chatSourceValues: ["appServer", "app-server", "chat"],
  chatCwdSourceValues: ["appServer", "app-server", "chat"],
  chatIncludesUnknownCwdOnly: true
};

function projectPageCallback(encodedAgent, projectRef, page) {
  return `legax:project:${encodedAgent}:${encodeURIComponent(projectRef)}:${normalizePage(page)}`;
}

function threadsReplyMarkup(agentId, threads, { projectRef, pagination } = {}) {
  const encodedAgent = encodeURIComponent(agentId);
  const rows = threads.map((thread, index) => {
    const callbackData = `legax:session:${encodedAgent}:${encodeURIComponent(thread.id)}`;
    return [{
      text: `${index + 1}. ${buttonThreadTitle(thread)}`,
      callback_data: callbackData.length <= 64 ? callbackData : `legax:codex:use:${thread.id}`
    }];
  });
  if (pagination?.hasPrevious || pagination?.hasNext) {
    const nav = [];
    if (pagination.hasPrevious && projectRef) nav.push({ text: "Previous", callback_data: projectPageCallback(encodedAgent, projectRef, pagination.page - 1) });
    if (pagination.hasNext && projectRef) nav.push({ text: "Next", callback_data: projectPageCallback(encodedAgent, projectRef, pagination.page + 1) });
    if (nav.length > 0) rows.push(nav);
  }
  rows.push([
    {
      text: "Refresh sessions",
      callback_data: projectRef
        ? projectPageCallback(encodedAgent, projectRef, pagination?.page ?? 1)
        : `legax:sessions:${encodedAgent}`
    },
    { text: "New session", callback_data: `legax:new:${encodedAgent}` }
  ]);
  rows.push(...hierarchyRows(agentId, { level: "session", projectRef }));
  return { inline_keyboard: rows };
}

function sessionReplyMarkup(agentId, threadId) {
  const encodedAgent = encodeURIComponent(agentId);
  const callbackData = `legax:session:${encodedAgent}:${encodeURIComponent(threadId)}`;
  return {
    inline_keyboard: [
      [{ text: "Get messages", callback_data: callbackData.length <= 64 ? callbackData : `legax:codex:use:${threadId}` }],
      ...hierarchyRows(agentId, { level: "session", sessionRef: threadId })
    ]
  };
}

function threadListCwd(settings) {
  const value = settings.threadListCwd;
  if (value === false || value === "false" || value === "all" || value === "") return null;
  if (value === "cwd") return resolveFromCwd(settings.cwd ?? ".");
  if (value === "threadCwd" || value === true || value === undefined) return resolveFromCwd(settings.threadCwd ?? ".");
  return resolveFromCwd(value);
}

function formatThreadList(threads, activeThreadId, project, pagination) {
  return [
    project ? `Choose a Codex session in ${project.label}:` : "Choose a Codex session:",
    formatPageLine(pagination),
    ...threads.map((thread, index) => {
      const active = thread.id === activeThreadId ? " [current]" : "";
      return `${index + 1}. ${threadTitle(thread)}${active}\n   id: ${shortId(thread.id)} | updated: ${formatTimestamp(thread.updatedAt)}`;
    }),
    "You can also reply with /use codex-cli <number-or-id>."
  ].filter(Boolean).join("\n");
}

function formatThreadResume(thread) {
  return [
    `Selected Codex session: ${threadTitle(thread)}`,
    `id: ${shortId(thread.id)}`
  ].filter(Boolean).join("\n");
}

function sessionHistoryOnSelectLimit(settings) {
  const value = Number(settings.sessionHistoryOnSelectLimit ?? settings.sessionSelectHistoryLimit ?? 1);
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(20, Math.floor(value)));
}

function threadHistoryItems(thread, limit) {
  const items = [];
  for (const turn of thread.turns ?? []) {
    for (const item of turn.items ?? []) {
      const text = threadItemText(item);
      if (!text) continue;
      const role = threadItemRole(item);
      if (!role) continue;
      items.push({
        author: role === "User" ? "user" : "agent",
        text
      });
    }
  }
  return items.slice(-limit);
}

function threadItemRole(item) {
  const type = String(item.type ?? item.kind ?? "");
  if (type === "userMessage" || type === "user_message" || item.role === "user") return "User";
  if (type === "agentMessage" || type === "agent_message" || item.role === "assistant") return "Agent";
  return "";
}

function threadItemText(item) {
  if (typeof item.text === "string") return item.text;
  if (typeof item.message === "string") return item.message;
  if (typeof item.content === "string") return item.content;
  const content = item.message?.content ?? item.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part === "string" ? part : part?.text)
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function threadTitle(thread) {
  return singleLine(thread.name ?? thread.preview ?? thread.id ?? "Untitled session", 80);
}

function buttonThreadTitle(thread) {
  return singleLine(thread.name ?? thread.preview ?? shortId(thread.id) ?? "Untitled", 32);
}

function singleLine(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function shortId(value) {
  const text = String(value ?? "");
  return text.length > 12 ? `${text.slice(0, 8)}...${text.slice(-4)}` : text;
}

function formatTimestamp(value) {
  const number = Number(value);
  const date = Number.isFinite(number) && number > 0
    ? new Date(number * 1000)
    : new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString().replace("T", " ").slice(0, 16);
}

function approvalTitle(method) {
  if (method === "item/commandExecution/requestApproval") return "Command approval";
  if (method === "item/fileChange/requestApproval") return "File change approval";
  if (method === "item/permissions/requestApproval") return "Permission profile approval";
  return "Approval request";
}

function formatApprovalRequest(method, params) {
  if (method === "item/commandExecution/requestApproval") {
    return [
      "Command approval requested.",
      params.reason ? `Reason: ${params.reason}` : null,
      params.cwd ? `cwd: ${params.cwd}` : null,
      params.command ? `command: ${formatCommand(params.command)}` : null,
      params.parsedCmd ? `parsed: ${formatParsedCommands(params.parsedCmd)}` : null,
      params.networkApprovalContext ? `network: ${JSON.stringify(params.networkApprovalContext)}` : null
    ].filter(Boolean).join("\n");
  }
  if (method === "item/fileChange/requestApproval") {
    return [
      "File change approval requested.",
      params.reason ? `Reason: ${params.reason}` : null,
      params.grantRoot ? `Grant root: ${params.grantRoot}` : null,
      params.itemId ? `Item: ${params.itemId}` : null,
      params.callId ? `Call: ${params.callId}` : null,
      params.fileChanges ? `Files: ${formatFileChanges(params.fileChanges)}` : null
    ].filter(Boolean).join("\n");
  }
  if (method === "item/permissions/requestApproval") {
    return [
      "Permission profile approval requested.",
      params.reason ? `Reason: ${params.reason}` : null,
      params.cwd ? `cwd: ${params.cwd}` : null,
      `permissions: ${JSON.stringify(params.permissions ?? {}, null, 2)}`
    ].filter(Boolean).join("\n");
  }
  return JSON.stringify(params, null, 2);
}

function formatElicitationRequest(params) {
  return [
    "MCP elicitation requested.",
    params.serverName ? `Server: ${params.serverName}` : null,
    params.message ? `Message: ${params.message}` : null,
    params.mode ? `Mode: ${params.mode}` : null,
    params.url ? `URL: ${params.url}` : null
  ].filter(Boolean).join("\n");
}

function formatUserInputRequest(params, requestId) {
  const questions = Array.isArray(params.questions) ? params.questions : [];
  return [
    "Codex needs your input to continue.",
    ...questions.map((question, index) => {
      const options = Array.isArray(question.options) && question.options.length
        ? [
          "Options:",
          ...question.options.map((option, optionIndex) => `  ${optionIndex + 1}. ${option.label}${option.description ? ` - ${option.description}` : ""}`)
        ].join("\n")
        : null;
      return [
        `${index + 1}. ${question.header ? `${question.header}: ` : ""}${question.question ?? question.id}`,
        options
      ].filter(Boolean).join("\n");
    }),
    requestId ? `Reply with: /answer ${requestId} <answer>` : null
  ].filter(Boolean).join("\n");
}

function answersFromText(params, text) {
  const value = String(text ?? "").trim();
  const questions = Array.isArray(params.questions) ? params.questions : [];
  const answers = {};
  for (const question of questions) {
    if (!question?.id) continue;
    const selected = selectQuestionAnswer(question, value);
    answers[question.id] = { answers: selected ? [selected] : [] };
  }
  return { answers };
}

function selectQuestionAnswer(question, value) {
  if (!value) return "";
  const options = Array.isArray(question.options) ? question.options : [];
  if (options.length > 0) {
    const index = /^\d+$/.test(value) ? Number(value) - 1 : -1;
    if (options[index]) return options[index].label;
    const match = options.find((option) => option.label.toLowerCase() === value.toLowerCase());
    if (match) return match.label;
  }
  return value;
}

function formatCommand(command) {
  if (Array.isArray(command)) return command.join(" ");
  return String(command);
}

function formatParsedCommands(parsedCommands) {
  if (!Array.isArray(parsedCommands) || parsedCommands.length === 0) return "";
  return parsedCommands
    .map((command) => [command.type, command.cmd, command.path].filter(Boolean).join(":"))
    .join(", ");
}

function formatFileChanges(fileChanges) {
  return Object.entries(fileChanges ?? {})
    .map(([file, change]) => `${file} (${change?.type ?? "change"})`)
    .join(", ");
}

function normalizeMode(value) {
  const mode = String(value ?? "interactive").trim();
  if (mode === "monitor" || mode === "approval-only" || mode === "paused") return mode;
  return "interactive";
}

async function main() {
  const config = loadConfig();
  const args = process.argv.slice(2);
  if (args.includes("--dry-run") || args.includes("--status")) {
    const relay = selectRelay(config);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      configPath: config.configPath,
      sessionId: config.sessionId,
      relay: {
        name: relay?.name,
        baseUrl: relay?.baseUrl,
        hasSecret: Boolean(relay?.secret),
        enabled: Boolean(relay)
      },
      codex: {
        agentId: config.codexAppServer.agentId,
        agentLabel: config.codexAppServer.agentLabel,
        mode: config.codexAppServer.mode,
        cliBackend: config.codexAppServer.cliBackend,
        mcpEnabled: config.codexAppServer.mcpEnabled,
        useExisting: usesExistingAppServer(config.codexAppServer),
        appServerUrl: usesWebSocketAppServer(config.codexAppServer) ? config.codexAppServer.appServerUrl : undefined,
        sharedServerMode: usesWebSocketAppServer(config.codexAppServer) ? config.codexAppServer.sharedServerMode : undefined,
        autoStartSharedServer: usesWebSocketAppServer(config.codexAppServer) ? config.codexAppServer.autoStartSharedServer : undefined,
        command: config.codexAppServer.command,
        args: effectiveCodexAppServerArgs(config.codexAppServer),
        cwd: resolveFromCwd(config.codexAppServer.cwd ?? "."),
        threadCwd: resolveFromCwd(config.codexAppServer.threadCwd ?? ".")
      }
    }, null, 2)}\n`);
    return;
  }
  if (config.remote?.enabled === false) {
    process.stderr.write("[legax] Legax remote control is disabled by config.\n");
    return;
  }

  const link = new CodexAppServerLink(config);
  await link.start();
  process.stderr.write("[legax] Codex App Server link is running.\n");

  const shutdown = () => {
    link.polling = false;
    link.rpc.stop();
  };
  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });
}

main().catch((error) => {
  process.stderr.write(`[legax] ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
