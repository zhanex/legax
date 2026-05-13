# 飞书与 Lark Transport

[English](FEISHU_LARK.md) | 简体中文

Legax 可以把 Agent 事件投递到飞书或 Lark 自建应用 bot，并通过 relay 的飞书事件端点接收文本回复和审批按钮决策。

如果团队已经把飞书中国区或 Lark 国际区作为移动工作台，又希望获得类似 Telegram 的远程控制入口，可以启用这个 transport；Codex、Claude Code、Gemini CLI 和 OpenCode 的原生审批模型不会被改变。

## 当前范围

- 通过 `POST /open-apis/im/v1/messages` 发送自建应用 bot 消息。
- 根据 `appId` 和 `appSecret` 自动获取 tenant access token。
- 为权限请求发送带 Approve 和 Deny 按钮的交互卡片。
- 为普通状态、输入请求和助手事件发送文本或交互卡片。
- 在 relay 暴露 `/api/feishu/events` 入站事件回调端点。
- 支持飞书/Lark 事件订阅配置时的 URL verification challenge。
- 把入站文本消息和卡片按钮回调转换成浏览器手机 UI 使用的同一套 relay message 模型。

通过 `webhookUrl` 或 `botWebhookUrl` 也可以做自定义机器人 send-only 通知实验；但双向路由需要自建应用 bot 和 relay 回调端点。

当前版本不在 Legax 内解密事件回调。请关闭飞书/Lark 事件加密，或在 relay 前放一个小网关，先解密回调，再把明文事件 body 转发到 `/api/feishu/events`。

## 配置

从 `config.example.zh-CN.yaml` 复制默认关闭的 `feishu` 段到本机 `config.yaml`，只填占位符：

```yaml
transports:
  - name: feishu
    type: feishu
    enabled: true
    platform: feishu
    appId: FEISHU_APP_ID_VALUE_HERE
    appSecret: FEISHU_APP_SECRET_VALUE_HERE
    receiveIdType: chat_id
    receiveId: FEISHU_CHAT_ID_VALUE_HERE
    verificationToken: FEISHU_EVENT_VERIFICATION_TOKEN
    # encryptKey: FEISHU_EVENT_ENCRYPT_KEY_VALUE_HERE
    defaultTarget: codex-cli
    timeoutMs: 15000
    notifications:
      messageDetail: important
```

Lark 国际区可设置 `platform: lark`，或显式设置 `apiBaseUrl: https://open.larksuite.com`。默认连接飞书中国区 `https://open.feishu.cn`。

把飞书/Lark 应用的事件订阅请求 URL 配置为：

```text
https://YOUR_RELAY_HOST/api/feishu/events?sessionId=default
```

如果你的 `config.yaml` 中不是 `default` session id，请替换为实际值。relay 必须通过公网 HTTPS 访问，飞书/Lark 才能调用。

## 事件路由

relay 会用 `verificationToken` 校验每个飞书/Lark 回调。token 缺失或不匹配时会拒绝请求。

入站文本按以下顺序确定目标：

1. `transports[].defaultTarget`。
2. `routing.defaultTarget`。
3. 两者均为空或 `none` 时，不路由到任何 Agent。

权限卡片按钮会把 `requestId` 和 `targetAgentId` 放在按钮 value 中。relay 会把它转换为 `permission_decision` 消息，并写入普通 relay 消息队列。daemon 或 adapter 随后通过现有 relay 轮询路径处理。

## 安全边界

Legax 只镜像原生 Agent 审批请求。它不会自动批准、点击原生 UI，也不会绕过任何 Agent 的安全策略。

不要把真实 app secret、verification token、chat id 或回调 payload 粘贴到 GitHub issue。公开日志前请使用占位符，并先轮换任何已经暴露的凭据。
