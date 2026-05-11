import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pollInboundTransports } from "../../scripts/lib/inbound-transports.mjs";
import { buildTelegramMessagePayloads, dispatchAdditionalTransports } from "../../scripts/lib/outbound-transports.mjs";
import { dataDir, removeTempFiles } from "./helpers.mjs";

test("Telegram inbound messages keep default routing, request-id routing, and cursors", async (t) => {
  await fs.mkdir(dataDir, { recursive: true });
  const runtimeStatePath = path.join(
    dataDir,
    `runtime-state-telegram-inbound-${process.pid}-${Date.now()}.json`
  ).replaceAll("\\", "/");
  t.after(() => removeTempFiles(runtimeStatePath));

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      body: options.body ? JSON.parse(options.body) : {}
    });
    return new Response(JSON.stringify({
      ok: true,
      result: [
        {
          update_id: 100,
          message: {
            date: 1700000000,
            chat: { id: 42 },
            text: "hello codex"
          }
        },
        {
          update_id: 101,
          message: {
            date: 1700000001,
            chat: { id: 42 },
            text: "/approve claude-permission-1"
          }
        },
        {
          update_id: 102,
          message: {
            date: 1700000002,
            chat: { id: 42 },
            text: "/deny codex-7"
          }
        },
        {
          update_id: 103,
          message: {
            date: 1700000003,
            chat: { id: 999 },
            text: "wrong chat"
          }
        }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const config = {
    sessionId: "telegram-inbound-e2e",
    runtimeStatePath,
    routing: {
      defaultTarget: "codex-cli"
    },
    codex: {
      enabled: true,
      agentId: "codex-cli"
    },
    transports: [
      {
        name: "telegram",
        type: "telegram",
        enabled: true,
        botToken: "test-token",
        chatId: 42,
        timeoutMs: 1000
      }
    ]
  };

  const messages = await pollInboundTransports(config, { agentId: "codex-cli" });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].type, "text");
  assert.equal(messages[0].targetAgentId, "codex-cli");
  assert.equal(messages[0].createdAt, "2023-11-14T22:13:20.000Z");
  assert.equal(messages[1].targetAgentId, "codex-cli");
  assert.equal(messages[1].decision, "deny");

  const claudeMessages = await pollInboundTransports(config, { agentId: "claude-code" });
  assert.equal(claudeMessages.length, 1);
  assert.equal(claudeMessages[0].type, "permission_decision");
  assert.equal(claudeMessages[0].targetAgentId, "claude-code");
  assert.equal(claudeMessages[0].decision, "approve");

  const state = JSON.parse(await fs.readFile(runtimeStatePath, "utf8"));
  assert.equal(
    state.sessions["telegram-inbound-e2e"].agents["codex-cli"].transportCursors["telegram:telegram"].offset,
    104
  );
  assert.equal(calls[0].body.offset, undefined);
});

test("Telegram /start and inline callbacks route through one poller into agent queues", async (t) => {
  await fs.mkdir(dataDir, { recursive: true });
  const runtimeStatePath = path.join(
    dataDir,
    `runtime-state-telegram-menu-${process.pid}-${Date.now()}.json`
  ).replaceAll("\\", "/");
  t.after(() => removeTempFiles(runtimeStatePath));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const textUrl = String(url);
    if (textUrl.includes("/answerCallbackQuery")) {
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      ok: true,
      result: [
        {
          update_id: 200,
          message: {
            date: 1700000100,
            chat: { id: 42 },
            text: "/start"
          }
        },
        {
          update_id: 201,
          callback_query: {
            id: "callback-agent",
            data: "legax:agent:claude-code",
            from: { id: 42 },
            message: { chat: { id: 42 } }
          }
        },
        {
          update_id: 202,
          callback_query: {
            id: "callback-session",
            data: "legax:session:codex-cli:thread-second",
            from: { id: 42 },
            message: { chat: { id: 42 } }
          }
        },
        {
          update_id: 203,
          callback_query: {
            id: "callback-approval",
            data: "legax:approve:codex-99",
            from: { id: 42 },
            message: { chat: { id: 42 } }
          }
        },
        {
          update_id: 204,
          message: {
            date: 1700000104,
            chat: { id: 42 },
            text: "/answer codex-100 beta"
          }
        },
        {
          update_id: 205,
          callback_query: {
            id: "callback-new-codex",
            data: "legax:new:codex-cli",
            from: { id: 42 },
            message: { chat: { id: 42 } }
          }
        }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const config = {
    sessionId: "telegram-menu-e2e",
    runtimeStatePath,
    routing: {
      defaultTarget: "none"
    },
    codex: {
      enabled: true,
      agentId: "codex-cli"
    },
    claude: {
      enabled: true,
      agentId: "claude-code"
    },
    gemini: {
      enabled: true,
      agentId: "gemini-cli"
    },
    transports: [
      {
        name: "telegram",
        type: "telegram",
        enabled: true,
        botToken: "test-token",
        chatId: 42,
        timeoutMs: 1000
      }
    ]
  };

  const codexMessages = await pollInboundTransports(config, { agentId: "codex-cli" });
  assert.equal(codexMessages.length, 5);
  assert.equal(codexMessages[0].action, "list_agents");
  assert.equal(codexMessages[1].action, "select_session");
  assert.equal(codexMessages[1].threadRef, "thread-second");
  assert.equal(codexMessages[2].type, "permission_decision");
  assert.equal(codexMessages[2].decision, "approve");
  assert.equal(codexMessages[3].type, "user_input_response");
  assert.equal(codexMessages[3].text, "beta");
  assert.equal(codexMessages[4].action, "new_session");
  assert.equal(codexMessages[4].targetAgentId, "codex-cli");

  const claudeMessages = await pollInboundTransports(config, { agentId: "claude-code" });
  assert.equal(claudeMessages.length, 1);
  assert.equal(claudeMessages[0].action, "list_agent_projects");
  assert.equal(claudeMessages[0].targetAgentId, "claude-code");

  const state = JSON.parse(await fs.readFile(runtimeStatePath, "utf8"));
  assert.equal(
    state.sessions["telegram-menu-e2e"].launchRequests["claude-code"].reason,
    "list_agent_projects"
  );
  assert.equal(
    state.sessions["telegram-menu-e2e"].transportSelections["telegram:telegram"].targetAgentId,
    "codex-cli"
  );
  assert.equal(
    state.sessions["telegram-menu-e2e"].transportSelections["telegram:telegram"].selectedThreadId,
    "thread-second"
  );
});

test("Telegram new project callback routes to daemon preflight", async (t) => {
  await fs.mkdir(dataDir, { recursive: true });
  const runtimeStatePath = path.join(
    dataDir,
    `runtime-state-telegram-new-project-${process.pid}-${Date.now()}.json`
  ).replaceAll("\\", "/");
  t.after(() => removeTempFiles(runtimeStatePath));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (textUrl.includes("/answerCallbackQuery")) {
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      ok: true,
      result: [
        {
          update_id: 260,
          callback_query: {
            id: "callback-new-project",
            data: "legax:new-project:codex-cli",
            from: { id: 42 },
            message: { chat: { id: 42 } }
          }
        }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const config = {
    sessionId: "telegram-new-project-e2e",
    runtimeStatePath,
    routing: {
      defaultTarget: "none"
    },
    codex: {
      enabled: true,
      agentId: "codex-cli"
    },
    transports: [
      {
        name: "telegram",
        type: "telegram",
        enabled: true,
        botToken: "test-token",
        chatId: 42,
        timeoutMs: 1000
      }
    ]
  };

  const messages = await pollInboundTransports(config, { agentId: "legax-daemon" }, { forcePoll: true });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "control");
  assert.equal(messages[0].action, "new_project_preflight");
  assert.equal(messages[0].targetAgentId, "legax-daemon");
  assert.equal(messages[0].selectedAgentId, "codex-cli");
  assert.equal(messages[0].text, "/new-project codex-cli");
});

test("Telegram outbound permission requests include approve and deny callback buttons", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      body: options.body ? JSON.parse(options.body) : {}
    });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const results = await dispatchAdditionalTransports({
    transports: [
      {
        name: "telegram",
        type: "telegram",
        enabled: true,
        botToken: "test-token",
        chatId: 42,
        timeoutMs: 1000
      }
    ]
  }, {
    kind: "permission_request",
    agentId: "codex-cli",
    agentLabel: "Codex CLI",
    text: "Command approval requested.",
    metadata: {
      requestId: "codex-99",
      threadId: "thread-e2e"
    }
  });

  assert.equal(results[0].ok, true);
  const messageCall = calls.find((call) => call.body.reply_markup);
  assert.ok(messageCall, JSON.stringify(calls));
  assert.match(messageCall.url, /\/sendMessage$/);
  assert.deepEqual(messageCall.body.reply_markup.inline_keyboard[0], [
    { text: "Approve", callback_data: "legax:approve:codex-99" },
    { text: "Deny", callback_data: "legax:deny:codex-99" }
  ]);
  assert.equal(messageCall.body.parse_mode, "HTML");
});

test("Telegram project callbacks route to session lists with project refs", async (t) => {
  await fs.mkdir(dataDir, { recursive: true });
  const runtimeStatePath = path.join(
    dataDir,
    `runtime-state-telegram-project-callback-${process.pid}-${Date.now()}.json`
  ).replaceAll("\\", "/");
  t.after(() => removeTempFiles(runtimeStatePath));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/answerCallbackQuery")) {
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      ok: true,
      result: [
        {
          update_id: 300,
          callback_query: {
            id: "callback-project",
            data: "legax:project:gemini-cli:2",
            from: { id: 42 },
            message: { chat: { id: 42 } }
          }
        }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const config = {
    sessionId: "telegram-project-callback-e2e",
    runtimeStatePath,
    routing: { defaultTarget: "none" },
    gemini: {
      enabled: true,
      agentId: "gemini-cli"
    },
    transports: [
      {
        name: "telegram",
        type: "telegram",
        enabled: true,
        botToken: "test-token",
        chatId: 42,
        pollerAgentId: "gemini-cli",
        timeoutMs: 1000
      }
    ]
  };

  const messages = await pollInboundTransports(config, { agentId: "gemini-cli" });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].action, "list_agent_sessions");
  assert.equal(messages[0].targetAgentId, "gemini-cli");
  assert.equal(messages[0].projectRef, "2");
});

test("Telegram paged project callbacks preserve project refs and page numbers", async (t) => {
  await fs.mkdir(dataDir, { recursive: true });
  const runtimeStatePath = path.join(
    dataDir,
    `runtime-state-telegram-paged-project-${process.pid}-${Date.now()}.json`
  ).replaceAll("\\", "/");
  t.after(() => removeTempFiles(runtimeStatePath));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("/answerCallbackQuery")) {
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      ok: true,
      result: [
        {
          update_id: 310,
          callback_query: {
            id: "callback-chat-page",
            data: "legax:project:claude-code:chats:2",
            from: { id: 42 },
            message: { chat: { id: 42 } }
          }
        },
        {
          update_id: 311,
          callback_query: {
            id: "callback-project-page",
            data: "legax:projects:claude-code:3",
            from: { id: 42 },
            message: { chat: { id: 42 } }
          }
        }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const config = {
    sessionId: "telegram-paged-project-e2e",
    runtimeStatePath,
    routing: {
      defaultTarget: "none"
    },
    claude: {
      enabled: true,
      agentId: "claude-code"
    },
    transports: [
      {
        name: "telegram",
        type: "telegram",
        enabled: true,
        botToken: "test-token",
        chatId: 42,
        timeoutMs: 1000
      }
    ]
  };

  const messages = await pollInboundTransports(config, { agentId: "claude-code" });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].action, "list_agent_sessions");
  assert.equal(messages[0].projectRef, "chats");
  assert.equal(messages[0].page, 2);
  assert.equal(messages[1].action, "list_agent_projects");
  assert.equal(messages[1].page, 3);
});

test("Telegram outbound messageDetail filters noisy events and supports per-agent overrides", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      body: options.body ? JSON.parse(options.body) : {}
    });
    return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const config = {
    notifications: {
      telegram: {
        messageDetail: "actionable",
        perAgent: {
          "codex-cli": {
            messageDetail: "final"
          }
        }
      }
    },
    transports: [
      {
        name: "telegram",
        type: "telegram",
        enabled: true,
        botToken: "test-token",
        chatId: 42,
        timeoutMs: 1000
      }
    ]
  };

  const skipped = await dispatchAdditionalTransports(config, {
    kind: "status",
    agentId: "claude-code",
    agentLabel: "Claude Code",
    text: "Claude Code link connected."
  });
  assert.equal(skipped[0].ok, true);
  assert.equal(skipped[0].result.skipped, true);
  assert.equal(calls.length, 0);

  const suppressed = await dispatchAdditionalTransports(config, {
    kind: "status",
    agentId: "claude-code",
    agentLabel: "Claude Code",
    text: "Claude Code link connected.",
    metadata: {
      telegramSuppress: true,
      telegramReplyMarkup: {
        inline_keyboard: [[{ text: "Sessions", callback_data: "legax:sessions:claude-code" }]]
      }
    }
  });
  assert.equal(suppressed[0].ok, true);
  assert.equal(suppressed[0].result.skipped, true);
  assert.equal(calls.length, 0);

  await dispatchAdditionalTransports(config, {
    kind: "permission_request",
    agentId: "claude-code",
    agentLabel: "Claude Code",
    text: "Allow this tool?",
    metadata: {
      requestId: "claude-1"
    }
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.text, /Approval/);

  await dispatchAdditionalTransports(config, {
    kind: "agent_text",
    agentId: "codex-cli",
    agentLabel: "Codex CLI",
    text: "Final answer from Codex.",
    metadata: {
      deliveryReason: "turn_completed"
    }
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1].body.text, /Final answer from Codex/);
});

test("Telegram outbound HTML formats returned messages with compact context and body block", () => {
  const payloads = buildTelegramMessagePayloads({
    transports: []
  }, {
    type: "telegram",
    chatId: 42
  }, {
    kind: "agent_text",
    agentId: "codex-cli",
    agentLabel: "Codex CLI",
    text: "Done & ready.\n<tag>",
    metadata: {
      deliveryReason: "turn_completed",
      projectPath: "F:/workspace/opensource/legax",
      threadTitle: "Fix Telegram formatting"
    }
  });

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].parse_mode, "HTML");
  assert.match(payloads[0].text, /^<b>Codex CLI<\/b> <i>Message<\/i>/);
  assert.match(payloads[0].text, /Dir: <code>F:\/workspace\/opensource\/legax<\/code>/);
  assert.match(payloads[0].text, /Project: <code>legax<\/code>/);
  assert.match(payloads[0].text, /Session: <code>Fix Telegram formatting<\/code>/);
  assert.match(payloads[0].text, /\n\n<b>Agent response<\/b>\n<blockquote>/);
  assert.match(payloads[0].text, /<blockquote>Done &amp; ready\.\n&lt;tag&gt;<\/blockquote>/);
  assert.doesNotMatch(payloads[0].text, /^----------/);
  assert.doesNotMatch(payloads[0].text, /Legax -/);

  const userPayloads = buildTelegramMessagePayloads({
    transports: []
  }, {
    type: "telegram",
    chatId: 42
  }, {
    kind: "agent_text",
    agentId: "codex-cli",
    agentLabel: "Codex CLI",
    text: "Please summarize this session.",
    metadata: {
      author: "user",
      telegramImportant: true,
      threadTitle: "Fix Telegram formatting"
    }
  });

  assert.match(userPayloads[0].text, /\n\n<b>User message<\/b>\n<blockquote>Please summarize this session\.<\/blockquote>/);
});

test("Telegram important mode keeps session selection replies concise", () => {
  const payloads = buildTelegramMessagePayloads({
    notifications: {
      telegram: {
        messageDetail: "important"
      }
    },
    transports: []
  }, {
    type: "telegram",
    chatId: 42
  }, {
    kind: "status",
    agentId: "gemini-cli",
    agentLabel: "Gemini CLI",
    text: "Gemini CLI session selected: Alpha build session",
    metadata: {
      cwd: "F:/workspace/opensource/legax",
      threadTitle: "Alpha build session",
      telegramReplyMarkup: {
        inline_keyboard: [[{ text: "Session", callback_data: "legax:sessions:gemini-cli" }]]
      }
    }
  });

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].parse_mode, "HTML");
  assert.match(payloads[0].text, /^<b>Gemini CLI<\/b> <i>Status<\/i>/);
  assert.match(payloads[0].text, /Dir: <code>F:\/workspace\/opensource\/legax<\/code>/);
  assert.match(payloads[0].text, /Session: <code>Alpha build session<\/code>/);
  assert.match(payloads[0].text, /\n\n<b>Selection<\/b>\n<blockquote>Gemini CLI session selected: Alpha build session<\/blockquote>/);
  assert.doesNotMatch(payloads[0].text, /^----------/);
  assert.ok(payloads[0].reply_markup);
});

test("Telegram active session messages use Get messages instead of Use this session", () => {
  const payloads = buildTelegramMessagePayloads({
    transports: []
  }, {
    type: "telegram",
    chatId: 42
  }, {
    kind: "agent_text",
    agentId: "gemini-cli",
    agentLabel: "Gemini CLI",
    text: "Current session update.",
    metadata: {
      threadId: "gemini-session-1",
      threadTitle: "Alpha build session",
      activeSession: true
    }
  });

  const buttons = payloads[0].reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((button) => button.text === "Get messages" && button.callback_data === "legax:session:gemini-cli:gemini-session-1"));
  assert.ok(!buttons.some((button) => button.text === "Use this session"));
});

test("Telegram outbound pins active CLI project session context", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let pinnedMessageId = null;
  globalThis.fetch = async (url, options = {}) => {
    const method = String(url).split("/").pop();
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ url: String(url), method, body });
    if (method === "sendMessage") {
      return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (method === "getChat") {
      return new Response(JSON.stringify({
        ok: true,
        result: pinnedMessageId
          ? { pinned_message: { message_id: pinnedMessageId, text: "active: Alpha build session" } }
          : {}
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (method === "pinChatMessage") {
      pinnedMessageId = body.message_id;
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (method === "editMessageText") {
      return new Response(JSON.stringify({ ok: true, result: { message_id: body.message_id } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (method === "deleteMessage") {
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const config = {
    transports: [
      {
        name: "telegram-pin-test",
        type: "telegram",
        enabled: true,
        botToken: "test-token",
        chatId: 4242,
        timeoutMs: 1000
      }
    ]
  };
  const event = {
    kind: "status",
    agentId: "gemini-cli",
    agentLabel: "Gemini CLI",
    text: "Gemini CLI session selected: Alpha build session",
    metadata: {
      agentId: "gemini-cli",
      agentLabel: "Gemini CLI",
      projectName: "alpha",
      cwd: "F:/workspace/alpha",
      threadId: "gemini-alpha-1",
      threadTitle: "Alpha build session",
      telegramReplyMarkup: {
        inline_keyboard: [[{ text: "Session", callback_data: "legax:sessions:gemini-cli" }]]
      }
    }
  };

  const first = await dispatchAdditionalTransports(config, event);
  assert.equal(first[0].ok, true);
  assert.equal(first[0].result.pinnedContext.pinned, true);
  assert.equal(calls[0].method, "getChat");
  assert.equal(calls[1].method, "sendMessage");
  assert.match(calls[1].body.text, /^<b>active:<\/b> <code>Alpha build session<\/code>/);
  assert.doesNotMatch(calls[1].body.text, /^<b>Active Legax target<\/b>/);
  assert.doesNotMatch(calls[1].body.text, /^Session:/m);
  assert.ok(calls[1].body.text.indexOf("active:") < calls[1].body.text.indexOf("Project:"));
  assert.ok(calls[1].body.text.indexOf("Project:") < calls[1].body.text.indexOf("CLI:"));
  assert.match(calls[1].body.text, /Project: <code>alpha<\/code>/);
  assert.match(calls[1].body.text, /CLI: <code>Gemini CLI<\/code>/);
  assert.equal(calls[2].method, "pinChatMessage");
  assert.equal(calls[2].body.message_id, 2);
  assert.equal(calls[3].method, "sendMessage");

  const second = await dispatchAdditionalTransports(config, {
    ...event,
    text: "Gemini CLI session selected: Beta release session",
    metadata: {
      ...event.metadata,
      projectName: "beta",
      cwd: "F:/workspace/beta",
      threadId: "gemini-beta-1",
      threadTitle: "Beta release session"
    }
  });
  assert.equal(second[0].ok, true);
  assert.equal(second[0].result.pinnedContext.replaced, true);
  assert.equal(second[0].result.pinnedContext.previousMessageId, 2);
  assert.equal(second[0].result.pinnedContext.oldDeleted, true);
  assert.equal(calls.filter((call) => call.method === "pinChatMessage").length, 2);
  const betaContext = calls.find((call) => call.method === "sendMessage" && /Beta release session/.test(call.body.text ?? ""));
  assert.ok(betaContext, JSON.stringify(calls));
  assert.match(betaContext.body.text, /^<b>active:<\/b> <code>Beta release session<\/code>/);
  assert.doesNotMatch(betaContext.body.text, /^Session:/m);
  assert.deepEqual(calls.filter((call) => call.method === "deleteMessage").map((call) => call.body.message_id), [2]);
});

test("Telegram outbound reuses an existing Legax pinned context", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const method = String(url).split("/").pop();
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ url: String(url), method, body });
    if (method === "getChat") {
      return new Response(JSON.stringify({
        ok: true,
        result: {
          pinned_message: {
            message_id: 77,
            text: "Active Legax target\nSession: old"
          }
        }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (method === "editMessageText") {
      return new Response(JSON.stringify({ ok: true, result: { message_id: body.message_id } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (method === "sendMessage") {
      return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await dispatchAdditionalTransports({
    transports: [
      {
        name: "telegram-existing-pin-test",
        type: "telegram",
        enabled: true,
        botToken: "test-token",
        chatId: 4343,
        timeoutMs: 1000
      }
    ]
  }, {
    kind: "status",
    agentId: "claude-code",
    agentLabel: "Claude Code",
    text: "Claude Code context update: Existing session",
    metadata: {
      agentId: "claude-code",
      agentLabel: "Claude Code",
      projectName: "docs",
      threadId: "claude-docs-1",
      threadTitle: "Existing session",
      telegramReplyMarkup: {
        inline_keyboard: [[{ text: "Session", callback_data: "legax:sessions:claude-code" }]]
      }
    }
  });

  assert.equal(result[0].ok, true);
  assert.equal(result[0].result.pinnedContext.edited, true);
  assert.equal(result[0].result.pinnedContext.messageId, 77);
  assert.equal(calls.filter((call) => call.method === "pinChatMessage").length, 0);
  const edit = calls.find((call) => call.method === "editMessageText");
  assert.ok(edit, JSON.stringify(calls));
  assert.equal(edit.body.message_id, 77);
  assert.match(edit.body.text, /^<b>active:<\/b> <code>Existing session<\/code>/);
  assert.doesNotMatch(edit.body.text, /^Session:/m);
  assert.ok(edit.body.text.indexOf("active:") < edit.body.text.indexOf("Project:"));
  assert.ok(edit.body.text.indexOf("Project:") < edit.body.text.indexOf("CLI:"));
});

test("Telegram outbound replaces an existing Legax context when a session is selected", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const method = String(url).split("/").pop();
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ url: String(url), method, body });
    if (method === "getChat") {
      return new Response(JSON.stringify({
        ok: true,
        result: {
          pinned_message: {
            message_id: 88,
            text: "active: Active work"
          }
        }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (method === "editMessageText") {
      return new Response(JSON.stringify({ ok: true, result: { message_id: body.message_id } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (method === "sendMessage") {
      return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (method === "pinChatMessage") {
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (method === "deleteMessage") {
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const config = {
    transports: [
      {
        name: "telegram-existing-repin-test",
        type: "telegram",
        enabled: true,
        botToken: "test-token",
        chatId: 4646,
        timeoutMs: 1000
      }
    ]
  };
  const event = {
    kind: "status",
    agentId: "codex-cli",
    agentLabel: "Codex CLI",
    text: "Selected Codex session: Active work",
    metadata: {
      agentId: "codex-cli",
      agentLabel: "Codex CLI",
      projectName: "legax",
      cwd: "F:/workspace/legax",
      threadId: "codex-active-1",
      threadTitle: "Active work",
      telegramReplyMarkup: {
        inline_keyboard: [[{ text: "Session", callback_data: "legax:sessions:codex-cli" }]]
      }
    }
  };

  const first = await dispatchAdditionalTransports(config, event);

  assert.equal(first[0].ok, true);
  assert.equal(first[0].result.pinnedContext.replaced, true);
  assert.equal(first[0].result.pinnedContext.messageId, 99);
  assert.equal(calls.filter((call) => call.method === "sendMessage").length, 2);
  const contextMessage = calls.find((call) => call.method === "sendMessage" && /^<b>active:<\/b> <code>Active work<\/code>/.test(call.body.text ?? ""));
  assert.ok(contextMessage, JSON.stringify(calls));
  assert.doesNotMatch(contextMessage.body.text, /^Session:/m);
  assert.deepEqual(calls.filter((call) => call.method === "pinChatMessage").map((call) => call.body.message_id), [99]);
  assert.deepEqual(calls.filter((call) => call.method === "deleteMessage").map((call) => call.body.message_id), [88]);
});

test("Telegram outbound repins active context after the user unpins it", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const method = String(url).split("/").pop();
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ url: String(url), method, body });
    if (method === "getChat") {
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (method === "sendMessage") {
      return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (method === "pinChatMessage") {
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const config = {
    transports: [
      {
        name: "telegram-repin-test",
        type: "telegram",
        enabled: true,
        botToken: "test-token",
        chatId: 4545,
        timeoutMs: 1000
      }
    ]
  };
  const event = {
    kind: "status",
    agentId: "codex-cli",
    agentLabel: "Codex CLI",
    text: "Selected Codex session: Active work",
    metadata: {
      agentId: "codex-cli",
      agentLabel: "Codex CLI",
      projectName: "legax",
      cwd: "F:/workspace/legax",
      threadId: "codex-active-1",
      threadTitle: "Active work",
      telegramReplyMarkup: {
        inline_keyboard: [[{ text: "Session", callback_data: "legax:sessions:codex-cli" }]]
      }
    }
  };

  const first = await dispatchAdditionalTransports(config, event);
  const second = await dispatchAdditionalTransports(config, event);

  assert.equal(first[0].ok, true);
  assert.equal(second[0].ok, true);
  assert.equal(first[0].result.pinnedContext.pinned, true);
  assert.equal(second[0].result.pinnedContext.pinned, true);
  assert.equal(calls.filter((call) => call.method === "getChat").length, 2);
  assert.equal(calls.filter((call) => call.method === "pinChatMessage").length, 2);
});

test("Telegram notification policy merges daemon, CLI, and remote transport layers", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      body: options.body ? JSON.parse(options.body) : {}
    });
    return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const baseTransport = {
    name: "telegram",
    type: "telegram",
    enabled: true,
    botToken: "test-token",
    chatId: 42,
    timeoutMs: 1000
  };
  const config = {
    daemon: {
      notifications: {
        telegram: {
          messageDetail: "actionable"
        }
      }
    },
    codex: {
      agentId: "codex-cli",
      notifications: {
        telegram: {
          messageDetail: "final"
        }
      }
    },
    transports: [
      {
        ...baseTransport,
        notifications: {
          maxMessageChars: 600
        }
      }
    ]
  };

  const skippedStatus = await dispatchAdditionalTransports(config, {
    kind: "status",
    agentId: "claude-code",
    agentLabel: "Claude Code",
    text: "Claude Code link connected."
  });
  assert.equal(skippedStatus[0].ok, true);
  assert.equal(skippedStatus[0].result.skipped, true);
  assert.equal(calls.length, 0);

  await dispatchAdditionalTransports(config, {
    kind: "agent_text",
    agentId: "codex-cli",
    agentLabel: "Codex CLI",
    text: "Codex final answer.",
    metadata: {
      deliveryReason: "turn_completed"
    }
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.text, /Codex final answer/);
  assert.ok(calls[0].body.text.length <= 600);

  const mutedByRemote = await dispatchAdditionalTransports({
    ...config,
    transports: [
      {
        ...baseTransport,
        notifications: {
          perAgent: {
            "codex-cli": {
              messageDetail: "none"
            }
          }
        }
      }
    ]
  }, {
    kind: "agent_text",
    agentId: "codex-cli",
    agentLabel: "Codex CLI",
    text: "This should not reach Telegram.",
    metadata: {
      deliveryReason: "turn_completed"
    }
  });
  assert.equal(mutedByRemote[0].ok, true);
  assert.equal(mutedByRemote[0].result.skipped, true);
  assert.equal(calls.length, 1);
});

test("Telegram outbound long messages are HTML-formatted and split under the configured limit", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      body: options.body ? JSON.parse(options.body) : {}
    });
    return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const longText = Array.from({ length: 90 }, (_, index) => `Line ${index + 1}: <tag & value>`).join("\n");
  const results = await dispatchAdditionalTransports({
    notifications: {
      telegram: {
        messageDetail: "important",
        maxMessageChars: 600,
        maxParts: 4
      }
    },
    transports: [
      {
        name: "telegram",
        type: "telegram",
        enabled: true,
        botToken: "test-token",
        chatId: 42,
        timeoutMs: 1000
      }
    ]
  }, {
    kind: "agent_text",
    agentId: "codex-cli",
    agentLabel: "Codex CLI",
    text: longText,
    metadata: {
      deliveryReason: "turn_completed",
      threadTitle: "Long result"
    }
  });

  assert.equal(results[0].ok, true);
  assert.equal(results[0].result.messageCount, calls.length);
  assert.ok(calls.length > 1);
  for (const call of calls) {
    assert.equal(call.body.parse_mode, "HTML");
    assert.ok(call.body.text.length <= 600, `message was ${call.body.text.length} chars`);
    assert.match(call.body.text, /&lt;tag &amp; value&gt;/);
  }
  assert.match(calls[0].body.text, /\(1\/4\)/);
});
