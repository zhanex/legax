import {
  drainAgentInboxMessages,
  enqueueAgentInboxMessages,
  activateAgentInteractive,
  getAgentTransportCursor,
  getTransportSelection,
  isBroadcastTarget,
  requestAgentLaunch,
  setAgentCursor,
  setAgentTransportCursor,
  setTransportSelection
} from "./runtime-state.mjs";

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

function transportKey(transport) {
  return `${transport.type}:${transport.name ?? "telegram"}`;
}

function telegramApiUrl(transport, token, method) {
  const baseUrl = String(transport.apiBaseUrl ?? "https://api.telegram.org/bot").replace(/\/+$/, "");
  return `${baseUrl}${token}/${method}`;
}

function defaultTarget(config, transport, agent) {
  const selected = getTransportSelection(config, transportKey(transport));
  if (selected.targetAgentId) return selected.targetAgentId;
  const configured = transport.defaultTarget ?? config.routing?.defaultTarget;
  if (!configured || configured === "none") return "";
  if (configured === "self") return agent.agentId;
  return String(configured);
}

function telegramPollerAgentId(config, transport, agent) {
  return String(
    transport.pollerAgentId
      ?? config.routing?.telegramPollerAgentId
      ?? (config.codex?.enabled !== false ? config.codex?.agentId : undefined)
      ?? (config.codexAppServer?.enabled !== false ? config.codexAppServer?.agentId : undefined)
      ?? agent.agentId
  );
}

function knownAgentIds(config, currentAgent) {
  const configuredAgents = Array.isArray(config.agents)
    ? config.agents.map((agent) => agent.agentId ?? agent.id)
    : [];
  return [
    ...configuredAgents,
    config.codex?.agentId,
    config.claude?.agentId,
    config.gemini?.agentId,
    config.opencode?.agentId,
    config.codexAppServer?.agentId,
    config.claudeCode?.agentId,
    config.geminiCli?.agentId,
    currentAgent?.agentId
  ].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index);
}

function telegramCreatedAt(message) {
  const timestamp = Number(message?.date);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp * 1000).toISOString()
    : new Date().toISOString();
}

function targetFromRequestId(requestId, fallbackTargetAgentId) {
  const value = String(requestId ?? "");
  if (value.startsWith("codex-")) return "codex-cli";
  if (value.startsWith("claude-")) return "claude-code";
  return fallbackTargetAgentId;
}

function codexCommandTarget(targetAgentId) {
  return targetAgentId || "codex-cli";
}

function decodeCallbackPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseCallbackPage(value) {
  const page = Number(value);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : undefined;
}

function parseTelegramCallback(data, updateId, targetAgentId, createdAt, pollerAgentId) {
  const value = String(data ?? "").trim();
  if (value === "legax:agents") {
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "list_agents",
      targetAgentId: pollerAgentId,
      text: "/start",
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  const selectAgent = value.match(/^legax:agent:([^:]+)$/);
  if (selectAgent) {
    const agentId = decodeCallbackPart(selectAgent[1]);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "list_agent_projects",
      targetAgentId: agentId,
      selectedAgentId: agentId,
      text: `/projects ${agentId}`,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  const listProjects = value.match(/^legax:projects:([^:]+)(?::(\d+))?$/);
  if (listProjects) {
    const agentId = decodeCallbackPart(listProjects[1]);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "list_agent_projects",
      targetAgentId: agentId,
      selectedAgentId: agentId,
      page: parseCallbackPage(listProjects[2]),
      text: `/projects ${agentId}`,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  const listProjectSessions = value.match(/^legax:(?:project|chat):([^:]+):([^:]+)(?::(\d+))?$/);
  if (listProjectSessions) {
    const agentId = decodeCallbackPart(listProjectSessions[1]);
    const projectRef = decodeCallbackPart(listProjectSessions[2]);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "list_agent_sessions",
      targetAgentId: agentId,
      selectedAgentId: agentId,
      projectRef,
      page: parseCallbackPage(listProjectSessions[3]),
      text: `/sessions ${agentId} ${projectRef}`,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  const listSessions = value.match(/^legax:sessions:([^:]+)$/);
  if (listSessions) {
    const agentId = decodeCallbackPart(listSessions[1]);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "list_agent_sessions",
      targetAgentId: agentId,
      selectedAgentId: agentId,
      text: `/sessions ${agentId}`,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  const newGenericSession = value.match(/^legax:new:([^:]+)$/);
  if (newGenericSession) {
    const agentId = decodeCallbackPart(newGenericSession[1]);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "new_session",
      targetAgentId: agentId,
      selectedAgentId: agentId,
      text: `/new ${agentId}`,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  const newProject = value.match(/^legax:new-project:([^:]+)$/);
  if (newProject) {
    const agentId = decodeCallbackPart(newProject[1]);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "new_project_preflight",
      targetAgentId: pollerAgentId,
      selectedAgentId: agentId,
      text: `/new-project ${agentId}`,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  const selectSession = value.match(/^legax:session:([^:]+):(.+)$/);
  if (selectSession) {
    const agentId = decodeCallbackPart(selectSession[1]);
    const threadRef = decodeCallbackPart(selectSession[2]);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "select_session",
      targetAgentId: agentId,
      selectedAgentId: agentId,
      threadRef,
      text: `/use ${agentId} ${threadRef}`,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  if (value === "legax:codex:sessions") {
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "list_agent_sessions",
      targetAgentId: codexCommandTarget(targetAgentId),
      text: "/sessions",
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  if (value === "legax:codex:new") {
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "new_session",
      targetAgentId: codexCommandTarget(targetAgentId),
      text: "/new",
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  const useThread = value.match(/^legax:codex:use:(.+)$/);
  if (useThread) {
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "select_session",
      targetAgentId: codexCommandTarget(targetAgentId),
      threadRef: useThread[1],
      text: `/use ${useThread[1]}`,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  const approval = value.match(/^legax:(approve|deny):(.+)$/);
  if (approval) {
    const requestId = decodeCallbackPart(approval[2]);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "permission_decision",
      targetAgentId: targetFromRequestId(requestId, targetAgentId),
      requestId,
      decision: approval[1] === "approve" ? "approve" : "deny",
      text: approval[1] === "approve" ? "Approved from Telegram" : "Denied from Telegram",
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  return null;
}

function parseTelegramText(text, updateId, targetAgentId, createdAt, pollerAgentId) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;

  if (/^\/(?:start|agents|menu)(?:@\w+)?\s*$/i.test(trimmed)) {
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "list_agents",
      targetAgentId: pollerAgentId,
      text: trimmed,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }

  const targeted = trimmed.match(/^\/to(?:@\w+)?\s+([A-Za-z0-9_.:-]+)\s+([\s\S]+)/i);
  if (targeted) {
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "text",
      targetAgentId: targeted[1],
      text: targeted[2].trim(),
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }

  const mode = trimmed.match(/^\/mode(?:@\w+)?\s+([A-Za-z0-9_.:-]+)\s+(interactive|approval-only|monitor|paused)$/i);
  if (mode) {
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "set_mode",
      targetAgentId: mode[1],
      mode: mode[2],
      text: trimmed,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }

  const projects = trimmed.match(/^\/(?:projects|chats)(?:@\w+)?(?:\s+([A-Za-z0-9_.:-]+))?\s*$/i);
  if (projects) {
    const agentId = projects[1] ?? codexCommandTarget(targetAgentId);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "list_agent_projects",
      targetAgentId: agentId,
      selectedAgentId: agentId,
      text: trimmed,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }

  const sessions = trimmed.match(/^\/(?:sessions|threads)(?:@\w+)?(?:\s+([A-Za-z0-9_.:-]+))?(?:\s+(\S+))?\s*$/i);
  if (sessions) {
    const agentId = sessions[1] ?? codexCommandTarget(targetAgentId);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "list_agent_sessions",
      targetAgentId: agentId,
      selectedAgentId: agentId,
      projectRef: sessions[2],
      text: trimmed,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }

  const useThread = trimmed.match(/^\/use(?:@\w+)?\s+(?:(codex-cli|claude-code|gemini-cli|opencode)\s+)?(\S+)/i);
  if (useThread) {
    const agentId = useThread[1] ?? codexCommandTarget(targetAgentId);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "select_session",
      targetAgentId: agentId,
      selectedAgentId: agentId,
      threadRef: useThread[2],
      text: trimmed,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }

  const newSession = trimmed.match(/^\/new(?:@\w+)?(?:\s+([A-Za-z0-9_.:-]+))?\s*$/i);
  if (newSession) {
    const agentId = newSession[1] ?? codexCommandTarget(targetAgentId);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "new_session",
      targetAgentId: agentId,
      selectedAgentId: agentId,
      text: trimmed,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }

  const newProject = trimmed.match(/^\/new-project(?:@\w+)?(?:\s+([A-Za-z0-9_.:-]+))?\s*$/i);
  if (newProject) {
    const agentId = newProject[1] ?? codexCommandTarget(targetAgentId);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "new_project_preflight",
      targetAgentId: pollerAgentId,
      selectedAgentId: agentId,
      text: trimmed,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }

  const approve = trimmed.match(/^\/approve(?:@\w+)?\s+([A-Za-z0-9_-]+)/i);
  if (approve) {
    const requestId = approve[1];
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "permission_decision",
      targetAgentId: targetFromRequestId(requestId, targetAgentId),
      requestId,
      decision: "approve",
      text: trimmed,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }

  const deny = trimmed.match(/^\/deny(?:@\w+)?\s+([A-Za-z0-9_-]+)/i);
  if (deny) {
    const requestId = deny[1];
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "permission_decision",
      targetAgentId: targetFromRequestId(requestId, targetAgentId),
      requestId,
      decision: "deny",
      text: trimmed,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }

  const answer = trimmed.match(/^\/answer(?:@\w+)?\s+([A-Za-z0-9_-]+)\s+([\s\S]+)/i);
  if (answer) {
    const requestId = answer[1];
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "user_input_response",
      targetAgentId: targetFromRequestId(requestId, targetAgentId),
      requestId,
      text: answer[2].trim(),
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }

  if (!targetAgentId) return null;
  return {
    id: `telegram:${updateId}`,
    transport: "telegram",
    type: "text",
    targetAgentId,
    text: trimmed,
    createdAt,
    receivedAt: new Date().toISOString()
  };
}

async function pollTelegram(config, agent, transport, options = {}) {
  const token = transport.botToken;
  const chatId = transport.chatId;
  if (!token || !chatId) return [];

  const key = transportKey(transport);
  const pollerAgentId = options.forcePoll === true
    ? agent.agentId
    : telegramPollerAgentId(config, transport, agent);
  if (options.forcePoll !== true && agent.agentId !== pollerAgentId) {
    return drainAgentInboxMessages(config, agent);
  }

  const cursorAgent = options.cursorAgent ?? agent;
  const cursor = getAgentTransportCursor(config, cursorAgent, key) ?? {};
  const response = await httpJson(telegramApiUrl(transport, token, "getUpdates"), {
    method: "POST",
    body: JSON.stringify({
      offset: cursor.offset ?? undefined,
      timeout: 0,
      limit: 20,
      allowed_updates: ["message", "edited_message", "callback_query"]
    })
  }, Number(transport.timeoutMs ?? 15000));

  const messages = [];
  let nextOffset = cursor.offset;
  const targetAgentId = defaultTarget(config, transport, agent);
  for (const update of response.result ?? []) {
    nextOffset = Math.max(Number(nextOffset ?? 0), Number(update.update_id) + 1);
    const callback = update.callback_query;
    if (callback?.data) {
      const chat = callback.message?.chat ?? callback.from;
      if (String(chat?.id) !== String(chatId)) continue;
      const parsed = parseTelegramCallback(callback.data, update.update_id, targetAgentId, new Date().toISOString(), pollerAgentId);
      if (parsed) messages.push(parsed);
      if (callback.id) {
        void httpJson(telegramApiUrl(transport, token, "answerCallbackQuery"), {
          method: "POST",
          body: JSON.stringify({ callback_query_id: callback.id })
        }, Number(transport.timeoutMs ?? 15000)).catch(() => {});
      }
      continue;
    }
    const message = update.message ?? update.edited_message;
    if (!message?.text) continue;
    if (String(message.chat?.id) !== String(chatId)) continue;
    const parsed = parseTelegramText(message.text, update.update_id, targetAgentId, telegramCreatedAt(message), pollerAgentId);
    if (parsed) messages.push(parsed);
  }
  const routed = routeInboundMessages(config, agent, messages, {
    transportKey: key,
    drain: options.drain !== false
  });
  if (nextOffset !== cursor.offset) {
    setAgentTransportCursor(config, cursorAgent, key, { offset: nextOffset });
  }
  return routed;
}

export async function pollInboundTransports(config, agent, options = {}) {
  if (options.drainOnly === true) {
    return drainAgentInboxMessages(config, agent);
  }
  const messages = [];
  for (const transport of Array.isArray(config.transports) ? config.transports : []) {
    if (transport.enabled === false) continue;
    if (transport.type !== "telegram") continue;
    try {
      messages.push(...await pollTelegram(config, agent, transport, options));
    } catch (error) {
      process.stderr.write(`[legax] ${transport.name ?? transport.type} inbound poll failed: ${error.message}\n`);
    }
  }
  return messages;
}

export function routeInboundMessages(config, agent, messages, options = {}) {
  const expanded = expandBroadcastMessages(config, agent, messages);
  requestLaunchesForMessages(config, agent, expanded);
  if (options.transportKey) {
    updateTransportSelectionFromMessages(config, options.transportKey, expanded);
  }
  if (options.updateAgentCursors === true) {
    updateAgentCursorsFromMessages(config, expanded);
  }
  const currentMessages = expanded.filter((message) => message.targetAgentId === agent.agentId);
  const queuedMessages = expanded.filter((message) => message.targetAgentId && message.targetAgentId !== agent.agentId);
  enqueueAgentInboxMessages(config, queuedMessages);
  const drained = options.drain === false ? [] : drainAgentInboxMessages(config, agent);
  return [...drained, ...currentMessages];
}

function updateAgentCursorsFromMessages(config, messages) {
  const maxSeqByAgent = new Map();
  for (const message of messages) {
    const agentId = String(message.targetAgentId ?? "").trim();
    const seq = Number(message.seq);
    if (!agentId || !Number.isFinite(seq) || seq <= 0) continue;
    maxSeqByAgent.set(agentId, Math.max(maxSeqByAgent.get(agentId) ?? 0, seq));
  }
  for (const [agentId, maxSeq] of maxSeqByAgent.entries()) {
    setAgentCursor(config, { agentId }, maxSeq);
  }
}

function expandBroadcastMessages(config, agent, messages) {
  const agents = knownAgentIds(config, agent);
  const expanded = [];
  for (const message of messages) {
    if (!isBroadcastTarget(message.targetAgentId)) {
      expanded.push(message);
      continue;
    }
    for (const agentId of agents) {
      expanded.push({
        ...message,
        id: `${message.id}:${agentId}`,
        targetAgentId: agentId
      });
    }
  }
  return expanded;
}

function updateTransportSelectionFromMessages(config, key, messages) {
  for (const message of messages) {
    if (message.type !== "control") continue;
    if (message.action === "list_agent_projects") {
      setTransportSelection(config, key, {
        targetAgentId: message.targetAgentId
      });
    }
    if (message.action === "list_agent_sessions") {
      setTransportSelection(config, key, {
        targetAgentId: message.targetAgentId,
        selectedProjectRef: message.projectRef
      });
    }
    if (message.action === "select_session") {
      setTransportSelection(config, key, {
        targetAgentId: message.targetAgentId,
        selectedThreadId: message.threadRef
      });
    }
  }
}

function requestLaunchesForMessages(config, agent, messages) {
  const knownAgents = new Set(knownAgentIds(config, agent));
  for (const message of messages) {
    const targetAgentId = String(message.targetAgentId ?? "").trim();
    if (!targetAgentId || targetAgentId === agent.agentId || isBroadcastTarget(targetAgentId)) continue;
    if (!knownAgents.has(targetAgentId)) continue;
    if (!messageShouldWakeAgent(message)) continue;
    if (message.type === "text") {
      activateAgentInteractive(config, { agentId: targetAgentId });
    }
    requestAgentLaunch(config, targetAgentId, {
      source: message.transport ?? "inbound",
      reason: message.type === "control" ? message.action : message.type,
      messageId: message.id,
      text: message.text,
      projectPath: message.projectPath,
      cwd: message.cwd
    });
  }
}

function messageShouldWakeAgent(message) {
  if (message.type === "text") return true;
  if (message.type !== "control") return false;
  return [
    "list_agent_projects",
    "list_agent_sessions",
    "select_session",
    "new_session",
    "set_mode"
  ].includes(message.action);
}
