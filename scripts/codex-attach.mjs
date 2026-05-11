#!/usr/bin/env node
// Convenience launcher: read config.yaml, find the codex appServerUrl, and run
// `codex --remote ws://...` so the local TUI shares state with the daemon's
// shared app-server. With both connected to the same backend, codex broadcasts
// thread/turn notifications to all clients — phone-driven turns appear in the
// TUI in real time, and TUI-driven turns are mirrored to the phone via the
// daemon.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readYaml } from "./lib/yaml.mjs";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, "..");

function resolveFromRoot(value) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(pluginRoot, value);
}

function loadConfig() {
  const requested = process.env.LEGAX_CONFIG;
  const configuredPath = requested
    ? resolveFromRoot(requested)
    : path.resolve(pluginRoot, "config.yaml");
  const examplePath = path.resolve(pluginRoot, "config.example.yaml");
  const configPath = fs.existsSync(configuredPath) ? configuredPath : examplePath;
  return { configPath, raw: readYaml(configPath) ?? {} };
}

function pickAppServerUrl(raw) {
  const codex = raw.codex ?? {};
  const url = codex.appServerUrl ?? codex.wsUrl;
  if (!url) {
    throw new Error("could not find codex.appServerUrl in config; set codex.appServerUrl: ws://host:port/path before running this helper");
  }
  return String(url);
}

async function isReachable(url, timeoutMs = 1500) {
  const u = new URL(url);
  if (u.protocol !== "ws:" && u.protocol !== "wss:") return false;
  const net = await import("node:net");
  return await new Promise((resolve) => {
    const sock = net.connect({ host: u.hostname, port: Number(u.port || (u.protocol === "wss:" ? 443 : 80)) });
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, timeoutMs);
    sock.once("connect", () => { clearTimeout(timer); sock.destroy(); resolve(true); });
    sock.once("error", () => { clearTimeout(timer); resolve(false); });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const { configPath, raw } = loadConfig();
  const appServerUrl = pickAppServerUrl(raw);
  process.stderr.write(`[codex-attach] config: ${configPath}\n`);
  process.stderr.write(`[codex-attach] target: ${appServerUrl}\n`);

  const reachable = await isReachable(appServerUrl);

  if (!reachable) {
    process.stderr.write("[codex-attach] WARNING: nothing is listening at the target. Start the daemon first:\n");
    process.stderr.write("[codex-attach]   node scripts/legax-daemon.mjs\n");
    process.stderr.write("[codex-attach] then re-run codex-attach.\n");
    process.exit(2);
  }

  const codex = raw.codex ?? {};
  const command = String(codex.command ?? "codex");
  const childArgs = ["--remote", appServerUrl, ...args];
  process.stderr.write(`[codex-attach] launching: ${command} ${childArgs.join(" ")}\n`);

  const child = spawn(command, childArgs, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  child.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 130 : 0));
  });
  child.on("error", (error) => {
    process.stderr.write(`[codex-attach] failed to spawn ${command}: ${error.message}\n`);
    process.exit(127);
  });
}

main().catch((error) => {
  process.stderr.write(`[codex-attach] ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
