// Adapter contract — single source of truth for what a Legax adapter must
// declare so the unified daemon can supervise it.
//
// Each adapter in scripts/<name>-link.mjs is an independent long-lived process
// that talks to one CLI agent. The daemon needs only the metadata in the
// contract to start, restart, and on-demand-launch the adapter; per-adapter
// runtime behavior (sessions, approvals, cli-specific args) lives inside the
// adapter script itself.
//
// To register a new adapter:
//   1. Implement scripts/<name>-link.mjs as a runnable script.
//   2. Add a contract entry to ADAPTERS below.
//   3. Add the new section to config.example.yaml + zh-CN.
//   4. Add an E2E test under tests/e2e/<name>-link.e2e.mjs.
//   5. Append the new files to package.json `check:node` and `test:e2e`.
//
// See docs/EXTENDING.md for the full walkthrough.

/**
 * @typedef {Object} AdapterContract
 * @property {string} key             Canonical config key (top-level YAML field). Example: "codex".
 * @property {string} name            Internal adapter name used in log lines and supervisor identity. Usually equal to `key`.
 * @property {string} defaultAgentId  Default `agentId` if the user does not override it in config. Stable across versions.
 * @property {string} label           Human-readable label shown in phone / Telegram menus.
 * @property {string} script          Path (repo-relative) to the adapter entry script.
 * @property {"app-server"|"app-server-ws"|"app-server-proxy"|"stream-json"|string} cliBackend
 *                                    Underlying CLI protocol. Free-form string; the supervisor only inspects it for logs.
 * @property {boolean} mcpEnabled     Whether the adapter can host or write MCP capability config by default.
 * @property {boolean} autoStart      Whether the daemon launches the adapter at startup. Override via `<key>.autoStart`.
 * @property {boolean} [defaultEnabled] Whether the adapter is considered enabled when the config has no `<key>:` section. Defaults to true if omitted; set to false for opt-in adapters (e.g., the desktop mirror).
 */

/** @type {AdapterContract[]} */
export const ADAPTERS = [
  {
    key: "codex",
    name: "codex",
    defaultAgentId: "codex-cli",
    label: "Codex CLI",
    script: "scripts/codex-app-server-link.mjs",
    cliBackend: "app-server",
    mcpEnabled: true,
    autoStart: true
  },
  {
    key: "claude",
    name: "claude",
    defaultAgentId: "claude-code",
    label: "Claude Code",
    script: "scripts/claude-code-link.mjs",
    cliBackend: "stream-json",
    mcpEnabled: true,
    autoStart: true
  },
  {
    key: "gemini",
    name: "gemini",
    defaultAgentId: "gemini-cli",
    label: "Gemini CLI",
    script: "scripts/gemini-cli-link.mjs",
    cliBackend: "stream-json",
    mcpEnabled: true,
    autoStart: true
  },
  {
    key: "opencode",
    name: "opencode",
    defaultAgentId: "opencode",
    label: "OpenCode",
    script: "scripts/opencode-link.mjs",
    cliBackend: "server-http",
    mcpEnabled: false,
    autoStart: false
  },
  {
    // Read-only mirror of the Codex desktop app's session JSONL files. The
    // desktop app cannot accept --remote (see docs/EXTENDING.md), so for users
    // who keep the desktop UI as their primary editor, this adapter forwards
    // user/assistant/tool events to the phone in one direction. Off by default;
    // mutually exclusive with the regular `codex` adapter.
    key: "codexDesktopMirror",
    name: "codex-desktop-mirror",
    defaultAgentId: "codex-desktop",
    label: "Codex Desktop (mirror)",
    script: "scripts/codex-desktop-mirror-link.mjs",
    cliBackend: "session-jsonl-tail",
    mcpEnabled: false,
    autoStart: false,
    defaultEnabled: false
  }
];

/**
 * Throw if the entry is missing required fields. Called by the daemon at
 * startup to fail fast on misconfigured contracts; third-party forks adding new
 * adapters should run their entries through this in their own tests.
 */
export function validateAdapter(entry, index = "?") {
  const required = ["key", "name", "defaultAgentId", "label", "script", "cliBackend"];
  const missing = required.filter((field) => !entry || typeof entry[field] !== "string" || entry[field].length === 0);
  if (missing.length > 0) {
    throw new Error(`adapter contract at index ${index} is missing required string fields: ${missing.join(", ")}`);
  }
  if (typeof entry.mcpEnabled !== "boolean") {
    throw new Error(`adapter contract "${entry.key}" must declare boolean mcpEnabled`);
  }
  if (typeof entry.autoStart !== "boolean") {
    throw new Error(`adapter contract "${entry.key}" must declare boolean autoStart`);
  }
  return entry;
}

export function validateAllAdapters(list = ADAPTERS) {
  const seen = new Set();
  list.forEach((entry, index) => {
    validateAdapter(entry, index);
    if (seen.has(entry.key)) {
      throw new Error(`duplicate adapter key in registry: ${entry.key}`);
    }
    seen.add(entry.key);
  });
  return list;
}
