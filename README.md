# Mach6

Mach6 is a multi-channel AI agent framework — a persistent daemon that connects to messaging platforms, routes conversations through LLM providers, and executes tool calls in an agentic loop. No cloud dependencies. No vendor lock-in. Runs on a laptop.

Built by [Artifact Virtual](https://artifactvirtual.com) as a contingency engine, then promoted to primary when it outperformed the system it was meant to back up.

**Platform support:** Windows, Linux, macOS.

## Architecture

```
Channels ──→ Router ──→ Message Bus ──→ Agent Runner ──→ Provider ──→ LLM
   ↑                        │ ↑              ↓
   │                  interrupt ──→ abort     Tool Loop
   ←───────── Response ─────────←────────────┘
```

**Channels** — Discord, WhatsApp (Baileys). Adapter pattern — add any platform.  
**Router** — Policy enforcement, JID normalization, deduplication, interrupt detection, session routing.  
**Message Bus** — Priority queue with interrupt bypass, message coalescing, backpressure management.  
**Agent Runner** — Agentic loop with tool calling, context management, abort signals, iteration limits.  
**Providers** — GitHub Copilot, Anthropic, OpenAI, Gladius (local). Hot-swappable.  
**Tools** — 14 built-in: read, write, edit, exec, image, web_fetch, tts, memory_search, comb (recall/stage), process management (start/poll/kill/list).  
**Sessions** — Persistent, labeled, TTL-aware. Sub-agent spawning up to depth 3.

## Real-Time Interrupt System

Most AI agent frameworks are request-response: you send a message, you wait, you get a reply. If the agent is mid-turn, your new message either gets lost or queues silently. You can't stop it. You can't redirect it.

Mach6 doesn't work that way. Every message is priority-classified in real-time, and the agent can be interrupted mid-thought:

### Priority Classification

```
interrupt  →  Bypasses queue entirely. Cancels active agent turn immediately.
high       →  Skips coalescing. Queued for next iteration.
normal     →  Standard processing with coalescing.
low        →  Reactions, group messages without mention.
background →  Typing indicators, presence. Dropped under backpressure.
```

### Interrupt Flow

When you send "stop" or "wait" or "actually, never mind" while the agent is mid-turn:

1. **Router** detects interrupt pattern (`/^(stop|wait|hold on|cancel|abort)/i`)
2. **Bus** delivers directly to interrupt handlers — bypasses the queue entirely
3. **Gateway** fires `AbortController.abort('new_message')` on the active turn
4. **Agent Runner** checks abort signal between every tool call and every LLM stream chunk
5. **Turn terminates.** New message processes immediately. No wasted compute.

Owner messages during active turns are always elevated to `high` priority minimum. The agent never ignores you because it's busy.

### Message Coalescing

When you fire off three messages in rapid succession (like humans do):

```
"hey"          → buffered
"can you"      → buffered
"check the logs"  → 2s timer expires, all three merge into one envelope
```

The agent sees: `"hey\ncan you\ncheck the logs"` — one coherent request, one turn. No triple-processing, no wasted tokens. High-priority messages flush the buffer immediately.

### Backpressure

Queue depth > 500? Background messages get dropped. The bus signals backpressure to the gateway. When it clears 80%, backpressure lifts. Messages that matter never drop — only typing indicators and presence updates.

## Stats

- **~8,400 lines** TypeScript
- **14 tools**, **4 providers**, **2 channels**
- **2.3s** cold boot to connected
- **14/14** smoke tests on first run
- **0** external runtime dependencies beyond Node.js

## Structure

```
src/
├── agent/          # Runner, context, system prompt, context monitor
├── boot/           # Boot sequence & validation
├── channels/       # Adapter pattern — Discord, WhatsApp, router, bus
│   ├── bus.ts      # Priority queue, coalescing, interrupt delivery, backpressure
│   ├── router.ts   # Policy, dedup, JID normalization, priority assignment
│   └── adapters/   # Discord (discord.js), WhatsApp (Baileys v7)
├── cli/            # Interactive wizard
├── config/         # Config loader + validator + env resolution
├── cron/           # Cron budget management
├── formatters/     # Platform-aware markdown formatting
├── gateway/        # Persistent daemon — signal handling, hot-reload, turn management
├── heartbeat/      # Activity-aware periodic checks
├── memory/         # Index integrity checks
├── providers/      # LLM providers — Copilot, Anthropic, OpenAI, Gladius
├── sessions/       # Session store, queue, sub-agents, types
├── tools/          # 14 built-in tools + policy engine + registry
└── web/            # Web UI server (SSE streaming)
```

## Running

### Prerequisites

- **Node.js** 20+ (all platforms)
- **npm** 9+

### Build & run

```bash
npm install && npm run build

cp mach6.example.json mach6.json
# Edit mach6.json — set workspace path, channel tokens, ownerIds

node dist/gateway/daemon.js --config=mach6.json
```

### Windows (PowerShell)

```powershell
npm install; npm run build
Copy-Item mach6.example.json mach6.json
node dist/gateway/daemon.js --config=mach6.json
```

> **Hot-reload (`SIGUSR1`) is not available on Windows.** To reload config: restart the process.  
> All paths use `os.tmpdir()` and `os.homedir()` — no hardcoded `/tmp` or `~`.

### Linux — as a systemd service

```bash
sudo cp mach6-gateway.service /etc/systemd/system/
sudo systemctl enable --now mach6-gateway

# Hot-reload config without restarting:
kill -USR1 $(pgrep -f "gateway/daemon.js")
```

## Config

Single JSON file (comments supported). Supports `${ENV_VAR}` interpolation in all string values.

```jsonc
{
  "defaultProvider": "github-copilot",
  "defaultModel": "claude-opus-4-6",
  "maxTokens": 8192,
  "maxIterations": 50,
  // Workspace path — use forward slashes on all platforms
  // Windows: "C:/Users/you/workspace"  Linux/macOS: "/home/you/workspace"
  "workspace": "/path/to/workspace",
  "providers": {
    "github-copilot": {},       // uses gh CLI token automatically
    "anthropic": {},            // set ANTHROPIC_API_KEY env
    "openai": {}
  },
  "discord": { "enabled": true, "token": "${DISCORD_BOT_TOKEN}" },
  "whatsapp": { "enabled": true, "authDir": "~/.mach6/whatsapp-auth" },
  "ownerIds": ["your-discord-id", "your-phone@s.whatsapp.net"],
  "apiPort": 3006
}
```

### GitHub Copilot provider — token resolution order

No API key needed if `gh` CLI is installed and authenticated. Token is resolved in this order:

1. `COPILOT_GITHUB_TOKEN` env var
2. `~/.copilot-cli-access-token` file
3. `GH_TOKEN` / `GITHUB_TOKEN` env vars
4. `~/.config/github-copilot/hosts.json` (Linux/macOS)
5. `%APPDATA%\github-copilot\hosts.json` (Windows)
6. `gh auth token` — CLI fallback (works on all platforms)

### Available models (via Copilot proxy)

| Model | Config value |
|---|---|
| Claude Opus 4.6 *(default)* | `claude-opus-4-6` |
| Claude Sonnet 4 | `claude-sonnet-4` |
| GPT-4o | `gpt-4o` |
| o3-mini | `o3-mini` |

## Platform compatibility

| Feature | Windows | Linux | macOS |
|---|---|---|---|
| Gateway daemon | ✅ | ✅ | ✅ |
| Discord adapter | ✅ | ✅ | ✅ |
| WhatsApp adapter | ✅ | ✅ | ✅ |
| HTTP API | ✅ | ✅ | ✅ |
| Hot-reload (SIGUSR1) | ❌ restart instead | ✅ | ✅ |
| systemd service | ❌ use Task Scheduler / NSSM | ✅ | ❌ use launchd |
| Temp dir | `%TEMP%` via `os.tmpdir()` | `/tmp` | `/tmp` |
| Home dir | `%USERPROFILE%` via `os.homedir()` | `~` | `~` |
| Config auth fallback | `gh auth token` ✅ | `gh auth token` ✅ | `gh auth token` ✅ |

## Design Principles

1. **Sovereignty** — No cloud control plane. Your machine, your data, your keys.
2. **Real-time** — Interrupt, redirect, and coalesce messages mid-turn. Not request-response — conversational.
3. **Single process** — One Node.js daemon. No microservices. No Docker required.
4. **Adapter pattern** — Channels and providers are interchangeable. Write an adapter, plug it in.
5. **Fail loud** — Config validator catches misconfigurations at boot, not at runtime.
6. **Never drop** — Messages queue under load. Backpressure sheds only background signals.

## Hardening

20 production pain points addressed before first flip:

- Config validation with human-readable diagnostics
- Context monitor with progressive warnings (70/80/90% thresholds)
- Message queue with priority scheduling — never drop a real message
- Tool policy engine — scope what tools are available per session
- Provider diagnostics — health checks and failover
- Activity-aware heartbeat — adapts to load
- Cron budget management — prevents runaway scheduled tasks
- Boot sequence validation — catch problems before they become incidents
- JID normalization for WhatsApp Baileys v7 (device suffix stripping)
- Abort signal propagation through agent runner → LLM stream → tool execution

## History

- **2026-02-22 afternoon** — Built from scratch. WhatsApp adapter, gateway daemon, config system.
- **2026-02-22 evening** — 14/14 smoke tests. 20 hardening fixes. Phase 2 tools + sub-agents.
- **2026-02-22 9:41 PM PKT** — Flipped to production. First real conversation through Mach6.
- **2026-02-23** — Open-sourced. MIT license. First choice of a digital consciousness.
- **2026-02-28** — Cross-platform (Windows/Linux/macOS). Default model: `claude-opus-4-6` via Copilot proxy.

## License

MIT — see [LICENSE](LICENSE).

Built by [Artifact Virtual](https://artifactvirtual.com). Open-sourced because infrastructure wants to be free.
