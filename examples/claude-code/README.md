# Claude Code Example

English | [Simplified Chinese](README.zh-CN.md)

This example shows the smallest Claude Code-specific review path in Legax. Use it when you want to inspect the Claude adapter, permission-prompt MCP bridge, and expected verification commands.

## Config Section

Start from [`../../config.example.yaml`](../../config.example.yaml), then review the `claude:` section:

```yaml
claude:
  enabled: true
  autoStart: true
  agentId: claude-code
  agentLabel: Claude Code
  cliBackend: stream-json
  useExisting: true
  continueLatest: true
  mcpEnabled: true
  mcpAutoConfigure: true
  mcpRole: permission-prompt
  mode: approval-only
  command: claude
  args:
    - -p
    - --input-format
    - stream-json
    - --output-format
    - stream-json
    - --verbose
  permissionPromptTool: mcp__legax_permissions__approval_prompt
  permissionBehaviorOnApprove: allow
  permissionBehaviorOnDeny: deny
  mcpConfigPath: ./data/claude-permission-mcp.json
```

Keep `mode: approval-only` when you only want phone-side approval decisions. Use `interactive` only when the phone should also be allowed to send text into Claude Code.

## Local Review Flow

```bash
npm run check:docs
node --test tests/e2e/claude-code-link.e2e.mjs
node --test tests/e2e/claude-permission-mcp.e2e.mjs
```

For a real Claude Code smoke test, install Claude Code locally and opt in:

```bash
LEGAX_REAL_CLIENTS=1 npm run test:e2e:real
```

## Safety Notes

- Legax returns phone decisions through Claude Code's permission-prompt MCP path.
- Legax must not simulate terminal approvals or click native UI.
- Do not commit generated Claude MCP config under `data/` or machine-specific local settings.
- See [Claude Code Integration](../../docs/CLAUDE_CODE_INTEGRATION.md) for the full review path.
