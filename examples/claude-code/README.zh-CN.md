# Claude Code 示例

[English](README.md) | 简体中文

这个示例提供 Legax 中最小的 Claude Code 专属审查路径。需要检查 Claude adapter、permission-prompt MCP bridge 和期望验证命令时，从这里开始。

## 配置段落

先从 [`../../config.example.zh-CN.yaml`](../../config.example.zh-CN.yaml) 开始，然后审查 `claude:` 段：

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

只希望手机处理审批决策时，保持 `mode: approval-only`。只有当手机也应该向 Claude Code 发送文本时，才使用 `interactive`。

## 本地审查流程

```bash
npm run check:docs
node --test tests/e2e/claude-code-link.e2e.mjs
node --test tests/e2e/claude-permission-mcp.e2e.mjs
```

如果要做真实 Claude Code 烟测，先在本机安装 Claude Code，然后显式 opt in：

```bash
LEGAX_REAL_CLIENTS=1 npm run test:e2e:real
```

## 安全说明

- Legax 通过 Claude Code permission-prompt MCP 路径返回手机决策。
- Legax 不能模拟终端审批，也不能点击原生 UI。
- 不要提交 `data/` 下生成的 Claude MCP 配置或机器特定本地设置。
- 完整审查路径见 [Claude Code 集成](../../docs/CLAUDE_CODE_INTEGRATION.zh-CN.md)。
