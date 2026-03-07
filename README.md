<div align="center">

# ⚡ Mach6

**Build AI agents that actually work. Single process. Any machine.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/badge/npm-mach6--core-red.svg)](https://www.npmjs.com/package/mach6-core)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![v1.6.0](https://img.shields.io/badge/version-1.6.0-orange.svg)](https://github.com/Artifact-Virtual/mach6/releases/tag/v1.6.0)

A persistent daemon that connects messaging platforms, LLM providers, and tool execution into a single agentic loop. Real-time interrupts. Seamless continuation. Session-to-session memory. No Docker. No Redis. No cloud dependencies.

**Your machine. Your data. Your keys.**

[Quick Start](#-quick-start) · [Architecture](#-architecture) · [Config](#-configuration) · [Providers](#-providers) · [Tools](#-tools) · [Web UI](#-web-ui)

</div>

---

## 🚀 Quick Start

```bash
# Install
npm install -g mach6-core

# Interactive setup — generates mach6.json + .env
mach6 init

# Start the daemon
mach6 start
```

Or from source:

```bash
git clone https://github.com/Artifact-Virtual/mach6.git
cd mach6 && npm install && npm run build
node dist/gateway/daemon.js --config=mach6.json
```

> **Windows:** Fully supported. Use `.\mach6.ps1` or `node dist/gateway/daemon.js --config=mach6.json`.

<details>
<summary><strong>Manual setup (skip the wizard)</strong></summary>

```bash
cp mach6.example.json mach6.json
cp .env.example .env
# Edit both files — set API keys, channel tokens, workspace path, ownerIds
```

</details>

---

## 🏗 Architecture

```
Channels → Router → Message Bus → Agent Runner → LLM Provider
  ↑                      ↑
Discord              Priority Queue
WhatsApp             Coalescing
HTTP API             Interrupts
                     Backpressure
```

| Layer | What it does |
|-------|-------------|
| **Channels** | Discord (discord.js), WhatsApp (Baileys v7), HTTP API. Adapter pattern — add any platform. |
| **Router** | Policy enforcement, JID normalization, deduplication, interrupt detection, priority classification. |
| **Message Bus** | Priority queue with interrupt bypass, message coalescing, backpressure management. |
| **Agent Runner** | Agentic loop — tool calling, context management, abort signals, iteration limits. |
| **Providers** | Groq, Anthropic, OpenAI, xAI (Grok), GitHub Copilot, Ollama, Gemini, Gladius. Hot-swappable mid-session. |
| **Tools** | 18+ built-in. File I/O, shell, browser, TTS, memory, process management, messaging. |
| **Sessions** | Persistent, labeled, TTL-aware. Sub-agent spawning up to depth 3. |

---

## 🔥 What Makes Mach6 Different

### Real-Time Interrupts

Most agent frameworks are request-response. You send a message, you wait, you get a reply. Your new message queues silently while the agent is mid-turn. You can't stop it. You can't redirect it.

Mach6 doesn't work that way. Every message is priority-classified in real time:

```
interrupt  →  Bypasses queue. Cancels active turn immediately.
high       →  Skips coalescing. Next in line.
normal     →  Standard processing with coalescing.
low        →  Reactions, group mentions. Queued politely.
background →  Typing indicators. Dropped under backpressure.
```

Say "stop" while the agent is mid-thought — it stops. Not after the current tool call. Not after the current paragraph. **Now.**

### Seamless Continuation (Blink + Pulse)

Most frameworks hard-cap iteration budgets. Hit the wall → session dies → context lost.

**Blink** detects when the agent approaches its budget, spawns a fresh turn on the same session, and carries the full conversation forward. The user sees one continuous interaction. Up to 5 consecutive blinks per task, with periodic checkpoint saves.

**Pulse** adapts the budget itself. Short conversations use 20 iterations. Complex tasks auto-expand to 100. When demand passes, it reverts. Budget carries across restarts.

### Session-to-Session Memory (COMB)

Built into the engine. Zero external dependencies — no Python, no Redis, no database.

- **`comb_stage`** — save critical context for the next session
- **`comb_recall`** — retrieve it when the next session starts
- **Auto-flush** — conversation tail saves automatically on shutdown

If a Python COMB stack exists (enterprise deployments), the native version delegates to it transparently.

### Message Coalescing

Three messages in rapid succession? Mach6 buffers and merges them:

```
"hey"              → buffered
"can you"          → buffered
"check the logs"   → 2s timer expires → one coherent envelope
```

One request, one turn, no wasted tokens.

### One Process, Full Stack

One Node.js daemon runs everything — channels, routing, sessions, tools, providers, web UI. No Docker. No Redis. No Kubernetes. Runs on a $5 VPS or a bare-metal server. CPU-only. If it runs Node.js 20+, it runs Mach6.

---

## ⚙ Configuration

### `mach6.json` — Agent configuration

```jsonc
{
  "defaultProvider": "groq",
  "defaultModel": "llama-3.3-70b-versatile",
  "maxTokens": 8192,
  "maxIterations": 25,
  "temperature": 0.3,

  "workspace": "/home/you/workspace",
  "sessionsDir": ".sessions",

  "providers": {
    "groq":           { "baseUrl": "https://api.groq.com/openai" },
    "anthropic":      {},
    "openai":         {},
    "xai":            {},
    "ollama":         { "baseUrl": "http://127.0.0.1:11434" },
    "gemini":         {},
    "github-copilot": {},
    "gladius":        { "baseUrl": "http://127.0.0.1:8741" }
  },

  "ownerIds": [
    "your-discord-user-id",
    "your-phone@s.whatsapp.net"
  ],

  "discord": {
    "enabled": true,
    "token": "${DISCORD_BOT_TOKEN}",
    "botId": "${DISCORD_CLIENT_ID}",
    "policy": {
      "dmPolicy": "allowlist",
      "groupPolicy": "mention-only",
      "allowedSenders": ["your-discord-user-id"]
    }
  },

  "whatsapp": {
    "enabled": true,
    "authDir": "~/.mach6/whatsapp-auth",
    "phoneNumber": "your-phone-number",
    "policy": {
      "dmPolicy": "allowlist",
      "allowedSenders": ["your-phone@s.whatsapp.net"]
    }
  },

  "apiPort": 3006
}
```

All string values support `${ENV_VAR}` interpolation.

### `.env` — Secrets

```bash
# LLM Providers
GROQ_API_KEY=gsk_...           # Free tier — https://console.groq.com/keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
XAI_API_KEY=xai-...
GEMINI_API_KEY=AIza...         # Free tier — https://aistudio.google.com/apikey

# Discord
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=

# HTTP API
MACH6_API_KEY=
MACH6_PORT=3006
```

---

## 🧠 Providers

| Provider | Key | Auth | Notes |
|----------|-----|------|-------|
| **Groq** | `groq` | `GROQ_API_KEY` | ⚡ Fastest. Free tier. Start here. |
| **Anthropic** | `anthropic` | `ANTHROPIC_API_KEY` | Claude models |
| **OpenAI** | `openai` | `OPENAI_API_KEY` | GPT-4o, o3 |
| **xAI (Grok)** | `xai` | `XAI_API_KEY` | Grok 3, Grok 3 Mini |
| **GitHub Copilot** | `github-copilot` | Auto (`gh auth login`) | Free with Copilot sub |
| **Ollama** | `ollama` | None (local) | Any model, fully offline |
| **Gemini** | `gemini` | `GEMINI_API_KEY` | Native SDK, streaming + thinking |
| **Gladius** | `gladius` | None (local) | Artifact Virtual's AI kernel |

Providers are hot-swappable mid-session via `/provider` and `/model` commands.

**Recommended for getting started:** Groq — free tier, 280–1000 tok/sec, no credit card. [Get a key →](https://console.groq.com/keys)

### Groq models

| Model | Config value | Notes |
|-------|-------------|-------|
| Llama 3.3 70B | `llama-3.3-70b-versatile` | Best all-around (default) |
| Qwen3 32B | `qwen/qwen3-32b` | Strong reasoning |
| Llama 3.1 8B | `llama-3.1-8b-instant` | Fastest, lighter tasks |

### xAI (Grok) models

| Model | Config value |
|-------|-------------|
| Grok 3 | `grok-3` |
| Grok 3 Fast | `grok-3-fast` |
| Grok 3 Mini | `grok-3-mini` |

### GitHub Copilot (no API key needed)

Token auto-resolves from `gh auth login`. Proxy models include Claude Opus 4.6, Claude Sonnet 4, GPT-4o, o3-mini.

### Gemini models

| Model | Config value | Notes |
|-------|-------------|-------|
| Gemini 2.0 Flash | `gemini-2.0-flash` | Fast, multimodal (default) |
| Gemini 2.0 Flash Thinking | `gemini-2.0-flash-thinking-exp` | Extended thinking |
| Gemini 1.5 Pro | `gemini-1.5-pro` | Long context (1M tokens) |
| Gemini 1.5 Flash | `gemini-1.5-flash` | Fast, free tier |

### Ollama

```bash
ollama pull qwen3:4b
# Then: defaultProvider: "ollama", defaultModel: "qwen3:4b"
```

---

## 🛠 Tools

18 built-in tools available to every agent:

| Tool | Description |
|------|------------|
| `read` | Read files (offset/limit for large files) |
| `write` | Write/create files |
| `edit` | Surgical find-and-replace editing |
| `exec` | Shell command execution |
| `image` | Vision model image analysis |
| `web_fetch` | Fetch URLs, strip HTML |
| `tts` | Text-to-speech (Edge TTS, 6 voices) |
| `memory_search` | Hybrid BM25 + vector search over indexed files |
| `comb_recall` | Recall persistent memory from last session |
| `comb_stage` | Stage information for next session |
| `message` | Send messages, media, reactions to any channel |
| `typing` | Send typing indicators |
| `presence` | Update presence/status |
| `delete_message` | Delete messages |
| `mark_read` | Send read receipts |
| `process_start` | Start background processes |
| `process_poll` | Poll process output |
| `process_kill` | Kill processes |
| `spawn` | Spawn sub-agents (up to depth 3) |

Tools are sandboxed per-session via the policy engine. MCP bridge available for external tool servers.

---

## 🖥 Web UI

Built-in at `http://localhost:3006`:

- Session management (create, switch, delete)
- Streaming responses with real-time tool call visualization
- Live config panel (provider, model, temperature, API keys)
- Sub-agent monitoring
- Rich rendering for file reads, exec output, fetches

No build step. One static HTML file.

---

## 🖥 CLI

### Interactive REPL

```bash
mach6 repl
# or
node dist/index.js --config=mach6.json
```

### Commands

| Command | Description |
|---------|------------|
| `/help` | All commands |
| `/tools` | List available tools |
| `/model <name>` | Switch model mid-session |
| `/provider <name>` | Switch provider mid-session |
| `/spawn <task>` | Spawn a sub-agent |
| `/status` | Session stats (tokens, tool usage) |
| `/sessions` | List all sessions |
| `/history [N]` | Last N messages |
| `/clear` | Clear current session |

### One-shot mode

```bash
node dist/index.js "Summarize the README in this directory"
```

---

## 🐧 Running as a Service

### Linux (systemd)

```bash
sudo cp mach6-gateway.service /etc/systemd/system/
sudo systemctl enable --now mach6-gateway

# Hot-reload config without restarting:
kill -USR1 $(pgrep -f "gateway/daemon.js")
```

### macOS

LaunchAgent pointing to `node dist/gateway/daemon.js`.

### Windows

NSSM or Task Scheduler with `node dist/gateway/daemon.js --config=mach6.json`.

---

## 📁 Project Structure

```
mach6/
├── src/
│   ├── agent/          # Runner, context manager, system prompt builder
│   ├── boot/           # Boot sequence & validation
│   ├── channels/       # Adapters — Discord, WhatsApp, router, bus
│   │   ├── bus.ts      # Priority queue, coalescing, interrupts
│   │   ├── router.ts   # Policy, dedup, JID normalization
│   │   └── adapters/   # discord.js + Baileys v7
│   ├── cli/            # Interactive setup wizard
│   ├── config/         # Config loader, validator, env interpolation
│   ├── cron/           # Cron budget management
│   ├── gateway/        # Persistent daemon — signals, hot-reload, turns
│   ├── heartbeat/      # Activity-aware periodic health checks
│   ├── providers/      # Groq, Anthropic, OpenAI, xAI, Copilot, Ollama, Gemini, Gladius
│   ├── sessions/       # Session store, queue, sub-agents
│   ├── tools/          # 18+ built-in tools, policy engine, MCP bridge
│   └── web/            # Web UI server (SSE streaming)
├── web/                # Web UI (single HTML file)
├── mach6.example.json
├── .env.example
└── mach6-gateway.service
```

---

## 🔒 Production-Ready

20+ hardening decisions baked in:

| Feature | What it does |
|---------|-------------|
| **Blink** | Seamless iteration budget continuation — no hard walls |
| **Pulse** | Adaptive budget: 20 → 100 on demand, auto-reverts |
| **COMB** | Lossless session-to-session memory, zero dependencies |
| **Config validation** | Human-readable diagnostics at boot |
| **Context monitor** | Progressive warnings at 70/80/90% |
| **Priority queue** | Real messages never drop, only background signals shed |
| **Tool policy engine** | Scope tools per session and security tier |
| **Provider diagnostics** | Health checks + automatic failover |
| **Activity-aware heartbeat** | Adapts frequency to user presence |
| **Cron budget management** | Jobs declare resource budgets, scheduler enforces limits |
| **Memory index integrity** | Validates HEKTOR indices at startup, auto-rebuilds if corrupt |
| **Abort propagation** | Agent runner → LLM stream → tool execution |
| **MCP bridge** | Connect external tool servers |
| **MCP server mode** | Expose Mach6 tools to external agents and editors |
| **Sibling bot yield** | @mention one bot, only that one responds |
| **Anti-loop system** | Structural echo loop prevention in multi-bot environments |

---

## 📊 By the Numbers

| | |
|--|--|
| TypeScript source | ~15,000+ lines |
| Source files | 70+ |
| Built-in tools | 18+ |
| LLM providers | 8 |
| Channel adapters | 2 + HTTP API |
| Documentation files | 37 |
| Cold boot → connected | ~2.3s |
| Runtime dependencies | Node.js only |

---

## 🌐 Platform Compatibility

| Feature | Windows | Linux | macOS |
|---------|---------|-------|-------|
| Gateway daemon | ✅ | ✅ | ✅ |
| Discord + WhatsApp | ✅ | ✅ | ✅ |
| HTTP API + Web UI | ✅ | ✅ | ✅ |
| CLI | ✅ | ✅ | ✅ |
| Hot-reload (SIGUSR1) | ❌ | ✅ | ✅ |

---

## 📜 Changelog

| Version | Date | What changed |
|---------|------|-------------|
| **v1.6.0** | Mar 7, 2026 | Native Gemini, 8 providers, multi-user deployment, agent wizard |
| **v1.5.0** | Mar 6, 2026 | Blink, Pulse, COMB, 7 providers |
| **v1.4.0** | Mar 5, 2026 | MCP server, anti-loop, degradation protection |
| **v1.3.0** | Mar 3, 2026 | Sibling bot yield, ATM |
| **v1.0.0** | Feb 28, 2026 | Cross-platform, CLI wizard |
| **v0.1.0** | Feb 22, 2026 | Initial release — built and shipped same day |

---

## 📄 License

[MIT](LICENSE) — do whatever you want with it.

---

<div align="center">

Built by **[Artifact Virtual](https://artifactvirtual.com)**

---

`#ai-agent` `#llm-agent` `#autonomous-agent` `#tool-calling` `#agentic-ai`
`#discord-bot` `#whatsapp-bot` `#multi-channel` `#chatbot-framework`
`#groq` `#anthropic` `#claude` `#openai` `#gpt4` `#grok` `#xai`
`#ollama` `#local-llm` `#github-copilot` `#mcp` `#model-context-protocol`
`#typescript` `#nodejs` `#self-hosted` `#open-source` `#local-first`

</div>
