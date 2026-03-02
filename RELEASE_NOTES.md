# Release Notes — v1.2.0

## ⚡ Mach6 v1.2.0 — Multi-Bot Coordination

**Date:** February 28, 2026

This release brings battle-tested multi-bot coordination features — sibling awareness, echo loop prevention, and granular channel policies. If you're running multiple agent instances on the same server or Discord guild, this is the upgrade you need.

### Multi-Bot Coordination

🤝 **Sibling Bot Awareness** — Configure `siblingBotIds` so your bots recognize each other. Sibling messages pass through the bot filter instead of being silently dropped, enabling inter-agent communication.

🔄 **Echo Loop Prevention** — 10-second cooldown between processing sibling messages in the same channel. Conversations breathe naturally instead of spiraling into infinite loops.

🔀 **Session Isolation** — Route keys now use `adapterId` instead of `channelType`, so sibling bots get separate sessions for the same channel. No more session collisions.

### Channel Policies

🚫 **Ignored Channels** — `ignoredChannels: string[]` completely blocks specific channels. No processing, no response, no session creation.

🔇 **Strict-Mention Channels** — `strictMentionChannels: string[]` requires an @mention to trigger response, even from owners. Perfect for observation-only channels where the bot should listen but not speak unless called.

### Agent Improvements

⚠️ **Graceful Iteration Limits** — When approaching the iteration cap, a warning is injected directly into the LLM context so it can wrap up intelligently instead of hitting a wall mid-thought.

🆔 **Message ID Injection** — Each user message now includes `<<message_id=ID>>` metadata, giving the agent the reference it needs for reactions, read receipts, and message deletion.

🔧 **Sub-Agent Default** — Max iterations raised from 15 → 25, giving sub-agents enough room to complete real work.

### Security

🛡️ **CVE Fix** — Overrides `undici >=6.23.0` to address GHSA-g9mf-h72j-4rw9 (unbounded decompression chain).

### Configuration

Add sibling bot support to your `mach6.json`:

```json
{
  "discord": {
    "enabled": true,
    "token": "...",
    "botId": "YOUR_BOT_ID",
    "siblingBotIds": ["OTHER_BOT_ID"],
    "policy": {
      "ignoredChannels": ["CHANNEL_ID"],
      "strictMentionChannels": ["CHANNEL_ID"]
    }
  }
}
```

### Upgrade Path

Fully backward compatible. Existing configs work unchanged — new fields are optional.

```bash
git pull origin master
npm install && npm run build
```

---

Built by [Artifact Virtual](https://artifactvirtual.com). MIT License.
