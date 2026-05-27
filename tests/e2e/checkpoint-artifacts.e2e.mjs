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
import { dataDir } from "./helpers.mjs";

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
  tamperedCiphertext.ciphertext.ciphertext = `${tamperedCiphertext.ciphertext.ciphertext.slice(0, -1)}${tamperedCiphertext.ciphertext.ciphertext.endsWith("A") ? "B" : "A"}`;
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
