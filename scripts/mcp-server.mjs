#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { buildTelegramMessagePayloads } from "./lib/outbound-transports.mjs";
import { readYaml } from "./lib/yaml.mjs";
import { packageAssetPath, resolveConfigPath, resolveRuntimeFile } from "./lib/paths.mjs";
import { serverInfo } from "./lib/version.mjs";


const SERVER_INFO = serverInfo("legax");

const DEFAULT_CONFIG = {
  sessionId: "default",
  displayName: "Desktop Agent",
  agentId: "mcp-agent",
  agentLabel: "MCP Agent",
  storagePath: "./data/mcp-state.json",
  remote: {
    enabled: true,
    defaultMode: "interactive",
    pauseAll: false
  },
  security: {
    redactByDefault: true,
    redactPatterns: [
      "(?i)(api[_-]?key|token|password|secret)\\s*[:=]\\s*\\S+",
      "sk-[A-Za-z0-9_-]{20,}"
    ]
  },
  transports: [
    {
      name: "self-hosted-relay",
      type: "relay",
      enabled: true,
      baseUrl: "http://127.0.0.1:8787",
      // No secret in defaults — the user must supply transports[].secret in
      // config.yaml; no env fallback exists.
      timeoutMs: 15000
    }
  ]
};

const dispatchResultSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    event: { type: "object", additionalProperties: true },
    results: {
      type: "array",
      items: { type: "object", additionalProperties: true }
    }
  },
  required: ["ok", "event", "results"],
  additionalProperties: true
};

const pollResultSchema = {
  type: "object",
  properties: {
    messages: {
      type: "array",
      items: { type: "object", additionalProperties: true }
    },
    errors: {
      type: "array",
      items: { type: "object", additionalProperties: true }
    }
  },
  required: ["messages", "errors"],
  additionalProperties: false
};

const permissionResultSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    requestId: { type: "string" },
    permission: { type: "object", additionalProperties: true },
    results: {
      type: "array",
      items: { type: "object", additionalProperties: true }
    }
  },
  required: ["ok", "requestId", "results"],
  additionalProperties: true
};

const statusResultSchema = {
  type: "object",
  properties: {
    server: { type: "object", additionalProperties: true },
    config: { type: "object", additionalProperties: true },
    pendingPermissions: {
      type: "array",
      items: { type: "object", additionalProperties: true }
    },
    sentEventCount: { type: "number" },
    receivedMessageCount: { type: "number" },
    pings: {
      type: "array",
      items: { type: "object", additionalProperties: true }
    }
  },
  required: ["server", "config", "pendingPermissions", "sentEventCount", "receivedMessageCount", "pings"],
  additionalProperties: false
};

const TOOLS = [
  {
    name: "legax_send",
    description: "Send an agent message to the configured remote transport(s).",
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Message text to send." },
        kind: {
          type: "string",
          enum: ["agent_text", "status", "system", "permission_request", "user_input_request"],
          default: "agent_text"
        },
        sessionId: { type: "string", description: "Optional bridge session id." },
        agentId: { type: "string", description: "Optional source agent id." },
        metadata: { type: "object", additionalProperties: true },
        allowSensitive: {
          type: "boolean",
          default: false,
          description: "When false, configured redaction patterns are applied before sending."
        }
      },
      required: ["text"],
      additionalProperties: false
    },
    outputSchema: dispatchResultSchema
  },
  {
    name: "legax_poll",
    description: "Poll remote replies and permission decisions from bidirectional transports.",
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        agentId: { type: "string", description: "Optional target agent id to poll." },
        timeoutMs: {
          type: "number",
          default: 0,
          description: "Optional long-poll timeout. 0 means one immediate poll."
        },
        includeRecentHistory: {
          type: "boolean",
          default: false,
          description: "Include recently stored inbound messages in addition to newly fetched replies."
        }
      },
      additionalProperties: false
    },
    outputSchema: pollResultSchema
  },
  {
    name: "legax_request_permission",
    description: "Send a permission request to the phone and optionally wait for an approve/deny reply.",
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short permission title." },
        body: { type: "string", description: "Why approval is needed." },
        command: { type: "string", description: "Optional command or action being requested." },
        risk: {
          type: "string",
          enum: ["low", "medium", "high"],
          default: "medium"
        },
        sessionId: { type: "string" },
        agentId: { type: "string", description: "Optional source/target agent id for this request." },
        timeoutMs: {
          type: "number",
          default: 0,
          description: "If greater than 0, wait this long for a mobile decision."
        },
        allowSensitive: {
          type: "boolean",
          default: false,
          description: "When false, configured redaction patterns are applied before sending."
        }
      },
      required: ["title", "body"],
      additionalProperties: false
    },
    outputSchema: permissionResultSchema
  },
  {
    name: "legax_status",
    description: "Show configured transports and pending permission requests, with secrets redacted.",
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        ping: {
          type: "boolean",
          default: false,
          description: "Ping relay transports when true."
        }
      },
      additionalProperties: false
    },
    outputSchema: statusResultSchema
  }
];

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function loadConfig() {
  const configPath = resolveConfigPath();
  const sourcePath = fs.existsSync(configPath) ? configPath : packageAssetPath("config.example.yaml");
  const raw = readYaml(sourcePath) ?? {};
  return normalizeConfig(raw, configPath, sourcePath);
}

function normalizeConfig(raw, configPath, sourcePath) {
  const mcp = raw.mcp ?? {};
  const config = {
    ...DEFAULT_CONFIG,
    ...raw,
    agentId: raw.agentId ?? mcp.agentId ?? DEFAULT_CONFIG.agentId,
    agentLabel: raw.agentLabel ?? mcp.agentLabel ?? DEFAULT_CONFIG.agentLabel,
    mcp: {
      enabled: true,
      role: "capability",
      ...(raw.mcp ?? {})
    },
    security: {
      ...DEFAULT_CONFIG.security,
      ...(raw.security ?? {})
    },
    remote: {
      ...DEFAULT_CONFIG.remote,
      ...(raw.remote ?? {})
    },
    transports: Array.isArray(raw.transports)
      ? raw.transports
      : DEFAULT_CONFIG.transports
  };
  config.configPath = configPath;
  config.configSourcePath = sourcePath;
  config.storagePath = resolveRuntimeFile(config.storagePath, configPath, "mcp-state.json");
  config.transports = config.transports
    .map((transport, index) => ({
      name: transport.name ?? `${transport.type ?? "transport"}-${index + 1}`,
      enabled: transport.enabled !== false,
      timeoutMs: 15000,
      ...transport
    }))
    .filter((transport) => transport.enabled);
  return config;
}

function loadState(config) {
  return readJson(config.storagePath) ?? {
    version: 1,
    sentEvents: [],
    receivedMessages: [],
    pendingPermissions: {},
    transportState: {}
  };
}

function saveState(config, state) {
  writeJson(config.storagePath, state);
}

function appendBounded(list, item, max = 200) {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

const compiledRedactPatternsCache = new WeakMap();

function compileRedactPatterns(security) {
  const cached = compiledRedactPatternsCache.get(security);
  if (cached) return cached;
  const compiled = [];
  for (const pattern of security.redactPatterns ?? []) {
    try {
      const source = pattern.startsWith("(?i)") ? pattern.slice(4) : pattern;
      const flags = pattern.startsWith("(?i)") ? "gi" : "g";
      compiled.push(new RegExp(source, flags));
    } catch (error) {
      // Surface once at compile time so operators see a broken pattern instead
      // of silently sending unredacted text on every call.
      log(`WARNING: redaction pattern dropped (will not redact): ${pattern} -- ${error.message}`);
    }
  }
  compiledRedactPatternsCache.set(security, compiled);
  return compiled;
}

function redactText(config, text, allowSensitive = false) {
  if (allowSensitive || !config.security?.redactByDefault || typeof text !== "string") {
    return text;
  }
  let output = text;
  for (const regex of compileRedactPatterns(config.security)) {
    output = output.replace(regex, "[REDACTED]");
  }
  return output;
}

function redactValue(value) {
  if (typeof value !== "string") return value;
  if (value.length <= 4) return "***";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function redactConfig(config) {
  return {
    sessionId: config.sessionId,
    displayName: config.displayName,
    configPath: config.configPath,
    storagePath: config.storagePath,
    transports: config.transports.map((transport) => ({
      ...transport,
      botToken: transport.botToken ? redactValue(transport.botToken) : undefined,
      chatId: transport.chatId ? redactValue(String(transport.chatId)) : undefined,
      secret: transport.secret ? redactValue(transport.secret) : undefined
    }))
  };
}

function transportKey(transport) {
  const locator = transport.baseUrl ?? transport.url ?? transport.chatId ?? transport.name;
  return `${transport.type}:${transport.name}:${locator}`;
}

async function httpJson(url, options = {}, timeoutMs = 15000) {
  if (typeof fetch !== "function") {
    throw new Error("This bridge requires Node.js 18+ because it uses global fetch().");
  }
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
    let body = text;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      const detail = typeof body === "string" ? body : JSON.stringify(body);
      throw new Error(`HTTP ${response.status}: ${detail.slice(0, 500)}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function makeEvent(config, input) {
  const allowSensitive = input.allowSensitive === true;
  const text = redactText(config, input.text ?? "", allowSensitive);
  const agentId = input.agentId ?? config.agentId;
  return {
    id: crypto.randomUUID(),
    sessionId: input.sessionId ?? config.sessionId,
    agentId,
    agentLabel: input.agentLabel ?? config.agentLabel ?? agentId,
    source: "agent",
    sourceName: input.agentLabel ?? config.agentLabel ?? config.displayName,
    kind: input.kind ?? "agent_text",
    text,
    metadata: {
      agentId,
      agentLabel: input.agentLabel ?? config.agentLabel ?? agentId,
      ...(input.metadata ?? {})
    },
    createdAt: new Date().toISOString()
  };
}

async function sendViaRelay(transport, event) {
  if (!transport.baseUrl) throw new Error("Relay transport missing baseUrl.");
  const headers = {};
  const secret = transport.secret;
  if (secret) headers["x-legax-secret"] = secret;
  const url = new URL("/api/events", transport.baseUrl);
  return await httpJson(url, {
    method: "POST",
    headers,
    body: JSON.stringify(event)
  }, transport.timeoutMs);
}

function telegramApiUrl(transport, token, method) {
  const baseUrl = String(transport.apiBaseUrl ?? "https://api.telegram.org/bot").replace(/\/+$/, "");
  return `${baseUrl}${token}/${method}`;
}

async function sendViaTelegram(config, transport, event) {
  const token = transport.botToken;
  const chatId = transport.chatId;
  if (!token) throw new Error("Telegram transport missing bot token.");
  if (!chatId) throw new Error("Telegram transport missing chat id.");
  const url = telegramApiUrl(transport, token, "sendMessage");
  const payloads = buildTelegramMessagePayloads(config, transport, event);
  if (payloads.length === 0) return { skipped: true, reason: "message_detail" };
  const results = [];
  for (const payload of payloads) {
    results.push(await httpJson(url, {
      method: "POST",
      body: JSON.stringify(payload)
    }, transport.timeoutMs));
  }
  return { messageCount: payloads.length, results };
}

async function sendViaWebhook(transport, event) {
  const url = transport.url;
  if (!url) throw new Error("Webhook transport missing URL.");
  const secret = transport.secret;
  const headers = {
    ...(transport.headers ?? {})
  };
  if (secret) headers["x-legax-secret"] = secret;
  return await httpJson(url, {
    method: transport.method ?? "POST",
    headers,
    body: JSON.stringify(event)
  }, transport.timeoutMs);
}

async function dispatchEvent(config, state, event) {
  if (config.remote?.enabled === false) {
    return [{ transport: "remote", type: "disabled", ok: false, error: "Legax remote control disabled by config." }];
  }
  const results = [];
  for (const transport of config.transports) {
    try {
      let result;
      if (transport.type === "relay") result = await sendViaRelay(transport, event);
      else if (transport.type === "telegram") result = await sendViaTelegram(config, transport, event);
      else if (transport.type === "webhook") result = await sendViaWebhook(transport, event);
      else throw new Error(`Unsupported transport type: ${transport.type}`);
      results.push({ transport: transport.name, type: transport.type, ok: true, result });
    } catch (error) {
      results.push({ transport: transport.name, type: transport.type, ok: false, error: error.message });
    }
  }
  appendBounded(state.sentEvents, {
    id: event.id,
    kind: event.kind,
    text: event.text,
    sessionId: event.sessionId,
    createdAt: event.createdAt,
    results
  });
  return results;
}

function normalizeRelayMessage(raw, transportName) {
  return {
    id: raw.id ?? `relay:${raw.seq}`,
    transport: transportName,
    sessionId: raw.sessionId,
    type: raw.type ?? "text",
    text: raw.text ?? "",
    requestId: raw.requestId,
    decision: raw.decision,
    targetAgentId: raw.targetAgentId,
    raw,
    receivedAt: raw.createdAt ?? new Date().toISOString()
  };
}

async function pollRelay(config, state, transport, sessionId, agentId) {
  if (!transport.baseUrl) throw new Error("Relay transport missing baseUrl.");
  const key = `${transportKey(transport)}:${sessionId}:${agentId ?? ""}`;
  const transportState = state.transportState[key] ?? {};
  const after = transportState.afterMessageSeq ?? 0;
  const url = new URL("/api/messages", transport.baseUrl);
  url.searchParams.set("sessionId", sessionId);
  url.searchParams.set("after", String(after));
  if (agentId) url.searchParams.set("agentId", agentId);
  const headers = {};
  const secret = transport.secret;
  if (secret) headers["x-legax-secret"] = secret;
  const response = await httpJson(url, { headers }, transport.timeoutMs);
  const messages = (response.messages ?? []).map((message) => normalizeRelayMessage(message, transport.name));
  const maxSeq = Math.max(after, ...((response.messages ?? []).map((message) => Number(message.seq) || 0)));
  state.transportState[key] = { ...transportState, afterMessageSeq: maxSeq };
  return messages;
}

function parseTelegramText(text, updateId, transportName) {
  const trimmed = text.trim();
  const approve = trimmed.match(/^\/approve(?:@\w+)?\s+([A-Za-z0-9_-]+)/i);
  if (approve) {
    return {
      id: `telegram:${updateId}`,
      transport: transportName,
      type: "permission_decision",
      requestId: approve[1],
      decision: "approve",
      text: trimmed,
      receivedAt: new Date().toISOString()
    };
  }
  const deny = trimmed.match(/^\/deny(?:@\w+)?\s+([A-Za-z0-9_-]+)/i);
  if (deny) {
    return {
      id: `telegram:${updateId}`,
      transport: transportName,
      type: "permission_decision",
      requestId: deny[1],
      decision: "deny",
      text: trimmed,
      receivedAt: new Date().toISOString()
    };
  }
  return {
    id: `telegram:${updateId}`,
    transport: transportName,
    type: "text",
    text: trimmed,
    receivedAt: new Date().toISOString()
  };
}

async function pollTelegram(state, transport) {
  const token = transport.botToken;
  const chatId = transport.chatId;
  if (!token) throw new Error("Telegram transport missing bot token.");
  if (!chatId) throw new Error("Telegram transport missing chat id.");
  const key = transportKey(transport);
  const transportState = state.transportState[key] ?? {};
  const url = telegramApiUrl(transport, token, "getUpdates");
  const response = await httpJson(url, {
    method: "POST",
    body: JSON.stringify({
      offset: transportState.offset ?? undefined,
      timeout: 0,
      limit: 20,
      allowed_updates: ["message"]
    })
  }, transport.timeoutMs);
  const updates = Array.isArray(response.result) ? response.result : [];
  const messages = [];
  for (const update of updates) {
    state.transportState[key] = {
      ...transportState,
      offset: Number(update.update_id) + 1
    };
    const message = update.message;
    if (!message?.text) continue;
    if (String(message.chat?.id) !== String(chatId)) continue;
    messages.push(parseTelegramText(message.text, update.update_id, transport.name));
  }
  return messages;
}

function storeInboundMessage(state, message) {
  if (state.receivedMessages.some((existing) => existing.id === message.id)) {
    return false;
  }
  appendBounded(state.receivedMessages, message);
  if (message.type === "permission_decision" && message.requestId) {
    const pending = state.pendingPermissions[message.requestId];
    if (pending) {
      pending.status = message.decision === "approve" ? "approved" : "denied";
      pending.decision = message.decision;
      pending.decidedAt = new Date().toISOString();
      pending.decidedBy = message.transport;
    }
  }
  return true;
}

async function pollInbound(config, state, sessionId, agentId = config.agentId) {
  const messages = [];
  const errors = [];
  for (const transport of config.transports) {
    if (!["relay", "telegram"].includes(transport.type)) continue;
    try {
      const fetched = transport.type === "relay"
        ? await pollRelay(config, state, transport, sessionId, agentId)
        : await pollTelegram(state, transport);
      for (const message of fetched) {
        if (storeInboundMessage(state, message)) messages.push(message);
      }
    } catch (error) {
      errors.push({ transport: transport.name, type: transport.type, error: error.message });
    }
  }
  return { messages, errors };
}

async function toolSend(args) {
  const config = loadConfig();
  const state = loadState(config);
  const event = makeEvent(config, args);
  const results = await dispatchEvent(config, state, event);
  saveState(config, state);
  return { ok: results.some((result) => result.ok), event, results };
}

async function toolPoll(args) {
  const config = loadConfig();
  const state = loadState(config);
  const sessionId = args.sessionId ?? config.sessionId;
  const agentId = args.agentId ?? config.agentId;
  const timeoutMs = Math.max(0, Number(args.timeoutMs ?? 0));
  const deadline = Date.now() + timeoutMs;
  let aggregate = { messages: [], errors: [] };
  do {
    const current = await pollInbound(config, state, sessionId, agentId);
    aggregate.messages.push(...current.messages);
    aggregate.errors.push(...current.errors);
    if (aggregate.messages.length || timeoutMs === 0) break;
    await sleep(1200);
  } while (Date.now() < deadline);
  saveState(config, state);
  if (args.includeRecentHistory) {
    const recent = state.receivedMessages.slice(-20);
    const known = new Set(aggregate.messages.map((message) => message.id));
    aggregate.messages = [
      ...recent.filter((message) => !known.has(message.id)),
      ...aggregate.messages
    ];
  }
  return aggregate;
}

async function toolRequestPermission(args) {
  const config = loadConfig();
  const state = loadState(config);
  const requestId = crypto.randomUUID();
  const allowSensitive = args.allowSensitive === true;
  const command = args.command ? redactText(config, args.command, allowSensitive) : undefined;
  const body = redactText(config, args.body, allowSensitive);
  const event = makeEvent(config, {
    kind: "permission_request",
    text: body,
    sessionId: args.sessionId,
    agentId: args.agentId,
    allowSensitive: true,
    metadata: {
      requestId,
      title: redactText(config, args.title, allowSensitive),
      command,
      risk: args.risk ?? "medium",
      choices: ["approve", "deny"]
    }
  });
  state.pendingPermissions[requestId] = {
    requestId,
    status: "pending",
    title: event.metadata.title,
    command,
    risk: event.metadata.risk,
    createdAt: event.createdAt
  };
  const results = await dispatchEvent(config, state, event);
  const timeoutMs = Math.max(0, Number(args.timeoutMs ?? 0));
  if (timeoutMs > 0) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const pending = state.pendingPermissions[requestId];
      if (pending?.status === "approved" || pending?.status === "denied") break;
      await pollInbound(config, state, event.sessionId, event.agentId);
      await sleep(1200);
    }
  }
  saveState(config, state);
  return {
    ok: results.some((result) => result.ok),
    requestId,
    permission: state.pendingPermissions[requestId],
    results
  };
}

async function toolStatus(args) {
  const config = loadConfig();
  const state = loadState(config);
  const status = {
    server: SERVER_INFO,
    config: redactConfig(config),
    pendingPermissions: Object.values(state.pendingPermissions).filter((item) => item.status === "pending"),
    sentEventCount: state.sentEvents.length,
    receivedMessageCount: state.receivedMessages.length,
    pings: []
  };
  if (args.ping) {
    for (const transport of config.transports) {
      if (transport.type !== "relay" || !transport.baseUrl) continue;
      try {
        const url = new URL("/health", transport.baseUrl);
        const result = await httpJson(url, {}, transport.timeoutMs);
        status.pings.push({ transport: transport.name, ok: true, result });
      } catch (error) {
        status.pings.push({ transport: transport.name, ok: false, error: error.message });
      }
    }
  }
  return status;
}

async function callTool(name, args = {}) {
  if (name === "legax_send") return await toolSend(args);
  if (name === "legax_poll") return await toolPoll(args);
  if (name === "legax_request_permission") return await toolRequestPermission(args);
  if (name === "legax_status") return await toolStatus(args);
  throw new Error(`Unknown tool: ${name}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendRpc(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  sendRpc({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  sendRpc({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleRpc(message) {
  if (!message || typeof message !== "object") return;
  const { id, method, params } = message;
  try {
    if (method === "initialize") {
      sendResult(id, {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        },
        serverInfo: SERVER_INFO
      });
      return;
    }
    if (method === "notifications/initialized") return;
    if (method === "initialized") return;
    if (method === "notifications/cancelled") return;
    if (method === "ping") {
      sendResult(id, {});
      return;
    }
    if (method === "tools/list") {
      sendResult(id, { tools: TOOLS });
      return;
    }
    if (method === "resources/list") {
      sendResult(id, { resources: [] });
      return;
    }
    if (method === "resources/templates/list") {
      sendResult(id, { resourceTemplates: [] });
      return;
    }
    if (method === "prompts/list") {
      sendResult(id, { prompts: [] });
      return;
    }
    if (method === "tools/call") {
      const result = await callTool(params?.name, params?.arguments ?? {});
      sendResult(id, {
        structuredContent: result,
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      });
      return;
    }
    if (id !== undefined) sendError(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    if (id !== undefined) sendError(id, -32000, error?.message ?? String(error));
  }
}

function log(message) {
  process.stderr.write(`[legax] ${message}\n`);
}

async function runCliMode() {
  const args = process.argv.slice(2);
  if (!args.includes("--status") && !args.includes("--send-test")) return false;
  if (args.includes("--status")) {
    const status = await toolStatus({ ping: args.includes("--ping") });
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return true;
  }
  const index = args.indexOf("--send-test");
  const text = args[index + 1] ?? "Legax test message";
  const result = await toolSend({ text, kind: "status" });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return true;
}

if (!(await runCliMode())) {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      try {
        void handleRpc(JSON.parse(line));
      } catch (error) {
        log(`Invalid JSON-RPC message: ${error.message}`);
      }
    }
  });
}

process.on("uncaughtException", (error) => {
  log(`Uncaught exception: ${error.stack ?? error.message}`);
});

process.on("unhandledRejection", (error) => {
  log(`Unhandled rejection: ${error?.stack ?? error}`);
});
