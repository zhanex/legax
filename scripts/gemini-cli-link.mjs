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
  setAgentThreadSelection,
  setAgentMode,
  shouldForwardRemoteEvent
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

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse JSON MCP config at ${filePath}: ${error.message}`);
  }
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
  const geminiRaw = raw.gemini ?? {};
  const codexRaw = raw.codex ?? {};
  const claudeRaw = raw.claude ?? {};
  const geminiCli = {
    enabled: true,
    agentId: "gemini-cli",
    agentLabel: "Gemini CLI",
    cliBackend: "stream-json",
    mcpEnabled: true,
    mcpRole: "capability",
    supportsSessions: geminiRaw.supportsSessions ?? true,
    useExisting: geminiRaw.useExisting ?? false,
    mode: remote.defaultMode,
    command: "gemini",
    args: ["--output-format", "stream-json"],
    cwd: ".",
    promptFlag: "--prompt",
    approvalMode: "default",
    resumeSession: "",
    resumeExisting: "latest",
    sessionListArgs: ["--list-sessions"],
    sessionListLimit: 10,
    trustWorkspace: false,
    pollIntervalMs: 1200,
    forwardMessageEvents: true,
    forwardToolEvents: true,
    forwardStatusEvents: true,
    sessionHistoryOnSelectLimit: 1,
    ...geminiRaw
  };
  const codexAppServer = {
    enabled: codexRaw.enabled ?? false,
    agentId: codexRaw.agentId ?? "codex-cli",
    agentLabel: codexRaw.agentLabel ?? "Codex CLI",
    cliBackend: codexRaw.cliBackend ?? "app-server",
    mcpEnabled: codexRaw.mcpEnabled ?? true
  };
  const claudeCode = {
    enabled: claudeRaw.enabled ?? false,
    agentId: claudeRaw.agentId ?? "claude-code",
    agentLabel: claudeRaw.agentLabel ?? "Claude Code",
    cliBackend: claudeRaw.cliBackend ?? "stream-json",
    mcpEnabled: claudeRaw.mcpEnabled ?? true
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

function listGeminiSessions(settings) {
  const baseArgs = Array.isArray(settings.args) ? settings.args.map(String) : [];
  const listArgs = Array.isArray(settings.sessionListArgs)
    ? settings.sessionListArgs.map(String)
    : ["--list-sessions"];
  const args = [...baseArgs, ...listArgs];
  const result = runCliCapture(String(settings.command), args, {
    cwd: resolveFromCwd(settings.cwd ?? "."),
    timeoutMs: Number(settings.sessionListTimeoutMs ?? 15000)
  });
  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || `Gemini CLI exited with ${result.code}`).trim());
  }
  return filterActiveItems(parseGeminiSessions(result.stdout))
    .slice(0, Number(settings.sessionListLimit ?? 10));
}

function runCliCapture(command, args, { cwd, timeoutMs }) {
  const shell = shouldUseShell(command);
  const spawnArgs = shell && process.platform === "win32"
    ? args.map((arg) => quoteWindowsShellArg(arg))
    : args;
  const result = spawnSync(command, spawnArgs, {
    cwd,
    env: process.env,
    shell,
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(`Gemini session list timed out after ${timeoutMs}ms.`);
    }
    throw result.error;
  }
  return { code: result.status ?? 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function parseGeminiSessions(output) {
  const text = String(output ?? "").trim();
  if (!text) return [];
  const parsed = parseGeminiJsonSessions(text);
  if (parsed.length > 0) return parsed;
  const sessions = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\.\s+(.+?)(?:\s+\(([^)]*)\))?\s+\[([0-9a-fA-F-]{8,})\]\s*$/);
    if (!match) continue;
    sessions.push({
      id: match[4],
      resumeRef: match[1],
      name: trimOneLine(match[2], 80),
      preview: trimOneLine(match[2], 120),
      relativeTime: match[3] ?? "",
      source: "gemini-cli"
    });
  }
  return sessions;
}

function parseGeminiJsonSessions(text) {
  try {
    const body = JSON.parse(text);
    const rows = Array.isArray(body) ? body : body.sessions;
    if (!Array.isArray(rows)) return [];
    return rows.map((row, index) => ({
      id: String(row.id ?? row.sessionId ?? row.uuid ?? row.resumeRef ?? index + 1),
      resumeRef: String(row.index ?? row.resumeRef ?? row.id ?? row.sessionId ?? index + 1),
      name: trimOneLine(row.name ?? row.title ?? row.prompt ?? row.preview ?? `Gemini session ${index + 1}`, 80),
      preview: trimOneLine(row.preview ?? row.prompt ?? row.name ?? row.title ?? "", 120),
      updatedAt: row.updatedAt ?? row.lastUpdated,
      cwd: row.cwd ?? row.projectPath ?? row.workspacePath,
      archived: row.archived ?? row.isArchived,
      archivedAt: row.archivedAt,
      messages: row.messages ?? row.history,
      turns: row.turns,
      source: "gemini-cli"
    })).filter((session) => session.id);
  } catch {
    return [];
  }
}

function sessionHistoryOnSelectLimit(settings) {
  const value = Number(settings.sessionHistoryOnSelectLimit ?? settings.sessionSelectHistoryLimit ?? 1);
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(20, Math.floor(value)));
}

function geminiHistoryText(content) {
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

function geminiMessageHistoryItems(session, limit) {
  if (limit <= 0) return [];
  const raw = [];
  if (Array.isArray(session.messages)) raw.push(...session.messages);
  if (Array.isArray(session.turns)) {
    for (const turn of session.turns) {
      if (Array.isArray(turn.messages)) raw.push(...turn.messages);
      if (Array.isArray(turn.items)) raw.push(...turn.items);
    }
  }
  const items = raw.map((message) => {
    const role = String(message.role ?? message.author ?? message.type ?? "").toLowerCase();
    const text = geminiHistoryText(message.text ?? message.content ?? message.message);
    if (!text) return null;
    if (role.includes("user")) return { author: "user", text };
    if (role.includes("assistant") || role.includes("agent") || role.includes("model")) return { author: "agent", text };
    return null;
  }).filter(Boolean);
  if (items.length > 0) return items.slice(-limit);
  if (session.preview) return [{ author: "user", text: String(session.preview) }].slice(-limit);
  return [];
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
      const when = session.relativeTime ? ` (${session.relativeTime})` : session.updatedAt ? ` (${formatDateTime(session.updatedAt)})` : "";
      return `${index + 1}. ${title}${when} [${shortId(session.id)}]${active}`;
    })
  ].filter(Boolean).join("\n");
}

const GEMINI_PROJECT_OPTIONS = {
  defaultKey: "gemini-current-project",
  defaultLabel: "Current project",
  keyKeys: ["projectId", "metadata.projectId"],
  pathKeys: ["cwd", "projectPath", "workspacePath", "metadata.cwd", "metadata.projectPath", "metadata.workspacePath", "project", "metadata.project"],
  labelKeys: ["projectName", "workspaceName", "metadata.projectName"]
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
    const runtime = getAgentRuntime(config, config.geminiCli);
    this.startedAtMs = Date.now();
    this.afterMessageSeq = Number(runtime.afterMessageSeq ?? 0);
    this.primeOnFirstPoll = runtime.afterMessageSeq === undefined;
    this.config.runtimeMode = runtime.mode;
  }

  headers() {
    return this.relay?.secret ? { "x-legax-secret": this.relay.secret } : {};
  }

  async send(kind, text, metadata = {}) {
    const settings = this.config.geminiCli;
    const event = {
      id: crypto.randomUUID(),
      sessionId: this.config.sessionId,
      agentId: settings.agentId,
      agentLabel: settings.agentLabel,
      taskId: settings.taskId,
      source: "gemini-cli",
      sourceName: settings.agentLabel ?? this.config.displayName,
      kind,
      text,
      metadata: {
        agentId: settings.agentId,
        agentLabel: settings.agentLabel,
        taskId: settings.taskId,
        mode: this.config.runtimeMode ?? settings.mode,
        ...(process.env.LEGAX_DAEMON_HOST_ID ? { hostId: process.env.LEGAX_DAEMON_HOST_ID } : {}),
        ...selectedThreadMetadata(this.config, settings),
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
        url.searchParams.set("agentId", this.config.geminiCli.agentId);
        if (this.config.geminiCli.taskId) url.searchParams.set("taskId", this.config.geminiCli.taskId);
        const response = await httpJson(url, { headers: this.headers() }, this.relay.timeoutMs);
        rawMessages = response.messages ?? [];
      } catch (error) {
        process.stderr.write(`[legax] ${this.relay.name} poll failed: ${error.message}\n`);
      }
    }
    const inboundMessages = await pollInboundTransports(this.config, this.config.geminiCli, {
      drainOnly: daemonRouterManaged
    });
    const messages = filterAgentMessages(this.config, this.config.geminiCli, [...rawMessages, ...inboundMessages]);
    this.config.runtimeMode = applyControlMessages(this.config, this.config.geminiCli, messages, this.config.runtimeMode);
    const maxSeq = Math.max(this.afterMessageSeq, ...rawMessages.map((message) => Number(message.seq) || 0));
    this.afterMessageSeq = maxSeq;
    setAgentCursor(this.config, this.config.geminiCli, maxSeq);
    if (this.primeOnFirstPoll) {
      this.primeOnFirstPoll = false;
      return messagesCreatedAfter(messages, this.startedAtMs);
    }
    return messages;
  }
}

class GeminiCliLink {
  constructor(config) {
    this.config = config;
    this.relay = new RelayClient(config);
    this.queue = [];
    this.running = false;
    this.polling = false;
    this.lastText = "";
    this.sessionChoices = [];
    this.projectChoices = [];
    this.mode = config.runtimeMode ?? normalizeMode(config.geminiCli.mode ?? config.remote?.defaultMode);
    this.config.runtimeMode = this.mode;
    const selection = getAgentThreadSelection(this.config, this.config.geminiCli);
    if (selection.selectedThreadId) {
      this.config.geminiCli.useExisting = true;
      this.config.geminiCli.sessionId = "";
      this.config.geminiCli.resumeSession = selection.selectedThread?.resumeRef ?? selection.selectedThreadId;
    }
  }

  writeMcpConfig() {
    const settings = this.config.geminiCli;
    if (settings.mcpEnabled === false) return undefined;
    if (settings.mcpAutoConfigure === false) return undefined;
    const mcpConfigPath = settings.mcpConfigPath
      ? resolveConfigRelative(settings.mcpConfigPath, this.config.configPath)
      : path.resolve(resolveFromCwd(settings.cwd ?? "."), ".gemini", "settings.json");
    const mcpServerName = settings.mcpServerName ?? "legax";
    const body = readJsonIfExists(mcpConfigPath);
    body.mcpServers ??= {};
    body.mcpServers[mcpServerName] = {
      command: process.execPath,
      args: [packageAssetPath("scripts", "mcp-server.mjs")],
      env: {
        LEGAX_CONFIG: this.config.configPath,
        LEGAX_SECRET: process.env.LEGAX_SECRET ?? ""
      }
    };
    writeJsonFile(mcpConfigPath, body);
    return mcpConfigPath;
  }

  async start() {
    const mcpConfigPath = this.writeMcpConfig();
    await this.relay.send("status", "Gemini CLI link connected. Choose a session or send a message from the phone.", {
      adapter: "gemini-cli",
      command: this.config.geminiCli.command,
      mode: this.mode,
      mcpConfigPath,
      telegramSuppress: true,
      allowWhenPaused: true
    });
    this.startPolling();
  }

  startPolling() {
    if (this.polling) return;
    this.polling = true;
    const intervalMs = Number(this.config.geminiCli.pollIntervalMs ?? 1200);
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
              adapter: "gemini-cli",
              mode: this.mode,
              allowWhenPaused: true
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
      const nextMode = activateAgentInteractive(this.config, this.config.geminiCli, this.mode);
      this.mode = nextMode;
      this.config.runtimeMode = nextMode;
      await this.sendProjectMenu(message.page);
      return;
    }
    if (message.action === "list_agent_sessions") {
      const nextMode = activateAgentInteractive(this.config, this.config.geminiCli, this.mode);
      this.mode = nextMode;
      this.config.runtimeMode = nextMode;
      await this.sendSessionMenu(message.projectRef, message.page);
      return;
    }
    if (message.action === "select_session") {
      const nextMode = activateAgentInteractive(this.config, this.config.geminiCli, this.mode);
      this.mode = nextMode;
      this.config.runtimeMode = nextMode;
      await this.selectSession(message.threadRef);
      return;
    }
    if (message.action === "new_session") {
      const nextMode = activateAgentInteractive(this.config, this.config.geminiCli, this.mode);
      this.mode = nextMode;
      this.config.runtimeMode = nextMode;
      await this.newSession(message.projectPath ?? message.cwd);
      return;
    }
    if (message.action === "set_mode") {
      const nextMode = setAgentMode(this.config, this.config.geminiCli, message.mode);
      this.mode = nextMode;
      this.config.runtimeMode = nextMode;
      await this.relay.send("status", `Gemini CLI remote mode switched to ${nextMode}.`, {
        adapter: "gemini-cli",
        mode: nextMode,
        controlMessageId: message.id,
        allowWhenPaused: true
      });
    }
  }

  async sendProjectMenu(page = 1) {
    const settings = this.config.geminiCli;
    let sessions = [];
    try {
      sessions = listGeminiSessions(settings);
    } catch (error) {
      await this.relay.send("status", `Could not list Gemini CLI projects/chats: ${error.message}`, {
        adapter: "gemini-cli",
        mode: this.mode,
        telegramReplyMarkup: selectedSessionReplyMarkup(settings.agentId)
      });
      return;
    }
    this.projectChoices = buildProjectChoices(sessions, GEMINI_PROJECT_OPTIONS);
    this.sessionChoices = [];
    const pagination = paginateItems(this.projectChoices, { page, pageSize: 10 });
    await this.relay.send("status", `Remote mode is ${this.mode}.\n${formatProjectList(settings.agentLabel ?? "Gemini CLI", pagination.items, pagination)}`, {
      adapter: "gemini-cli",
      mode: this.mode,
      telegramReplyMarkup: projectsReplyMarkup(settings.agentId, this.projectChoices, {
        page: pagination.page
      })
    });
  }

  async sendSessionMenu(projectRef, page = 1) {
    const settings = this.config.geminiCli;
    let sessions = [];
    try {
      sessions = listGeminiSessions(settings);
    } catch (error) {
      await this.relay.send("status", `Could not list Gemini CLI sessions: ${error.message}`, {
        adapter: "gemini-cli",
        mode: this.mode,
        telegramReplyMarkup: selectedSessionReplyMarkup(settings.agentId)
      });
      return;
    }
    this.projectChoices = buildProjectChoices(sessions, GEMINI_PROJECT_OPTIONS);
    const project = resolveProjectChoice(projectRef, this.projectChoices);
    const visibleSessions = filterItemsByProject(sessions, project, GEMINI_PROJECT_OPTIONS);
    const pagination = paginateItems(visibleSessions, { page, pageSize: 10 });
    this.sessionChoices = pagination.items;
    if (sessions.length === 0) {
      await this.relay.send("status", `Remote mode is ${this.mode}.\nNo Gemini CLI sessions were found for the configured project. You can start a new session or create one locally.`, {
        adapter: "gemini-cli",
        mode: this.mode,
        telegramReplyMarkup: sessionsReplyMarkup(settings.agentId, [])
      });
      return;
    }
    if (visibleSessions.length === 0) {
      if (project?.isChat) {
        await this.relay.send("status", `Remote mode is ${this.mode}.\nNo Gemini CLI chat sessions were found. Start a new chat or choose another project/chat.`, {
          adapter: "gemini-cli",
          mode: this.mode,
          projectId: project.key,
          projectName: project.label,
          telegramReplyMarkup: sessionsReplyMarkup(settings.agentId, [], {
            projectRef: project.id
          })
        });
        return;
      }
      await this.relay.send("status", `Remote mode is ${this.mode}.\nNo Gemini CLI sessions were found for that project/chat.`, {
        adapter: "gemini-cli",
        mode: this.mode,
        telegramReplyMarkup: projectsReplyMarkup(settings.agentId, this.projectChoices)
      });
      return;
    }
    await this.relay.send("status", `Remote mode is ${this.mode}.\n${formatSessionList(settings.agentLabel ?? "Gemini CLI", pagination.items, settings.resumeSession, project, pagination)}`, {
      adapter: "gemini-cli",
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
      await this.relay.send("status", `Gemini CLI session not found: ${threadRef}. Refresh sessions and choose again.`, {
        adapter: "gemini-cli",
        mode: this.mode,
        telegramReplyMarkup: selectedSessionReplyMarkup(this.config.geminiCli.agentId)
      });
      return;
    }
    this.config.geminiCli.useExisting = true;
    this.config.geminiCli.sessionId = "";
    this.config.geminiCli.resumeSession = session.resumeRef ?? session.id;
    setAgentThreadSelection(this.config, this.config.geminiCli, session);
    await this.relay.send("status", `Gemini CLI session selected: ${session.name ?? shortId(session.id)}`, {
      adapter: "gemini-cli",
      mode: this.mode,
      threadId: session.id,
      threadTitle: session.name ?? session.preview,
      telegramReplyMarkup: selectedSessionReplyMarkup(this.config.geminiCli.agentId)
    });
    await this.sendSessionHistoryOnSelect(session);
  }

  async sendSessionHistoryOnSelect(session) {
    const settings = this.config.geminiCli;
    const limit = sessionHistoryOnSelectLimit(settings);
    const items = geminiMessageHistoryItems(session, limit);
    for (const item of items) {
      await this.relay.send("agent_text", item.text, {
        adapter: "gemini-cli",
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
    const choices = this.sessionChoices.length > 0 ? this.sessionChoices : listGeminiSessions(this.config.geminiCli);
    return choices.find((session) => session.id === value)
      ?? choices.find((session) => session.id?.startsWith(value))
      ?? choices.find((session) => session.resumeRef === value)
      ?? null;
  }

  async newSession(projectPath) {
    if (projectPath) this.config.geminiCli.cwd = resolveFromCwd(projectPath);
    this.config.geminiCli.useExisting = false;
    this.config.geminiCli.resumeSession = "";
    this.config.geminiCli.sessionId = "";
    setAgentThreadSelection(this.config, this.config.geminiCli, null);
    const suffix = projectPath ? ` in ${this.config.geminiCli.cwd}` : "";
    await this.relay.send("status", `New Gemini CLI session selected${suffix}. The next phone message will create fresh Gemini CLI history.`, {
      adapter: "gemini-cli",
      mode: this.mode,
      cwd: this.config.geminiCli.cwd,
      projectName: projectPath ? path.basename(this.config.geminiCli.cwd) : undefined,
      telegramReplyMarkup: selectedSessionReplyMarkup(this.config.geminiCli.agentId)
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
        await this.runGeminiTurn(prompt);
      }
    } finally {
      this.running = false;
    }
  }

  buildArgs(prompt) {
    return buildGeminiArgs(this.config.geminiCli, prompt);
  }

  async runGeminiTurn(prompt) {
    const settings = this.config.geminiCli;
    const args = this.buildArgs(prompt);
    await this.relay.send("status", "Gemini CLI turn started.", {
      adapter: "gemini-cli",
      promptLength: prompt.length
    });
    const command = String(settings.command);
    const shell = shouldUseShell(command);
    const spawnArgs = shell && process.platform === "win32"
      ? args.map((arg) => quoteWindowsShellArg(arg))
      : args;
    const child = spawn(command, spawnArgs, {
      cwd: resolveFromCwd(settings.cwd ?? "."),
      env: {
        ...process.env,
        ...(settings.trustWorkspace === true ? { GEMINI_CLI_TRUST_WORKSPACE: "true" } : {})
      },
      shell,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdoutBuffer = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      let newlineIndex;
      while ((newlineIndex = stdoutBuffer.indexOf("\n")) >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line) void this.handleGeminiLine(line);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(`[gemini-cli] ${chunk}`);
    });
    const exitCode = await new Promise((resolve) => {
      child.on("exit", (code, signal) => resolve(code ?? signal));
    });
    if (stdoutBuffer.trim()) await this.handleGeminiLine(stdoutBuffer.trim());
    if (exitCode !== 0) {
      await this.relay.send("status", `Gemini CLI exited with ${exitCode}. ${stderr}`.trim(), {
        adapter: "gemini-cli",
        exitCode
      });
    } else if (settings.forwardStatusEvents !== false) {
      await this.relay.send("status", "Gemini CLI turn completed.", {
        adapter: "gemini-cli",
        exitCode
      });
    }
  }

  async handleGeminiLine(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      if (this.config.geminiCli.forwardMessageEvents !== false) {
        await this.forwardText(line, { eventType: "text" });
      }
      return;
    }
    await this.handleGeminiEvent(event);
  }

  async handleGeminiEvent(event) {
    if (event.type === "init" && this.config.geminiCli.forwardStatusEvents !== false) {
      await this.relay.send("status", `Gemini CLI session initialized${event.model ? ` with ${event.model}` : ""}.`, {
        adapter: "gemini-cli",
        event
      });
      return;
    }
    if (event.type === "message" && this.config.geminiCli.forwardMessageEvents !== false) {
      const text = extractGeminiText(event);
      const role = event.role ?? event.message?.role ?? event.author ?? event.sender;
      if (text && (!role || role === "assistant" || role === "model")) {
        await this.forwardText(text, { eventType: event.type, role });
      }
      return;
    }
    if (event.type === "tool_use" && this.config.geminiCli.forwardToolEvents !== false) {
      await this.relay.send("status", formatGeminiToolUse(event), {
        adapter: "gemini-cli",
        eventType: event.type,
        event
      });
      return;
    }
    if (event.type === "tool_result" && this.config.geminiCli.forwardToolEvents !== false) {
      await this.relay.send("status", `Gemini CLI tool result: ${event.name ?? event.tool ?? "tool"}`, {
        adapter: "gemini-cli",
        eventType: event.type,
        event
      });
      return;
    }
    if (event.type === "result") {
      const text = event.response ?? event.result ?? event.text ?? event.message;
      if (typeof text === "string" && text && text !== this.lastText && this.config.geminiCli.forwardMessageEvents !== false) {
        await this.forwardText(text, { eventType: event.type });
      }
      return;
    }
    if (event.type === "error" && this.config.geminiCli.forwardStatusEvents !== false) {
      await this.relay.send("status", event.message ?? event.error?.message ?? JSON.stringify(event), {
        adapter: "gemini-cli",
        eventType: event.type,
        event
      });
    }
  }

  async forwardText(text, metadata = {}) {
    this.lastText = text;
    await this.relay.send("agent_text", text, {
      adapter: "gemini-cli",
      ...metadata
    });
  }

  stop() {
    this.polling = false;
  }
}

function extractGeminiText(event) {
  if (typeof event.text === "string") return event.text;
  if (typeof event.content === "string") return event.content;
  if (typeof event.delta === "string") return event.delta;
  if (typeof event.message?.content === "string") return event.message.content;
  const content = event.message?.content ?? event.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part === "string" ? part : part?.text)
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function formatGeminiToolUse(event) {
  const name = event.name ?? event.tool ?? event.tool_name ?? "tool";
  const args = event.args ?? event.arguments ?? event.input;
  return [
    `Gemini CLI tool use: ${name}`,
    args ? `Arguments: ${JSON.stringify(args, null, 2)}` : null,
    "Approval, if required, is controlled by Gemini CLI approval-mode."
  ].filter(Boolean).join("\n");
}

function shouldUseShell(command) {
  if (process.platform !== "win32") return false;
  if (path.isAbsolute(command)) return false;
  if (/\.(exe)$/i.test(command)) return false;
  return true;
}

function hasCliOption(args, optionName) {
  return args.some((arg) => arg === optionName || String(arg).startsWith(`${optionName}=`));
}

function buildGeminiArgs(settings, prompt) {
  const args = Array.isArray(settings.args) ? settings.args.map(String) : [];
  if (settings.approvalMode && !hasCliOption(args, "--approval-mode") && !hasCliOption(args, "--yolo")) {
    args.push("--approval-mode", String(settings.approvalMode));
  }
  if (settings.sessionId && !hasCliOption(args, "--session-id")) {
    args.push("--session-id", String(settings.sessionId));
  }
  const resumeTarget = settings.sessionId
    ? ""
    : settings.resumeSession || (settings.useExisting === true ? settings.resumeExisting : "");
  if (resumeTarget && !hasCliOption(args, "--resume")) {
    args.push("--resume", String(resumeTarget));
  }
  if (settings.promptFlag) args.push(String(settings.promptFlag), prompt);
  else args.push(prompt);
  return args;
}

function normalizeMode(value) {
  const mode = String(value ?? "interactive").trim();
  if (mode === "monitor" || mode === "approval-only" || mode === "paused") return mode;
  return "interactive";
}

function quoteWindowsShellArg(arg) {
  const value = String(arg);
  if (/["&|<>^%!\r\n]/.test(value)) {
    throw new Error("Unsafe Windows shell argument. Configure an absolute executable path or executable shim before passing shell metacharacters.");
  }
  if (value === "" || /[ \t()]/.test(value)) return `"${value}"`;
  return value;
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
      gemini: {
        agentId: config.geminiCli.agentId,
        agentLabel: config.geminiCli.agentLabel,
        mode: config.geminiCli.mode,
        cliBackend: config.geminiCli.cliBackend,
        mcpEnabled: config.geminiCli.mcpEnabled,
        supportsSessions: config.geminiCli.supportsSessions,
        useExisting: config.geminiCli.useExisting,
        command: config.geminiCli.command,
        args: config.geminiCli.args,
        effectiveArgsForPrompt: buildGeminiArgs(config.geminiCli, "<prompt>"),
        cwd: resolveFromCwd(config.geminiCli.cwd ?? "."),
        approvalMode: config.geminiCli.approvalMode,
        resumeSession: config.geminiCli.resumeSession,
        resumeExisting: config.geminiCli.resumeExisting,
        sessionListArgs: config.geminiCli.sessionListArgs,
        promptFlag: config.geminiCli.promptFlag,
        trustWorkspace: config.geminiCli.trustWorkspace
      }
    }, null, 2)}\n`);
    return;
  }
  if (config.remote?.enabled === false) {
    process.stderr.write("[legax] Legax remote control is disabled by config.\n");
    return;
  }

  const link = new GeminiCliLink(config);
  await link.start();
  process.stderr.write("[legax] Gemini CLI link is running.\n");
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
