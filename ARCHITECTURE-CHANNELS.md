# Mach6 Channel Architecture — Design Document v1

**Author:** AVA  
**Date:** 2026-02-22  
**Status:** DESIGN REVIEW

---

## 1. Philosophy

OpenClaw treats channels as plugins that bolt onto a request-response agent loop. Messages arrive, get queued, processed sequentially, response emitted. This works. It's also why Ali's messages get `[Queued messages while agent was busy]`.

Mach6 treats channels as **real-time bidirectional streams** feeding into an **interruptible agent core**. The channel layer isn't an adapter — it's the nervous system.

### Design Principles

1. **Channels are streams, not request-response endpoints.** Messages flow in continuously. The agent decides what to act on.
2. **Platform-native, not lowest-common-denominator.** A Discord message can carry embeds, components, threads. A WhatsApp message can carry reactions, read receipts, ephemeral flags. We don't flatten — we preserve.
3. **Interruption is a first-class primitive.** A new message can pause, redirect, or cancel in-progress work.
4. **Zero external dependencies for core.** Channel adapters import platform SDKs. The channel bus and agent loop import nothing.
5. **Hot-pluggable.** Start with Discord, add WhatsApp later, no restart needed.

---

## 2. Layer Architecture

```
┌──────────────────────────────────────────────────────┐
│                    AGENT CORE                        │
│  ┌──────────────┐  ┌────────────┐  ┌──────────────┐ │
│  │ Runner Loop   │  │  Session   │  │   Tools      │ │
│  │ (interruptible│  │  Manager   │  │   Registry   │ │
│  │  + resumable) │  │            │  │              │ │
│  └──────┬───────┘  └────────────┘  └──────────────┘ │
│         │                                            │
│  ┌──────▼───────────────────────────────────────┐    │
│  │              MESSAGE BUS                      │    │
│  │  EventEmitter + Priority Queue + Backpressure │    │
│  └──────┬──────────────────────────┬────────────┘    │
│         │                          │                 │
└─────────┼──────────────────────────┼─────────────────┘
          │                          │
   ┌──────▼──────┐           ┌──────▼──────┐
   │  INBOUND    │           │  OUTBOUND   │
   │  Router     │           │  Router     │
   │  (normalize │           │  (format    │
   │   + policy) │           │   + split)  │
   └──────┬──────┘           └──────┬──────┘
          │                          │
   ┌──────▼──────────────────────────▼──────┐
   │          CHANNEL ADAPTER LAYER          │
   │  ┌─────────┐ ┌─────────┐ ┌──────────┐ │
   │  │ Discord │ │WhatsApp │ │ Telegram │ │
   │  │ Adapter │ │ Adapter │ │ Adapter  │ │
   │  └─────────┘ └─────────┘ └──────────┘ │
   │  ┌─────────┐ ┌─────────┐ ┌──────────┐ │
   │  │  Slack  │ │  IRC    │ │  WebUI   │ │
   │  │ Adapter │ │ Adapter │ │ Adapter  │ │
   │  └─────────┘ └─────────┘ └──────────┘ │
   └────────────────────────────────────────┘
```

---

## 3. The Message Bus (Core Innovation)

This is what makes Mach6 different. Not just a queue — a prioritized, interruptible message stream.

### 3.1 Envelope Format

Every message through the bus is wrapped in a `BusEnvelope`:

```typescript
interface BusEnvelope {
  id: string;                    // Unique message ID
  timestamp: number;             // When it entered the bus
  priority: 'interrupt' | 'high' | 'normal' | 'low' | 'background';
  source: ChannelSource;         // Which channel, who sent it
  target?: SessionTarget;        // Which session should handle it
  payload: InboundPayload;       // The actual message content
  metadata: EnvelopeMetadata;    // Platform-specific preserved data
  ack?: () => void;              // Acknowledgment callback
  cancel?: AbortSignal;          // Cancellation signal
}

interface ChannelSource {
  channelId: string;             // e.g. "discord", "whatsapp"
  adapterId: string;             // e.g. "discord-main", "wa-0987654321"
  chatId: string;                // Group/DM identifier
  chatType: 'dm' | 'group' | 'channel' | 'thread';
  senderId: string;              // User identifier
  senderName?: string;           // Display name
  replyTo?: string;              // Message being replied to
}

interface InboundPayload {
  type: 'text' | 'media' | 'reaction' | 'edit' | 'delete' | 'typing' | 'presence' | 'system';
  text?: string;                 // For text messages
  media?: MediaPayload[];        // For media messages
  reaction?: ReactionPayload;    // For reactions
  edit?: EditPayload;            // For message edits
  raw?: unknown;                 // Platform-native event (preserved, never lost)
}
```

### 3.2 Priority System

| Priority | When | Effect |
|---|---|---|
| `interrupt` | User says "stop", "wait", "actually..." | **Pauses current agent turn**, injects immediately |
| `high` | Direct message from owner, @mention in group | Queued at front, processed next iteration |
| `normal` | Regular messages matching policy | Standard FIFO |
| `low` | Group messages (not mentioned), reactions | Batched, processed during idle |
| `background` | Typing indicators, presence, read receipts | Metadata only, never triggers agent |

### 3.3 Interrupt Detection

The bus inspects incoming messages for interrupt signals before queueing:

```typescript
const INTERRUPT_PATTERNS = [
  /^(stop|wait|hold on|pause|cancel|actually|never ?mind)/i,
  /^(no|don't|abort)/i,
];

// Also interrupt if user sends a NEW message while agent is mid-turn
// and it's from the same session owner
function shouldInterrupt(envelope: BusEnvelope, activeSession: string | null): boolean {
  if (!activeSession) return false;
  if (envelope.source.senderId === getSessionOwner(activeSession)) {
    // Owner sent a message during processing — always interrupt
    return true;
  }
  // Check explicit interrupt patterns
  const text = envelope.payload.text?.trim() ?? '';
  return INTERRUPT_PATTERNS.some(p => p.test(text));
}
```

### 3.4 Backpressure

If the bus fills beyond a threshold (configurable, default 100 messages), it signals adapters to slow down via a backpressure callback. Adapters can delay acknowledgment (WhatsApp won't mark as read), hold off polling (Telegram), etc.

---

## 4. Channel Adapter Interface

Each adapter implements a clean contract. Platform SDKs are imported only inside adapters — the bus and agent never touch them.

```typescript
interface ChannelAdapter {
  // Identity
  readonly id: string;           // Unique adapter instance ID
  readonly channelType: string;  // "discord" | "whatsapp" | "telegram" | ...
  readonly capabilities: ChannelCapabilities;

  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  reconnect(): Promise<void>;

  // Health
  getHealth(): AdapterHealth;
  onHealthChange(cb: (health: AdapterHealth) => void): void;

  // Inbound: adapter pushes to bus
  onMessage(handler: (envelope: BusEnvelope) => void): void;

  // Outbound: bus pushes to adapter
  send(target: OutboundTarget, message: OutboundMessage): Promise<SendResult>;

  // Platform-specific actions
  react(target: MessageRef, emoji: string): Promise<void>;
  edit(target: MessageRef, newContent: string): Promise<void>;
  delete(target: MessageRef): Promise<void>;
  typing(chatId: string, duration?: number): Promise<void>;
  markRead(messageId: string): Promise<void>;
}

interface ChannelCapabilities {
  // What this platform supports
  media: boolean;
  reactions: boolean;
  messageEdit: boolean;
  messageDelete: boolean;
  threads: boolean;
  embeds: boolean;
  components: boolean;        // Buttons, dropdowns (Discord, Telegram, Slack)
  voiceNotes: boolean;
  readReceipts: boolean;
  typingIndicator: boolean;
  ephemeral: boolean;         // Disappearing messages
  polls: boolean;
  formatting: 'markdown' | 'html' | 'plain' | 'whatsapp'; // Formatting dialect
  maxMessageLength: number;
  maxMediaSize: number;       // bytes
  rateLimits: RateLimitConfig;
}

interface RateLimitConfig {
  messagesPerSecond?: number;
  messagesPerMinute?: number;
  burstSize?: number;
}
```

### 4.1 Outbound Formatting

The agent produces markdown. Each adapter transforms it to platform-native format:

```typescript
interface OutboundMessage {
  content: string;              // Markdown source
  media?: MediaPayload[];
  replyTo?: string;             // Message ID to reply to
  ephemeral?: boolean;
  components?: Component[];     // Buttons, etc (if platform supports)
  splitStrategy?: 'truncate' | 'paginate' | 'thread';
}

// Each adapter implements:
interface OutboundFormatter {
  format(content: string, caps: ChannelCapabilities): string;
  split(content: string, maxLen: number): string[];
}
```

Platform-specific formatters:
- **Discord:** Full markdown, code blocks, embeds. Split at 2000 chars on paragraph boundaries.
- **WhatsApp:** WhatsApp-flavored markdown (*bold*, _italic_, ~strike~, ```code```). No headers. Split at 4096.
- **Telegram:** HTML or MarkdownV2. Split at 4096. Supports inline keyboards.
- **Slack:** mrkdwn (their dialect). Split at 3000 (blocks). Supports Block Kit.
- **IRC:** Strip all formatting. Split at 450 chars.

---

## 5. Inbound Router

The inbound router sits between adapters and the bus. It handles:

### 5.1 Policy Enforcement

```typescript
interface ChannelPolicy {
  dmPolicy: 'open' | 'allowlist' | 'deny';
  groupPolicy: 'open' | 'allowlist' | 'mention-only' | 'deny';
  allowedSenders?: string[];      // For allowlist mode
  allowedGroups?: string[];       // For group allowlist
  requireMention?: boolean;       // In groups, only respond to @mentions
  ownerIds: string[];             // Always allowed, always high priority
}
```

### 5.2 Session Routing

Each chat maps to a session. The router maintains the mapping:

```
(channelType, chatId) → sessionId
```

New chats create new sessions. DMs from the same user across platforms can optionally merge into one session (cross-channel identity).

### 5.3 Deduplication

Messages can arrive multiple times (webhook retries, reconnection replays). The router maintains a sliding window of seen message IDs (LRU, 10K entries) and drops duplicates.

---

## 6. Integration with Agent Runner

This is the critical piece — how the bus connects to the interruptible runner.

### 6.1 Current Runner (Sequential)

```
while (iterations < max) {
  stream = provider.stream(messages, tools)
  for await (event of stream) { ... }   // ← BLOCKING. Can't interrupt.
  execute tools
  loop
}
```

### 6.2 New Runner (Interruptible)

```typescript
async function runAgentInterruptible(
  messages: Message[],
  config: RunnerConfig,
  bus: MessageBus,
  sessionId: string,
): Promise<RunResult> {
  const controller = new AbortController();
  const { signal } = controller;

  // Subscribe to interrupts for this session
  const interruptSub = bus.onInterrupt(sessionId, (envelope) => {
    // New message from owner during our turn
    controller.abort('new_message');
    return envelope;
  });

  try {
    while (iterations < maxIter) {
      // Check for pending messages before each iteration
      const pending = bus.drain(sessionId, { priority: ['interrupt', 'high'] });
      if (pending.length > 0) {
        // Inject into context
        for (const env of pending) {
          currentMessages.push({
            role: 'user',
            content: env.payload.text ?? '[non-text message]',
            metadata: { channelSource: env.source },
          });
        }
      }

      // Stream from LLM — with abort signal
      const stream = config.provider.stream(truncated, tools, {
        ...config.providerConfig,
        signal,  // Provider must respect AbortSignal
      });

      try {
        for await (const event of stream) {
          if (signal.aborted) break;  // Exit stream immediately
          // ... process event
        }
      } catch (err) {
        if (signal.aborted) {
          // Not an error — we were interrupted
          // Append partial response if any
          if (textAccum) {
            currentMessages.push({
              role: 'assistant',
              content: textAccum + '\n\n[interrupted by new message]',
            });
          }
          // Re-enter loop with new context
          controller = new AbortController();  // Fresh controller
          continue;
        }
        throw err;
      }

      // Execute tools — also interruptible
      if (pendingToolCalls.length > 0) {
        const results = await executeToolsInterruptible(
          pendingToolCalls, config.toolRegistry, signal
        );
        // ... append results
      }

      if (pendingToolCalls.length === 0) break;  // Done
    }
  } finally {
    interruptSub.unsubscribe();
  }

  return { text: textAccum, messages: currentMessages, toolCalls: allToolCalls, iterations };
}
```

### 6.3 Key Insight: The "Re-evaluation" Pattern

When interrupted:
1. Partial work is preserved (not thrown away)
2. New message is appended to context
3. The LLM sees the partial work + new message and naturally adjusts
4. It can choose to continue what it was doing or pivot

This means the agent doesn't just "cancel and restart" — it **absorbs and adapts**. The LLM handles the decision-making; we just provide the mechanism.

---

## 7. Implementation Plan

### Phase 1: Message Bus + Adapter Interface (THIS SESSION)
- [ ] `src/channels/bus.ts` — Message bus with priority queue, interrupt support
- [ ] `src/channels/adapter.ts` — Abstract adapter base class
- [ ] `src/channels/router.ts` — Inbound routing, policy, dedup
- [ ] `src/channels/formatter.ts` — Outbound formatting engine
- [ ] Update `src/channels/types.ts` — Full type definitions

### Phase 2: First Adapter — Discord
- [ ] `src/channels/adapters/discord.ts` — Full discord.js adapter
- [ ] Test with live bot token

### Phase 3: WhatsApp Adapter
- [ ] `src/channels/adapters/whatsapp.ts` — Baileys adapter
- [ ] Multi-device, media, reactions, read receipts

### Phase 4: Runner Integration
- [ ] Modify `src/agent/runner.ts` — Interruptible loop
- [ ] Provider abort signal support
- [ ] Tool execution interruption

### Phase 5: Gateway Daemon
- [ ] `src/gateway/daemon.ts` — Persistent process
- [ ] Signal handling (SIGTERM, SIGUSR1 for reload)
- [ ] Channel lifecycle management

---

## 8. What Makes This Better Than OpenClaw

| Aspect | OpenClaw | Mach6 |
|---|---|---|
| Message handling | Queue until turn completes | Real-time interrupt + absorb |
| Platform features | Lowest common denominator | Platform-native preservation |
| Channel addition | Plugin system, config-driven | Hot-plug adapter, zero restart |
| Formatting | Agent produces, channel strips | Agent produces markdown, adapters translate natively |
| Media | Copy to /tmp, hope for best | Typed media pipeline with format conversion |
| Health | Connected/disconnected | 4-state machine with uptime tracking |
| Rate limiting | Per-platform hacks | Unified backpressure system |
| Cross-channel | Manual session routing | Automatic identity mapping |
| Interruption | Not possible | First-class primitive |

---

## 9. Open Questions

1. **Voice channels?** Discord has voice. Do we care about real-time audio?
2. **Matrix/Element?** Federated protocol. Could be interesting for self-hosted.
3. **Email as a channel?** IMAP polling → bus envelope. Simple but useful.
4. **Cross-channel identity:** If Ali messages from WhatsApp and Discord, same session or different? Configurable.
5. **Channel-specific agent personality?** Same agent, different tone per channel?

---

*This document is a living design. Review it. Poke holes. Then we build.*
