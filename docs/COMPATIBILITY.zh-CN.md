# 兼容性矩阵

[English](COMPATIBILITY.md) | 简体中文

本文档记录 Legax 对每个受支持外部 CLI 或平台的期望。它不是 vendor guarantee；它是维护者处理兼容性敏感改动时的检查清单。

## Runtime 基线

| 组件 | 必需基线 | 说明 |
| --- | --- | --- |
| Node.js | 18 或更新版本 | 运行脚本只使用标准库；不需要项目 `node_modules`。 |
| Shell 脚本 | 通过 `bash -n` 检查的 POSIX shell 语法 | Installer 和 service 脚本必须保持可语法检查。 |
| Config | Legax YAML 子集 | 明确不支持 JSON config。 |

## Agent CLI

| Adapter | Backend | 需要的外部能力 | Session 支持 | Approval 支持 | 已知限制 |
| --- | --- | --- | --- | --- | --- |
| Codex CLI | `app-server-ws` | 共享 `codex app-server --listen ws://...` JSON-RPC endpoint。 | 通过 app-server API list、resume 和 start thread。 | 通过 `requestApproval` 等 JSON-RPC approval callback 支持。 | Codex desktop 内嵌 stdio app-server 不是共享 backend，除非 Codex 暴露受支持 listener。 |
| Codex Desktop Mirror | `session-jsonl-tail` | 可读取 Codex desktop session JSONL 文件。 | 观察 latest 或 selected JSONL 活动。 | 不支持；read-only mirror。 | 不能向 desktop session 注入手机文本。 |
| Claude Code | `stream-json` | 带 stream-json input/output 的 `claude -p`。 | existing-session mode 使用持久 history 中的 `--continue` 或 `--resume <id>`。 | 通过 Claude permission-prompt MCP 支持。 | 前台 TUI 不一定会从 headless resumed turn 实时更新。 |
| Gemini CLI | 每个 headless turn 使用 `stream-json` | `gemini --output-format stream-json` 和 `--prompt`。 | existing-session mode 使用 `--resume latest` 或配置 id；list 使用 `--list-sessions`。 | 由 Gemini CLI approval mode 控制。 | daemon/headless 在 untrusted directory 中需要 `trustWorkspace: true`。 |
| OpenCode | `server-http` | `opencode serve` HTTP API。 | 通过 `GET /session` list session；通过 `POST /session/:id/message` 发送文本。 | 原生 permission callback bridge 尚未实现。 | 配置 `serverPassword` 时使用 Basic Auth。 |

## 远端 Surface

| Surface | 必需能力 | Ingress owner | 说明 |
| --- | --- | --- | --- |
| Relay browser | HTTP(S)、paired device cookie | Relay | 浏览器永远不接收 desktop secret。 |
| Telegram | Bot API polling 或 webhook | 启用 relay transport 时归 relay；direct polling 仅作为 no-relay fallback | Telegram callback data 必须紧凑且包含 target。 |
| Feishu/Lark | App bot send API 和 event subscription | Relay | 加密 callback 目前需要上游 decrypting gateway。 |
| Webhook | 操作者拥有的 HTTP endpoint | 仅出站 | 接收方看到配置的 event payload。 |

## 兼容性变更规则

- 外部 CLI 协议形状变化时，同时更新 adapter、focused E2E fixture、必要时的 real-client 说明，以及本矩阵。
- 只有 CLI 暴露原生 callback 或 permission mechanism 时，adapter 才能声明 approval support。
- 任何 PTY/TUI fallback 必须记录为 high-trust remote terminal control。
- Real-client 测试继续使用 `LEGAX_REAL_CLIENTS=1` opt-in。
- 文档化命令行变化时，中英文文档必须同一改动更新。

## 审查清单

合并兼容性敏感改动前：

- 实际覆盖了哪个外部版本或协议行为？
- 是否有 fake fixture test？
- 是否需要 real-client smoke test，或已有覆盖？
- 外部 CLI binary 缺失时会怎样？
- session listing 不支持或为空时会怎样？
- fallback 是否保留 permission boundary？
