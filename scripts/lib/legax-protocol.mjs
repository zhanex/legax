import crypto from "node:crypto";

export const LEGAX_PROTOCOL_VERSION = 1;

export const LEGAX_EVENT_KINDS = Object.freeze([
  "active_context",
  "approval_request",
  "input_request",
  "agent_summary",
  "session_list",
  "attention_item"
]);

const EVENT_KIND_SET = new Set(LEGAX_EVENT_KINDS);
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function normalizeLegaxEvent(event = {}) {
  const sessionId = String(event.sessionId ?? "").trim();
  const kind = String(event.kind ?? "").trim();
  return {
    v: Number(event.v ?? LEGAX_PROTOCOL_VERSION),
    id: event.id ?? `legax_evt_${crypto.randomBytes(12).toString("base64url")}`,
    kind,
    sessionId,
    agentId: String(event.agentId ?? "").trim(),
    agentLabel: event.agentLabel ? String(event.agentLabel) : "",
    projectId: event.projectId ? String(event.projectId) : "",
    projectName: event.projectName ? String(event.projectName) : "",
    threadId: event.threadId ? String(event.threadId) : "",
    threadName: event.threadName ? String(event.threadName) : "",
    text: typeof event.text === "string" ? event.text : "",
    metadata: event.metadata && typeof event.metadata === "object" ? event.metadata : {},
    createdAt: event.createdAt ?? new Date().toISOString()
  };
}

export function validateLegaxEvent(event = {}) {
  if (Number(event.v ?? LEGAX_PROTOCOL_VERSION) !== LEGAX_PROTOCOL_VERSION) {
    throw new Error(`unsupported Legax protocol version: ${event.v}`);
  }
  const kind = String(event.kind ?? "");
  if (!EVENT_KIND_SET.has(kind)) {
    throw new Error(`unsupported Legax event kind: ${kind || "(missing)"}`);
  }
  if (!SESSION_ID_PATTERN.test(String(event.sessionId ?? ""))) {
    throw new Error("Legax event sessionId must be 1-64 characters of letters, numbers, dot, underscore, or dash");
  }
  if (event.agentId !== undefined && typeof event.agentId !== "string") {
    throw new Error("Legax event agentId must be a string when present");
  }
  if (event.metadata !== undefined && (event.metadata === null || typeof event.metadata !== "object" || Array.isArray(event.metadata))) {
    throw new Error("Legax event metadata must be an object when present");
  }
  return event;
}

export function createAttentionItem(event, overrides = {}) {
  const requestId = event.metadata?.requestId ?? event.requestId ?? "";
  const type = overrides.type ?? event.metadata?.attentionType ?? event.kind;
  return {
    id: overrides.id ?? `${type}:${requestId || event.id || event.seq}`,
    type,
    priority: overrides.priority ?? "normal",
    sessionId: event.sessionId,
    agentId: event.agentId ?? "",
    agentLabel: event.agentLabel ?? "",
    requestId,
    eventId: event.id ?? "",
    eventSeq: event.seq ?? 0,
    text: event.text ?? "",
    metadata: event.metadata ?? {},
    createdAt: event.createdAt ?? new Date().toISOString()
  };
}
