import { hierarchyRows } from "./menu-groups.mjs";

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

function enabledTransports(config) {
  return (Array.isArray(config.transports) ? config.transports : [])
    .filter((transport) => transport.enabled !== false);
}

function firstText(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function basename(value) {
  const normalized = String(value || "").replace(/[\\/]+$/, "");
  if (!normalized) return "";
  return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
}

function agentName(event) {
  return event.agentLabel ?? event.agentId ?? "Agent";
}

function kindName(kind) {
  if (kind === "permission_request") return "Approval";
  if (kind === "user_input_request") return "Input";
  if (kind === "status") return "Status";
  return "Message";
}

function sessionName(event) {
  return firstText([
    event.metadata?.threadTitle,
    event.metadata?.threadName,
    event.metadata?.threadId,
    event.metadata?.sessionId
  ]);
}

function projectName(event) {
  const raw = firstText([
    event.metadata?.projectName,
    event.metadata?.project,
    event.metadata?.projectId,
    event.metadata?.repoName,
    event.metadata?.repository,
    event.metadata?.projectPath,
    event.metadata?.workspacePath,
    event.metadata?.workspace,
    event.metadata?.cwd
  ]);
  return raw ? basename(raw) : "";
}

function cleanEventText(text) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  while (lines.length && /^\[Legax\b/i.test(lines[0].trim())) lines.shift();
  while (lines.length && /^Session:\s+/i.test(lines[0].trim())) lines.shift();
  return lines.join("\n").trim();
}

function contextHeader(event) {
  return [
    `Legax - ${agentName(event)} - ${kindName(event.kind)}`,
    projectName(event) ? `Project: ${projectName(event)}` : undefined,
    sessionName(event) ? `Session: ${sessionName(event)}` : undefined
  ].filter(Boolean);
}

function joinMessage(lines, text) {
  const body = lines.filter(Boolean);
  if (text) body.push("", text);
  return body.join("\n");
}

function formatChatMessage(event) {
  const header = contextHeader(event);
  const text = cleanEventText(event.text);
  if (event.kind === "permission_request") {
    const requestId = event.metadata?.requestId;
    return joinMessage([
      ...header,
      event.metadata?.title ? `Title: ${event.metadata.title}` : undefined,
      requestId ? `Request id: ${requestId}` : undefined,
      requestId ? `Reply: /approve ${requestId} or /deny ${requestId}` : undefined
    ], text);
  }
  if (event.kind === "user_input_request") {
    const requestId = event.metadata?.requestId;
    return joinMessage([
      ...header,
      event.metadata?.title ? `Title: ${event.metadata.title}` : undefined,
      requestId ? `Request id: ${requestId}` : undefined,
      requestId && !String(event.text ?? "").includes(`/answer ${requestId}`)
        ? `Reply: /answer ${requestId} <answer>`
        : undefined
    ], text);
  }
  return joinMessage(header, text);
}

const TELEGRAM_HARD_LIMIT = 4096;
const DEFAULT_TELEGRAM_MAX_CHARS = 3900;
const DEFAULT_TELEGRAM_MAX_PARTS = 8;
const pinnedTelegramContexts = new Map();
const feishuTenantTokenCache = new Map();

function normalizeMessageDetail(value) {
  const detail = String(value ?? "all").trim().toLowerCase();
  if (["off", "none", "silent", "disabled", "false"].includes(detail)) return "none";
  if (["minimal", "action", "actions", "actionable", "requests", "request"].includes(detail)) return "actionable";
  if (["final", "finals", "conclusion", "conclusions", "result", "results"].includes(detail)) return "final";
  if (["important", "essential", "smart", "summary"].includes(detail)) return "important";
  if (["all", "full", "verbose", "debug", "everything"].includes(detail)) return "all";
  return "all";
}

function stripAgentPolicies(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const {
    agents,
    perAgent,
    agentOverrides,
    relay,
    telegram,
    feishu,
    webhook,
    relayNotifications,
    telegramNotifications,
    feishuNotifications,
    webhookNotifications,
    ...rest
  } = value;
  return rest;
}

function eventAgentKeys(event) {
  return [
    event.agentId,
    event.metadata?.agentId,
    event.metadata?.adapter,
    event.source
  ].filter(Boolean).map(String);
}

function agentPolicyFrom(value, event) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const policies = value.perAgent;
  if (!policies || typeof policies !== "object" || Array.isArray(policies)) return {};
  for (const key of eventAgentKeys(event)) {
    const override = policies[key];
    if (override && typeof override === "object" && !Array.isArray(override)) return override;
  }
  return {};
}

const AGENT_NOTIFICATION_SECTIONS = [
  {
    keys: ["daemon"],
    agentIds: ["legax-daemon"],
    aliases: ["daemon", "legax-daemon"]
  },
  {
    keys: ["mcp"],
    agentIds: ["mcp-agent"],
    aliases: ["mcp", "mcp-agent"]
  },
  {
    keys: ["codex", "codexAppServer"],
    agentIds: ["codex-cli"],
    aliases: ["codex", "codex-app-server"]
  },
  {
    keys: ["claude", "claudeCode"],
    agentIds: ["claude-code"],
    aliases: ["claude", "claude-code"]
  },
  {
    keys: ["gemini", "geminiCli"],
    agentIds: ["gemini-cli"],
    aliases: ["gemini", "gemini-cli"]
  },
  {
    keys: ["opencode"],
    agentIds: ["opencode"],
    aliases: ["opencode", "open-code"]
  },
  {
    keys: ["codexDesktopMirror"],
    agentIds: ["codex-desktop"],
    aliases: ["codex-desktop", "codex-desktop-mirror"]
  }
];

function normalizedKeys(values) {
  return new Set(values.filter(Boolean).map((value) => String(value).toLowerCase()));
}

function matchingAgentSections(config, event) {
  const eventKeys = normalizedKeys(eventAgentKeys(event));
  const sections = [];
  const seen = new Set();
  for (const candidate of AGENT_NOTIFICATION_SECTIONS) {
    const configured = candidate.keys
      .map((key) => config[key])
      .filter((value) => value && typeof value === "object" && !Array.isArray(value));
    const candidateKeys = normalizedKeys([
      ...candidate.keys,
      ...candidate.agentIds,
      ...candidate.aliases,
      ...configured.map((section) => section.agentId)
    ]);
    if (![...eventKeys].some((key) => candidateKeys.has(key))) continue;
    for (const section of configured) {
      if (seen.has(section)) continue;
      seen.add(section);
      sections.push(section);
    }
  }
  for (const value of Object.values(config)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (!value.agentId || !eventKeys.has(String(value.agentId).toLowerCase())) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    sections.push(value);
  }
  return sections;
}

function notificationObjects(value, transportType) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const type = String(transportType ?? "").trim();
  return [
    value,
    type ? value[type] : undefined,
    type ? value[`${type}Notifications`] : undefined
  ].filter((item) => item && typeof item === "object" && !Array.isArray(item));
}

function applyPolicySource(policy, source, transportType, event) {
  let next = policy;
  for (const object of notificationObjects(source, transportType)) {
    next = {
      ...next,
      ...stripAgentPolicies(object),
      ...agentPolicyFrom(object, event)
    };
  }
  return next;
}

function agentNotificationSources(config, event) {
  const out = [];
  for (const section of matchingAgentSections(config, event)) {
    out.push(section, section.notifications, section.notification);
  }
  return out;
}

function telegramNotificationPolicy(config, transport, event) {
  let policy = {
    messageDetail: "all",
    maxMessageChars: DEFAULT_TELEGRAM_MAX_CHARS,
    maxParts: DEFAULT_TELEGRAM_MAX_PARTS,
    splitLongMessages: true,
    format: "html",
    disableWebPagePreview: true
  };
  const sources = [
    config.notifications,
    config.notification,
    config.daemon,
    config.daemon?.notifications,
    config.daemon?.notification,
    config.remote,
    config.remote?.notifications,
    config.remote?.notification,
    ...agentNotificationSources(config, event),
    transport,
    transport.notifications,
    transport.notification,
    transport.telegramNotifications
  ];
  for (const source of sources) {
    policy = applyPolicySource(policy, source, transport.type, event);
  }
  return policy;
}

function telegramMaxChars(policy) {
  const raw = policy.maxMessageChars
    ?? policy.maxCharsPerMessage
    ?? policy.maxMessageLength
    ?? policy.maxChars
    ?? DEFAULT_TELEGRAM_MAX_CHARS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TELEGRAM_MAX_CHARS;
  return Math.max(500, Math.min(TELEGRAM_HARD_LIMIT, Math.floor(value)));
}

function telegramMaxParts(policy) {
  const value = Number(policy.maxParts ?? DEFAULT_TELEGRAM_MAX_PARTS);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TELEGRAM_MAX_PARTS;
  return Math.max(1, Math.floor(value));
}

function hasReplyMarkup(event) {
  return Boolean(event.metadata?.telegramReplyMarkup ?? event.metadata?.replyMarkup);
}

function suppressTelegram(event) {
  return event.metadata?.telegramSuppress === true
    || event.metadata?.skipTelegram === true
    || event.metadata?.telegram === false;
}

function isActionableEvent(event) {
  return event.kind === "permission_request" || event.kind === "user_input_request" || hasReplyMarkup(event);
}

function isFinalAgentText(event) {
  if (event.kind !== "agent_text") return false;
  return event.metadata?.deliveryReason === "turn_completed"
    || event.metadata?.eventType === "result"
    || event.metadata?.completionStatus
    || event.metadata?.final === true;
}

function isImportantStatus(event) {
  if (event.kind !== "status") return false;
  if (hasReplyMarkup(event)) return true;
  if (event.metadata?.eventType === "error" || event.metadata?.eventType === "warning") return true;
  if (event.metadata?.exitCode && event.metadata.exitCode !== 0) return true;
  return /\b(error|failed|failure|denied|ignored|timeout|timed out|exited|not found|cannot|can't)\b/i.test(String(event.text ?? ""));
}

function isExplicitImportantEvent(event) {
  return event.metadata?.telegramImportant === true
    || event.metadata?.important === true;
}

function shouldSendTelegramEvent(policy, event) {
  const detail = normalizeMessageDetail(policy.messageDetail);
  if (detail === "none") return false;
  if (detail === "all") return true;
  if (detail === "actionable") return isActionableEvent(event);
  if (detail === "final") return isFinalAgentText(event);
  return isActionableEvent(event) || isFinalAgentText(event) || isImportantStatus(event) || isExplicitImportantEvent(event);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function htmlCode(value) {
  return `<code>${escapeHtml(value)}</code>`;
}

function telegramApiUrl(transport, token, method) {
  const baseUrl = String(transport.apiBaseUrl ?? "https://api.telegram.org/bot").replace(/\/+$/, "");
  return `${baseUrl}${token}/${method}`;
}

function feishuApiBaseUrl(transport) {
  if (transport.apiBaseUrl) return String(transport.apiBaseUrl).replace(/\/+$/, "");
  const platform = String(transport.platform ?? transport.region ?? "").trim().toLowerCase();
  if (["lark", "global", "intl", "international"].includes(platform)) return "https://open.larksuite.com";
  return "https://open.feishu.cn";
}

function feishuNotificationPolicy(config, transport, event) {
  let policy = {
    messageDetail: "all",
    format: "interactive"
  };
  const sources = [
    config.notifications,
    config.notification,
    config.daemon,
    config.daemon?.notifications,
    config.daemon?.notification,
    config.remote,
    config.remote?.notifications,
    config.remote?.notification,
    ...agentNotificationSources(config, event),
    transport,
    transport.notifications,
    transport.notification,
    transport.feishuNotifications
  ];
  for (const source of sources) {
    policy = applyPolicySource(policy, source, transport.type, event);
  }
  return policy;
}

function suppressFeishu(event) {
  return event.metadata?.feishuSuppress === true
    || event.metadata?.skipFeishu === true
    || event.metadata?.feishu === false;
}

function shouldSendFeishuEvent(policy, event) {
  const detail = normalizeMessageDetail(policy.messageDetail);
  if (detail === "none") return false;
  if (detail === "all") return true;
  if (detail === "actionable") return isActionableEvent(event);
  if (detail === "final") return isFinalAgentText(event);
  return isActionableEvent(event) || isFinalAgentText(event) || isImportantStatus(event) || isExplicitImportantEvent(event);
}

function truncatePlainText(text, maxLength = 3800) {
  const value = String(text ?? "");
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 49)).trimEnd()}\n\n[truncated; open the relay UI for the full text]`;
}

function larkMdEscape(value) {
  return String(value ?? "").replaceAll("\\", "\\\\");
}

function formatFeishuTitle(event) {
  return `${compactHeaderValue(agentName(event), 60)} ${kindName(event.kind)}`;
}

function formatFeishuText(event) {
  return truncatePlainText(formatChatMessage(event));
}

function formatFeishuCardContext(event) {
  return [
    projectName(event) ? `**Project:** ${larkMdEscape(compactHeaderValue(projectName(event), 120))}` : undefined,
    sessionName(event) ? `**Session:** ${larkMdEscape(compactHeaderValue(sessionName(event), 120))}` : undefined,
    workingDirectory(event) ? `**Dir:** ${larkMdEscape(compactHeaderValue(workingDirectory(event), 180))}` : undefined
  ].filter(Boolean).join("\n");
}

function feishuCardButton(text, type, value) {
  return {
    tag: "button",
    text: {
      tag: "plain_text",
      content: text
    },
    type,
    value
  };
}

function formatFeishuCard(event) {
  const requestId = event.metadata?.requestId;
  const body = cleanEventText(event.text);
  const elements = [];
  const context = formatFeishuCardContext(event);
  if (context) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: context
      }
    });
  }
  if (event.metadata?.title || requestId) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: [
          event.metadata?.title ? `**Title:** ${larkMdEscape(compactHeaderValue(event.metadata.title, 160))}` : undefined,
          requestId ? `**Request:** \`${larkMdEscape(compactHeaderValue(requestId, 120))}\`` : undefined
        ].filter(Boolean).join("\n")
      }
    });
  }
  if (body) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: truncatePlainText(body, 3000)
      }
    });
  }
  if (event.kind === "permission_request" && requestId) {
    const targetAgentId = event.metadata?.targetAgentId ?? event.metadata?.agentId ?? event.agentId;
    elements.push({
      tag: "action",
      actions: [
        feishuCardButton("Approve", "primary", {
          legaxAction: "approve",
          requestId,
          targetAgentId
        }),
        feishuCardButton("Deny", "danger", {
          legaxAction: "deny",
          requestId,
          targetAgentId
        })
      ]
    });
  }
  return {
    config: {
      wide_screen_mode: true
    },
    header: {
      template: event.kind === "permission_request" ? "orange" : "blue",
      title: {
        tag: "plain_text",
        content: formatFeishuTitle(event)
      }
    },
    elements
  };
}

async function feishuTenantAccessToken(transport) {
  if (transport.tenantAccessToken) return String(transport.tenantAccessToken);
  const appId = transport.appId ?? transport.app_id;
  const appSecret = transport.appSecret ?? transport.app_secret;
  if (!appId) throw new Error("Feishu transport missing appId (set transports[].appId inline in config.yaml).");
  if (!appSecret) throw new Error("Feishu transport missing appSecret (set transports[].appSecret inline in config.yaml).");

  const baseUrl = feishuApiBaseUrl(transport);
  const cacheKey = `${baseUrl}|${appId}`;
  const cached = feishuTenantTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const body = await httpJson(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret
    })
  }, Number(transport.timeoutMs ?? 15000));
  if (Number(body.code ?? 0) !== 0 || !body.tenant_access_token) {
    throw new Error(`Feishu tenant_access_token failed: ${body.msg ?? body.error ?? JSON.stringify(body).slice(0, 300)}`);
  }
  const token = String(body.tenant_access_token);
  const expireMs = Math.max(60_000, Number(body.expire ?? 7200) * 1000);
  feishuTenantTokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + expireMs
  });
  return token;
}

function compactHeaderValue(value, maxLength = 120) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function workingDirectory(event) {
  return firstText([
    event.metadata?.cwd,
    event.metadata?.workspacePath,
    event.metadata?.workspace,
    event.metadata?.projectPath
  ]);
}

function formatTelegramContextLines(event) {
  const cwd = workingDirectory(event);
  return [
    cwd ? `Dir: ${htmlCode(compactHeaderValue(cwd, 180))}` : undefined,
    projectName(event) ? `Project: ${htmlCode(compactHeaderValue(projectName(event)))}` : undefined,
    sessionName(event) ? `Session: ${htmlCode(compactHeaderValue(sessionName(event)))}` : undefined
  ].filter(Boolean);
}

function formatTelegramHeader(event, { partIndex = 1, partCount = 1 } = {}) {
  const part = partCount > 1 ? ` (${partIndex}/${partCount})` : "";
  const lines = [
    `<b>${escapeHtml(compactHeaderValue(agentName(event), 80))}</b> <i>${escapeHtml(`${kindName(event.kind)}${part}`)}</i>`,
    ...formatTelegramContextLines(event)
  ];
  if (event.kind === "permission_request" || event.kind === "user_input_request") {
    const requestId = event.metadata?.requestId;
    if (event.metadata?.title) lines.push(`Title: ${escapeHtml(compactHeaderValue(event.metadata.title))}`);
    if (requestId) lines.push(`Request: ${htmlCode(compactHeaderValue(requestId))}`);
    if (event.kind === "permission_request" && requestId) {
      lines.push(`Reply: ${htmlCode(`/approve ${requestId}`)} or ${htmlCode(`/deny ${requestId}`)}`);
    } else if (event.kind === "user_input_request" && requestId && !String(event.text ?? "").includes(`/answer ${requestId}`)) {
      lines.push(`Reply: ${htmlCode(`/answer ${requestId} <answer>`)}`);
    }
  }
  return lines.filter(Boolean).join("\n");
}

function telegramBodyLabel(event, body) {
  const author = String(event.metadata?.author ?? event.metadata?.role ?? event.metadata?.messageRole ?? "").toLowerCase();
  if (event.kind === "agent_text" && ["user", "human"].includes(author)) return "User message";
  if (event.kind === "agent_text") return "Agent response";
  if (event.kind === "permission_request") return "Approval request";
  if (event.kind === "user_input_request") return "Input request";
  if (event.kind === "status" && /\bsession selected\b/i.test(body)) return "Selection";
  if (event.kind === "status") return "Status update";
  return "Message";
}

function formatTelegramBody(event, text) {
  const body = cleanEventText(text);
  if (!body) return "";
  return `<b>${escapeHtml(telegramBodyLabel(event, body))}</b>\n<blockquote>${escapeHtml(body)}</blockquote>`;
}

function formatTelegramHtmlMessage(event, text, partInfo) {
  const header = formatTelegramHeader(event, partInfo);
  const body = formatTelegramBody(event, text);
  return body ? `${header}\n\n${body}` : header;
}

function trimToPreferredBreak(text, length) {
  if (length >= text.length) return text.length;
  const floor = Math.max(0, Math.floor(length * 0.65));
  const slice = text.slice(0, length);
  const breaks = [
    slice.lastIndexOf("\n\n"),
    slice.lastIndexOf("\n"),
    slice.lastIndexOf(". "),
    slice.lastIndexOf(" ")
  ].filter((index) => index > floor);
  return breaks.length > 0 ? Math.max(...breaks) + 1 : length;
}

function fitTelegramPrefixLength(event, text, maxChars) {
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = formatTelegramHtmlMessage(event, text.slice(0, mid), {
      partIndex: 999,
      partCount: 999
    });
    if (candidate.length <= maxChars) low = mid;
    else high = mid - 1;
  }
  return low;
}

function truncateTelegramBody(event, text, maxChars, partInfo = { partIndex: 1, partCount: 1 }) {
  const suffix = "\n\n[truncated; open the relay UI for the full text]";
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = formatTelegramHtmlMessage(event, `${text.slice(0, mid).trimEnd()}${suffix}`, partInfo);
    if (candidate.length <= maxChars) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low).trimEnd()}${suffix}`;
}

function splitTelegramBody(event, text, policy) {
  const maxChars = telegramMaxChars(policy);
  const maxParts = telegramMaxParts(policy);
  const full = formatTelegramHtmlMessage(event, text, { partIndex: 1, partCount: 1 });
  if (full.length <= maxChars) return [text];
  if (policy.splitLongMessages === false || policy.overflow === "truncate") {
    return [truncateTelegramBody(event, text, maxChars)];
  }
  const chunks = [];
  let remaining = text;
  while (remaining && chunks.length < maxParts) {
    const fit = fitTelegramPrefixLength(event, remaining, maxChars);
    if (fit <= 0) {
      chunks.push(truncateTelegramBody(event, remaining, maxChars, {
        partIndex: 999,
        partCount: 999
      }));
      remaining = "";
      break;
    }
    const length = chunks.length + 1 === maxParts
      ? fit
      : trimToPreferredBreak(remaining, fit);
    chunks.push(remaining.slice(0, length).trimEnd());
    remaining = remaining.slice(length).trimStart();
  }
  if (remaining && chunks.length > 0) {
    chunks[chunks.length - 1] = truncateTelegramBody(event, `${chunks[chunks.length - 1]}\n\n${remaining}`, maxChars, {
      partIndex: 999,
      partCount: 999
    });
  }
  return chunks.length > 0 ? chunks : [truncateTelegramBody(event, text, maxChars)];
}

function formatTelegramMessages(event, policy) {
  if (String(policy.format ?? "html").toLowerCase() === "plain") {
    const text = formatChatMessage(event);
    const maxChars = telegramMaxChars(policy);
    if (text.length <= maxChars) return [text];
    if (policy.splitLongMessages === false || policy.overflow === "truncate") {
      return [`${text.slice(0, Math.max(0, maxChars - 55)).trimEnd()}\n\n[truncated; open the relay UI for the full text]`];
    }
    const chunks = [];
    let remaining = text;
    while (remaining && chunks.length < telegramMaxParts(policy)) {
      const length = trimToPreferredBreak(remaining, Math.min(maxChars, remaining.length));
      chunks.push(remaining.slice(0, length).trimEnd());
      remaining = remaining.slice(length).trimStart();
    }
    if (remaining && chunks.length > 0) {
      const suffix = "\n\n[truncated; open the relay UI for the full text]";
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1].slice(0, Math.max(0, maxChars - suffix.length)).trimEnd()}${suffix}`;
    }
    return chunks;
  }
  const body = cleanEventText(event.text);
  const chunks = splitTelegramBody(event, body, policy);
  const partCount = chunks.length;
  return chunks.map((chunk, index) => formatTelegramHtmlMessage(event, chunk, {
    partIndex: index + 1,
    partCount
  }));
}

function telegramContextCacheKey(transport) {
  return [
    transport.name ?? "telegram",
    transport.apiBaseUrl ?? "https://api.telegram.org/bot",
    transport.chatId
  ].map(String).join("|");
}

function activeTelegramContext(event) {
  const agentId = firstText([event.metadata?.agentId, event.agentId]);
  if (!agentId || agentId === "legax-daemon") return null;
  const cli = firstText([
    event.metadata?.agentLabel,
    event.agentLabel,
    agentId
  ]);
  if (!cli) return null;
  const context = {
    cli,
    project: projectName(event),
    session: sessionName(event),
    dir: workingDirectory(event)
  };
  const hasStableSession = Boolean(event.metadata?.threadId || event.metadata?.sessionId);
  const hasTargetDetail = Boolean(
    context.project
      || context.dir
      || hasStableSession
      || event.metadata?.projectId
      || event.metadata?.projectRef
      || hasReplyMarkup(event)
  );
  return hasTargetDetail ? context : null;
}

function shouldPinActiveContext(policy, event) {
  if (policy.pinActiveContext === false || policy.pinnedActiveContext === false) return false;
  if (event.metadata?.telegramPinContext === false || event.metadata?.pinActiveContext === false) return false;
  return Boolean(activeTelegramContext(event));
}

function shouldRepinActiveContext(policy, event) {
  if (policy.repinActiveContext === false || policy.refreshActiveContextPin === false) return false;
  if (event.metadata?.telegramRepinContext === false || event.metadata?.repinActiveContext === false) return false;
  if (event.metadata?.telegramRepinContext === true || event.metadata?.repinActiveContext === true) return true;
  if (event.kind !== "status") return false;
  return /\b(?:selected\b.*\bsession\b|\bsession\b.*\bselected\b)/i.test(String(event.text ?? ""));
}

function formatActiveTelegramContext(event) {
  const context = activeTelegramContext(event);
  if (!context) return "";
  const activeLabel = context.session || context.project || context.cli;
  return [
    `<b>active:</b> ${htmlCode(compactHeaderValue(activeLabel, 160))}`,
    context.project ? `Project: ${htmlCode(compactHeaderValue(context.project, 120))}` : undefined,
    `CLI: ${htmlCode(compactHeaderValue(context.cli, 100))}`,
    context.dir ? `Dir: ${htmlCode(compactHeaderValue(context.dir, 180))}` : undefined
  ].filter(Boolean).join("\n");
}

function activeTelegramContextKey(event) {
  const context = activeTelegramContext(event);
  return context ? JSON.stringify(context) : "";
}

function isLegaxPinnedMessage(message) {
  const text = String(message?.text ?? message?.caption ?? "");
  return /\bActive Legax target\b/i.test(text) || /^active\s*(?::|\uFF1A)/i.test(text.trim());
}

async function getTelegramPinnedContext(transport, token) {
  const body = await httpJson(telegramApiUrl(transport, token, "getChat"), {
    method: "POST",
    body: JSON.stringify({
      chat_id: transport.chatId
    })
  }, Number(transport.timeoutMs ?? 15000));
  const pinned = body?.result?.pinned_message;
  if (!pinned?.message_id) return null;
  return {
    messageId: pinned.message_id,
    isLegax: isLegaxPinnedMessage(pinned)
  };
}

async function editTelegramPinnedContext(transport, token, event, messageId, contextKey) {
  await httpJson(telegramApiUrl(transport, token, "editMessageText"), {
    method: "POST",
    body: JSON.stringify({
      chat_id: transport.chatId,
      message_id: messageId,
      text: formatActiveTelegramContext(event),
      parse_mode: "HTML",
      disable_web_page_preview: true
    })
  }, Number(transport.timeoutMs ?? 15000));
  pinnedTelegramContexts.set(telegramContextCacheKey(transport), { contextKey, messageId });
  return { edited: true, messageId };
}

async function repinTelegramPinnedContext(transport, token, messageId) {
  await httpJson(telegramApiUrl(transport, token, "pinChatMessage"), {
    method: "POST",
    body: JSON.stringify({
      chat_id: transport.chatId,
      message_id: messageId,
      disable_notification: true
    })
  }, Number(transport.timeoutMs ?? 15000));
  return { repinned: true, messageId };
}

async function sendTelegramActiveContext(transport, token, event) {
  const sent = await httpJson(telegramApiUrl(transport, token, "sendMessage"), {
    method: "POST",
    body: JSON.stringify({
      chat_id: transport.chatId,
      text: formatActiveTelegramContext(event),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      disable_notification: true
    })
  }, Number(transport.timeoutMs ?? 15000));
  return sent?.result?.message_id;
}

async function deleteTelegramMessageQuietly(transport, token, messageId) {
  try {
    await httpJson(telegramApiUrl(transport, token, "deleteMessage"), {
      method: "POST",
      body: JSON.stringify({
        chat_id: transport.chatId,
        message_id: messageId
      })
    }, Number(transport.timeoutMs ?? 15000));
    return { oldDeleted: true };
  } catch (error) {
    return { oldDeleted: false, deleteError: error.message };
  }
}

async function replaceTelegramPinnedContext(transport, token, event, oldMessageId, contextKey) {
  const messageId = await sendTelegramActiveContext(transport, token, event);
  if (!messageId) return { skipped: true, reason: "missing_message_id" };
  await repinTelegramPinnedContext(transport, token, messageId);
  pinnedTelegramContexts.set(telegramContextCacheKey(transport), { contextKey, messageId });
  return {
    replaced: true,
    pinned: true,
    messageId,
    previousMessageId: oldMessageId,
    ...(oldMessageId ? await deleteTelegramMessageQuietly(transport, token, oldMessageId) : {})
  };
}

async function pinTelegramActiveContext(transport, token, policy, event) {
  if (!shouldPinActiveContext(policy, event)) return { skipped: true, reason: "no_active_context" };
  const contextKey = activeTelegramContextKey(event);
  const cacheKey = telegramContextCacheKey(transport);
  const cached = pinnedTelegramContexts.get(cacheKey);
  const pinned = await getTelegramPinnedContext(transport, token);
  if (pinned?.isLegax) {
    if (shouldRepinActiveContext(policy, event)) {
      return await replaceTelegramPinnedContext(transport, token, event, pinned.messageId, contextKey);
    }
    if (cached?.contextKey === contextKey && cached?.messageId === pinned.messageId) {
      return {
        skipped: true,
        reason: "unchanged",
        messageId: pinned.messageId
      };
    }
    return await editTelegramPinnedContext(transport, token, event, pinned.messageId, contextKey);
  }
  pinnedTelegramContexts.delete(cacheKey);
  if (pinned?.messageId) return { skipped: true, reason: "existing_pinned_message", messageId: pinned.messageId };
  const messageId = await sendTelegramActiveContext(transport, token, event);
  if (!messageId) return { skipped: true, reason: "missing_message_id" };
  await repinTelegramPinnedContext(transport, token, messageId);
  pinnedTelegramContexts.set(cacheKey, { contextKey, messageId });
  return { pinned: true, messageId };
}

function isCurrentSessionEvent(event, threadId) {
  if (event.metadata?.inactiveSession === true || event.metadata?.activeSession === false) return false;
  if (event.metadata?.activeSession === true) return true;
  const selectedThreadId = firstText([
    event.metadata?.selectedThreadId,
    event.metadata?.activeThreadId,
    event.metadata?.currentThreadId
  ]);
  return selectedThreadId ? selectedThreadId === String(threadId) : true;
}

function sessionReplyMarkup(event) {
  const agentId = event.metadata?.agentId ?? event.agentId;
  const threadId = event.metadata?.threadId ?? event.metadata?.sessionId;
  if (!agentId || !threadId) return null;
  const callbackData = `legax:session:${encodeURIComponent(agentId)}:${encodeURIComponent(threadId)}`;
  if (callbackData.length > 64) return {
    inline_keyboard: hierarchyRows(agentId, { level: "session" })
  };
  return {
    inline_keyboard: [
      [{ text: isCurrentSessionEvent(event, threadId) ? "Get messages" : "Use this session", callback_data: callbackData }],
      ...hierarchyRows(agentId, { level: "session", sessionRef: threadId })
    ]
  };
}

function permissionReplyMarkup(event) {
  if (event.kind !== "permission_request") return null;
  const requestId = event.metadata?.requestId;
  if (!requestId) return null;
  const approve = `legax:approve:${encodeURIComponent(requestId)}`;
  const deny = `legax:deny:${encodeURIComponent(requestId)}`;
  if (approve.length > 64 || deny.length > 64) return sessionReplyMarkup(event);
  const rows = [
    [
      { text: "Approve", callback_data: approve },
      { text: "Deny", callback_data: deny }
    ]
  ];
  const session = sessionReplyMarkup(event);
  if (session?.inline_keyboard?.length) rows.push(...session.inline_keyboard);
  return { inline_keyboard: rows };
}

async function sendViaRelay(transport, event) {
  if (!transport.baseUrl) throw new Error("Relay transport missing baseUrl.");
  const headers = transport.secret ? { "x-legax-secret": transport.secret } : {};
  return await httpJson(new URL("/api/events", transport.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(event)
  }, Number(transport.timeoutMs ?? 15000));
}

export function buildTelegramMessagePayloads(config, transport, event) {
  if (suppressTelegram(event)) return [];
  const policy = telegramNotificationPolicy(config, transport, event);
  if (!shouldSendTelegramEvent(policy, event)) return [];
  const replyMarkup = event.metadata?.telegramReplyMarkup ?? event.metadata?.replyMarkup ?? permissionReplyMarkup(event) ?? sessionReplyMarkup(event);
  const texts = formatTelegramMessages(event, policy);
  return texts.map((text, index) => {
    const payload = {
      chat_id: transport.chatId,
      text,
      disable_web_page_preview: policy.disableWebPagePreview !== false
    };
    if (String(policy.format ?? "html").toLowerCase() !== "plain") payload.parse_mode = "HTML";
    if (index === 0 && replyMarkup) payload.reply_markup = replyMarkup;
    return payload;
  });
}

export function buildFeishuMessagePayload(config, transport, event) {
  if (suppressFeishu(event)) return null;
  const policy = feishuNotificationPolicy(config, transport, event);
  if (!shouldSendFeishuEvent(policy, event)) return null;
  const receiveId = transport.receiveId
    ?? transport.chatId
    ?? transport.openId
    ?? transport.userId
    ?? transport.unionId
    ?? transport.email;
  if (!receiveId) throw new Error("Feishu transport missing receiveId (set transports[].receiveId or chatId inline in config.yaml).");
  if (event.kind === "permission_request" || event.kind === "user_input_request" || String(policy.format ?? "interactive").toLowerCase() === "interactive") {
    return {
      receive_id: receiveId,
      msg_type: "interactive",
      content: JSON.stringify(formatFeishuCard(event))
    };
  }
  return {
    receive_id: receiveId,
    msg_type: "text",
    content: JSON.stringify({ text: formatFeishuText(event) })
  };
}

async function sendViaTelegram(config, transport, event) {
  const token = transport.botToken;
  const chatId = transport.chatId;
  if (!token) throw new Error("Telegram transport missing botToken (set transports[].botToken inline in config.yaml).");
  if (!chatId) throw new Error("Telegram transport missing chatId (set transports[].chatId inline in config.yaml).");
  const payloads = buildTelegramMessagePayloads(config, transport, event);
  if (payloads.length === 0) return { skipped: true, reason: "message_detail" };
  let pinnedContext = { skipped: true, reason: "not_attempted" };
  try {
    pinnedContext = await pinTelegramActiveContext(transport, token, telegramNotificationPolicy(config, transport, event), event);
  } catch (error) {
    pinnedContext = { skipped: true, reason: "pin_failed", error: error.message };
  }
  const results = [];
  for (const payload of payloads) {
    results.push(await httpJson(telegramApiUrl(transport, token, "sendMessage"), {
      method: "POST",
      body: JSON.stringify(payload)
    }, Number(transport.timeoutMs ?? 15000)));
  }
  return { messageCount: payloads.length, pinnedContext, results };
}

export async function sendTelegramEvent(config, transport, event) {
  return await sendViaTelegram(config, transport, event);
}

async function sendViaFeishu(config, transport, event) {
  if (transport.webhookUrl || transport.botWebhookUrl) {
    const url = transport.webhookUrl ?? transport.botWebhookUrl;
    const payload = buildFeishuMessagePayload(config, {
      ...transport,
      receiveId: transport.receiveId ?? "webhook"
    }, event);
    if (!payload) return { skipped: true, reason: "message_detail" };
    const body = payload.msg_type === "interactive"
      ? { msg_type: "interactive", card: JSON.parse(payload.content) }
      : { msg_type: "text", content: JSON.parse(payload.content) };
    return await httpJson(url, {
      method: "POST",
      body: JSON.stringify(body)
    }, Number(transport.timeoutMs ?? 15000));
  }

  const payload = buildFeishuMessagePayload(config, transport, event);
  if (!payload) return { skipped: true, reason: "message_detail" };
  const token = await feishuTenantAccessToken(transport);
  const receiveIdType = transport.receiveIdType ?? transport.receive_id_type ?? "chat_id";
  const url = `${feishuApiBaseUrl(transport)}/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`;
  return await httpJson(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  }, Number(transport.timeoutMs ?? 15000));
}

async function sendViaWebhook(transport, event) {
  if (!transport.url) throw new Error("Webhook transport missing url (set transports[].url inline in config.yaml).");
  const headers = { ...(transport.headers ?? {}) };
  if (transport.secret) headers["x-legax-secret"] = transport.secret;
  return await httpJson(transport.url, {
    method: transport.method ?? "POST",
    headers,
    body: JSON.stringify(event)
  }, Number(transport.timeoutMs ?? 15000));
}

export async function dispatchAdditionalTransports(config, event, skipTransportName) {
  const results = [];
  const transports = enabledTransports(config);
  const relayOwnsTelegram = transports.some((transport) => transport.type === "relay" && transport.baseUrl);
  for (const transport of transports) {
    if (transport.name === skipTransportName) continue;
    if (transport.type === "relay" && !transport.baseUrl) continue;
    try {
      let result;
      if (transport.type === "relay") result = await sendViaRelay(transport, event);
      else if (transport.type === "telegram") {
        if (relayOwnsTelegram) {
          results.push({
            transport: transport.name,
            type: transport.type,
            ok: true,
            skipped: true,
            reason: "relay-owned"
          });
          continue;
        }
        result = await sendViaTelegram(config, transport, event);
      }
      else if (transport.type === "feishu") result = await sendViaFeishu(config, transport, event);
      else if (transport.type === "webhook") result = await sendViaWebhook(transport, event);
      else continue;
      results.push({ transport: transport.name, type: transport.type, ok: true, result });
    } catch (error) {
      results.push({ transport: transport.name, type: transport.type, ok: false, error: error.message });
    }
  }
  return results;
}
