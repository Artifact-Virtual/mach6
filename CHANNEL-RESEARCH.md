# Mach6 Channel System — Architectural Research

> **Date:** 2026-02-22  
> **Purpose:** Foundational architecture research for the Mach6 multi-channel agent system  
> **Scope:** OpenClaw internals, platform transports, competitor analysis, edge cases, interrupt architecture

---

## Table of Contents

1. [OpenClaw Channel Architecture (As-Is)](#1-openclaw-channel-architecture)
2. [Transport-Level Platform Requirements](#2-transport-level-platform-requirements)
3. [Competitor Framework Analysis](#3-competitor-framework-analysis)
4. [Critical Edge Cases](#4-critical-edge-cases)
5. [The Interrupt Problem & Message Bus Design](#5-the-interrupt-problem--message-bus-design)
6. [Recommendations for Mach6](#6-recommendations-for-mach6)

---

## 1. OpenClaw Channel Architecture

### 1.1 High-Level Structure

OpenClaw uses a **plugin-based channel system** with a clear separation between:

- **Channel Registry** (`src/channels/registry.ts`) — static metadata, ordering, aliases for core channels
- **Channel Plugins** (`src/channels/plugins/`) — full implementations per channel (config, security, outbound, gateway, etc.)
- **Channel Docks** (`src/channels/dock.ts`) — lightweight behavioral facades for shared code paths (avoids importing heavy plugin code)
- **Auto-Reply Pipeline** (`src/auto-reply/`) — the dispatch/reply loop that bridges inbound messages to the agent and back

### 1.2 Core Channels (Hardcoded Order)

```typescript
const CHAT_CHANNEL_ORDER = [
  "telegram", "whatsapp", "discord", "irc", 
  "googlechat", "slack", "signal", "imessage"
] as const;
```

Each channel gets a `ChannelPlugin<ResolvedAccount, Probe, Audit>` implementation with ~20 adapter interfaces:

| Adapter | Purpose |
|---------|---------|
| `config` | Account resolution, listing, enable/disable |
| `security` | DM policy, allowFrom lists, warnings |
| `outbound` | Send text/media/polls, chunking, target resolution |
| `gateway` | Start/stop accounts, QR login, logout |
| `setup` | CLI onboarding wizard hooks |
| `groups` | Mention gating, tool policy per group |
| `mentions` | Strip patterns for self-mentions |
| `threading` | Reply-to mode, tool context building |
| `messaging` | Target normalization, directory lookup |
| `actions` | Platform-specific message actions (react, send, poll, etc.) |
| `streaming` | Block streaming coalesce defaults |
| `heartbeat` | Ready checks, recipient resolution |
| `directory` | Peer/group listing (live and config-based) |
| `status` | Account snapshots, probes, audits, issue detection |
| `pairing` | Approval flow for new contacts |

### 1.3 Message Flow: Inbound

```
Platform (WhatsApp/Discord/Telegram)
  → Gateway adapter (startAccount in ChannelGatewayAdapter)
    → Platform SDK event (Baileys socket event / discord.js message / etc.)
      → Normalize message → MsgContext
        → Allowlist/mention gating check
          → Session recording (recordInboundSession)
            → Auto-reply dispatch pipeline
              → dispatchInboundMessage()
                → dispatchReplyFromConfig()
                  → Agent LLM call with tools
                    → Reply payload generation
```

Key types in the flow:
- **`MsgContext`** — normalized inbound message (channel, from, to, text, chatType, media, replyToId, etc.)
- **`FinalizedMsgContext`** — enriched with resolved metadata
- **`ReplyDispatcher`** — handles outbound buffering, typing indicators, chunking
- **`ReplyPayload`** — structured reply (text, media, poll, etc.)

### 1.4 Message Flow: Outbound

```
Agent reply text
  → ReplyDispatcher (buffered, with typing indicators)
    → Channel outbound adapter (whatsappOutbound, discordOutbound, etc.)
      → deliveryMode: "gateway" | "direct" | "hybrid"
        → Platform SDK send call
```

Each outbound adapter defines:
- `deliveryMode` — gateway (routed through gateway process) vs direct (in-process SDK call)
- `chunker` / `chunkerMode` — how to split long messages (text vs markdown-aware)
- `textChunkLimit` — per-platform max (Discord: 2000, WhatsApp/Telegram/Slack/Signal: 4000, IRC: 350)
- `resolveTarget` — normalize recipient ID
- `sendText` / `sendMedia` / `sendPoll` — actual send implementations

### 1.5 Configuration Model

All channel config lives in `openclaw.json` under `channels.*`:

```json
{
  "channels": {
    "whatsapp": {
      "dmPolicy": "allowlist",
      "accounts": { "default": { "allowFrom": ["+1234567890"] } },
      "groups": { "120363...@g.us": { "requireMention": true } },
      "ackReaction": { "direct": true, "group": "always" },
      "mediaMaxMb": 50
    },
    "discord": {
      "token": "...",
      "guilds": { "1326...": { "requireMention": true } }
    }
  }
}
```

Plugin enablement is separate in `plugins.entries`:
```json
{ "whatsapp": { "enabled": true }, "discord": { "enabled": true }, "telegram": { "enabled": false } }
```

### 1.6 Pain Points & Limitations

1. **Tight coupling to gateway process** — Channels run inside the gateway daemon. No standalone channel workers. A WhatsApp crash can affect Discord.
2. **No message bus** — Inbound messages are dispatched synchronously into the auto-reply pipeline. No queue, no replay, no backpressure.
3. **Session model is file-based** — `sessions.json` tracks last route/channel per session key. No proper event sourcing.
4. **No interrupt mechanism** — Once the agent loop starts processing a message, there's no way to interrupt it with a higher-priority message from another channel.
5. **Monolithic reply pipeline** — `dispatchReplyFromConfig` → `getReplyFromConfig` is a single async call. No middleware chain, no pre/post hooks beyond internal hooks.
6. **Channel-specific code bleeds into shared paths** — `dock.ts` has inline logic for all 8 channels. Adding a channel means touching multiple files.
7. **No message deduplication** — Beyond debounce timers, no idempotency keys or dedup logic.
8. **No cross-channel identity** — Each channel has its own sender ID format. No unified contact model.
9. **Outbound is fire-and-forget** — No delivery confirmation tracking, no retry queue, no dead letter handling.
10. **Plugin API is wide but shallow** — 20+ adapter interfaces, but many are optional and inconsistently implemented across channels.

---

## 2. Transport-Level Platform Requirements

### 2.1 WhatsApp (Baileys / whatsapp-web.js)

**Protocol:** Multi-device Web Socket to WhatsApp servers (Noise protocol, Signal encryption)

| Feature | Status | Notes |
|---------|--------|-------|
| Multi-device | ✅ Supported | Baileys implements MD protocol. QR or phone number pairing. |
| Text messages | ✅ | UTF-8, up to ~65K chars (practical limit ~4000 for readability) |
| Media (image/video/audio/doc) | ✅ | Upload via encrypted blob store. Limits: 16MB images, 64MB video, 16MB audio, 100MB docs |
| Reactions | ✅ | Single emoji per message per sender |
| Read receipts | ✅ | Blue ticks. Can be sent/suppressed. Privacy setting dependent. |
| Groups | ✅ | Up to 1024 members. Admin/member roles. Group metadata changes. |
| Mentions | ✅ | @participant via JID in `mentionedJid[]` |
| Message editing | ⚠️ Partial | WhatsApp added edit support (2023+). Baileys support varies by version. |
| Ephemeral messages | ✅ | 24h/7d/90d disappearing. Must handle that messages vanish. |
| Polls | ✅ | Create polls, receive poll vote updates |
| Buttons/Lists | ❌ Deprecated | WhatsApp removed interactive buttons for non-business accounts |
| Voice messages | ✅ | PTT (push-to-talk) audio, opus codec |
| Stickers | ✅ | WebP format, animated stickers |
| Status/Stories | ⚠️ | Viewable but limited interaction |
| Message deletion | ✅ | "Delete for everyone" events |
| Typing indicators | ✅ | composing/paused presence |
| Online presence | ✅ | available/unavailable |

**Rate Limits:**
- No official API rate limits (unofficial protocol)
- Aggressive anti-spam: too many messages to new contacts → temporary ban
- Group creation limited, bulk messaging triggers bans
- Practical safe rate: ~20 msgs/min to existing contacts, ~5/min to new

**Session Persistence:**
- Credentials stored as Signal protocol keys (pre-keys, session keys, identity keys)
- OpenClaw stores in `~/.openclaw/credentials/whatsapp/default/`
- Must handle session invalidation (logged out from phone, re-pair needed)
- Reconnection: automatic with exponential backoff

**Key Challenges:**
- Unofficial protocol — can break with WhatsApp updates
- No webhook option — must maintain persistent WebSocket
- Phone number is the identity — can't have multiple bots on same number
- Group JID format: `<id>@g.us`, DM format: `<phone>@s.whatsapp.net`

### 2.2 Discord (discord.js)

**Protocol:** WebSocket Gateway + REST API (official Bot API)

| Feature | Status | Notes |
|---------|--------|-------|
| Guilds (servers) | ✅ | Hierarchical: Guild → Category → Channel → Thread |
| Text channels | ✅ | Persistent, searchable history |
| Threads | ✅ | Public/private, auto-archive, forum channels |
| DMs | ✅ | Direct and group DMs |
| Embeds | ✅ | Rich structured content (title, description, fields, images, footer) |
| Components | ✅ | Buttons, select menus, modals, text inputs |
| Reactions | ✅ | Multiple emoji per message, custom emoji |
| Voice channels | ⚠️ Complex | @discordjs/voice — requires opus, sodium. Joining, speaking, listening. |
| Slash commands | ✅ | Registered per-guild or global. Autocomplete. |
| Message editing | ✅ | Full edit support, edit history not exposed |
| Message deletion | ✅ | Bulk delete up to 14 days old |
| Attachments | ✅ | 25MB free, 50MB Nitro. CDN-hosted. |
| Webhooks | ✅ | Custom username/avatar per message |
| Intents | ✅ Required | Privileged: Presence, Server Members, Message Content |
| Roles/Permissions | ✅ | Granular per-channel permission overrides |

**Rate Limits:**
- Global: 50 requests/second
- Per-route limits (e.g., 5 msg/5s per channel)
- Gateway: 120 events/60s for identify/resume
- `429 Too Many Requests` with `Retry-After` header
- Bots must implement rate limit handling (discord.js does this automatically)

**Message Formatting:**
- Discord-flavored Markdown (different from standard!)
- `**bold**`, `*italic*`, `~~strike~~`, `||spoiler||`, `` `code` ``, `> quote`
- Mentions: `<@user_id>`, `<@&role_id>`, `<#channel_id>`
- No tables, no headers in regular messages (embeds support limited structure)
- Max 2000 chars per message, 4096 for embed description

**Session Persistence:**
- Bot token-based (stateless auth)
- Gateway session: resume with session_id + sequence number
- Shard management for large bots (>2500 guilds)

**Key Challenges:**
- Intent requirements mean you must declare what events you want
- Gateway reconnection and session invalidation handling
- Shard management complexity at scale
- Component interactions have 3-second acknowledgment timeout

### 2.3 Telegram (telegraf / grammY)

**Protocol:** Bot API (HTTPS) with optional long polling or webhook

| Feature | Status | Notes |
|---------|--------|-------|
| Private chats | ✅ | 1:1 with bot |
| Groups | ✅ | Up to 200K members (supergroups) |
| Supergroups | ✅ | Upgraded groups with admin tools, slow mode, etc. |
| Channels | ✅ | Broadcast-only (bot can post) |
| Forums/Topics | ✅ | Thread-like topics within supergroups |
| Inline keyboards | ✅ | Buttons attached to messages with callback data |
| Callback queries | ✅ | Button press events with answer requirement |
| Media groups | ✅ | Album of up to 10 photos/videos sent as single unit |
| Message editing | ✅ | Edit text, media, reply markup |
| Message deletion | ✅ | deleteMessage API |
| Reactions | ✅ | Custom + built-in emoji reactions (added 2023) |
| Polls | ✅ | Regular + quiz mode |
| Stickers | ✅ | Static/animated/video stickers |
| Voice/Video notes | ✅ | Round video messages, voice messages |
| Bot commands | ✅ | /command with BotFather registration |
| Payments | ✅ | In-bot payments via provider tokens |
| Web Apps | ✅ | Mini apps embedded in chat |
| File sharing | ✅ | Up to 2GB per file (50MB for bot API download) |

**Rate Limits:**
- 30 messages/second to different chats
- 20 messages/minute to same group
- 1 message/second to same chat (soft)
- Bulk: sendMessage to 1000+ users takes ~14 hours at 30/s
- getUpdates long polling: 30s timeout recommended

**Webhook vs Polling:**
- **Long polling** (`getUpdates`): Simpler, no HTTPS cert needed, works behind NAT. Latency: poll interval.
- **Webhook**: Push-based, lower latency, requires HTTPS endpoint. Telegram sends POST with Update JSON.
- grammY supports both seamlessly; telegraf prefers webhook in production

**Message Formatting:**
- HTML mode: `<b>`, `<i>`, `<code>`, `<pre>`, `<a href="">`, `<tg-spoiler>`
- MarkdownV2: `*bold*`, `_italic_`, `__underline__`, `~strikethrough~`, `||spoiler||`, `` `code` ``
- Must escape special chars in MarkdownV2: `_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!`
- Max 4096 chars per message, 1024 for caption

**Key Challenges:**
- Bot can't initiate conversations (user must /start first)
- Callback query data limited to 64 bytes
- Media groups arrive as separate updates (must aggregate by media_group_id)
- Forum topics add threading complexity
- Bot API doesn't support user accounts (MTProto libraries like Telethon do)

### 2.4 Signal (signal-cli)

**Protocol:** Signal Protocol (Double Ratchet, X3DH, sealed sender) via signal-cli REST API or dbus

| Feature | Status | Notes |
|---------|--------|-------|
| Direct messages | ✅ | E164 phone number or UUID-based |
| Groups (v2) | ✅ | Up to 1000 members, admin roles |
| Media | ✅ | Images, video, audio, files (100MB limit) |
| Reactions | ✅ | Single emoji per message |
| Typing indicators | ✅ | Composing/stopped |
| Read receipts | ✅ | Sent/delivered/read |
| Disappearing messages | ✅ | Timer-based |
| Mentions | ✅ | In groups, mention specific members |
| Stickers | ✅ | Sticker packs |
| Quotes (replies) | ✅ | Reply to specific messages |
| Message editing | ✅ | Since Signal v6.2 |
| Sealed sender | ✅ | Sender identity hidden from server |

**Architecture:**
- signal-cli runs as a separate process (Java)
- Links as a secondary device to a phone number
- REST API wrapper (signal-cli-rest-api) exposes HTTP endpoints
- OpenClaw interfaces via the REST API

**Rate Limits:**
- No documented API limits (peer-to-peer E2EE)
- Server-side anti-spam exists but poorly documented
- Practical: moderate message rates are fine

**Key Challenges:**
- signal-cli is heavyweight (Java, ~500MB RAM)
- Linking process is manual (QR scan from primary device)
- No official bot API — you're simulating a user
- Session management: if primary device re-registers, linked device is invalidated
- Group management limited compared to other platforms
- Sealed sender makes debugging harder

### 2.5 IRC

**Protocol:** IRC (RFC 1459, RFC 2812), typically over TLS

| Feature | Status | Notes |
|---------|--------|-------|
| Channels | ✅ | #channel with topic, modes |
| DMs (PRIVMSG) | ✅ | Direct messages to nicks |
| Channel modes | ✅ | +o (op), +v (voice), +m (moderated), etc. |
| CTCP | ✅ | ACTION (/me), VERSION, PING |
| SASL auth | ✅ | PLAIN, EXTERNAL |
| NickServ | ✅ | Nick registration/identification |
| TLS | ✅ | Server-dependent |
| IRCv3 | ⚠️ Partial | Multi-prefix, account-tag, message-tags, echo-message, etc. |
| File transfer | ⚠️ Legacy | DCC SEND — rarely used, NAT-unfriendly |
| Formatting | ⚠️ | mIRC colors (^C), bold (^B), italic (^]), underline (^_) — not markdown |

**Rate Limits:**
- Server-specific throttling (typically 1 msg/2s penalty, flood protection)
- Most servers: ~5 msgs/burst then throttle
- Excessive flooding → kill/ban

**Message Limits:**
- 512 bytes per message (including protocol overhead)
- Practical text limit: ~400 chars
- No media, no embeds, no structured content

**Key Challenges:**
- Simplest protocol but most limited features
- No persistent history (unless IRCv3 chathistory)
- Nick collision handling
- Network splits and reconnection
- No native media support — would need a pastebin/image host integration

### 2.6 Slack (Socket Mode / Events API)

**Protocol:** WebSocket (Socket Mode) or HTTPS webhook (Events API) + REST Web API

| Feature | Status | Notes |
|---------|--------|-------|
| Workspaces | ✅ | Org-level containers |
| Channels | ✅ | Public/private channels |
| Threads | ✅ | Reply threads on messages (thread_ts) |
| DMs | ✅ | Direct and multi-party DMs |
| Blocks | ✅ | Rich layout framework (sections, actions, inputs, context) |
| Modals | ✅ | Interactive popup forms |
| Slash commands | ✅ | /command with custom handlers |
| Reactions | ✅ | Custom + standard emoji |
| Message editing | ✅ | chat.update API |
| Message deletion | ✅ | chat.delete API |
| File uploads | ✅ | files.upload (deprecated) → files.uploadV2 |
| Workflows | ✅ | Workflow Builder / Bolt steps |
| App Home | ✅ | Custom tab in DM with bot |
| Unfurling | ✅ | Link previews with custom content |
| Socket Mode | ✅ | WebSocket — no public URL needed |
| Events API | ✅ | Webhook-based, requires public URL + verification |

**Rate Limits:**
- Tier 1: 1 request/minute (admin methods)
- Tier 2: 20 requests/minute (most methods)
- Tier 3: 50 requests/minute (chat.postMessage, etc.)
- Tier 4: 100 requests/minute (some search methods)
- Socket Mode: 30,000 events/hour per app
- `429` response with `Retry-After` header
- Burst: short bursts OK, sustained rate matters

**Message Formatting:**
- Slack-flavored mrkdwn: `*bold*`, `_italic_`, `~strike~`, `` `code` ``, `> quote`
- Mentions: `<@U1234>`, `<!channel>`, `<!here>`
- Links: `<https://url|display text>`
- No native markdown tables
- Max 40,000 chars per message (but Blocks have per-element limits)

**Key Challenges:**
- Socket Mode requires app-level token (xapp-) + bot token (xoxb-)
- Thread semantics: `thread_ts` is the parent message's `ts`, replies inherit it
- Event subscription model: must subscribe to each event type
- Rate limits are per-method, not global — complex to manage
- Blocks API is powerful but verbose
- Enterprise Grid adds workspace-level complexity

---

## 3. Competitor Framework Analysis

### 3.1 Botpress

**Architecture:** Hub-and-spoke. Central "Botpress Server" (now Botpress Cloud) with channel integrations.

**Channel handling:**
- Channels are "integrations" — separate packages that implement a standard interface
- Each integration handles: incoming webhooks, message sending, channel-specific features
- Messages normalized to a common `Message` type (text, image, audio, video, file, carousel, card, choice, dropdown, location)
- Conversation model: channels map to conversations, each with a unique ID

**What's good:**
- Clean abstraction — integrations are self-contained
- Rich message types (carousel, card) with per-channel rendering
- Conversation-centric (not channel-centric) — the conversation is the unit, channel is transport
- Built-in NLU pipeline

**What's bad:**
- Cloud-first model limits self-hosting
- Integration development requires their specific SDK and cloud deployment
- Limited real-time streaming support
- Conversation state is managed by Botpress, not the agent — poor fit for LLM agents that manage their own context
- No concept of an interruptible agent loop

### 3.2 Rasa

**Architecture:** Rasa Open Source + Rasa Pro. Channel connectors as input/output classes.

**Channel handling:**
- `InputChannel` base class: implements webhook endpoint for each platform
- `OutputChannel` base class: implements `send_text_message`, `send_image_url`, `send_text_with_buttons`, etc.
- Built-in connectors: Slack, Telegram, Facebook Messenger, Twilio (SMS/WhatsApp), MS Teams, etc.
- Messages normalized to `UserMessage` with text, intent, entities
- Custom connectors by subclassing `InputChannel` + `OutputChannel`

**What's good:**
- Clean connector interface — easy to add new channels
- Tracker-based conversation state (event-sourced!)
- Good separation of NLU → dialogue management → action execution → output
- Custom actions with full Python flexibility

**What's bad:**
- Designed for intent/entity NLU, not open-ended LLM conversations
- No streaming support in channel connectors
- Output channel methods are lowest-common-denominator (text + buttons mostly)
- No concept of concurrent multi-channel conversations for same user
- Heavy infrastructure (Rasa Server + Action Server + Tracker Store + Event Broker)

### 3.3 LangChain / LangGraph Agents

**Architecture:** LangChain provides agent abstractions. No built-in channel system.

**Channel handling:**
- **None built-in.** LangChain agents are invoked via function calls.
- Integration left to the developer — wrap agent in FastAPI/Flask, connect to platform SDKs
- LangServe provides HTTP API layer but no channel abstraction
- Community: langchain-community has some integrations (Telegram, Discord) but they're thin wrappers

**What's good:**
- Agent architecture is flexible — tool calling, chains, graphs (LangGraph)
- LangGraph adds proper state machines with interrupts and human-in-the-loop
- Memory management (conversation buffer, summary, vector store) is well-developed
- Streaming support built into the chain/agent interface

**What's bad:**
- No channel abstraction at all — you build it yourself every time
- No message normalization
- No conversation routing
- State management tied to chain invocations, not persistent conversations
- Community integrations are fragile and poorly maintained

### 3.4 AutoGPT / AGiXT

**Architecture:** Autonomous agent loop with plugin system.

**Channel handling:**
- AutoGPT: primarily CLI-based. Web UI via REST API. No multi-channel.
- AGiXT: has "providers" for input/output but focused on task execution, not chat
- Some community forks add Discord/Telegram bots but these are thin wrappers around the agent loop

**What's good:**
- Agent loop concept (observe → think → act → repeat) is relevant to Mach6
- Plugin architecture for tools
- Task decomposition and planning

**What's bad:**
- No real channel system
- No conversation management
- No multi-user support
- Designed for autonomous execution, not interactive chat
- No streaming, no interrupts, no message queuing

### 3.5 CrewAI

**Architecture:** Multi-agent orchestration framework. Agents collaborate on tasks.

**Channel handling:**
- **None.** CrewAI is about agent-to-agent communication, not agent-to-human.
- Agents have roles, goals, backstories — and communicate via an internal protocol
- "Tasks" are the unit of work, not messages
- No concept of channels, conversations, or real-time interaction

**What's good:**
- Multi-agent collaboration model (relevant for subagent orchestration)
- Role-based agent specialization
- Task delegation patterns

**What's bad:**
- Zero channel support
- Batch-oriented, not real-time
- No streaming, no interrupts
- Not designed for human interaction at all

### 3.6 Summary Matrix

| Framework | Channels | Normalization | Streaming | Interrupts | Multi-user | Event Sourcing |
|-----------|----------|---------------|-----------|------------|------------|----------------|
| Botpress | ✅ Good | ✅ Good | ❌ | ❌ | ✅ | ❌ |
| Rasa | ✅ Good | ✅ Decent | ❌ | ❌ | ✅ | ✅ (Tracker) |
| LangChain | ❌ None | ❌ | ✅ Good | ⚠️ LangGraph | ❌ Built-in | ❌ |
| AutoGPT | ❌ None | ❌ | ❌ | ❌ | ❌ | ❌ |
| CrewAI | ❌ None | ❌ | ❌ | ❌ | ❌ | ❌ |
| **OpenClaw** | ✅ Good | ✅ Good | ⚠️ Block | ❌ | ✅ | ❌ |

**Key takeaway:** Nobody does multi-channel + streaming + interrupts well. This is an open problem and an opportunity for Mach6.

---

## 4. Critical Edge Cases

### 4.1 Message Ordering Guarantees

| Platform | Ordering | Notes |
|----------|----------|-------|
| WhatsApp | Timestamp-based | Messages have server timestamps. Offline messages delivered in order on reconnect. Media may arrive after text. |
| Discord | Snowflake ID | Monotonically increasing snowflake IDs. Gateway events are ordered per-shard. |
| Telegram | update_id | Sequential update IDs. `getUpdates` with offset ensures no gaps. Webhooks may arrive out of order under load. |
| Signal | Server timestamp | Sealed sender can cause slight reordering. Group messages may arrive out of order. |
| IRC | None | No ordering guarantees. Server-dependent. Network splits cause message duplication/loss. |
| Slack | `ts` (timestamp) | Unique timestamp per message. Threads ordered by `ts`. Events API can deliver out of order. |

**Mach6 implications:**
- Must buffer and reorder incoming messages by platform-specific sequence field
- Agent context window should have messages in correct chronological order
- Media messages may arrive as separate events that need correlation

### 4.2 Rate Limiting Per Platform

| Platform | Send Rate | Burst | Backoff |
|----------|-----------|-------|---------|
| WhatsApp | ~20/min safe | Short bursts OK | Exponential, risk of ban |
| Discord | 5/5s per channel | Header-based | 429 + Retry-After |
| Telegram | 30/s different chats, 20/min same group | Moderate | 429 + retry_after |
| Signal | Undocumented | Moderate | Unknown |
| IRC | ~1/2s (server-dependent) | 5 msg burst | Kill/ban |
| Slack | 1-100/min (tier-dependent) | Varies | 429 + Retry-After |

**Mach6 implications:**
- Per-channel rate limiter with token bucket / sliding window
- Outbound queue per (channel, target) with configurable rate
- Priority lanes: interactive reply > proactive notification > bulk
- Circuit breaker for ban-risk platforms (WhatsApp)

### 4.3 Media Handling

| Platform | Max Upload | Formats | Thumbnails | CDN |
|----------|-----------|---------|------------|-----|
| WhatsApp | 16MB img, 64MB vid, 100MB doc | JPEG, PNG, GIF, MP4, PDF, many doc types | Auto-generated | Encrypted blob store (ephemeral URLs) |
| Discord | 25MB (50MB Nitro) | Most formats | Auto for images/video | CDN with persistent URLs |
| Telegram | 50MB bot download, 2GB upload | Most formats | Auto for images/video | Telegram servers (file_id based) |
| Signal | 100MB | Most formats | Auto for images | Signal servers (encrypted) |
| IRC | None native | N/A | N/A | N/A |
| Slack | 1GB (plan-dependent) | Most formats | Auto | Slack CDN (authenticated URLs) |

**Mach6 implications:**
- Media pipeline: download → validate → resize/convert if needed → upload to target
- Format conversion matrix (e.g., WebP stickers → PNG for platforms that don't support WebP)
- Size limit enforcement with graceful degradation (compress, link instead of embed)
- Temporary file management with cleanup
- Cross-platform media forwarding needs format/size adaptation

### 4.4 Group vs DM Semantics

| Aspect | DM | Group |
|--------|-----|-------|
| Identity | Direct sender/recipient | Sender in group context |
| Mention gating | N/A (always relevant) | Must check if bot was mentioned |
| Privacy | Conversation is private | Multiple participants see messages |
| Threading | Linear | May need thread awareness |
| Context | Simple 1:1 | Need to track who said what |
| Response target | Same chat | Same group (not DM to sender) |
| Permissions | User-level | Group role + channel permissions |

**Mach6 implications:**
- Unified `Conversation` type that encodes DM vs Group semantics
- Mention detection as a first-class concern (not per-channel special cases)
- Group context injection: "You're in group X. Y said: ..."
- Privacy-aware: don't leak DM content into group responses

### 4.5 Mention/Reply Threading

| Platform | Mention Format | Reply Mechanism | Thread Model |
|----------|---------------|-----------------|--------------|
| WhatsApp | `@phone` in mentionedJid[] | quotedMessage with stanzaId | Flat (no threads) |
| Discord | `<@user_id>` in text | message_reference.message_id | Threads (channel type 11/12) |
| Telegram | text entities with user mention | reply_to_message_id | Forum topics (thread model) |
| Signal | UUID-based mention | quote with id+timestamp | Flat |
| IRC | Nick prefix convention | No native reply | No threads |
| Slack | `<@U1234>` in text | thread_ts pointing to parent | Threaded replies |

**Mach6 implications:**
- Abstract `Reply` type: { targetMessageId, quotedText?, threadId? }
- Abstract `Mention` type: { userId, displayName, position }
- Thread context must be preserved across agent turns
- Some platforms (WhatsApp, Signal) are flat — simulate threading via reply chains

### 4.6 Platform-Specific Formatting (Markdown Dialects)

| Platform | Bold | Italic | Strike | Code | Link | Table |
|----------|------|--------|--------|------|------|-------|
| WhatsApp | `*text*` | `_text_` | `~text~` | `` `text` `` | Auto-link | ❌ |
| Discord | `**text**` | `*text*` | `~~text~~` | `` `text` `` | `[text](url)` | ❌ |
| Telegram | `*text*` (MD) / `<b>` (HTML) | `_text_` / `<i>` | `~text~` / `<s>` | `` `text` `` / `<code>` | `[text](url)` / `<a>` | ❌ |
| Signal | ❌ Basic | ❌ Basic | ❌ | ❌ | Auto-link | ❌ |
| IRC | ^B (mIRC) | ^] | ❌ | ❌ | Auto-link | ❌ |
| Slack | `*text*` | `_text_` | `~text~` | `` `text` `` | `<url\|text>` | ❌ |

**Mach6 implications:**
- Output formatter per channel that converts canonical markdown to platform-specific
- OpenClaw already has `src/markdown/whatsapp.ts`, `ir.ts` for this — good prior art
- Strip unsupported formatting gracefully (tables → lists, headers → bold)
- Agent system prompt should mention current platform's formatting capabilities

### 4.7 Reconnection / Session Persistence

| Platform | Auth Type | Session State | Reconnect Strategy |
|----------|-----------|---------------|-------------------|
| WhatsApp | Signal protocol keys | Pre-keys, session keys, identity | Auto-reconnect with backoff. Re-pair if logged out from phone. |
| Discord | Bot token + gateway session | session_id + seq number | Resume gateway session. Full reconnect if session invalid. |
| Telegram | Bot token (stateless) | getUpdates offset / webhook registration | Stateless — just restart polling. Webhook auto-retries. |
| Signal | Linked device keys | Device key pair, trust store | signal-cli reconnects. If unlinked, re-pair required. |
| IRC | SASL + nick registration | None (stateless protocol) | Reconnect + re-identify. Nick recovery. |
| Slack | Bot token + Socket Mode | Socket Mode connection | Auto-reconnect. Socket Mode handles reconnection. |

**Mach6 implications:**
- Health check per channel connection with configurable intervals
- Reconnection state machine: connected → disconnecting → reconnecting → connected
- Graceful degradation: if WhatsApp goes down, Discord still works
- Credential rotation support (token refresh for platforms that support it)
- Stale session detection and auto-cleanup

### 4.8 Message Deduplication

**Sources of duplicates:**
- WhatsApp: reconnection can replay recent messages
- Discord: rare, but possible with gateway session resume edge cases
- Telegram: webhook retries if your server responds slowly (>60s)
- Signal: network issues can cause re-delivery
- Slack: Events API retries with `x-slack-retry-num` header

**Strategies:**
- **Idempotency key:** Store message IDs with TTL (e.g., 1 hour). Skip if seen.
- **Bloom filter:** Space-efficient for high-volume dedup.
- **Platform-specific:** Telegram `update_id` offset, Slack `event_id`, Discord message snowflake.

**Mach6 implications:**
- Message ID dedup cache per channel (Redis/SQLite with TTL)
- Idempotent message processing pipeline
- Update offset/sequence tracking per platform

### 4.9 Webhook vs WebSocket vs Polling

| Method | Latency | Infra Required | NAT-friendly | Reliability |
|--------|---------|---------------|--------------|-------------|
| **Webhook** | Low (~100ms) | Public HTTPS endpoint | ✅ | Platform retries on failure |
| **WebSocket** | Lowest (~50ms) | Persistent connection | ✅ | Must handle reconnection |
| **Long Polling** | Medium (~1-30s) | None | ✅ | Simple but wasteful |

| Platform | Preferred | Alternative |
|----------|-----------|-------------|
| WhatsApp | WebSocket (only option) | N/A |
| Discord | WebSocket (Gateway) | N/A (REST for sending only) |
| Telegram | Webhook (production) | Long polling (development) |
| Signal | REST polling to signal-cli | N/A |
| IRC | TCP/TLS socket | N/A |
| Slack | Socket Mode (WebSocket) | Events API (webhook) |

**Mach6 implications:**
- Must support all three transport modes
- Transport adapter interface: `connect()`, `disconnect()`, `onMessage(handler)`, `send(msg)`
- Webhook receiver: generic HTTP server that routes to channel handlers
- WebSocket manager: connection pooling, heartbeat, reconnection
- Polling scheduler: configurable intervals with backoff

---

## 5. The Interrupt Problem & Message Bus Design

### 5.1 The Core Problem

An LLM agent call takes 5-60 seconds. During that time:
- A new message arrives on the same channel → should it wait? be queued? interrupt?
- A higher-priority message arrives on a different channel → should it interrupt the current call?
- A system event occurs (heartbeat, cron) → should it be queued behind the user message?

OpenClaw's current approach: **no interruption.** Messages queue behind the current processing. The `dispatchInboundMessage` is async but not cancellable.

### 5.2 Interrupt Categories

| Priority | Example | Behavior |
|----------|---------|----------|
| P0 — Emergency | Kill switch, safety trigger | Cancel everything, handle immediately |
| P1 — Interactive | User follow-up in same conversation | Cancel current if superseded, or queue |
| P2 — Cross-channel | New message in different conversation | Queue, process next |
| P3 — Background | Heartbeat, cron, proactive | Queue with low priority |

### 5.3 Proposed Message Bus Architecture

```
┌─────────────────────────────────────────────────────┐
│                   CHANNEL LAYER                      │
│  WhatsApp  Discord  Telegram  Signal  IRC  Slack    │
│   adapter   adapter  adapter  adapter  ...  adapter  │
└──────┬────────┬────────┬────────┬──────────┬────────┘
       │        │        │        │          │
       ▼        ▼        ▼        ▼          ▼
┌─────────────────────────────────────────────────────┐
│              INBOUND NORMALIZER                      │
│  • Platform-specific → canonical InboundMessage      │
│  • Deduplication (message ID cache)                  │
│  • Media download & staging                          │
│  • Mention/reply/thread resolution                   │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│               MESSAGE BUS (Priority Queue)           │
│                                                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐             │
│  │  P0     │  │  P1     │  │ P2/P3   │             │
│  │ Emergency│  │ Active  │  │ Queue   │             │
│  │         │  │ Convos  │  │         │             │
│  └────┬────┘  └────┬────┘  └────┬────┘             │
│       │            │            │                    │
│  Routing: conversation_id → session                  │
│  Dedup: skip if same content within window           │
│  Coalesce: merge rapid-fire messages before dispatch │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              SESSION MANAGER                         │
│                                                      │
│  • One active agent loop per conversation            │
│  • Cancellation tokens (AbortController)             │
│  • LLM call interruptibility:                        │
│    - Streaming: cancel stream + salvage partial      │
│    - Non-streaming: let complete, queue next          │
│  • Concurrency limit (max active sessions)           │
│  • Session lifecycle: idle → processing → replying   │
│  • Context window management per session             │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              AGENT LOOP (per session)                 │
│                                                      │
│  • Receive message from bus                          │
│  • Build/update context window                       │
│  • Call LLM (with AbortSignal)                       │
│  • Execute tool calls                                │
│  • Generate reply                                    │
│  • Send to outbound queue                            │
│                                                      │
│  INTERRUPT PROTOCOL:                                 │
│  1. New message arrives for this session              │
│  2. Bus signals session via interrupt channel         │
│  3. If LLM streaming: cancel stream, append new msg  │
│     to context, re-call LLM                          │
│  4. If tool executing: let tool finish, then re-eval │
│  5. If idle: pick up from queue                      │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              OUTBOUND QUEUE                           │
│                                                      │
│  • Per-(channel, target) rate-limited queue           │
│  • Priority: interactive > proactive                  │
│  • Chunking (per platform limits)                    │
│  • Format conversion (markdown → platform-specific)  │
│  • Media upload/attachment handling                   │
│  • Delivery confirmation tracking                    │
│  • Retry with exponential backoff                    │
│  • Dead letter queue for persistent failures         │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                   CHANNEL LAYER (outbound)           │
│  Platform-specific send calls                        │
└─────────────────────────────────────────────────────┘
```

### 5.4 Key Data Types

```typescript
// Canonical inbound message
interface InboundMessage {
  id: string;                    // Platform message ID
  platformId: string;            // "whatsapp" | "discord" | ...
  conversationId: string;        // Normalized conversation identifier
  senderId: string;              // Platform-specific sender ID
  senderName?: string;
  timestamp: number;             // Unix ms
  sequenceId?: string | number;  // Platform ordering field
  
  // Content
  text?: string;
  media?: MediaAttachment[];
  
  // Context
  chatType: "direct" | "group" | "channel" | "thread";
  groupId?: string;
  groupName?: string;
  threadId?: string;
  replyToId?: string;
  mentions?: Mention[];
  
  // Platform-specific extras
  raw: unknown;                  // Original platform event
}

// Canonical outbound message  
interface OutboundMessage {
  conversationId: string;
  text?: string;
  media?: MediaAttachment[];
  replyToId?: string;
  threadId?: string;
  formatting?: "markdown" | "plain";
  priority: "interactive" | "proactive" | "background";
}

// Conversation session
interface ConversationSession {
  id: string;                    // Stable conversation identifier
  platform: string;
  platformConversationId: string;
  chatType: "direct" | "group" | "channel" | "thread";
  participants: Participant[];
  contextWindow: ContextMessage[];
  state: "idle" | "processing" | "replying";
  abortController?: AbortController;
  lastActivity: number;
  metadata: Record<string, unknown>;
}
```

### 5.5 Interrupt Strategies

**Strategy A: Queue-Only (Current OpenClaw)**
- Messages queue, process in order
- Simple but high latency for follow-ups
- User sends correction → has to wait for first response before correction is seen

**Strategy B: Coalesce-Then-Process**
- Short debounce window (e.g., 2-5 seconds)
- Multiple messages from same sender coalesce into single context update
- Then process once with all messages
- Good for rapid-fire typing, bad for latency on single messages

**Strategy C: Cancel-and-Restart**
- New message cancels in-flight LLM call
- Partial response is discarded
- New request includes all accumulated messages
- Best UX but wastes compute, only works with streaming providers

**Strategy D: Hybrid (Recommended for Mach6)**
1. **Same conversation, same sender:** Coalesce with short window (2s), then if LLM is streaming, cancel and restart with full context
2. **Same conversation, different sender:** Queue behind current processing
3. **Different conversation:** Process concurrently (up to concurrency limit)
4. **Emergency (P0):** Immediate cancel + handle

### 5.6 Implementation Considerations

**Message Bus Technology:**
- In-process: `EventEmitter` or async generator-based (simplest, single-process)
- Redis Streams: Durable, multi-process, consumer groups, exactly-once semantics
- SQLite WAL + notify: Durable, single-machine, good for embedded systems
- NATS JetStream: Cloud-native, multi-node, at-most-once/at-least-once/exactly-once

**Recommendation for Mach6:**
- Start with **in-process priority queue** (TypeScript `AsyncPriorityQueue`)
- Persist to **SQLite** for crash recovery
- Add **Redis** adapter when multi-process scaling is needed
- Interface should be agnostic: `MessageBus { publish(msg), subscribe(filter, handler) }`

---

## 6. Recommendations for Mach6

### 6.1 Architecture Principles

1. **Channel as pure I/O adapter** — Channels should only handle: connect, receive, normalize, denormalize, send. Zero business logic.
2. **Canonical message format** — Single normalized message type flows through the entire system.
3. **Conversation-centric, not channel-centric** — The conversation is the primary entity. A conversation can span channels (rare but possible).
4. **Event-sourced conversations** — Every message, tool call, and reply is an immutable event. Enables replay, debugging, audit.
5. **Interruptible agent loop** — AbortController-based cancellation with graceful partial response handling.
6. **Per-conversation concurrency** — One active agent call per conversation, concurrent across conversations.
7. **Durable outbound** — Outbound messages persisted before send attempt. Retry on failure. Dead letter after N retries.

### 6.2 Suggested Module Structure

```
mach6/
├── channels/
│   ├── types.ts              # ChannelAdapter interface
│   ├── whatsapp/             # WhatsApp adapter (Baileys)
│   ├── discord/              # Discord adapter (discord.js)
│   ├── telegram/             # Telegram adapter (grammY)
│   ├── signal/               # Signal adapter (signal-cli REST)
│   ├── irc/                  # IRC adapter
│   ├── slack/                # Slack adapter (Bolt)
│   └── registry.ts           # Channel registration + lifecycle
├── bus/
│   ├── types.ts              # MessageBus interface
│   ├── priority-queue.ts     # In-process priority queue
│   ├── sqlite-store.ts       # Persistent message store
│   └── dedup.ts              # Deduplication cache
├── normalizer/
│   ├── inbound.ts            # Platform → canonical
│   ├── outbound.ts           # Canonical → platform
│   └── formatter.ts          # Markdown dialect conversion
├── sessions/
│   ├── manager.ts            # Conversation session lifecycle
│   ├── context.ts            # Context window management
│   └── interrupt.ts          # Interrupt/cancel protocol
├── agent/
│   ├── loop.ts               # The agent loop (receive → think → act → reply)
│   ├── tools.ts              # Tool execution with cancellation
│   └── streaming.ts          # Streaming response handler
└── outbound/
    ├── queue.ts              # Per-channel rate-limited queue
    ├── chunker.ts            # Message chunking
    ├── media.ts              # Media download/convert/upload pipeline
    └── delivery.ts           # Send + confirm + retry
```

### 6.3 Channel Adapter Interface (Minimal)

```typescript
interface ChannelAdapter {
  id: string;
  meta: { label: string; capabilities: Capabilities };
  
  // Lifecycle
  connect(config: ChannelConfig, signal: AbortSignal): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  
  // Inbound (channel → bus)
  onMessage(handler: (raw: unknown) => void): void;
  normalize(raw: unknown): InboundMessage;
  
  // Outbound (bus → channel)  
  send(msg: OutboundMessage): Promise<DeliveryResult>;
  denormalize(msg: OutboundMessage): PlatformMessage;
  
  // Platform-specific actions
  react?(messageId: string, emoji: string): Promise<void>;
  editMessage?(messageId: string, text: string): Promise<void>;
  deleteMessage?(messageId: string): Promise<void>;
  sendTyping?(conversationId: string): Promise<void>;
  readReceipt?(messageId: string): Promise<void>;
}
```

### 6.4 What to Steal from OpenClaw

- **Dock pattern** (lightweight facades for shared code) — good, keep it
- **Allowlist/mention gating** — solid security model, adapt it
- **Plugin system concept** — but simplify the 20+ adapter interfaces to ~5 core ones
- **Markdown IR** (`src/markdown/ir.ts`) — platform-specific formatting conversion
- **Media understanding pipeline** — audio/image/video processing with provider abstraction
- **Heartbeat system** — proactive check-in model

### 6.5 What to Fix vs OpenClaw

| OpenClaw | Mach6 |
|----------|-------|
| Monolithic gateway process | Channels as independent workers (can crash independently) |
| Synchronous dispatch | Async message bus with priority queue |
| File-based sessions | SQLite event store |
| No interrupts | AbortController-based cancel + coalesce |
| No delivery tracking | Outbound queue with confirmation + retry |
| No dedup | Message ID cache with TTL |
| Channel config in main config | Per-channel config files with hot-reload |
| 20+ adapter interfaces | 5 core interfaces + optional extensions |
| No cross-channel identity | Contact model that maps platform IDs |

---

*End of research document. This should serve as the architectural foundation for Mach6's channel system design.*
