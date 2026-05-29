import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { closeHttpServer, fetchJson, getFreePort, pairRelayDevice, pluginRoot, sleep, startRelay, waitFor } from "./helpers.mjs";

async function pairBrowser(relay, { code = "482913", sessionId = relay.sessionId, label = "test phone" } = {}) {
  return pairRelayDevice(relay, { code, sessionId, label });
}

const REQUIRED_RELAY_STORE_DOMAINS = [
  "sessions",
  "generations",
  "leases",
  "handoffs",
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

  for (const file of ["relay-server-core.mjs", "yaml.mjs", "paths.mjs", "telegram-transport.mjs", "outbound-transports.mjs", "menu-groups.mjs"]) {
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

test("self-hosted relay persists host heartbeats and computes liveness", async (t) => {
  const relay = await startRelay(t, { sessionId: "host-registry-e2e" });

  const registered = await fetchJson(`${relay.baseUrl}/api/hosts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    skipRelayCookie: true,
    body: JSON.stringify({
      hostId: "host-a",
      version: "0.0.3-test",
      capabilities: { platform: "test" },
      adapters: [{ agentId: "codex-cli", agentLabel: "Codex CLI" }],
      commandRefs: ["legax.ping", "agent.list"],
      groups: ["default", "windows"],
      publicKey: { kid: "test-key" },
      ttlMs: 200
    })
  });
  assert.equal(registered.host.id, "host-a");
  assert.equal(registered.host.status, "online");

  const online = await fetchJson(`${relay.baseUrl}/api/hosts`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  assert.equal(online.hosts[0].id, "host-a");
  assert.equal(online.hosts[0].status, "online");
  assert.deepEqual(online.hosts[0].commandRefs, ["legax.ping", "agent.list"]);

  await sleep(260);
  const offline = await fetchJson(`${relay.baseUrl}/api/hosts`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  assert.equal(offline.hosts[0].status, "offline");
});

test("self-hosted relay command queue claims, completes, expires, and rejects stale results", async (t) => {
  const relay = await startRelay(t, { sessionId: "command-queue-e2e" });
  await fetchJson(`${relay.baseUrl}/api/hosts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    skipRelayCookie: true,
    body: JSON.stringify({
      hostId: "host-a",
      commandRefs: ["legax.ping"],
      groups: ["blue"],
      ttlMs: 5000
    })
  });

  const created = await fetchJson(`${relay.baseUrl}/api/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: relay.sessionId,
      idempotencyKey: "idem-command-1",
      commandRef: "legax.ping",
      targetHostId: "host-a",
      payload: { text: "hello" },
      maxAttempts: 2
    })
  });
  assert.equal(created.command.state, "pending");

  const duplicate = await fetchJson(`${relay.baseUrl}/api/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: relay.sessionId,
      idempotencyKey: "idem-command-1",
      commandRef: "legax.ping",
      targetHostId: "host-a",
      payload: { text: "duplicate" }
    })
  });
  assert.equal(duplicate.command.id, created.command.id);
  assert.equal(duplicate.idempotent, true);

  const eligible = await fetchJson(`${relay.baseUrl}/api/commands?hostId=host-a&commandRefs=legax.ping`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  assert.deepEqual(eligible.commands.map((command) => command.id), [created.command.id]);

  const unauthorized = await fetchJson(`${relay.baseUrl}/api/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    skipRelayCookie: true,
    body: JSON.stringify({
      commandRef: "agent.list",
      targetHostId: "host-a",
      payload: {}
    })
  });
  const unauthorizedPoll = await fetchJson(`${relay.baseUrl}/api/commands?hostId=host-a&commandRefs=agent.list`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  assert.deepEqual(unauthorizedPoll.commands.map((command) => command.id), []);
  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/commands/${unauthorized.command.id}/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-legax-secret": relay.desktopSecret
      },
      skipRelayCookie: true,
      body: JSON.stringify({ hostId: "host-a", commandRefs: ["agent.list"] })
    }),
    { status: 403 }
  );

  const claimed = await fetchJson(`${relay.baseUrl}/api/commands/${created.command.id}/claim`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    skipRelayCookie: true,
    body: JSON.stringify({ hostId: "host-a", claimTtlMs: 5000 })
  });
  assert.equal(claimed.command.state, "running");
  assert.equal(claimed.command.claimedBy, "host-a");
  assert.ok(claimed.command.claimToken);

  const completed = await fetchJson(`${relay.baseUrl}/api/commands/${created.command.id}/result`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    skipRelayCookie: true,
    body: JSON.stringify({
      hostId: "host-a",
      claimToken: claimed.command.claimToken,
      state: "succeeded",
      result: { pong: true }
    })
  });
  assert.equal(completed.command.state, "succeeded");
  assert.deepEqual(completed.command.result, { pong: true });

  const duplicateResult = await fetchJson(`${relay.baseUrl}/api/commands/${created.command.id}/result`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    skipRelayCookie: true,
    body: JSON.stringify({
      hostId: "host-a",
      claimToken: claimed.command.claimToken,
      state: "succeeded",
      result: { pong: true }
    })
  });
  assert.equal(duplicateResult.idempotent, true);

  const stale = await fetchJson(`${relay.baseUrl}/api/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    skipRelayCookie: true,
    body: JSON.stringify({
      commandRef: "legax.ping",
      targetGroup: "blue",
      payload: {},
      maxAttempts: 1
    })
  });
  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/commands/${stale.command.id}/result`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-legax-secret": relay.desktopSecret
      },
      skipRelayCookie: true,
      body: JSON.stringify({
        hostId: "host-a",
        claimToken: "stale-token",
        state: "succeeded",
        result: {}
      })
    }),
    { status: 409 }
  );

  const expiring = await fetchJson(`${relay.baseUrl}/api/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    skipRelayCookie: true,
    body: JSON.stringify({
      commandRef: "legax.ping",
      targetHostId: "host-a",
      ttlMs: 1
    })
  });
  await sleep(20);
  const expired = await fetchJson(`${relay.baseUrl}/api/commands/${expiring.command.id}`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  assert.equal(expired.command.state, "expired");
});

test("self-hosted relay manages portable sessions, generations, leases, forks, and handoffs", async (t) => {
  const relay = await startRelay(t, { sessionId: "portable-session-e2e" });
  const desktopHeaders = {
    "content-type": "application/json",
    "x-legax-secret": relay.desktopSecret
  };

  const sessionResponse = await fetchJson(`${relay.baseUrl}/api/sessions`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: "portable-session-e2e",
      title: "Portable session",
      selectedAgentId: "gemini-cli",
      transportBindings: { telegram: { chatId: "1001" } },
      metadata: { issue: 25 }
    })
  });
  assert.equal(sessionResponse.session.id, "portable-session-e2e");
  assert.equal(sessionResponse.session.selectedAgentId, "gemini-cli");
  assert.equal(sessionResponse.session.currentGenerationId, "");

  const generationResponse = await fetchJson(`${relay.baseUrl}/api/generations`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: "portable-session-e2e",
      hostId: "host-a",
      adapterId: "gemini-cli",
      nativeSession: { provider: "gemini", id: "native-gemini-session" },
      worktree: { path: "F:/workspace/example" },
      checkpoint: { artifactId: "checkpoint-0" }
    })
  });
  assert.equal(generationResponse.generation.sessionId, "portable-session-e2e");
  assert.equal(generationResponse.generation.hostId, "host-a");
  assert.deepEqual(generationResponse.generation.nativeSession, { provider: "gemini", id: "native-gemini-session" });

  const sessionAfterGeneration = await fetchJson(`${relay.baseUrl}/api/sessions/portable-session-e2e`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  assert.equal(sessionAfterGeneration.session.currentGenerationId, generationResponse.generation.id);

  const claimed = await fetchJson(`${relay.baseUrl}/api/leases/claim`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: "portable-session-e2e",
      generationId: generationResponse.generation.id,
      hostId: "host-a",
      ttlMs: 5000
    })
  });
  assert.equal(claimed.lease.state, "active");
  assert.equal(claimed.lease.hostId, "host-a");
  assert.ok(claimed.lease.fencingToken);

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/generations/${generationResponse.generation.id}/update`, {
      method: "POST",
      headers: desktopHeaders,
      skipRelayCookie: true,
      body: JSON.stringify({
        hostId: "host-a",
        fencingToken: "stale-token",
        state: "running"
      })
    }),
    { status: 409 }
  );

  const updated = await fetchJson(`${relay.baseUrl}/api/generations/${generationResponse.generation.id}/update`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      hostId: "host-a",
      fencingToken: claimed.lease.fencingToken,
      leaseToken: claimed.lease.token,
      state: "running",
      checkpoint: { artifactId: "checkpoint-1" }
    })
  });
  assert.equal(updated.generation.state, "running");
  assert.equal(updated.generation.checkpoint.artifactId, "checkpoint-1");

  const renewed = await fetchJson(`${relay.baseUrl}/api/leases/${claimed.lease.id}/renew`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      hostId: "host-a",
      fencingToken: claimed.lease.fencingToken,
      leaseToken: claimed.lease.token,
      ttlMs: 5000
    })
  });
  assert.equal(renewed.lease.state, "active");
  assert.ok(Date.parse(renewed.lease.expiresAt) >= Date.parse(claimed.lease.expiresAt));

  const released = await fetchJson(`${relay.baseUrl}/api/leases/${claimed.lease.id}/release`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      hostId: "host-a",
      fencingToken: claimed.lease.fencingToken,
      leaseToken: claimed.lease.token
    })
  });
  assert.equal(released.lease.state, "released");

  const reclaimed = await fetchJson(`${relay.baseUrl}/api/leases/claim`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: "portable-session-e2e",
      generationId: generationResponse.generation.id,
      hostId: "host-b",
      ttlMs: 5000
    })
  });
  assert.equal(reclaimed.lease.hostId, "host-b");
  assert.notEqual(reclaimed.lease.fencingToken, claimed.lease.fencingToken);

  await fetchJson(`${relay.baseUrl}/api/leases/${reclaimed.lease.id}/release`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      hostId: "host-b",
      fencingToken: reclaimed.lease.fencingToken,
      leaseToken: reclaimed.lease.token
    })
  });

  const expiringLease = await fetchJson(`${relay.baseUrl}/api/leases/claim`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: "portable-session-e2e",
      generationId: generationResponse.generation.id,
      hostId: "host-c",
      ttlMs: 1,
      reclaimExpired: true
    })
  });
  await sleep(20);
  const expiredLease = await fetchJson(`${relay.baseUrl}/api/leases/${expiringLease.lease.id}`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  assert.equal(expiredLease.lease.state, "expired");
  const generationAfterLeaseExpiry = await fetchJson(`${relay.baseUrl}/api/generations/${generationResponse.generation.id}`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  assert.equal(generationAfterLeaseExpiry.generation.leaseId, "");

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/leases/claim`, {
      method: "POST",
      headers: desktopHeaders,
      skipRelayCookie: true,
      body: JSON.stringify({
        sessionId: "portable-session-e2e",
        generationId: generationResponse.generation.id,
        hostId: "host-d",
        ttlMs: 5000
      })
    }),
    { status: 409 }
  );

  const reclaimedExpired = await fetchJson(`${relay.baseUrl}/api/leases/claim`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: "portable-session-e2e",
      generationId: generationResponse.generation.id,
      hostId: "host-d",
      ttlMs: 5000,
      reclaimExpired: true
    })
  });
  assert.equal(reclaimedExpired.lease.hostId, "host-d");

  const parentBeforeFork = await fetchJson(`${relay.baseUrl}/api/generations/${generationResponse.generation.id}`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  const forked = await fetchJson(`${relay.baseUrl}/api/generations/${generationResponse.generation.id}/fork`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      leaseHostId: "host-d",
      fencingToken: reclaimedExpired.lease.fencingToken,
      leaseToken: reclaimedExpired.lease.token,
      hostId: "host-e",
      adapterId: "gemini-cli",
      checkpoint: { artifactId: "checkpoint-1" }
    })
  });
  assert.equal(forked.generation.baseGenerationId, generationResponse.generation.id);
  assert.equal(forked.generation.hostId, "host-e");
  assert.equal(forked.generation.checkpoint.artifactId, "checkpoint-1");
  const parentAfterFork = await fetchJson(`${relay.baseUrl}/api/generations/${generationResponse.generation.id}`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  assert.deepEqual(parentAfterFork.generation, parentBeforeFork.generation);

  const handoff = await fetchJson(`${relay.baseUrl}/api/handoffs`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: "portable-session-e2e",
      generationId: forked.generation.id,
      fromHostId: "host-e",
      toHostId: "host-f"
    })
  });
  assert.equal(handoff.handoff.state, "requested");

  for (const state of ["checkpointed", "uploaded", "released", "claimed", "restored", "resumed"]) {
    const transitioned = await fetchJson(`${relay.baseUrl}/api/handoffs/${handoff.handoff.id}/transition`, {
      method: "POST",
      headers: desktopHeaders,
      skipRelayCookie: true,
      body: JSON.stringify({
        state,
        ...(state === "checkpointed" ? { artifactId: "checkpoint-1" } : {})
      })
    });
    assert.equal(transitioned.handoff.state, state);
    if (state === "checkpointed") {
      assert.equal(transitioned.handoff.checkpointArtifactId, "checkpoint-1");
      assert.deepEqual(transitioned.handoff.artifactIds, ["checkpoint-1"]);
    }
    const retried = await fetchJson(`${relay.baseUrl}/api/handoffs/${handoff.handoff.id}/transition`, {
      method: "POST",
      headers: desktopHeaders,
      skipRelayCookie: true,
      body: JSON.stringify({ state })
    });
    assert.equal(retried.handoff.state, state);
  }

  const readHandoff = await fetchJson(`${relay.baseUrl}/api/handoffs/${handoff.handoff.id}`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  assert.equal(readHandoff.handoff.state, "resumed");
  assert.equal(readHandoff.handoff.checkpointArtifactId, "checkpoint-1");
  assert.equal(readHandoff.handoff.transitions.length, 7);

  const store = JSON.parse(await fs.readFile(relay.storePath, "utf8"));
  const handoffEvents = store.events
    .filter((event) => event.handoffId === handoff.handoff.id)
    .map((event) => event.kind);
  assert.deepEqual(handoffEvents, [
    "handoff.requested",
    "handoff.checkpointed",
    "handoff.uploaded",
    "handoff.released",
    "handoff.claimed",
    "handoff.restored",
    "handoff.resumed"
  ]);

  const failedHandoff = await fetchJson(`${relay.baseUrl}/api/handoffs`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: "portable-session-e2e",
      generationId: forked.generation.id,
      fromHostId: "host-e",
      toHostId: "host-g"
    })
  });
  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/handoffs/${failedHandoff.handoff.id}/transition`, {
      method: "POST",
      headers: desktopHeaders,
      skipRelayCookie: true,
      body: JSON.stringify({ state: "restored" })
    }),
    { status: 409 }
  );
  const failed = await fetchJson(`${relay.baseUrl}/api/handoffs/${failedHandoff.handoff.id}/transition`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({ state: "failed", error: { message: "checkpoint missing" } })
  });
  assert.equal(failed.handoff.state, "failed");
  assert.equal(failed.handoff.error.message, "checkpoint missing");
  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/handoffs/${failedHandoff.handoff.id}/transition`, {
      method: "POST",
      headers: desktopHeaders,
      skipRelayCookie: true,
      body: JSON.stringify({ state: "requested" })
    }),
    { status: 409 }
  );
});

test("self-hosted relay stores checkpoint artifacts as ciphertext metadata only", async (t) => {
  const relay = await startRelay(t, { sessionId: "artifact-e2e" });
  const desktopHeaders = {
    "content-type": "application/json",
    "x-legax-secret": relay.desktopSecret
  };

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/artifacts`, {
      method: "POST",
      headers: desktopHeaders,
      skipRelayCookie: true,
      body: JSON.stringify({
        artifactId: "artifact-plaintext",
        sessionId: "artifact-e2e",
        type: "checkpoint.bundle",
        plaintext: "plaintext-secret"
      })
    }),
    { status: 400 }
  );
  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/artifacts`, {
      method: "POST",
      headers: desktopHeaders,
      skipRelayCookie: true,
      body: JSON.stringify({
        artifactId: "artifact-metadata-plaintext",
        sessionId: "artifact-e2e",
        type: "checkpoint.bundle",
        metadata: { files: [{ path: "src/app.txt", content: "plaintext-secret" }] },
        encryption: { algorithm: "AES-256-GCM" },
        ciphertext: { algorithm: "AES-256-GCM", iv: "iv", tag: "tag", ciphertext: "ciphertext" },
        wrappedKeys: [{ recipientKid: "host-key-1", ciphertext: "wrapped-key" }]
      })
    }),
    { status: 400 }
  );
  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/artifacts`, {
      method: "POST",
      headers: desktopHeaders,
      skipRelayCookie: true,
      body: JSON.stringify({
        artifactId: "artifact-ciphertext-plaintext",
        sessionId: "artifact-e2e",
        type: "checkpoint.bundle",
        metadata: { schema: "legax.checkpoint/1" },
        encryption: { algorithm: "AES-256-GCM" },
        ciphertext: { algorithm: "AES-256-GCM", iv: "iv", tag: "tag", ciphertext: "ciphertext", files: ["plaintext-secret"] },
        wrappedKeys: [{ recipientKid: "host-key-1", ciphertext: "wrapped-key" }]
      })
    }),
    { status: 400 }
  );

  const generationResponse = await fetchJson(`${relay.baseUrl}/api/generations`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: "artifact-e2e",
      hostId: "artifact-host",
      adapterId: "gemini-cli",
      nativeSession: { provider: "gemini", id: "native-artifact-session" }
    })
  });
  const leaseResponse = await fetchJson(`${relay.baseUrl}/api/leases/claim`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: "artifact-e2e",
      generationId: generationResponse.generation.id,
      hostId: "artifact-host",
      ttlMs: 30000
    })
  });
  const artifactBody = {
    artifactId: "artifact-checkpoint-e2e",
    sessionId: "artifact-e2e",
    generationId: generationResponse.generation.id,
    type: "checkpoint.bundle",
    idempotencyKey: "artifact-idem-1",
    leaseHostId: "artifact-host",
    fencingToken: leaseResponse.lease.fencingToken,
    leaseToken: leaseResponse.lease.token,
    metadata: {
      schema: "legax.checkpoint/1",
      sessionId: "artifact-e2e",
      generationId: generationResponse.generation.id,
      fileCount: 1
    },
    encryption: {
      algorithm: "AES-256-GCM",
      keyWrap: "X25519-HKDF-SHA256+A256GCM"
    },
    ciphertext: {
      algorithm: "AES-256-GCM",
      iv: "base64url-iv",
      tag: "base64url-tag",
      ciphertext: Buffer.from("ciphertext-not-plaintext").toString("base64url")
    },
    wrappedKeys: [{
      recipientKid: "host-key-1",
      algorithm: "X25519-HKDF-SHA256+A256GCM",
      ephemeralPublicKey: { kty: "OKP", crv: "X25519", x: "ephemeral" },
      iv: "wrap-iv",
      tag: "wrap-tag",
      ciphertext: "wrapped-key"
    }]
  };

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/artifacts`, {
      method: "POST",
      headers: desktopHeaders,
      skipRelayCookie: true,
      body: JSON.stringify({
        ...artifactBody,
        leaseToken: "stale-artifact-lease"
      })
    }),
    { status: 409 }
  );

  const uploaded = await fetchJson(`${relay.baseUrl}/api/artifacts`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify(artifactBody)
  });
  assert.equal(uploaded.artifact.id, "artifact-checkpoint-e2e");
  assert.equal(uploaded.artifact.type, "checkpoint.bundle");

  const duplicate = await fetchJson(`${relay.baseUrl}/api/artifacts`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      ...artifactBody,
      metadata: uploaded.artifact.metadata,
      encryption: uploaded.artifact.encryption,
      ciphertext: uploaded.artifact.ciphertext,
      wrappedKeys: uploaded.artifact.wrappedKeys
    })
  });
  assert.equal(duplicate.idempotent, true);

  const fetched = await fetchJson(`${relay.baseUrl}/api/artifacts/artifact-checkpoint-e2e`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  assert.equal(fetched.artifact.metadata.fileCount, 1);
  const storeText = await fs.readFile(relay.storePath, "utf8");
  assert.doesNotMatch(storeText, /plaintext-secret/);
  assert.match(storeText, new RegExp(Buffer.from("ciphertext-not-plaintext").toString("base64url")));
});

test("self-hosted relay rejects checkpoint key wraps for revoked devices", async (t) => {
  const relay = await startRelay(t, { sessionId: "artifact-revoked-device-e2e" });
  const desktopHeaders = {
    "content-type": "application/json",
    "x-legax-secret": relay.desktopSecret
  };

  await fetchJson(`${relay.baseUrl}/api/pairing-codes`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({ code: "135790", sessionId: relay.sessionId, label: "revoked key wrap device" })
  });
  const pairResponse = await fetch(`${relay.baseUrl}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: "135790",
      label: "revoked key wrap device",
      devicePublicKey: { kty: "OKP", crv: "X25519", x: "revoked-device-public-key", kid: "revoked-device-key" }
    })
  });
  assert.equal(pairResponse.status, 200);
  const paired = await pairResponse.json();
  await fetchJson(`${relay.baseUrl}/api/devices/${encodeURIComponent(paired.device.id)}`, {
    method: "DELETE",
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });

  const generationResponse = await fetchJson(`${relay.baseUrl}/api/generations`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: relay.sessionId,
      hostId: "artifact-device-host",
      adapterId: "gemini-cli"
    })
  });
  const leaseResponse = await fetchJson(`${relay.baseUrl}/api/leases/claim`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: relay.sessionId,
      generationId: generationResponse.generation.id,
      hostId: "artifact-device-host",
      ttlMs: 30000
    })
  });

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/artifacts`, {
      method: "POST",
      headers: desktopHeaders,
      skipRelayCookie: true,
      body: JSON.stringify({
        artifactId: "artifact-revoked-device",
        sessionId: relay.sessionId,
        generationId: generationResponse.generation.id,
        type: "checkpoint.bundle",
        leaseHostId: "artifact-device-host",
        fencingToken: leaseResponse.lease.fencingToken,
        leaseToken: leaseResponse.lease.token,
        metadata: {
          schema: "legax.checkpoint/1",
          sessionId: relay.sessionId,
          generationId: generationResponse.generation.id
        },
        encryption: { algorithm: "AES-256-GCM" },
        ciphertext: {
          algorithm: "AES-256-GCM",
          iv: "base64url-iv",
          tag: "base64url-tag",
          ciphertext: "ciphertext"
        },
        wrappedKeys: [{
          recipientKid: "revoked-device-key",
          algorithm: "X25519-HKDF-SHA256+A256GCM",
          ciphertext: "wrapped-key"
        }]
      })
    }),
    { status: 409 }
  );
});

test("self-hosted relay validates restricted workflow definitions", async (t) => {
  const relay = await startRelay(t, { sessionId: "workflow-validation-e2e" });
  const desktopHeaders = {
    "content-type": "application/json",
    "x-legax-secret": relay.desktopSecret
  };

  const invalidDefinitions = [
    {
      id: "wf-shell",
      schema: "legax.workflow/1",
      version: "1.0.0",
      steps: [{ id: "unsafe", uses: "legax.ping", shell: "echo nope" }]
    },
    {
      id: "wf-unknown-action",
      schema: "legax.workflow/1",
      version: "1.0.0",
      steps: [{ id: "unknown", uses: "shell.run" }]
    },
    {
      id: "wf-duplicate",
      schema: "legax.workflow/1",
      version: "1.0.0",
      steps: [{ id: "same", uses: "legax.ping" }, { id: "same", uses: "agent.list" }]
    },
    {
      id: "wf-missing-dep",
      schema: "legax.workflow/1",
      version: "1.0.0",
      steps: [{ id: "step-a", uses: "legax.ping", needs: ["missing"] }]
    },
    {
      id: "wf-cycle",
      schema: "legax.workflow/1",
      version: "1.0.0",
      steps: [
        { id: "step-a", uses: "legax.ping", needs: ["step-b"] },
        { id: "step-b", uses: "agent.list", needs: ["step-a"] }
      ]
    }
  ];

  for (const definition of invalidDefinitions) {
    await assert.rejects(
      fetchJson(`${relay.baseUrl}/api/workflow-definitions`, {
        method: "POST",
        headers: desktopHeaders,
        skipRelayCookie: true,
        body: JSON.stringify(definition)
      }),
      { status: 400 }
    );
  }

  const registered = await fetchJson(`${relay.baseUrl}/api/workflow-definitions`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      id: "wf-valid",
      schema: "legax.workflow/1",
      version: "1.0.0",
      metadata: { title: "Valid workflow" },
      inputs: { issue: { type: "number", default: 27 } },
      steps: [
        { id: "capture", uses: "requirements.capture", timeoutMs: 1000 },
        { id: "check", uses: "workflow.run_check", needs: ["capture"], evidence: { required: ["exitCode"] } }
      ]
    })
  });
  assert.equal(registered.definition.id, "wf-valid");
  assert.deepEqual(registered.definition.steps.map((step) => step.id), ["capture", "check"]);

  const fetched = await fetchJson(`${relay.baseUrl}/api/workflow-definitions/wf-valid`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  assert.equal(fetched.definition.schema, "legax.workflow/1");
});

test("self-hosted relay runs restricted workflows with command refs, gates, retries, timeouts, and cancellation", async (t) => {
  const relay = await startRelay(t, { sessionId: "workflow-run-e2e" });
  const desktopHeaders = {
    "content-type": "application/json",
    "x-legax-secret": relay.desktopSecret
  };
  await fetchJson(`${relay.baseUrl}/api/hosts`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      hostId: "host-workflow",
      commandRefs: ["legax.ping", "agent.list"],
      ttlMs: 5000
    })
  });

  await fetchJson(`${relay.baseUrl}/api/workflow-definitions`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      id: "wf-runner",
      schema: "legax.workflow/1",
      version: "1.0.0",
      steps: [
        { id: "prepare", uses: "legax.ping", retry: { maxAttempts: 2 }, timeoutMs: 5000, evidence: { required: ["ok"] } },
        { id: "review", uses: "agent.list", needs: ["prepare"], gate: { before: true, reason: "human review" }, timeoutMs: 5000 }
      ]
    })
  });

  const created = await fetchJson(`${relay.baseUrl}/api/workflow-runs`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      definitionId: "wf-runner",
      sessionId: "workflow-run-e2e",
      targetHostId: "host-workflow",
      inputs: { issue: 27 }
    })
  });
  assert.equal(created.run.state, "running");
  assert.equal(created.run.steps.prepare.state, "running");
  assert.equal(created.run.steps.prepare.commandRef, "legax.ping");
  const firstCommandId = created.run.steps.prepare.commandId;
  assert.ok(firstCommandId);

  const failedOnce = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${created.run.id}/steps/prepare/result`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      commandId: firstCommandId,
      state: "failed",
      error: { message: "first attempt failed" }
    })
  });
  assert.equal(failedOnce.run.steps.prepare.state, "running");
  assert.equal(failedOnce.run.steps.prepare.attempts, 2);
  assert.notEqual(failedOnce.run.steps.prepare.commandId, firstCommandId);
  let workflowStore = JSON.parse(await fs.readFile(relay.storePath, "utf8"));
  assert.equal(workflowStore.commands[firstCommandId].state, "failed");

  const prepared = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${created.run.id}/steps/prepare/result`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      commandId: failedOnce.run.steps.prepare.commandId,
      state: "succeeded",
      result: { ok: true },
      evidence: { ok: true }
    })
  });
  assert.equal(prepared.run.state, "waiting_gate");
  assert.equal(prepared.run.steps.review.state, "waiting_gate");
  assert.equal(prepared.run.gates.review.state, "waiting");
  assert.ok(prepared.run.gates.review.inboxItemId);
  const gateStore = JSON.parse(await fs.readFile(relay.storePath, "utf8"));
  assert.equal(gateStore.commands[failedOnce.run.steps.prepare.commandId].state, "succeeded");
  assert.equal(gateStore.inbox[prepared.run.gates.review.inboxItemId].type, "workflow_gate");
  assert.equal(gateStore.inbox[prepared.run.gates.review.inboxItemId].action, "workflow.gate");

  const approved = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${created.run.id}/gates/review`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({ decision: "approved", decidedBy: "tester" })
  });
  assert.equal(approved.run.state, "running");
  assert.equal(approved.run.steps.review.state, "running");
  assert.equal(approved.run.steps.review.commandRef, "agent.list");

  const reviewed = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${created.run.id}/steps/review/result`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      commandId: approved.run.steps.review.commandId,
      state: "succeeded",
      result: { agents: [] }
    })
  });
  assert.equal(reviewed.run.state, "succeeded");
  workflowStore = JSON.parse(await fs.readFile(relay.storePath, "utf8"));
  assert.equal(workflowStore.commands[approved.run.steps.review.commandId].state, "succeeded");

  const repeated = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${created.run.id}/steps/review/result`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      commandId: approved.run.steps.review.commandId,
      state: "succeeded",
      result: { agents: [] }
    })
  });
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.run.state, "succeeded");

  await fetchJson(`${relay.baseUrl}/api/workflow-definitions`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      id: "wf-timeout",
      schema: "legax.workflow/1",
      version: "1.0.0",
      steps: [{ id: "slow", uses: "legax.ping", timeoutMs: 1, retry: { maxAttempts: 1 } }]
    })
  });
  const timeoutRun = await fetchJson(`${relay.baseUrl}/api/workflow-runs`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({ definitionId: "wf-timeout", sessionId: "workflow-run-e2e", targetHostId: "host-workflow" })
  });
  await sleep(20);
  const expired = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${timeoutRun.run.id}`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  assert.equal(expired.run.state, "expired");
  assert.equal(expired.run.steps.slow.state, "expired");

  const deniedGateRun = await fetchJson(`${relay.baseUrl}/api/workflow-runs`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({ definitionId: "wf-runner", sessionId: "workflow-run-e2e", targetHostId: "host-workflow" })
  });
  const deniedPrepared = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${deniedGateRun.run.id}/steps/prepare/result`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      commandId: deniedGateRun.run.steps.prepare.commandId,
      state: "succeeded",
      result: { ok: true },
      evidence: { ok: true }
    })
  });
  const denied = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${deniedGateRun.run.id}/gates/review`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({ decision: "denied", decidedBy: "tester", reason: "needs changes" })
  });
  assert.equal(denied.run.state, "cancelled");
  assert.equal(denied.run.steps.review.state, "cancelled");
  workflowStore = JSON.parse(await fs.readFile(relay.storePath, "utf8"));
  assert.equal(workflowStore.inbox[deniedPrepared.run.gates.review.inboxItemId].state, "denied");

  const cancellable = await fetchJson(`${relay.baseUrl}/api/workflow-runs`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({ definitionId: "wf-runner", sessionId: "workflow-run-e2e", targetHostId: "host-workflow" })
  });
  const cancelled = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${cancellable.run.id}/cancel`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({ reason: "test cancellation" })
  });
  assert.equal(cancelled.run.state, "cancelled");
  assert.equal(cancelled.run.steps.prepare.state, "cancelled");
  workflowStore = JSON.parse(await fs.readFile(relay.storePath, "utf8"));
  assert.equal(workflowStore.commands[cancellable.run.steps.prepare.commandId].state, "cancelled");

  await fetchJson(`${relay.baseUrl}/api/workflow-definitions`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      id: "wf-fail-fast",
      schema: "legax.workflow/1",
      version: "1.0.0",
      steps: [
        { id: "first", uses: "legax.ping", timeoutMs: 5000 },
        { id: "second", uses: "agent.list", timeoutMs: 5000 }
      ]
    })
  });
  const failFast = await fetchJson(`${relay.baseUrl}/api/workflow-runs`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({ definitionId: "wf-fail-fast", sessionId: "workflow-run-e2e", targetHostId: "host-workflow" })
  });
  assert.equal(failFast.run.steps.first.state, "running");
  assert.equal(failFast.run.steps.second.state, "running");
  const failedFast = await fetchJson(`${relay.baseUrl}/api/workflow-runs/${failFast.run.id}/steps/first/result`, {
    method: "POST",
    headers: desktopHeaders,
    skipRelayCookie: true,
    body: JSON.stringify({
      commandId: failFast.run.steps.first.commandId,
      state: "failed",
      error: { message: "hard failure" }
    })
  });
  assert.equal(failedFast.run.state, "failed");
  assert.equal(failedFast.run.steps.second.state, "cancelled");
  workflowStore = JSON.parse(await fs.readFile(relay.storePath, "utf8"));
  assert.equal(workflowStore.commands[failFast.run.steps.second.commandId].state, "cancelled");
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

test("self-hosted relay normalizes Telegram webhook updates into relay messages", async (t) => {
  const relay = await startRelay(t, {
    sessionId: "relay-telegram-webhook-e2e",
    extraYaml: `
routing:
  defaultTarget: codex-cli
transports:
  - name: telegram
    type: telegram
    enabled: true
    polling: false
    botToken: test-token
    chatId: 42
`
  });

  const postUpdate = (update) => fetchJson(`${relay.baseUrl}/api/telegram/events?transport=telegram`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    skipRelayCookie: true,
    body: JSON.stringify(update)
  });

  const first = await postUpdate({
    update_id: 7000,
    message: {
      date: Math.floor(Date.now() / 1000),
      chat: { id: 42 },
      text: "hello via telegram webhook"
    }
  });
  assert.equal(first.ok, true);
  assert.equal(first.message.transport, "telegram");

  const messages = await fetchJson(`${relay.baseUrl}/api/messages?sessionId=${relay.sessionId}&after=0&agentId=codex-cli`, {
    headers: { "x-legax-secret": relay.desktopSecret }
  });
  assert.equal(messages.messages.length, 1);
  assert.equal(messages.messages[0].text, "hello via telegram webhook");
  assert.equal(messages.messages[0].id, "telegram:7000");

  const duplicate = await postUpdate({
    update_id: 7000,
    message: {
      date: Math.floor(Date.now() / 1000),
      chat: { id: 42 },
      text: "duplicate should not enqueue"
    }
  });
  assert.equal(duplicate.duplicate, true);

  const rejected = await postUpdate({
    update_id: 7001,
    message: {
      date: Math.floor(Date.now() / 1000),
      chat: { id: 99 },
      text: "wrong chat should not enqueue"
    }
  });
  assert.equal(rejected.ignored, true);

  const afterIgnored = await fetchJson(`${relay.baseUrl}/api/messages?sessionId=${relay.sessionId}&after=0&agentId=codex-cli`, {
    headers: { "x-legax-secret": relay.desktopSecret }
  });
  assert.equal(afterIgnored.messages.length, 1);
});

test("self-hosted relay normalizes webhook actions into relay messages", async (t) => {
  const relay = await startRelay(t, {
    sessionId: "relay-webhook-inbox-e2e",
    extraYaml: `
transports:
  - name: inbound-webhook
    type: webhook
    secret: webhook-secret
    sessionId: relay-webhook-inbox-e2e
    defaultTarget: gemini-cli
    allowedTargets: claude-code,gemini-cli
`
  });

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/webhook/events?transport=inbound-webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      skipRelayCookie: true,
      body: JSON.stringify({ text: "unauthorized webhook" })
    }),
    { status: 401 }
  );

  const delivered = await fetchJson(`${relay.baseUrl}/api/webhook/events?transport=inbound-webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": "webhook-secret"
    },
    skipRelayCookie: true,
    body: JSON.stringify({
      type: "control",
      action: "select_session",
      targetAgentId: "claude-code",
      threadRef: "claude-session-1",
      admin: true,
      arbitraryNested: { unsafe: true },
      createdAt: "2000-01-01T00:00:00.000Z",
      metadata: {
        safeKey: "safe value",
        nested: { unsafe: true },
        "unsafe key": "dropped"
      },
      text: "/use claude-code claude-session-1"
    })
  });
  assert.equal(delivered.message.transport, "webhook");
  assert.equal(delivered.message.targetAgentId, "claude-code");
  assert.equal(delivered.message.action, "select_session");
  assert.equal(Object.hasOwn(delivered.message, "admin"), false);
  assert.equal(Object.hasOwn(delivered.message, "arbitraryNested"), false);
  assert.notEqual(delivered.message.createdAt, "2000-01-01T00:00:00.000Z");
  assert.deepEqual(delivered.message.metadata, { safeKey: "safe value" });

  await assert.rejects(
    fetchJson(`${relay.baseUrl}/api/webhook/events?transport=inbound-webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-legax-secret": "webhook-secret"
      },
      skipRelayCookie: true,
      body: JSON.stringify({
        type: "control",
        action: "select_session",
        targetAgentId: "codex-cli",
        threadRef: "codex-session-1",
        text: "/use codex-cli codex-session-1"
      })
    }),
    { status: 403 }
  );

  const desktopMessages = await fetchJson(`${relay.baseUrl}/api/messages?sessionId=${relay.sessionId}&after=0&agentId=claude-code`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  assert.equal(desktopMessages.messages.length, 1);
  assert.equal(desktopMessages.messages[0].threadRef, "claude-session-1");
});

test("self-hosted relay polls Telegram and acknowledges callbacks", async (t) => {
  const telegram = await startRelayFakeTelegram(t);
  const relay = await startRelay(t, {
    sessionId: "relay-telegram-poll-e2e",
    extraYaml: `
routing:
  defaultTarget: codex-cli
transports:
  - name: telegram
    type: telegram
    enabled: true
    botToken: test-token
    chatId: 42
    apiBaseUrl: ${telegram.apiBaseUrl}
    pollIntervalMs: 100
    timeoutMs: 1000
`
  });

  telegram.pushMessage("hello via relay poll");
  telegram.pushCallback("legax:approve:codex-approval-1", "callback-approval-1");

  await waitFor(async () => {
    const messages = await fetchJson(`${relay.baseUrl}/api/messages?sessionId=${relay.sessionId}&after=0&agentId=codex-cli`, {
      headers: { "x-legax-secret": relay.desktopSecret }
    });
    assert.equal(messages.messages.length, 2, relay.stderr());
    assert.deepEqual(messages.messages.map((message) => message.type).sort(), ["permission_decision", "text"]);
    assert.ok(messages.messages.some((message) => message.text === "hello via relay poll"));
    assert.ok(messages.messages.some((message) => message.requestId === "codex-approval-1" && message.decision === "approve"));
  }, { timeoutMs: 7000 });

  await waitFor(() => {
    assert.ok(telegram.answerCallbacks.some((body) => body.callback_query_id === "callback-approval-1"));
  }, { timeoutMs: 3000 });

  const store = JSON.parse(await fs.readFile(relay.storePath, "utf8"));
  assert.ok(store.transports["telegram:telegram"].offset >= 9002);
  assert.equal(store.transports["telegram:telegram"].seen["telegram:9000"], true);
  assert.equal(store.transports["telegram:telegram"].seen["telegram:9001"], true);
});

test("self-hosted relay fans desktop events out to Telegram", async (t) => {
  const telegram = await startRelayFakeTelegram(t);
  const relay = await startRelay(t, {
    sessionId: "relay-telegram-outbound-e2e",
    extraYaml: `
transports:
  - name: telegram
    type: telegram
    enabled: true
    polling: false
    botToken: test-token
    chatId: 42
    apiBaseUrl: ${telegram.apiBaseUrl}
    timeoutMs: 1000
`
  });

  await fetchJson(`${relay.baseUrl}/api/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: relay.sessionId,
      agentId: "codex-cli",
      agentLabel: "Codex CLI",
      kind: "status",
      text: "relay outbound status"
    })
  });

  await telegram.waitForSend((body) => /relay outbound status/.test(body.text ?? ""));
});

test("self-hosted relay records Telegram outbound delivery failures", async (t) => {
  const telegram = await startRelayFakeTelegram(t, {
    sendMessageStatus: 429,
    sendMessageBody: { ok: false, error_code: 429, description: "Too Many Requests: retry later" }
  });
  const relay = await startRelay(t, {
    sessionId: "relay-telegram-failure-e2e",
    extraYaml: `
transports:
  - name: telegram
    type: telegram
    enabled: true
    polling: false
    botToken: test-token
    chatId: 42
    apiBaseUrl: ${telegram.apiBaseUrl}
    timeoutMs: 1000
`
  });

  const result = await fetchJson(`${relay.baseUrl}/api/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: relay.sessionId,
      agentId: "codex-cli",
      agentLabel: "Codex CLI",
      kind: "status",
      text: "relay outbound should fail"
    })
  });

  assert.equal(result.outbound[0].ok, false);
  const store = JSON.parse(await fs.readFile(relay.storePath, "utf8"));
  assert.ok(store.events.some((event) => (
    event.kind === "transport.delivery.failed"
      && event.sessionId === relay.sessionId
      && event.transport === "telegram"
      && /Too Many Requests/.test(event.error)
  )));
});

test("self-hosted relay Telegram polling preserves concurrent relay store writes", async (t) => {
  const telegram = await startRelayFakeTelegram(t, { getUpdatesDelayMs: 350 });
  const relay = await startRelay(t, {
    sessionId: "relay-telegram-store-race-e2e",
    extraYaml: `
routing:
  defaultTarget: codex-cli
transports:
  - name: telegram
    type: telegram
    enabled: true
    botToken: test-token
    chatId: 42
    apiBaseUrl: ${telegram.apiBaseUrl}
    pollIntervalMs: 100
    timeoutMs: 1000
`
  });

  await waitFor(() => {
    assert.ok(telegram.getUpdatesCalls() > 0);
  }, { timeoutMs: 3000 });

  telegram.pushMessage("poll result after concurrent event");
  await fetchJson(`${relay.baseUrl}/api/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legax-secret": relay.desktopSecret
    },
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: relay.sessionId,
      agentId: "codex-cli",
      agentLabel: "Codex CLI",
      kind: "status",
      text: "event written while telegram poll is in flight"
    })
  });

  await waitFor(async () => {
    const messages = await fetchJson(`${relay.baseUrl}/api/messages?sessionId=${relay.sessionId}&after=0&agentId=codex-cli`, {
      headers: { "x-legax-secret": relay.desktopSecret }
    });
    assert.ok(messages.messages.some((message) => message.text === "poll result after concurrent event"));
  }, { timeoutMs: 7000 });

  const events = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
  assert.ok(
    events.events.some((event) => event.text === "event written while telegram poll is in flight"),
    JSON.stringify(events.events, null, 2)
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

  for (const invalid of ["../secrets", "/etc/passwd", "C:\\Users\\Admin", "\\\\server\\share", "safe/%2e%2e/secret"]) {
    await assert.rejects(
      fetchJson(`${relay.baseUrl}/api/twa/project-children`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        skipRelayCookie: true,
        body: JSON.stringify({
          token: launch.token,
          rootId: "root-1",
          relativePath: invalid
        })
      }),
      { status: 400 }
    );
  }

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

async function startRelayFakeTelegram(t, { getUpdatesDelayMs = 0, sendMessageStatus = 200, sendMessageBody = null } = {}) {
  const port = await getFreePort();
  const pendingUpdates = [];
  const answerCallbacks = [];
  const sendMessages = [];
  let nextUpdateId = 9000;
  let getUpdatesCalls = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? JSON.parse(raw) : {};
    const method = String(req.url || "").split("/").pop();
    if (method === "getUpdates") {
      getUpdatesCalls += 1;
      if (getUpdatesDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, getUpdatesDelayMs));
      const offset = Number(body.offset ?? 0);
      const ready = pendingUpdates.filter((update) => Number(update.update_id) >= offset);
      pendingUpdates.splice(0, pendingUpdates.length);
      sendJsonResponse(res, { ok: true, result: ready });
      return;
    }
    if (method === "answerCallbackQuery") {
      answerCallbacks.push(body);
      sendJsonResponse(res, { ok: true, result: true });
      return;
    }
    if (method === "sendMessage") {
      sendMessages.push(body);
      sendJsonResponse(res, sendMessageBody ?? { ok: true, result: { message_id: 1 } }, sendMessageStatus);
      return;
    }
    sendJsonResponse(res, { ok: false, description: `unexpected method ${method}` }, 404);
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  t.after(() => closeHttpServer(server));

  function pushMessage(text) {
    pendingUpdates.push({
      update_id: nextUpdateId++,
      message: {
        date: Math.floor(Date.now() / 1000),
        chat: { id: 42 },
        text
      }
    });
  }

  function pushCallback(data, callbackId) {
    pendingUpdates.push({
      update_id: nextUpdateId++,
      callback_query: {
        id: callbackId,
        data,
        from: { id: 42 },
        message: { chat: { id: 42 } }
      }
    });
  }

  async function waitForSend(predicate, { timeoutMs = 5000 } = {}) {
    return await waitFor(async () => {
      const found = sendMessages.find(predicate);
      assert.ok(found, sendMessages.map((body) => body.text).join("\n---\n"));
      return found;
    }, { timeoutMs, intervalMs: 100 });
  }

  return {
    apiBaseUrl: `http://127.0.0.1:${port}/bot`,
    answerCallbacks,
    getUpdatesCalls: () => getUpdatesCalls,
    pushMessage,
    pushCallback,
    sendMessages,
    waitForSend
  };
}

function sendJsonResponse(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
