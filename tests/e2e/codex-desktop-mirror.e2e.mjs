import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { dataDir, fetchJson, pluginRoot, removeTempFiles, startRelay, waitFor, writeTempConfig } from "./helpers.mjs";

test("codex-desktop-mirror tails latest rollout and forwards user / agent / exec / completion", async (t) => {
  const relay = await startRelay(t, { sessionId: "codex-mirror-e2e" });
  const sessionsRoot = path.join(dataDir, `mirror-sessions-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const dayDir = path.join(sessionsRoot, "2026", "05", "08");
  await fs.mkdir(dayDir, { recursive: true });
  const rolloutPath = path.join(dayDir, "rollout-2026-05-08T01-23-45-abc.jsonl");

  // Pre-populate with a session_meta header that matches filterToOriginator.
  await fs.writeFile(rolloutPath, JSON.stringify({
    timestamp: "2026-05-08T01:23:45.000Z",
    type: "session_meta",
    payload: {
      id: "abc",
      timestamp: "2026-05-08T01:23:45.000Z",
      cwd: pluginRoot,
      originator: "Codex Desktop",
      cli_version: "0.128.0"
    }
  }) + "\n", "utf8");

  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
codexDesktopMirror:
  enabled: true
  agentId: codex-desktop
  agentLabel: Codex Desktop (mirror)
  cliBackend: session-jsonl-tail
  mode: monitor
  sessionsRoot: ${sessionsRoot.replaceAll("\\", "/")}
  filterToOriginator: "Codex Desktop"
  pollIntervalMs: 200
  rescanFilesEveryMs: 400
  truncateOutputBytes: 200
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));
  t.after(() => fs.rm(sessionsRoot, { recursive: true, force: true }));

  const link = spawn(process.execPath, ["scripts/codex-desktop-mirror-link.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  link.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(() => { link.kill(); });

  // Wait for the mirror to attach to the file.
  await waitFor(() => {
    if (!stderr.includes("codex-desktop-mirror following")) throw new Error(`not following yet: ${stderr.slice(-300)}`);
    return true;
  }, { timeoutMs: 5000 });

  // Append a series of events; the mirror should forward them.
  const append = async (entry) => fs.appendFile(rolloutPath, JSON.stringify(entry) + "\n", "utf8");

  await append({
    timestamp: "2026-05-08T01:23:46.000Z",
    type: "event_msg",
    payload: { type: "user_message", message: "list the files in src/", turn_id: "t1" }
  });
  await append({
    timestamp: "2026-05-08T01:23:47.000Z",
    type: "event_msg",
    payload: { type: "agent_message", message: "I'll run ls.", phase: "commentary", turn_id: "t1" }
  });
  await append({
    timestamp: "2026-05-08T01:23:48.000Z",
    type: "event_msg",
    payload: {
      type: "exec_command_end",
      command: ["ls", "src/"],
      aggregated_output: "main.rs\nlib.rs",
      exit_code: 0,
      status: "success",
      turn_id: "t1"
    }
  });
  await append({
    timestamp: "2026-05-08T01:23:49.000Z",
    type: "event_msg",
    payload: { type: "task_complete", last_agent_message: "Done.", turn_id: "t1" }
  });

  const events = await waitFor(async () => {
    const body = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}`, {
      headers: { cookie: relay.phoneCookie }
    });
    const ev = body.events ?? [];
    if (ev.length < 5) throw new Error(`expected >= 5 events, have ${ev.length}\nstderr: ${stderr.slice(-400)}`);
    return ev;
  }, { timeoutMs: 8000 });

  const texts = events.map((e) => `${e.kind}|${e.text}`);
  // First event: startup status
  assert.ok(texts[0].startsWith("status|Codex desktop mirror started"), `first event: ${texts[0]}`);
  // The four appended events come in order.
  assert.ok(texts.some((t) => t.includes("agent_text|list the files in src/")), `missing user message; got ${texts}`);
  assert.ok(texts.some((t) => t.includes("agent_text|I'll run ls.")), `missing assistant message; got ${texts}`);
  assert.ok(texts.some((t) => /exec success \(exit=0\): ls src\//.test(t)), `missing exec; got ${texts}`);
  assert.ok(texts.some((t) => t.startsWith("status|Turn complete:")), `missing completion; got ${texts}`);
});

test("codex-desktop-mirror refuses to inject phone messages and replies with a status", async (t) => {
  const relay = await startRelay(t, { sessionId: "codex-mirror-refuse-e2e" });
  const sessionsRoot = path.join(dataDir, `mirror-refuse-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await fs.mkdir(sessionsRoot, { recursive: true });
  const { configPath, statePath, runtimeStatePath } = await writeTempConfig(relay, `
codexDesktopMirror:
  enabled: true
  agentId: codex-desktop
  cliBackend: session-jsonl-tail
  mode: monitor
  sessionsRoot: ${sessionsRoot.replaceAll("\\", "/")}
  filterToOriginator: ""
  pollIntervalMs: 200
  rescanFilesEveryMs: 400
`);
  t.after(() => removeTempFiles(configPath, statePath, runtimeStatePath));
  t.after(() => fs.rm(sessionsRoot, { recursive: true, force: true }));

  const link = spawn(process.execPath, ["scripts/codex-desktop-mirror-link.mjs"], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LEGAX_CONFIG: configPath,
      LEGAX_SECRET: relay.desktopSecret
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  link.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(() => { link.kill(); });

  // Wait for startup status to land.
  await waitFor(async () => {
    const body = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}`, {
      headers: { cookie: relay.phoneCookie }
    });
    if (!(body.events ?? []).some((e) => e.text?.includes("Codex desktop mirror started"))) {
      throw new Error("not started yet");
    }
    return body.events;
  }, { timeoutMs: 5000 });

  // Phone tries to send a text targeted at the mirror.
  await fetchJson(`${relay.baseUrl}/api/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: relay.phoneCookie },
    body: JSON.stringify({
      sessionId: relay.sessionId,
      type: "text",
      targetAgentId: "codex-desktop",
      text: "please run a build"
    })
  });

  const events = await waitFor(async () => {
    const body = await fetchJson(`${relay.baseUrl}/api/events?sessionId=${relay.sessionId}`, {
      headers: { cookie: relay.phoneCookie }
    });
    const ev = body.events ?? [];
    if (!ev.some((e) => /is read-only/.test(e.text ?? ""))) {
      throw new Error(`refuse status not yet visible; stderr=${stderr.slice(-400)}`);
    }
    return ev;
  }, { timeoutMs: 8000 });

  assert.ok(events.some((e) => e.kind === "status" && /Codex desktop mirror is read-only/.test(e.text)),
    `expected refusal status; got ${JSON.stringify(events.map((e) => e.text))}`);
});
