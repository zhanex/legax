#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

import { ADAPTERS } from "./lib/adapter-contract.mjs";
import {
  defaultConfigPath,
  packageAssetPath,
  packageRoot,
  resolveConfigPath
} from "./lib/paths.mjs";
import { readYaml } from "./lib/yaml.mjs";
import {
  archiveWorktree,
  createWorktree,
  listWorktrees,
  runWorktreeCheck
} from "./lib/worktree-lite.mjs";
import { relayDoctor, relayInit } from "./relay-setup.mjs";

function optionValue(args, name, fallback = "") {
  const prefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) return args[index + 1] ?? fallback;
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return fallback;
}

function hasOption(args, name) {
  return args.includes(name);
}

function removeOption(args, name) {
  const next = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) {
      index += 1;
      continue;
    }
    if (arg.startsWith(`${name}=`)) continue;
    next.push(arg);
  }
  return next;
}

function configPathFromArgs(args) {
  const configured = optionValue(args, "--config") || process.env.LEGAX_CONFIG || "";
  return configured ? resolveConfigPath(configured) : defaultConfigPath();
}

function writeOutput(body, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${body.message ?? JSON.stringify(body)}\n`);
}

function randomSecret() {
  return crypto.randomBytes(32).toString("base64url");
}

function packageVersion() {
  try {
    return JSON.parse(fs.readFileSync(packageAssetPath("package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function initConfig(args) {
  const configPath = configPathFromArgs(args);
  const force = hasOption(args, "--force");
  const json = hasOption(args, "--json");
  if (fs.existsSync(configPath) && !force) {
    process.stderr.write(`config already exists: ${configPath}\n`);
    process.exit(1);
  }
  const examplePath = packageAssetPath("config.example.yaml");
  let body = fs.readFileSync(examplePath, "utf8");
  const secret = optionValue(args, "--relay-secret") || randomSecret();
  body = body.replaceAll("replace-with-a-long-random-secret", secret);
  body = body.replaceAll("replace-with-a-long-webhook-secret", randomSecret());
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, body, "utf8");
  writeOutput({ ok: true, configPath, message: `Created config: ${configPath}` }, json);
}

function firstRelayTransport(config) {
  const transports = Array.isArray(config.transports) ? config.transports : [];
  return transports.find((transport) => transport?.type === "relay" && transport.enabled !== false && transport.baseUrl) ?? null;
}

async function doctor(args) {
  const json = hasOption(args, "--json");
  const offline = hasOption(args, "--offline");
  const configPath = configPathFromArgs(args);
  const checks = [];
  const add = (name, status, detail = {}) => checks.push({ name, status, ...detail });

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  add("node.version", nodeMajor >= 18 ? "ok" : "error", { version: process.versions.node });

  let config = {};
  if (!fs.existsSync(configPath)) {
    add("config.file", "error", { path: configPath, message: "config file not found" });
  } else {
    try {
      config = readYaml(configPath) ?? {};
      add("config.file", "ok", { path: configPath });
    } catch (error) {
      add("config.file", "error", { path: configPath, message: error.message });
    }
  }

  const relay = firstRelayTransport(config);
  if (!relay) {
    add("relay.transport", "skipped", { message: "no enabled relay transport" });
  } else {
    add("relay.transport", relay.secret ? "ok" : "error", {
      baseUrl: relay.baseUrl,
      secret: relay.secret ? "configured" : "MISSING"
    });
    if (offline) {
      add("relay.health", "skipped", { message: "offline mode" });
    } else {
      await checkRelayHealth(relay, add);
    }
  }

  checkTelegram(config, add);
  checkFeishu(config, add);
  checkAdapters(config, add);

  const ok = checks.every((check) => check.status !== "error");
  const body = { ok, configPath, checks };
  if (json) {
    process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
  } else {
    for (const check of checks) {
      process.stdout.write(`${check.status.toUpperCase().padEnd(7)} ${check.name}${check.message ? ` - ${check.message}` : ""}\n`);
    }
  }
  process.exit(ok ? 0 : 1);
}

async function checkRelayHealth(relay, add) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(relay.timeoutMs ?? 15000));
  try {
    const response = await fetch(new URL("/health", relay.baseUrl), { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    add("relay.health", response.ok && body.ok ? "ok" : "error", {
      statusCode: response.status,
      service: body.service ?? ""
    });
  } catch (error) {
    add("relay.health", "error", { message: error.message });
  } finally {
    clearTimeout(timeout);
  }
}

function checkTelegram(config, add) {
  const transports = Array.isArray(config.transports) ? config.transports : [];
  const telegram = transports.filter((transport) => transport?.type === "telegram" && transport.enabled !== false);
  if (telegram.length === 0) {
    add("telegram.transport", "skipped", { message: "no enabled Telegram transport" });
    return;
  }
  for (const [index, transport] of telegram.entries()) {
    const chatMissing = transport.chatId === undefined || transport.chatId === null || transport.chatId === 0 || transport.chatId === "0" || transport.chatId === "";
    add(`telegram.transport.${index + 1}`, transport.botToken && !chatMissing ? "ok" : "error", {
      botToken: transport.botToken ? "configured" : "MISSING",
      chatId: chatMissing ? "MISSING" : "configured"
    });
  }
}

function checkFeishu(config, add) {
  const transports = Array.isArray(config.transports) ? config.transports : [];
  const feishu = transports.filter((transport) => transport?.type === "feishu" && transport.enabled !== false);
  if (feishu.length === 0) {
    add("feishu.transport", "skipped", { message: "no enabled Feishu/Lark transport" });
    return;
  }
  for (const [index, transport] of feishu.entries()) {
    const receiveId = transport.receiveId ?? transport.chatId ?? transport.openId ?? transport.userId ?? transport.unionId ?? transport.email;
    const hasWebhook = Boolean(transport.webhookUrl ?? transport.botWebhookUrl);
    const hasAppCredentials = Boolean((transport.appId ?? transport.app_id) && (transport.appSecret ?? transport.app_secret));
    const ok = hasWebhook || (hasAppCredentials && receiveId && transport.verificationToken);
    add(`feishu.transport.${index + 1}`, ok ? "ok" : "error", {
      appId: (transport.appId ?? transport.app_id) ? "configured" : "MISSING",
      appSecret: (transport.appSecret ?? transport.app_secret) ? "configured" : "MISSING",
      receiveId: receiveId ? "configured" : "MISSING",
      verificationToken: transport.verificationToken ? "configured" : "MISSING",
      webhookUrl: hasWebhook ? "configured" : "not configured"
    });
  }
}

function adapterEnabled(config, adapter) {
  const settings = config[adapter.key] ?? {};
  if (Object.prototype.hasOwnProperty.call(settings, "enabled")) return settings.enabled !== false;
  return adapter.defaultEnabled !== false;
}

function checkAdapters(config, add) {
  for (const adapter of ADAPTERS) {
    if (!adapterEnabled(config, adapter)) {
      add(`adapter.${adapter.defaultAgentId}.command`, "skipped", { message: "adapter disabled" });
      continue;
    }
    const settings = config[adapter.key] ?? {};
    const command = String(settings.command ?? adapter.key);
    const agentId = String(settings.agentId ?? adapter.defaultAgentId);
    const resolved = resolveCommand(command);
    add(`adapter.${agentId}.command`, resolved ? "ok" : "error", {
      command,
      resolved: resolved || "MISSING"
    });
  }
}

function resolveCommand(command) {
  if (!command) return "";
  if (path.isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return fs.existsSync(command) ? command : "";
  }
  const result = process.platform === "win32"
    ? spawnSync("where.exe", [command], { encoding: "utf8", windowsHide: true })
    : spawnSync("sh", ["-lc", `command -v ${JSON.stringify(command)}`], { encoding: "utf8" });
  if (result.status !== 0) return "";
  return result.stdout.split(/\r?\n/).find(Boolean) ?? "";
}

function commandAfterSeparator(args) {
  const index = args.indexOf("--");
  return index >= 0 ? args.slice(index + 1) : [];
}

function worktree(args) {
  const subcommand = args[0] ?? "";
  const json = hasOption(args, "--json");
  try {
    if (subcommand === "list") {
      writeOutput({ ok: true, worktrees: listWorktrees({ cwd: packageRoot }) }, json);
      return;
    }
    if (subcommand === "create") {
      writeOutput(createWorktree({
        cwd: packageRoot,
        name: optionValue(args, "--name"),
        base: optionValue(args, "--base", "HEAD")
      }), json);
      return;
    }
    if (subcommand === "archive") {
      writeOutput(archiveWorktree({
        cwd: packageRoot,
        name: optionValue(args, "--name"),
        worktreePath: optionValue(args, "--path"),
        deleteBranch: hasOption(args, "--delete-branch")
      }), json);
      return;
    }
    if (subcommand === "check") {
      writeOutput(runWorktreeCheck({
        cwd: packageRoot,
        name: optionValue(args, "--name"),
        worktreePath: optionValue(args, "--path"),
        command: commandAfterSeparator(args)
      }), json);
      return;
    }
    throw new Error("usage: legax worktree <list|create|archive|check>");
  } catch (error) {
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`);
    else process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "--version":
  case "-v":
  case "version":
    process.stdout.write(`${packageVersion()}\n`);
    break;
  case "init":
    initConfig(args);
    break;
  case "doctor":
    await doctor(args);
    break;
  case "daemon": {
    const result = spawnSync(process.execPath, [packageAssetPath("scripts", "daemon-control.mjs"), ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit"
    });
    process.exit(result.status ?? 1);
    break;
  }
  case "relay": {
    if (args[0] === "init") {
      try {
        writeOutput(relayInit(args.slice(1)), hasOption(args, "--json"));
        break;
      } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
      }
    }
    if (args[0] === "doctor") {
      const json = hasOption(args, "--json");
      const configPath = configPathFromArgs(args);
      try {
        const config = fs.existsSync(configPath) ? readYaml(configPath) ?? {} : {};
        const checks = relayDoctor(config);
        const ok = checks.every((check) => check.status !== "error");
        const body = { ok, configPath, checks };
        if (json) process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
        else for (const check of checks) process.stdout.write(`${check.status.toUpperCase().padEnd(8)} ${check.name} - ${check.message}\n`);
        process.exit(ok ? 0 : 1);
      } catch (error) {
        if (json) process.stdout.write(`${JSON.stringify({ ok: false, configPath, error: error.message }, null, 2)}\n`);
        else process.stderr.write(`${error.message}\n`);
        process.exit(1);
      }
    }
    const relayArgs = args[0] === "start" ? args.slice(1) : args;
    if (relayArgs[0] && !String(relayArgs[0]).startsWith("--")) {
      process.stderr.write("usage: legax relay <init|doctor|start> [--config <path>]\n");
      process.exit(2);
    }
    const configOverride = optionValue(relayArgs, "--config");
    const result = spawnSync(process.execPath, [packageAssetPath("scripts", "simple-relay-server.mjs"), ...removeOption(relayArgs, "--config")], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(configOverride ? { LEGAX_CONFIG: resolveConfigPath(configOverride) } : {})
      },
      stdio: "inherit"
    });
    process.exit(result.status ?? 1);
    break;
  }
  case "worktree":
    worktree(args);
    break;
  default:
    process.stderr.write("usage: legax <init|doctor|daemon|relay|worktree>\n");
    process.exit(2);
}
