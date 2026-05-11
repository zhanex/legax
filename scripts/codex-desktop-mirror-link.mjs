#!/usr/bin/env node
// Read-only mirror of the Codex desktop app's local session JSONL files.
//
// The desktop app does not expose a remote-control listener and does not
// accept --remote (see docs/EXTENDING.md and the README "Codex Bidirectional
// Visibility" section). This adapter watches ~/.codex/sessions/**/rollout-*.jsonl,
// follows the most recently written file, and forwards the user-visible items
// (user/assistant messages, command runs, tool calls, task completions) to the
// configured outbound transports.
//
// Read-only by design. Phone messages targeted at this adapter receive an
// immediate status reply explaining that they cannot be delivered. Approval
// decisions and user-input responses are likewise refused.

import fs from "node:fs";
import path from "node:path";
import { pollInboundTransports } from "./lib/inbound-transports.mjs";
import { dispatchAdditionalTransports } from "./lib/outbound-transports.mjs";
import {
  applyControlMessages,
  filterAgentMessages,
  getAgentRuntime,
  messagesCreatedAfter,
  normalizeApprovals,
  setAgentCursor
} from "./lib/runtime-state.mjs";
import { readYaml } from "./lib/yaml.mjs";
import { packageAssetPath, resolveConfigPath, resolveRuntimeFile } from "./lib/paths.mjs";


function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || "";
}

function expandHome(value) {
  const text = String(value ?? "");
  if (text === "~") return homeDir();
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(homeDir(), text.slice(2));
  return text;
}

function loadConfig() {
  const configPath = resolveConfigPath();
  const sourcePath = fs.existsSync(configPath) ? configPath : packageAssetPath("config.example.yaml");
  const raw = readYaml(sourcePath) ?? {};
  const remote = {
    enabled: true,
    defaultMode: "monitor",
    pauseAll: false,
    ...(raw.remote ?? {})
  };
  const approvals = normalizeApprovals(raw.approvals);
  const mirrorRaw = raw.codexDesktopMirror ?? {};
  const codexDesktopMirror = {
    enabled: false,
    agentId: "codex-desktop",
    agentLabel: "Codex Desktop (mirror)",
    cliBackend: "session-jsonl-tail",
    mcpEnabled: false,
    sessionsRoot: "~/.codex/sessions",
    followLatest: true,
    filterToOriginator: "Codex Desktop",
    forwardUserMessages: true,
    forwardAgentMessages: true,
    forwardCommandRuns: true,
    forwardToolCalls: false,
    forwardCompletion: true,
    pollIntervalMs: 1500,
    rescanFilesEveryMs: 5000,
    truncateOutputBytes: 1500,
    mode: "monitor",
    ...mirrorRaw
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
    codexDesktopMirror
  };
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
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      try { body = JSON.parse(text); } catch { body = { text }; }
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function listRollouts(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        try {
          const stat = fs.statSync(full);
          out.push({ path: full, mtimeMs: stat.mtimeMs, size: stat.size });
        } catch {
          // Skip files that disappear between readdir and stat.
        }
      }
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function readSessionMeta(filePath) {
  // Read just enough of the file to extract the first line (session_meta).
  // Most rollout files start with that header; if absent, return null.
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.subarray(0, n).toString("utf8");
    const newline = text.indexOf("\n");
    if (newline < 0) return null;
    const obj = JSON.parse(text.slice(0, newline));
    return obj?.type === "session_meta" ? obj.payload : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

class MirrorClient {
  constructor(config) {
    this.config = config;
    this.relay = selectRelay(config);
    this.settings = config.codexDesktopMirror;
    const runtime = getAgentRuntime(config, this.settings);
    this.startedAtMs = Date.now();
    this.mode = runtime.mode;
    this.afterMessageSeq = Number(runtime.afterMessageSeq ?? 0);
    this.primeOnFirstPoll = runtime.afterMessageSeq === undefined;
    this.followedFile = null;
    this.fileOffset = 0;
    this.pendingPartial = "";
  }

  headers() {
    return this.relay?.secret ? { "x-legax-secret": this.relay.secret } : {};
  }

  async send(kind, text, metadata = {}) {
    const event = {
      id: cryptoRandomId(),
      sessionId: this.config.sessionId,
      agentId: this.settings.agentId,
      agentLabel: this.settings.agentLabel,
      source: "codex-desktop-mirror",
      sourceName: this.settings.agentLabel ?? this.config.displayName,
      kind,
      text,
      metadata: {
        agentId: this.settings.agentId,
        agentLabel: this.settings.agentLabel,
        adapter: "codex-desktop-mirror",
        mode: this.mode,
        ...metadata
      },
      createdAt: new Date().toISOString()
    };
    const results = [];
    if (this.relay) {
      try {
        const result = await httpJson(new URL("/api/events", this.relay.baseUrl), {
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
    return event;
  }

  async pollPhone() {
    let rawMessages = [];
    const daemonRouterManaged = process.env.LEGAX_DAEMON_CHILD === "1"
      && process.env.LEGAX_DAEMON_ROUTER === "1";
    if (this.relay && !daemonRouterManaged) {
      try {
        const url = new URL("/api/messages", this.relay.baseUrl);
        url.searchParams.set("sessionId", this.config.sessionId);
        url.searchParams.set("after", String(this.afterMessageSeq));
        url.searchParams.set("agentId", this.settings.agentId);
        const response = await httpJson(url, { headers: this.headers() }, this.relay.timeoutMs);
        rawMessages = response.messages ?? [];
      } catch (error) {
        process.stderr.write(`[legax] ${this.relay.name} poll failed: ${error.message}\n`);
      }
    }
    const inboundMessages = await pollInboundTransports(this.config, this.settings, {
      drainOnly: daemonRouterManaged
    });
    const messages = filterAgentMessages(this.config, this.settings, [...rawMessages, ...inboundMessages]);
    this.config.runtimeMode = applyControlMessages(this.config, this.settings, messages, this.mode);
    this.mode = this.config.runtimeMode;
    const maxSeq = Math.max(this.afterMessageSeq, ...rawMessages.map((m) => Number(m.seq) || 0));
    this.afterMessageSeq = maxSeq;
    setAgentCursor(this.config, this.settings, maxSeq);
    const filtered = this.primeOnFirstPoll ? messagesCreatedAfter(messages, this.startedAtMs) : messages;
    this.primeOnFirstPoll = false;
    return filtered;
  }

  async refuseRemoteMessage(message) {
    // The mirror is read-only by definition; reply with a clear status so the
    // operator does not think the message went into the desktop app.
    if (message.type === "control") return; // mode-set still flows through
    const summary = message.text ? message.text.slice(0, 160) : `(${message.type})`;
    await this.send("status", `Codex desktop mirror is read-only: this adapter cannot inject messages into the running desktop app. Ignored: ${summary}`, {
      orphanIncomingType: message.type
    });
  }
}

function cryptoRandomId() {
  // Avoid pulling node:crypto into the import surface here; uuid-like is fine
  // for event ids that are only used to deduplicate phone-side rendering.
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e10).toString(36)}`;
}

class JsonlTailWatcher {
  constructor(client) {
    this.client = client;
    this.settings = client.settings;
    this.timer = null;
    this.rescanTimer = null;
  }

  start() {
    this.tick();
    this.rescanTimer = setInterval(() => this.rescan(), Number(this.settings.rescanFilesEveryMs ?? 5000));
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    if (this.rescanTimer) clearInterval(this.rescanTimer);
    this.timer = null;
    this.rescanTimer = null;
  }

  async tick() {
    try {
      if (!this.client.followedFile) {
        this.rescan();
      }
      if (this.client.followedFile) {
        await this.consumeAppendedBytes();
      }
      const messages = await this.client.pollPhone();
      for (const message of messages) {
        await this.client.refuseRemoteMessage(message);
      }
    } catch (error) {
      process.stderr.write(`[legax] mirror tick failed: ${error.stack ?? error.message}\n`);
    } finally {
      this.timer = setTimeout(() => this.tick(), Number(this.settings.pollIntervalMs ?? 1500));
    }
  }

  rescan() {
    const root = path.resolve(expandHome(this.settings.sessionsRoot ?? "~/.codex/sessions"));
    const candidates = listRollouts(root);
    if (candidates.length === 0) return;
    const filtered = this.settings.filterToOriginator
      ? candidates.filter((entry) => {
          const meta = readSessionMeta(entry.path);
          return meta && (meta.originator ?? "") === this.settings.filterToOriginator;
        })
      : candidates;
    const target = filtered[0] ?? candidates[0];
    if (!target) return;
    if (this.client.followedFile === target.path) return;
    this.client.followedFile = target.path;
    // Start at end-of-file so we do not replay history. Operator can copy
    // historical lines manually if they need a backfill.
    this.client.fileOffset = target.size;
    this.client.pendingPartial = "";
    process.stderr.write(`[legax] codex-desktop-mirror following ${target.path}\n`);
  }

  async consumeAppendedBytes() {
    let stat;
    try { stat = fs.statSync(this.client.followedFile); }
    catch { this.client.followedFile = null; return; }
    if (stat.size <= this.client.fileOffset) {
      // File rotated / truncated: drop and rescan next tick.
      if (stat.size < this.client.fileOffset) {
        this.client.fileOffset = 0;
        this.client.pendingPartial = "";
      }
      return;
    }
    const fd = fs.openSync(this.client.followedFile, "r");
    try {
      const length = stat.size - this.client.fileOffset;
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, this.client.fileOffset);
      this.client.fileOffset = stat.size;
      const text = this.client.pendingPartial + buf.toString("utf8");
      const lines = text.split("\n");
      this.client.pendingPartial = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        await this.handleEntry(obj);
      }
    } finally {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }

  async handleEntry(entry) {
    const settings = this.settings;
    const type = entry?.type;
    const payload = entry?.payload ?? {};
    if (type === "event_msg") {
      const inner = payload?.type;
      if (inner === "user_message" && settings.forwardUserMessages !== false) {
        await this.client.send("agent_text", String(payload.message ?? ""), {
          turnId: payload.turn_id,
          author: "user",
          source: "codex-desktop-mirror"
        });
      } else if (inner === "agent_message" && settings.forwardAgentMessages !== false) {
        await this.client.send("agent_text", String(payload.message ?? ""), {
          turnId: payload.turn_id,
          author: "assistant",
          phase: payload.phase ?? null
        });
      } else if (inner === "task_complete" && settings.forwardCompletion !== false) {
        const text = payload.last_agent_message
          ? `Turn complete:\n${truncate(payload.last_agent_message, settings.truncateOutputBytes)}`
          : "Turn complete.";
        await this.client.send("status", text, { turnId: payload.turn_id, kind: "task_complete" });
      } else if (inner === "exec_command_end" && settings.forwardCommandRuns !== false) {
        const cmd = Array.isArray(payload.command) ? payload.command.join(" ") : String(payload.command ?? "");
        const status = payload.status ?? (payload.exit_code === 0 ? "success" : "failed");
        const out = truncate(payload.aggregated_output ?? payload.stdout ?? "", settings.truncateOutputBytes);
        await this.client.send("status",
          `exec ${status} (exit=${payload.exit_code ?? "?"}): ${cmd}${out ? `\n${out}` : ""}`,
          { turnId: payload.turn_id, kind: "exec_command_end", exitCode: payload.exit_code });
      } else if (inner === "mcp_tool_call_end" && settings.forwardToolCalls !== false) {
        await this.client.send("status",
          `mcp tool: ${payload.tool ?? payload.name ?? "?"}`,
          { turnId: payload.turn_id, kind: "mcp_tool_call_end" });
      }
    }
    // response_item / turn_context / session_meta are not forwarded — they are
    // either internal model dialogue or bookkeeping. The most user-visible
    // information is already in event_msg.
  }
}

function truncate(text, limit = 1500) {
  const t = String(text ?? "");
  if (limit <= 0) return t;
  if (t.length <= limit) return t;
  return `${t.slice(0, limit)}\n... [truncated ${t.length - limit} bytes]`;
}

async function main() {
  const config = loadConfig();
  if (config.codexDesktopMirror?.enabled === false) {
    process.stderr.write("[legax] codex-desktop-mirror disabled by config; exiting cleanly.\n");
    return;
  }
  if (config.remote?.enabled === false) {
    process.stderr.write("[legax] remote disabled by config; mirror will not forward events.\n");
    return;
  }
  const client = new MirrorClient(config);
  const watcher = new JsonlTailWatcher(client);
  watcher.start();
  await client.send("status", "Codex desktop mirror started (read-only). Watching ~/.codex/sessions for the latest rollout.", {
    sessionsRoot: config.codexDesktopMirror.sessionsRoot
  });
  process.stderr.write("[legax] codex-desktop-mirror is running.\n");
  process.on("SIGINT", () => { watcher.stop(); process.exit(0); });
  process.on("SIGTERM", () => { watcher.stop(); process.exit(0); });
}

main().catch((error) => {
  process.stderr.write(`[legax] ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
