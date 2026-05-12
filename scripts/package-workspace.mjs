#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

const LIB_FILES = [
  "adapter-contract.mjs",
  "legax-protocol.mjs",
  "codex-features.mjs",
  "inbound-transports.mjs",
  "menu-groups.mjs",
  "outbound-transports.mjs",
  "paths.mjs",
  "project-browser.mjs",
  "runtime-state.mjs",
  "version.mjs",
  "worktree-lite.mjs",
  "yaml.mjs"
];

const DAEMON_RUNTIME_SCRIPTS = [
  "legax-daemon.mjs",
  "claude-code-link.mjs",
  "claude-permission-mcp-server.mjs",
  "codex-app-server-link.mjs",
  "codex-attach.mjs",
  "codex-desktop-mirror-link.mjs",
  "daemon-control.mjs",
  "gemini-cli-link.mjs",
  "mcp-server.mjs",
  "opencode-link.mjs"
];

const SCRIPT_SETS = {
  cli: [
    ...DAEMON_RUNTIME_SCRIPTS,
    "legax-cli.mjs",
    "relay-setup.mjs",
    "simple-relay-server.mjs"
  ],
  daemon: DAEMON_RUNTIME_SCRIPTS,
  relay: [
    "simple-relay-server.mjs"
  ]
};

const DOC_FILES = ["README.md", "README.zh-CN.md", "LICENSE"];
const CONFIG_FILES = ["config.example.yaml", "config.example.zh-CN.yaml"];

function workspaceDir(name) {
  return path.join(repoRoot, "packages", name);
}

async function copyFile(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function copyPackageDocs(targetDir) {
  for (const file of DOC_FILES) {
    await copyFile(path.join(repoRoot, file), path.join(targetDir, file));
  }
}

async function copyRuntimeAssets(targetDir) {
  const distDir = path.join(targetDir, "dist");
  await copyFile(path.join(targetDir, "package.json"), path.join(distDir, "package.json"));
  for (const file of CONFIG_FILES) {
    await copyFile(path.join(repoRoot, file), path.join(distDir, file));
  }
}

async function buildRuntimePackage(name) {
  const targetDir = workspaceDir(name);
  await fs.rm(path.join(targetDir, "dist"), { recursive: true, force: true });
  await fs.mkdir(path.join(targetDir, "dist", "scripts"), { recursive: true });
  await copyPackageDocs(targetDir);
  await copyRuntimeAssets(targetDir);
  for (const file of LIB_FILES) {
    await copyFile(path.join(repoRoot, "scripts", "lib", file), path.join(targetDir, "dist", "scripts", "lib", file));
  }
  for (const file of SCRIPT_SETS[name]) {
    const sourcePath = path.join(repoRoot, "scripts", file);
    const targetPath = path.join(targetDir, "dist", "scripts", file);
    await copyFile(sourcePath, targetPath);
  }
}

const name = process.argv[2] ?? "";
if (Object.prototype.hasOwnProperty.call(SCRIPT_SETS, name)) await buildRuntimePackage(name);
else {
  process.stderr.write("usage: node scripts/package-workspace.mjs <cli|daemon|relay>\n");
  process.exit(2);
}
