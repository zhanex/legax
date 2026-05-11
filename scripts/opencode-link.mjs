#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { pollInboundTransports } from "./lib/inbound-transports.mjs";
import { dispatchAdditionalTransports } from "./lib/outbound-transports.mjs";
import {
  applyControlMessages,
  activateAgentInteractive,
  canAcceptText as runtimeCanAcceptText,
  filterAgentMessages,
  getAgentRuntime,
  getAgentThreadSelection,
  messagesCreatedAfter,
  normalizeApprovals,
  setAgentCursor,
  setAgentMode,
  setAgentThreadSelection
} from "./lib/runtime-state.mjs";
import { readYaml } from "./lib/yaml.mjs";
import {
  buildProjectChoices,
  filterActiveItems,
  filterItemsByProject,
  formatPageLine,
  formatProjectList,
  hierarchyRows,
  normalizePage,
  paginateItems,
  projectsReplyMarkup,
  resolveProjectChoice
} from "./lib/menu-groups.mjs";
import { packageAssetPath, resolveConfigPath, resolveConfigRelative, resolveRuntimeFile } from "./lib/paths.mjs";

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
  const opencodeRaw = raw.opencode ?? {};
  const opencode = {
    enabled: opencodeRaw.enabled ?? true,
    autoStart: opencodeRaw.autoStart ?? false,
    agentId: opencodeRaw.agentId ?? "opencode",
    agentLabel: opencodeRaw.agentLabel ?? "OpenCode",
    supportsSessions: opencodeRaw.supportsSessions ?? true,
    cliBackend: opencodeRaw.cliBackend ?? "server-http",
    mcpEnabled: opencodeRaw.mcpEnabled ?? false,
    mode: opencodeRaw.mode ?? remote.defaultMode,
    command: opencodeRaw.command ?? "opencode",
    args: Array.isArray(opencodeRaw.args) ? opencodeRaw.args : [],
    serveArgs: Array.isArray(opencodeRaw.serveArgs) ? opencodeRaw.serveArgs : [],
    cwd: opencodeRaw.cwd ?? ".",
    serverUrl: String(opencodeRaw.serverUrl ?? "http://127.0.0.1:4096").replace(/\/+$/, ""),
    serverMode: opencodeRaw.serverMode ?? "connect-or-start",
    serverUsername: opencodeRaw.serverUsername ?? "opencode",
    serverPassword: opencodeRaw.serverPassword ?? "",
    startupTimeoutMs: opencodeRaw.startupTimeoutMs ?? 15000,
    timeoutMs: opencodeRaw.timeoutMs ?? 30000,
    pollIntervalMs: opencodeRaw.pollIntervalMs ?? 1200,
    sessionListLimit: opencodeRaw.sessionListLimit ?? 100,
    sessionPageSize: opencodeRaw.sessionPageSize ?? 10,
    sessionHistoryOnSelectLimit: opencodeRaw.sessionHistoryOnSelectLimit ?? 1,
    useExisting: opencodeRaw.useExisting ?? true,
    sessionId: opencodeRaw.sessionId ?? "",
    title: opencodeRaw.title ?? "",
    model: opencodeRaw.model ?? "",
    agent: opencodeRaw.agent ?? "",
    forwardMessageEvents: opencodeRaw.forwardMessageEvents ?? true,
    forwardStatusEvents: opencodeRaw.forwardStatusEvents ?? true,
    ...opencodeRaw
  };
  return {
    ...raw,
    sessionId: raw.sessionId ?? "default",
    displayName: raw.displayName ?? "Desktop Agent",
    configPath,
    configSourcePath: sourcePath,
    runtimeStatePath: resolveRuntimeFile(raw.runtimeStatePath, configPath, "runtime-state.json"),
    remote,
    approvals,
    routing: raw.routing ?? {},
    transports: Array.isArray(raw.transports) ? raw.transports : [],
    opencode
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

function openCodeHeaders(settings) {
  if (!settings.serverPassword) return {};
  const username = settings.serverUsername || "opencode";
  const encoded = Buffer.from(`${username}:${settings.serverPassword}`).toString("base64");
  return { authorization: `Basic ${encoded}` };
}

function openCodeUrl(settings, pathname) {
  const url = new URL(pathname, `${settings.serverUrl.replace(/\/+$/, "")}/`);
  return url;
}

async function openCodeJson(settings, pathname, options = {}, timeoutMs = Number(settings.timeoutMs ?? 30000)) {
  return await httpJson(openCodeUrl(settings, pathname), {
    ...options,
    headers: {
      ...openCodeHeaders(settings),
      ...(options.headers ?? {})
    }
  }, timeoutMs);
}

function normalizeMode(value) {
  const mode = String(value ?? "interactive").trim();
  if (mode === "monitor" || mode === "approval-only" || mode === "paused") return mode;
  return "interactive";
}

function sessionHistoryOnSelectLimit(settings) {
  const value = Number(settings.sessionHistoryOnSelectLimit ?? settings.sessionSelectHistoryLimit ?? 1);
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(20, Math.floor(value)));
}

function normalizeListResponse(body, key = "sessions") {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.[key])) return body[key];
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.messages)) return body.messages;
  return [];
}

function valueAtPath(object, key) {
  let current = object;
  for (const part of String(key).split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function firstString(object, keys) {
  for (const key of keys) {
    const value = valueAtPath(object, key);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function normalizeOpenCodeSession(row, index = 0) {
  const id = firstString(row, ["id", "sessionID", "sessionId", "uuid"]);
  if (!id) return null;
  const cwd = firstString(row, [
    "cwd",
    "directory",
    "path",
    "projectPath",
    "workspacePath",
    "project.path",
    "metadata.cwd",
    "metadata.projectPath",
    "metadata.workspacePath"
  ]);
  const title = firstString(row, ["title", "name", "summary", "metadata.title", "metadata.name"]);
  return {
    ...row,
    id,
    resumeRef: id,
    name: trimOneLine(title || `OpenCode session ${index + 1}`, 80),
    preview: trimOneLine(firstString(row, ["preview", "message", "prompt", "metadata.preview"]) || title, 120),
    cwd,
    projectPath: cwd,
    updatedAt: row.updatedAt ?? row.time?.updated ?? row.metadata?.updatedAt,
    createdAt: row.createdAt ?? row.time?.created ?? row.metadata?.createdAt,
    archived: row.archived ?? row.isArchived ?? row.metadata?.archived,
    archivedAt: row.archivedAt ?? row.metadata?.archivedAt,
    source: "opencode"
  };
}

async function listOpenCodeSessions(settings) {
  const body = await openCodeJson(settings, "/session");
  const limit = Math.max(1, Math.floor(Number(settings.sessionListLimit ?? 100)));
  return filterActiveItems(normalizeListResponse(body)
    .map((row, index) => normalizeOpenCodeSession(row, index))
    .filter(Boolean))
    .slice(0, limit);
}

function textFromPart(part) {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  if (part.type && !["text", "markdown"].includes(String(part.type))) return "";
  return String(part.text ?? part.content ?? part.markdown ?? "");
}

function openCodeMessageText(message) {
  if (typeof message === "string") return message.trim();
  const parts = message.parts ?? message.message?.parts ?? message.data?.parts;
  if (Array.isArray(parts)) {
    return parts.map(textFromPart).filter(Boolean).join("\n").trim();
  }
  const content = message.content ?? message.text ?? message.message?.content ?? message.info?.content;
  if (Array.isArray(content)) {
    return content.map(textFromPart).filter(Boolean).join("\n").trim();
  }
  return typeof content === "string" ? content.trim() : "";
}

function openCodeMessageRole(message) {
  return String(
    message.info?.role
      ?? message.role
      ?? message.author
      ?? message.message?.role
      ?? message.data?.role
      ?? ""
  ).toLowerCase();
}

function normalizeOpenCodeHistoryItem(message) {
  const text = openCodeMessageText(message);
  if (!text) return null;
  const role = openCodeMessageRole(message);
  if (role.includes("user") || role.includes("human")) return { author: "user", text };
  if (role.includes("assistant") || role.includes("agent") || role.includes("model")) return { author: "agent", text };
  return { author: "agent", text };
}

async function openCodeMessageHistoryItems(settings, session, limit) {
  if (limit <= 0) return [];
  const url = new URL(`/session/${encodeURIComponent(session.id)}/message`, `${settings.serverUrl}/`);
  url.searchParams.set("limit", String(limit));
  const body = await httpJson(url, { headers: openCodeHeaders(settings) }, Number(settings.timeoutMs ?? 30000));
  return normalizeListResponse(body, "messages")
    .map(normalizeOpenCodeHistoryItem)
    .filter(Boolean)
    .slice(-limit);
}

function openCodeResponseItems(body) {
  const rows = Array.isArray(body) ? body : [body];
  return rows.map(normalizeOpenCodeHistoryItem)
    .filter((item) => item?.text && item.author === "agent");
}

function buildOpenCodeMessageBody(settings, prompt) {
  const body = {
    parts: [
      {
        type: "text",
        text: prompt
      }
    ]
  };
  if (settings.model) body.model = String(settings.model);
  if (settings.agent) body.agent = String(settings.agent);
  return body;
}

async function createOpenCodeSession(settings, prompt) {
  const title = trimOneLine(settings.title || prompt || "Legax remote session", 80);
  const body = await openCodeJson(settings, "/session", {
    method: "POST",
    body: JSON.stringify({ title })
  });
  const session = normalizeOpenCodeSession(body, 0);
  if (!session?.id) throw new Error("OpenCode server did not return a session id.");
  if (!session.cwd && settings.cwd) session.cwd = resolveFromCwd(settings.cwd);
  return session;
}

async function sendOpenCodeMessage(settings, sessionId, prompt) {
  return await openCodeJson(settings, `/session/${encodeURIComponent(sessionId)}/message`, {
    method: "POST",
    body: JSON.stringify(buildOpenCodeMessageBody(settings, prompt))
  });
}

function selectedThreadMetadata(config, settings) {
  const selection = getAgentThreadSelection(config, settings);
  if (!selection.selectedThreadId) return {};
  return {
    threadId: selection.selectedThreadId,
    threadTitle: selection.selectedThread?.name ?? selection.selectedThread?.preview,
    threadName: selection.selectedThread?.name
  };
}

function formatSessionList(label, sessions, activeSessionId, project, pagination) {
  return [
    project ? `Choose a ${label} session in ${project.label}:` : `Choose a ${label} session:`,
    formatPageLine(pagination),
    ...sessions.map((session, index) => {
      const active = session.id === activeSessionId || session.resumeRef === activeSessionId ? " *" : "";
      const title = session.name ?? session.preview ?? shortId(session.id);
      const when = session.updatedAt ? ` (${formatDateTime(session.updatedAt)})` : "";
      return `${index + 1}. ${title}${when} [${shortId(session.id)}]${active}`;
    })
  ].filter(Boolean).join("\n");
}

const OPENCODE_PROJECT_OPTIONS = {
  defaultKey: "opencode-current-project",
  defaultLabel: "Current project",
  keyKeys: ["projectId", "workspaceId", "metadata.projectId", "metadata.workspaceId", "project.id"],
  pathKeys: ["cwd", "directory", "path", "projectPath", "workspacePath", "metadata.cwd", "metadata.projectPath", "metadata.workspacePath", "project.path"],
  labelKeys: ["projectName", "workspaceName", "metadata.projectName", "metadata.workspaceName", "project.name"]
};

function projectPageCallback(encodedAgent, projectRef, page) {
  return `legax:project:${encodedAgent}:${encodeURIComponent(projectRef)}:${normalizePage(page)}`;
}

function sessionsReplyMarkup(agentId, sessions, { newText = "New session", refreshText = "Refresh sessions", projectRef, pagination } = {}) {
  const encodedAgent = encodeURIComponent(agentId);
  const rows = sessions.map((session, index) => {
    const callbackData = `legax:session:${encodedAgent}:${encodeURIComponent(session.id)}`;
    return [{
      text: `${index + 1}. ${buttonTitle(session.name ?? session.preview ?? session.id)}`,
      callback_data: callbackData.length <= 64 ? callbackData : `legax:session:${encodedAgent}:${index + 1}`
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
      text: refreshText,
      callback_data: projectRef
        ? projectPageCallback(encodedAgent, projectRef, pagination?.page ?? 1)
        : `legax:sessions:${encodedAgent}`
    },
    { text: newText, callback_data: `legax:new:${encodedAgent}` }
  ]);
  rows.push(...hierarchyRows(agentId, { level: "session", projectRef }));
  return { inline_keyboard: rows };
}

function selectedSessionReplyMarkup(agentId) {
  const encodedAgent = encodeURIComponent(agentId);
  return {
    inline_keyboard: [
      [{ text: "New session", callback_data: `legax:new:${encodedAgent}` }],
      ...hierarchyRows(agentId, { level: "session" })
    ]
  };
}

function buttonTitle(value) {
  return trimOneLine(value || "Session", 34);
}

function trimOneLine(value, limit = 80) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}...`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function shortId(value) {
  const text = String(value ?? "");
  return text.length <= 8 ? text : text.slice(0, 8);
}

class RelayClient {
  constructor(config) {
    this.config = config;
    this.relay = selectRelay(config);
    const runtime = getAgentRuntime(config, config.opencode);
    this.startedAtMs = Date.now();
    this.afterMessageSeq = Number(runtime.afterMessageSeq ?? 0);
    this.primeOnFirstPoll = runtime.afterMessageSeq === undefined;
    this.config.runtimeMode = runtime.mode;
  }

  headers() {
    return this.relay?.secret ? { "x-legax-secret": this.relay.secret } : {};
  }

  async send(kind, text, metadata = {}) {
    const settings = this.config.opencode;
    const event = {
      id: crypto.randomUUID(),
      sessionId: this.config.sessionId,
      agentId: settings.agentId,
      agentLabel: settings.agentLabel,
      taskId: settings.taskId,
      source: "opencode",
      sourceName: settings.agentLabel ?? this.config.displayName,
      kind,
      text,
      metadata: {
        agentId: settings.agentId,
        agentLabel: settings.agentLabel,
        taskId: settings.taskId,
        mode: this.config.runtimeMode ?? settings.mode,
        ...selectedThreadMetadata(this.config, settings),
        ...metadata
      },
      createdAt: new Date().toISOString()
    };
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
        url.searchParams.set("agentId", this.config.opencode.agentId);
        if (this.config.opencode.taskId) url.searchParams.set("taskId", this.config.opencode.taskId);
        const response = await httpJson(url, { headers: this.headers() }, this.relay.timeoutMs);
        rawMessages = response.messages ?? [];
      } catch (error) {
        process.stderr.write(`[legax] ${this.relay.name} poll failed: ${error.message}\n`);
      }
    }
    const inboundMessages = await pollInboundTransports(this.config, this.config.opencode, {
      drainOnly: daemonRouterManaged
    });
    const messages = filterAgentMessages(this.config, this.config.opencode, [...rawMessages, ...inboundMessages]);
    this.config.runtimeMode = applyControlMessages(this.config, this.config.opencode, messages, this.config.runtimeMode);
    const maxSeq = Math.max(this.afterMessageSeq, ...rawMessages.map((message) => Number(message.seq) || 0));
    this.afterMessageSeq = maxSeq;
    setAgentCursor(this.config, this.config.opencode, maxSeq);
    if (this.primeOnFirstPoll) {
      this.primeOnFirstPoll = false;
      return messagesCreatedAfter(messages, this.startedAtMs);
    }
    return messages;
  }
}

class OpenCodeLink {
  constructor(config) {
    this.config = config;
    this.relay = new RelayClient(config);
    this.queue = [];
    this.running = false;
    this.polling = false;
    this.sessionChoices = [];
    this.projectChoices = [];
    this.serverProcess = null;
    this.mode = config.runtimeMode ?? normalizeMode(config.opencode.mode ?? config.remote?.defaultMode);
    this.config.runtimeMode = this.mode;
    const selection = getAgentThreadSelection(this.config, this.config.opencode);
    if (selection.selectedThreadId) {
      this.config.opencode.useExisting = true;
      this.config.opencode.sessionId = selection.selectedThreadId;
    }
  }

  async start() {
    const availability = await this.ensureServerAvailable();
    await this.relay.send("status", availability.ok
      ? "OpenCode link connected. Choose a session or send a message from the phone."
      : `OpenCode server unavailable: ${availability.error}. Start OpenCode with 'opencode serve' or set opencode.serverMode: connect-or-start.`, {
      adapter: "opencode",
      command: this.config.opencode.command,
      mode: this.mode,
      serverUrl: this.config.opencode.serverUrl,
      serverMode: this.config.opencode.serverMode,
      telegramSuppress: availability.ok
    });
    this.startPolling();
  }

  async ensureServerAvailable() {
    const settings = this.config.opencode;
    const mode = String(settings.serverMode ?? "connect-or-start");
    if (mode !== "start") {
      const existing = await this.checkHealth();
      if (existing.ok) return existing;
      if (mode === "connect") return existing;
    }
    try {
      this.startManagedServer();
    } catch (error) {
      return { ok: false, error: error.message };
    }
    const deadline = Date.now() + Number(settings.startupTimeoutMs ?? 15000);
    let last = { ok: false, error: "not checked" };
    while (Date.now() < deadline) {
      last = await this.checkHealth();
      if (last.ok) return last;
      await sleep(250);
    }
    return last;
  }

  async checkHealth() {
    try {
      const body = await openCodeJson(this.config.opencode, "/global/health", {}, 3000);
      return { ok: body.healthy !== false, body };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  startManagedServer() {
    if (this.serverProcess && this.serverProcess.exitCode === null) return;
    const settings = this.config.opencode;
    const command = String(settings.command);
    const args = buildOpenCodeServeArgs(settings);
    const shell = shouldUseShell(command);
    const spawnArgs = shell && process.platform === "win32"
      ? args.map((arg) => quoteWindowsShellArg(arg))
      : args;
    this.serverProcess = spawn(command, spawnArgs, {
      cwd: resolveFromCwd(settings.cwd ?? "."),
      env: {
        ...process.env,
        ...(settings.serverPassword ? { OPENCODE_SERVER_PASSWORD: String(settings.serverPassword) } : {}),
        ...(settings.serverUsername ? { OPENCODE_SERVER_USERNAME: String(settings.serverUsername) } : {})
      },
      shell,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    });
    this.serverProcess.stderr.setEncoding("utf8");
    this.serverProcess.stderr.on("data", (chunk) => {
      process.stderr.write(`[opencode-server] ${chunk}`);
    });
    this.serverProcess.on("exit", (code, signal) => {
      if (this.serverProcess) process.stderr.write(`[opencode-server] exited (${code ?? signal})\n`);
    });
  }

  startPolling() {
    if (this.polling) return;
    this.polling = true;
    const intervalMs = Number(this.config.opencode.pollIntervalMs ?? 1200);
    const tick = async () => {
      try {
        const messages = await this.relay.poll();
        this.mode = this.config.runtimeMode ?? this.mode;
        for (const message of messages) {
          if (message.type === "control") {
            await this.handleControlMessage(message);
            continue;
          }
          if (message.type !== "text" || !message.text?.trim()) continue;
          if (!this.canAcceptText()) {
            await this.relay.send("status", `Phone text ignored because remote mode is ${this.mode}.`, {
              adapter: "opencode",
              mode: this.mode
            });
            continue;
          }
          this.enqueuePrompt(message.text.trim());
        }
      } catch (error) {
        process.stderr.write(`[legax] relay poll failed: ${error.message}\n`);
      } finally {
        if (this.polling) setTimeout(tick, intervalMs);
      }
    };
    void tick();
  }

  canAcceptText() {
    return runtimeCanAcceptText(this.config, this.mode);
  }

  async handleControlMessage(message) {
    if (message.action === "list_agent_projects") {
      const nextMode = activateAgentInteractive(this.config, this.config.opencode, this.mode);
      this.mode = nextMode;
      this.config.runtimeMode = nextMode;
      await this.sendProjectMenu(message.page);
      return;
    }
    if (message.action === "list_agent_sessions") {
      const nextMode = activateAgentInteractive(this.config, this.config.opencode, this.mode);
      this.mode = nextMode;
      this.config.runtimeMode = nextMode;
      await this.sendSessionMenu(message.projectRef, message.page);
      return;
    }
    if (message.action === "select_session") {
      const nextMode = activateAgentInteractive(this.config, this.config.opencode, this.mode);
      this.mode = nextMode;
      this.config.runtimeMode = nextMode;
      await this.selectSession(message.threadRef);
      return;
    }
    if (message.action === "new_session") {
      const nextMode = activateAgentInteractive(this.config, this.config.opencode, this.mode);
      this.mode = nextMode;
      this.config.runtimeMode = nextMode;
      await this.newSession(message.projectPath ?? message.cwd);
      return;
    }
    if (message.action === "set_mode") {
      const nextMode = setAgentMode(this.config, this.config.opencode, message.mode);
      this.mode = nextMode;
      this.config.runtimeMode = nextMode;
      await this.relay.send("status", `OpenCode remote mode switched to ${nextMode}.`, {
        adapter: "opencode",
        mode: nextMode,
        controlMessageId: message.id
      });
    }
  }

  async sendProjectMenu(page = 1) {
    const settings = this.config.opencode;
    let sessions = [];
    try {
      sessions = await listOpenCodeSessions(settings);
    } catch (error) {
      await this.relay.send("status", `Could not list OpenCode projects/chats: ${error.message}`, {
        adapter: "opencode",
        mode: this.mode,
        telegramReplyMarkup: selectedSessionReplyMarkup(settings.agentId)
      });
      return;
    }
    this.projectChoices = buildProjectChoices(sessions, OPENCODE_PROJECT_OPTIONS);
    this.sessionChoices = [];
    const pagination = paginateItems(this.projectChoices, { page, pageSize: Number(settings.sessionPageSize ?? 10) });
    await this.relay.send("status", `Remote mode is ${this.mode}.\n${formatProjectList(settings.agentLabel ?? "OpenCode", pagination.items, pagination)}`, {
      adapter: "opencode",
      mode: this.mode,
      telegramReplyMarkup: projectsReplyMarkup(settings.agentId, this.projectChoices, {
        page: pagination.page,
        pageSize: Number(settings.sessionPageSize ?? 10)
      })
    });
  }

  async sendSessionMenu(projectRef, page = 1) {
    const settings = this.config.opencode;
    let sessions = [];
    try {
      sessions = await listOpenCodeSessions(settings);
    } catch (error) {
      await this.relay.send("status", `Could not list OpenCode sessions: ${error.message}`, {
        adapter: "opencode",
        mode: this.mode,
        telegramReplyMarkup: selectedSessionReplyMarkup(settings.agentId)
      });
      return;
    }
    this.projectChoices = buildProjectChoices(sessions, OPENCODE_PROJECT_OPTIONS);
    const project = resolveProjectChoice(projectRef, this.projectChoices);
    const visibleSessions = filterItemsByProject(sessions, project, OPENCODE_PROJECT_OPTIONS);
    const pagination = paginateItems(visibleSessions, { page, pageSize: Number(settings.sessionPageSize ?? 10) });
    this.sessionChoices = pagination.items;
    if (sessions.length === 0) {
      await this.relay.send("status", `Remote mode is ${this.mode}.\nNo OpenCode sessions were found. You can start a new session or create one locally.`, {
        adapter: "opencode",
        mode: this.mode,
        telegramReplyMarkup: sessionsReplyMarkup(settings.agentId, [])
      });
      return;
    }
    if (visibleSessions.length === 0) {
      await this.relay.send("status", `Remote mode is ${this.mode}.\nNo OpenCode sessions were found for that project/chat.`, {
        adapter: "opencode",
        mode: this.mode,
        telegramReplyMarkup: projectsReplyMarkup(settings.agentId, this.projectChoices)
      });
      return;
    }
    await this.relay.send("status", `Remote mode is ${this.mode}.\n${formatSessionList(settings.agentLabel ?? "OpenCode", pagination.items, settings.sessionId, project, pagination)}`, {
      adapter: "opencode",
      mode: this.mode,
      projectId: project?.key,
      projectName: project?.label,
      projectPath: project?.detail,
      telegramReplyMarkup: sessionsReplyMarkup(settings.agentId, pagination.items, {
        projectRef: project?.id,
        pagination
      })
    });
  }

  async selectSession(threadRef) {
    const session = await this.resolveSessionRef(threadRef);
    if (!session?.id) {
      await this.relay.send("status", `OpenCode session not found: ${threadRef}. Refresh sessions and choose again.`, {
        adapter: "opencode",
        mode: this.mode,
        telegramReplyMarkup: selectedSessionReplyMarkup(this.config.opencode.agentId)
      });
      return;
    }
    this.config.opencode.useExisting = true;
    this.config.opencode.sessionId = session.id;
    setAgentThreadSelection(this.config, this.config.opencode, session);
    await this.relay.send("status", `OpenCode session selected: ${session.name ?? shortId(session.id)}`, {
      adapter: "opencode",
      mode: this.mode,
      threadId: session.id,
      threadTitle: session.name ?? session.preview,
      cwd: session.cwd ?? this.config.opencode.cwd,
      telegramReplyMarkup: selectedSessionReplyMarkup(this.config.opencode.agentId)
    });
    await this.sendSessionHistoryOnSelect(session);
  }

  async sendSessionHistoryOnSelect(session) {
    const settings = this.config.opencode;
    const limit = sessionHistoryOnSelectLimit(settings);
    let items = [];
    try {
      items = await openCodeMessageHistoryItems(settings, session, limit);
    } catch (error) {
      await this.relay.send("status", `Could not read OpenCode session history: ${error.message}`, {
        adapter: "opencode",
        mode: this.mode,
        threadId: session.id,
        threadTitle: session.name ?? session.preview,
        cwd: session.cwd ?? settings.cwd
      });
      return;
    }
    for (const item of items) {
      await this.relay.send("agent_text", item.text, {
        adapter: "opencode",
        mode: this.mode,
        threadId: session.id,
        threadTitle: session.name ?? session.preview,
        cwd: session.cwd ?? settings.cwd,
        author: item.author,
        sessionHistory: true,
        telegramImportant: true
      });
    }
  }

  async resolveSessionRef(threadRef) {
    const value = String(threadRef ?? "").trim();
    if (!value) return null;
    if (/^\d+$/.test(value)) {
      const index = Number(value) - 1;
      if (this.sessionChoices[index]) return this.sessionChoices[index];
    }
    const choices = this.sessionChoices.length > 0 ? this.sessionChoices : await listOpenCodeSessions(this.config.opencode);
    return choices.find((session) => session.id === value)
      ?? choices.find((session) => session.id?.startsWith(value))
      ?? choices.find((session) => session.resumeRef === value)
      ?? null;
  }

  async newSession(projectPath) {
    if (projectPath) this.config.opencode.cwd = resolveFromCwd(projectPath);
    this.config.opencode.useExisting = false;
    this.config.opencode.sessionId = "";
    setAgentThreadSelection(this.config, this.config.opencode, null);
    const suffix = projectPath ? ` in ${this.config.opencode.cwd}` : "";
    await this.relay.send("status", `New OpenCode session selected${suffix}. The next phone message will create fresh OpenCode history.`, {
      adapter: "opencode",
      mode: this.mode,
      cwd: this.config.opencode.cwd,
      projectName: projectPath ? path.basename(this.config.opencode.cwd) : undefined,
      telegramReplyMarkup: selectedSessionReplyMarkup(this.config.opencode.agentId)
    });
  }

  enqueuePrompt(text) {
    this.queue.push(text);
    void this.drainQueue();
  }

  async drainQueue() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const prompt = this.queue.shift();
        await this.runOpenCodeTurn(prompt);
      }
    } finally {
      this.running = false;
    }
  }

  async runOpenCodeTurn(prompt) {
    const settings = this.config.opencode;
    let sessionId = settings.useExisting === false ? "" : settings.sessionId;
    let session = null;
    if (!sessionId) {
      session = await createOpenCodeSession(settings, prompt);
      sessionId = session.id;
      settings.useExisting = true;
      settings.sessionId = sessionId;
      setAgentThreadSelection(this.config, settings, session);
    } else {
      const selection = getAgentThreadSelection(this.config, settings);
      session = selection.selectedThreadId === sessionId ? selection.selectedThread : { id: sessionId, name: sessionId };
    }
    if (settings.forwardStatusEvents !== false) {
      await this.relay.send("status", "OpenCode turn started.", {
        adapter: "opencode",
        threadId: sessionId,
        threadTitle: session?.name ?? sessionId,
        cwd: session?.cwd ?? settings.cwd,
        promptLength: prompt.length,
        telegramSuppress: true
      });
    }
    try {
      const body = await sendOpenCodeMessage(settings, sessionId, prompt);
      const items = openCodeResponseItems(body);
      for (const item of items) {
        if (settings.forwardMessageEvents !== false) {
          await this.relay.send("agent_text", item.text, {
            adapter: "opencode",
            mode: this.mode,
            threadId: sessionId,
            threadTitle: session?.name ?? sessionId,
            cwd: session?.cwd ?? settings.cwd,
            author: item.author
          });
        }
      }
      if (settings.forwardStatusEvents !== false) {
        await this.relay.send("status", "OpenCode turn completed.", {
          adapter: "opencode",
          threadId: sessionId,
          threadTitle: session?.name ?? sessionId,
          cwd: session?.cwd ?? settings.cwd,
          telegramSuppress: true
        });
      }
    } catch (error) {
      await this.relay.send("status", `OpenCode turn failed: ${error.message}`, {
        adapter: "opencode",
        threadId: sessionId,
        threadTitle: session?.name ?? sessionId,
        cwd: session?.cwd ?? settings.cwd
      });
    }
  }

  stop() {
    this.polling = false;
    if (this.serverProcess && this.serverProcess.exitCode === null) {
      killProcessTree(this.serverProcess);
    }
  }
}

function buildOpenCodeServeArgs(settings) {
  if (Array.isArray(settings.serveArgs) && settings.serveArgs.length > 0) {
    return settings.serveArgs.map(String);
  }
  const url = new URL(settings.serverUrl);
  const args = ["serve"];
  if (url.hostname) args.push("--hostname", url.hostname);
  if (url.port) args.push("--port", url.port);
  if (Array.isArray(settings.args)) args.push(...settings.args.map(String));
  return args;
}

function shouldUseShell(command) {
  if (process.platform !== "win32") return false;
  if (path.isAbsolute(command)) return false;
  if (/\.(exe)$/i.test(command)) return false;
  return true;
}

function quoteWindowsShellArg(arg) {
  const value = String(arg);
  if (!/[ \t"&|<>^]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function killProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform !== "win32" || !child.pid) {
    child.kill();
    return;
  }
  const result = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
    stdio: "ignore",
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    child.kill();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const config = loadConfig();
  const args = process.argv.slice(2);
  if (args.includes("--dry-run") || args.includes("--status")) {
    const relay = selectRelay(config);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      configPath: config.configPath,
      relay: relay ? { name: relay.name, baseUrl: relay.baseUrl, hasSecret: Boolean(relay.secret) } : null,
      opencode: {
        agentId: config.opencode.agentId,
        agentLabel: config.opencode.agentLabel,
        mode: config.opencode.mode,
        cliBackend: config.opencode.cliBackend,
        mcpEnabled: config.opencode.mcpEnabled,
        supportsSessions: config.opencode.supportsSessions,
        useExisting: config.opencode.useExisting,
        command: config.opencode.command,
        args: config.opencode.args,
        serveArgs: buildOpenCodeServeArgs(config.opencode),
        cwd: resolveFromCwd(config.opencode.cwd ?? "."),
        serverUrl: config.opencode.serverUrl,
        serverMode: config.opencode.serverMode,
        serverUsername: config.opencode.serverUsername,
        hasServerPassword: Boolean(config.opencode.serverPassword),
        sessionHistoryOnSelectLimit: sessionHistoryOnSelectLimit(config.opencode)
      }
    }, null, 2)}\n`);
    return;
  }

  const link = new OpenCodeLink(config);
  const shutdown = () => {
    link.stop();
  };
  process.on("SIGINT", () => {
    shutdown();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(143);
  });
  await link.start();
}

main().catch((error) => {
  process.stderr.write(`[legax] ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
