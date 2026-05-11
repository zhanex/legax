#!/usr/bin/env node

const args = process.argv.slice(2);
if (args.includes("--list-sessions")) {
  if (process.env.LEGAX_FAKE_GEMINI_PROJECT_SESSIONS === "1") {
    process.stdout.write(`${JSON.stringify({
      sessions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          index: 1,
          name: "Alpha build session",
          preview: "work on alpha",
          cwd: `${process.cwd()}/alpha`
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          index: 2,
          name: "Beta release session",
          preview: "work on beta",
          cwd: `${process.cwd()}/beta`
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          index: 3,
          name: "General chat session",
          preview: "unscoped chat"
        }
      ]
    })}\n`);
    process.exit(0);
  }
  process.stdout.write([
    "",
    "Available sessions for this project (2):",
    "  1. Fake Gemini first session. (1 minute ago) [11111111-1111-4111-8111-111111111111]",
    "  2. Fake Gemini second session. (2 minutes ago) [22222222-2222-4222-8222-222222222222]",
    ""
  ].join("\n"));
  process.exit(0);
}
const promptIndex = args.findIndex((arg) => arg === "--prompt" || arg === "-p");
const prompt = promptIndex >= 0 ? args[promptIndex + 1] : args[args.length - 1] ?? "";
const approvalModeIndex = args.findIndex((arg) => arg === "--approval-mode" || arg.startsWith("--approval-mode="));
const approvalMode = approvalModeIndex >= 0
  ? args[approvalModeIndex].includes("=")
    ? args[approvalModeIndex].split("=").slice(1).join("=")
    : args[approvalModeIndex + 1]
  : "";

write({ type: "init", model: "fake-gemini", session_id: "fake-gemini-session" });
write({
  type: "tool_use",
  name: "ShellTool",
  args: {
    command: "echo fake",
    approvalMode,
    resumeTarget: resumeTarget(args),
    promptMode: promptIndex >= 0 ? "flag" : "positional"
  }
});
write({
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: `gemini echo: ${prompt}` }]
});
write({
  type: "result",
  response: `gemini echo: ${prompt}`,
  stats: { input_tokens: 1, output_tokens: 1 }
});

function write(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function resumeTarget(values) {
  const index = values.findIndex((arg) => arg === "--resume" || arg === "-r" || arg.startsWith("--resume="));
  if (index < 0) return "";
  if (values[index].includes("=")) return values[index].split("=").slice(1).join("=");
  return values[index + 1] ?? "";
}
