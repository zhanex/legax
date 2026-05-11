#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const rootPackagePath = path.join(repoRoot, "package.json");
const workspaceDirs = [
  "packages/cli",
  "packages/daemon",
  "packages/relay"
];

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

const rootPackage = await readJson(rootPackagePath);
const rootVersion = rootPackage.version;
if (!rootPackage.private) fail("root package.json must stay private");
if (!Array.isArray(rootPackage.workspaces)) fail("root package.json must define workspaces");

for (const workspaceDir of workspaceDirs) {
  const packagePath = path.join(repoRoot, workspaceDir, "package.json");
  const pkg = await readJson(packagePath);
  if (pkg.version !== rootVersion) {
    fail(`${pkg.name} version ${pkg.version} does not match root ${rootVersion}`);
  }
}

const declaredWorkspaces = new Set(rootPackage.workspaces);
for (const workspaceDir of workspaceDirs) {
  if (!declaredWorkspaces.has(workspaceDir)) fail(`missing workspace declaration: ${workspaceDir}`);
}

if (process.exitCode) process.exit(process.exitCode);
process.stdout.write(`Workspace package versions match ${rootVersion}\n`);
