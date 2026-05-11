import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { defaultDataDir, legaxHome, resolveConfigPath } from "./lib/paths.mjs";

export function optionValue(args, name, fallback = "") {
  const prefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index]);
    if (arg === name) return args[index + 1] ?? fallback;
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return fallback;
}

export function hasOption(args, name) {
  return args.includes(name);
}

function randomSecret() {
  return crypto.randomBytes(32).toString("base64url");
}

function relayHome(env = process.env) {
  return path.join(legaxHome(env), "relay");
}

function normalizePublicBaseUrl(args) {
  const domain = String(optionValue(args, "--domain")).trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (domain) return `https://${domain}`;
  return String(optionValue(args, "--public-base-url", "https://relay.example.com")).trim().replace(/\/+$/, "");
}

function posixPath(value) {
  return String(value).replaceAll("\\", "/");
}

export function relayInit(args, env = process.env) {
  const configPath = optionValue(args, "--config")
    ? resolveConfigPath(optionValue(args, "--config"), env)
    : path.join(legaxHome(env), "relay.config.yaml");
  const dataDir = posixPath(defaultDataDir(env));
  const port = Number(optionValue(args, "--port", "8787"));
  const host = String(optionValue(args, "--host", "127.0.0.1")).trim() || "127.0.0.1";
  const secret = optionValue(args, "--secret") || randomSecret();
  const publicBaseUrl = normalizePublicBaseUrl(args);
  const caddyfilePath = optionValue(args, "--caddyfile")
    ? path.resolve(optionValue(args, "--caddyfile"))
    : path.join(relayHome(env), "Caddyfile");
  const domain = publicBaseUrl.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || "relay.example.com";

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid relay port: ${optionValue(args, "--port", "8787")}`);
  }
  if (fs.existsSync(configPath) && !hasOption(args, "--force")) {
    throw new Error(`relay config already exists: ${configPath}`);
  }
  if (fs.existsSync(caddyfilePath) && !hasOption(args, "--force")) {
    throw new Error(`Caddyfile already exists: ${caddyfilePath}`);
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.mkdirSync(path.dirname(caddyfilePath), { recursive: true });

  const yaml = `sessionId: default
relay:
  host: ${host}
  port: ${port}
  publicBaseUrl: ${publicBaseUrl}
  secret: ${secret}
  storePath: ${dataDir}/relay-store.json
  maxEventsPerSession: 500
  maxMessagesPerSession: 500
  audit:
    enabled: true
    path: ${dataDir}/relay-audit.jsonl
    maxTail: 1000
    textPreview: 80
`;
  fs.writeFileSync(configPath, yaml, "utf8");

  const caddyfile = `${domain} {
  reverse_proxy ${host}:${port}
}
`;
  fs.writeFileSync(caddyfilePath, caddyfile, "utf8");

  const daemonSnippet = `relay:
  publicBaseUrl: ${publicBaseUrl}
transports:
  - name: self-hosted-relay
    type: relay
    enabled: true
    baseUrl: ${publicBaseUrl}
    secret: ${secret}
`;

  return {
    ok: true,
    configPath,
    caddyfilePath,
    publicBaseUrl,
    daemonSnippet,
    message: `Created relay config: ${configPath}`
  };
}

export function relayDoctor(config) {
  const publicBaseUrl = String(config.relay?.publicBaseUrl ?? "").trim();
  const checks = [];
  checks.push({
    name: "relay.publicBaseUrl",
    status: publicBaseUrl.startsWith("https://") ? "ok" : "warning",
    message: publicBaseUrl.startsWith("https://")
      ? "Telegram Mini App new-project flow can use this URL."
      : "Telegram Mini App new-project flow requires relay.publicBaseUrl to be a public https:// URL."
  });
  return checks;
}
