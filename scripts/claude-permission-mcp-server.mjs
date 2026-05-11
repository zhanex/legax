#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import {
  applyControlMessages,
  canAcceptApproval as runtimeCanAcceptApproval,
  filterAgentMessages,
  getAgentRuntime,
  normalizeApprovals,
  timeoutDecision
} from "./lib/runtime-state.mjs";
import { pollInboundTransports } from "./lib/inbound-transports.mjs";
import { dispatchAdditionalTransports } from "./lib/outbound-transports.mjs";
import { readYaml } from "./lib/yaml.mjs";
import { packageAssetPath, resolveConfigPath, resolveRuntimeFile } from "./lib/paths.mjs";


const SERVER_INFO = {
  name: "legax-claude-permissions",
  version: "0.0.2"
};

const TOOLS = [
  {
    name: "approval_prompt",
    description: "Ask the phone to approve or deny a Claude Code permission request.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: true
    }
  }
];

function loadConfig() {
  const configPath = resolveConfigPath();
  const sourcePath = fs.existsSync(configPath) ? configPath : packageAssetPath("config.example.yaml");
  const raw = readYaml(sourcePath) ?? {};
  const remote = {
    enabled: true,
    defaultMode: "interactive",
    pauseAll: false,
    ...(raw.remote ?? {})
  };
  const approvals = normalizeApprovals(raw.approvals);
  const claudeRaw = raw.claude ?? {};
  const config = {
    sessionId: raw.sessionId ?? "default",
    displayName: raw.displayName ?? "Desktop Agent",
    configPath,
    configSourcePath: sourcePath,
    runtimeStatePath: resolveRuntimeFile(raw.runtimeStatePath, configPath, "runtime-state.json"),
    remote,
    approvals,
    routing: raw.routing ?? {},
    transports: Array.isArray(raw.transports) ? raw.transports : [],
    claudeCode: {
      agentId: "claude-code",
      agentLabel: "Claude Code",
      cliBackend: "stream-json",
      mcpEnabled: true,
      mcpRole: "permission-prompt",
      mode: remote.defaultMode,
      approvalTimeoutMs: 300000,
      permissionBehaviorOnApprove: "allow",
      permissionBehaviorOnDeny: "deny",
      ...claudeRaw
    }
  };
  const runtime = getAgentRuntime(config, config.claudeCode);
  config.runtimeMode = runtime.mode;
  return config;
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
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function approvalPrompt(args) {
  const config = loadConfig();
  const relay = selectRelay(config);
  const requestId = `claude-${crypto.randomUUID()}`;
  const headers = relay?.secret ? { "x-legax-secret": relay.secret } : {};
  const text = formatPermissionRequest(args);
  const event = {
    id: crypto.randomUUID(),
    sessionId: config.sessionId,
    agentId: config.claudeCode.agentId,
    agentLabel: config.claudeCode.agentLabel,
    taskId: config.claudeCode.taskId,
    source: "claude-code",
    sourceName: config.claudeCode.agentLabel ?? config.displayName,
    kind: "permission_request",
    text,
    metadata: {
      agentId: config.claudeCode.agentId,
      agentLabel: config.claudeCode.agentLabel,
      taskId: config.claudeCode.taskId,
      mode: config.runtimeMode ?? config.claudeCode.mode,
      requestId,
      adapter: "claude-code",
      title: "Claude Code permission request",
      raw: args,
      choices: ["approve", "deny"]
    },
    createdAt: new Date().toISOString()
  };
  const results = [];
  if (relay) {
    try {
      const result = await httpJson(new URL("/api/events", relay.baseUrl), {
        method: "POST",
        headers,
        body: JSON.stringify(event)
      }, relay.timeoutMs);
      results.push({ transport: relay.name, type: "relay", ok: true, result });
    } catch (error) {
      results.push({ transport: relay.name, type: "relay", ok: false, error: error.message });
    }
  }
  results.push(...await dispatchAdditionalTransports(config, event, relay?.name));
  if (results.length && !results.some((result) => result.ok)) {
    throw new Error(`All outbound transports failed: ${results.map((result) => `${result.transport}: ${result.error}`).join("; ")}`);
  }

  const decision = await waitForDecision(config, relay, headers, requestId);
  const behavior = decision === "approve"
    ? config.claudeCode.permissionBehaviorOnApprove
    : config.claudeCode.permissionBehaviorOnDeny;
  return {
    behavior,
    message: decision === "approve" ? "Approved from Legax" : "Denied from Legax"
  };
}

async function waitForDecision(config, relay, headers, requestId) {
  if (!refreshApprovalMode(config)) return timeoutDecision(config);
  const timeoutMs = Number(config.claudeCode.approvalTimeoutMs ?? config.approvals?.timeoutMs ?? 300000);
  const deadline = Date.now() + timeoutMs;
  let after = 0;
  while (Date.now() < deadline) {
    let rawMessages = [];
    const daemonRouterManaged = process.env.LEGAX_DAEMON_CHILD === "1"
      && process.env.LEGAX_DAEMON_ROUTER === "1";
    if (relay && !daemonRouterManaged) {
      try {
        const url = new URL("/api/messages", relay.baseUrl);
        url.searchParams.set("sessionId", config.sessionId);
        url.searchParams.set("after", String(after));
        url.searchParams.set("agentId", config.claudeCode.agentId);
        if (config.claudeCode.taskId) url.searchParams.set("taskId", config.claudeCode.taskId);
        const response = await httpJson(url, { headers }, relay.timeoutMs);
        rawMessages = response.messages ?? [];
        after = Math.max(after, ...rawMessages.map((message) => Number(message.seq) || 0));
      } catch (error) {
        process.stderr.write(`[legax] ${relay.name} permission poll failed: ${error.message}\n`);
      }
    }
    const inboundMessages = await pollInboundTransports(config, config.claudeCode, {
      drainOnly: daemonRouterManaged
    });
    const messages = filterAgentMessages(config, config.claudeCode, [...rawMessages, ...inboundMessages]);
    config.runtimeMode = applyControlMessages(config, config.claudeCode, messages, config.runtimeMode);
    if (!refreshApprovalMode(config)) return timeoutDecision(config);
    for (const message of messages) {
      if (message.type === "permission_decision" && message.requestId === requestId) {
        return message.decision === "approve" ? "approve" : "deny";
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return timeoutDecision(config);
}

function refreshApprovalMode(config) {
  const runtime = getAgentRuntime(config, config.claudeCode);
  config.runtimeMode = runtime.mode;
  return runtimeCanAcceptApproval(config, config.runtimeMode);
}

function formatPermissionRequest(args) {
  const toolName = args.tool_name ?? args.toolName ?? args.tool ?? args.name ?? "unknown tool";
  const toolInput = args.tool_input ?? args.toolInput ?? args.input ?? args.arguments ?? {};
  return [
    "Claude Code permission requested.",
    `Tool: ${toolName}`,
    args.reason ? `Reason: ${args.reason}` : null,
    `Input: ${JSON.stringify(toolInput, null, 2)}`
  ].filter(Boolean).join("\n");
}

async function callTool(name, args = {}) {
  if (name !== "approval_prompt") throw new Error(`Unknown tool: ${name}`);
  return await approvalPrompt(args);
}

function sendRpc(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

async function handleRpc(message) {
  const { id, method, params } = message;
  try {
    if (method === "initialize") {
      sendRpc({ id, result: { protocolVersion: params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: SERVER_INFO } });
      return;
    }
    if (method === "notifications/initialized") return;
    if (method === "ping") {
      sendRpc({ id, result: {} });
      return;
    }
    if (method === "tools/list") {
      sendRpc({ id, result: { tools: TOOLS } });
      return;
    }
    if (method === "tools/call") {
      const result = await callTool(params?.name, params?.arguments ?? {});
      sendRpc({ id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
      return;
    }
    if (id !== undefined) sendRpc({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (error) {
    if (id !== undefined) sendRpc({ id, error: { code: -32000, message: error?.message ?? String(error) } });
  }
}

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
      process.stderr.write(`[legax] invalid JSON-RPC message: ${error.message}\n`);
    }
  }
});
