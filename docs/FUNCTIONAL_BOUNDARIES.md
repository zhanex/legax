# Functional Boundaries

English | [Simplified Chinese](FUNCTIONAL_BOUNDARIES.zh-CN.md)

This document describes Legax from a business workflow perspective. It defines what the product does, which component owns each responsibility, and how the web relay, Telegram, and Feishu/Lark interactions close the loop from a remote user action back to a local CLI agent.

## Product Boundary

Legax is a local-first remote interaction layer for coding-agent CLIs. It lets a user leave the workstation while still seeing important agent events, choosing the target CLI/project/session, replying to the agent, and approving or denying native permission prompts.

Legax is not a multi-user SaaS, not a hosted agent runtime, not a terminal UI automation layer, and not a way to bypass native CLI security policy. Process lifecycle belongs to the daemon and adapters. Remote access belongs to relay, Telegram, Feishu/Lark, and webhook transports. Agent capabilities belong to MCP tools only when the host agent explicitly uses them.

## Actors

- Operator: owns the workstation, configures secrets, starts the relay and daemon, and pairs browser devices.
- Remote user: uses the relay web page, Telegram bot, or Feishu/Lark app bot to choose a conversation target and send actions.
- Daemon: supervises enabled CLI adapters, polls inbound transports, routes messages, and creates on-demand launch requests.
- Adapter: owns one CLI process and one session model. It lists projects/sessions, starts or resumes sessions, sends text into the CLI, parses structured output, and mirrors native approval requests when the CLI exposes a supported callback.
- Relay: stores events, inbound messages, pairing codes, paired devices, and audit entries for one or more `sessionId` values.
- Telegram transport: formats outbound notifications and, when relay is enabled, lets the relay turn inbound messages or callback buttons into the same message model used by the browser UI.
- Feishu/Lark transport: formats outbound app-bot notifications and lets the relay turn event callbacks into the same message model used by the browser UI.
- MCP server: exposes notification, polling, and permission tools. It never starts or stops CLI processes.

## Data Ownership

- `config.yaml`: local operator configuration. It is the source for relay URL, relay secret, Telegram bot token, Feishu/Lark app credentials, webhook URLs, and adapter settings.
- `data/runtime-state.json`: daemon and adapter coordination state. It stores cursors, selected sessions, modes, inbox queues, and launch requests. It is local runtime coordination, not portable relay session truth.
- `data/relay-store.json`: relay-owned state using schema `legax.relay/1`. It stores sessions, generations, leases, hosts, devices, transports, inbox entries, commands, metadata events, artifacts, workflow definitions/runs, legacy event/message queues, pairing codes, and browser pairing state.
- `data/mcp-state.json`: generic MCP tool state.
- CLI-native history: Codex, Claude Code, Gemini, and OpenCode own their own session history. Legax reads or resumes it through each CLI's supported interface.

## Authentication Boundary

Desktop-side relay APIs use `x-legax-secret`. These APIs are for the daemon, adapters, and desktop pairing commands:

- `POST /api/events`
- `GET /api/messages`
- `POST /api/pairing-codes`
- `GET /api/devices`
- `DELETE /api/devices/:id`
- `GET /api/audit`

Browser-side relay APIs use only the paired `legax_device` HttpOnly cookie:

- `GET /api/events`
- `GET /api/agents`
- `GET /api/attention`
- `POST /api/attention/ack`
- `POST /api/messages`
- `POST /api/logout`

The browser never uses URL tokens or memorized shared tokens. Pairing starts on the desktop, produces a short one-time code, and finishes in the browser. Revoking a device removes its cookie from server-side trust.

## Business Workflows

### 1. Install and Configure

Goal: produce one local `config.yaml` and one reachable relay.

1. Operator copies `config.example.yaml` to `config.yaml`.
2. Operator sets `relay.baseUrl` and `relay.secret` for desktop-to-relay traffic.
3. Operator enables wanted adapters under `codex`, `claude`, `gemini`, and `opencode`.
4. Operator optionally enables Telegram by setting `botToken`, `chatId`, and notification policy.
5. Operator optionally enables Feishu/Lark by setting `appId`, `appSecret`, `receiveId`, `verificationToken`, and notification policy.
6. Operator runs the relay and daemon.

Completion: `node scripts/legax-daemon.mjs --status` can report enabled transports and adapters, and the relay `/health` endpoint is reachable.

### 2. Pair a Browser

Goal: give a browser access without exposing the relay secret.

1. Operator runs `npm run daemon:pair`.
2. The desktop sends `POST /api/pairing-codes` with the relay secret.
3. Relay stores a short-lived code hash and returns a protocol pairing offer plus QR payload to the desktop. The offer includes session id, pairing id, pairing secret, daemon public-key metadata, nonce, expiry, and feature flags.
4. The desktop prints the QR code and one-time code.
5. User scans the QR code from the phone, or opens the relay root URL and enters the code manually.
6. User clicks **Pair browser**.
7. Browser sends `POST /api/pair`; when Web Crypto is available it also sends an ephemeral browser public key. Relay validates the offer or manual code and sets the `legax_device` cookie.
8. Browser redirects to `/` and loads the conversation page.

Completion: the browser can read events, list agents, and post messages for the paired `sessionId`.

### 2A. Review the Attention Inbox

Goal: keep actionable work visible across browser, Telegram, and Feishu/Lark without duplicating per-transport logic.

1. Adapters post approval, input, error, completion, and active-context events.
2. Relay derives attention items from those events and exposes `GET /api/attention`.
3. Browser or a future PWA reads the inbox and groups items by active CLI/project/session.
4. User handles or dismisses an item.
5. Browser posts `POST /api/attention/ack` with the handled item ids.

Completion: unresolved approvals, input prompts, errors, and recent completions are visible in one inbox and can be acknowledged per paired device.

### 3. Start the Daemon

Goal: centralize lifecycle and remote inbound routing.

1. Operator starts `node scripts/legax-daemon.mjs` or the project daemon script.
2. Daemon reads `config.yaml`, validates adapter contracts, and prints a redaction-safe transport summary.
3. Daemon starts adapters with `autoStart: true`.
4. Relay owns Telegram `getUpdates` polling or `/api/telegram/events` webhooks and Feishu/Lark callbacks, then writes normalized actions into `/api/messages`.
5. Daemon polls relay `/api/messages` and routes inbound messages to per-agent inbox queues.
6. If a selected adapter is sleeping and `daemon.launchOnDemand` is enabled, daemon records a launch request and starts that adapter.

Completion: remote menu actions work even when a specific CLI adapter has not started yet.

### 4. Choose CLI, Project, and Session in the Relay Web Page

Goal: every outgoing message has an explicit target.

The active target is displayed as `CLI / Project / Session` near the top of the conversation. Each segment is clickable and opens a scoped switcher:

- **CLI segment**: shows all supported CLI adapters from the daemon, including adapters that have not started. Choosing a CLI sets the active CLI, asks for that adapter's session list, then opens the project chooser.
- **Project segment**: shows projects or chats known for the selected CLI. **Chats** is always present as the direct-conversation scope. Sessions without project metadata belong under **Chats**; Claude cwd-only history is also available under **Chats** so users can continue ordinary Claude conversations from the phone. Codex app-server sessions are treated as chats unless they carry an explicit project id or project name. OpenCode sessions use their server-reported cwd/project path when present and otherwise fall under **Chats**. Choosing a project/chat sets the scope and opens the session chooser. If no project context is known, **Load sessions** asks the adapter to list sessions.
- **Session segment**: shows sessions under the selected CLI and project. Choosing one posts `select_session` and makes future text go to that session. Archived sessions are hidden. Lists show up to 10 rows per page and expose **Previous** / **Next** buttons when more rows are available.

Switcher action buttons:

- **Refresh CLI list**: posts `list_agents` to the daemon.
- **Load sessions**: posts `list_agent_sessions` for the active CLI.
- **Refresh sessions**: posts `list_agent_sessions` for the active CLI and current project context when known.
- **New session**: posts `new_session` for the active CLI.

Completion: the composer is enabled only when a CLI target exists; session-specific adapters receive `select_session` before normal text when a session is chosen.

### 5. Read and Reply in the Relay Web Page

Goal: keep remote conversation readable while preserving the underlying agent events.

1. Relay events are grouped by CLI, then project, then session in the timeline.
2. Status, message, approval, and input-request events have distinct visual treatments.
3. The visible message body removes repeated transport headers and keeps the project/session context in the surrounding UI.
4. User writes text in the reply box and clicks **Send**.
5. Browser posts `POST /api/messages` with `targetAgentId` and text.
6. Daemon routes the message to the selected adapter.
7. Adapter sends the text into the active CLI/session and posts new events back to the relay.

Completion: the reply appears in the selected CLI/session and the resulting agent output appears back in the relay page.

### 6. Approve or Deny a Permission Request

Goal: mirror the native CLI approval request without bypassing it when the selected adapter exposes a supported callback.

1. Adapter receives a native approval callback from the CLI.
2. Adapter posts a `permission_request` event with request id, title, target agent, and context.
3. Relay web page renders **Approve** and **Deny** buttons.
4. Telegram renders inline **Approve** and **Deny** buttons when Telegram is enabled.
5. Feishu/Lark renders interactive **Approve** and **Deny** card buttons when Feishu/Lark is enabled.
6. User clicks one action.
7. Relay, Telegram, or Feishu/Lark sends a `permission_decision` message.
8. Adapter waits for that decision and returns it through the CLI's native approval channel.

Completion: the CLI receives an explicit approval or denial from its own structured callback path. Adapters without a native callback, such as the current OpenCode bridge, must not claim phone approval support.

### 7. Answer a User-Input Request

Goal: let an agent ask the remote user for missing input.

1. Adapter or MCP tool posts a `user_input_request` event with a request id and prompt.
2. Relay page displays the input request with the request context.
3. Telegram message includes `/answer <requestId> <answer>` guidance.
4. User answers through the relay composer, Telegram command, or Feishu/Lark chat.
5. Adapter receives `user_input_response` and returns it to the waiting CLI/tool call.

Completion: the blocked agent operation resumes with the supplied answer.

### 8. Use Telegram

Goal: provide the same target-selection and action loop without requiring the browser.

Primary button flow:

1. User sends `/start`.
2. Relay receives the Telegram update, validates the allowed chat, deduplicates it, normalizes it into `/api/messages`, and acknowledges callback queries when needed.
3. Daemon routes the normalized message and posts status/menu events back to relay.
4. Relay fans those events out through Telegram, so the bot replies with enabled CLI buttons.
5. User taps a CLI button. Daemon starts the adapter when needed and replies with project/chat buttons through the same relay fan-out path.
6. User taps a project/chat button. Adapter replies with session buttons scoped to that project/chat. Archived sessions are excluded. Sessions without project metadata are shown under **Chats**; Claude cwd-only sessions are also available under **Chats**; Codex app-server sessions are shown under **Chats** unless explicit project metadata is present; OpenCode sessions use cwd/project metadata when the server returns it. If more than 10 sessions match, the reply includes **Previous** / **Next** page buttons.
7. User taps a session button. Adapter marks it selected.
8. User sends normal text. Daemon routes it to the selected CLI/session.
9. Adapter sends completion, supported approval, and input-request notifications back through relay-owned Telegram delivery.

Supported command flow:

- `/start`, `/agents`, `/menu`: show CLI buttons.
- `/projects <agentId>` or `/chats <agentId>`: show project/chat choices.
- `/sessions <agentId> [projectRef]`: show sessions.
- `/use <agentId> <sessionRef>`: select a session.
- `/new <agentId>`: start a new session.
- `/to <agentId> <text>`: send one targeted message.
- `/mode <agentId> interactive|approval-only|monitor|paused`: change the adapter mode.
- `/approve <requestId>` and `/deny <requestId>`: answer approval requests.
- `/answer <requestId> <answer>`: answer input requests.

Completion: a full Telegram path can start from no active adapter, select CLI/project/session, send text, and receive the CLI response.

### 8A. Open a New Project from Telegram Mini App

Goal: let a Telegram user open a new local project without exposing arbitrary filesystem access through the relay.

1. Project/chat menus include **New project**. This is a normal Telegram callback first, not a direct Web App button.
2. Daemon preflights the relay setup: an enabled relay transport must exist, `relay.publicBaseUrl` must be a public HTTPS URL, the relay `/healthz` endpoint must respond, and `daemon.projectRoots` must contain at least one readable local root.
3. If preflight fails, daemon replies in Telegram with the exact reason and next steps. Examples include missing `relay.publicBaseUrl`, a non-HTTPS URL, localhost/private URLs that a phone cannot reach, an unreachable relay, or missing project roots.
4. If preflight succeeds, daemon asks relay for a short-lived TWA launch token and sends an **Open project picker** Web App button.
5. The TWA authenticates with that launch token. It does not require the user to remember a token and it does not expose the desktop-side relay secret.
6. The TWA asks relay for project children. Relay queues a `list_project_children` control message to `legax-daemon`; daemon lists directories from the configured local `projectRoots`, resolves real paths, filters hidden names, and rejects paths outside the selected root.
7. User chooses a folder and clicks **Open this folder**. Relay queues `open_project` to `legax-daemon`.
8. Daemon validates the path again and converts the request into a target adapter `new_session` with `projectPath`.
9. The adapter selects a fresh session in that project cwd. For Codex this starts a thread with cwd. For Claude, Gemini, and OpenCode it sets the in-memory cwd for the next new session/turn.

Completion: the active CLI receives a new project-scoped session request, and the Telegram/Web App user receives a clear success or failure state.

### 8B. Use Feishu/Lark

Goal: provide an enterprise chat surface for teams that use Feishu China or Lark global.

1. Operator configures a self-built Feishu/Lark app bot and event subscription URL.
2. Adapter sends status, completion, supported approval, and input-request notifications through the app bot.
3. Permission requests render as interactive cards with **Approve** and **Deny** buttons.
4. Feishu/Lark posts event callbacks to `/api/feishu/events`; relay verifies `verificationToken`.
5. Relay writes text replies and card actions into the normal relay message queue.
6. Daemon polls relay `/api/messages` and routes the messages to the target adapter.

Completion: Feishu/Lark can deliver text replies and approval decisions without bypassing native CLI approval callbacks.

### 9. Offline and Recovery

Goal: make failure states actionable.

Relay web status behavior:

- **Connecting**: first event poll has not completed.
- **Online** or recent status text: relay polling is working.
- **Auth required**: browser is not paired or the device was revoked; pair again with `npm run daemon:pair`.
- **Offline**: relay is reachable but daemon/adapters are not producing events or a poll failed. Clicking **Offline** opens daemon startup and configuration guidance.

Recovery loop:

1. Check relay URL and secret in `config.yaml`.
2. Check browser pairing.
3. Start or restart the daemon.
4. Use **Refresh CLI list** or `/start` to confirm the daemon is routing remote actions.
5. Use **Load sessions** or `/sessions <agentId>` to confirm the target adapter can respond.

Completion: remote target selection and message send both work again.

## Component Boundaries

- Daemon owns process supervision, remote polling, on-demand launch, and cross-agent routing.
- Adapters own CLI command lines, structured output parsing, session discovery, session selection, and native approval callbacks when available.
- Relay owns HTTP auth, event/message queues, browser UI, protocol pairing offers, devices, attention inbox derivation, and audit.
- Relay-owned Telegram transport owns Telegram API formatting, polling/webhook ingress, callback parsing, callback acknowledgement, and event fan-out. It does not own adapter lifecycle.
- Feishu/Lark transport owns app-bot formatting and relay event callback parsing. It does not own adapter lifecycle.
- MCP owns tool capability exposure. It does not own daemon lifecycle or session selection.
- `legax` CLI owns local bootstrap diagnostics and managed worktree helper commands.
- Documentation owns operator-facing contracts: configuration, architecture, functional behavior, privacy, and terms.

## Acceptance Checklist

- A new operator can configure relay, Telegram or Feishu/Lark, and at least one CLI from the examples.
- A browser can be paired without sharing or remembering a token.
- Pairing offers carry session/key/nonce metadata while keeping the desktop relay secret out of the browser.
- The attention inbox can show and acknowledge approval, input, error, and completion items.
- The relay web page can select CLI/project/session through the three clickable target segments.
- Telegram can run `/start -> relay-normalized message -> CLI -> project/chat -> session -> text -> relay-owned response`.
- Telegram Mini App can open a project picker only after relay HTTPS and daemon project-root preflight pass.
- Feishu/Lark can send app-bot notifications and route text replies or approval card actions back through relay `/api/messages`.
- Permission requests always require an explicit remote decision and return through the CLI's native callback when that adapter supports one.
- User-input requests can be answered remotely and unblock the waiting operation.
- Sleeping adapters can be launched on demand by daemon-owned remote actions.
- Offline and auth failures provide a clear next action.
