# 可观测性

[English](OBSERVABILITY.md) | 简体中文

Legax 的可观测性有意保持本地化和低噪音。项目应帮助操作者诊断路由、配对和 adapter 健康状况，但不能把日志变成第二份 transcript store。

## 信号

| 信号 | Owner | 目的 |
| --- | --- | --- |
| 进程 stderr | Daemon、adapter、relay | 本地状态、warning、startup summary 和 error stack。 |
| Relay `/health` 与 `/healthz` | Relay | 基础 HTTP liveness。 |
| Daemon status | `scripts/daemon-control.mjs` 和 daemon dry-run/status path | 本地 runtime、config 和进程可见性。 |
| Relay host record | Relay store | 从 heartbeat expiry 推导多 host online/offline 状态。 |
| Relay audit JSONL | Relay | Metadata-oriented request/event audit tail。 |
| Attention inbox | Relay | 可行动的 approval、input request、error 和 completion。 |
| Transport delivery result | 共享 outbound transport helper | Per-transport send 成功/失败诊断。 |

## 日志规则

- 不记录真实 secret、bot token、relay secret、paired-device cookie、lease token、claim token 或 plaintext checkpoint content。
- 默认日志不包含完整 prompt、完整 command output 或完整 message body。
- Startup summary 应报告 secret 是否配置，而不是值。
- Error message 应指出失败组件和下一步有用上下文，例如 config path、transport name、agent id 或 endpoint path。
- Adapter stdout/stderr 转发必须可配置，并且默认低噪音。

## Audit Log

`relay.audit.enabled` 为 true 时，relay audit 是 append-only JSONL。它记录 metadata 和可配置正文预览：

- `relay.audit.path` 控制文件路径。
- `relay.audit.maxTail` 控制 API 返回多少条记录。
- `relay.audit.textPreview` 控制预览长度，默认为 `0`。
- `relay.audit.textPreview: 0` 表示省略正文预览；大于 `0` 时写入前会先做脱敏。

Audit 不是合规归档，也不是 revocation system。它是 relay host 本地诊断信号。

## Health 与 Status

- `/health` 和 `/healthz` 应保持廉价、无鉴权、无副作用。
- Host online/offline 状态由 heartbeat `expiresAt` 推导；relay 不需要后台 sweeper。
- Daemon status 和 dry-run output 应 redaction-safe。
- 远端 UI offline 状态应引导用户检查 relay URL、pairing、daemon startup 和 adapter 配置。

## Retention

- Relay session event 和 message queue 由 relay 配置限制长度。
- Runtime cursor 防止 restart 后重放旧手机消息。
- Audit retention 超出 `maxTail` read limit 的部分由操作者按文件管理。
- Paired-device revocation 会让浏览器访问失效，但不会轮换 relay 或第三方 transport 凭据。

## Metrics 策略

Legax 不向维护者发送 telemetry。操作者如果在 relay 或 daemon 外部增加监控，需要自己确保 secret 和 message body 不进入这些系统。

## 审查清单

新增诊断能力时：

- 该信号是否回答了一个具体操作者问题？
- 默认是否 redaction-safe？
- 除非操作者明确配置，否则是否避免保存完整 transcript 内容？
- 信号是否位于拥有该状态的组件？
- 文档是否解释 retention 和安全取舍？
