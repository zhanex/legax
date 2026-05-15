import assert from "node:assert/strict";
import test from "node:test";
import { buildFeishuMessagePayload, dispatchAdditionalTransports } from "../../scripts/lib/outbound-transports.mjs";
import { fetchJson, startRelay } from "./helpers.mjs";

test("Feishu app transport sends permission requests as interactive cards", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      headers: options.headers ?? {},
      body: options.body ? JSON.parse(options.body) : {}
    });
    if (String(url).endsWith("/open-apis/auth/v3/tenant_access_token/internal")) {
      return new Response(JSON.stringify({
        code: 0,
        msg: "ok",
        tenant_access_token: "tenant-token",
        expire: 7200
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      code: 0,
      msg: "ok",
      data: { message_id: "om_test" }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const event = {
    sessionId: "feishu-outbound-e2e",
    kind: "permission_request",
    agentId: "codex-cli",
    agentLabel: "Codex CLI",
    text: "Run npm test?",
    metadata: {
      requestId: "codex-approval-1",
      projectName: "legax",
      threadTitle: "Feature branch"
    }
  };
  const transport = {
    name: "feishu",
    type: "feishu",
    enabled: true,
    appId: "cli_xxx",
    appSecret: "replace-with-secret",
    receiveIdType: "chat_id",
    receiveId: "oc_test",
    timeoutMs: 1000
  };

  const payload = buildFeishuMessagePayload({}, transport, event);
  assert.equal(payload.receive_id, "oc_test");
  assert.equal(payload.msg_type, "interactive");
  const card = JSON.parse(payload.content);
  assert.equal(card.header.title.content, "Codex CLI Approval");
  assert.equal(card.elements.at(-1).tag, "action");
  assert.deepEqual(card.elements.at(-1).actions.map((action) => action.value.legaxAction), ["approve", "deny"]);
  assert.equal(card.elements.at(-1).actions[0].value.requestId, "codex-approval-1");
  assert.equal(card.elements.at(-1).actions[0].value.targetAgentId, "codex-cli");

  const results = await dispatchAdditionalTransports({
    transports: [transport]
  }, event);

  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.app_id, "cli_xxx");
  assert.match(calls[1].url, /\/open-apis\/im\/v1\/messages\?receive_id_type=chat_id$/);
  assert.equal(calls[1].headers.authorization, "Bearer tenant-token");
  assert.equal(calls[1].body.receive_id, "oc_test");
  assert.equal(calls[1].body.msg_type, "interactive");
});

test("Feishu relay callback verifies challenge and queues text replies plus approval decisions", async (t) => {
  const relay = await startRelay(t, {
    sessionId: "feishu-callback-e2e",
    extraYaml: [
      "routing:",
      "  defaultTarget: codex-cli",
      "transports:",
      "  - name: feishu",
      "    type: feishu",
      "    enabled: true",
      "    verificationToken: verify-token",
      "    defaultTarget: codex-cli"
    ].join("\n")
  });

  const challenge = await fetchJson(`${relay.baseUrl}/api/feishu/events?sessionId=${relay.sessionId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    skipRelayCookie: true,
    body: JSON.stringify({
      type: "url_verification",
      token: "verify-token",
      challenge: "challenge-value"
    })
  });
  assert.deepEqual(challenge, { challenge: "challenge-value" });

  await fetchJson(`${relay.baseUrl}/api/feishu/events?sessionId=${relay.sessionId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    skipRelayCookie: true,
    body: JSON.stringify({
      schema: "2.0",
      header: {
        event_id: "evt_text",
        event_type: "im.message.receive_v1",
        create_time: "1700000000000",
        token: "verify-token"
      },
      event: {
        message: {
          chat_id: "oc_test",
          message_id: "om_text",
          message_type: "text",
          content: "{\"text\":\"hello from feishu\"}"
        }
      }
    })
  });

  await fetchJson(`${relay.baseUrl}/api/feishu/events?sessionId=${relay.sessionId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    skipRelayCookie: true,
    body: JSON.stringify({
      schema: "2.0",
      header: {
        event_id: "evt_card",
        event_type: "card.action.trigger",
        create_time: "1700000001000",
        token: "verify-token"
      },
      event: {
        action: {
          value: {
            legaxAction: "approve",
            requestId: "codex-approval-1",
            targetAgentId: "codex-cli"
          }
        }
      }
    })
  });

  const desktopMessages = await fetchJson(`${relay.baseUrl}/api/messages?sessionId=${relay.sessionId}&after=0&agentId=codex-cli`, {
    headers: { "x-legax-secret": relay.desktopSecret }
  });

  assert.equal(desktopMessages.messages.length, 2);
  assert.equal(desktopMessages.messages[0].id, "feishu:evt_text");
  assert.equal(desktopMessages.messages[0].transport, "feishu");
  assert.equal(desktopMessages.messages[0].type, "text");
  assert.equal(desktopMessages.messages[0].targetAgentId, "codex-cli");
  assert.equal(desktopMessages.messages[0].text, "hello from feishu");
  assert.equal(desktopMessages.messages[0].createdAt, "2023-11-14T22:13:20.000Z");
  assert.equal(desktopMessages.messages[1].type, "permission_decision");
  assert.equal(desktopMessages.messages[1].requestId, "codex-approval-1");
  assert.equal(desktopMessages.messages[1].decision, "approve");
});
