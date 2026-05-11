import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fetchJson, pluginRoot, removeTempFiles, sleep, startRelay, waitFor, writeTempConfig } from "./helpers.mjs";

test("adapter cursor persists so old phone messages are not replayed on restart", async (t) => {
  const relay = await startRelay(t, { sessionId: "cursor-state-e2e" });
  const fakeGemini = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-gemini-cli.mjs").replaceAll("\\", "/");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
gemini:
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeGemini}
    - --output-format
    - stream-json
  cwd: .
  promptFlag: --prompt
  pollIntervalMs: 100
`);

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "gemini-cli",
      type: "text",
      text: "stale before start"
    })
  });

  const link = startGeminiLink(t, relay, configPath);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));
  await waitForConnected(relay, "Gemini CLI link connected");
  await waitFor(async () => {
    const state = JSON.parse(await fs.readFile(runtimeStatePath, "utf8"));
    assert.equal(state.sessions[relay.sessionId].agents["gemini-cli"].afterMessageSeq, 1);
  }, { timeoutMs: 7000 });

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "gemini-cli",
      type: "text",
      text: "fresh after cursor"
    })
  });

  await waitFor(async () => {
    const events = await phoneEvents(relay);
    const detail = `${link.stderr()}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => event.kind === "agent_text" && event.text === "gemini echo: fresh after cursor"), detail);
    assert.equal(events.events.some((event) => event.kind === "agent_text" && event.text === "gemini echo: stale before start"), false, detail);
  }, { timeoutMs: 7000 });
});

test("phone mode switch is persisted and reused by restarted adapters", async (t) => {
  const relay = await startRelay(t, { sessionId: "mode-state-e2e" });
  const fakeGemini = path.join(pluginRoot, "tests", "e2e", "fixtures", "fake-gemini-cli.mjs").replaceAll("\\", "/");
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
gemini:
  command: ${process.execPath.replaceAll("\\", "/")}
  args:
    - ${fakeGemini}
    - --output-format
    - stream-json
  cwd: .
  promptFlag: --prompt
  pollIntervalMs: 100
`);

  const first = startGeminiLink(t, relay, configPath);
  await waitForConnected(relay, "Gemini CLI link connected");
  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "gemini-cli",
      type: "control",
      action: "set_mode",
      mode: "paused"
    })
  });
  await waitFor(async () => {
    const state = JSON.parse(await fs.readFile(runtimeStatePath, "utf8"));
    assert.equal(state.sessions[relay.sessionId].agents["gemini-cli"].mode, "paused");
  }, { timeoutMs: 7000 });
  first.kill();
  await sleep(300);

  const second = startGeminiLink(t, relay, configPath);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));
  await waitFor(async () => {
    const events = await phoneEvents(relay);
    const connected = events.events
      .filter((event) => event.kind === "status" && /Gemini CLI link connected/.test(event.text))
      .at(-1);
    assert.equal(connected?.metadata?.mode, "paused", `${second.stderr()}\n${JSON.stringify(events.events, null, 2)}`);
  }, { timeoutMs: 7000 });

  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: relay.phoneCookie
    },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      targetAgentId: "gemini-cli",
      type: "text",
      text: "should stay paused"
    })
  });

  await waitFor(async () => {
    const events = await phoneEvents(relay);
    const detail = `${second.stderr()}\n${JSON.stringify(events.events, null, 2)}`;
    assert.ok(events.events.some((event) => event.kind === "status" && /ignored because remote mode is paused/.test(event.text)), detail);
    assert.equal(events.events.some((event) => event.kind === "agent_text" && /should stay paused/.test(event.text)), false, detail);
  }, { timeoutMs: 7000 });
});

function startGeminiLink(t, relay, configPath) {
  const child = spawn(process.execPath, ["scripts/gemini-cli-link.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(async () => {
    child.kill();
    await waitForExit(child);
  });
  return {
    kill: () => child.kill(),
    stderr: () => stderr
  };
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForConnected(relay, text) {
  await waitFor(async () => {
    const events = await phoneEvents(relay);
    assert.ok(events.events.some((event) => event.kind === "status" && event.text.includes(text)));
  }, { timeoutMs: 7000 });
}

function phoneEvents(relay) {
  return fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}&after=0`);
}
