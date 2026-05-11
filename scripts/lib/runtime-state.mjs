import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { defaultConfigPath, packageRoot, resolveRuntimeFile } from "./paths.mjs";

const BROADCAST_TARGETS = new Set(["*", "all", "broadcast"]);
const LOCK_STALE_MS = Number(process.env.LEGAX_LOCK_STALE_MS ?? 10_000);
const LOCK_MAX_ATTEMPTS = 500; // ~10s at 20ms — generous for E2E parallelism on slow CI runners

export function resolveFromRoot(value) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(packageRoot, value);
}

export function normalizeMode(value) {
  const mode = String(value ?? "interactive").trim();
  if (mode === "interactive" || mode === "approval-only" || mode === "monitor" || mode === "paused") return mode;
  return "interactive";
}

export function normalizeApprovals(raw = {}) {
  return {
    enabled: true,
    allowFromPhone: true,
    timeoutMs: 300000,
    defaultOnTimeout: "deny",
    ...raw
  };
}

export function runtimeStatePath(config) {
  return resolveRuntimeFile(config?.runtimeStatePath, config?.configPath ?? defaultConfigPath(), "runtime-state.json");
}

export function loadRuntimeState(config) {
  const filePath = runtimeStatePath(config);
  if (!fs.existsSync(filePath)) {
    return { version: 1, sessions: {} };
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function saveRuntimeState(config, state) {
  const filePath = runtimeStatePath(config);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Random suffix ensures two processes that happen to share a PID (containers,
  // recycled PIDs on Windows) cannot collide on the same temp filename.
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameWithRetry(tmpPath, filePath);
}

// All mutators (read-modify-write of runtime state) must go through this helper
// so concurrent adapter processes do not lose each other's writes. We use an
// on-disk lockfile created with O_EXCL: only one process can hold it at a time.
// A lockfile older than LOCK_STALE_MS is assumed to be orphaned by a crashed
// process and is force-taken; this keeps the system live without manual cleanup
// at the cost of a tiny window where two processes could race past a stale lock.
export function mutateRuntimeState(config, mutator) {
  const filePath = runtimeStatePath(config);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  const lockBody = `${process.pid}:${crypto.randomUUID()}`;
  let lockFd = null;

  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      lockFd = fs.openSync(lockPath, "wx");
      fs.writeSync(lockFd, lockBody);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      // Stale lock recovery: if the existing lockfile is older than threshold,
      // remove it and retry on the next iteration.
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
      }
      sleepSync(20);
    }
  }
  if (lockFd === null) throw new Error(`runtime-state: could not acquire lock at ${lockPath} after ${LOCK_MAX_ATTEMPTS} attempts`);

  try {
    const state = loadRuntimeState(config);
    const result = mutator(state);
    saveRuntimeState(config, state);
    return result;
  } finally {
    try { fs.closeSync(lockFd); } catch { /* ignore */ }
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
  }
}

function renameWithRetry(tmpPath, filePath) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.renameSync(tmpPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (!["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
      sleepSync(20 * (attempt + 1));
    }
  }
  throw lastError;
}

function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function sessionState(state, sessionId) {
  const key = sessionId || "default";
  state.sessions[key] ??= { agents: {} };
  return state.sessions[key];
}

function agentState(state, sessionId, agentId) {
  const session = sessionState(state, sessionId);
  const key = agentId || "agent";
  session.agents[key] ??= {};
  return session.agents[key];
}

export function getAgentRuntime(config, agent) {
  const state = loadRuntimeState(config);
  const current = agentState(state, config.sessionId, agent.agentId);
  return {
    mode: normalizeMode(current.mode ?? agent.mode ?? config.remote?.defaultMode),
    afterMessageSeq: current.afterMessageSeq,
    state
  };
}

export function getAgentThreadSelection(config, agent) {
  const state = loadRuntimeState(config);
  const current = agentState(state, config.sessionId, agent.agentId);
  return {
    selectedThreadId: current.selectedThreadId,
    selectedThread: current.selectedThread
  };
}

export function setAgentThreadSelection(config, agent, thread) {
  mutateRuntimeState(config, (state) => {
    const current = agentState(state, config.sessionId, agent.agentId);
    if (thread?.id) {
      current.selectedThreadId = thread.id;
      current.selectedThread = summarizeThread(thread);
    } else {
      delete current.selectedThreadId;
      delete current.selectedThread;
    }
    current.updatedAt = new Date().toISOString();
  });
}

export function getTransportSelection(config, transportKey) {
  const state = loadRuntimeState(config);
  const session = sessionState(state, config.sessionId);
  return session.transportSelections?.[transportKey] ?? {};
}

export function setTransportSelection(config, transportKey, selection) {
  mutateRuntimeState(config, (state) => {
    const session = sessionState(state, config.sessionId);
    session.transportSelections ??= {};
    session.transportSelections[transportKey] = {
      ...(session.transportSelections[transportKey] ?? {}),
      ...selection,
      updatedAt: new Date().toISOString()
    };
  });
}

export function enqueueAgentInboxMessages(config, messages) {
  const deliverable = messages.filter((message) => message?.targetAgentId);
  if (deliverable.length === 0) return;
  mutateRuntimeState(config, (state) => {
    for (const message of deliverable) {
      const current = agentState(state, config.sessionId, message.targetAgentId);
      current.inbox ??= [];
      current.inbox.push({
        ...message,
        queuedAt: new Date().toISOString()
      });
      current.updatedAt = new Date().toISOString();
    }
  });
}

export function drainAgentInboxMessages(config, agent) {
  return mutateRuntimeState(config, (state) => {
    const current = agentState(state, config.sessionId, agent.agentId);
    const messages = current.inbox ?? [];
    current.inbox = [];
    current.updatedAt = new Date().toISOString();
    return messages;
  });
}

export function setAgentCursor(config, agent, afterMessageSeq) {
  mutateRuntimeState(config, (state) => {
    agentState(state, config.sessionId, agent.agentId).afterMessageSeq = Number(afterMessageSeq) || 0;
  });
}

export function setAgentMode(config, agent, mode) {
  const nextMode = normalizeMode(mode);
  mutateRuntimeState(config, (state) => {
    const current = agentState(state, config.sessionId, agent.agentId);
    current.mode = nextMode;
    current.updatedAt = new Date().toISOString();
  });
  return nextMode;
}

export function activateAgentInteractive(config, agent, fallbackMode) {
  return mutateRuntimeState(config, (state) => {
    const current = agentState(state, config.sessionId, agent.agentId);
    const mode = normalizeMode(current.mode ?? fallbackMode ?? agent.mode ?? config.remote?.defaultMode);
    if (mode === "paused") return mode;
    current.mode = "interactive";
    current.updatedAt = new Date().toISOString();
    return "interactive";
  });
}

export function getAgentTransportCursor(config, agent, transportKey) {
  const state = loadRuntimeState(config);
  const current = agentState(state, config.sessionId, agent.agentId);
  return current.transportCursors?.[transportKey];
}

export function setAgentTransportCursor(config, agent, transportKey, cursor) {
  mutateRuntimeState(config, (state) => {
    const current = agentState(state, config.sessionId, agent.agentId);
    current.transportCursors ??= {};
    current.transportCursors[transportKey] = cursor;
    current.updatedAt = new Date().toISOString();
  });
}

export function requestAgentLaunch(config, agentId, request = {}) {
  const targetAgentId = String(agentId ?? "").trim();
  if (!targetAgentId || isBroadcastTarget(targetAgentId)) return;
  mutateRuntimeState(config, (state) => {
    const session = sessionState(state, config.sessionId);
    session.launchRequests ??= {};
    session.launchRequests[targetAgentId] = {
      agentId: targetAgentId,
      requestedAt: new Date().toISOString(),
      ...request
    };
  });
}

export function takeAgentLaunchRequests(config) {
  return mutateRuntimeState(config, (state) => {
    const session = state.sessions?.[config.sessionId || "default"];
    if (!session?.launchRequests) return [];
    const requests = Object.values(session.launchRequests ?? {});
    if (requests.length === 0) return [];
    session.launchRequests = {};
    return requests;
  });
}

export function isBroadcastTarget(value) {
  return BROADCAST_TARGETS.has(String(value ?? "").trim());
}

export function messageTargetsAgent(message, agent, config = {}) {
  const target = String(message.targetAgentId ?? message.agentId ?? message.target ?? "").trim();
  if (!target) return false;
  if (isBroadcastTarget(target)) {
    if (message.type === "control") return config.routing?.allowControlBroadcast !== false;
    return config.routing?.allowBroadcast === true;
  }
  if (target !== agent.agentId) return false;
  return !agent.taskId || !message.taskId || message.taskId === agent.taskId;
}

export function applyControlMessages(config, agent, messages, currentMode) {
  let mode = normalizeMode(currentMode ?? agent.mode ?? config.remote?.defaultMode);
  for (const message of messages) {
    if (message.type !== "control" || message.action !== "set_mode") continue;
    if (!messageTargetsAgent(message, agent, config)) continue;
    mode = setAgentMode(config, agent, message.mode);
  }
  return mode;
}

export function filterAgentMessages(config, agent, messages) {
  return messages.filter((message) => messageTargetsAgent(message, agent, config));
}

export function messagesCreatedAfter(messages, startedAtMs) {
  return messages.filter((message) => {
    if (message.queuedAt) return true;
    if (isFreshLaunchControl(message)) return true;
    const createdAtMs = Date.parse(message.createdAt ?? "");
    return Number.isFinite(createdAtMs) && createdAtMs >= startedAtMs;
  });
}

function isFreshLaunchControl(message) {
  if (message?.type !== "control") return false;
  return [
    "list_agents",
    "list_agent_projects",
    "list_agent_sessions",
    "select_session",
    "new_session",
    "open_project",
    "set_mode"
  ].includes(message.action);
}

export function canAcceptText(config, mode) {
  return config.remote?.enabled !== false
    && config.remote?.pauseAll !== true
    && normalizeMode(mode) === "interactive";
}

export function canAcceptApproval(config, mode) {
  const approvals = normalizeApprovals(config.approvals);
  return config.remote?.enabled !== false
    && config.remote?.pauseAll !== true
    && approvals.enabled !== false
    && approvals.allowFromPhone !== false
    && (normalizeMode(mode) === "interactive" || normalizeMode(mode) === "approval-only");
}

export function timeoutDecision(config) {
  const approvals = normalizeApprovals(config.approvals);
  return approvals.defaultOnTimeout === "approve" ? "approve" : "deny";
}

function summarizeThread(thread) {
  return {
    id: thread.id,
    name: thread.name ?? null,
    preview: thread.preview ?? null,
    resumeRef: thread.resumeRef ?? null,
    cwd: thread.cwd ?? null,
    updatedAt: thread.updatedAt ?? null,
    createdAt: thread.createdAt ?? null,
    source: thread.source ?? null
  };
}
