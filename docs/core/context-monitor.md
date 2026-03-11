# Context Monitor

Proactive context window management that prevents token overflow before it happens.

## Overview

The Context Monitor tracks token usage in real-time across the agent's message history. Instead of crashing when the context window fills up, it progressively manages the situation through three escalation levels.

## Thresholds

| Level | Default | Action |
|-------|---------|--------|
| **Warning** | 70% | Log a warning. No modification. |
| **Compacting** | 80% | Stage to COMB + summarize old messages, keep recent 40%. |
| **Emergency** | 90% | Save full transcript to disk + hard-truncate to last 10 messages. |

## How It Works

```
Every agent turn:
  1. Estimate total tokens (msg.content.length / 4)
  2. Compare against maxContextTokens
  3. If threshold crossed → take action
```

### Compaction (80%)

1. **COMB stage** — saves a snapshot of the full conversation to persistent memory (if COMB hook is configured)
2. **Summarize** — old messages are compressed into a single summary message (first 200 chars per message, max 2000 chars total)
3. **Keep recent** — the newest 40% of messages are preserved verbatim
4. System messages are always preserved

### Emergency (90%)

1. **Transcript flush** — the full message array is saved as JSON to `<transcriptDir>/transcript-<timestamp>.json`
2. **Hard truncate** — only the last 10 non-system messages survive, plus a notice that earlier context was flushed
3. System messages are always preserved

## Configuration

```json
{
  "maxTokens": 128000,
  "contextMonitor": {
    "warnThreshold": 0.7,
    "compactThreshold": 0.8,
    "emergencyThreshold": 0.9,
    "transcriptDir": "/tmp/mach6-transcripts"
  }
}
```

## Token Estimation

The monitor uses a lightweight heuristic: `Math.ceil(text.length / 4)`. This is deliberately approximate — close enough to prevent overflow, cheap enough to run on every turn.

For structured content blocks (tool results, multi-part messages), each block is estimated individually and summed.

## Integration

The Context Monitor runs inside the agent loop. It's called automatically before each LLM request:

```typescript
const monitor = new ContextMonitor({
  maxContextTokens: 128000,
  onCombStage: (content) => comb.stage(content),
});

// In the agent loop:
messages = await monitor.manage(messages);
// → returns messages unchanged, compacted, or truncated
```

No agent configuration needed — it just works.

---

*Added in v1.5.0. Enhanced in v1.7.0 with COMB integration and configurable thresholds.*
