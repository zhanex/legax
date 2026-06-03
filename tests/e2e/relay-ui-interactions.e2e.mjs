import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchJson, startRelay } from "./helpers.mjs";
import {
  buildComposerMessage,
  callbackDataToMessage,
  hostDisplayStatus,
  selectMachine
} from "../../scripts/lib/relay-ui-actions.mjs";
import { createTranslator, resolveLocale } from "../../scripts/lib/i18n.mjs";
import { parseTelegramCallback } from "../../scripts/lib/telegram-transport.mjs";

test("relay i18n resolves browser and configured locales", () => {
  assert.equal(resolveLocale({ relay: { locale: "auto" } }, { browserLanguages: ["zh-CN", "en-US"] }), "zh-CN");
  assert.equal(resolveLocale({ relay: { locale: "zh-CN" } }, { browserLanguages: ["en-US"] }), "zh-CN");
  assert.equal(resolveLocale({ relay: { locale: "bogus" } }, { browserLanguages: ["fr-FR"] }), "en");

  const en = createTranslator("en");
  const zh = createTranslator("zh-CN");
  assert.equal(en("machine.none"), "No daemon connected");
  assert.equal(zh("machine.none"), "暂无 daemon 连接");
  assert.equal(zh("missing.key"), "missing.key");
});

test("relay UI action helpers preserve machine targets", () => {
  const host = hostDisplayStatus({
    id: "host-a",
    displayName: "Workstation A",
    status: "online",
    lastSeenAt: "2026-06-02T00:00:00.000Z",
    groups: ["default", "lab"],
    capabilities: { platform: "win32", arch: "x64" },
    adapters: [
      { agentId: "codex-cli", agentLabel: "Codex CLI" },
      { agentId: "claude-code", agentLabel: "Claude Code" }
    ]
  }, Date.parse("2026-06-02T00:00:05.000Z"));

  assert.equal(host.label, "Workstation A");
  assert.equal(host.statusLabel, "Online");
  assert.equal(host.online, true);
  assert.equal(host.cliCount, 2);
  assert.equal(host.detail, "host-a · win32/x64 · default, lab · seen 5s ago");

  const next = selectMachine({
    selectedHostId: "host-a",
    selectedAgentId: "codex-cli",
    selectedProjectKey: "project-a",
    selectedThreadRef: "thread-a"
  }, "host-b");

  assert.deepEqual(next, {
    selectedHostId: "host-b",
    selectedAgentId: "",
    selectedProjectKey: "",
    selectedThreadRef: ""
  });

  assert.deepEqual(buildComposerMessage({
    selectedHostId: "host-b",
    selectedAgentId: "codex-cli"
  }, "continue here"), {
    type: "text",
    text: "continue here",
    targetHostId: "host-b",
    targetAgentId: "codex-cli"
  });

  assert.deepEqual(callbackDataToMessage("legax:h:host-b:agent:codex-cli"), {
    targetHostId: "host-b",
    targetAgentId: "codex-cli",
    type: "control",
    action: "list_agent_projects",
    selectedAgentId: "codex-cli",
    text: "/projects codex-cli"
  });

  assert.deepEqual(callbackDataToMessage("legax:h:host-b:session:codex-cli:thread-1"), {
    targetHostId: "host-b",
    targetAgentId: "codex-cli",
    type: "control",
    action: "select_session",
    selectedAgentId: "codex-cli",
    threadRef: "thread-1",
    text: "/use codex-cli thread-1"
  });

  assert.deepEqual(callbackDataToMessage("legax:h:host-b:projects:codex-cli:2"), {
    targetHostId: "host-b",
    targetAgentId: "codex-cli",
    type: "control",
    action: "list_agent_projects",
    selectedAgentId: "codex-cli",
    page: 2,
    text: "/projects codex-cli"
  });

  assert.deepEqual(callbackDataToMessage("legax:h:host-b:new-project:codex-cli"), {
    targetHostId: "host-b",
    targetAgentId: "legax-daemon",
    type: "control",
    action: "new_project_preflight",
    selectedAgentId: "codex-cli",
    text: "/new-project codex-cli"
  });
});

test("Telegram callbacks preserve selected machine targets", () => {
  const parsed = parseTelegramCallback("legax:h:host-b:session:codex-cli:thread-1", 42, "codex-cli", "2026-06-02T00:00:00.000Z", "legax-daemon");
  assert.deepEqual({
    type: parsed.type,
    action: parsed.action,
    targetHostId: parsed.targetHostId,
    targetAgentId: parsed.targetAgentId,
    selectedAgentId: parsed.selectedAgentId,
    threadRef: parsed.threadRef,
    text: parsed.text
  }, {
    type: "control",
    action: "select_session",
    targetHostId: "host-b",
    targetAgentId: "codex-cli",
    selectedAgentId: "codex-cli",
    threadRef: "thread-1",
    text: "/use codex-cli thread-1"
  });

  const approval = parseTelegramCallback("legax:h:host-b:approve:req-codex-cli-1", 43, "codex-cli", "2026-06-02T00:00:00.000Z", "legax-daemon");
  assert.equal(approval.type, "permission_decision");
  assert.equal(approval.targetHostId, "host-b");
  assert.equal(approval.decision, "approve");

  const projectPage = parseTelegramCallback("legax:h:host-b:projects:codex-cli:3", 44, "codex-cli", "2026-06-02T00:00:00.000Z", "legax-daemon");
  assert.equal(projectPage.action, "list_agent_projects");
  assert.equal(projectPage.targetHostId, "host-b");
  assert.equal(projectPage.page, 3);

  const newProject = parseTelegramCallback("legax:h:host-b:new-project:codex-cli", 45, "codex-cli", "2026-06-02T00:00:00.000Z", "legax-daemon");
  assert.equal(newProject.action, "new_project_preflight");
  assert.equal(newProject.targetHostId, "host-b");
  assert.equal(newProject.targetAgentId, "legax-daemon");
});

test("self-hosted relay routes same agent id by selected machine", async (t) => {
  const relay = await startRelay(t, { sessionId: "relay-ui-host-routing" });

  for (const hostId of ["host-a", "host-b"]) {
    await fetchJson(`${relay.baseUrl}/api/hosts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-legax-secret": relay.desktopSecret
      },
      body: JSON.stringify({
        hostId,
        displayName: hostId === "host-a" ? "Workstation A" : "Workstation B",
        adapters: [
          { agentId: "codex-cli", agentLabel: "Codex CLI" }
        ],
        commandRefs: ["agent.list"],
        ttlMs: 30000
      })
    });
  }

  const hosts = await fetchJson(`${relay.baseUrl}/api/hosts`, {
    headers: { cookie: relay.phoneCookie }
  });
  assert.equal(hosts.ok, true);
  assert.deepEqual(hosts.hosts.map((host) => host.displayName).sort(), ["Workstation A", "Workstation B"]);

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify(buildComposerMessage({
      selectedHostId: "host-a",
      selectedAgentId: "codex-cli"
    }, "only host-a should receive this"))
  });

  const hostAMessages = await fetchJson(`${relay.baseUrl}/api/messages?sessionId=${relay.sessionId}&after=0&hostId=host-a&agentId=codex-cli`, {
    headers: { "x-legax-secret": relay.desktopSecret }
  });
  assert.equal(hostAMessages.messages.length, 1);
  assert.equal(hostAMessages.messages[0].targetHostId, "host-a");
  assert.equal(hostAMessages.messages[0].text, "only host-a should receive this");

  const hostBMessages = await fetchJson(`${relay.baseUrl}/api/messages?sessionId=${relay.sessionId}&after=0&hostId=host-b&agentId=codex-cli`, {
    headers: { "x-legax-secret": relay.desktopSecret }
  });
  assert.deepEqual(hostBMessages.messages, []);
});
