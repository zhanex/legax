#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { dispatchAdditionalTransports } from "./lib/outbound-transports.mjs";
import { pollInboundTransports, routeInboundMessages } from "./lib/inbound-transports.mjs";
import { listProjectChildren, projectRoots, resolveProjectDirectory } from "./lib/project-browser.mjs";
import {
  getAgentTransportCursor,
  getTransportSelection,
  setAgentTransportCursor,
  takeAgentLaunchRequests
} from "./lib/runtime-state.mjs";
import { buttonRows, hierarchyRows } from "./lib/menu-groups.mjs";
import { readYaml } from "./lib/yaml.mjs";
import { ADAPTERS, validateAllAdapters } from "./lib/adapter-contract.mjs";
import {
  packageAssetPath,
  packageRoot,
  resolveConfigPath,
  resolveConfigRelative,
  resolveRuntimeFile
} from "./lib/paths.mjs";


const DAEMON_AGENT = {
  agentId: "legax-daemon",
  agentLabel: "Legax Daemon",
  mode: "interactive"
};

validateAllAdapters(ADAPTERS);

function loadConfig() {
  const configPath = resolveConfigPath();
  const sourcePath = fs.existsSync(configPath) ? configPath : packageAssetPath("config.example.yaml");
  const raw = readYaml(sourcePath) ?? {};
  return {
    ...raw,
    configPath,
    configSourcePath: sourcePath,
    storagePath: resolveRuntimeFile(raw.storagePath, configPath, "mcp-state.json"),
    runtimeStatePath: resolveRuntimeFile(raw.runtimeStatePath, configPath, "runtime-state.json"),
    sessionId: raw.sessionId ?? "default",
    displayName: raw.displayName ?? "Desktop Agent",
    remote: {
      enabled: true,
      defaultMode: "interactive",
      pauseAll: false,
      ...(raw.remote ?? {})
    },
    daemon: {
      restart: true,
      restartBackoffMs: 1000,
      restartBackoffMaxMs: 30000,
      restartMaxAttempts: 5,
      restartHealthyAfterMs: 60000,
      launchOnDemand: true,
      launchPollIntervalMs: 500,
      remoteRouter: true,
      remotePollIntervalMs: 1000,
      ...(raw.daemon ?? {})
    }
  };
}

function adapterIsEnabled(adapter, settings) {
  // Explicit enabled in config wins. Otherwise fall back to the contract's
  // defaultEnabled (true if omitted) — opt-in adapters like codexDesktopMirror
  // declare defaultEnabled: false so they don't appear unless the user opts in.
  if (settings && Object.prototype.hasOwnProperty.call(settings, "enabled")) {
    return settings.enabled !== false;
  }
  return adapter.defaultEnabled !== false;
}

function enabledAdapters(config) {
  if (config.remote?.enabled === false) return [];
  return ADAPTERS
    .filter((adapter) => adapterIsEnabled(adapter, agentSettings(config, adapter)))
    .map((adapter) => ({
      ...adapter,
      settings: agentSettings(config, adapter),
      agentId: agentSettings(config, adapter)?.agentId ?? adapter.defaultAgentId,
      agentLabel: agentSettings(config, adapter)?.agentLabel ?? adapter.label,
      command: agentSettings(config, adapter)?.command,
      mode: agentSettings(config, adapter)?.mode ?? config.remote?.defaultMode ?? "interactive",
      cliBackend: agentSettings(config, adapter)?.cliBackend ?? adapter.cliBackend,
      mcpEnabled: agentSettings(config, adapter)?.mcpEnabled ?? adapter.mcpEnabled,
      autoStart: agentSettings(config, adapter)?.autoStart ?? adapter.autoStart,
      scriptPath: packageAssetPath(adapter.script)
    }));
}

function agentSettings(config, adapter) {
  return config[adapter.key] ?? {};
}

function statusPayload(config) {
  const daemon = {
    remoteRouter: config.daemon?.remoteRouter !== false,
    remotePollIntervalMs: config.daemon?.remotePollIntervalMs
  };
  return {
    ok: true,
    configPath: config.configPath,
    configSourcePath: config.configSourcePath,
    storagePath: config.storagePath,
    runtimeStatePath: config.runtimeStatePath,
    sessionId: config.sessionId,
    remoteEnabled: config.remote?.enabled !== false,
    daemon,
    transports: summarizeTransports(config),
    adapters: enabledAdapters(config).map((adapter) => ({
      name: adapter.name,
      key: adapter.key,
      agentId: adapter.agentId,
      agentLabel: adapter.agentLabel,
      mode: adapter.mode,
      cliBackend: adapter.cliBackend,
      mcpEnabled: adapter.mcpEnabled,
      autoStart: adapter.autoStart,
      command: adapter.command,
      script: adapter.script
    }))
  };
}

// Build a redaction-safe view of the transports section. We never echo the
// actual secret, token, chat id, or URL back through logs; we only say
// "configured" / "missing" so the operator can audit at a glance.
function summarizeTransports(config) {
  const transports = Array.isArray(config.transports) ? config.transports : [];
  return transports.map((transport, idx) => {
    const base = {
      name: transport.name ?? `${transport.type ?? "transport"}-${idx + 1}`,
      type: transport.type ?? "unknown",
      enabled: transport.enabled !== false,
      timeoutMs: transport.timeoutMs ?? 15000
    };
    if (transport.type === "relay") {
      return {
        ...base,
        baseUrl: transport.baseUrl ?? null,
        secret: presence(transport.secret)
      };
    }
    if (transport.type === "telegram") {
      // chatId === 0 / "" / undefined means getUpdates is short-circuited and
      // the bot will silently never deliver. Catch it here so the daemon banner
      // shouts about it instead of looking healthy.
      const chatIdMissing = transport.chatId === undefined || transport.chatId === null
        || transport.chatId === 0 || transport.chatId === "0" || transport.chatId === "";
      return {
        ...base,
        botToken: presence(transport.botToken),
        chatId: chatIdMissing ? "MISSING" : "configured",
        pollerAgentId: transport.pollerAgentId ?? null,
        defaultTarget: transport.defaultTarget ?? null,
        warning: chatIdMissing
          ? `chatId is not configured (current value: ${JSON.stringify(transport.chatId ?? null)}). Telegram getUpdates will short-circuit and no inbound messages will reach the daemon. Run 'node scripts/configure-telegram-chat.mjs' to discover the chat id, then set transports[].chatId inline in config.yaml.`
          : null
      };
    }
    if (transport.type === "webhook") {
      return {
        ...base,
        url: presence(transport.url),
        secret: presence(transport.secret)
      };
    }
    if (transport.type === "feishu") {
      const receiveId = transport.receiveId ?? transport.chatId ?? transport.openId ?? transport.userId ?? transport.unionId ?? transport.email;
      return {
        ...base,
        platform: transport.platform ?? "feishu",
        appId: presence(transport.appId ?? transport.app_id),
        appSecret: presence(transport.appSecret ?? transport.app_secret),
        receiveId: presence(receiveId),
        verificationToken: presence(transport.verificationToken),
        webhookUrl: presence(transport.webhookUrl ?? transport.botWebhookUrl),
        defaultTarget: transport.defaultTarget ?? null
      };
    }
    return base;
  });
}

function presence(value) {
  return value ? "configured" : "MISSING";
}

// Validate that the Telegram poller has a fighting chance: pollerAgentId must
// match an enabled adapter, and that adapter must be autoStart so it is alive
// when the bot tries to deliver. Returns warnings to print after the transport
// summary; an empty array means we are happy.
function transportWarnings(config) {
  const out = [];
  if (config.daemon?.remoteRouter !== false) {
    return out;
  }
  const transports = Array.isArray(config.transports) ? config.transports : [];
  for (const transport of transports) {
    if (transport.enabled === false) continue;
    if (transport.type !== "telegram") continue;
    const requestedPoller = transport.pollerAgentId
      ?? config.routing?.telegramPollerAgentId
      ?? "codex-cli";
    const matchedAdapter = ADAPTERS.find((adapter) => {
      const settings = agentSettings(config, adapter);
      const id = settings.agentId ?? adapter.defaultAgentId;
      return id === requestedPoller;
    });
    if (!matchedAdapter) {
      out.push(`Telegram pollerAgentId "${requestedPoller}" matches no known adapter; nobody will call getUpdates.`);
      continue;
    }
    const adapterSettings = config[matchedAdapter.key] ?? {};
    const enabled = adapterIsEnabled(matchedAdapter, adapterSettings);
    if (!enabled) {
      out.push(`Telegram pollerAgentId "${requestedPoller}" maps to adapter "${matchedAdapter.key}" which is disabled. Either enable that adapter or change pollerAgentId.`);
      continue;
    }
    const autoStart = adapterSettings.autoStart ?? matchedAdapter.autoStart;
    if (autoStart === false) {
      out.push(`Telegram pollerAgentId "${requestedPoller}" maps to adapter "${matchedAdapter.key}" with autoStart: false. Without an alive poller, no inbound Telegram message will reach the daemon. Set ${matchedAdapter.key}.autoStart: true OR set routing.telegramPollerAgentId to an autoStart:true adapter.`);
    }
  }
  return out;
}

function describeTransport(t) {
  const tag = t.enabled ? "enabled " : "disabled";
  const bits = [];
  if (t.type === "relay") bits.push(`url=${t.baseUrl ?? "?"}`, `secret=${t.secret}`);
  else if (t.type === "telegram") bits.push(`bot=${t.botToken}`, `chatId=${t.chatId}`, `poller=${t.pollerAgentId ?? "-"}`, `default=${t.defaultTarget ?? "-"}`);
  else if (t.type === "feishu") bits.push(`platform=${t.platform}`, `app=${t.appId}`, `secret=${t.appSecret}`, `receive=${t.receiveId}`, `verify=${t.verificationToken}`, `default=${t.defaultTarget ?? "-"}`);
  else if (t.type === "webhook") bits.push(`url=${t.url}`, `secret=${t.secret}`);
  return `[${tag}] ${t.type.padEnd(8)} name=${t.name}${bits.length ? "  " + bits.join(" ") : ""}`;
}

function resolveAgentCwd(value, config) {
  if (!value) return path.dirname(config.configPath);
  return resolveConfigRelative(value, config.configPath);
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

function legaxMcpServerConfig(config) {
  return {
    command: process.execPath,
    args: [packageAssetPath("scripts", "mcp-server.mjs")],
    env: {
      // The MCP server reads everything (including the relay secret) from the
      // YAML pointed at by LEGAX_CONFIG. No secret env injection.
      LEGAX_CONFIG: config.configPath
    }
  };
}

function ensureAdapterMcpConfigured(config, adapter) {
  const settings = adapter.settings ?? {};
  if ((settings.mcpEnabled ?? adapter.mcpEnabled) === false) {
    return { configured: false, reason: "mcp disabled" };
  }
  if (settings.mcpAutoConfigure === false) {
    return { configured: false, reason: "mcp auto configure disabled" };
  }
  if (adapter.key === "claude") {
    return ensureClaudeMcpConfigured(config, settings);
  }
  if (adapter.key === "gemini") {
    return ensureGeminiMcpConfigured(config, settings);
  }
  return { configured: false, reason: "no adapter-specific mcp config required" };
}

function ensureClaudeMcpConfigured(config, settings) {
  const permissionPromptTool = settings.permissionPromptTool ?? "mcp__legax_permissions__approval_prompt";
  if (!permissionPromptTool) return { configured: false, reason: "permission prompt tool disabled" };
  const mcpConfigPath = settings.mcpConfigPath
    ? resolveConfigRelative(settings.mcpConfigPath, config.configPath)
    : resolveRuntimeFile("", config.configPath, "claude-permission-mcp.json");
  writeJsonFile(mcpConfigPath, {
    mcpServers: {
      legax_permissions: {
        command: process.execPath,
        args: [packageAssetPath("scripts", "claude-permission-mcp-server.mjs")],
        env: {
          // YAML config holds the relay secret; no env push from the daemon.
          LEGAX_CONFIG: config.configPath,
          ...(config.daemon?.remoteRouter === false ? {} : {
            LEGAX_DAEMON_CHILD: "1",
            LEGAX_DAEMON_ROUTER: "1"
          })
        }
      }
    }
  });
  return { configured: true, path: mcpConfigPath };
}

function ensureGeminiMcpConfigured(config, settings) {
  const mcpConfigPath = settings.mcpConfigPath
    ? resolveConfigRelative(settings.mcpConfigPath, config.configPath)
    : path.resolve(resolveAgentCwd(settings.cwd ?? ".", config), ".gemini", "settings.json");
  const mcpServerName = settings.mcpServerName ?? "legax";
  const body = readJsonIfExists(mcpConfigPath);
  body.mcpServers ??= {};
  body.mcpServers[mcpServerName] = legaxMcpServerConfig(config);
  writeJsonFile(mcpConfigPath, body);
  return { configured: true, path: mcpConfigPath };
}

async function announceLaunchStatus(config, adapter, text, metadata = {}) {
  const event = {
    kind: "status",
    sessionId: config.sessionId,
    agentId: adapter.agentId,
    agentLabel: adapter.agentLabel,
    sourceName: adapter.agentLabel,
    text,
    metadata: {
      agentId: adapter.agentId,
      adapter: adapter.name,
      ...metadata
    }
  };
  const results = await dispatchAdditionalTransports(config, event);
  const failures = results.filter((result) => !result.ok);
  for (const failure of failures) {
    process.stderr.write(`[legax] launch status failed via ${failure.transport}: ${failure.error}\n`);
  }
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

function transportKey(transport) {
  return `${transport.type}:${transport.name ?? transport.type}`;
}

function relayTransports(config) {
  return (Array.isArray(config.transports) ? config.transports : [])
    .filter((transport) => transport.enabled !== false && transport.type === "relay" && transport.baseUrl);
}

function primaryRelayTransport(config) {
  return relayTransports(config)[0] ?? null;
}

function relayPublicBaseUrl(config) {
  return String(config.relay?.publicBaseUrl ?? config.relay?.telegramWebAppPublicBaseUrl ?? "").trim().replace(/\/+$/, "");
}

function relayHealthUrl(transport) {
  return new URL("/healthz", transport.baseUrl).toString();
}

function twaTokenUrl(transport) {
  return new URL("/api/twa/launch-tokens", transport.baseUrl).toString();
}

function configAllowsInsecureTwa(config) {
  return config.relay?.telegramWebAppAllowInsecureDev === true;
}

function validateRelayTwaConfig(config) {
  const transport = primaryRelayTransport(config);
  if (!transport) return { ok: false, reason: "No enabled relay transport is configured." };
  const publicBaseUrl = relayPublicBaseUrl(config);
  if (!publicBaseUrl) return { ok: false, reason: "relay.publicBaseUrl is not configured." };
  let publicUrl;
  try {
    publicUrl = new URL(publicBaseUrl);
  } catch {
    return { ok: false, reason: "relay.publicBaseUrl is not a valid URL." };
  }
  if (publicUrl.protocol !== "https:" && !configAllowsInsecureTwa(config)) {
    return { ok: false, reason: `Telegram Mini Apps require an HTTPS URL. Current: ${publicBaseUrl}` };
  }
  const host = publicUrl.hostname.toLowerCase();
  if (!configAllowsInsecureTwa(config)) {
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return { ok: false, reason: "relay.publicBaseUrl points to localhost, which Telegram on your phone cannot reach." };
    }
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
      return { ok: false, reason: "relay.publicBaseUrl points to a private LAN address. Use a public HTTPS URL or a tunnel." };
    }
  }
  return { ok: true, transport, publicBaseUrl };
}

function defaultTarget(config, transport) {
  const selected = getTransportSelection(config, transportKey(transport));
  if (selected.targetAgentId) return selected.targetAgentId;
  const configured = transport.defaultTarget ?? config.routing?.defaultTarget;
  if (!configured || configured === "none" || configured === "self") return "";
  return String(configured);
}

function resolveRelayTarget(config, transport, message) {
  if (message.type === "control" && message.action === "list_agents") return DAEMON_AGENT.agentId;
  const explicit = message.targetAgentId ?? message.agentId ?? message.target;
  if (explicit) return String(explicit);
  return defaultTarget(config, transport);
}

function normalizeRelayMessage(config, transport, message) {
  return {
    ...message,
    id: message.id ?? `relay:${message.seq ?? crypto.randomUUID()}`,
    transport: transport.name ?? "relay",
    targetAgentId: resolveRelayTarget(config, transport, message),
    receivedAt: new Date().toISOString()
  };
}

function configuredAgentCatalog(adapters) {
  return adapters.map((adapter) => ({
    agentId: adapter.agentId,
    agentLabel: adapter.agentLabel,
    key: adapter.key,
    name: adapter.name,
    supportsSessions: adapter.settings?.supportsSessions !== false
  }));
}

function agentsReplyMarkup(adapters) {
  return {
    inline_keyboard: [
      ...buttonRows(adapters.map((adapter) => ({
        text: adapter.agentLabel,
        callback_data: `legax:agent:${encodeURIComponent(adapter.agentId)}`
      })), 2),
      ...hierarchyRows(null, { level: "cli" })
    ]
  };
}

function formatAgentList(adapters) {
  if (adapters.length === 0) return "No enabled CLI adapters are configured.";
  return [
    "Choose a CLI adapter:",
    ...adapters.map((adapter, index) => `${index + 1}. ${adapter.agentLabel} (${adapter.agentId})`)
  ].join("\n");
}

class RemoteRouter {
  constructor(config, adapters) {
    this.config = config;
    this.adapters = adapters;
    this.timer = null;
    this.polling = false;
  }

  start() {
    if (this.config.remote?.enabled === false) return;
    if (this.config.daemon?.remoteRouter === false) return;
    if (this.timer) return;
    const intervalMs = Number(this.config.daemon?.remotePollIntervalMs ?? 1000);
    const tick = async () => {
      if (this.polling) return;
      this.polling = true;
      try {
        const messages = [];
        const relays = relayTransports(this.config);
        for (const transport of relays) {
          messages.push(...await this.pollRelay(transport));
        }
        if (relays.length === 0) {
          messages.push(...await pollInboundTransports(this.config, DAEMON_AGENT, {
            forcePoll: true,
            drain: false
          }));
        }
        for (const message of messages) {
          await this.handleMessage(message);
        }
      } catch (error) {
        process.stderr.write(`[legax] remote router failed: ${error.message}\n`);
      } finally {
        this.polling = false;
      }
    };
    this.timer = setInterval(() => void tick(), intervalMs);
    void tick();
  }

  async pollRelay(transport) {
    const key = transportKey(transport);
    const cursor = getAgentTransportCursor(this.config, DAEMON_AGENT, key) ?? {};
    const after = Number(cursor.afterMessageSeq ?? 0);
    try {
      const url = new URL("/api/messages", transport.baseUrl);
      url.searchParams.set("sessionId", this.config.sessionId);
      url.searchParams.set("after", String(after));
      const headers = transport.secret ? { "x-legax-secret": transport.secret } : {};
      const response = await httpJson(url, { headers }, Number(transport.timeoutMs ?? 15000));
      const rawMessages = response.messages ?? [];
      const maxSeq = Math.max(after, ...rawMessages.map((message) => Number(message.seq) || 0));
      const messages = rawMessages.map((message) => normalizeRelayMessage(this.config, transport, message));
      const routed = routeInboundMessages(this.config, DAEMON_AGENT, messages, {
        transportKey: key,
        updateAgentCursors: true,
        drain: false
      });
      if (maxSeq !== after) {
        setAgentTransportCursor(this.config, DAEMON_AGENT, key, { afterMessageSeq: maxSeq });
      }
      return routed;
    } catch (error) {
      process.stderr.write(`[legax] ${transport.name ?? "relay"} daemon poll failed: ${error.message}\n`);
      return [];
    }
  }

  async handleMessage(message) {
    if (message.type === "control" && message.action === "list_agents") {
      await this.sendAgentMenu(message);
      return;
    }
    if (message.type === "control" && message.action === "new_project_preflight") {
      await this.sendNewProjectPreflight(message);
      return;
    }
    if (message.type === "control" && message.action === "list_project_children") {
      await this.sendProjectChildren(message);
      return;
    }
    if (message.type === "control" && message.action === "open_project") {
      await this.openProject(message);
    }
  }

  async sendAgentMenu(message) {
    const event = {
      id: crypto.randomUUID(),
      kind: "status",
      sessionId: this.config.sessionId,
      agentLabel: "Legax",
      sourceName: "Legax",
      text: formatAgentList(this.adapters),
      metadata: {
        controlMessageId: message.id,
        replyMarkup: agentsReplyMarkup(this.adapters),
        telegramReplyMarkup: agentsReplyMarkup(this.adapters)
      },
      createdAt: new Date().toISOString()
    };
    const results = await dispatchAdditionalTransports(this.config, event);
    const failures = results.filter((result) => !result.ok);
    for (const failure of failures) {
      process.stderr.write(`[legax] agent menu failed via ${failure.transport}: ${failure.error}\n`);
    }
  }

  async sendNewProjectPreflight(message) {
    const agentId = String(message.selectedAgentId ?? message.targetProjectAgentId ?? "").trim();
    const adapter = this.adapters.find((candidate) => candidate.agentId === agentId);
    if (!adapter) {
      await this.sendControlStatus(`New project is not available.\n\nReason: unknown CLI adapter "${agentId || "(missing)"}".`, {
        severity: "error",
        controlMessageId: message.id
      });
      return;
    }

    const roots = projectRoots(this.config);
    if (roots.length === 0) {
      await this.sendControlStatus("New project is not available.\n\nReason: daemon.projectRoots is not configured.\n\nFix: add at least one local project root to config.yaml and restart daemon.", {
        severity: "error",
        controlMessageId: message.id,
        agentId,
        agentLabel: adapter.agentLabel
      });
      return;
    }

    const preflight = validateRelayTwaConfig(this.config);
    if (!preflight.ok) {
      await this.sendControlStatus(`New project is not available.\n\nReason: ${preflight.reason}\n\nFix: start relay, set relay.publicBaseUrl to a public HTTPS URL, then restart daemon.`, {
        severity: "error",
        controlMessageId: message.id,
        agentId,
        agentLabel: adapter.agentLabel
      });
      return;
    }

    try {
      await httpJson(relayHealthUrl(preflight.transport), {}, Number(preflight.transport.timeoutMs ?? 15000));
      const ttl = Number(this.config.relay?.telegramWebAppLaunchTokenTtlMs ?? this.config.relay?.twaLaunchTokenTtlMs ?? 300000);
      const tokenResponse = await httpJson(twaTokenUrl(preflight.transport), {
        method: "POST",
        headers: preflight.transport.secret ? { "x-legax-secret": preflight.transport.secret } : {},
        body: JSON.stringify({
          sessionId: this.config.sessionId,
          agentId,
          agentLabel: adapter.agentLabel,
          expiresInMs: ttl
        })
      }, Number(preflight.transport.timeoutMs ?? 15000));
      const url = new URL("/twa/new-project", preflight.publicBaseUrl);
      url.searchParams.set("token", tokenResponse.token);
      const markup = {
        inline_keyboard: [
          [{ text: "Open project picker", web_app: { url: url.toString() } }],
          ...hierarchyRows(agentId, { level: "project" })
        ]
      };
      await this.sendControlStatus(`Open project picker for ${adapter.agentLabel}.`, {
        controlMessageId: message.id,
        agentId,
        agentLabel: adapter.agentLabel,
        replyMarkup: markup,
        telegramReplyMarkup: markup
      });
    } catch (error) {
      await this.sendControlStatus(`New project is not available.\n\nReason: relay health check or launch-token creation failed.\nLast error: ${error.message}`, {
        severity: "error",
        controlMessageId: message.id,
        agentId,
        agentLabel: adapter.agentLabel
      });
    }
  }

  async sendProjectChildren(message) {
    try {
      const body = listProjectChildren(this.config, message);
      await this.sendTwaResponse(message, {
        twaResponseType: "project_children",
        ok: true,
        ...body
      });
    } catch (error) {
      await this.sendTwaResponse(message, {
        twaResponseType: "project_children",
        ok: false,
        error: error.message
      });
    }
  }

  async openProject(message) {
    const agentId = String(message.selectedAgentId ?? message.targetProjectAgentId ?? "").trim();
    const adapter = this.adapters.find((candidate) => candidate.agentId === agentId);
    if (!adapter) {
      await this.sendTwaResponse(message, {
        twaResponseType: "open_project",
        ok: false,
        error: `Unknown CLI adapter: ${agentId || "(missing)"}`
      });
      return;
    }
    try {
      const project = resolveProjectDirectory(this.config, message);
      routeInboundMessages(this.config, DAEMON_AGENT, [{
        ...message,
        id: `${message.id ?? crypto.randomUUID()}:open-project`,
        type: "control",
        action: "new_session",
        targetAgentId: agentId,
        selectedAgentId: agentId,
        projectPath: project.path,
        cwd: project.path,
        text: `/new ${agentId}`
      }], {
        updateAgentCursors: true,
        drain: false
      });
      await this.sendTwaResponse(message, {
        twaResponseType: "open_project",
        ok: true,
        agentId,
        agentLabel: adapter.agentLabel,
        projectPath: project.path,
        projectName: path.basename(project.path)
      });
      await this.sendControlStatus(`Opening project ${path.basename(project.path)} with ${adapter.agentLabel}.`, {
        agentId,
        agentLabel: adapter.agentLabel,
        projectPath: project.path,
        telegramSuppress: true
      });
    } catch (error) {
      await this.sendTwaResponse(message, {
        twaResponseType: "open_project",
        ok: false,
        error: error.message
      });
    }
  }

  async sendTwaResponse(message, metadata) {
    await this.sendControlStatus(metadata.ok === false ? `Project picker error: ${metadata.error}` : "Project picker response.", {
      ...metadata,
      twaRequestId: message.requestId,
      requestId: message.requestId,
      agentId: message.selectedAgentId,
      telegramSuppress: true
    });
  }

  async sendControlStatus(text, metadata = {}) {
    const event = {
      id: crypto.randomUUID(),
      kind: "status",
      sessionId: this.config.sessionId,
      agentId: metadata.agentId ?? "legax-daemon",
      agentLabel: metadata.agentLabel ?? "Legax",
      sourceName: metadata.agentLabel ?? "Legax",
      text,
      metadata,
      createdAt: new Date().toISOString()
    };
    const results = await dispatchAdditionalTransports(this.config, event);
    const failures = results.filter((result) => !result.ok);
    for (const failure of failures) {
      process.stderr.write(`[legax] control status failed via ${failure.transport}: ${failure.error}\n`);
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

function prefixStream(stream, name, target) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.trim()) target.write(`[${name}] ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buffer.trim()) target.write(`[${name}] ${buffer}\n`);
  });
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

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

const WINDOWS_CONTROL_EXIT_CODE = 0xC000013A;

function nonNegativeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function nonNegativeInteger(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function parseLockPid(raw) {
  try {
    const body = JSON.parse(String(raw ?? ""));
    const pid = Number(body.pid);
    return Number.isInteger(pid) ? pid : 0;
  } catch {
    return 0;
  }
}

function daemonLockStaleMs(config) {
  return nonNegativeNumber(config.daemon?.singletonLockStaleMs, 30000);
}

function acquireDaemonLock(config) {
  if (config.daemon?.singletonLock === false) {
    return { release() {} };
  }
  const lockPath = `${config.runtimeStatePath}.daemon.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const body = JSON.stringify({
    pid: process.pid,
    configPath: config.configPath,
    runtimeStatePath: config.runtimeStatePath,
    startedAt: new Date().toISOString()
  });
  let fd = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, body);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let raw = "";
      let stat = null;
      try {
        raw = fs.readFileSync(lockPath, "utf8");
        stat = fs.statSync(lockPath);
      } catch (readError) {
        if (readError.code !== "ENOENT") throw readError;
      }
      const pid = parseLockPid(raw);
      if (isProcessAlive(pid)) {
        throw new Error(`daemon already running for runtime state ${config.runtimeStatePath} (pid ${pid}). Stop that daemon before starting another one.`);
      }
      if (!pid && stat && Date.now() - stat.mtimeMs < daemonLockStaleMs(config)) {
        throw new Error(`daemon lock exists at ${lockPath} but does not contain a readable pid yet. Retry after the current start attempt finishes.`);
      }
      try {
        fs.unlinkSync(lockPath);
      } catch (unlinkError) {
        if (unlinkError.code !== "ENOENT") throw unlinkError;
      }
    }
  }

  if (fd === null) {
    throw new Error(`could not acquire daemon lock at ${lockPath}`);
  }

  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      try { fs.closeSync(fd); } catch { /* ignore */ }
      try {
        if (fs.existsSync(lockPath) && fs.readFileSync(lockPath, "utf8") === body) {
          fs.unlinkSync(lockPath);
        }
      } catch {
        // Best-effort cleanup; stale locks are recovered on the next start.
      }
    }
  };
}

class AdapterSupervisor {
  constructor(config, adapter) {
    this.config = config;
    this.adapter = adapter;
    this.stopping = false;
    this.restartInitial = nonNegativeNumber(config.daemon?.restartBackoffMs, 1000);
    this.restartMax = Math.max(this.restartInitial, nonNegativeNumber(config.daemon?.restartBackoffMaxMs, 30000));
    this.restartMaxAttempts = nonNegativeInteger(config.daemon?.restartMaxAttempts, 5);
    this.restartHealthyAfterMs = nonNegativeNumber(config.daemon?.restartHealthyAfterMs, 60000);
    this.restartDelay = this.restartInitial;
    this.restartAttempts = 0;
    this.restartTimer = null;
    this.lastStartAt = 0;
  }

  resetRestartState() {
    this.restartDelay = this.restartInitial;
    this.restartAttempts = 0;
  }

  start({ resetRestartState = false } = {}) {
    this.stopping = false;
    if (resetRestartState) this.resetRestartState();
    this.lastStartAt = Date.now();
    process.stderr.write(`[legax] starting ${this.adapter.name}\n`);
    this.child = spawn(process.execPath, [this.adapter.scriptPath], {
      cwd: packageRoot,
      env: {
        ...process.env,
        LEGAX_CONFIG: this.config.configPath,
        ...(this.config.daemon?.remoteRouter === false ? {} : {
          LEGAX_DAEMON_CHILD: "1",
          LEGAX_DAEMON_ROUTER: "1"
        })
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    prefixStream(this.child.stdout, this.adapter.name, process.stdout);
    prefixStream(this.child.stderr, this.adapter.name, process.stderr);
    this.child.on("exit", (code, signal) => this.handleExit(code, signal));
    this.child.on("error", (error) => this.handleError(error));
  }

  handleError(error) {
    process.stderr.write(`[legax] ${this.adapter.name} failed to start: ${error.message}\n`);
  }

  handleExit(code, signal) {
    if (this.stopping) return;
    process.stderr.write(`[legax] ${this.adapter.name} exited (${code ?? signal})\n`);
    if (this.config.daemon?.restart === false) return;
    if (Number(code) === WINDOWS_CONTROL_EXIT_CODE) {
      process.stderr.write(`[legax] restart suppressed for ${this.adapter.name}: Windows control-event exit (${code})\n`);
      return;
    }
    const runtimeMs = this.lastStartAt ? Date.now() - this.lastStartAt : 0;
    if (runtimeMs >= this.restartHealthyAfterMs) {
      this.resetRestartState();
    }
    if (this.restartAttempts >= this.restartMaxAttempts) {
      process.stderr.write(`[legax] restart disabled for ${this.adapter.name} after ${this.restartMaxAttempts} rapid failures; last runtime ${runtimeMs}ms\n`);
      return;
    }
    const delay = this.restartDelay;
    this.restartAttempts += 1;
    this.restartDelay = Math.min(this.restartMax, this.restartDelay * 2);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopping) this.start();
    }, delay);
  }

  stop() {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    killProcessTree(this.child);
  }

  isRunning() {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed && !this.stopping);
  }

  isRestartPending() {
    return Boolean(this.restartTimer && !this.stopping);
  }
}

class AdapterManager {
  constructor(config, adapters) {
    this.config = config;
    this.adapters = adapters;
    this.adaptersByAgentId = new Map(adapters.map((adapter) => [adapter.agentId, adapter]));
    this.supervisorsByAgentId = new Map();
    this.launchTimer = null;
    this.launching = false;
  }

  async startInitial() {
    for (const adapter of this.adapters.filter((candidate) => candidate.autoStart !== false)) {
      await this.startAdapter(adapter, { announce: false, reason: "startup" });
    }
  }

  async startAdapter(adapter, { announce = true, request = null, reason = "on-demand" } = {}) {
    let supervisor = this.supervisorsByAgentId.get(adapter.agentId);
    if (supervisor?.isRunning() || supervisor?.isRestartPending()) return false;

    try {
      const mcp = ensureAdapterMcpConfigured(this.config, adapter);
      if (announce) {
        const details = mcp.configured ? ` MCP configured at ${mcp.path}.` : "";
        await announceLaunchStatus(
          this.config,
          adapter,
          `Starting ${adapter.agentLabel}.${details}`,
          { launchReason: reason, request }
        );
      }
      if (!supervisor) {
        supervisor = new AdapterSupervisor(this.config, adapter);
        this.supervisorsByAgentId.set(adapter.agentId, supervisor);
      }
      supervisor.start({ resetRestartState: true });
      return true;
    } catch (error) {
      process.stderr.write(`[legax] failed to start ${adapter.name}: ${error.message}\n`);
      if (announce) {
        await announceLaunchStatus(this.config, adapter, `Could not start ${adapter.agentLabel}: ${error.message}`, {
          launchReason: reason,
          request
        });
      }
      return false;
    }
  }

  startLaunchWatcher() {
    if (this.config.daemon?.launchOnDemand === false || this.launchTimer) return;
    const intervalMs = Number(this.config.daemon?.launchPollIntervalMs ?? 500);
    const tick = async () => {
      if (this.launching) return;
      this.launching = true;
      try {
        const requests = takeAgentLaunchRequests(this.config);
        for (const request of requests) {
          const adapter = this.adaptersByAgentId.get(request.agentId);
          if (!adapter) {
            process.stderr.write(`[legax] launch request ignored for unknown agent ${request.agentId}\n`);
            continue;
          }
          await this.startAdapter(adapter, {
            announce: true,
            request,
            reason: request.reason ?? "on-demand"
          });
        }
      } catch (error) {
        process.stderr.write(`[legax] launch watcher failed: ${error.message}\n`);
      } finally {
        this.launching = false;
      }
    };
    this.launchTimer = setInterval(() => void tick(), intervalMs);
    void tick();
  }

  stop() {
    if (this.launchTimer) clearInterval(this.launchTimer);
    for (const supervisor of this.supervisorsByAgentId.values()) supervisor.stop();
  }
}

async function main() {
  const config = loadConfig();
  const args = process.argv.slice(2);
  if (args.includes("--dry-run") || args.includes("--status")) {
    process.stdout.write(`${JSON.stringify(statusPayload(config), null, 2)}\n`);
    return;
  }

  const daemonLock = acquireDaemonLock(config);
  process.on("exit", () => daemonLock.release());

  const transports = summarizeTransports(config);
  if (transports.length === 0) {
    process.stderr.write("[legax] no transports configured in YAML.\n");
  } else {
    const enabledCount = transports.filter((t) => t.enabled).length;
    process.stderr.write(`[legax] transports (${enabledCount} enabled / ${transports.length} total) from ${config.configPath}:\n`);
    for (const t of transports) {
      process.stderr.write(`[legax]   ${describeTransport(t)}\n`);
      if (t.warning) {
        process.stderr.write(`[legax]     WARNING: ${t.warning}\n`);
      }
    }
  }
  for (const warning of transportWarnings(config)) {
    process.stderr.write(`[legax] WARNING: ${warning}\n`);
  }

  const adapters = enabledAdapters(config);
  if (adapters.length === 0) {
    process.stderr.write("[legax] no enabled adapters in config.\n");
    daemonLock.release();
    return;
  }
  config.agents = configuredAgentCatalog(adapters);

  const router = new RemoteRouter(config, adapters);
  const manager = new AdapterManager(config, adapters);
  router.start();
  await manager.startInitial();
  manager.startLaunchWatcher();

  const shutdown = () => {
    router.stop();
    manager.stop();
    daemonLock.release();
  };
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
