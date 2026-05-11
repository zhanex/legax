import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGAX_EVENT_KINDS,
  normalizeLegaxEvent,
  validateLegaxEvent
} from "../../scripts/lib/legax-protocol.mjs";

test("Legax protocol accepts the standard cross-adapter event kinds", () => {
  const expectedKinds = [
    "active_context",
    "approval_request",
    "input_request",
    "agent_summary",
    "session_list",
    "attention_item"
  ];
  assert.deepEqual(expectedKinds.every((kind) => LEGAX_EVENT_KINDS.includes(kind)), true);

  for (const kind of expectedKinds) {
    const event = normalizeLegaxEvent({
      kind,
      sessionId: "protocol-e2e",
      agentId: "codex-cli",
      text: `${kind} body`,
      metadata: kind === "session_list" ? { sessions: [{ id: "s1", name: "Chat" }] } : {}
    });
    assert.equal(event.v, 1);
    assert.equal(event.kind, kind);
    assert.equal(event.sessionId, "protocol-e2e");
    assert.match(event.id, /^legax_evt_/);
    assert.doesNotThrow(() => validateLegaxEvent(event));
  }
});

test("Legax protocol rejects events without a known kind or session", () => {
  assert.throws(
    () => validateLegaxEvent({ kind: "unknown", sessionId: "protocol-e2e" }),
    /unsupported Legax event kind/
  );
  assert.throws(
    () => validateLegaxEvent({ kind: "active_context", agentId: "codex-cli" }),
    /sessionId/
  );
});
