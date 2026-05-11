#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
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
  setAgentThreadSelection,
  setAgentMode
} from "./lib/runtime-state.mjs";
import { readYaml } from "./lib/yaml.mjs";
import {
  buildProjectChoices,
  filterActiveItems,
  filterItemsByProject,
  formatPageLine,
  formatProjectList,
  hierarchyRows,
  isArchivedItem,
  normalizePage,
  paginateItems,
  projectsReplyMarkup,
  resolveProjectChoice
} from "./lib/menu-groups.mjs";
import { packageAssetPath, resolveConfigPath, resolveConfigRelative, resolveRuntimeFile } from "./lib/paths.mjs";


const VERSION = "0.0.3";
let activeConfigPath = resolveConfigPath();


function resolveFromCwd(value) {
  if (!value) return value;
  return resolveConfigRelative(value, activeConfigPath);
}

function writeJsonFile(filePath, body) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // best-effort cleanup only
    }
    throw error;
  }
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
  const claudeRaw = raw.claude ?? {};
  const codexRaw = raw.codex ?? {};
  const geminiRaw = raw.gemini ?? {};
  const claudeCode = {
    enabled: true,
    agentId: "claude-code",
    agentLabel: "Claude Code",
    cliBackend: "stream-json",
    mcpEnabled: true,
    mcpRole: "permission-prompt",
    supportsSessions: claudeRaw.supportsSessions ?? true,
    useExisting: claudeRaw.useExisting ?? false,
    continueLatest: claudeRaw.continueLatest ?? true,
    resumeSession: claudeRaw.resumeSession ?? "",
    sessionListLimit: 10,
    sessionListCwd: "cwd",
    sessionHistoryRoot: "",
    mode: remote.defaultMode,
    command: "claude",
    args: ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"],
    cwd: ".",
    pollIntervalMs: 1200,
    approvalTimeoutMs: 300000,
    permissionPromptTool: "mcp__legax_permissions__approval_prompt",
    permissionBehaviorOnApprove: "allow",
    permissionBehaviorOnDeny: "deny",
    mcpConfigPath: "./data/claude-permission-mcp.json",
    forwardAssistantMessages: true,
    forwardStatusEvents: true,
    sessionHistoryOnSelectLimit: 1,
    ...claudeRaw
  };
  const codexAppServer = {
    enabled: codexRaw.enabled ?? false,
    agentId: codexRaw.agentId ?? "codex-cli",
    agentLabel: codexRaw.agentLabel ?? "Codex CLI",
    cliBackend: codexRaw.cliBackend ?? "app-server",
    mcpEnabled: codexRaw.mcpEnabled ?? true
  };
  const geminiCli = {
    enabled: geminiRaw.enabled ?? false,
    agentId: geminiRaw.agentId ?? "gemini-cli",
    agentLabel: geminiRaw.agentLabel ?? "Gemini CLI",
    cliBackend: geminiRaw.cliBackend ?? "stream-json",
    mcpEnabled: geminiRaw.mcpEnabled ?? true
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
    geminiCli,
    claudeCode
  };
}

function hasCliOption(args, optionName) {
  return args.some((arg) => arg === optionName || String(arg).startsWith(`${optionName}=`));
}

function hasClaudeSessionOption(args) {
  return hasCliOption(args, "--continue")
    || args.includes("-c")
    || hasCliOption(args, "--resume")
    || args.includes("-r")
    || hasCliOption(args, "--session-id");
}

function buildClaudeArgs(settings, { mcpConfigPath } = {}) {
  const args = Array.isArray(settings.args) ? [...settings.args.map(String)] : [];
  if (settings.useExisting === true && !hasClaudeSessionOption(args)) {
    if (settings.resumeSession) args.push("--resume", String(settings.resumeSession));
    else if (settings.continueLatest !== false) args.push("--continue");
  }
  if (mcpConfigPath && !args.includes("--mcp-config")) {
    args.push("--mcp-config", mcpConfigPath);
  }
  if (settings.mcpEnabled !== false && settings.permissionPromptTool && !args.includes("--permission-prompt-tool")) {
    args.push("--permission-prompt-tool", settings.permissionPromptTool);
  }
  return args;
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

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || "";
}

function expandHome(value) {
  const text = String(value ?? "");
  if (text === "~") return homeDir();
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(homeDir(), text.slice(2));
  return text;
}

function resolveSessionListCwd(settings) {
  const value = settings.sessionListCwd;
  if (value === false || value === "false" || value === "all" || value === "") return null;
  if (value === "cwd" || value === true || value === undefined) return resolveFromCwd(settings.cwd ?? ".");
  return resolveFromCwd(value);
}

function samePath(left, right) {
  if (!left || !right) return false;
  const normalize = (value) => path.resolve(String(value)).replace(/[\\/]+$/g, "");
  const a = normalize(left);
  const b = normalize(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function listFilesRecursive(root, predicate, limit = 500) {
  const results = [];
  const pending = [root];
  while (pending.length > 0 && results.length < limit) {
    const dir = pending.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (entry.isFile() && predicate(fullPath)) {
        results.push(fullPath);
        if (results.length >= limit) break;
      }
    }
  }
  return results;
}

function listClaudeSessions(settings) {
  const root = settings.sessionHistoryRoot
    ? path.resolve(expandHome(settings.sessionHistoryRoot))
    : path.join(homeDir(), ".claude", "projects");
  if (!root || !fs.existsSync(root)) return [];
  const cwd = resolveSessionListCwd(settings);
  const limit = Number(settings.sessionListLimit ?? 10);
  const files = listFilesRecursive(root, (filePath) => filePath.endsWith(".jsonl"), Number(settings.sessionListScanLimit ?? 800))
    .map((filePath) => {
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch {
        stat = { mtimeMs: 0 };
      }
      return { filePath, mtimeMs: stat.mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  const sessions = [];
  for (const file of files) {
    const session = readClaudeSessionFile(file.filePath, file.mtimeMs);
    if (!session?.id) continue;
    if (cwd && session.cwd && !samePath(session.cwd, cwd)) continue;
    sessions.push(session);
  }
  return filterActiveItems(sessions).sort(compareClaudeSessions).slice(0, limit);
}

function compareClaudeSessions(left, right) {
  const byTime = Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? "");
  if (Number.isFinite(byTime) && byTime !== 0) return byTime;
  const leftLabel = String(left.name ?? left.id ?? "");
  const rightLabel = String(right.name ?? right.id ?? "");
  return rightLabel.localeCompare(leftLabel);
}

function readClaudeSessionFile(filePath, mtimeMs) {
  const fallbackId = path.basename(filePath, ".jsonl");
  const session = {
    id: fallbackId,
    resumeRef: fallbackId,
    source: "claude-code",
    filePath,
    updatedAt: new Date(mtimeMs || Date.now()).toISOString(),
    createdAt: undefined,
    cwd: undefined,
    name: undefined,
    preview: undefined
  };
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return session;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.sessionId) {
      session.id = String(event.sessionId);
      session.resumeRef = session.id;
    }
    if (event.cwd) session.cwd = String(event.cwd);
    if (event.timestamp) {
      session.updatedAt = event.timestamp;
      session.createdAt ??= event.timestamp;
    }
    if (isArchivedItem(event)) session.archived = true;
    if (event.type === "last-prompt" && event.lastPrompt) {
      session.name = trimOneLine(event.lastPrompt, 80);
    }
    const userText = extractClaudeHistoryUserText(event);
    if (userText) session.preview = trimOneLine(userText, 120);
  }
  session.name ??= session.preview ?? `Claude session ${shortId(session.id)}`;
  return session;
}

function extractClaudeHistoryUserText(event) {
  const message = extractClaudeHistoryMessage(event);
  return message?.author === "user" ? message.text : "";
}

function extractClaudeHistoryMessage(event) {
  const role = String(event.message?.role ?? event.role ?? "").toLowerCase();
  const text = extractHistoryText(event.message?.content ?? event.content ?? event.text);
  if (!text) return null;
  if (role === "user") return { author: "user", text };
  if (role === "assistant") return { author: "agent", text };
  return null;
}

function extractHistoryText(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part === "string" ? part : part?.text)
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function sessionHistoryOnSelectLimit(settings) {
  const value = Number(settings.sessionHistoryOnSelectLimit ?? settings.sessionSelectHistoryLimit ?? 1);
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(20, Math.floor(value)));
}

function readClaudeSessionHistory(session, limit) {
  if (!session?.filePath || limit <= 0) return [];
  let text;
  try {
    text = fs.readFileSync(session.filePath, "utf8");
  } catch {
    return [];
  }
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const item = extractClaudeHistoryMessage(JSON.parse(line));
      if (item) items.push(item);
    } catch {
      continue;
    }
  }
  return items.slice(-limit);
}

function trimOneLine(value, limit = 80) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}...`;
}

function formatSessionList(label, sessions, activeSessionId, project, pagination) {
  return [
    project ? `Choose a ${label} session in ${project.label}:` : `Choose a ${label} session:`,
    formatPageLine(pagination),
    ...sessions.map((session, index) => {
      const active = session.id === activeSessionId ? " *" : "";
      const title = session.name ?? session.preview ?? shortId(session.id);
      const when = session.updatedAt ? ` (${formatDateTime(session.updatedAt)})` : "";
      return `${index + 1}. ${title}${when} [${shortId(session.id)}]${active}`;
    })
  ].filter(Boolean).join("\n");
}

const CLAUDE_PROJECT_OPTIONS = {
  defaultKey: "claude-default-project",
  defaultLabel: "Default project",
  keyKeys: ["projectId", "metadata.projectId"],
  pathKeys: ["cwd", "projectPath", "workspacePath", "metadata.cwd", "metadata.projectPath", "metadata.workspacePath", "project", "metadata.project"],
  labelKeys: ["projectName", "workspaceName", "metadata.projectName"],
  chatIncludesCwdOnly: true
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

class RelayClient {
  constructor(config) {
    this.config = config;
    this.relay = selectRelay(config);
    const runtime = getAgentRuntime(config, config.claudeCode);
    this.startedAtMs = Date.now();
    this.afterMessageSeq = Number(runtime.afterMessageSeq ?? 0);
    this.primeOnFirstPoll = runtime.afterMessageSeq === undefined;
    this.config.runtimeMode = runtime.mode;
  }

  headers() {
    return this.relay?.secret ? { "x-legax-secret": this.relay.secret } : {};
  }

  async send(kind, text, metadata = {}) {
    const settings = this.config.claudeCode;
    const { includeThreadMetadata = true, ...eventMetadata } = metadata;
    const event = {
      id: crypto.randomUUID(),
      sessionId: this.config.sessionId,
      agentId: settings.agentId,
      agentLabel: settings.agentLabel,
      taskId: settings.taskId,
      source: "claude-code",
      sourceName: settings.agentLabel ?? this.config.displayName,
      kind,
      text,
      metadata: {
        agentId: settings.agentId,
        agentLabel: settings.agentLabel,
        taskId: settings.taskId,
        mode: this.config.runtimeMode ?? settings.mode,
        ...(includeThreadMetadata ? selectedThreadMetadata(this.config, settings) : {}),
        ...eventMetadata
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
        url.searchParams.set("agentId", this.config.claudeCode.agentId);
        if (this.config.claudeCode.taskId) url.searchParams.set("taskId", this.config.claudeCode.taskId);
        const response = await httpJson(url, { headers: this.headers() }, this.relay.timeoutMs);
        rawMessages = response.messages ?? [];
      } catch (error) {
        process.stderr.write(`[legax] ${this.relay.name} poll failed: ${error.message}\n`);
      }
    }
    const inboundMessages = await pollInboundTransports(this.config, this.config.claudeCode, {
      drainOnly: daemonRouterManaged
    });
    const messages = filterAgentMessages(this.config, this.config.claudeCode, [...rawMessages, ...inboundMessages]);
    this.config.runtimeMode = applyControlMessages(this.config, this.config.claudeCode, messages, this.config.runtimeMode);
    const maxSeq = Math.max(this.afterMessageSeq, ...rawMessages.map((message) => Number(message.seq) || 0));
    this.afterMessageSeq = maxSeq;
    setAgentCursor(this.config, this.config.claudeCode, maxSeq);
    if (this.primeOnFirstPoll) {
      this.primeOnFirstPoll = false;
      return messagesCreatedAfter(messages, this.startedAtMs);
    }
    return messages;
  }
}

class ClaudeCodeLink {
  constructor(config) {
    this.config = config;
    this.relay = new RelayClient(config);
    this.polling = false;
    this.lastAssistantText = "";
    this.sessionChoices = [];
    this.projectChoices = [];
    this.stopping = false;
    this.mode = config.runtimeMode ?? normalizeMode(config.claudeCode.mode ?? config.remote?.defaultMode);
    this.config.runtimeMode = this.mode;
    const selection = getAgentThreadSelection(this.config, this.config.claudeCode);
    if (selection.selectedThreadId) {
      this.config.claudeCode.useExisting = true;
      this.config.claudeCode.resumeSession = selection.selectedThread?.resumeRef ?? selection.selectedThreadId;
      this.config.claudeCode.continueLatest = false;
    }
  }

  async writePermissionMcpConfig() {
    const settings = this.config.claudeCode;
    if (settings.mcpEnabled === false) return undefined;
    if (settings.mcpAutoConfigure === false) return undefined;
    if (!settings.permissionPromptTool) return undefined;
    const mcpConfigPath = resolveConfigRelative(settings.mcpConfigPath, this.config.configPath);
    writeJsonFile(mcpConfigPath, {
      mcpServers: {
        legax_permissions: {
          command: process.execPath,
          args: [packageAssetPath("scripts", "claude-permission-mcp-server.mjs")],
          env: {
            LEGAX_CONFIG: this.config.configPath,
            LEGAX_SECRET: process.env.LEGAX_SECRET ?? "",
            ...(process.env.LEGAX_DAEMON_CHILD === "1" && process.env.LEGAX_DAEMON_ROUTER === "1" ? {
              LEGAX_DAEMON_CHILD: "1",
              LEGAX_DAEMON_ROUTER: "1"
            } : {})
          }
        }
      }
    });
    return mcpConfigPath;
  }

  async start() {
    const settings = this.config.claudeCode;
    await this.relay.send("status", "Claude Code link connected. Choose a session or send a message from the phone.", {
      adapter: "claude-code",
      command: settings.command,
      mode: this.mode,
      includeThreadMetadata: false,
      telegramSuppress: true
    });
    this.startPolling();
  }

  async startClaudeProcess() {
    if (this.isClaudeProcessRunning()) return this.child;
    const settings = this.config.claudeCode;
    const mcpConfigPath = await this.writePermissionMcpConfig();
    const args = buildClaudeArgs(settings, { mcpConfigPath });
    const child = spawn(String(settings.command), args, {
      cwd: resolveFromCwd(settings.cwd ?? "."),
      env: process.env,
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (this.child === child) void this.readStdout(chunk);
    });
    child.stderr.on("data", (chunk) => process.stderr.write(`[claude-code] ${chunk}`));
    child.on("exit", (code, signal) => {
      if (this.stopping || this.child !== child) return;
      this.child = null;
      process.stderr.write(`[legax] Claude Code exited (${code ?? signal})\n`);
    });
    this.buffer = "";
    return child;
  }

  isClaudeProcessRunning() {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed);
  }

  async ensureClaudeProcess() {
    if (this.isClaudeProcessRunning() && this.child?.stdin?.writable) return this.child;
    this.child = null;
    return await this.startClaudeProcess();
  }

  async stopClaudeProcess() {
    const previous = this.child;
    this.child = null;
    if (previous && previous.exitCode === null && !previous.killed) {
      previous.kill();
      await delay(100);
    }
  }

  async restartClaudeProcess() {
    await this.stopClaudeProcess();
    await this.startClaudeProcess();
  }

  async readStdout(chunk) {
    this.buffer = (this.buffer ?? "") + chunk;
    let newlineIndex;
    while ((newlineIndex = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) continue;
      try {
        await this.handleClaudeEvent(JSON.parse(line));
      } catch (error) {
        process.stderr.write(`[legax] invalid Claude stream event: ${error.message}\n`);
      }
    }
  }

  async handleClaudeEvent(event) {
    if (event.type === "system" && this.config.claudeCode.forwardStatusEvents !== false) {
      await this.relay.send("status", event.subtype ? `Claude Code system: ${event.subtype}` : "Claude Code system event", {
        adapter: "claude-code",
        event
      });
      return;
    }
    if (event.type === "assistant" && this.config.claudeCode.forwardAssistantMessages !== false) {
      const text = extractClaudeText(event);
      if (text) {
        this.lastAssistantText = text;
        await this.relay.send("agent_text", text, {
          adapter: "claude-code",
          eventType: event.type
        });
      }
      return;
    }
    if (event.type === "result" && this.config.claudeCode.forwardAssistantMessages !== false) {
      const text = event.result ?? event.message?.content?.map((part) => part.text).filter(Boolean).join("\n");
      if (text && text !== this.lastAssistantText) {
        await this.relay.send("agent_text", text, {
          adapter: "claude-code",
          eventType: event.type
        });
      }
      return;
    }
    if ((event.type === "error" || event.type === "warning") && this.config.claudeCode.forwardStatusEvents !== false) {
      await this.relay.send("status", event.message ?? JSON.stringify(event), {
        adapter: "claude-code",
        eventType: event.type
      });
    }
  }

  startPolling() {
    if (this.polling) return;
    this.polling = true;
    const intervalMs = Number(this.config.claudeCode.pollIntervalMs ?? 1200);
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
              adapter: "claude-code",
              mode: this.mode
            });
            continue;
          }
          await this.sendUserInput(message.text.trim());
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
      const nextMode = activateAgentInteractive(this.config, this.config.claudeCode, this.mode);
      this.mode = nextMode;
      this.config.runtimeMode = nextMode;
      await this.sendProjectMenu(message.page);
      return;
    }
    if (message.action === "list_agent_sessions") {
      const nextMode = activateAgentInteractive(this.config, this.config.claudeCode, this.mode);
      this.mode = nextMode;
      this.config.runtimeMode = nextMode;
      await this.sendSessionMenu(message.projectRef, message.page);
      return;
    }
    if (message.action === "select_session") {
      const nextMode = activateAgentInteractive(this.config, this.config.claudeCode, this.mode);
      this.mode = nextMode;
      this.config.runtimeMode = nextMode;
      await this.selectSession(message.threadRef);
      return;
    }
    if (message.action === "new_session") {
      const nextMode = activateAgentInteractive(this.config, this.config.claudeCode, this.mode);
      this.mode = nextMode;
      this.config.runtimeMode = nextMode;
      await this.newSession(message.projectPath ?? message.cwd);
      return;
    }
    if (message.action === "set_mode") {
      const nextMode = setAgentMode(this.config, this.config.claudeCode, message.mode);
      this.mode = nextMode;
      this.config.runtimeMode = nextMode;
      await this.relay.send("status", `Claude Code remote mode switched to ${nextMode}.`, {
        adapter: "claude-code",
        mode: nextMode,
        controlMessageId: message.id
      });
    }
  }

  async sendProjectMenu(page = 1) {
    const settings = this.config.claudeCode;
    const sessions = listClaudeSessions(settings);
    this.projectChoices = buildProjectChoices(sessions, CLAUDE_PROJECT_OPTIONS);
    this.sessionChoices = [];
    const pagination = paginateItems(this.projectChoices, { page, pageSize: 10 });
    await this.relay.send("status", `Remote mode is ${this.mode}.\n${formatProjectList(settings.agentLabel ?? "Claude Code", pagination.items, pagination)}`, {
      adapter: "claude-code",
      mode: this.mode,
      telegramReplyMarkup: projectsReplyMarkup(settings.agentId, this.projectChoices, {
        page: pagination.page
      })
    });
  }

  async sendSessionMenu(projectRef, page = 1) {
    const settings = this.config.claudeCode;
    const sessions = listClaudeSessions(settings);
    this.projectChoices = buildProjectChoices(sessions, CLAUDE_PROJECT_OPTIONS);
    const project = resolveProjectChoice(projectRef, this.projectChoices);
    const visibleSessions = filterItemsByProject(sessions, project, CLAUDE_PROJECT_OPTIONS);
    const pagination = paginateItems(visibleSessions, { page, pageSize: 10 });
    this.sessionChoices = pagination.items;
    if (sessions.length === 0) {
      await this.relay.send("status", `Remote mode is ${this.mode}.\nNo Claude Code sessions were found for the configured project. You can start a new session or open Claude Code locally and create one.`, {
        adapter: "claude-code",
        mode: this.mode,
        telegramReplyMarkup: sessionsReplyMarkup(settings.agentId, [])
      });
      return;
    }
    if (visibleSessions.length === 0) {
      if (project?.isChat) {
        await this.relay.send("status", `Remote mode is ${this.mode}.\nNo Claude Code chat sessions were found. Start a new chat or choose another project/chat.`, {
          adapter: "claude-code",
          mode: this.mode,
          projectId: project.key,
          projectName: project.label,
          telegramReplyMarkup: sessionsReplyMarkup(settings.agentId, [], {
            projectRef: project.id
          })
        });
        return;
      }
      await this.relay.send("status", `Remote mode is ${this.mode}.\nNo Claude Code sessions were found for that project/chat.`, {
        adapter: "claude-code",
        mode: this.mode,
        telegramReplyMarkup: projectsReplyMarkup(settings.agentId, this.projectChoices)
      });
      return;
    }
    await this.relay.send("status", `Remote mode is ${this.mode}.\n${formatSessionList(settings.agentLabel ?? "Claude Code", pagination.items, settings.resumeSession, project, pagination)}`, {
      adapter: "claude-code",
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
    const session = this.resolveSessionRef(threadRef);
    if (!session?.id) {
      await this.relay.send("status", `Claude Code session not found: ${threadRef}. Refresh sessions and choose again.`, {
        adapter: "claude-code",
        mode: this.mode,
        telegramReplyMarkup: selectedSessionReplyMarkup(this.config.claudeCode.agentId)
      });
      return;
    }
    this.config.claudeCode.useExisting = true;
    this.config.claudeCode.resumeSession = session.resumeRef ?? session.id;
    this.config.claudeCode.continueLatest = false;
    setAgentThreadSelection(this.config, this.config.claudeCode, session);
    await this.stopClaudeProcess();
    await this.relay.send("status", `Claude Code session selected: ${session.name ?? shortId(session.id)}`, {
      adapter: "claude-code",
      mode: this.mode,
      threadId: session.id,
      threadTitle: session.name ?? session.preview,
      telegramReplyMarkup: selectedSessionReplyMarkup(this.config.claudeCode.agentId)
    });
    await this.sendSessionHistoryOnSelect(session);
  }

  async sendSessionHistoryOnSelect(session) {
    const settings = this.config.claudeCode;
    const limit = sessionHistoryOnSelectLimit(settings);
    const items = readClaudeSessionHistory(session, limit);
    for (const item of items) {
      await this.relay.send("agent_text", item.text, {
        adapter: "claude-code",
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

  resolveSessionRef(threadRef) {
    const value = String(threadRef ?? "").trim();
    if (!value) return null;
    if (/^\d+$/.test(value)) {
      const index = Number(value) - 1;
      if (this.sessionChoices[index]) return this.sessionChoices[index];
    }
    const choices = this.sessionChoices.length > 0 ? this.sessionChoices : listClaudeSessions(this.config.claudeCode);
    return choices.find((session) => session.id === value)
      ?? choices.find((session) => session.id?.startsWith(value))
      ?? null;
  }

  async newSession(projectPath) {
    if (projectPath) this.config.claudeCode.cwd = resolveFromCwd(projectPath);
    this.config.claudeCode.useExisting = false;
    this.config.claudeCode.resumeSession = "";
    this.config.claudeCode.continueLatest = false;
    setAgentThreadSelection(this.config, this.config.claudeCode, null);
    await this.stopClaudeProcess();
    const suffix = projectPath ? ` in ${this.config.claudeCode.cwd}` : "";
    await this.relay.send("status", `New Claude Code session selected${suffix}. The next phone message will create fresh Claude Code history.`, {
      adapter: "claude-code",
      mode: this.mode,
      cwd: this.config.claudeCode.cwd,
      projectName: projectPath ? path.basename(this.config.claudeCode.cwd) : undefined,
      telegramReplyMarkup: selectedSessionReplyMarkup(this.config.claudeCode.agentId)
    });
  }

  async sendUserInput(text) {
    const child = await this.ensureClaudeProcess();
    if (!child?.stdin?.writable) {
      await this.relay.send("status", "Claude Code is not ready for input yet. Try again after the adapter reconnects.", {
        adapter: "claude-code",
        mode: this.mode
      });
      return;
    }
    const payload = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text }]
      }
    };
    try {
      child.stdin.write(`${JSON.stringify(payload)}\n`);
    } catch (error) {
      this.child = null;
      await this.relay.send("status", `Claude Code input failed: ${error.message}`, {
        adapter: "claude-code",
        mode: this.mode
      });
    }
  }

  stop() {
    this.stopping = true;
    this.polling = false;
    this.child?.kill();
  }
}

function extractClaudeText(event) {
  if (typeof event.text === "string") return event.text;
  if (typeof event.content === "string") return event.content;
  const content = event.message?.content ?? event.content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  }
  return "";
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
      claude: {
        agentId: config.claudeCode.agentId,
        agentLabel: config.claudeCode.agentLabel,
        mode: config.claudeCode.mode,
        cliBackend: config.claudeCode.cliBackend,
        mcpEnabled: config.claudeCode.mcpEnabled,
        supportsSessions: config.claudeCode.supportsSessions,
        useExisting: config.claudeCode.useExisting,
        continueLatest: config.claudeCode.continueLatest,
        resumeSession: config.claudeCode.resumeSession,
        sessionListCwd: config.claudeCode.sessionListCwd,
        sessionHistoryRoot: config.claudeCode.sessionHistoryRoot,
        command: config.claudeCode.command,
        args: config.claudeCode.args,
        effectiveArgs: buildClaudeArgs(config.claudeCode, {
          mcpConfigPath: config.claudeCode.mcpEnabled === false
            ? undefined
            : resolveConfigRelative(config.claudeCode.mcpConfigPath, config.configPath)
        }),
        cwd: resolveFromCwd(config.claudeCode.cwd ?? "."),
        permissionPromptTool: config.claudeCode.permissionPromptTool
      }
    }, null, 2)}\n`);
    return;
  }
  if (config.remote?.enabled === false) {
    process.stderr.write("[legax] Legax remote control is disabled by config.\n");
    return;
  }

  const link = new ClaudeCodeLink(config);
  await link.start();
  process.stderr.write("[legax] Claude Code link is running.\n");
  const shutdown = () => link.stop();
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
