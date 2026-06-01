import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const CHECKPOINT_BUNDLE_SCHEMA = "legax.checkpoint/1";
const LEGACY_CHECKPOINT_BUNDLE_SCHEMAS = new Set(["legax.artifact/1"]);
export const CHECKPOINT_ARTIFACT_TYPE = "checkpoint.bundle";

const TEXT_SAMPLE_BYTES = 8192;
const DEFAULT_MAX_TEXT_BYTES = 256 * 1024;
const DENIED_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519"
]);
const DENIED_EXTENSIONS = new Set([
  ".key",
  ".pem",
  ".p12",
  ".pfx",
  ".sqlite",
  ".sqlite3",
  ".db"
]);

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function fromBase64url(value, label = "base64url") {
  try {
    return Buffer.from(String(value ?? ""), "base64url");
  } catch {
    throw new Error(`invalid ${label}`);
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(buffer) {
  return base64url(crypto.createHash("sha256").update(buffer).digest());
}

function runGit(args, cwd, { allowFailure = true } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return result.status === 0 ? result.stdout : "";
}

function pathInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeBundlePath(relativePath) {
  const text = String(relativePath ?? "").replaceAll("\\", "/").trim();
  if (!text || text.includes("\0")) throw new Error("unsafe path");
  if (path.isAbsolute(text) || /^[A-Za-z]:\//.test(text)) throw new Error("absolute paths are not allowed");
  const normalized = path.posix.normalize(text);
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    throw new Error("path traversal is not allowed");
  }
  return normalized;
}

function exclusionReason(relativePath, stat, buffer, { allowBinary = false, maxTextBytes = DEFAULT_MAX_TEXT_BYTES } = {}) {
  const normalized = normalizeBundlePath(relativePath);
  const basename = path.posix.basename(normalized).toLowerCase();
  const extension = path.posix.extname(normalized).toLowerCase();
  if (DENIED_BASENAMES.has(basename) || DENIED_EXTENSIONS.has(extension)) return "denied";
  if (stat.size > maxTextBytes) return "oversized";
  if (!allowBinary && looksBinary(buffer)) return "binary";
  return "";
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, TEXT_SAMPLE_BYTES));
  if (sample.includes(0)) return true;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte < 32 || byte === 127) suspicious += 1;
  }
  return sample.length > 0 && suspicious / sample.length > 0.15;
}

function readIncludedFile(rootDir, relativePath, options) {
  const normalized = normalizeBundlePath(relativePath);
  const absolutePath = path.resolve(rootDir, normalized);
  if (!pathInside(rootDir, absolutePath)) throw new Error("path traversal is not allowed");
  const lstat = fs.lstatSync(absolutePath);
  if (lstat.isSymbolicLink()) return { excluded: { path: normalized, reason: "symlink" } };
  if (!lstat.isFile()) return { excluded: { path: normalized, reason: "not-file" } };
  const realPath = fs.realpathSync(absolutePath);
  if (!pathInside(rootDir, realPath)) return { excluded: { path: normalized, reason: "symlink-escape" } };
  const buffer = fs.readFileSync(realPath);
  const reason = exclusionReason(normalized, lstat, buffer, options);
  if (reason) return { excluded: { path: normalized, reason } };
  return {
    file: {
      path: normalized,
      encoding: "base64",
      content: base64url(buffer),
      size: buffer.length,
      sha256: sha256(buffer),
      mode: lstat.mode & 0o777
    }
  };
}

export function createCheckpointBundle({
  rootDir = process.cwd(),
  sessionId = "",
  generationId = "",
  include = [],
  workflowState = {},
  testState = {},
  environment = {},
  nativeSession = {},
  allowBinary = false,
  maxTextBytes = DEFAULT_MAX_TEXT_BYTES
} = {}) {
  const root = fs.realpathSync(path.resolve(rootDir));
  const files = [];
  const excluded = [];
  for (const entry of include) {
    try {
      const result = readIncludedFile(root, entry, { allowBinary, maxTextBytes });
      if (result.file) files.push(result.file);
      else if (result.excluded) excluded.push(result.excluded);
    } catch (error) {
      excluded.push({ path: String(entry ?? ""), reason: error.message });
    }
  }
  const bundle = {
    schema: CHECKPOINT_BUNDLE_SCHEMA,
    sessionId: String(sessionId),
    generationId: String(generationId),
    createdAt: new Date().toISOString(),
    git: {
      remote: runGit(["remote", "get-url", "origin"], root),
      branch: runGit(["branch", "--show-current"], root),
      head: runGit(["rev-parse", "HEAD"], root).trim(),
      status: runGit(["status", "--porcelain=v1"], root),
      dirtyDiff: runGit(["diff", "--binary"], root),
      stagedDiff: runGit(["diff", "--cached", "--binary"], root),
      submodules: runGit(["submodule", "status", "--recursive"], root)
    },
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    workflowState,
    testState,
    environment,
    nativeSession,
    report: {
      rootLabel: path.basename(root),
      included: files.map((file) => ({ path: file.path, size: file.size, sha256: file.sha256 })),
      excluded
    }
  };
  bundle.bundleSha256 = sha256(Buffer.from(stableJson({
    ...bundle,
    bundleSha256: undefined
  })));
  return bundle;
}

function aesGcmEncrypt(plaintext, key, aad = Buffer.alloc(0)) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, ciphertext, tag };
}

function aesGcmDecrypt(envelope, key, aad = Buffer.alloc(0)) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, fromBase64url(envelope.iv, "iv"));
  decipher.setAAD(aad);
  decipher.setAuthTag(fromBase64url(envelope.tag, "tag"));
  return Buffer.concat([
    decipher.update(fromBase64url(envelope.ciphertext, "ciphertext")),
    decipher.final()
  ]);
}

export function generateCheckpointDeviceKeyPair({ kid = `device_${crypto.randomBytes(8).toString("base64url")}` } = {}) {
  const pair = crypto.generateKeyPairSync("x25519");
  return {
    publicKey: {
      ...pair.publicKey.export({ format: "jwk" }),
      kid
    },
    privateKey: {
      ...pair.privateKey.export({ format: "jwk" }),
      kid
    }
  };
}

function importPublicKey(jwk) {
  return crypto.createPublicKey({ key: { ...jwk, key_ops: undefined }, format: "jwk" });
}

function importPrivateKey(jwk) {
  return crypto.createPrivateKey({ key: { ...jwk, key_ops: undefined }, format: "jwk" });
}

function deriveWrapKey(sharedSecret, { artifactId, recipientKid }) {
  return Buffer.from(crypto.hkdfSync(
    "sha256",
    sharedSecret,
    Buffer.from(String(artifactId)),
    Buffer.from(`legax.checkpoint.wrap.${recipientKid}`),
    32
  ));
}

function wrapDataKey(dataKey, recipientPublicKey, artifactId) {
  const recipientKid = String(recipientPublicKey.kid ?? "");
  if (!recipientKid) throw new Error("recipient public key must include kid");
  const ephemeral = crypto.generateKeyPairSync("x25519");
  const sharedSecret = crypto.diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: importPublicKey(recipientPublicKey)
  });
  const wrapKey = deriveWrapKey(sharedSecret, { artifactId, recipientKid });
  const aad = Buffer.from(stableJson({ artifactId, recipientKid, algorithm: "X25519-HKDF-SHA256+A256GCM" }));
  const encrypted = aesGcmEncrypt(dataKey, wrapKey, aad);
  return {
    recipientKid,
    algorithm: "X25519-HKDF-SHA256+A256GCM",
    ephemeralPublicKey: {
      ...ephemeral.publicKey.export({ format: "jwk" }),
      kid: `ephemeral-${recipientKid}`
    },
    iv: base64url(encrypted.iv),
    tag: base64url(encrypted.tag),
    ciphertext: base64url(encrypted.ciphertext)
  };
}

function unwrapDataKey(wrappedKey, recipientPrivateKey, artifactId) {
  const recipientKid = String(wrappedKey.recipientKid ?? "");
  const sharedSecret = crypto.diffieHellman({
    privateKey: importPrivateKey(recipientPrivateKey),
    publicKey: importPublicKey(wrappedKey.ephemeralPublicKey)
  });
  const wrapKey = deriveWrapKey(sharedSecret, { artifactId, recipientKid });
  const aad = Buffer.from(stableJson({ artifactId, recipientKid, algorithm: "X25519-HKDF-SHA256+A256GCM" }));
  return aesGcmDecrypt(wrappedKey, wrapKey, aad);
}

export function encryptCheckpointBundle(bundle, { artifactId = `artifact_${crypto.randomBytes(10).toString("base64url")}`, recipients = [] } = {}) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error("at least one recipient public key is required");
  }
  const dataKey = crypto.randomBytes(32);
  const metadata = {
    schema: CHECKPOINT_BUNDLE_SCHEMA,
    type: CHECKPOINT_ARTIFACT_TYPE,
    sessionId: String(bundle.sessionId ?? ""),
    generationId: String(bundle.generationId ?? ""),
    fileCount: Array.isArray(bundle.files) ? bundle.files.length : 0,
    bundleSha256: bundle.bundleSha256 ?? sha256(Buffer.from(stableJson(bundle)))
  };
  const aad = Buffer.from(stableJson(metadata));
  const payload = Buffer.from(JSON.stringify(bundle), "utf8");
  const encrypted = aesGcmEncrypt(payload, dataKey, aad);
  return {
    id: artifactId,
    type: CHECKPOINT_ARTIFACT_TYPE,
    metadata,
    encryption: {
      algorithm: "AES-256-GCM",
      keyWrap: "X25519-HKDF-SHA256+A256GCM"
    },
    ciphertext: {
      algorithm: "AES-256-GCM",
      iv: base64url(encrypted.iv),
      tag: base64url(encrypted.tag),
      ciphertext: base64url(encrypted.ciphertext),
      size: encrypted.ciphertext.length,
      sha256: sha256(encrypted.ciphertext)
    },
    wrappedKeys: recipients.map((recipient) => wrapDataKey(dataKey, recipient, artifactId)),
    createdAt: new Date().toISOString()
  };
}

export function decryptCheckpointArtifact(artifact, { privateKey, expectedMetadata = {} } = {}) {
  if (!artifact || artifact.type !== CHECKPOINT_ARTIFACT_TYPE) throw new Error("unsupported artifact type");
  if (!privateKey) throw new Error("privateKey is required");
  for (const [key, expected] of Object.entries(expectedMetadata)) {
    const actual = key === "type" ? artifact.type : artifact.metadata?.[key];
    if (actual !== expected) throw new Error(`artifact metadata mismatch for ${key}`);
  }
  const candidateKeys = Array.isArray(artifact.wrappedKeys) ? artifact.wrappedKeys : [];
  let dataKey = null;
  let lastError = null;
  for (const wrappedKey of candidateKeys) {
    if (privateKey.kid && wrappedKey.recipientKid !== privateKey.kid) continue;
    try {
      dataKey = unwrapDataKey(wrappedKey, privateKey, artifact.id);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!dataKey) throw new Error(`unable to decrypt wrapped key${lastError ? `: ${lastError.message}` : ""}`);
  try {
    const aad = Buffer.from(stableJson(artifact.metadata));
    const plaintext = aesGcmDecrypt(artifact.ciphertext, dataKey, aad);
    return JSON.parse(plaintext.toString("utf8"));
  } catch (error) {
    throw new Error(`checkpoint decrypt/authenticate failed: ${error.message}`);
  }
}

function ensureRestoreTarget(targetDir) {
  const target = path.resolve(targetDir);
  fs.mkdirSync(target, { recursive: true });
  return fs.realpathSync(target);
}

function restorePath(targetRoot, relativePath) {
  const normalized = normalizeBundlePath(relativePath);
  const absolutePath = path.resolve(targetRoot, normalized);
  if (!pathInside(targetRoot, absolutePath)) throw new Error("path traversal is not allowed");
  let cursor = targetRoot;
  for (const segment of normalized.split("/").slice(0, -1)) {
    cursor = path.join(cursor, segment);
    if (fs.existsSync(cursor)) {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error(`refusing symlink escape at ${segment}`);
      if (!stat.isDirectory()) throw new Error(`restore parent is not a directory: ${segment}`);
      const realCursor = fs.realpathSync(cursor);
      if (!pathInside(targetRoot, realCursor)) throw new Error(`refusing symlink escape at ${segment}`);
    }
  }
  if (fs.existsSync(absolutePath)) {
    const finalStat = fs.lstatSync(absolutePath);
    if (finalStat.isSymbolicLink()) throw new Error(`refusing final file symlink: ${normalized}`);
  }
  return { normalized, absolutePath };
}

function ensureRestoreParent(targetRoot, absolutePath) {
  const parent = path.dirname(absolutePath);
  fs.mkdirSync(parent, { recursive: true });
  const realParent = fs.realpathSync(parent);
  if (!pathInside(targetRoot, realParent)) throw new Error("refusing symlink escape in restore parent");
}

function writeNewRestoreFile(absolutePath, content, mode) {
  const fd = fs.openSync(absolutePath, "wx", mode);
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}

function writeRestoreFileAtomically(absolutePath, content, mode) {
  const parent = path.dirname(absolutePath);
  const tempPath = path.join(parent, `.${path.basename(absolutePath)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
  let completed = false;
  try {
    writeNewRestoreFile(tempPath, content, mode);
    fs.renameSync(tempPath, absolutePath);
    completed = true;
  } finally {
    if (!completed) {
      try { fs.rmSync(tempPath, { force: true }); } catch {}
    }
  }
}

function readExistingRestoreFile(absolutePath, normalized) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let fd;
  try {
    fd = fs.openSync(absolutePath, flags);
  } catch (error) {
    if (error.code === "ELOOP") throw new Error(`refusing final file symlink: ${normalized}`);
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (stat.isDirectory()) throw new Error(`restore target is a directory: ${normalized}`);
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function isSupportedCheckpointBundleSchema(schema) {
  return schema === CHECKPOINT_BUNDLE_SCHEMA || LEGACY_CHECKPOINT_BUNDLE_SCHEMAS.has(schema);
}

export function restoreCheckpointBundle(bundle, { targetDir, allowOverwrite = false } = {}) {
  if (!targetDir) throw new Error("targetDir is required");
  if (!isSupportedCheckpointBundleSchema(bundle?.schema)) throw new Error("unsupported checkpoint bundle schema");
  const targetRoot = ensureRestoreTarget(targetDir);
  const written = [];
  const conflicts = [];
  const skipped = [];
  for (const file of bundle.files ?? []) {
    const { normalized, absolutePath } = restorePath(targetRoot, file.path);
    const content = fromBase64url(file.content, `file ${normalized}`);
    if (file.sha256 && sha256(content) !== file.sha256) {
      throw new Error(`checksum mismatch for ${normalized}`);
    }
    ensureRestoreParent(targetRoot, absolutePath);
    try {
      writeNewRestoreFile(absolutePath, content, file.mode ?? 0o600);
      written.push({ path: normalized, size: content.length, sha256: sha256(content) });
      continue;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (file.sha256) {
      const existing = readExistingRestoreFile(absolutePath, normalized);
      if (sha256(existing) === file.sha256) {
        skipped.push({ path: normalized, reason: "unchanged" });
        continue;
      }
      if (!allowOverwrite) {
        conflicts.push({ path: normalized, reason: "local changes" });
        continue;
      }
    } else if (!allowOverwrite) {
      conflicts.push({ path: normalized, reason: "local changes" });
      continue;
    }
    writeRestoreFileAtomically(absolutePath, content, file.mode ?? 0o600);
    written.push({ path: normalized, size: content.length, sha256: sha256(content) });
  }
  if (conflicts.length > 0) {
    const error = new Error(`restore conflict: ${conflicts.map((item) => item.path).join(", ")}`);
    error.conflicts = conflicts;
    throw error;
  }
  return {
    ok: true,
    targetDir: targetRoot,
    written,
    skipped
  };
}
