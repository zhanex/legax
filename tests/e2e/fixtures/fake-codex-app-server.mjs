#!/usr/bin/env node
let buffer = "";
let nextTurn = 1;
let nextServerRequest = 100;
let activeThreadId = "thread-e2e";
const pendingServerRequests = new Map();
const threads = [
  {
    id: "thread-e2e",
    name: "Legax smoke",
    preview: "hello from an earlier Codex session",
    createdAt: 1700000000,
    updatedAt: 1700000100,
    cwd: process.cwd(),
    source: "cli",
    turns: [
      {
        id: "turn-history-1",
        items: [
          { id: "user-history-1", type: "userMessage", text: "what is the relay status?" },
          { id: "agent-history-1", type: "agentMessage", text: "the relay is healthy" }
        ]
      }
    ]
  },
  {
    id: "thread-second",
    name: "Second fake session",
    preview: "continue the second task",
    createdAt: 1700000200,
    updatedAt: 1700000300,
    cwd: process.cwd(),
    source: "appServer",
    turns: [
      {
        id: "turn-history-2",
        items: [
          { id: "user-history-2", type: "userMessage", text: "summarize task two" },
          {
            id: "agent-history-2",
            type: "agentMessage",
            text: `task two is ready. ${"full agent detail ".repeat(18)}final untruncated marker`
          }
        ]
      }
    ]
  }
];

if (process.env.LEGAX_FAKE_CODEX_MANY_CHAT_SESSIONS === "1") {
  for (let index = 1; index <= 12; index += 1) {
    threads.push({
      id: `thread-chat-${index}`,
      name: `Chat history ${String(index).padStart(2, "0")}`,
      preview: `chat preview ${index}`,
      createdAt: 1700001000 + index,
      updatedAt: 1700001000 + index,
      cwd: process.cwd(),
      source: "appServer",
      archived: index === 12,
      turns: []
    });
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function textFromInput(input = []) {
  return input
    .map((item) => item?.text ?? item?.content ?? "")
    .filter(Boolean)
    .join("\n");
}

function requestApproval(turnId, text) {
  const id = nextServerRequest++;
  pendingServerRequests.set(id, { kind: "item-approval", turnId, text });
  send({
    id,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: activeThreadId,
      turnId,
      itemId: `cmd-${turnId}`,
      reason: "Fake Codex App Server approval",
      cwd: process.cwd(),
      command: ["node", "--version"]
    }
  });
}

function requestUserInput(turnId, text) {
  const id = nextServerRequest++;
  pendingServerRequests.set(id, { kind: "user-input", turnId, text });
  send({
    id,
    method: "item/tool/requestUserInput",
    params: {
      threadId: activeThreadId,
      turnId,
      itemId: `input-${turnId}`,
      questions: [
        {
          id: "choice",
          header: "Confirm",
          question: "Choose a path",
          options: [
            { label: "alpha", description: "Use alpha" },
            { label: "beta", description: "Use beta" }
          ]
        }
      ]
    }
  });
}

function sendAgentOnly(turnId, text) {
  send({
    method: "item/completed",
    params: {
      threadId: activeThreadId,
      turnId,
      item: {
        id: `agent-${turnId}`,
        type: "agentMessage",
        text: `codex progress: ${text}`
      }
    }
  });
}

function finishTurn(turnId, text, approved) {
  send({
    method: "item/completed",
    params: {
      threadId: activeThreadId,
      turnId,
      item: {
        id: `agent-${turnId}`,
        type: "agentMessage",
        text: approved ? `codex approved: ${text}` : `codex denied: ${text}`
      }
    }
  });
  send({
    method: "turn/completed",
    params: {
      threadId: activeThreadId,
      turn: { id: turnId, status: "completed" }
    }
  });
}

function handleRequest(message) {
  if (message.method === "initialize") {
    send({
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "fake-codex-app-server", version: "0.0.0" },
        capabilities: {}
      }
    });
    return;
  }
  if (message.method === "thread/start") {
    const thread = {
      id: `thread-new-${threads.length + 1}`,
      name: "New fake session",
      preview: "",
      createdAt: 1700000400 + threads.length,
      updatedAt: 1700000400 + threads.length,
      cwd: process.cwd(),
      source: "appServer",
      turns: []
    };
    threads.unshift(thread);
    activeThreadId = thread.id;
    send({ id: message.id, result: { thread } });
    return;
  }
  if (message.method === "thread/list") {
    send({ id: message.id, result: { data: threads.map((thread) => ({ ...thread, turns: [] })) } });
    return;
  }
  if (message.method === "thread/resume" || message.method === "thread/read") {
    const thread = threads.find((candidate) => candidate.id === message.params?.threadId) ?? threads[0];
    activeThreadId = thread.id;
    send({ id: message.id, result: { thread } });
    return;
  }
  if (message.method === "turn/start" || message.method === "turn/steer") {
    const turnId = message.params?.expectedTurnId ?? `turn-${nextTurn++}`;
    const text = textFromInput(message.params?.input);
    send({ id: message.id, result: { turn: { id: turnId } } });
    if (/agent-message-only/i.test(text)) {
      setTimeout(() => sendAgentOnly(turnId, text), 20);
    } else if (/request input/i.test(text)) {
      setTimeout(() => requestUserInput(turnId, text), 20);
    } else {
      setTimeout(() => requestApproval(turnId, text), 20);
    }
    return;
  }
  if (message.id !== undefined) {
    send({
      id: message.id,
      error: { code: -32601, message: `Method not found: ${message.method}` }
    });
  }
}

function handleMessage(message) {
  if (message.id !== undefined && !message.method && pendingServerRequests.has(message.id)) {
    const pending = pendingServerRequests.get(message.id);
    pendingServerRequests.delete(message.id);
    if (pending.kind === "user-input") {
      const answer = message.result?.answers?.choice?.answers?.[0] ?? "";
      finishTurn(pending.turnId, `input ${answer}`.trim(), true);
      return;
    }
    const approved = message.result?.decision === "accept" || message.result?.decision === "approved";
    finishTurn(pending.turnId, pending.text, approved);
    return;
  }
  if (message.method) handleRequest(message);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    handleMessage(JSON.parse(line));
  }
});
