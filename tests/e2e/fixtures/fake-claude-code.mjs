#!/usr/bin/env node

let initialized = false;
let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (!initialized) {
      write({ type: "system", subtype: "init", session_id: "fake-claude-session" });
      initialized = true;
    }
    const text = message.message?.content?.find((part) => part.type === "text")?.text ?? "";
    write({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: `echo: ${text}` }]
      }
    });
    write({ type: "result", result: `echo: ${text}`, is_error: false });
    if (process.env.LEGAX_FAKE_CLAUDE_EXIT_AFTER_MESSAGE === "1") {
      process.exit(0);
    }
  }
});

function write(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
