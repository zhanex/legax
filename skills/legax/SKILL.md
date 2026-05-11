---
name: legax
description: Use when the user wants an agent session bridged to a phone, wants remote replies polled, or wants the agent to ask a phone for approval before sensitive actions.
---

# Legax Skill

English | [Simplified Chinese](SKILL.zh-CN.md)

Use the `legax` MCP tools to relay interaction with the user's phone or configured remote transport.

## Tools

- `legax_send`: send agent text, status updates, or system notices.
- `legax_poll`: fetch remote replies and approval decisions.
- `legax_request_permission`: ask the phone to approve or deny a proposed action.
- `legax_status`: inspect transport configuration and pending permission requests.

## Operating Rules

1. When the user asks to link the session, send a short status message to the phone and then poll for replies when useful.
2. Before a risky action that the user wants handled remotely, call `legax_request_permission` with a clear title, reason, risk level, and action summary.
3. Treat `approve` as consent to continue with the requested agent-mediated action. Treat `deny` or timeout as a stop.
4. Do not claim that this tool can bypass native approval UI. Native escalated approvals still follow the host application's security policy.
5. Avoid sending secrets. By default the MCP server redacts common token patterns; set `allowSensitive` only when the user explicitly requests raw content to be sent.

## Reply Handling

Phone text replies should be treated like user instructions for the current session, subject to the newest-message-wins rule.

When several adapters share one relay session, replies may include `targetAgentId`. Only treat a reply as intended for this agent when it targets this agent, targets `*`, or was fetched from a transport already scoped to this agent.

Permission decision shape:

```json
{
  "type": "permission_decision",
  "requestId": "uuid",
  "decision": "approve"
}
```
