const ONLINE = "online";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function decodePart(value) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    return String(value ?? "");
  }
}

function secondsAgo(value, nowMs) {
  const then = Date.parse(String(value ?? ""));
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, Math.floor((Number(nowMs) - then) / 1000));
  if (diff < 60) return `${diff}s ago`;
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function hostDisplayStatus(host, nowMs = Date.now()) {
  const id = cleanText(host?.id);
  const label = cleanText(host?.displayName) || id || "Unknown machine";
  const status = cleanText(host?.status).toLowerCase() || "offline";
  const online = status === ONLINE;
  const statusLabel = online ? "Online" : "Offline";
  const platform = cleanText(host?.capabilities?.platform);
  const arch = cleanText(host?.capabilities?.arch);
  const platformText = [platform, arch].filter(Boolean).join("/");
  const groups = Array.isArray(host?.groups) ? host.groups.map(cleanText).filter(Boolean).join(", ") : "";
  const seen = secondsAgo(host?.lastSeenAt ?? host?.updatedAt, nowMs);
  const parts = [
    id,
    platformText,
    groups,
    seen ? `seen ${seen}` : ""
  ].filter(Boolean);
  return {
    id,
    label,
    status,
    statusLabel,
    online,
    cliCount: Array.isArray(host?.adapters) ? host.adapters.length : 0,
    detail: parts.join(" · ")
  };
}

export function selectMachine(state, hostId) {
  return {
    ...state,
    selectedHostId: cleanText(hostId),
    selectedAgentId: "",
    selectedProjectKey: "",
    selectedThreadRef: ""
  };
}

export function buildComposerMessage(state, text) {
  const message = {
    type: "text",
    text: String(text ?? "")
  };
  if (cleanText(state?.selectedHostId)) message.targetHostId = cleanText(state.selectedHostId);
  if (cleanText(state?.selectedAgentId)) message.targetAgentId = cleanText(state.selectedAgentId);
  return message;
}

export function withTargetHost(message, state) {
  const hostId = cleanText(message?.targetHostId) || cleanText(state?.selectedHostId);
  return hostId ? { ...message, targetHostId: hostId } : message;
}

export function callbackDataToMessage(data, state = {}) {
  const value = String(data ?? "");
  if (value === "legax:agents") {
    return withTargetHost({ type: "control", action: "list_agents", text: "/start" }, state);
  }

  const hostAgent = value.match(/^legax:h:([^:]+):agent:([^:]+)$/);
  if (hostAgent) {
    const targetHostId = decodePart(hostAgent[1]);
    const agentId = decodePart(hostAgent[2]);
    return {
      targetHostId,
      targetAgentId: agentId,
      type: "control",
      action: "list_agent_projects",
      selectedAgentId: agentId,
      text: `/projects ${agentId}`
    };
  }

  const hostSessions = value.match(/^legax:h:([^:]+):sessions:([^:]+)$/);
  if (hostSessions) {
    const targetHostId = decodePart(hostSessions[1]);
    const agentId = decodePart(hostSessions[2]);
    return {
      targetHostId,
      targetAgentId: agentId,
      type: "control",
      action: "list_agent_sessions",
      selectedAgentId: agentId,
      text: `/sessions ${agentId}`
    };
  }

  const hostProjects = value.match(/^legax:h:([^:]+):projects:([^:]+)(?::(\d+))?$/);
  if (hostProjects) {
    const targetHostId = decodePart(hostProjects[1]);
    const agentId = decodePart(hostProjects[2]);
    return {
      targetHostId,
      targetAgentId: agentId,
      type: "control",
      action: "list_agent_projects",
      selectedAgentId: agentId,
      page: hostProjects[3] ? Number(hostProjects[3]) : undefined,
      text: `/projects ${agentId}`
    };
  }

  const hostSession = value.match(/^legax:h:([^:]+):session:([^:]+):(.+)$/);
  if (hostSession) {
    const targetHostId = decodePart(hostSession[1]);
    const agentId = decodePart(hostSession[2]);
    const threadRef = decodePart(hostSession[3]);
    return {
      targetHostId,
      targetAgentId: agentId,
      type: "control",
      action: "select_session",
      selectedAgentId: agentId,
      threadRef,
      text: `/use ${agentId} ${threadRef}`
    };
  }

  const hostProject = value.match(/^legax:h:([^:]+):(project|chat):([^:]+):([^:]+)(?::(\d+))?$/);
  if (hostProject) {
    const targetHostId = decodePart(hostProject[1]);
    const agentId = decodePart(hostProject[3]);
    const projectRef = decodePart(hostProject[4]);
    return {
      targetHostId,
      targetAgentId: agentId,
      type: "control",
      action: "list_agent_sessions",
      selectedAgentId: agentId,
      projectRef,
      page: hostProject[5] ? Number(hostProject[5]) : undefined,
      text: `/sessions ${agentId} ${projectRef}`
    };
  }

  const hostNew = value.match(/^legax:h:([^:]+):new:([^:]+)$/);
  if (hostNew) {
    const targetHostId = decodePart(hostNew[1]);
    const agentId = decodePart(hostNew[2]);
    return {
      targetHostId,
      targetAgentId: agentId,
      type: "control",
      action: "new_session",
      selectedAgentId: agentId,
      text: `/new ${agentId}`
    };
  }

  const hostNewProject = value.match(/^legax:h:([^:]+):new-project:([^:]+)$/);
  if (hostNewProject) {
    const targetHostId = decodePart(hostNewProject[1]);
    const agentId = decodePart(hostNewProject[2]);
    return {
      targetHostId,
      targetAgentId: "legax-daemon",
      type: "control",
      action: "new_project_preflight",
      selectedAgentId: agentId,
      text: `/new-project ${agentId}`
    };
  }

  return null;
}
