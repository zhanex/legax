# Claude Code Integration

English | [Simplified Chinese](CLAUDE_CODE_INTEGRATION.zh-CN.md)

This document gives Claude Code and MCP ecosystem contributors a focused review path for Legax's Claude Code adapter.

Legax is not affiliated with, endorsed by, or sponsored by Anthropic. The integration uses Claude Code's CLI and permission-prompt MCP surfaces where available.

## What Legax Adds

Legax lets a phone or Telegram user monitor and respond to Claude Code sessions without controlling the terminal UI:

- forwards Claude Code status, assistant output, completion, and permission events to configured transports
- routes selected phone text to Claude Code through the adapter's stdin path
- continues or resumes persisted Claude Code sessions with `--continue` or `--resume <id>`
- mirrors permission requests to the phone through a Claude-specific MCP server
- returns approved or denied decisions through Claude Code's permission-prompt tool result

The goal is remote coordination, not terminal automation.

## Runtime Path

The Claude Code adapter is [`../scripts/claude-code-link.mjs`](../scripts/claude-code-link.mjs). It runs Claude Code in print mode with stream JSON:

```yaml
claude:
  enabled: true
  cliBackend: stream-json
  command: claude
  args:
    - -p
    - --input-format
    - stream-json
    - --output-format
    - stream-json
    - --verbose
```

When `useExisting: true`, the adapter can add `--continue` or `--resume <id>` so remote turns land in Claude Code's persisted history.

## Permission-Prompt MCP Path

Claude permissions use [`../scripts/claude-permission-mcp-server.mjs`](../scripts/claude-permission-mcp-server.mjs), a dedicated MCP server that exposes one tool:

```text
approval_prompt
```

With `mcpAutoConfigure: true`, the daemon writes a Claude MCP config for the permission server before launch. The adapter then passes Claude Code the configured permission prompt tool:

```yaml
claude:
  mcpEnabled: true
  mcpAutoConfigure: true
  mcpRole: permission-prompt
  permissionPromptTool: mcp__legax_permissions__approval_prompt
  permissionBehaviorOnApprove: allow
  permissionBehaviorOnDeny: deny
  mcpConfigPath: ./data/claude-permission-mcp.json
```

Decision flow:

1. Claude Code asks its permission-prompt tool.
2. Legax MCP posts a `permission_request` event to relay, Telegram, or webhook transports.
3. The phone user approves or denies.
4. Legax polls for the matching `permission_decision`.
5. The MCP tool returns `allow` or `deny` to Claude Code.

If the phone decision times out, Legax uses the configured timeout behavior instead of silently approving.

## Security Boundaries

Legax must preserve Claude Code's native security model:

- no UI scraping
- no simulated terminal keypresses for approvals
- no auto-approval of native prompts
- no shared hosted backend operated by the Legax maintainers
- no secrets committed to the repository

Phone approval decisions are honored only when the adapter mode allows them. `monitor` and `paused` block phone approvals.

## Current Limitations

- Real Claude Code compatibility tests are opt-in and require a local Claude Code installation.
- Legax depends on Claude Code's permission-prompt tool contract for approval return values.
- The adapter is designed for one local operator's own desktop sessions, not multi-tenant SaaS control.

## Review Questions For Ecosystem Maintainers

Useful feedback from Claude Code or MCP maintainers would include:

- Does the permission-prompt MCP lifecycle match intended Claude Code usage?
- Are `allow` and `deny` the right decision values for this bridge?
- Should timeout behavior be represented differently?
- Are there edge cases where a permission request should include more structured metadata?
- Are there compatibility risks with future Claude Code session or stream-json changes?

## Verification

Local documentation checks:

```bash
npm run check:docs
```

Adapter and permission MCP tests:

```bash
node --test tests/e2e/claude-code-link.e2e.mjs
node --test tests/e2e/claude-permission-mcp.e2e.mjs
```

Opt-in real-client smoke coverage:

```bash
LEGAX_REAL_CLIENTS=1 npm run test:e2e:real
```
