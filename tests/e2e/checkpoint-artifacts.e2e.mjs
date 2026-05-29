import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  createCheckpointBundle,
  decryptCheckpointArtifact,
  encryptCheckpointBundle,
  generateCheckpointDeviceKeyPair,
  restoreCheckpointBundle
} from "../../scripts/lib/checkpoint-artifacts.mjs";
import { dataDir, fetchJson, startRelay } from "./helpers.mjs";

function runGit(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function sha256Base64(text) {
  return crypto.createHash("sha256").update(text).digest("base64");
}

function sha256Base64url(text) {
  return crypto.createHash("sha256").update(text).digest("base64url");
}

async function tempDir(prefix) {
  await fs.mkdir(dataDir, { recursive: true });
  return fs.mkdtemp(path.join(dataDir, `${prefix}-${process.pid}-`));
}

test("checkpoint artifacts encrypt safe bundles and restore without plaintext relay exposure", async (t) => {
  const root = await tempDir("checkpoint-src");
  const restoreRoot = await tempDir("checkpoint-restore");
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(restoreRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "app.txt"), "hello\n", "utf8");
  await fs.writeFile(path.join(root, ".env"), "SECRET=plaintext-secret\n", "utf8");
  await fs.writeFile(path.join(root, "secret.pem"), "-----BEGIN PRIVATE KEY-----\nplaintext-secret\n", "utf8");
  await fs.writeFile(path.join(root, "data.sqlite"), "sqlite-plaintext-secret\n", "utf8");
  await fs.writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]));

  runGit(root, ["init"]);
  runGit(root, ["add", "src/app.txt"]);
  runGit(root, ["-c", "user.name=Legax E2E", "-c", "user.email=legax@example.test", "commit", "-m", "init"]);
  await fs.writeFile(path.join(root, "src", "app.txt"), "hello changed\n", "utf8");
  await fs.writeFile(path.join(root, "src", "new.txt"), "new file\n", "utf8");

  const bundle = createCheckpointBundle({
    rootDir: root,
    sessionId: "session-checkpoint",
    generationId: "gen-checkpoint",
    include: ["src/app.txt", "src/new.txt", ".env", "secret.pem", "data.sqlite", "binary.bin"],
    workflowState: { runId: "wf-1", stepId: "tdd.red" },
    testState: { command: "npm test", exitCode: 0 },
    environment: { restore: "run npm install before checks; no secrets included" },
    nativeSession: { provider: "gemini", id: "native-session-id" }
  });

  assert.deepEqual(bundle.files.map((file) => file.path).sort(), ["src/app.txt", "src/new.txt"]);
  assert.match(bundle.git.dirtyDiff, /hello changed/);
  assert.doesNotMatch(JSON.stringify(bundle), /plaintext-secret|PRIVATE KEY|sqlite-plaintext-secret/);
  assert.ok(bundle.report.excluded.some((entry) => entry.path === ".env" && entry.reason === "denied"));
  assert.ok(bundle.report.excluded.some((entry) => entry.path === "binary.bin" && entry.reason === "binary"));

  const recipient = generateCheckpointDeviceKeyPair({ kid: "device-a" });
  const wrongRecipient = generateCheckpointDeviceKeyPair({ kid: "device-b" });
  const artifact = encryptCheckpointBundle(bundle, {
    artifactId: "artifact-checkpoint-1",
    recipients: [recipient.publicKey]
  });

  assert.doesNotMatch(JSON.stringify(artifact), /hello changed|new file|plaintext-secret|native-session-id/);
  const restoredBundle = decryptCheckpointArtifact(artifact, {
    privateKey: recipient.privateKey,
    expectedMetadata: {
      sessionId: "session-checkpoint",
      generationId: "gen-checkpoint",
      type: "checkpoint.bundle"
    }
  });
  assert.deepEqual(restoredBundle.files.map((file) => file.path).sort(), ["src/app.txt", "src/new.txt"]);

  const tamperedCiphertext = structuredClone(artifact);
  tamperedCiphertext.ciphertext.ciphertext = `${tamperedCiphertext.ciphertext.ciphertext.startsWith("A") ? "B" : "A"}${tamperedCiphertext.ciphertext.ciphertext.slice(1)}`;
  assert.throws(() => decryptCheckpointArtifact(tamperedCiphertext, { privateKey: recipient.privateKey }), /decrypt|authenticate|Unsupported state/i);

  const tamperedMetadata = structuredClone(artifact);
  tamperedMetadata.metadata.generationId = "wrong-generation";
  assert.throws(() => decryptCheckpointArtifact(tamperedMetadata, { privateKey: recipient.privateKey }), /decrypt|authenticate|metadata/i);
  assert.throws(() => decryptCheckpointArtifact(artifact, { privateKey: wrongRecipient.privateKey }), /wrapped key|decrypt|authenticate/i);

  const restoreReport = restoreCheckpointBundle(restoredBundle, { targetDir: restoreRoot });
  assert.deepEqual(restoreReport.written.map((entry) => entry.path).sort(), ["src/app.txt", "src/new.txt"]);
  assert.equal(await fs.readFile(path.join(restoreRoot, "src", "app.txt"), "utf8"), "hello changed\n");

  await fs.writeFile(path.join(restoreRoot, "src", "app.txt"), "local user work\n", "utf8");
  assert.throws(() => restoreCheckpointBundle(restoredBundle, { targetDir: restoreRoot }), /conflict/i);
});

test("checkpoint restore skips unchanged files before overwriting existing paths", async (t) => {
  const restoreRoot = await tempDir("checkpoint-restore-skip");
  t.after(async () => {
    await fs.rm(restoreRoot, { recursive: true, force: true });
  });

  const bundle = {
    schema: "legax.checkpoint/1",
    sessionId: "session-checkpoint",
    generationId: "gen-checkpoint",
    files: [{
      path: "src/app.txt",
      encoding: "base64",
      content: Buffer.from("restored\n").toString("base64url"),
      size: 9,
      sha256: sha256Base64url("restored\n")
    }]
  };

  const first = restoreCheckpointBundle(bundle, { targetDir: restoreRoot });
  assert.deepEqual(first.written.map((entry) => entry.path), ["src/app.txt"]);

  const second = restoreCheckpointBundle(bundle, { targetDir: restoreRoot });
  assert.deepEqual(second.written, []);
  assert.deepEqual(second.skipped, [{ path: "src/app.txt", reason: "unchanged" }]);

  await fs.writeFile(path.join(restoreRoot, "src", "app.txt"), "local user work\n", "utf8");
  assert.throws(() => restoreCheckpointBundle(bundle, { targetDir: restoreRoot }), /conflict/i);
  assert.equal(await fs.readFile(path.join(restoreRoot, "src", "app.txt"), "utf8"), "local user work\n");

  const overwritten = restoreCheckpointBundle(bundle, { targetDir: restoreRoot, allowOverwrite: true });
  assert.deepEqual(overwritten.written.map((entry) => entry.path), ["src/app.txt"]);
  assert.equal(await fs.readFile(path.join(restoreRoot, "src", "app.txt"), "utf8"), "restored\n");
});

test("checkpoint restore rejects traversal and symlink escape attempts", async (t) => {
  const target = await tempDir("checkpoint-target");
  const outside = await tempDir("checkpoint-outside");
  t.after(async () => {
    await fs.rm(target, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  const maliciousTraversal = {
    schema: "legax.checkpoint/1",
    sessionId: "session-checkpoint",
    generationId: "gen-checkpoint",
    files: [{
      path: "../escape.txt",
      encoding: "base64",
      content: Buffer.from("escape\n").toString("base64"),
      size: 7,
      sha256: sha256Base64("escape\n")
    }]
  };
  assert.throws(() => restoreCheckpointBundle(maliciousTraversal, { targetDir: target }), /path traversal|unsafe path/i);

  await fs.mkdir(path.join(target, "safe"), { recursive: true });
  await fs.rm(path.join(target, "safe"), { recursive: true, force: true });
  try {
    await fs.symlink(outside, path.join(target, "safe"), "junction");
  } catch (error) {
    assert.match(error.message, /privilege|operation|not permitted|EPERM|EACCES/i);
    return;
  }

  const maliciousSymlink = {
    schema: "legax.checkpoint/1",
    sessionId: "session-checkpoint",
    generationId: "gen-checkpoint",
    files: [{
      path: "safe/escape.txt",
      encoding: "base64",
      content: Buffer.from("escape\n").toString("base64"),
      size: 7,
      sha256: sha256Base64("escape\n")
    }]
  };
  assert.throws(() => restoreCheckpointBundle(maliciousSymlink, { targetDir: target }), /symlink/i);

  const finalLinkTarget = path.join(outside, "final-link-target.txt");
  await fs.writeFile(finalLinkTarget, "outside\n", "utf8");
  await fs.mkdir(path.join(target, "final"), { recursive: true });
  try {
    await fs.symlink(finalLinkTarget, path.join(target, "final", "escape.txt"));
  } catch (error) {
    assert.match(error.message, /privilege|operation|not permitted|EPERM|EACCES/i);
    return;
  }
  const maliciousFinalSymlink = {
    schema: "legax.checkpoint/1",
    sessionId: "session-checkpoint",
    generationId: "gen-checkpoint",
    files: [{
      path: "final/escape.txt",
      encoding: "base64",
      content: Buffer.from("escape\n").toString("base64"),
      size: 7,
      sha256: sha256Base64("escape\n")
    }]
  };
  assert.throws(() => restoreCheckpointBundle(maliciousFinalSymlink, { targetDir: target }), /symlink/i);
  assert.equal(await fs.readFile(finalLinkTarget, "utf8"), "outside\n");
});

test("checkpoint handoff uploads encrypted artifact and restores on target host", async (t) => {
  const relay = await startRelay(t, { sessionId: "checkpoint-handoff-e2e" });
  const sourceRoot = await tempDir("checkpoint-handoff-source");
  const targetRoot = await tempDir("checkpoint-handoff-target");
  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
    await fs.rm(targetRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(sourceRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, "src", "handoff.txt"), "before\n", "utf8");
  runGit(sourceRoot, ["init"]);
  runGit(sourceRoot, ["add", "src/handoff.txt"]);
  runGit(sourceRoot, ["-c", "user.name=Legax E2E", "-c", "user.email=legax@example.test", "commit", "-m", "init"]);
  await fs.writeFile(path.join(sourceRoot, "src", "handoff.txt"), "after handoff\n", "utf8");

  const headers = {
    "content-type": "application/json",
    "x-legax-secret": relay.desktopSecret
  };
  await fetchJson(`${relay.baseUrl}/api/sessions`, {
    method: "POST",
    headers,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: relay.sessionId,
      title: "Checkpoint handoff",
      selectedAgentId: "gemini-cli"
    })
  });
  const generationResponse = await fetchJson(`${relay.baseUrl}/api/generations`, {
    method: "POST",
    headers,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: relay.sessionId,
      hostId: "source-host",
      adapterId: "gemini-cli",
      worktree: { path: sourceRoot },
      nativeSession: { provider: "gemini", id: "source-native-session" }
    })
  });
  const leaseResponse = await fetchJson(`${relay.baseUrl}/api/leases/claim`, {
    method: "POST",
    headers,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: relay.sessionId,
      generationId: generationResponse.generation.id,
      hostId: "source-host",
      ttlMs: 30000
    })
  });

  const recipient = generateCheckpointDeviceKeyPair({ kid: "target-host-key" });
  const bundle = createCheckpointBundle({
    rootDir: sourceRoot,
    sessionId: relay.sessionId,
    generationId: generationResponse.generation.id,
    include: ["src/handoff.txt"],
    workflowState: { runId: "wf-handoff", stepId: "handoff" },
    testState: { command: "npm test", exitCode: 0 },
    environment: { restore: "restore into managed target worktree" }
  });
  const encrypted = encryptCheckpointBundle(bundle, {
    artifactId: "checkpoint-handoff-artifact",
    recipients: [recipient.publicKey]
  });

  await fetchJson(`${relay.baseUrl}/api/artifacts`, {
    method: "POST",
    headers,
    skipRelayCookie: true,
    body: JSON.stringify({
      artifactId: encrypted.id,
      sessionId: relay.sessionId,
      generationId: generationResponse.generation.id,
      type: encrypted.type,
      leaseHostId: "source-host",
      fencingToken: leaseResponse.lease.fencingToken,
      leaseToken: leaseResponse.lease.token,
      metadata: encrypted.metadata,
      encryption: encrypted.encryption,
      ciphertext: encrypted.ciphertext,
      wrappedKeys: encrypted.wrappedKeys
    })
  });

  const handoff = await fetchJson(`${relay.baseUrl}/api/handoffs`, {
    method: "POST",
    headers,
    skipRelayCookie: true,
    body: JSON.stringify({
      sessionId: relay.sessionId,
      generationId: generationResponse.generation.id,
      fromHostId: "source-host",
      toHostId: "target-host"
    })
  });
  for (const state of ["checkpointed", "uploaded", "released", "claimed"]) {
    await fetchJson(`${relay.baseUrl}/api/handoffs/${handoff.handoff.id}/transition`, {
      method: "POST",
      headers,
      skipRelayCookie: true,
      body: JSON.stringify({
        state,
        ...(state === "checkpointed" ? { artifactId: encrypted.id } : {})
      })
    });
  }

  const fetched = await fetchJson(`${relay.baseUrl}/api/artifacts/${encrypted.id}`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  const restored = decryptCheckpointArtifact(fetched.artifact, {
    privateKey: recipient.privateKey,
    expectedMetadata: {
      sessionId: relay.sessionId,
      generationId: generationResponse.generation.id,
      type: "checkpoint.bundle"
    }
  });
  const restoreReport = restoreCheckpointBundle(restored, { targetDir: targetRoot });
  assert.deepEqual(restoreReport.written.map((entry) => entry.path), ["src/handoff.txt"]);
  assert.equal(await fs.readFile(path.join(targetRoot, "src", "handoff.txt"), "utf8"), "after handoff\n");

  for (const state of ["restored", "resumed"]) {
    await fetchJson(`${relay.baseUrl}/api/handoffs/${handoff.handoff.id}/transition`, {
      method: "POST",
      headers,
      skipRelayCookie: true,
      body: JSON.stringify({ state })
    });
  }
  const readHandoff = await fetchJson(`${relay.baseUrl}/api/handoffs/${handoff.handoff.id}`, {
    headers: { "x-legax-secret": relay.desktopSecret },
    skipRelayCookie: true
  });
  assert.equal(readHandoff.handoff.state, "resumed");
  assert.equal(readHandoff.handoff.checkpointArtifactId, encrypted.id);
});
