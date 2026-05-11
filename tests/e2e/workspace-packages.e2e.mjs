import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { fetchJson, getFreePort, installedBin, waitFor } from "./helpers.mjs";
import { packageRoot } from "../../scripts/lib/paths.mjs";

function runNpm(args, options = {}) {
  const npmCli = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "..", "node_modules", "npm", "bin", "npm-cli.js")
  ].find((candidate) => candidate && existsSync(candidate));
  if (npmCli) return execFileSync(process.execPath, [npmCli, ...args], options);
  return execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    ...options,
    shell: process.platform === "win32"
  });
}

function packWorkspace(workspace, packDir) {
  const out = runNpm(["pack", "--workspace", workspace, "--pack-destination", packDir, "--json"], {
    cwd: packageRoot,
    encoding: "utf8"
  });
  const info = JSON.parse(out)[0];
  return path.isAbsolute(info.filename) ? info.filename : path.join(packDir, info.filename);
}

function runBin(command, args, options = {}) {
  return spawnSync(command, args, {
    ...options,
    shell: process.platform === "win32"
  });
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process already exited.
  }
}

test("cli workspace package installs without a separate core package", async (t) => {
  const packDir = await fs.mkdtemp(path.join(os.tmpdir(), "legax-cli-pack-"));
  const prefix = await fs.mkdtemp(path.join(os.tmpdir(), "legax-cli-prefix-"));
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "legax-cli-home-"));
  t.after(async () => {
    await fs.rm(packDir, { recursive: true, force: true });
    await fs.rm(prefix, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  const cli = packWorkspace("legax", packDir);
  runNpm(["install", "--global", "--prefix", prefix, cli], {
    cwd: packageRoot,
    stdio: "pipe"
  });

  const env = { ...process.env, LEGAX_CONFIG: "", LEGAX_HOME: home };
  const legax = installedBin(prefix, "legax");
  const version = runBin(legax, ["--version"], { env, encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr || version.error?.message);
  assert.match(version.stdout, /^\d+\.\d+\.\d+/);

  const init = runBin(legax, ["init", "--json"], { env, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr || init.error?.message);
  assert.equal(JSON.parse(init.stdout).configPath, path.join(home, "config.yaml"));

  const doctor = runBin(legax, ["doctor", "--offline", "--json"], { env, encoding: "utf8" });
  assert.equal(doctor.status, 0, doctor.stderr || doctor.error?.message);
  assert.equal(JSON.parse(doctor.stdout).ok, true);

  const relayInit = runBin(legax, ["relay", "init", "--domain", "relay.example.com", "--json"], { env, encoding: "utf8" });
  assert.equal(relayInit.status, 0, relayInit.stderr || relayInit.error?.message);
  assert.equal(JSON.parse(relayInit.stdout).publicBaseUrl, "https://relay.example.com");
  assert.equal(await exists(installedBin(prefix, "legax-relay")), true);
});

test("daemon workspace package installs without a separate core package", async (t) => {
  const packDir = await fs.mkdtemp(path.join(os.tmpdir(), "legax-daemon-pack-"));
  const prefix = await fs.mkdtemp(path.join(os.tmpdir(), "legax-daemon-prefix-"));
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "legax-daemon-home-"));
  t.after(async () => {
    await fs.rm(packDir, { recursive: true, force: true });
    await fs.rm(prefix, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  const daemon = packWorkspace("@legax/daemon", packDir);
  runNpm(["install", "--global", "--prefix", prefix, daemon], {
    cwd: packageRoot,
    stdio: "pipe"
  });

  const env = { ...process.env, LEGAX_CONFIG: "", LEGAX_HOME: home };
  const status = runBin(installedBin(prefix, "legax-daemon-control"), ["status"], { env, encoding: "utf8" });
  assert.equal(status.status, 1);
  assert.match(status.stdout + status.stderr, /not running/i);
});

test("relay workspace package starts with generated config", async (t) => {
  const packDir = await fs.mkdtemp(path.join(os.tmpdir(), "legax-relay-pack-"));
  const prefix = await fs.mkdtemp(path.join(os.tmpdir(), "legax-relay-prefix-"));
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "legax-relay-home-"));
  t.after(async () => {
    await fs.rm(packDir, { recursive: true, force: true });
    await fs.rm(prefix, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  const relay = packWorkspace("@legax/relay", packDir);
  runNpm(["install", "--global", "--prefix", prefix, relay], {
    cwd: packageRoot,
    stdio: "pipe"
  });

  const port = await getFreePort();
  const configPath = path.join(home, "relay.config.yaml");
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(configPath, `sessionId: relay-workspace-e2e
relay:
  host: 127.0.0.1
  port: ${port}
  publicBaseUrl: https://relay.example.com
  secret: relay-workspace-secret
  storePath: ./data/relay-store.json
  audit:
    enabled: false
transports: []
`, "utf8");

  const child = spawn(installedBin(prefix, "legax-relay"), ["--config", configPath], {
    env: { ...process.env, LEGAX_HOME: home },
    shell: process.platform === "win32",
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => killProcessTree(child.pid));

  await waitFor(async () => {
    const health = await fetchJson(`http://127.0.0.1:${port}/health`, { skipRelayCookie: true });
    assert.equal(health.ok, true);
  }, { timeoutMs: 7000 });
  assert.match(stderr, /Legax relay listening/);
});

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}
