import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fetchJson, pairRelayDevice, pluginRoot, startRelay, waitFor } from "./helpers.mjs";

async function pairBrowser(relay, { code = "482913", sessionId = relay.sessionId, label = "test phone" } = {}) {
  return pairRelayDevice(relay, { code, sessionId, label });
}

const REQUIRED_RELAY_STORE_DOMAINS = [
  "sessions",
  "generations",
  "leases",
  "hosts",
  "devices",
  "transports",
  "inbox",
  "commands",
  "events",
  "artifacts",
  "workflowDefinitions",
  "workflowRuns"
];

test("relay entrypoints delegate HTTP behavior to the shared relay core", async () => {
  const devEntry = await fs.readFile(new URL("../../scripts/simple-relay-server.mjs", import.meta.url), "utf8");
  const standaloneEntry = await fs.readFile(new URL("../../self-hosted-relay/server.mjs", import.meta.url), "utf8");

  for (const [name, source] of [
    ["developer relay", devEntry],
    ["standalone relay", standaloneEntry]
  ]) {
    assert.match(source, /startRelayServer/, name);
    assert.doesNotMatch(source, /async function route\b/, name);
    assert.doesNotMatch(source, /function normalizeMessage\b/, name);
    assert.doesNotMatch(source, /function createPairingCode\b/, name);
  }

  for (const file of ["relay-server-core.mjs", "yaml.mjs", "paths.mjs"]) {
    const source = await fs.readFile(new URL(`../../scripts/lib/${file}`, import.meta.url), "utf8");
    const standaloneCopy = await fs.readFile(new URL(`../../self-hosted-relay/lib/${file}`, import.meta.url), "utf8");
    assert.equal(standaloneCopy, source, `${file} copied into self-hosted relay`);
  }
});

test("self-hosted relay initializes the formal relay store schema", async (t) => {
  const relay = await startRelay(t, { sessionId: "schema-init-e2e" });
  const store = JSON.parse(await fs.readFile(relay.storePath, "utf8"));

  assert.equal(store.schema, "legax.relay/1");
  assert.equal(store.version, 1);
  for (const domain of REQUIRED_RELAY_STORE_DOMAINS) {
    assert.ok(Object.hasOwn(store, domain), domain);
  }
  assert.equal(store.sessions[relay.sessionId].id, relay.sessionId);
  assert.equal(store.sessions[relay.sessionId].status, "active");
  assert.equal(store.sessions[relay.sessionId].currentGenerationId, "");
  assert.deepEqual(store.sessions[relay.sessionId].nativeSessions, {});
  assert.ok(Array.isArray(store.sessions[relay.sessionId].events));
  assert.ok(Array.isArray(store.sessions[relay.sessionId].messages));
  assert.ok(Array.isArray(store.events));
});

test("self-hosted relay migrates legacy relay store version 1 files", async (t) => {
  const relay = await startRelay(t, { sessionId: "legacy-store-e2e" });
  await fs.writeFile(relay.storePath, `${JSON.stringify({
    version: 1,
    sessions: {
      "legacy-store-e2e": {
        events: [{ id: "legacy-event", seq: 1, kind: "status", text: "legacy" }],
        messages: [],
        nextEventSeq: 2,
        nextMessageSeq: 1
      }
    }
  }, null, 2)}\n`, "utf8");

  await fetchJson(`${relay.baseUrl}/api/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    body: JSON.stringify({ sessionId: relay.sessionId, kind: "status", text: "after migration" }),
    skipRelayCookie: true
  });

  const store = JSON.parse(await fs.readFile(relay.storePath, "utf8"));
  assert.equal(store.schema, "legax.relay/1");
  assert.equal(store.sessions[relay.sessionId].id, relay.sessionId);
  assert.equal(store.sessions[relay.sessionId].events[0].text, "legacy");
  assert.equal(store.sessions[relay.sessionId].events[1].seq, 2);
  assert.equal(store.events[store.events.length - 1].kind, "session.event.appended");
  assert.equal(store.events[store.events.length - 1].sessionId, relay.sessionId);
  assert.deepEqual(Object.keys(store.generations), []);
});

test("self-hosted relay rejects unsupported or corrupted relay stores clearly", async (t) => {
  const relay = await startRelay(t, { sessionId: "bad-store-e2e" });

  await fs.writeFile(relay.storePath, `${JSON.stringify({ schema: "legax.relay/0", sessions: {} }, null, 2)}\n`, "utf8");
  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-legax-secret": relay.desktopSecret
      },
      body: JSON.stringify({ sessionId: relay.sessionId, kind: "status", text: "wrong schema" }),
      skipRelayCookie: true
    }),
    (error) => {
      assert.equal(error.status, 500);
      assert.match(error.body.error, /unsupported relay store schema "legax\.relay\/0"/);
      return true;
    }
  );

  await fs.writeFile(relay.storePath, `${JSON.stringify({ schema: "legax.relay/1", version: 1, sessions: [] }, null, 2)}\n`, "utf8");
  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-legax-secret": relay.desktopSecret
      },
      body: JSON.stringify({ sessionId: relay.sessionId, kind: "status", text: "bad sessions domain" }),
      skipRelayCookie: true
    }),
    (error) => {
      assert.equal(error.status, 500);
      assert.match(error.body.error, /invalid relay store domain "sessions"/);
      return true;
    }
  );

  await fs.writeFile(relay.storePath, "{ broken json", "utf8");
  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-legax-secret": relay.desktopSecret
      },
      body: JSON.stringify({ sessionId: relay.sessionId, kind: "status", text: "corrupt store" }),
      skipRelayCookie: true
    }),
    (error) => {
      assert.equal(error.status, 500);
      assert.match(error.body.error, /invalid relay store JSON/);
      assert.match(error.body.error, /relay-e2e-/);
      return true;
    }
  );
});

test("self-hosted relay supports authenticated desktop and phone flows", async (t) => {
  const relay = await startRelay(t, { sessionId: "relay-e2e" });

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      skipRelayCookie: true,
      body: JSON.stringify({ sessionId: relay.sessionId, kind: "status", text: "unauthorized" })
    }),
    { status: 401 }
  );

  const eventResult = await fetchJson(`${relay.baseUrl}/api/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      kind: "permission_request",
      text: "Approve command?",
      metadata: { requestId: "req-1" }
    })
  });
  assert.equal(eventResult.ok, true);
  assert.equal(eventResult.event.seq, 1);

  const phoneEvents = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
  assert.equal(phoneEvents.events.length, 1);
  assert.equal(phoneEvents.events[0].kind, "permission_request");

  const cookie = await pairBrowser(relay);
  const page = await fetch(`${relay.baseUrl}/`, {
    headers: { cookie }
  });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Legax/);

  const fragmentPage = await fetch(`${relay.baseUrl}/`, {
    headers: { cookie }
  });
  assert.equal(fragmentPage.status, 200);
  const fragmentHtml = await fragmentPage.text();
  assert.doesNotMatch(fragmentHtml, /api\/messages\?[^"]*token/);
  assert.match(fragmentHtml, /data-scope="cli"/);
  assert.match(fragmentHtml, /data-scope="project"/);
  assert.match(fragmentHtml, /data-scope="session"/);
  assert.match(fragmentHtml, /class="context-breadcrumb"/);
  assert.match(fragmentHtml, /<nav class="context-breadcrumb"[\s\S]*<\/nav>\s*<button id="status"/);
  assert.match(fragmentHtml, /supportedAgents/);
  assert.match(fragmentHtml, /Codex CLI/);
  assert.match(fragmentHtml, /Claude Code/);
  assert.match(fragmentHtml, /Gemini CLI/);
  assert.match(fragmentHtml, /Choose project first/);
  assert.doesNotMatch(fragmentHtml, /activateFirstContextForAgent/);
  assert.match(fragmentHtml, /id="offline-help"/);
  assert.match(fragmentHtml, /id="attention-panel"/);
  assert.match(fragmentHtml, /\/api\/attention/);
  assert.match(fragmentHtml, /npm run daemon:bg/);
  assert.match(fragmentHtml, /Auth required/);
  assert.match(fragmentHtml, /Unauthorized/);
  assert.doesNotMatch(fragmentHtml, /No sessions/);
  assert.doesNotMatch(fragmentHtml, /id="cli-menu"/);
  assert.doesNotMatch(fragmentHtml, /id="session-menu"/);
  assert.doesNotMatch(fragmentHtml, /id="pause-all"/);
  assert.doesNotMatch(fragmentHtml, />Interactive</);
  assert.match(fragmentHtml, /callbackDataToMessage/);
  const sessionPage = await fetch(`${relay.baseUrl}/u/${relay.sessionId}`);
  assert.equal(sessionPage.status, 404);

  const messageResult = await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      type: "permission_decision",
      requestId: "req-1",
      decision: "approve",
      text: "Approved from test"
    })
  });
  assert.equal(messageResult.ok, true);

  const desktopMessages = await fetchJson(`${relay.baseUrl}/api/messages?sessionId=${relay.sessionId}&after=0`, {
    headers: { "x-legax-secret": relay.desktopSecret }
  });
  assert.equal(desktopMessages.messages.length, 1);
  assert.equal(desktopMessages.messages[0].decision, "approve");
});

test("self-hosted relay issues TWA launch tokens and queues project picker requests", async (t) => {
  const relay = await startRelay(t, { sessionId: "twa-new-project-e2e" });

  const health = await fetchJson(`${relay.baseUrl}/healthz`, { skipRelayCookie: true });
  assert.equal(health.ok, true);

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/twa/bootstrap?token=missing`, { skipRelayCookie: true }),
    { status: 401 }
  );

  const launch = await fetchJson(`${relay.baseUrl}/api/twa/launch-tokens`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      agentId: "codex-cli",
      agentLabel: "Codex CLI",
      expiresInMs: 300000
    })
  });
  assert.equal(launch.ok, true);
  assert.match(launch.token, /^[A-Za-z0-9_-]{32,}$/);

  const page = await fetch(`${relay.baseUrl}/twa/new-project?token=${encodeURIComponent(launch.token)}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Open project/);

  const bootstrap = await fetchJson(`${relay.baseUrl}/api/twa/bootstrap?token=${encodeURIComponent(launch.token)}`, {
    skipRelayCookie: true
  });
  assert.equal(bootstrap.ok, true);
  assert.equal(bootstrap.sessionId, relay.sessionId);
  assert.equal(bootstrap.agentId, "codex-cli");

  const listRequest = await fetchJson(`${relay.baseUrl}/api/twa/project-children`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    skipRelayCookie: true,
    body: JSON.stringify({
      token: launch.token,
      rootId: "root-1",
      relativePath: ""
    })
  });
  assert.equal(listRequest.ok, true);
  assert.match(listRequest.requestId, /^twa_/);

  const desktopMessages = await fetchJson(`${relay.baseUrl}/api/messages?sessionId=${relay.sessionId}&after=0`, {
    headers: { "x-legax-secret": relay.desktopSecret }
  });
  const queued = desktopMessages.messages.find((message) => message.requestId === listRequest.requestId);
  assert.equal(queued.action, "list_project_children");
  assert.equal(queued.targetAgentId, "legax-daemon");
  assert.equal(queued.selectedAgentId, "codex-cli");

  await fetchJson(`${relay.baseUrl}/api/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      kind: "status",
      text: "Project children",
      metadata: {
        twaRequestId: listRequest.requestId,
        twaResponseType: "project_children",
        ok: true,
        entries: [{ name: "app", path: "app", kind: "directory" }]
      }
    })
  });

  const response = await fetchJson(`${relay.baseUrl}/api/twa/responses/${encodeURIComponent(listRequest.requestId)}?token=${encodeURIComponent(launch.token)}`, {
    skipRelayCookie: true
  });
  assert.equal(response.ok, true);
  assert.equal(response.response.twaResponseType, "project_children");
  assert.equal(response.response.entries[0].name, "app");
});

test("self-hosted relay pairs browser devices and supports revocation", async (t) => {
  const relay = await startRelay(t, { sessionId: "pairing-e2e" });

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`, { skipRelayCookie: true }),
    { status: 401 }
  );

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/pairing-codes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      skipRelayCookie: true,
      body: JSON.stringify({ code: "123456", sessionId: relay.sessionId })
    }),
    { status: 401 }
  );

  await fetchJson(`${relay.baseUrl}/api/pairing-codes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    body: JSON.stringify({ code: "654321", sessionId: relay.sessionId, expiresInMs: 300000 })
  });

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      skipRelayCookie: true,
      body: JSON.stringify({ code: "000000" })
    }),
    { status: 401 }
  );

  const pairResponse = await fetch(`${relay.baseUrl}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "654321", label: "phone browser" })
  });
  assert.equal(pairResponse.status, 200);
  const cookie = pairResponse.headers.get("set-cookie").split(";")[0];

  const page = await fetch(`${relay.baseUrl}/`, { headers: { cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Current conversation/);

  const pairedEvents = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`, {
    headers: { cookie }
  });
  assert.equal(pairedEvents.ok, true);

  const devices = await fetchJson(`${relay.baseUrl}/api/devices`, {
    headers: { "x-legax-secret": relay.desktopSecret }
  });
  const phoneDevice = devices.devices.find((device) => device.label === "phone browser");
  assert.ok(phoneDevice, JSON.stringify(devices.devices));

  await fetchJson(`${relay.baseUrl}/api/devices/${encodeURIComponent(phoneDevice.id)}`, {
    method: "DELETE",
    headers: { "x-legax-secret": relay.desktopSecret }
  });

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`, {
      headers: { cookie }
    }),
    { status: 401 }
  );
});

test("self-hosted relay accepts UTF-8 BOM config files", async (t) => {
  const relay = await startRelay(t, { sessionId: "bom-config-e2e", configBom: true });

  await fetchJson(`${relay.baseUrl}/api/pairing-codes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    body: JSON.stringify({ code: "778899", expiresInMs: 300000 })
  });

  const response = await fetch(`${relay.baseUrl}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "778899", label: "bom browser" })
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie").split(";")[0];

  const pairedEvents = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`, {
    headers: { cookie }
  });
  assert.equal(pairedEvents.ok, true);
});

test("self-hosted relay returns a scannable QR payload for browser pairing", async (t) => {
  const relay = await startRelay(t, { sessionId: "pairing-qr-e2e" });

  const result = await fetchJson(`${relay.baseUrl}/api/pairing-codes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    body: JSON.stringify({ sessionId: relay.sessionId, label: "qr phone", expiresInMs: 300000 })
  });

  assert.equal(result.ok, true);
  assert.match(result.code, /^\d{6}$/);
  assert.equal(result.pairingOffer.type, "legax.pairing.offer");
  assert.equal(result.pairingOffer.v, 1);
  assert.equal(result.pairingOffer.sessionId, relay.sessionId);
  assert.equal(result.pairingOffer.relayUrl, relay.baseUrl);
  assert.equal(result.pairingOffer.pairingSecret, result.code);
  assert.match(result.pairingOffer.pairingId, /^pair_/);
  assert.match(result.pairingOffer.daemonPublicKey, /^[A-Za-z0-9_-]{32,}$/);
  assert.match(result.pairingOffer.nonce, /^[A-Za-z0-9_-]{16,}$/);
  assert.ok(result.pairingOffer.features.includes("attention_inbox"));
  assert.match(result.pairUrl, new RegExp(`^${relay.baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/#pair=`));
  assert.match(result.qrSvg, /^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(result.qrSvg, /<path d="/);
  assert.ok(Array.isArray(result.qrTerminal));
  assert.ok(result.qrTerminal.length > 10);
  assert.match(result.qrTerminal.join("\n"), /██/);

  const response = await fetch(`${relay.baseUrl}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pairingOffer: result.pairingOffer,
      label: "qr pairing test",
      devicePublicKey: { kty: "OKP", crv: "X25519", x: "device-test-public-key" }
    })
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /legax_device=/);
});

test("self-hosted relay exposes an actionable attention inbox", async (t) => {
  const relay = await startRelay(t, { sessionId: "attention-e2e" });

  for (const event of [
    {
      kind: "active_context",
      agentId: "codex-cli",
      agentLabel: "Codex CLI",
      text: "Active: session-a",
      metadata: { sessionName: "session-a", projectName: "legax", cliName: "Codex CLI" }
    },
    {
      kind: "permission_request",
      agentId: "codex-cli",
      text: "Approve npm test?",
      metadata: { requestId: "approval-1", command: "npm test" }
    },
    {
      kind: "input_request",
      agentId: "codex-cli",
      text: "Need branch name",
      metadata: { requestId: "input-1" }
    },
    {
      kind: "error",
      agentId: "codex-cli",
      text: "Adapter crashed",
      metadata: { severity: "error" }
    },
    {
      kind: "agent_summary",
      agentId: "codex-cli",
      text: "Tests finished",
      metadata: { status: "completed" }
    }
  ]) {
    const result = await fetchJson(`${relay.baseUrl}/api/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-legax-secret": relay.desktopSecret
      },
      body: JSON.stringify({ sessionId: relay.sessionId, ...event })
    });
    assert.equal(result.ok, true);
  }

  const inbox = await fetchJson(`${relay.baseUrl}/api/attention?sessionId=${relay.sessionId}`);
  assert.equal(inbox.ok, true);
  assert.equal(inbox.activeContext.sessionName, "session-a");
  assert.deepEqual(
    inbox.items.map((item) => item.type),
    ["approval", "input", "error", "completion"]
  );
  assert.equal(inbox.items[0].requestId, "approval-1");

  const ack = await fetchJson(`${relay.baseUrl}/api/attention/ack`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({ sessionId: relay.sessionId, ids: [inbox.items[0].id] })
  });
  assert.equal(ack.ok, true);

  const afterAck = await fetchJson(`${relay.baseUrl}/api/attention?sessionId=${relay.sessionId}`);
  assert.deepEqual(afterAck.items.map((item) => item.type), ["input", "error", "completion"]);
});

test("daemon-control pair registers a daemon-generated pairing code", async (t) => {
  const relay = await startRelay(t, { sessionId: "daemon-pair-e2e" });

  const result = spawnSync(process.execPath, ["scripts/daemon-control.mjs", "pair", "--code", "112233"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: relay.configPath
    },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Pairing code: 112233/);
  assert.match(result.stdout, new RegExp(`${relay.baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`));
  assert.match(result.stdout, /Scan QR from the phone:/);
  assert.match(result.stdout, /██/);

  const response = await fetch(`${relay.baseUrl}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "112233", label: "daemon pair test" })
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /legax_device=/);
});

test("self-hosted relay page renders session action metadata", async (t) => {
  const relay = await startRelay(t, { sessionId: "relay-actions-e2e" });

  await fetchJson(`${relay.baseUrl}/api/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      agentId: "codex-cli",
      agentLabel: "Codex CLI",
      source: "codex-app-server",
      kind: "agent_text",
      text: "hello from selected session",
      metadata: {
        threadId: "thread-second",
        threadTitle: "Second fake session",
        telegramReplyMarkup: {
          inline_keyboard: [
            [{ text: "Use this session", callback_data: "legax:session:codex-cli:thread-second" }]
          ]
        }
      }
    })
  });

  const phoneEvents = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
  assert.equal(phoneEvents.events.length, 1);
  assert.equal(phoneEvents.events[0].metadata.threadTitle, "Second fake session");
  assert.equal(
    phoneEvents.events[0].metadata.telegramReplyMarkup.inline_keyboard[0][0].callback_data,
    "legax:session:codex-cli:thread-second"
  );
});

test("self-hosted relay accepts paired browser cookies for phone writes", async (t) => {
  const relay = await startRelay(t, { sessionId: "fragment-auth-e2e" });

  const messageResult = await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "codex-cli",
      type: "text",
      text: "header auth works"
    })
  });
  assert.equal(messageResult.ok, true);

  const desktopMessages = await fetchJson(`${relay.baseUrl}/api/messages?sessionId=${relay.sessionId}&after=0&agentId=codex-cli`, {
    headers: { "x-legax-secret": relay.desktopSecret }
  });
  assert.equal(desktopMessages.messages.length, 1);
  assert.equal(desktopMessages.messages[0].text, "header auth works");
});

test("self-hosted relay keeps sessions isolated and honors cursors", async (t) => {
  const relay = await startRelay(t, { sessionId: "session-a" });
  const sessionBCookie = await pairRelayDevice(relay, { sessionId: "session-b", label: "session-b browser" });

  for (const [sessionId, text] of [["session-a", "a1"], ["session-b", "b1"], ["session-a", "a2"]]) {
    const result = await fetchJson(`${relay.baseUrl}/api/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-legax-secret": relay.desktopSecret
      },
      body: JSON.stringify({ sessionId, kind: "status", text })
    });
    assert.equal(result.ok, true);
  }

  const firstA = await fetchJson(`${relay.baseUrl}/api/events?sessionId=session-a&after=0`);
  assert.deepEqual(firstA.events.map((event) => event.text), ["a1", "a2"]);

  const afterOne = await fetchJson(`${relay.baseUrl}/api/events?sessionId=session-a&after=1`);
  assert.deepEqual(afterOne.events.map((event) => event.text), ["a2"]);

  const firstB = await fetchJson(`${relay.baseUrl}/api/events?sessionId=session-b&after=0`, {
    headers: { cookie: sessionBCookie }
  });
  assert.deepEqual(firstB.events.map((event) => event.text), ["b1"]);
});

test("self-hosted relay routes phone messages by target agent in one session", async (t) => {
  const relay = await startRelay(t, { sessionId: "routing-e2e" });

  for (const [agentId, agentLabel] of [["codex-cli", "Codex CLI"], ["claude-code", "Claude Code"], ["gemini-cli", "Gemini CLI"]]) {
    await fetchJson(`${relay.baseUrl}/api/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-legax-secret": relay.desktopSecret
      },
      body: JSON.stringify({
        sessionId: relay.sessionId,
        agentId,
        agentLabel,
        source: agentId,
        kind: "status",
        text: `${agentLabel} online`
      })
    });
  }

  const agents = await fetchJson(`${relay.baseUrl}/api/agents?sessionId=${relay.sessionId}`);
  assert.deepEqual(agents.agents.map((agent) => agent.id).sort(), ["claude-code", "codex-cli", "gemini-cli"]);

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "claude-code",
      type: "text",
      text: "only claude should see this"
    })
  });

  const claudeMessages = await fetchJson(`${relay.baseUrl}/api/messages?sessionId=${relay.sessionId}&after=0&agentId=claude-code`, {
    headers: { "x-legax-secret": relay.desktopSecret }
  });
  assert.equal(claudeMessages.messages.length, 1);
  assert.equal(claudeMessages.messages[0].text, "only claude should see this");

  const codexMessages = await fetchJson(`${relay.baseUrl}/api/messages?sessionId=${relay.sessionId}&after=0&agentId=codex-cli`, {
    headers: { "x-legax-secret": relay.desktopSecret }
  });
  assert.equal(codexMessages.messages.length, 0);

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "*",
      type: "control",
      action: "set_mode",
      mode: "paused"
    })
  });

  const geminiMessages = await fetchJson(`${relay.baseUrl}/api/messages?sessionId=${relay.sessionId}&after=0&agentId=gemini-cli`, {
    headers: { "x-legax-secret": relay.desktopSecret }
  });
  assert.equal(geminiMessages.messages.length, 1);
  assert.equal(geminiMessages.messages[0].type, "control");
});

test("self-hosted relay rejects unsafe or wrong write-side credentials", async (t) => {
  const relay = await startRelay(t, {
    sessionId: "auth-e2e",
    desktopSecret: "desktop-only"
  });

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      skipRelayCookie: true,
      body: JSON.stringify({ sessionId: relay.sessionId, type: "text", text: "missing browser cookie should fail" })
    }),
    { status: 401 }
  );

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/events?secret=${relay.desktopSecret}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      skipRelayCookie: true,
      body: JSON.stringify({ sessionId: relay.sessionId, kind: "status", text: "query secret should fail" })
    }),
    { status: 401 }
  );

  const result = await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({ sessionId: relay.sessionId, type: "text", text: "should pass" })
  });
  assert.equal(result.ok, true);
});

test("self-hosted relay keeps empty-secret insecure dev mode on loopback", async (t) => {
  const relay = await startRelay(t, {
    sessionId: "insecure-dev-e2e",
    host: "0.0.0.0",
    desktopSecret: "",
    allowInsecureDev: true
  });

  await waitFor(() => {
    assert.match(relay.stderr(), /Binding to 127\.0\.0\.1 only/);
  });

  const result = await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: relay.sessionId, type: "text", text: "local insecure dev only" })
  });
  assert.equal(result.ok, true);
});
