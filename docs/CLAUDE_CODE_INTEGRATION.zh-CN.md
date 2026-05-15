# Claude Code 集成

[English](CLAUDE_CODE_INTEGRATION.md) | 简体中文

本文为 Claude Code 和 MCP 生态贡献者提供一个聚焦的 Legax Claude Code adapter 审查入口。

Legax 不隶属于 Anthropic，未被 Anthropic 认可或赞助。本集成只使用 Claude Code CLI 和可用的 permission-prompt MCP 能力面。

## Legax 补充了什么

Legax 让手机或 Telegram 用户可以监看并回应 Claude Code 会话，同时不接管终端 UI：

- 将 Claude Code 状态、assistant 输出、完成事件和权限事件转发到已配置 transport
- 通过 adapter 的 stdin 路径把选中的手机文本发送给 Claude Code
- 使用 `--continue` 或 `--resume <id>` 继续或恢复 Claude Code 持久化会话
- 通过 Claude 专用 MCP server 将权限请求镜像到手机
- 通过 Claude Code permission-prompt 工具结果返回批准或拒绝决策

目标是远程协作，不是终端自动化。

## 运行路径

Claude Code adapter 是 [`../scripts/claude-code-link.mjs`](../scripts/claude-code-link.mjs)。它以 print mode 和 stream JSON 运行 Claude Code：

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

当 `useExisting: true` 时，adapter 可以添加 `--continue` 或 `--resume <id>`，让远程 turn 进入 Claude Code 的持久化历史。

## Permission-Prompt MCP 路径

Claude 权限通过 [`../scripts/claude-permission-mcp-server.mjs`](../scripts/claude-permission-mcp-server.mjs) 处理。它是一个专用 MCP server，只暴露一个工具：

```text
approval_prompt
```

当 `mcpAutoConfigure: true` 时，daemon 会在启动前写入 Claude MCP 配置。随后 adapter 会把配置好的 permission prompt tool 传给 Claude Code：

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

决策流程：

1. Claude Code 调用自己的 permission-prompt tool。
2. Legax MCP 向 relay、Telegram 或 webhook transport 写入 `permission_request` 事件。
3. 手机用户批准或拒绝。
4. Legax 拉取匹配的 `permission_decision`。
5. MCP 工具向 Claude Code 返回 `allow` 或 `deny`。

如果手机决策超时，Legax 使用配置的超时行为，不会静默批准。

## 安全边界

Legax 必须保留 Claude Code 的原生安全模型：

- 不抓取 UI
- 不用模拟终端按键处理审批
- 不自动批准原生提示
- Legax 维护者不运营共享托管后端
- 不把密钥提交到仓库

只有 adapter mode 允许时才会接受手机审批决策。`monitor` 和 `paused` 会阻止手机审批。

## 当前限制

- 真实 Claude Code 兼容性测试需要本机安装 Claude Code，并且是 opt-in。
- Legax 依赖 Claude Code permission-prompt tool contract 返回审批值。
- adapter 面向单个操作者自己的本地桌面会话，不是多租户 SaaS 控制面。

## 面向生态维护者的审查问题

Claude Code 或 MCP 维护者最有价值的反馈包括：

- permission-prompt MCP 生命周期是否符合 Claude Code 的预期用法？
- `allow` 和 `deny` 是否是这个桥接应返回的正确决策值？
- 超时行为是否应以其他方式表达？
- 权限请求是否还需要更结构化的 metadata？
- 未来 Claude Code session 或 stream-json 变化是否有兼容性风险？

## 验证

本地文档检查：

```bash
npm run check:docs
```

Adapter 与 permission MCP 测试：

```bash
node --test tests/e2e/claude-code-link.e2e.mjs
node --test tests/e2e/claude-permission-mcp.e2e.mjs
```

可选真实客户端烟测：

```bash
LEGAX_REAL_CLIENTS=1 npm run test:e2e:real
```
