# Feishu and Lark Transport

English | [Simplified Chinese](FEISHU_LARK.zh-CN.md)

Legax can deliver agent events to a Feishu or Lark app bot and receive text replies or approval button decisions through the relay's Feishu event endpoint.

Use this transport when your team already works from Feishu China or Lark global and wants the same remote-control surface that Telegram provides, without changing the native approval model of Codex, Claude Code, Gemini CLI, or OpenCode.

## Current Scope

- Outbound app-bot messages through `POST /open-apis/im/v1/messages`.
- Automatic tenant access token retrieval from `appId` and `appSecret`.
- Interactive cards for permission requests, with Approve and Deny buttons.
- Text or interactive cards for normal status, input, and assistant events.
- Inbound event callback endpoint at `/api/feishu/events`.
- URL verification challenge responses for Feishu/Lark event subscription setup.
- Inbound text messages and card button callbacks converted into the same relay message model used by the browser phone UI.

Custom bot webhook delivery is also supported for send-only notification experiments through `webhookUrl` or `botWebhookUrl`, but bidirectional routing requires a self-built app bot plus the relay callback endpoint.

Encrypted event callbacks are not decrypted by Legax in this release. Leave Feishu/Lark event encryption disabled, or place a small gateway in front of the relay that decrypts the callback and forwards the plain event body to `/api/feishu/events`.

## Configuration

Copy the disabled `feishu` block from `config.example.yaml` into your local `config.yaml` and fill only placeholders:

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

Set `platform: lark` or `apiBaseUrl: https://open.larksuite.com` for Lark global. The default platform is Feishu China through `https://open.feishu.cn`.

Configure the Feishu/Lark app event subscription request URL to:

```text
https://YOUR_RELAY_HOST/api/feishu/events?sessionId=default
```

Use the session id from your `config.yaml` if it is not `default`. The relay must be reachable over public HTTPS for Feishu/Lark to call it.

## Event Routing

The relay verifies each Feishu/Lark callback with `verificationToken`. It rejects callbacks when the token is missing or mismatched.

Inbound text is routed to:

1. `transports[].defaultTarget`, if set.
2. `routing.defaultTarget`, if set.
3. No agent, when both are `none` or empty.

Permission card actions carry `requestId` and `targetAgentId` in the card button value. The relay turns them into `permission_decision` messages and stores them in the normal relay message queue. The daemon or adapter then handles them through the existing relay polling path.

## Safety

Legax only mirrors native agent approval prompts. It does not auto-approve, click native UI, or bypass the security policy of any agent.

Do not paste real app secrets, verification tokens, chat ids, or callback payloads into GitHub issues. Use placeholders and rotate any exposed credentials before sharing logs.
