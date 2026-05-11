import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { pluginRoot, removeTempFiles, startRelay, writeTempConfig } from "./helpers.mjs";

const runRealClients = process.env.LEGAX_REAL_CLIENTS === "1";

test("real local CLI clients are installed and can be used by adapter dry-runs", {
  skip: runRealClients ? false : "Set LEGAX_REAL_CLIENTS=1 to run local real-client checks."
}, async (t) => {
  const clients = {
    codex: await findCommand("codex"),
    claude: await findCommand("claude"),
    gemini: await findCommand("gemini")
  };
  for (const [name, command] of Object.entries(clients)) {
    assert.ok(command, `${name} command was not found on PATH`);
    const version = await runCommand(command, ["--version"], { timeoutMs: 12000 });
    assert.equal(version.code, 0, `${name} --version failed\nstdout:\n${version.stdout}\nstderr:\n${version.stderr}`);
    assert.match(`${version.stdout}\n${version.stderr}`, /\S/, `${name} --version returned no output`);
  }

  const relay = await startRelay(t, { sessionId: "real-clients-e2e" });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
codex:
  command: ${clients.codex.replaceAll("\\", "/")}
claude:
  command: ${clients.claude.replaceAll("\\", "/")}
gemini:
  command: ${clients.gemini.replaceAll("\\", "/")}
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));

  for (const script of [
    "scripts/codex-app-server-link.mjs",
    "scripts/claude-code-link.mjs",
    "scripts/gemini-cli-link.mjs",
    "scripts/legax-daemon.mjs"
  ]) {
    const result = await runCommand(process.execPath, [script, "--dry-run"], {
      cwd: pluginRoot,
      env: {
        ...process.env,
        LEGAX_CONFIG: configPath,
        LEGAX_SECRET: relay.desktopSecret
      },
      timeoutMs: 12000
    });
    assert.equal(result.code, 0, `${script} --dry-run failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
});

async function findCommand(name) {
  const finder = process.platform === "win32"
    ? { command: "where.exe", args: [name] }
    : { command: "sh", args: ["-lc", `command -v ${name}`] };
  const result = await runCommand(finder.command, finder.args, { timeoutMs: 5000 });
  if (result.code !== 0) return "";
  const matches = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (process.platform === "win32") {
    return matches.find((line) => /\.(cmd|exe|bat)$/i.test(line)) ?? matches[0] ?? "";
  }
  return matches[0] ?? "";
}

function runCommand(command, args, { cwd = pluginRoot, env = process.env, timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    let child;
    let stdout = "";
    let stderr = "";
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command)
      });
    } catch (error) {
      resolve({ code: -1, stdout, stderr: error.message });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      stderr += `\nTimed out after ${timeoutMs}ms`;
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? (signal ? 1 : 0), signal, stdout, stderr });
    });
  });
}
