const TELEGRAM_METHODS = new Set([
  "answerCallbackQuery",
  "deleteMessage",
  "editMessageText",
  "getChat",
  "getMe",
  "getUpdates",
  "pinChatMessage",
  "sendMessage"
]);

function isLoopbackHostname(hostname) {
  const value = String(hostname ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost"
    || value === "::1"
    || value === "0:0:0:0:0:0:0:1"
    || /^127(?:\.\d{1,3}){3}$/.test(value);
}

function telegramApiBaseUrl(transport) {
  const raw = String(transport?.apiBaseUrl ?? "https://api.telegram.org/bot").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("invalid Telegram apiBaseUrl");
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Telegram apiBaseUrl must use HTTPS or loopback HTTP.");
  }
  if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
    throw new Error("Telegram apiBaseUrl must use HTTPS or loopback HTTP.");
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/+$/, "");
}

export function telegramApiUrl(transport, token, method) {
  const safeMethod = String(method ?? "");
  if (!TELEGRAM_METHODS.has(safeMethod)) throw new Error(`unsupported Telegram method: ${safeMethod}`);
  const safeToken = String(token ?? "").trim();
  if (!/^[A-Za-z0-9:_-]{1,256}$/.test(safeToken)) throw new Error("invalid Telegram bot token");
  return `${telegramApiBaseUrl(transport)}${safeToken}/${safeMethod}`;
}

export function telegramCreatedAt(message) {
  const timestamp = Number(message?.date);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp * 1000).toISOString()
    : new Date().toISOString();
}

export function telegramTransportKey(transport) {
  return `telegram:${transport.name ?? "telegram"}`;
}

export function telegramUpdateId(update) {
  const updateId = Number(update?.update_id);
  return Number.isFinite(updateId) ? Math.trunc(updateId) : null;
}

export function telegramUpdateMessage(update) {
  return update?.message ?? update?.edited_message ?? null;
}

export function telegramUpdateChatId(update) {
  const callback = update?.callback_query;
  if (callback) return callback.message?.chat?.id ?? callback.from?.id ?? "";
  return telegramUpdateMessage(update)?.chat?.id ?? "";
}

export function telegramUpdateCreatedAt(update) {
  const message = telegramUpdateMessage(update);
  return message ? telegramCreatedAt(message) : new Date().toISOString();
}

export function parseTelegramCallback(data, updateId, targetAgentId, createdAt, pollerAgentId) {
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
  const hostAgent = value.match(/^legax:h:([^:]+):agent:([^:]+)$/);
  if (hostAgent) {
    const hostId = decodeCallbackPart(hostAgent[1]);
    const agentId = decodeCallbackPart(hostAgent[2]);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "list_agent_projects",
      targetHostId: hostId,
      targetAgentId: agentId,
      selectedAgentId: agentId,
      text: `/projects ${agentId}`,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  const hostListProjects = value.match(/^legax:h:([^:]+):projects:([^:]+)(?::(\d+))?$/);
  if (hostListProjects) {
    const hostId = decodeCallbackPart(hostListProjects[1]);
    const agentId = decodeCallbackPart(hostListProjects[2]);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "list_agent_projects",
      targetHostId: hostId,
      targetAgentId: agentId,
      selectedAgentId: agentId,
      page: parseCallbackPage(hostListProjects[3]),
      text: `/projects ${agentId}`,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  const hostListSessions = value.match(/^legax:h:([^:]+):sessions:([^:]+)$/);
  if (hostListSessions) {
    const hostId = decodeCallbackPart(hostListSessions[1]);
    const agentId = decodeCallbackPart(hostListSessions[2]);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "list_agent_sessions",
      targetHostId: hostId,
      targetAgentId: agentId,
      selectedAgentId: agentId,
      text: `/sessions ${agentId}`,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  const hostProject = value.match(/^legax:h:([^:]+):(project|chat):([^:]+):([^:]+)(?::(\d+))?$/);
  if (hostProject) {
    const hostId = decodeCallbackPart(hostProject[1]);
    const agentId = decodeCallbackPart(hostProject[3]);
    const projectRef = decodeCallbackPart(hostProject[4]);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "list_agent_sessions",
      targetHostId: hostId,
      targetAgentId: agentId,
      selectedAgentId: agentId,
      projectRef,
      page: parseCallbackPage(hostProject[5]),
      text: `/sessions ${agentId} ${projectRef}`,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  const hostSession = value.match(/^legax:h:([^:]+):session:([^:]+):(.+)$/);
  if (hostSession) {
    const hostId = decodeCallbackPart(hostSession[1]);
    const agentId = decodeCallbackPart(hostSession[2]);
    const threadRef = decodeCallbackPart(hostSession[3]);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "select_session",
      targetHostId: hostId,
      targetAgentId: agentId,
      selectedAgentId: agentId,
      threadRef,
      text: `/use ${agentId} ${threadRef}`,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  const hostNew = value.match(/^legax:h:([^:]+):new:([^:]+)$/);
  if (hostNew) {
    const hostId = decodeCallbackPart(hostNew[1]);
    const agentId = decodeCallbackPart(hostNew[2]);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "new_session",
      targetHostId: hostId,
      targetAgentId: agentId,
      selectedAgentId: agentId,
      text: `/new ${agentId}`,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  const hostNewProject = value.match(/^legax:h:([^:]+):new-project:([^:]+)$/);
  if (hostNewProject) {
    const hostId = decodeCallbackPart(hostNewProject[1]);
    const agentId = decodeCallbackPart(hostNewProject[2]);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "control",
      action: "new_project_preflight",
      targetHostId: hostId,
      targetAgentId: "legax-daemon",
      selectedAgentId: agentId,
      text: `/new-project ${agentId}`,
      createdAt,
      receivedAt: new Date().toISOString()
    };
  }
  const hostApproval = value.match(/^legax:h:([^:]+):(approve|deny):(.+)$/);
  if (hostApproval) {
    const hostId = decodeCallbackPart(hostApproval[1]);
    const action = hostApproval[2];
    const requestId = decodeCallbackPart(hostApproval[3]);
    return {
      id: `telegram:${updateId}`,
      transport: "telegram",
      type: "permission_decision",
      targetHostId: hostId,
      targetAgentId: targetFromRequestId(requestId, targetAgentId),
      requestId,
      decision: action,
      text: action === "approve" ? "Approved from Telegram" : "Denied from Telegram",
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

export function parseTelegramText(text, updateId, targetAgentId, createdAt, pollerAgentId) {
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

export function parseTelegramUpdate(update, {
  targetAgentId = "",
  pollerAgentId = "legax-daemon",
  createdAt = telegramUpdateCreatedAt(update)
} = {}) {
  const updateId = telegramUpdateId(update);
  if (updateId == null) return null;
  const callback = update.callback_query;
  if (callback?.data) {
    return parseTelegramCallback(callback.data, updateId, targetAgentId, createdAt, pollerAgentId);
  }
  const message = telegramUpdateMessage(update);
  if (!message?.text) return null;
  return parseTelegramText(message.text, updateId, targetAgentId, telegramCreatedAt(message), pollerAgentId);
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
