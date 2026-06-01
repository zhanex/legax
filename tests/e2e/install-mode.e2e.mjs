import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fetchJson, getFreePort, spawnNodeForTest, waitFor } from "./helpers.mjs";

import {
  configDirFromConfigPath,
  defaultConfigPath,
  defaultDataDir,
  legaxHome,
  packageRoot,
  resolveConfigRelative
} from "../../scripts/lib/paths.mjs";
import { parseSimpleYaml } from "../../scripts/lib/yaml.mjs";

test("installed-mode paths keep package files separate from operator data", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "legax-home-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));

  const env = { LEGAX_HOME: home };
  assert.equal(legaxHome(env), home);
  assert.equal(defaultConfigPath(env), path.join(home, "config.yaml"));
  assert.equal(defaultDataDir(env), path.join(home, "data"));
  assert.equal(configDirFromConfigPath(path.join(home, "config.yaml")), home);
  assert.equal(
    resolveConfigRelative("data/runtime-state.json", path.join(home, "config.yaml")),
    path.join(home, "data", "runtime-state.json")
  );
  assert.ok(packageRoot.endsWith("legax") || packageRoot.includes("node_modules"));
});

test("YAML parser preserves nested config objects and lists used by examples", () => {
  const parsed = parseSimpleYaml(`
relay:
  audit:
    enabled: true
    path: ./data/relay-audit.jsonl
    textPreview: 0
daemon:
  hostGroups:
    - default
  notifications:
    telegram:
      messageDetail: important
transports:
  - name: telegram
    type: telegram
    enabled: false
    notifications:
      maxParts: 8
codex:
  args:
    - fixture:fake-codex-app-server.mjs
    - app-server
    - --listen
`);

  assert.deepEqual(parsed.relay.audit, {
    enabled: true,
    path: "./data/relay-audit.jsonl",
    textPreview: 0
  });
  assert.deepEqual(parsed.daemon.hostGroups, ["default"]);
  assert.deepEqual(parsed.daemon.notifications.telegram, { messageDetail: "important" });
  assert.equal(parsed.transports[0].notifications.maxParts, 8);
  assert.deepEqual(parsed.codex.args, ["fixture:fake-codex-app-server.mjs", "app-server", "--listen"]);
});

function runLegax(args, env = {}) {
  return spawnSync(process.execPath, ["scripts/legax-cli.mjs", ...args], {
    cwd: packageRoot,
    env: { ...process.env, LEGAX_CONFIG: "", ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

test("legax init writes config under LEGAX_HOME by default", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "legax-init-home-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));

  const result = runLegax(["init", "--json"], { LEGAX_HOME: home });
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.configPath, path.join(home, "config.yaml"));
  assert.match(await fs.readFile(body.configPath, "utf8"), /relay:/);
});

test("legax doctor reads explicit config path outside package root", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "legax-doctor-home-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const configPath = path.join(home, "custom.yaml");

  assert.equal(runLegax(["init", "--config", configPath, "--json"], { LEGAX_HOME: home }).status, 0);
  // This test checks config path resolution, not whether the runner has real
  // agent CLIs on PATH.
  await fs.appendFile(configPath, `
codex:
  enabled: false
claude:
  enabled: false
gemini:
  enabled: false
opencode:
  enabled: false
`, "utf8");
  const doctor = runLegax(["doctor", "--config", configPath, "--offline", "--json"], { LEGAX_HOME: home });
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).configPath, configPath);
});

test("daemon control uses LEGAX_HOME data paths", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "legax-daemon-home-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));

  const init = runLegax(["init", "--json"], { LEGAX_HOME: home });
  assert.equal(init.status, 0, init.stderr);

  const status = runLegax(["daemon", "status"], { LEGAX_HOME: home });
  assert.equal(status.status, 1);
  assert.match(status.stdout + status.stderr, /not running/i);
  assert.equal(await exists(path.join(home, "data")), true);
});

test("daemon dry-run resolves runtime files under LEGAX_HOME", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "legax-daemon-dry-home-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));

  const init = runLegax(["init", "--json"], { LEGAX_HOME: home });
  assert.equal(init.status, 0, init.stderr);

  const result = spawnSync(process.execPath, ["scripts/legax-daemon.mjs", "--dry-run"], {
    cwd: packageRoot,
    env: { ...process.env, LEGAX_CONFIG: "", LEGAX_HOME: home },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(result.status, 0, result.stderr);

  const body = JSON.parse(result.stdout);
  assert.equal(body.configPath, path.join(home, "config.yaml"));
  assert.equal(body.storagePath, path.join(home, "data", "mcp-state.json"));
  assert.equal(body.runtimeStatePath, path.join(home, "data", "runtime-state.json"));
});

test("MCP status resolves storage under LEGAX_HOME", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "legax-mcp-home-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));

  const init = runLegax(["init", "--json"], { LEGAX_HOME: home });
  assert.equal(init.status, 0, init.stderr);

  const result = spawnSync(process.execPath, ["scripts/mcp-server.mjs", "--status"], {
    cwd: packageRoot,
    env: { ...process.env, LEGAX_CONFIG: "", LEGAX_HOME: home },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(result.status, 0, result.stderr);

  const body = JSON.parse(result.stdout);
  assert.equal(body.config.configPath, path.join(home, "config.yaml"));
  assert.equal(body.config.storagePath, path.join(home, "data", "mcp-state.json"));
});

test("adapter dry-runs resolve default cwd from LEGAX_HOME config", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "legax-adapter-home-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));

  const init = runLegax(["init", "--json"], { LEGAX_HOME: home });
  assert.equal(init.status, 0, init.stderr);

  for (const [script, section] of [
    ["scripts/codex-app-server-link.mjs", "codex"],
    ["scripts/claude-code-link.mjs", "claude"],
    ["scripts/gemini-cli-link.mjs", "gemini"],
    ["scripts/opencode-link.mjs", "opencode"]
  ]) {
    const result = spawnSync(process.execPath, [script, "--dry-run"], {
      cwd: packageRoot,
      env: { ...process.env, LEGAX_CONFIG: "", LEGAX_HOME: home },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    assert.equal(result.status, 0, `${script}\n${result.stderr}`);

    const body = JSON.parse(result.stdout);
    assert.equal(body.configPath, path.join(home, "config.yaml"), script);
    assert.equal(body[section].cwd, home, script);
  }
});

test("legax relay uses LEGAX_HOME relay store paths", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "legax-relay-home-"));
  const port = await getFreePort();
  const secret = "relay-install-secret";
  t.after(() => fs.rm(home, { recursive: true, force: true }));

  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(path.join(home, "config.yaml"), `sessionId: relay-install-e2e
relay:
  host: 127.0.0.1
  port: ${port}
  secret: ${secret}
  storePath: ./data/relay-store.json
  audit:
    enabled: true
    path: ./data/relay-audit.jsonl
transports: []
`, "utf8");

  const child = spawnNodeForTest(t, ["scripts/legax-cli.mjs", "relay"], {
    cwd: packageRoot,
    env: { ...process.env, LEGAX_CONFIG: "", LEGAX_HOME: home },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    const health = await fetchJson(`${baseUrl}/health`, { skipRelayCookie: true });
    assert.equal(health.ok, true);
  }, { timeoutMs: 7000 });

  await fetchJson(`${baseUrl}/api/twa/launch-tokens`, {
    method: "POST",
    headers: { "x-legax-secret": secret },
    body: JSON.stringify({ sessionId: "relay-install-e2e", agentId: "codex-cli" }),
    skipRelayCookie: true
  });
  await fetchJson(`${baseUrl}/api/events`, {
    method: "POST",
    headers: { "x-legax-secret": secret },
    body: JSON.stringify({
      sessionId: "relay-install-e2e",
      agentId: "codex-cli",
      kind: "status",
      text: "relay install smoke"
    }),
    skipRelayCookie: true
  });

  assert.equal(await exists(path.join(home, "data", "relay-store.json")), true, stderr);
  assert.equal(await exists(path.join(home, "data", "relay-audit.jsonl")), true, stderr);
});

test("legax relay init writes relay config and Caddy guidance", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "legax-relay-init-home-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));

  const result = runLegax(["relay", "init", "--domain", "relay.example.com", "--json"], { LEGAX_HOME: home });
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.configPath, path.join(home, "relay.config.yaml"));
  assert.equal(body.publicBaseUrl, "https://relay.example.com");
  assert.match(await fs.readFile(body.configPath, "utf8"), /publicBaseUrl: https:\/\/relay\.example\.com/);
  assert.match(await fs.readFile(body.caddyfilePath, "utf8"), /reverse_proxy 127\.0\.0\.1:8787/);
  assert.match(body.daemonSnippet, /baseUrl: https:\/\/relay\.example\.com/);
});

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}
