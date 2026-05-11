#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readYaml } from "./lib/yaml.mjs";
import { packageAssetPath, resolveConfigPath, resolveRuntimeFile } from "./lib/paths.mjs";

function optionValue(args, name, fallback = "") {
  const prefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index]);
    if (arg === name) return args[index + 1] ?? fallback;
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return fallback;
}

const CONFIG_PATH = resolveConfigPath(optionValue(process.argv.slice(2), "--config"));
const CONFIG_SOURCE_PATH = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : packageAssetPath("config.example.yaml");
const RAW_CONFIG = readYaml(CONFIG_SOURCE_PATH) ?? {};
const RELAY_CFG = RAW_CONFIG.relay ?? {};
const AUDIT_CFG = RELAY_CFG.audit ?? {};

const PORT = Number(RELAY_CFG.port ?? 8787);
const RAW_HOST = String(RELAY_CFG.host ?? "0.0.0.0");
const STORE_PATH = RELAY_CFG.storePath
  ? resolveRuntimeFile(RELAY_CFG.storePath, CONFIG_PATH, "relay-store.json")
  : resolveRuntimeFile("", CONFIG_PATH, "relay-store.json");
const DESKTOP_SECRET = String(RELAY_CFG.secret ?? "");
const ALLOW_INSECURE_DEV = RELAY_CFG.allowInsecureDev === true;
const DEFAULT_SESSION = String(RAW_CONFIG.sessionId ?? "default");
const BROADCAST_TARGETS = new Set(["*", "all", "broadcast"]);
const MAX_REQUEST_BODY_BYTES = Number(RELAY_CFG.maxRequestBodyBytes ?? 1_048_576);
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const PAIRING_CODE_PATTERN = /^\d{6,8}$/;
const DEVICE_COOKIE = "legax_device";
const DEVICE_TOKEN_BYTES = 32;
const DEVICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
const AUDIT_DISABLED = AUDIT_CFG.enabled === false;
const AUDIT_LOG_PATH = AUDIT_CFG.path
  ? resolveRuntimeFile(AUDIT_CFG.path, CONFIG_PATH, "relay-audit.jsonl")
  : resolveRuntimeFile("", CONFIG_PATH, "relay-audit.jsonl");
const AUDIT_MAX_TAIL = Math.max(1, Number(AUDIT_CFG.maxTail ?? 1000));
const AUDIT_TEXT_PREVIEW = Math.max(0, Number(AUDIT_CFG.textPreview ?? 80));
// When allowInsecureDev: true with no secret, force loopback so the relay is
// not reachable from the LAN. Operators who deliberately want unauthenticated
// LAN access must set relay.secret and relay.host themselves.
const HOST = (ALLOW_INSECURE_DEV && !DESKTOP_SECRET) ? "127.0.0.1" : RAW_HOST;
if (ALLOW_INSECURE_DEV && !DESKTOP_SECRET) {
  console.error("[relay] WARNING: relay.allowInsecureDev: true with empty relay.secret. Binding to 127.0.0.1 only. Do NOT use on a shared machine.");
}

if (!DESKTOP_SECRET && !ALLOW_INSECURE_DEV) {
  console.error(`[relay] Refusing to start: relay.secret is empty in ${CONFIG_PATH}. Set relay.secret to a long random value (or relay.allowInsecureDev: true for throwaway local testing).`);
  process.exit(1);
}
console.error(`[relay] config: ${CONFIG_PATH}`);

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) {
    const store = { version: 1, sessions: {} };
    ensureStoreShape(store);
    return store;
  }
  const store = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  ensureStoreShape(store);
  return store;
}

function saveStore(store) {
  ensureStoreShape(store);
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  const tmpPath = `${STORE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, STORE_PATH);
}

function ensureStoreShape(store) {
  if (!store || typeof store !== "object") return;
  if (!store.sessions || typeof store.sessions !== "object") store.sessions = {};
  if (!store.pairingCodes || typeof store.pairingCodes !== "object") store.pairingCodes = {};
  if (!store.devices || typeof store.devices !== "object") store.devices = {};
  if (!store.attentionAcks || typeof store.attentionAcks !== "object") store.attentionAcks = {};
  if (!store.twaLaunchTokens || typeof store.twaLaunchTokens !== "object") store.twaLaunchTokens = {};
}

// Keep this zero-dependency QR encoder in sync with self-hosted-relay/server.mjs.
const QR_VERSION_TABLE = [
  null,
  { size: 21, dataCodewords: 19, eccCodewords: 7, blocks: 1, alignment: [] },
  { size: 25, dataCodewords: 34, eccCodewords: 10, blocks: 1, alignment: [6, 18] },
  { size: 29, dataCodewords: 55, eccCodewords: 15, blocks: 1, alignment: [6, 22] },
  { size: 33, dataCodewords: 80, eccCodewords: 20, blocks: 1, alignment: [6, 26] },
  { size: 37, dataCodewords: 108, eccCodewords: 26, blocks: 1, alignment: [6, 30] },
  { size: 41, dataCodewords: 136, eccCodewords: 18, blocks: 2, alignment: [6, 34] },
  { size: 45, dataCodewords: 156, eccCodewords: 20, blocks: 2, alignment: [6, 22, 38] },
  { size: 49, dataCodewords: 194, eccCodewords: 24, blocks: 2, alignment: [6, 24, 42] },
  { size: 53, dataCodewords: 232, eccCodewords: 30, blocks: 2, alignment: [6, 26, 46] }
];

function appendQrBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
}

function qrMultiply(left, right) {
  let product = 0;
  for (let i = 7; i >= 0; i -= 1) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    if (((right >>> i) & 1) !== 0) product ^= left;
  }
  return product & 0xff;
}

function qrReedSolomonDivisor(degree) {
  const result = Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = qrMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = qrMultiply(root, 0x02);
  }
  return result;
}

function qrReedSolomonRemainder(data, divisor) {
  const result = Array(divisor.length).fill(0);
  for (const value of data) {
    const factor = value ^ result.shift();
    result.push(0);
    for (let i = 0; i < result.length; i += 1) result[i] ^= qrMultiply(divisor[i], factor);
  }
  return result;
}

function qrFormatBits(mask) {
  const data = (1 << 3) | mask;
  let remainder = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if (((remainder >>> i) & 1) !== 0) remainder ^= 0x537 << (i - 10);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

function setQrFunction(modules, functions, x, y, dark) {
  if (y < 0 || y >= modules.length || x < 0 || x >= modules.length) return;
  modules[y][x] = Boolean(dark);
  functions[y][x] = true;
}

function drawQrFinder(modules, functions, centerX, centerY) {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      setQrFunction(modules, functions, centerX + dx, centerY + dy, distance !== 2 && distance <= 3);
    }
  }
}

function drawQrAlignment(modules, functions, centerX, centerY) {
  if (functions[centerY]?.[centerX]) return;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setQrFunction(modules, functions, centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function drawQrFormat(modules, functions, mask) {
  const size = modules.length;
  const bits = qrFormatBits(mask);
  const bit = (index) => ((bits >>> index) & 1) !== 0;
  for (let i = 0; i <= 5; i += 1) setQrFunction(modules, functions, 8, i, bit(i));
  setQrFunction(modules, functions, 8, 7, bit(6));
  setQrFunction(modules, functions, 8, 8, bit(7));
  setQrFunction(modules, functions, 7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) setQrFunction(modules, functions, 14 - i, 8, bit(i));
  for (let i = 0; i < 8; i += 1) setQrFunction(modules, functions, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) setQrFunction(modules, functions, 8, size - 15 + i, bit(i));
  setQrFunction(modules, functions, 8, size - 8, true);
}

function qrMask(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return false;
  }
}

function qrPenalty(modules) {
  const size = modules.length;
  let penalty = 0;
  for (let y = 0; y < size; y += 1) {
    let runColor = modules[y][0];
    let runLength = 1;
    for (let x = 1; x < size; x += 1) {
      if (modules[y][x] === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) penalty += runLength - 2;
        runColor = modules[y][x];
        runLength = 1;
      }
    }
    if (runLength >= 5) penalty += runLength - 2;
  }
  for (let x = 0; x < size; x += 1) {
    let runColor = modules[0][x];
    let runLength = 1;
    for (let y = 1; y < size; y += 1) {
      if (modules[y][x] === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) penalty += runLength - 2;
        runColor = modules[y][x];
        runLength = 1;
      }
    }
    if (runLength >= 5) penalty += runLength - 2;
  }
  return penalty;
}

function makeQrMatrix(text) {
  const bytes = [...Buffer.from(text, "utf8")];
  const version = QR_VERSION_TABLE.find((entry) => entry && 4 + 8 + bytes.length * 8 <= entry.dataCodewords * 8);
  if (!version) throw new Error("pairing URL is too long for relay QR generation");
  const bits = [];
  appendQrBits(bits, 0x4, 4);
  appendQrBits(bits, bytes.length, 8);
  for (const byte of bytes) appendQrBits(bits, byte, 8);
  const capacityBits = version.dataCodewords * 8;
  appendQrBits(bits, 0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const dataCodewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
    dataCodewords.push(value);
  }
  for (let pad = 0xec; dataCodewords.length < version.dataCodewords; pad ^= 0xec ^ 0x11) dataCodewords.push(pad);

  const blockLength = version.dataCodewords / version.blocks;
  const divisor = qrReedSolomonDivisor(version.eccCodewords);
  const blocks = [];
  for (let i = 0; i < version.blocks; i += 1) {
    const data = dataCodewords.slice(i * blockLength, (i + 1) * blockLength);
    blocks.push({ data, ecc: qrReedSolomonRemainder(data, divisor) });
  }
  const codewords = [];
  for (let i = 0; i < blockLength; i += 1) {
    for (const block of blocks) codewords.push(block.data[i]);
  }
  for (let i = 0; i < version.eccCodewords; i += 1) {
    for (const block of blocks) codewords.push(block.ecc[i]);
  }
  const dataBits = [];
  for (const codeword of codewords) appendQrBits(dataBits, codeword, 8);

  const size = version.size;
  const baseModules = Array.from({ length: size }, () => Array(size).fill(null));
  const functions = Array.from({ length: size }, () => Array(size).fill(false));
  drawQrFinder(baseModules, functions, 3, 3);
  drawQrFinder(baseModules, functions, size - 4, 3);
  drawQrFinder(baseModules, functions, 3, size - 4);
  for (const y of version.alignment) {
    for (const x of version.alignment) drawQrAlignment(baseModules, functions, x, y);
  }
  for (let i = 8; i < size - 8; i += 1) {
    setQrFunction(baseModules, functions, 6, i, i % 2 === 0);
    setQrFunction(baseModules, functions, i, 6, i % 2 === 0);
  }
  drawQrFormat(baseModules, functions, 0);

  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vert = 0; vert < size; vert += 1) {
      const y = upward ? size - 1 - vert : vert;
      for (let dx = 0; dx < 2; dx += 1) {
        const x = right - dx;
        if (!functions[y][x]) baseModules[y][x] = bitIndex < dataBits.length ? dataBits[bitIndex++] === 1 : false;
      }
    }
    upward = !upward;
  }

  let best = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const modules = baseModules.map((row) => row.slice());
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (!functions[y][x] && qrMask(mask, x, y)) modules[y][x] = !modules[y][x];
      }
    }
    drawQrFormat(modules, functions, mask);
    const penalty = qrPenalty(modules);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      best = modules;
    }
  }
  return best;
}

function qrMatrixToSvg(modules, border = 4) {
  const size = modules.length + border * 2;
  let pathData = "";
  for (let y = 0; y < modules.length; y += 1) {
    for (let x = 0; x < modules.length; x += 1) {
      if (modules[y][x]) pathData += `M${x + border},${y + border}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="Legax pairing QR code"><rect width="${size}" height="${size}" fill="#fff"/><path d="${pathData}" fill="#000"/></svg>`;
}

function qrMatrixToTerminal(modules, border = 2) {
  const rows = [];
  for (let y = -border; y < modules.length + border; y += 1) {
    let row = "";
    for (let x = -border; x < modules.length + border; x += 1) {
      row += modules[y]?.[x] ? "██" : "  ";
    }
    rows.push(row);
  }
  return rows;
}

function originFromRequest(req, url) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || url.protocol.replace(":", "") || "http";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0].trim();
  return `${proto}://${host}`;
}

function encodePairComponent(value) {
  return Buffer.from(String(value ?? ""), "utf8").toString("base64url");
}

function compactPairFragment(offer) {
  return [
    "v1",
    offer.pairingId,
    offer.pairingSecret,
    offer.daemonPublicKey,
    offer.nonce,
    encodePairComponent(offer.sessionId)
  ].map(encodeURIComponent).join(".");
}

function pairingQrPayload(req, url, offer) {
  const pairUrl = `${originFromRequest(req, url)}/#pair=${compactPairFragment(offer)}`;
  const matrix = makeQrMatrix(pairUrl);
  return {
    pairUrl,
    qrSvg: qrMatrixToSvg(matrix),
    qrTerminal: qrMatrixToTerminal(matrix)
  };
}

// Append-only audit log. Writes a one-line JSON entry per event / message /
// permission decision. By design we record metadata only — no message bodies —
// so a leaked audit log does not equal a leaked conversation. A short text
// preview (configurable via LEGAX_AUDIT_TEXT_PREVIEW) is included
// to make decisions human-recognizable; set it to 0 to omit entirely.
function appendAudit(direction, payload) {
  if (AUDIT_DISABLED) return;
  const entry = {
    ts: new Date().toISOString(),
    direction,
    sessionId: payload.sessionId,
    seq: payload.seq,
    id: payload.id,
    agentId: payload.agentId ?? payload.targetAgentId,
    targetAgentId: payload.targetAgentId,
    taskId: payload.taskId,
    kind: payload.kind,
    type: payload.type,
    action: payload.action,
    decision: payload.decision,
    requestId: payload.requestId ?? payload.metadata?.requestId,
    textLength: typeof payload.text === "string" ? payload.text.length : undefined,
    textPreview: AUDIT_TEXT_PREVIEW > 0 && typeof payload.text === "string"
      ? payload.text.replace(/\s+/g, " ").slice(0, AUDIT_TEXT_PREVIEW)
      : undefined
  };
  try {
    fs.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    fs.appendFileSync(AUDIT_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    // Audit must never take the relay down. Surface the failure once and move on.
    console.error(`[relay] audit append failed: ${error.message}`);
  }
}

function readAuditTail(limit) {
  if (!fs.existsSync(AUDIT_LOG_PATH)) return [];
  const max = Math.min(AUDIT_MAX_TAIL, Math.max(1, Number(limit) || 100));
  // Naive but cheap for typical log sizes (sub-MB). For larger logs operators
  // should tail the file directly; this endpoint is for quick inspection.
  const text = fs.readFileSync(AUDIT_LOG_PATH, "utf8");
  const lines = text.split("\n").filter(Boolean);
  return lines.slice(-max).map((line) => {
    try { return JSON.parse(line); } catch { return { malformed: line.slice(0, 200) }; }
  });
}

function getSession(store, sessionId) {
  // Reject session ids that don't match the safe charset to keep them out of
  // any future filesystem / log path use. Empty or invalid -> default.
  const candidate = sessionId ? String(sessionId) : "";
  const key = isValidSessionId(candidate) ? candidate : DEFAULT_SESSION;
  store.sessions[key] ??= {
    events: [],
    messages: [],
    nextEventSeq: 1,
    nextMessageSeq: 1
  };
  return [key, store.sessions[key]];
}

function boundedPush(list, item, max = 500) {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

function normalizeAgentId(value) {
  return String(value ?? "").trim();
}

function eventAgentId(body) {
  return normalizeAgentId(body.agentId
    ?? body.metadata?.agentId
    ?? body.metadata?.adapter
    ?? body.source);
}

function eventAgentLabel(body, agentId) {
  return String(body.agentLabel
    ?? body.metadata?.agentLabel
    ?? body.sourceName
    ?? agentId
    ?? "Agent");
}

function normalizeEvent(body, sessionId, seq) {
  const agentId = eventAgentId(body);
  const agentLabel = eventAgentLabel(body, agentId);
  return {
    ...body,
    id: body.id ?? crypto.randomUUID(),
    sessionId,
    agentId,
    agentLabel,
    taskId: body.taskId ?? body.metadata?.taskId,
    runId: body.runId ?? body.metadata?.runId,
    seq,
    createdAt: body.createdAt ?? new Date().toISOString()
  };
}

function normalizeMessage(body, sessionId, seq) {
  const targetAgentId = normalizeAgentId(body.targetAgentId ?? body.agentId ?? body.target);
  return {
    ...body,
    id: body.id ?? crypto.randomUUID(),
    sessionId,
    targetAgentId,
    taskId: body.taskId,
    seq,
    createdAt: body.createdAt ?? new Date().toISOString()
  };
}

function messageMatchesTarget(message, agentId, taskId) {
  const requestedAgentId = normalizeAgentId(agentId);
  if (!requestedAgentId) return true;
  const targetAgentId = normalizeAgentId(message.targetAgentId ?? message.agentId ?? message.target);
  if (!targetAgentId && message.type === "control" && message.action === "list_agents") return true;
  if (!targetAgentId) return false;
  if (BROADCAST_TARGETS.has(targetAgentId)) return true;
  if (targetAgentId !== requestedAgentId) return false;
  return !taskId || !message.taskId || message.taskId === taskId;
}

function eventMatchesAgent(event, agentId, taskId) {
  const requestedAgentId = normalizeAgentId(agentId);
  if (!requestedAgentId) return true;
  const eventAgent = normalizeAgentId(event.agentId ?? event.metadata?.agentId ?? event.metadata?.adapter ?? event.source);
  if (eventAgent !== requestedAgentId) return false;
  return !taskId || !event.taskId || event.taskId === taskId;
}

function sessionAgents(session) {
  const agents = new Map();
  for (const event of session.events) {
    const agentId = normalizeAgentId(event.agentId ?? event.metadata?.agentId ?? event.metadata?.adapter ?? event.source);
    if (!agentId) continue;
    agents.set(agentId, {
      id: agentId,
      label: event.agentLabel ?? event.metadata?.agentLabel ?? event.sourceName ?? agentId,
      taskId: event.taskId ?? event.metadata?.taskId ?? "",
      mode: event.metadata?.mode ?? "",
      source: event.source ?? "",
      lastSeq: event.seq,
      lastSeenAt: event.createdAt
    });
  }
  return [...agents.values()].sort((left, right) => String(left.label).localeCompare(String(right.label)));
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function hashWithRelaySecret(scope, value) {
  return crypto
    .createHash("sha256")
    .update(`${scope}:${DESKTOP_SECRET}:${value}`)
    .digest("hex");
}

function hashPairingCode(code) {
  return hashWithRelaySecret("pairing-code", code);
}

function hashDeviceToken(token) {
  return hashWithRelaySecret("device-token", token);
}

function hashTwaLaunchToken(token) {
  return hashWithRelaySecret("twa-launch-token", token);
}

function cookieMap(req) {
  const header = String(req.headers.cookie || "");
  const cookies = new Map();
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies.set(key, decodeURIComponent(value));
  }
  return cookies;
}

function deviceCookieValue(req) {
  return cookieMap(req).get(DEVICE_COOKIE) || "";
}

function isSecureRequest(req) {
  return String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function deviceCookie(token, req) {
  const parts = [
    `${DEVICE_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${DEVICE_MAX_AGE_SECONDS}`
  ];
  if (isSecureRequest(req)) parts.push("Secure");
  return parts.join("; ");
}

function clearDeviceCookie(req) {
  const parts = [
    `${DEVICE_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (isSecureRequest(req)) parts.push("Secure");
  return parts.join("; ");
}

function validateDeviceCookie(req, sessionId = "") {
  const raw = deviceCookieValue(req);
  const match = raw.match(/^([0-9a-f-]{36})\.([A-Za-z0-9_-]{24,})$/);
  if (!match) return null;
  const [, id, token] = match;
  const store = loadStore();
  const device = store.devices[id];
  if (!device || device.revokedAt) return null;
  if (device.expiresAt && Date.parse(device.expiresAt) <= Date.now()) return null;
  if (sessionId && device.sessionId && device.sessionId !== sessionId) return null;
  if (!safeEqual(device.tokenHash, hashDeviceToken(token))) return null;
  return device;
}

function requestSecret(req) {
  return req.headers["x-legax-secret"];
}

function requireDesktop(req, url) {
  if (ALLOW_INSECURE_DEV && !DESKTOP_SECRET) return true;
  return safeEqual(requestSecret(req, url), DESKTOP_SECRET);
}

function requirePhone(req, url) {
  if (ALLOW_INSECURE_DEV && !DESKTOP_SECRET) return true;
  return Boolean(validateDeviceCookie(req));
}

function requirePhoneForSession(req, url, sessionId) {
  if (ALLOW_INSECURE_DEV && !DESKTOP_SECRET) return true;
  return Boolean(validateDeviceCookie(req, sessionId));
}

function isValidSessionId(value) {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-legax-secret",
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res, html, status = 200, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders
  });
  res.end(html);
}

async function readJsonBody(req) {
  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > MAX_REQUEST_BODY_BYTES) {
      const error = new Error(`request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  return JSON.parse(text);
}

function mobilePage(sessionId) {
  const supportedAgents = [
    {
      configKey: "codex",
      id: String(RAW_CONFIG.codex?.agentId ?? "codex-cli"),
      label: String(RAW_CONFIG.codex?.agentLabel ?? "Codex CLI"),
      enabled: RAW_CONFIG.codex?.enabled !== false
    },
    {
      configKey: "claude",
      id: String(RAW_CONFIG.claude?.agentId ?? "claude-code"),
      label: String(RAW_CONFIG.claude?.agentLabel ?? "Claude Code"),
      enabled: RAW_CONFIG.claude?.enabled !== false
    },
    {
      configKey: "gemini",
      id: String(RAW_CONFIG.gemini?.agentId ?? "gemini-cli"),
      label: String(RAW_CONFIG.gemini?.agentLabel ?? "Gemini CLI"),
      enabled: RAW_CONFIG.gemini?.enabled !== false
    }
  ].filter((agent) => agent.enabled && agent.id);
  const bootstrap = JSON.stringify({ sessionId, supportedAgents });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Legax</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --bg: #eef2f7;
      --bg-top: #f8fafc;
      --surface: #ffffff;
      --surface-soft: #f8fafc;
      --surface-strong: #f1f5f9;
      --text: #111827;
      --muted: #5b6472;
      --border: #d7dee8;
      --border-strong: #b8c2d2;
      --accent: #2563eb;
      --accent-strong: #1d4ed8;
      --success: #15803d;
      --warning: #b45309;
      --danger: #b91c1c;
      --shadow: 0 18px 44px rgba(15, 23, 42, 0.1);
      --shadow-soft: 0 8px 22px rgba(15, 23, 42, 0.07);
      --radius-lg: 18px;
      --radius-md: 12px;
      --focus: 0 0 0 3px rgba(37, 99, 235, 0.2);
      --message-width: 760px;
      background: var(--bg);
      color: var(--text);
    }
    * { box-sizing: border-box; }
    html {
      min-height: 100%;
      background: var(--bg);
    }
    body {
      margin: 0;
      min-height: 100dvh;
      overflow-x: hidden;
      background:
        radial-gradient(circle at 12% -10%, rgba(37, 99, 235, 0.12), transparent 30rem),
        linear-gradient(180deg, var(--bg-top), var(--bg));
      color: var(--text);
      -webkit-font-smoothing: antialiased;
    }
    main {
      width: min(960px, calc(100% - 28px));
      margin: 0 auto;
      min-height: 100dvh;
      padding: 14px 0 calc(118px + env(safe-area-inset-bottom));
    }
    .app-bar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: grid;
      gap: 12px;
      margin: 0 -14px;
      padding: 8px 14px 10px;
      border-bottom: 1px solid rgba(215, 222, 232, 0.82);
      background: rgba(248, 250, 252, 0.86);
      backdrop-filter: blur(18px);
    }
    .banner-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
    }
    .context-breadcrumb {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 4px;
      flex: 1 1 auto;
      min-width: 0;
      color: var(--muted);
      font-size: 14px;
    }
    .context-segment {
      flex: 0 1 auto;
      display: inline-flex;
      align-items: center;
      justify-content: flex-start;
      min-width: 0;
      max-width: 100%;
      min-height: 34px;
      padding: 0 3px;
      text-align: left;
      border-color: transparent;
      background: transparent;
      box-shadow: none;
      color: inherit;
    }
    .context-segment:hover,
    .context-segment[aria-expanded="true"] {
      border-color: transparent;
      background: transparent;
      color: var(--accent);
      text-decoration: underline;
      text-underline-offset: 3px;
      transform: none;
    }
    .crumb-separator {
      flex: 0 0 auto;
      color: var(--muted);
      font-size: 14px;
      line-height: 1;
    }
    .segment-value {
      min-width: 0;
      max-width: min(22vw, 240px);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text);
      font-size: 14px;
      font-weight: 650;
    }
    .context-segment:hover .segment-value,
    .context-segment[aria-expanded="true"] .segment-value {
      color: var(--accent);
    }
    .status {
      display: inline-flex;
      align-items: center;
      align-self: flex-start;
      gap: 8px;
      min-height: 34px;
      padding: 0 11px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      box-shadow: var(--shadow-soft);
      font-size: 13px;
      font-weight: 650;
      color: var(--muted);
      white-space: nowrap;
    }
    .status::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--warning);
      box-shadow: 0 0 0 3px rgba(180, 83, 9, 0.14);
    }
    .status[data-state="connected"]::before,
    .status[data-state="success"]::before {
      background: var(--success);
      box-shadow: 0 0 0 3px rgba(21, 128, 61, 0.14);
    }
    .status[data-state="offline"]::before {
      background: var(--danger);
      box-shadow: 0 0 0 3px rgba(185, 28, 28, 0.14);
    }
    .status[data-state="busy"]::before {
      background: var(--accent);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
    }
    .status[data-help="available"] {
      color: var(--text);
      cursor: pointer;
    }
    .status[data-help="available"]:hover,
    .status[aria-expanded="true"] {
      border-color: color-mix(in srgb, var(--danger) 42%, var(--border));
      transform: none;
    }
    .status:disabled {
      cursor: default;
      opacity: 1;
      transform: none;
    }
    .offline-help {
      justify-self: end;
      width: min(430px, 100%);
      border: 1px solid color-mix(in srgb, var(--danger) 24%, var(--border));
      border-radius: var(--radius-md);
      background: var(--surface);
      box-shadow: var(--shadow);
      padding: 12px;
      color: var(--text);
      font-size: 13px;
    }
    .offline-help[hidden] {
      display: none;
    }
    .offline-help-title {
      font-weight: 760;
      margin-bottom: 6px;
    }
    .offline-help p {
      margin: 0;
      color: var(--muted);
      line-height: 1.45;
    }
    .offline-commands {
      display: grid;
      gap: 6px;
      margin: 10px 0;
    }
    .offline-commands code {
      display: block;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-soft);
      color: var(--text);
      padding: 8px 10px;
      overflow-wrap: anywhere;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    }
    .attention-panel {
      display: grid;
      gap: 8px;
      border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
      border-radius: var(--radius-md);
      background: var(--surface);
      box-shadow: var(--shadow-soft);
      padding: 10px;
    }
    .attention-panel[hidden] {
      display: none;
    }
    .attention-heading {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: var(--text);
      font-size: 13px;
      font-weight: 760;
    }
    .attention-count {
      color: var(--muted);
      font-weight: 650;
    }
    .attention-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      border-top: 1px solid var(--border);
      padding-top: 8px;
      min-width: 0;
    }
    .attention-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 700;
      color: var(--text);
    }
    .attention-meta {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--muted);
      font-size: 12px;
    }
    .controls {
      display: grid;
      grid-template-columns: minmax(220px, 1.55fr) minmax(148px, 0.68fr) repeat(5, auto);
      gap: 8px;
      padding: 14px 0 0;
      align-items: center;
    }
    .field,
    .select-wrap {
      min-width: 0;
      width: 100%;
    }
    .field {
      display: block;
    }
    .select-wrap {
      position: relative;
      display: block;
    }
    .select-wrap::after {
      content: "";
      position: absolute;
      top: 50%;
      right: 14px;
      width: 8px;
      height: 8px;
      border-right: 2px solid var(--muted);
      border-bottom: 2px solid var(--muted);
      pointer-events: none;
      transform: translateY(-62%) rotate(45deg);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    button,
    select,
    textarea {
      font: inherit;
    }
    select {
      appearance: none;
      width: 100%;
      min-height: 42px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      border-radius: var(--radius-md);
      padding: 0 38px 0 14px;
      font-size: 14px;
      box-shadow: var(--shadow-soft);
    }
    select:focus-visible,
    textarea:focus-visible,
    button:focus-visible {
      outline: none;
      box-shadow: var(--focus);
    }
    .timeline {
      display: grid;
      gap: 14px;
      padding: 18px 0 0;
    }
    .empty-state {
      border: 1px dashed var(--border-strong);
      background: rgba(255, 255, 255, 0.62);
      border-radius: var(--radius-lg);
      color: var(--muted);
      padding: 28px 18px;
      text-align: center;
      font-size: 14px;
    }
    .cli-group,
    .project-group,
    .session-group {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .cli-group {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: rgba(255, 255, 255, 0.68);
      box-shadow: var(--shadow-soft);
      padding: 10px;
    }
    .project-group {
      border-left: 2px solid color-mix(in srgb, var(--accent) 32%, var(--border));
      padding-left: 10px;
    }
    .group-heading {
      width: 100%;
      min-width: 0;
      min-height: 36px;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      text-align: left;
    }
    .group-heading:hover {
      border-color: transparent;
      transform: none;
    }
    .group-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 760;
    }
    .group-meta {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .cli-body,
    .project-body,
    .session-events {
      min-width: 0;
    }
    .project-heading .group-title {
      font-size: 14px;
    }
    .session-heading {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface-soft);
      box-shadow: none;
      min-height: 42px;
      padding: 0 12px;
    }
    .session-group[data-active="true"] .session-heading {
      border-color: color-mix(in srgb, var(--accent) 62%, var(--border));
      box-shadow: var(--focus);
    }
    .session-events {
      display: grid;
      gap: 10px;
      justify-items: start;
    }
    .event {
      position: relative;
      width: min(var(--message-width), 100%);
      min-width: 0;
      overflow: hidden;
      border: 1px solid var(--border);
      background: var(--surface);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-soft);
      padding: 14px;
      animation: event-in 180ms ease-out;
    }
    .event::before {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      width: 4px;
      background: var(--border-strong);
    }
    .event.event-status::before {
      background: var(--accent);
    }
    .event.permission-request {
      border-color: rgba(180, 83, 9, 0.42);
      background: #fffbeb;
    }
    .event.permission-request::before {
      background: var(--warning);
    }
    .event.user-input-request::before {
      background: #7c3aed;
    }
    .meta {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 8px;
    }
    .meta-title {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      min-width: 0;
    }
    .meta-title > span:first-child {
      color: var(--text);
      font-weight: 700;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .event-kind {
      flex: 0 0 auto;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-strong);
      color: var(--muted);
      padding: 2px 7px;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.2;
    }
    .event.permission-request .event-kind {
      border-color: rgba(180, 83, 9, 0.28);
      background: #fef3c7;
      color: #92400e;
    }
    time {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .message-content {
      display: grid;
      gap: 10px;
    }
    .text,
    .message-pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.58;
      font-size: 15px;
    }
    .message-pre {
      margin: 0;
      max-height: 360px;
      overflow: auto;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface-soft);
      padding: 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 13px;
    }
    .message-heading {
      color: var(--text);
      font-weight: 760;
    }
    .message-details summary {
      min-height: 34px;
      display: flex;
      align-items: center;
      color: var(--accent);
      font-weight: 720;
      cursor: pointer;
    }
    .structured-list {
      display: grid;
      gap: 8px;
    }
    .session-option,
    .choice-option,
    .kv-row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 9px;
      align-items: start;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface-soft);
      padding: 10px 12px;
    }
    .choice-option {
      align-items: center;
    }
    .option-index {
      width: 26px;
      height: 26px;
      display: grid;
      place-items: center;
      border-radius: 9px;
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      color: var(--accent);
      font-size: 12px;
      font-weight: 780;
    }
    .option-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 720;
    }
    .option-meta,
    .kv-key {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .kv-value {
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .actions button {
      max-width: 100%;
      min-height: 40px;
      padding-top: 8px;
      padding-bottom: 8px;
      line-height: 1.35;
      white-space: normal;
      overflow-wrap: anywhere;
      text-align: center;
    }
    button {
      appearance: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      min-height: 44px;
      padding: 0 14px;
      border-radius: var(--radius-md);
      font-size: 14px;
      font-weight: 700;
      box-shadow: var(--shadow-soft);
      cursor: pointer;
      touch-action: manipulation;
      transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
    }
    button:hover {
      border-color: var(--border-strong);
      transform: translateY(-1px);
    }
    button:active {
      transform: translateY(0);
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.48;
      transform: none;
      box-shadow: none;
    }
    button.primary {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    button.primary:hover {
      background: var(--accent-strong);
      border-color: var(--accent-strong);
    }
    button.danger {
      border-color: rgba(185, 28, 28, 0.3);
      color: var(--danger);
      background: #fff7f7;
    }
    .composer {
      position: fixed;
      left: 50%;
      bottom: 0;
      transform: translateX(-50%);
      width: min(960px, calc(100% - 28px));
      display: grid;
      gap: 10px;
      padding: 14px 0 calc(16px + env(safe-area-inset-bottom));
      background: linear-gradient(180deg, rgba(238, 242, 247, 0), rgba(238, 242, 247, 0.94) 28%, var(--bg) 100%);
    }
    .compose-context {
      display: grid;
      grid-template-columns: auto minmax(90px, 0.3fr) minmax(95px, 0.3fr) minmax(120px, 1fr) auto;
      gap: 8px;
      align-items: center;
      min-height: 46px;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.94);
      box-shadow: var(--shadow-soft);
      cursor: pointer;
    }
    .compose-kicker,
    .compose-action {
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
      white-space: nowrap;
    }
    .compose-context strong,
    .compose-context span[data-role="context-part"] {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .compose-context strong {
      font-size: 14px;
    }
    .context-switcher {
      max-height: min(46vh, 420px);
      overflow: auto;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--surface);
      box-shadow: var(--shadow);
      padding: 8px;
    }
    .context-switcher[hidden] {
      display: none;
    }
    .context-option {
      width: 100%;
      min-height: 46px;
      display: grid;
      grid-template-columns: minmax(86px, 0.25fr) minmax(86px, 0.25fr) minmax(120px, 1fr);
      gap: 10px;
      align-items: center;
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      background: transparent;
      box-shadow: none;
      color: var(--text);
      padding: 8px 10px;
      text-align: left;
    }
    .context-option:hover,
    .context-option[data-active="true"] {
      border-color: color-mix(in srgb, var(--accent) 44%, var(--border));
      background: color-mix(in srgb, var(--accent) 8%, transparent);
      transform: none;
    }
    .context-action {
      border-color: var(--border);
      background: var(--surface-soft);
    }
    .context-action span:first-child {
      font-weight: 760;
    }
    .context-option span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .context-empty {
      color: var(--muted);
      padding: 10px 12px;
    }
    .composer-inner {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: end;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: rgba(255, 255, 255, 0.92);
      box-shadow: var(--shadow);
      padding: 10px;
    }
    .reply-field {
      min-width: 0;
    }
    textarea {
      width: 100%;
      resize: none;
      min-height: 46px;
      max-height: 150px;
      border: 0;
      border-radius: var(--radius-md);
      padding: 11px 10px;
      font-size: 15px;
      line-height: 1.5;
      background: transparent;
      color: var(--text);
      outline: none;
    }
    textarea::placeholder {
      color: #8a94a6;
    }
    @keyframes event-in {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f131a;
        --bg-top: #151b24;
        --surface: #181f2a;
        --surface-soft: #121821;
        --surface-strong: #202938;
        --text: #f8fafc;
        --muted: #a9b4c5;
        --border: #2d3848;
        --border-strong: #435166;
        --shadow: 0 18px 44px rgba(0, 0, 0, 0.35);
        --shadow-soft: 0 8px 22px rgba(0, 0, 0, 0.22);
      }
      .app-bar {
        border-color: rgba(45, 56, 72, 0.86);
        background: rgba(15, 19, 26, 0.86);
      }
      .context-segment:hover,
      .context-segment[aria-expanded="true"] {
        background: transparent;
      }
      .offline-help {
        background: #181f2a;
      }
      .empty-state {
        background: rgba(24, 31, 42, 0.58);
      }
      .event.permission-request {
        background: #261d0d;
      }
      .cli-group,
      .compose-context {
        background: rgba(24, 31, 42, 0.76);
      }
      .event.permission-request .event-kind {
        background: #3a2a11;
        color: #facc15;
      }
      button.danger {
        background: rgba(127, 29, 29, 0.14);
      }
      .composer {
        background: linear-gradient(180deg, rgba(15, 19, 26, 0), rgba(15, 19, 26, 0.94) 28%, var(--bg) 100%);
      }
      .composer-inner {
        background: rgba(24, 31, 42, 0.94);
      }
      textarea::placeholder {
        color: #7f8da1;
      }
    }
    @media (max-width: 820px) {
      main,
      .composer {
        width: min(720px, calc(100% - 24px));
      }
      .controls { grid-template-columns: 1fr 1fr; }
      .controls button { width: 100%; }
      .controls .field:first-child { grid-column: 1 / -1; }
    }
    @media (max-width: 520px) {
      main,
      .composer {
        width: calc(100% - 20px);
      }
      main {
        padding-top: 10px;
      }
      .app-bar {
        margin: 0;
        padding: 10px 0;
      }
      .banner-row {
        align-items: flex-start;
      }
      .context-breadcrumb {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-start;
        flex: 1 1 0;
      }
      .segment-value {
        max-width: calc(100vw - 96px);
      }
      .status {
        min-height: 32px;
        padding: 0 9px;
      }
      .offline-help {
        justify-self: stretch;
        width: 100%;
      }
      .attention-item {
        grid-template-columns: 1fr;
      }
      .meta {
        grid-template-columns: 1fr;
        gap: 4px;
      }
      .compose-context,
      .context-option {
        grid-template-columns: 1fr;
        gap: 3px;
      }
      .compose-action {
        display: none;
      }
      .project-heading .group-meta {
        display: none;
      }
      .composer-inner {
        grid-template-columns: 1fr;
      }
      .composer button {
        width: 100%;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: 1ms !important;
        transition-duration: 1ms !important;
        scroll-behavior: auto !important;
      }
    }
  </style>
</head>
<body>
  <main>
    <header class="app-bar">
      <div class="banner-row">
        <nav class="context-breadcrumb" aria-label="Current conversation">
          <button id="active-cli-button" class="context-segment" data-scope="cli" type="button" aria-expanded="false" aria-controls="context-switcher">
            <span class="sr-only">CLI</span>
            <strong id="active-cli" class="segment-value">Choose target</strong>
          </button>
          <span class="crumb-separator" aria-hidden="true">/</span>
          <button id="active-project-button" class="context-segment" data-scope="project" type="button" aria-expanded="false" aria-controls="context-switcher">
            <span class="sr-only">Project</span>
            <span id="active-project" class="segment-value">Project</span>
          </button>
          <span class="crumb-separator" aria-hidden="true">/</span>
          <button id="active-session-button" class="context-segment" data-scope="session" type="button" aria-expanded="false" aria-controls="context-switcher">
            <span class="sr-only">Session</span>
            <span id="active-session" class="segment-value">Session</span>
          </button>
        </nav>
        <button id="status" class="status" data-state="busy" data-help="" type="button" aria-expanded="false" aria-controls="offline-help" disabled>Connecting</button>
      </div>
      <div id="offline-help" class="offline-help" hidden>
        <div class="offline-help-title">Daemon is offline</div>
        <p>Start the local daemon, then confirm the relay settings in config.yaml point to this relay.</p>
        <div class="offline-commands">
          <code>npm run daemon:bg</code>
          <code>npm run daemon:status</code>
          <code>npm run daemon:pair</code>
        </div>
        <p>Check relay.url, relay.secret, browser pairing, and enabled adapter settings before retrying.</p>
      </div>
      <div id="context-switcher" class="context-switcher" hidden></div>
      <section id="attention-panel" class="attention-panel" aria-live="polite" hidden></section>
      <select id="target" hidden aria-hidden="true"><option value="">No target</option></select>
    </header>
    <section id="timeline" class="timeline" aria-live="polite">
      <div id="empty-state" class="empty-state">Waiting for events</div>
    </section>
    <form id="reply-form" class="composer">
      <div class="composer-inner">
        <label class="reply-field">
          <span class="sr-only">Reply to agent</span>
          <textarea id="reply" rows="1" placeholder="Reply to agent" aria-label="Reply to agent"></textarea>
        </label>
        <button id="send-button" class="primary" type="submit">Send</button>
      </div>
    </form>
  </main>
  <script>
    const BOOTSTRAP = ${bootstrap};
    let after = 0;
    const timeline = document.getElementById("timeline");
    const emptyState = document.getElementById("empty-state");
    const statusEl = document.getElementById("status");
    const activeCliButton = document.getElementById("active-cli-button");
    const activeProjectButton = document.getElementById("active-project-button");
    const activeSessionButton = document.getElementById("active-session-button");
    const contextButtons = [activeCliButton, activeProjectButton, activeSessionButton];
    const activeCli = document.getElementById("active-cli");
    const activeProject = document.getElementById("active-project");
    const activeSession = document.getElementById("active-session");
    const contextSwitcher = document.getElementById("context-switcher");
    const replyForm = document.getElementById("reply-form");
    const reply = document.getElementById("reply");
    const sendButton = document.getElementById("send-button");
    const target = document.getElementById("target");
    const offlineHelp = document.getElementById("offline-help");
    const attentionPanel = document.getElementById("attention-panel");
    const agents = new Map();
    const contexts = new Map();
    const agentGroups = new Map();
    const projectGroups = new Map();
    const sessionGroups = new Map();
    const supportedAgents = Array.isArray(BOOTSTRAP.supportedAgents) ? BOOTSTRAP.supportedAgents : [];
    for (const agent of supportedAgents) {
      if (agent && agent.id) agents.set(agent.id, agent.label || agent.id);
    }
    let activeContextKey = "";
    let selectedProjectKey = "";
    let switcherScope = "session";
    const DEFAULT_AGENT = "";

    function qs(params) {
      const search = new URLSearchParams(params);
      return search.toString();
    }

    function authHeaders(extra = {}) {
      return extra;
    }

    function setStatus(text, state = "connected") {
      statusEl.textContent = text;
      statusEl.dataset.state = state;
      const canShowOfflineHelp = state === "offline" && text === "Offline";
      statusEl.dataset.help = canShowOfflineHelp ? "available" : "";
      statusEl.disabled = !canShowOfflineHelp;
      if (canShowOfflineHelp) statusEl.title = "Show daemon startup help";
      else if (text === "Auth required") statusEl.title = "Pair this browser with npm run daemon:pair";
      else if (text === "Unauthorized") statusEl.title = "Pairing is missing, expired, or revoked";
      else statusEl.title = "";
      if (!canShowOfflineHelp) setOfflineHelpOpen(false);
    }

    function setOfflineHelpOpen(open) {
      offlineHelp.hidden = !open;
      statusEl.setAttribute("aria-expanded", open ? "true" : "false");
    }

    function syncControls() {
      const hasTarget = Boolean(target.value);
      reply.disabled = !hasTarget;
      sendButton.disabled = !hasTarget;
      updateActiveContextDisplay();
    }

    function autoSizeReply() {
      reply.style.height = "auto";
      reply.style.height = Math.min(reply.scrollHeight, 150) + "px";
    }

    function firstText(values) {
      for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return "";
    }

    function basename(value) {
      const normalized = String(value || "").replace(/[\\\\/]+$/, "");
      if (!normalized) return "";
      return normalized.split(/[\\\\/]/).filter(Boolean).pop() || normalized;
    }

    function compactLabel(value, fallback) {
      const text = String(value || "").replace(/\\s+/g, " ").trim();
      if (!text) return fallback;
      return text.length > 96 ? text.slice(0, 93) + "..." : text;
    }

    function projectInfo(event) {
      const meta = event.metadata || {};
      const raw = firstText([
        meta.projectName,
        meta.project,
        meta.projectId,
        meta.repoName,
        meta.repository,
        meta.projectPath,
        meta.workspacePath,
        meta.workspace,
        meta.cwd,
        event.cwd
      ]);
      const label = raw ? compactLabel(basename(raw), "Project") : "Default project";
      return {
        id: raw || "default-project",
        label,
        detail: raw && raw !== label ? raw : ""
      };
    }

    function sessionInfo(event) {
      const meta = event.metadata || {};
      const text = event.text || "";
      const selected = text.match(/Selected [^\\n]*session:\\s*([^\\n]+)\\n\\s*id:\\s*([^\\s]+)/i);
      const sessionMenu = /^Choose .*session:/i.test(text.trim());
      const ref = firstText([
        meta.threadId,
        meta.sessionId,
        event.threadId,
        selected && selected[2]
      ]);
      const title = firstText([
        meta.threadTitle,
        meta.threadName,
        selected && selected[1],
        ref
      ]);
      return {
        id: ref || title || (sessionMenu ? "session-menu" : "current-session"),
        ref,
        label: compactLabel(title, sessionMenu ? "Session menu" : "Current session")
      };
    }

    function contextFromEvent(event) {
      const agent = agentInfo(event);
      if (!agent) return null;
      const project = projectInfo(event);
      const session = sessionInfo(event);
      const key = agent.id + "\\u0000" + project.id + "\\u0000" + session.id;
      return { key, agent, project, session };
    }

    function makeGroupButton(className, titleText, metaText) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "group-heading " + className;
      const title = document.createElement("span");
      title.className = "group-title";
      title.textContent = titleText;
      const meta = document.createElement("span");
      meta.className = "group-meta";
      meta.textContent = metaText;
      button.append(title, meta);
      return { button, title, meta };
    }

    function ensureAgentGroup(context) {
      let group = agentGroups.get(context.agent.id);
      if (group) return group;
      const section = document.createElement("section");
      section.className = "cli-group";
      const heading = makeGroupButton("cli-heading", context.agent.label, "CLI");
      const body = document.createElement("div");
      body.className = "cli-body";
      heading.button.addEventListener("click", () => selectAgent(context.agent.id, false));
      section.append(heading.button, body);
      group = { section, body, heading };
      agentGroups.set(context.agent.id, group);
      timeline.prepend(section);
      return group;
    }

    function ensureProjectGroup(context) {
      const key = context.agent.id + "\\u0000" + context.project.id;
      let group = projectGroups.get(key);
      if (group) return group;
      const agentGroup = ensureAgentGroup(context);
      const section = document.createElement("section");
      section.className = "project-group";
      const heading = makeGroupButton("project-heading", context.project.label, context.project.detail || "Project");
      const body = document.createElement("div");
      body.className = "project-body";
      heading.button.title = context.project.detail || context.project.label;
      heading.button.addEventListener("click", () => selectProject(context));
      section.append(heading.button, body);
      group = { section, body, heading };
      projectGroups.set(key, group);
      agentGroup.body.prepend(section);
      return group;
    }

    function ensureSessionGroup(context) {
      let group = sessionGroups.get(context.key);
      if (group) return group;
      const projectGroup = ensureProjectGroup(context);
      const section = document.createElement("section");
      section.className = "session-group";
      const heading = makeGroupButton("session-heading", context.session.label, context.session.ref || "Session");
      const events = document.createElement("div");
      events.className = "session-events";
      heading.button.addEventListener("click", () => selectContext(context.key, true));
      section.append(heading.button, events);
      group = { section, events, heading };
      sessionGroups.set(context.key, group);
      projectGroup.body.prepend(section);
      return group;
    }

    function rememberContext(event) {
      const context = contextFromEvent(event);
      if (!context) {
        rememberAgent(event);
        return null;
      }
      agents.set(context.agent.id, context.agent.label);
      let stored = contexts.get(context.key);
      if (!stored) {
        stored = { ...context, count: 0, lastSeq: 0 };
        contexts.set(context.key, stored);
      } else {
        stored.agent.label = context.agent.label;
        stored.project.label = context.project.label;
        stored.project.detail = context.project.detail;
        stored.session.label = context.session.label;
        stored.session.ref = context.session.ref || stored.session.ref;
      }
      stored.count += 1;
      stored.lastSeq = Math.max(stored.lastSeq, Number(event.seq) || Date.now());
      const active = activeContextRecord();
      if (!activeContextKey && !target.value) {
        activeContextKey = stored.key;
        selectedProjectKey = projectKey(stored);
        target.value = stored.agent.id;
      } else if (stored.session.ref && active && active.agent.id === stored.agent.id && !active.session.ref) {
        activeContextKey = stored.key;
        selectedProjectKey = projectKey(stored);
      }
      refreshTargets();
      updateActiveContextDisplay();
      renderContextSwitcher();
      return stored;
    }

    function touchContext(context) {
      if (!context) return null;
      const agentGroup = ensureAgentGroup(context);
      const projectGroup = ensureProjectGroup(context);
      const sessionGroup = ensureSessionGroup(context);
      timeline.prepend(agentGroup.section);
      agentGroup.body.prepend(projectGroup.section);
      projectGroup.body.prepend(sessionGroup.section);
      return sessionGroup;
    }

    function setActiveGroup() {
      for (const [key, group] of sessionGroups) {
        group.section.dataset.active = key === activeContextKey ? "true" : "false";
      }
    }

    function activeContextRecord() {
      return activeContextKey ? contexts.get(activeContextKey) : null;
    }

    function projectKey(context) {
      return context.agent.id + "\u0000" + context.project.id;
    }

    function selectedProjectRecord() {
      const agentId = activeAgentId();
      if (!selectedProjectKey || !agentId) return null;
      return [...contexts.values()].find((context) => context.agent.id === agentId && projectKey(context) === selectedProjectKey) || null;
    }

    function agentLabelById(agentId) {
      return agents.get(agentId) || agentId || "Choose target";
    }

    function updateActiveContextDisplay() {
      const agentId = activeAgentId();
      const context = activeContextRecord();
      const selectedProject = selectedProjectRecord();
      if (context && context.agent.id === agentId && (!selectedProjectKey || projectKey(context) === selectedProjectKey)) {
        activeCli.textContent = context.agent.label;
        activeProject.textContent = context.project.label;
        activeProject.title = context.project.detail || context.project.label;
        activeSession.textContent = context.session.label;
        activeSession.title = context.session.ref || context.session.label;
      } else if (agentId) {
        activeCli.textContent = agentLabelById(agentId);
        activeProject.textContent = selectedProject ? selectedProject.project.label : "Project";
        activeProject.title = selectedProject ? (selectedProject.project.detail || selectedProject.project.label) : "";
        activeSession.textContent = "Session";
        activeSession.title = "";
      } else {
        activeCli.textContent = "Choose target";
        activeProject.textContent = "Project";
        activeSession.textContent = "Session";
        activeProject.title = "";
        activeSession.title = "";
      }
      setActiveGroup();
    }

    function activateContextByThread(agentId, threadRef) {
      const match = [...contexts.values()].find((context) => (
        context.agent.id === agentId && (context.session.ref === threadRef || context.session.id === threadRef)
      ));
      if (match) selectContext(match.key, false);
    }

    async function selectContext(key, sendSelect, closeSwitcher = true) {
      const context = contexts.get(key);
      if (!context) return;
      activeContextKey = key;
      selectedProjectKey = projectKey(context);
      target.value = context.agent.id;
      syncControls();
      updateActiveContextDisplay();
      renderContextSwitcher();
      if (closeSwitcher) setSwitcherOpen(false);
      if (sendSelect && context.session.ref) {
        await postMessage({
          targetAgentId: context.agent.id,
          type: "control",
          action: "select_session",
          selectedAgentId: context.agent.id,
          threadRef: context.session.ref,
          text: "/use " + context.agent.id + " " + context.session.ref
        });
        setStatus("Session selected", "success");
      }
    }

    function selectAgent(agentId, openProject = true) {
      target.value = agentId;
      activeContextKey = "";
      selectedProjectKey = "";
      syncControls();
      updateActiveContextDisplay();
      renderContextSwitcher();
      if (openProject) setSwitcherOpen(true, "project");
    }

    function selectProject(context) {
      target.value = context.agent.id;
      selectedProjectKey = projectKey(context);
      activeContextKey = "";
      syncControls();
      updateActiveContextDisplay();
      renderContextSwitcher();
      setSwitcherOpen(true, "session");
    }

    function setSwitcherOpen(open, scope = switcherScope) {
      switcherScope = scope;
      contextSwitcher.hidden = !open;
      for (const button of contextButtons) {
        button.setAttribute("aria-expanded", open && button.dataset.scope === switcherScope ? "true" : "false");
      }
      if (open) renderContextSwitcher();
    }

    function activeAgentId() {
      const context = activeContextRecord();
      return target.value || context?.agent.id || DEFAULT_AGENT;
    }

    function activeProjectId() {
      const selectedProject = selectedProjectRecord();
      return selectedProject?.project.id || activeContextRecord()?.project.id || "";
    }

    function sortedContexts() {
      return [...contexts.values()].sort((left, right) => right.lastSeq - left.lastSeq);
    }

    function makeContextOption(context, clickHandler) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "context-option";
      button.dataset.active = context.key === activeContextKey ? "true" : "false";
      const cli = document.createElement("span");
      cli.textContent = context.agent.label;
      const project = document.createElement("span");
      project.textContent = context.project.label;
      project.title = context.project.detail || context.project.label;
      const session = document.createElement("span");
      session.textContent = context.session.label;
      session.title = context.session.ref || context.session.label;
      button.append(cli, project, session);
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        try {
          await clickHandler();
        } catch {
          setStatus("Action failed", "offline");
        }
      });
      return button;
    }

    function appendSwitcherAction(label, detail, handler) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "context-option context-action";
      const primary = document.createElement("span");
      primary.textContent = label;
      const secondary = document.createElement("span");
      secondary.textContent = detail || "";
      const tail = document.createElement("span");
      tail.textContent = "";
      button.append(primary, secondary, tail);
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        try {
          await handler();
        } catch {
          setStatus("Action failed", "offline");
        }
      });
      contextSwitcher.append(button);
    }

    async function requestSessionsForAgent(agentId) {
      if (!agentId) return;
      await postMessage({ targetAgentId: agentId, type: "control", action: "list_agent_sessions", selectedAgentId: agentId, text: "/sessions " + agentId });
      setStatus("Sessions requested", "busy");
    }

    function renderContextSwitcher() {
      contextSwitcher.replaceChildren();
      const sorted = sortedContexts();
      if (switcherScope === "cli") {
        for (const [id, label] of [...agents.entries()].sort((left, right) => left[1].localeCompare(right[1]))) {
          const latest = sorted.find((context) => context.agent.id === id);
          const context = latest || {
            key: "agent:" + id,
            agent: { id, label },
            project: { id: "", label: "", detail: "" },
            session: { id: "", label: "", ref: "" }
          };
          const button = makeContextOption(context, async () => {
            selectAgent(id, true);
            await requestSessionsForAgent(id);
          });
          button.dataset.active = target.value === id ? "true" : "false";
          button.children[1].textContent = latest ? latest.project.label : "Not started";
          button.children[2].textContent = latest ? latest.session.label : "Load sessions";
          contextSwitcher.append(button);
        }
        appendSwitcherAction("Refresh CLI list", "Ask daemon for adapters", async () => {
          await postMessage({ type: "control", action: "list_agents", text: "/start" });
          setStatus("CLI list requested", "busy");
        });
        return;
      }

      if (switcherScope === "project") {
        const agentId = activeAgentId();
        const projects = new Map();
        for (const context of sorted) {
          if (agentId && context.agent.id !== agentId) continue;
          const key = context.agent.id + "\\u0000" + context.project.id;
          if (!projects.has(key)) projects.set(key, context);
        }
        if (!projects.size) {
          const empty = document.createElement("div");
          empty.className = "context-empty";
          empty.textContent = agentId ? "No project context yet" : "Choose CLI first";
          contextSwitcher.append(empty);
        }
        for (const context of projects.values()) {
          const button = makeContextOption(context, () => selectProject(context));
          button.dataset.active = projectKey(context) === selectedProjectKey ? "true" : "false";
          contextSwitcher.append(button);
        }
        if (agentId) {
          appendSwitcherAction("Load sessions", agentId, async () => {
            await requestSessionsForAgent(agentId);
          });
        }
        return;
      }

      const agentId = activeAgentId();
      const projectId = activeProjectId();
      const sessions = projectId ? sorted.filter((context) => (
        (!agentId || context.agent.id === agentId) && context.project.id === projectId
      )) : [];
      if (!sessions.length) {
        const empty = document.createElement("div");
        empty.className = "context-empty";
        empty.textContent = projectId ? "No session context yet" : "Choose project first";
        contextSwitcher.append(empty);
      }
      for (const context of sessions) {
        contextSwitcher.append(makeContextOption(context, () => selectContext(context.key, true)));
      }
      const targetAgentId = agentId || DEFAULT_AGENT;
      if (targetAgentId) {
        appendSwitcherAction("Refresh sessions", targetAgentId, async () => {
          await postMessage({ targetAgentId, type: "control", action: "list_agent_sessions", selectedAgentId: targetAgentId, text: "/sessions " + targetAgentId });
          setStatus("Sessions requested", "busy");
        });
        appendSwitcherAction("New session", targetAgentId, async () => {
          await postMessage({ targetAgentId, type: "control", action: "new_session", selectedAgentId: targetAgentId, text: "/new " + targetAgentId });
          setStatus("New session requested", "busy");
        });
      }
    }

    function eventKindLabel(event) {
      if (event.kind === "permission_request") return "Approval";
      if (event.kind === "user_input_request") return "Input";
      if (event.kind === "status") return "Status";
      return "Message";
    }

    function eventKindClass(event) {
      if (event.kind === "status") return "event-status";
      return String(event.kind || "message").replace(/_/g, "-");
    }

    function eventTitle(event) {
      const agent = agentLabel(event);
      const session = eventSession(event);
      if (event.kind === "permission_request") return agent + " - Permission request";
      if (event.kind === "user_input_request") return agent + " - Input request";
      if (event.kind === "status") return agent + " - Status" + session;
      return agent + session;
    }

    function eventSession(event) {
      const session = event.metadata && (event.metadata.threadTitle || event.metadata.threadName || event.metadata.threadId || event.metadata.sessionId);
      return session ? " - " + session : "";
    }

    function agentInfo(event) {
      const id = event.agentId || (event.metadata && (event.metadata.agentId || event.metadata.adapter)) || event.source || "";
      if (!id) return null;
      return {
        id,
        label: event.agentLabel || (event.metadata && event.metadata.agentLabel) || event.sourceName || id
      };
    }

    function agentLabel(event) {
      const info = agentInfo(event);
      return info ? info.label : "Agent";
    }

    function rememberAgent(event) {
      const info = agentInfo(event);
      if (!info) return;
      agents.set(info.id, info.label);
      refreshTargets();
    }

    function refreshTargets() {
      const current = target.value;
      target.replaceChildren();
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = agents.size ? "Choose target" : "No target";
      target.append(empty);
      for (const [id, label] of [...agents.entries()].sort((left, right) => left[1].localeCompare(right[1]))) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = label;
        target.append(option);
      }
      if (current && agents.has(current)) target.value = current;
      syncControls();
    }

    function cleanRelayText(text) {
      const lines = String(text || "").replace(/\\r\\n/g, "\\n").split("\\n");
      while (lines.length && /^\\[Legax\\b/i.test(lines[0].trim())) lines.shift();
      while (lines.length && /^Session:\\s+/i.test(lines[0].trim())) lines.shift();
      return lines.join("\\n").trim();
    }

    function appendTextBlock(container, text) {
      const clean = cleanRelayText(text);
      if (!clean) return;
      const lines = clean.split("\\n");
      const longMessage = clean.length > 900 || lines.length > 14;
      if (!longMessage) {
        const block = document.createElement("div");
        block.className = "text";
        block.textContent = clean;
        container.append(block);
        return;
      }
      const preview = lines.slice(0, 8).join("\\n");
      const block = document.createElement("div");
      block.className = "text";
      block.textContent = preview.length > 650 ? preview.slice(0, 650) + "..." : preview;
      const details = document.createElement("details");
      details.className = "message-details";
      const summary = document.createElement("summary");
      summary.textContent = "Show full message";
      const pre = document.createElement("pre");
      pre.className = "message-pre";
      pre.textContent = clean;
      details.append(summary, pre);
      container.append(block, details);
    }

    function renderSessionList(text, container) {
      const clean = cleanRelayText(text);
      if (!/^Choose .*session:/i.test(clean)) return false;
      const lines = clean.split("\\n");
      const heading = document.createElement("div");
      heading.className = "message-heading";
      heading.textContent = lines[0].replace(/:$/, "");
      const list = document.createElement("div");
      list.className = "structured-list";
      let rendered = 0;
      for (let index = 1; index < lines.length; index += 1) {
        const match = lines[index].match(/^\\s*(\\d+)\\.\\s+(.+)$/);
        if (!match) continue;
        const metaLine = (lines[index + 1] || "").trim();
        const meta = metaLine.match(/^id:\\s*([^|]+)(?:\\|\\s*updated:\\s*(.+))?/i);
        const row = document.createElement("div");
        row.className = "session-option";
        const number = document.createElement("span");
        number.className = "option-index";
        number.textContent = match[1];
        const body = document.createElement("div");
        const title = document.createElement("div");
        title.className = "option-title";
        title.textContent = match[2];
        const detail = document.createElement("div");
        detail.className = "option-meta";
        detail.textContent = meta ? ("id " + meta[1].trim() + (meta[2] ? " | " + meta[2].trim() : "")) : metaLine;
        body.append(title, detail);
        row.append(number, body);
        list.append(row);
        rendered += 1;
      }
      if (!rendered) return false;
      container.append(heading, list);
      return true;
    }

    function renderChoiceList(text, container) {
      const clean = cleanRelayText(text);
      if (!/^Choose .*adapter:/i.test(clean)) return false;
      const lines = clean.split("\\n");
      const heading = document.createElement("div");
      heading.className = "message-heading";
      heading.textContent = lines[0].replace(/:$/, "");
      const list = document.createElement("div");
      list.className = "structured-list";
      let rendered = 0;
      for (let index = 1; index < lines.length; index += 1) {
        const match = lines[index].match(/^\\s*(\\d+)\\.\\s+(.+)$/);
        if (!match) continue;
        const row = document.createElement("div");
        row.className = "choice-option";
        const number = document.createElement("span");
        number.className = "option-index";
        number.textContent = match[1];
        const title = document.createElement("div");
        title.className = "option-title";
        title.textContent = match[2];
        row.append(number, title);
        list.append(row);
        rendered += 1;
      }
      if (!rendered) return false;
      container.append(heading, list);
      return true;
    }

    function renderSelectedSession(text, container) {
      const clean = cleanRelayText(text);
      if (!/^Selected .*session:/i.test(clean)) return false;
      const parts = clean.split(/\\nRecent history:\\n/i);
      appendTextBlock(container, parts[0]);
      if (parts[1]) {
        const details = document.createElement("details");
        details.className = "message-details";
        const summary = document.createElement("summary");
        summary.textContent = "Recent history";
        const pre = document.createElement("pre");
        pre.className = "message-pre";
        pre.textContent = parts[1].trim();
        details.append(summary, pre);
        container.append(details);
      }
      return true;
    }

    function renderKeyValueMessage(text, container) {
      const clean = cleanRelayText(text);
      if (!/^(MCP elicitation requested|Permission requested|Approval requested)/i.test(clean)) return false;
      const pairs = [];
      const labels = ["Server", "Message", "Mode", "Command", "Risk"];
      for (const label of labels) {
        const otherLabels = labels.filter((item) => item !== label).join("|");
        const match = clean.match(new RegExp(label + ":\\\\s*([\\\\s\\\\S]*?)(?=\\\\s+(?:" + otherLabels + "):|$)", "i"));
        if (match) pairs.push([label, match[1].trim()]);
      }
      if (!pairs.length) return false;
      const heading = document.createElement("div");
      heading.className = "message-heading";
      heading.textContent = clean.split("\\n")[0].replace(/\\s*(Server|Message|Mode|Command|Risk):.*$/i, "");
      const list = document.createElement("div");
      list.className = "structured-list";
      for (const pair of pairs) {
        const row = document.createElement("div");
        row.className = "kv-row";
        const key = document.createElement("div");
        key.className = "kv-key";
        key.textContent = pair[0];
        const value = document.createElement("div");
        value.className = "kv-value";
        value.textContent = pair[1];
        row.append(key, value);
        list.append(row);
      }
      container.append(heading, list);
      return true;
    }

    function renderEventContent(event, container) {
      const text = event.text || "";
      if (renderSessionList(text, container)) return;
      if (renderChoiceList(text, container)) return;
      if (renderSelectedSession(text, container)) return;
      if (renderKeyValueMessage(text, container)) return;
      appendTextBlock(container, text);
    }

    function renderEvent(event) {
      rememberContext(event);
      if (emptyState) emptyState.hidden = true;
      const article = document.createElement("article");
      article.className = "event " + eventKindClass(event);

      const meta = document.createElement("div");
      meta.className = "meta";
      const titleWrap = document.createElement("div");
      titleWrap.className = "meta-title";
      const title = document.createElement("span");
      title.textContent = eventTitle(event);
      const kind = document.createElement("span");
      kind.className = "event-kind";
      kind.textContent = eventKindLabel(event);
      titleWrap.append(title, kind);
      const time = document.createElement("time");
      time.textContent = new Date(event.createdAt || Date.now()).toLocaleString();
      meta.append(titleWrap, time);

      const content = document.createElement("div");
      content.className = "message-content";
      renderEventContent(event, content);
      article.append(meta, content);

      if (event.kind === "permission_request" && event.metadata && event.metadata.requestId) {
        const actions = document.createElement("div");
        actions.className = "actions";
        const approve = document.createElement("button");
        approve.className = "primary";
        approve.type = "button";
        approve.textContent = "Approve";
        approve.addEventListener("click", () => decision(event, "approve"));
        const deny = document.createElement("button");
        deny.className = "danger";
        deny.type = "button";
        deny.textContent = "Deny";
        deny.addEventListener("click", () => decision(event, "deny"));
        actions.append(approve, deny);
        article.append(actions);
      }

      const remoteActions = actionRows(event);
      if (remoteActions.length) {
        const actions = document.createElement("div");
        actions.className = "actions";
        for (const action of remoteActions) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = action.text;
          button.addEventListener("click", () => handleCallbackData(action.callback_data));
          actions.append(button);
        }
        article.append(actions);
      }

      timeline.prepend(article);
    }

    function actionRows(event) {
      const markup = event.metadata && (event.metadata.replyMarkup || event.metadata.telegramReplyMarkup);
      const rows = [];
      if (markup && Array.isArray(markup.inline_keyboard)) {
        for (const row of markup.inline_keyboard) {
          for (const item of row || []) {
            if (item && item.text && item.callback_data) rows.push(item);
          }
        }
      }
      const agent = agentInfo(event);
      const threadId = event.metadata && event.metadata.threadId;
      if (agent && threadId && !rows.some((row) => row.callback_data && row.callback_data.includes(encodeURIComponent(threadId)))) {
        rows.unshift({
          text: "Use this session",
          callback_data: "legax:session:" + encodeURIComponent(agent.id) + ":" + encodeURIComponent(threadId)
        });
      }
      return rows;
    }

    async function handleCallbackData(data) {
      const message = callbackDataToMessage(data);
      if (!message) {
        setStatus("Unsupported action", "offline");
        return;
      }
      await postMessage(message);
      setStatus("Action sent", "success");
    }

    function callbackDataToMessage(data) {
      if (data === "legax:agents") {
        return { type: "control", action: "list_agents", text: "/start" };
      }
      const agent = data.match(/^legax:agent:([^:]+)$/);
      if (agent) {
        const agentId = decodeURIComponent(agent[1]);
        selectAgent(agentId, true);
        return { targetAgentId: agentId, type: "control", action: "list_agent_projects", selectedAgentId: agentId, text: "/projects " + agentId };
      }
      const projects = data.match(/^legax:projects:([^:]+)$/);
      if (projects) {
        const agentId = decodeURIComponent(projects[1]);
        selectAgent(agentId, true);
        return { targetAgentId: agentId, type: "control", action: "list_agent_projects", selectedAgentId: agentId, text: "/projects " + agentId };
      }
      const pagedProjects = data.match(/^legax:projects:([^:]+):(\d+)$/);
      if (pagedProjects) {
        const agentId = decodeURIComponent(pagedProjects[1]);
        selectAgent(agentId, true);
        return { targetAgentId: agentId, type: "control", action: "list_agent_projects", selectedAgentId: agentId, page: Number(pagedProjects[2]), text: "/projects " + agentId };
      }
      const project = data.match(/^legax:(?:project|chat):([^:]+):([^:]+)(?::(\d+))?$/);
      if (project) {
        const agentId = decodeURIComponent(project[1]);
        const projectRef = decodeURIComponent(project[2]);
        selectAgent(agentId, true);
        return { targetAgentId: agentId, type: "control", action: "list_agent_sessions", selectedAgentId: agentId, projectRef, page: project[3] ? Number(project[3]) : undefined, text: "/sessions " + agentId + " " + projectRef };
      }
      const session = data.match(/^legax:session:([^:]+):(.+)$/);
      if (session) {
        const agentId = decodeURIComponent(session[1]);
        const threadRef = decodeURIComponent(session[2]);
        target.value = agentId;
        syncControls();
        activateContextByThread(agentId, threadRef);
        return { targetAgentId: agentId, type: "control", action: "select_session", selectedAgentId: agentId, threadRef, text: "/use " + agentId + " " + threadRef };
      }
      const sessions = data.match(/^legax:sessions:([^:]+)$/);
      if (sessions) {
        const agentId = decodeURIComponent(sessions[1]);
        selectAgent(agentId, true);
        return { targetAgentId: agentId, type: "control", action: "list_agent_sessions", selectedAgentId: agentId, text: "/sessions " + agentId };
      }
      const newGeneric = data.match(/^legax:new:([^:]+)$/);
      if (newGeneric) {
        const agentId = decodeURIComponent(newGeneric[1]);
        selectAgent(agentId, true);
        return { targetAgentId: agentId, type: "control", action: "new_session", selectedAgentId: agentId, text: "/new " + agentId };
      }
      const newProject = data.match(/^legax:new-project:([^:]+)$/);
      if (newProject) {
        const agentId = decodeURIComponent(newProject[1]);
        selectAgent(agentId, true);
        return { targetAgentId: "legax-daemon", type: "control", action: "new_project_preflight", selectedAgentId: agentId, text: "/new-project " + agentId };
      }
      if (data === "legax:codex:sessions") {
        return { targetAgentId: "codex-cli", type: "control", action: "list_agent_sessions", selectedAgentId: "codex-cli", text: "/sessions codex-cli" };
      }
      if (data === "legax:codex:new") {
        return { targetAgentId: "codex-cli", type: "control", action: "new_session", selectedAgentId: "codex-cli", text: "/new codex-cli" };
      }
      const useCodex = data.match(/^legax:codex:use:(.+)$/);
      if (useCodex) {
        target.value = "codex-cli";
        syncControls();
        activateContextByThread("codex-cli", useCodex[1]);
        return { targetAgentId: "codex-cli", type: "control", action: "select_session", selectedAgentId: "codex-cli", threadRef: useCodex[1], text: "/use codex-cli " + useCodex[1] };
      }
      return null;
    }

    async function postMessage(message) {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ sessionId: BOOTSTRAP.sessionId, ...message })
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }

    function targetMessageFields(fallbackEvent) {
      const fallback = fallbackEvent ? agentInfo(fallbackEvent) : null;
      const targetAgentId = fallback?.id || target.value;
      return targetAgentId ? { targetAgentId } : {};
    }

    async function decision(event, value) {
      await postMessage({
        type: "permission_decision",
        ...targetMessageFields(event),
        requestId: event.metadata.requestId,
        decision: value,
        text: value === "approve" ? "Approved from phone" : "Denied from phone"
      });
      setStatus(value === "approve" ? "Approved" : "Denied", value === "approve" ? "success" : "offline");
    }

    function attentionTypeLabel(type) {
      if (type === "approval") return "Approval";
      if (type === "input") return "Input";
      if (type === "error") return "Error";
      if (type === "completion") return "Completion";
      return "Attention";
    }

    async function ackAttention(id) {
      const response = await fetch("/api/attention/ack", {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ sessionId: BOOTSTRAP.sessionId, ids: [id] })
      });
      if (!response.ok) throw new Error(await response.text());
      await refreshAttention();
    }

    function renderAttention(data) {
      const items = Array.isArray(data.items) ? data.items : [];
      attentionPanel.replaceChildren();
      if (!items.length) {
        attentionPanel.hidden = true;
        return;
      }
      attentionPanel.hidden = false;
      const heading = document.createElement("div");
      heading.className = "attention-heading";
      const title = document.createElement("span");
      title.textContent = data.activeContext?.sessionName || "Attention";
      const count = document.createElement("span");
      count.className = "attention-count";
      count.textContent = items.length + " pending";
      heading.append(title, count);
      attentionPanel.append(heading);
      for (const item of items.slice(0, 5)) {
        const row = document.createElement("div");
        row.className = "attention-item";
        const body = document.createElement("div");
        const itemTitle = document.createElement("div");
        itemTitle.className = "attention-title";
        itemTitle.textContent = attentionTypeLabel(item.type) + ": " + (item.text || item.requestId || item.id);
        const meta = document.createElement("div");
        meta.className = "attention-meta";
        meta.textContent = [item.agentLabel || item.agentId, item.requestId].filter(Boolean).join(" / ");
        body.append(itemTitle, meta);
        const ack = document.createElement("button");
        ack.type = "button";
        ack.textContent = "Done";
        ack.addEventListener("click", () => {
          ack.disabled = true;
          ackAttention(item.id).catch(() => {
            ack.disabled = false;
            setStatus("Action failed", "offline");
          });
        });
        row.append(body, ack);
        attentionPanel.append(row);
      }
    }

    async function refreshAttention() {
      const response = await fetch("/api/attention?" + qs({ sessionId: BOOTSTRAP.sessionId }), { headers: authHeaders() });
      if (response.status === 401) {
        attentionPanel.hidden = true;
        return;
      }
      if (!response.ok) throw new Error(await response.text());
      renderAttention(await response.json());
    }

    async function poll() {
      try {
        const response = await fetch("/api/events?" + qs({
          sessionId: BOOTSTRAP.sessionId,
          after
        }), { headers: authHeaders() });
        if (response.status === 401) {
          setStatus("Auth required", "offline");
          return;
        }
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        for (const event of data.events || []) {
          after = Math.max(after, Number(event.seq) || after);
          renderEvent(event);
        }
        await refreshAttention();
        setStatus(data.events && data.events.length ? "Updated" : "Connected", data.events && data.events.length ? "busy" : "connected");
      } catch (error) {
        setStatus("Offline", "offline");
      } finally {
        setTimeout(poll, 1500);
      }
    }

    replyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = reply.value.trim();
      if (!text) return;
      if (!target.value) {
        setStatus("Choose target", "offline");
        return;
      }
      reply.value = "";
      autoSizeReply();
      sendButton.disabled = true;
      try {
        await postMessage({ type: "text", text, targetAgentId: target.value });
        setStatus("Sent", "success");
      } catch (error) {
        reply.value = text;
        autoSizeReply();
        setStatus("Send failed", "offline");
      } finally {
        syncControls();
      }
    });

    for (const button of contextButtons) {
      button.addEventListener("click", () => {
        const scope = button.dataset.scope || "session";
        setOfflineHelpOpen(false);
        setSwitcherOpen(contextSwitcher.hidden || switcherScope !== scope, scope);
      });
      button.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        button.click();
      });
    }

    statusEl.addEventListener("click", (event) => {
      if (statusEl.dataset.help !== "available") return;
      event.stopPropagation();
      setSwitcherOpen(false);
      setOfflineHelpOpen(offlineHelp.hidden);
    });

    document.addEventListener("click", (event) => {
      if (!offlineHelp.hidden && !statusEl.contains(event.target) && !offlineHelp.contains(event.target)) {
        setOfflineHelpOpen(false);
      }
      if (!contextSwitcher.hidden && !contextButtons.some((button) => button.contains(event.target)) && !contextSwitcher.contains(event.target)) {
        setSwitcherOpen(false);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      setSwitcherOpen(false);
      setOfflineHelpOpen(false);
    });

    target.addEventListener("change", () => {
      if (target.value) selectAgent(target.value, false);
      else {
        activeContextKey = "";
        selectedProjectKey = "";
        syncControls();
      }
    });
    reply.addEventListener("input", autoSizeReply);
    autoSizeReply();
    refreshTargets();
    renderContextSwitcher();
    syncControls();
    poll();
  </script>
</body>
</html>`;
}

function pairPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Legax Relay Pairing</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #eef2f7;
      --surface: #ffffff;
      --text: #111827;
      --muted: #667085;
      --border: #d7dee8;
      --accent: #2563eb;
      --danger: #b91c1c;
      --shadow: 0 18px 44px rgba(31, 41, 55, 0.12);
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      background: var(--bg);
      color: var(--text);
      font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 20px;
    }
    main {
      width: min(420px, 100%);
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
      box-shadow: var(--shadow);
      padding: 22px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 22px;
      line-height: 1.25;
    }
    p {
      margin: 0 0 18px;
      color: var(--muted);
    }
    label {
      display: grid;
      gap: 8px;
      font-weight: 700;
    }
    input {
      width: 100%;
      min-height: 48px;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0 14px;
      font: inherit;
      letter-spacing: 0;
      background: transparent;
      color: var(--text);
    }
    button {
      width: 100%;
      min-height: 48px;
      margin-top: 12px;
      border: 1px solid var(--accent);
      border-radius: 10px;
      background: var(--accent);
      color: white;
      font: inherit;
      font-weight: 750;
      cursor: pointer;
    }
    .status {
      min-height: 24px;
      margin-top: 12px;
      color: var(--muted);
      font-size: 14px;
    }
    .status[data-state="error"] { color: var(--danger); }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f131a;
        --surface: #181f2a;
        --text: #f8fafc;
        --muted: #a9b4c5;
        --border: #2d3848;
        --shadow: 0 18px 44px rgba(0, 0, 0, 0.35);
      }
    }
  </style>
</head>
<body>
  <main>
    <h1>Pair this browser</h1>
    <p>Run <code>npm run daemon:pair</code> on the desktop, then enter the one-time pairing code shown there.</p>
    <form id="pair-form">
      <label>
        Pairing code
        <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6,8}" required autofocus>
      </label>
      <button type="submit">Pair browser</button>
      <div id="status" class="status" aria-live="polite"></div>
    </form>
  </main>
  <script>
    const hashCode = new URLSearchParams(window.location.hash.slice(1)).get("pair") || "";
    const codeInput = document.getElementById("code");
    const statusEl = document.getElementById("status");
    let pairingOffer = null;
    function parsePairPayload(value) {
      if (/^\\d{6,8}$/.test(value)) return { code: value };
      const parts = value.split(".");
      if (parts.length === 6 && parts[0] === "v1") {
        const encodedSession = decodeURIComponent(parts[5]);
        const paddedSession = encodedSession + "=".repeat((4 - encodedSession.length % 4) % 4);
        return {
          offer: {
            type: "legax.pairing.offer",
            v: 1,
            pairingId: decodeURIComponent(parts[1]),
            pairingSecret: decodeURIComponent(parts[2]),
            daemonPublicKey: decodeURIComponent(parts[3]),
            nonce: decodeURIComponent(parts[4]),
            sessionId: atob(paddedSession.replace(/-/g, "+").replace(/_/g, "/"))
          }
        };
      }
      return { code: value };
    }
    async function browserPublicKey() {
      if (!window.crypto || !window.crypto.subtle) return null;
      try {
        const keyPair = await window.crypto.subtle.generateKey(
          { name: "ECDH", namedCurve: "P-256" },
          true,
          ["deriveBits"]
        );
        return await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
      } catch {
        return null;
      }
    }
    if (hashCode) {
      const parsed = parsePairPayload(hashCode);
      pairingOffer = parsed.offer || null;
      codeInput.value = pairingOffer?.pairingSecret || parsed.code || "";
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
    document.getElementById("pair-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      statusEl.dataset.state = "";
      statusEl.textContent = "Pairing...";
      try {
        const response = await fetch("/api/pair", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code: pairingOffer ? undefined : codeInput.value.trim(),
            pairingOffer,
            label: navigator.userAgent.slice(0, 80),
            devicePublicKey: await browserPublicKey()
          })
        });
        if (!response.ok) throw new Error(await response.text());
        window.location.assign("/");
      } catch {
        statusEl.dataset.state = "error";
        statusEl.textContent = "Pairing failed. Check the code and try again.";
      }
    });
  </script>
</body>
</html>`;
}

function publicDevice(device) {
  return {
    id: device.id,
    label: device.label || "Browser",
    sessionId: device.sessionId || DEFAULT_SESSION,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt || "",
    revokedAt: device.revokedAt || ""
  };
}

function randomProtocolKey(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function createPairingCode(store, body) {
  const generated = !body.code;
  const code = String(body.code || crypto.randomInt(0, 1_000_000).toString().padStart(6, "0"));
  if (!PAIRING_CODE_PATTERN.test(code)) {
    const error = new Error("pairing code must be 6 to 8 digits");
    error.statusCode = 400;
    throw error;
  }
  const [sessionId] = getSession(store, body.sessionId);
  const ttl = Math.max(30_000, Math.min(Number(body.expiresInMs || PAIRING_CODE_TTL_MS), 15 * 60 * 1000));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl).toISOString();
  const codeHash = hashPairingCode(code);
  const record = {
    id: `pair_${crypto.randomBytes(12).toString("base64url")}`,
    codeHash,
    sessionId,
    label: String(body.label || "Pairing code").slice(0, 120),
    daemonPublicKey: String(body.daemonPublicKey || randomProtocolKey()).slice(0, 160),
    nonce: String(body.nonce || randomProtocolKey(16)).slice(0, 80),
    features: ["browser_pairing", "attention_inbox", "relay_messages"],
    createdAt: now.toISOString(),
    expiresAt,
    usedAt: "",
    attempts: 0
  };
  store.pairingCodes[codeHash] = record;
  return { record, code, generated, offer: pairingOfferFromRecord(record, code, body.relayUrl) };
}

function createTwaLaunchToken(store, body) {
  const [sessionId] = getSession(store, body.sessionId);
  const ttl = Math.max(30_000, Math.min(Number(body.expiresInMs || 300000), 15 * 60 * 1000));
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const record = {
    id: `twa_${crypto.randomBytes(10).toString("base64url")}`,
    tokenHash: hashTwaLaunchToken(token),
    sessionId,
    agentId: String(body.agentId || "").trim(),
    agentLabel: String(body.agentLabel || body.agentId || "CLI").slice(0, 120),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl).toISOString()
  };
  if (!record.agentId) {
    const error = new Error("agentId is required");
    error.statusCode = 400;
    throw error;
  }
  store.twaLaunchTokens[record.tokenHash] = record;
  return { token, record };
}

function validateTwaLaunchToken(store, token) {
  const value = String(token || "").trim();
  if (!value) return null;
  const record = store.twaLaunchTokens[hashTwaLaunchToken(value)];
  if (!record) return null;
  if (Date.parse(record.expiresAt) <= Date.now()) return null;
  return record;
}

function twaRequestId() {
  return `twa_${crypto.randomBytes(12).toString("base64url")}`;
}

function twaNewProjectPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Open project</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; padding: 18px; background: Canvas; color: CanvasText; }
    header { margin-bottom: 16px; }
    h1 { margin: 0 0 4px; font-size: 20px; line-height: 1.2; }
    .muted { color: color-mix(in srgb, CanvasText 62%, Canvas); font-size: 13px; }
    .panel { border: 1px solid color-mix(in srgb, CanvasText 16%, Canvas); border-radius: 8px; overflow: hidden; }
    button { width: 100%; min-height: 44px; border: 0; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, Canvas); background: transparent; color: inherit; text-align: left; padding: 12px 14px; font: inherit; }
    button:last-child { border-bottom: 0; }
    .primary { margin-top: 16px; border-radius: 8px; background: #1677ff; color: #fff; text-align: center; font-weight: 650; }
    .toolbar { display: flex; gap: 8px; margin: 12px 0; }
    .toolbar button { width: auto; border: 1px solid color-mix(in srgb, CanvasText 16%, Canvas); border-radius: 8px; }
    #roots { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    #roots button { width: auto; border: 1px solid color-mix(in srgb, CanvasText 16%, Canvas); border-radius: 8px; }
    #status { margin: 12px 0; white-space: pre-wrap; }
  </style>
</head>
<body>
  <header>
    <h1>Open project</h1>
    <div id="context" class="muted">Loading...</div>
  </header>
  <div class="toolbar"><button id="up" type="button">Back</button><button id="retry" type="button">Retry</button></div>
  <div id="roots"></div>
  <div id="status" class="muted"></div>
  <div id="list" class="panel"></div>
  <button id="open" class="primary" type="button" disabled>Open this folder</button>
  <script>
    const token = new URLSearchParams(location.search).get("token") || "";
    let current = { rootId: "root-1", relativePath: "" };
    let selected = "";
    const context = document.getElementById("context");
    const statusEl = document.getElementById("status");
    const rootsEl = document.getElementById("roots");
    const list = document.getElementById("list");
    const open = document.getElementById("open");
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    async function json(url, options = {}) {
      const response = await fetch(url, options);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || response.statusText);
      return body;
    }
    async function responseFor(requestId) {
      for (let i = 0; i < 50; i += 1) {
        const body = await fetch("/api/twa/responses/" + encodeURIComponent(requestId) + "?token=" + encodeURIComponent(token));
        if (body.status === 404) {
          await sleep(250);
          continue;
        }
        const data = await body.json();
        if (!body.ok || data.ok === false) throw new Error(data.error || body.statusText);
        return data.response;
      }
      throw new Error("Daemon did not respond in time.");
    }
    async function load(relativePath = current.relativePath) {
      statusEl.textContent = "Loading folders...";
      const queued = await json("/api/twa/project-children", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, rootId: current.rootId, relativePath })
      });
      const response = await responseFor(queued.requestId);
      if (response.ok === false) throw new Error(response.error);
      current = { rootId: response.root.id, relativePath: response.relativePath || "" };
      selected = current.relativePath;
      context.textContent = response.root.label + (current.relativePath ? " / " + current.relativePath : "");
      renderRoots(response.roots || []);
      list.replaceChildren();
      for (const entry of response.entries || []) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = entry.name;
        button.addEventListener("click", () => load(entry.path));
        list.append(button);
      }
      if (!list.children.length) {
        const empty = document.createElement("button");
        empty.type = "button";
        empty.disabled = true;
        empty.textContent = "No child folders";
        list.append(empty);
      }
      open.disabled = false;
      statusEl.textContent = "";
    }
    function renderRoots(roots) {
      rootsEl.replaceChildren();
      if (roots.length <= 1) return;
      for (const root of roots) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = root.label;
        button.disabled = root.id === current.rootId;
        button.addEventListener("click", () => {
          current = { rootId: root.id, relativePath: "" };
          load("").catch((error) => statusEl.textContent = error.message);
        });
        rootsEl.append(button);
      }
    }
    async function bootstrap() {
      const data = await json("/api/twa/bootstrap?token=" + encodeURIComponent(token));
      context.textContent = data.agentLabel + " / New project";
      await load("");
    }
    document.getElementById("retry").addEventListener("click", () => load().catch((error) => statusEl.textContent = error.message));
    document.getElementById("up").addEventListener("click", () => {
      const parts = current.relativePath.split("/").filter(Boolean);
      parts.pop();
      load(parts.join("/")).catch((error) => statusEl.textContent = error.message);
    });
    open.addEventListener("click", async () => {
      try {
        statusEl.textContent = "Opening project...";
        const queued = await json("/api/twa/open-project", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, rootId: current.rootId, relativePath: selected })
        });
        const response = await responseFor(queued.requestId);
        if (response.ok === false) throw new Error(response.error);
        statusEl.textContent = "Project opened. You can return to Telegram.";
      } catch (error) {
        statusEl.textContent = error.message;
      }
    });
    bootstrap().catch((error) => {
      context.textContent = "Project picker unavailable";
      statusEl.textContent = error.message;
    });
  </script>
</body>
</html>`;
}

function pairingOfferFromRecord(record, code, relayUrl = "") {
  return {
    type: "legax.pairing.offer",
    v: 1,
    relayUrl: String(relayUrl || ""),
    sessionId: record.sessionId,
    pairingId: record.id,
    pairingSecret: code,
    daemonPublicKey: record.daemonPublicKey,
    nonce: record.nonce,
    expiresAt: record.expiresAt,
    features: record.features ?? ["browser_pairing", "attention_inbox", "relay_messages"]
  };
}

function pairingSecretFromBody(body) {
  if (body.pairingOffer && typeof body.pairingOffer === "object") {
    return {
      code: String(body.pairingOffer.pairingSecret || "").trim(),
      pairingId: String(body.pairingOffer.pairingId || "").trim(),
      protocolVersion: Number(body.pairingOffer.v || 1)
    };
  }
  return {
    code: String(body.code || "").trim(),
    pairingId: "",
    protocolVersion: 0
  };
}

function pairDevice(store, req, body) {
  const { code, pairingId, protocolVersion } = pairingSecretFromBody(body);
  if (!PAIRING_CODE_PATTERN.test(code)) {
    const error = new Error("invalid pairing code");
    error.statusCode = 401;
    throw error;
  }
  const codeHash = hashPairingCode(code);
  const pairing = store.pairingCodes[codeHash];
  if (!pairing || (pairingId && pairing.id !== pairingId) || pairing.usedAt || Date.parse(pairing.expiresAt) <= Date.now()) {
    if (pairing) pairing.attempts = Number(pairing.attempts || 0) + 1;
    const error = new Error("invalid or expired pairing code");
    error.statusCode = 401;
    throw error;
  }
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(DEVICE_TOKEN_BYTES).toString("base64url");
  const now = new Date().toISOString();
  const userAgent = String(req.headers["user-agent"] || "");
  const label = String(body.label || userAgent || "Browser").slice(0, 120);
  const device = {
    id,
    tokenHash: hashDeviceToken(token),
    label,
    sessionId: pairing.sessionId || DEFAULT_SESSION,
    createdAt: now,
    lastSeenAt: now,
    userAgent: userAgent.slice(0, 200),
    pairingId: pairing.id,
    protocolVersion,
    daemonPublicKey: pairing.daemonPublicKey || "",
    devicePublicKey: body.devicePublicKey ?? null,
    features: pairing.features ?? [],
    revokedAt: ""
  };
  pairing.usedAt = now;
  store.devices[id] = device;
  return { device, cookieToken: `${id}.${token}` };
}

function attentionType(event) {
  if (event.kind === "permission_request" || event.kind === "approval_request") return "approval";
  if (event.kind === "input_request" || event.kind === "user_input_request") return "input";
  if (event.kind === "error") return "error";
  if (event.kind === "status" && event.metadata?.severity === "error") return "error";
  if (event.kind === "agent_summary" || event.kind === "completion" || event.metadata?.status === "completed") return "completion";
  return "";
}

function attentionPriority(type) {
  if (type === "approval" || type === "input" || type === "error") return "high";
  return "normal";
}

function attentionId(event, type) {
  const requestId = event.metadata?.requestId ?? event.requestId ?? "";
  if (requestId) return `${type}:${requestId}`;
  return `${type}:event:${event.seq ?? event.id}`;
}

function activeContextFromSession(session) {
  const event = [...session.events].reverse().find((candidate) => candidate.kind === "active_context");
  if (!event) return null;
  return {
    sessionId: event.sessionId,
    agentId: event.agentId ?? "",
    agentLabel: event.agentLabel ?? "",
    cliName: event.metadata?.cliName ?? event.agentLabel ?? "",
    projectName: event.metadata?.projectName ?? event.metadata?.cwd ?? "",
    sessionName: event.metadata?.sessionName ?? event.metadata?.threadTitle ?? event.text ?? "",
    eventSeq: event.seq,
    updatedAt: event.createdAt
  };
}

function attentionAckSet(store, deviceId, sessionId) {
  return new Set(Object.keys(store.attentionAcks?.[deviceId]?.[sessionId] ?? {}));
}

function attentionItems(store, device, sessionId, session) {
  const acked = device ? attentionAckSet(store, device.id, sessionId) : new Set();
  return session.events
    .map((event) => {
      const type = attentionType(event);
      if (!type) return null;
      const id = attentionId(event, type);
      if (acked.has(id)) return null;
      return {
        id,
        type,
        priority: attentionPriority(type),
        sessionId,
        agentId: event.agentId ?? "",
        agentLabel: event.agentLabel ?? "",
        requestId: event.metadata?.requestId ?? event.requestId ?? "",
        eventId: event.id ?? "",
        eventSeq: event.seq ?? 0,
        text: event.text ?? "",
        metadata: event.metadata ?? {},
        createdAt: event.createdAt ?? ""
      };
    })
    .filter(Boolean);
}

function ackAttentionItems(store, deviceId, sessionId, ids) {
  store.attentionAcks[deviceId] ??= {};
  store.attentionAcks[deviceId][sessionId] ??= {};
  const now = new Date().toISOString();
  for (const id of ids) {
    const value = String(id || "").trim();
    if (value) store.attentionAcks[deviceId][sessionId][value] = now;
  }
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/healthz")) {
    sendJson(res, 200, { ok: true, service: "legax-relay" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/twa/launch-tokens") {
    if (!requireDesktop(req, url)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const body = await readJsonBody(req);
    const store = loadStore();
    const { token, record } = createTwaLaunchToken(store, body);
    saveStore(store);
    sendJson(res, 200, {
      ok: true,
      token,
      sessionId: record.sessionId,
      agentId: record.agentId,
      expiresAt: record.expiresAt
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/twa/bootstrap") {
    const store = loadStore();
    const token = validateTwaLaunchToken(store, url.searchParams.get("token"));
    if (!token) {
      sendJson(res, 401, { ok: false, error: "invalid or expired TWA launch token" });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      sessionId: token.sessionId,
      agentId: token.agentId,
      agentLabel: token.agentLabel,
      expiresAt: token.expiresAt
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/twa/project-children") {
    const body = await readJsonBody(req);
    const store = loadStore();
    const token = validateTwaLaunchToken(store, body.token);
    if (!token) {
      sendJson(res, 401, { ok: false, error: "invalid or expired TWA launch token" });
      return;
    }
    const [sessionId, session] = getSession(store, token.sessionId);
    const requestId = twaRequestId();
    const message = normalizeMessage({
      type: "control",
      action: "list_project_children",
      targetAgentId: "legax-daemon",
      selectedAgentId: token.agentId,
      requestId,
      rootId: body.rootId,
      relativePath: body.relativePath ?? ""
    }, sessionId, session.nextMessageSeq++);
    boundedPush(session.messages, message);
    saveStore(store);
    appendAudit("phone->desktop", message);
    sendJson(res, 200, { ok: true, requestId });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/twa/open-project") {
    const body = await readJsonBody(req);
    const store = loadStore();
    const token = validateTwaLaunchToken(store, body.token);
    if (!token) {
      sendJson(res, 401, { ok: false, error: "invalid or expired TWA launch token" });
      return;
    }
    const [sessionId, session] = getSession(store, token.sessionId);
    const requestId = twaRequestId();
    const message = normalizeMessage({
      type: "control",
      action: "open_project",
      targetAgentId: "legax-daemon",
      selectedAgentId: token.agentId,
      requestId,
      rootId: body.rootId,
      relativePath: body.relativePath ?? "",
      projectPath: body.projectPath ?? ""
    }, sessionId, session.nextMessageSeq++);
    boundedPush(session.messages, message);
    saveStore(store);
    appendAudit("phone->desktop", message);
    sendJson(res, 200, { ok: true, requestId });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/twa/responses/")) {
    const requestId = decodeURIComponent(url.pathname.slice("/api/twa/responses/".length));
    const store = loadStore();
    const token = validateTwaLaunchToken(store, url.searchParams.get("token"));
    if (!token) {
      sendJson(res, 401, { ok: false, error: "invalid or expired TWA launch token" });
      return;
    }
    const [, session] = getSession(store, token.sessionId);
    const event = [...session.events].reverse().find((item) => item.metadata?.twaRequestId === requestId);
    if (!event) {
      sendJson(res, 404, { ok: false, error: "response not ready" });
      return;
    }
    sendJson(res, 200, { ok: true, response: event.metadata, event });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pairing-codes") {
    if (!requireDesktop(req, url)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const body = await readJsonBody(req);
    const store = loadStore();
    const { record, code, generated, offer } = createPairingCode(store, {
      ...body,
      relayUrl: originFromRequest(req, url)
    });
    const pairingOffer = {
      ...offer,
      relayUrl: originFromRequest(req, url)
    };
    const qrPayload = pairingQrPayload(req, url, pairingOffer);
    saveStore(store);
    sendJson(res, 200, {
      ok: true,
      id: record.id,
      sessionId: record.sessionId,
      expiresAt: record.expiresAt,
      pairingOffer,
      pairUrl: qrPayload.pairUrl,
      qrSvg: qrPayload.qrSvg,
      qrTerminal: qrPayload.qrTerminal,
      ...(generated ? { code } : {})
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pair") {
    const body = await readJsonBody(req);
    const store = loadStore();
    try {
      const { device, cookieToken } = pairDevice(store, req, body);
      saveStore(store);
      sendJson(res, 200, { ok: true, device: publicDevice(device) }, {
        "set-cookie": deviceCookie(cookieToken, req)
      });
    } catch (error) {
      saveStore(store);
      sendJson(res, error.statusCode || 401, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    sendJson(res, 200, { ok: true }, {
      "set-cookie": clearDeviceCookie(req)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/devices") {
    if (!requireDesktop(req, url)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const store = loadStore();
    const devices = Object.values(store.devices)
      .filter((device) => !device.revokedAt)
      .map(publicDevice)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    sendJson(res, 200, { ok: true, devices });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/devices/")) {
    if (!requireDesktop(req, url)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const deviceId = decodeURIComponent(url.pathname.slice("/api/devices/".length));
    const store = loadStore();
    const device = store.devices[deviceId];
    if (!device) {
      sendJson(res, 404, { ok: false, error: "device not found" });
      return;
    }
    device.revokedAt = new Date().toISOString();
    saveStore(store);
    sendJson(res, 200, { ok: true, device: publicDevice(device) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/events") {
    if (!requireDesktop(req, url)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const body = await readJsonBody(req);
    const store = loadStore();
    const [sessionId, session] = getSession(store, body.sessionId);
    const event = normalizeEvent(body, sessionId, session.nextEventSeq++);
    boundedPush(session.events, event);
    saveStore(store);
    appendAudit("desktop->phone", event);
    sendJson(res, 200, { ok: true, event });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    const store = loadStore();
    const [sessionId, session] = getSession(store, url.searchParams.get("sessionId"));
    if (!requirePhoneForSession(req, url, sessionId)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const after = Number(url.searchParams.get("after") ?? 0);
    const agentId = url.searchParams.get("agentId");
    const taskId = url.searchParams.get("taskId");
    const events = session.events
      .filter((event) => Number(event.seq) > after)
      .filter((event) => eventMatchesAgent(event, agentId, taskId));
    sendJson(res, 200, { ok: true, sessionId, events });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/agents") {
    const store = loadStore();
    const [sessionId, session] = getSession(store, url.searchParams.get("sessionId"));
    if (!requirePhoneForSession(req, url, sessionId)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    sendJson(res, 200, { ok: true, sessionId, agents: sessionAgents(session) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/attention") {
    const store = loadStore();
    const [sessionId, session] = getSession(store, url.searchParams.get("sessionId"));
    const device = validateDeviceCookie(req, sessionId);
    if (!(ALLOW_INSECURE_DEV && !DESKTOP_SECRET) && !device) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      sessionId,
      activeContext: activeContextFromSession(session),
      items: attentionItems(store, device, sessionId, session)
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/attention/ack") {
    const body = await readJsonBody(req);
    const requestedSessionId = isValidSessionId(body.sessionId) ? body.sessionId : DEFAULT_SESSION;
    const device = validateDeviceCookie(req, requestedSessionId);
    if (!(ALLOW_INSECURE_DEV && !DESKTOP_SECRET) && !device) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const store = loadStore();
    const [sessionId] = getSession(store, requestedSessionId);
    ackAttentionItems(store, device?.id ?? "insecure-dev", sessionId, Array.isArray(body.ids) ? body.ids : []);
    saveStore(store);
    sendJson(res, 200, { ok: true, sessionId });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/messages") {
    const body = await readJsonBody(req);
    const requestedSessionId = isValidSessionId(body.sessionId) ? body.sessionId : DEFAULT_SESSION;
    if (!requirePhoneForSession(req, url, requestedSessionId)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const store = loadStore();
    const [sessionId, session] = getSession(store, body.sessionId);
    const message = normalizeMessage(body, sessionId, session.nextMessageSeq++);
    boundedPush(session.messages, message);
    saveStore(store);
    appendAudit("phone->desktop", message);
    sendJson(res, 200, { ok: true, message });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/audit") {
    if (!requireDesktop(req, url)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const limit = url.searchParams.get("limit") ?? 200;
    sendJson(res, 200, { ok: true, entries: readAuditTail(limit), path: AUDIT_LOG_PATH });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/messages") {
    if (!requireDesktop(req, url)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const store = loadStore();
    const [sessionId, session] = getSession(store, url.searchParams.get("sessionId"));
    const after = Number(url.searchParams.get("after") ?? 0);
    const agentId = url.searchParams.get("agentId");
    const taskId = url.searchParams.get("taskId");
    const messages = session.messages
      .filter((message) => Number(message.seq) > after)
      .filter((message) => messageMatchesTarget(message, agentId, taskId));
    sendJson(res, 200, { ok: true, sessionId, messages });
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    if (requirePhoneForSession(req, url, DEFAULT_SESSION)) {
      sendHtml(res, mobilePage(DEFAULT_SESSION));
    } else {
      sendHtml(res, pairPage());
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/twa/new-project") {
    sendHtml(res, twaNewProjectPage());
    return;
  }

  sendJson(res, 404, { ok: false, error: "not found" });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(res, status, { ok: false, error: error.message });
  });
});

server.listen(PORT, HOST, () => {
  const shownHost = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
  console.error(`Legax relay listening on http://${shownHost}:${PORT}`);
  console.error(`Web URL: http://${shownHost}:${PORT}/`);
  console.error("Pair from the daemon with: npm run daemon:pair");
});
