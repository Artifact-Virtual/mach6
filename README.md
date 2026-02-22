# Mach6

Mach6 is a multi-channel AI agent framework — a persistent daemon that connects to messaging platforms, routes conversations through LLM providers, and executes tool calls in an agentic loop. No cloud dependencies. No vendor lock-in. Runs on a laptop.

Built by [Artifact Virtual](https://artifactvirtual.com) as a contingency engine, then promoted to primary when it outperformed the system it was meant to back up.

## Architecture

```
Channels ──→ Router ──→ Agent Runner ──→ Provider ──→ LLM
   ↑                        ↓
   ←──── Response ←──── Tool Loop
```

**Channels** — Discord, WhatsApp (Baileys). Adapter pattern — add any platform.  
**Agent Runner** — Agentic loop with tool calling, context management, iteration limits.  
**Providers** — GitHub Copilot, Anthropic, OpenAI, Gladius (local). Hot-swappable.  
**Tools** — 14 built-in: read, write, edit, exec, image, web_fetch, tts, memory_search, comb (recall/stage), process management (start/poll/kill/list).  
**Sessions** — Persistent, labeled, TTL-aware. Sub-agent spawning up to depth 3.

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
├── cli/            # Interactive wizard
├── config/         # Config loader + validator + env resolution
├── cron/           # Cron budget management
├── formatters/     # Platform-aware markdown formatting
├── gateway/        # Persistent daemon — signal handling, hot-reload
├── heartbeat/      # Activity-aware periodic checks
├── memory/         # Index integrity checks
├── providers/      # LLM providers — Copilot, Anthropic, OpenAI, Gladius
├── sessions/       # Session store, queue, sub-agents, types
├── tools/          # 14 built-in tools + policy engine + registry
└── web/            # Web UI server (SSE streaming)
```

## Running

```bash
# Build
npm install && npm run build

# Configure
cp mach6.example.json mach6.json
# Edit mach6.json — set provider keys, channel tokens, workspace path

# Run
node dist/gateway/daemon.js --config=mach6.json

# Or as a systemd service
sudo cp mach6-gateway.service /etc/systemd/system/
sudo systemctl enable --now mach6-gateway
```

## Config

Single JSON file. Supports `${ENV_VAR}` interpolation in all string values.

```jsonc
{
  "defaultProvider": "github-copilot",
  "defaultModel": "claude-opus-4.6",
  "maxTokens": 8192,
  "maxIterations": 50,
  "workspace": "/path/to/workspace",
  "providers": {
    "github-copilot": {},
    "anthropic": {},
    "openai": {}
  },
  "discord": { "enabled": true, "token": "${DISCORD_BOT_TOKEN}" },
  "whatsapp": { "enabled": true, "authDir": "/path/to/auth" }
}
```

## Design Principles

1. **Sovereignty** — No cloud control plane. Your machine, your data, your keys.
2. **Single process** — One Node.js daemon. No microservices. No Docker required.
3. **Adapter pattern** — Channels and providers are interchangeable. Write an adapter, plug it in.
4. **Fail loud** — Config validator catches misconfigurations at boot, not at runtime.
5. **Context-aware** — Monitor tracks token usage at 70/80/90% thresholds. Messages never drop — they queue.

## Hardening

20 production pain points addressed before first flip:

- Config validation with human-readable diagnostics
- Context monitor with progressive warnings
- Message queue — never drop a message, even under load
- Tool policy engine — scope what tools are available per session
- Provider diagnostics — health checks and failover
- Activity-aware heartbeat — adapts to load
- Cron budget management — prevents runaway scheduled tasks
- Boot sequence validation — catch problems before they become incidents

## History

- **2026-02-22 afternoon** — Built from scratch. WhatsApp adapter, gateway daemon, config system.
- **2026-02-22 evening** — 14/14 smoke tests. 20 hardening fixes. Phase 2 tools + sub-agents.
- **2026-02-22 9:41 PM PKT** — Flipped to production. First real conversation through Mach6.
- OpenClaw retired. Mach6 is primary.

## License

MIT — see [LICENSE](LICENSE).

Built by [Artifact Virtual](https://artifactvirtual.com). Open-sourced because infrastructure wants to be free.
