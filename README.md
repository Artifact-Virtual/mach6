<div align="center">

# ⚡ Mach6

**Multi-channel AI agent framework that runs on a laptop.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

A persistent daemon that connects to messaging platforms, routes conversations through LLM providers, and executes tool calls in an agentic loop. No cloud dependencies. No vendor lock-in. **Your machine, your data, your keys.**

[Quick Start](#-quick-start) · [Architecture](#-architecture) · [Config](#-configuration) · [Providers](#-providers) · [Tools](#-tools) · [Web UI](#-web-ui)

</div>

---

## 🚀 Quick Start

```bash
# Clone & build
git clone https://github.com/amuzetnoM/mach6.git
cd mach6
npm install && npm run build

# Interactive setup — generates mach6.json + .env
npx mach6 init

# Start the daemon
node dist/gateway/daemon.js --config=mach6.json
```

> **Windows (PowerShell):** Same commands — Mach6 is fully cross-platform. Use `.\mach6.ps1` or `node dist/gateway/daemon.js --config=mach6.json`.

<details>
<summary><strong>Manual setup (without wizard)</strong></summary>

```bash
cp mach6.example.json mach6.json
cp .env.example .env
# Edit both files — set API keys, channel tokens, workspace path, ownerIds
```

</details>

---

## 🏗 Architecture

```
                         ┌──────────────┐
                         │   Web UI     │
                         │   :3006      │
                         └──────┬───────┘
                                │ SSE
┌──────────┐  ┌──────────┐  ┌──┴───────────┐  ┌──────────┐  ┌─────────┐
│ Discord  │──│  Router   │──│  Message Bus │──│  Agent   │──│ Provider│──→ LLM
│ WhatsApp │  │  Policy   │  │  Priority Q  │  │  Runner  │  │ (swap)  │
│ HTTP API │  │  Dedup    │  │  Coalesce    │  │  Tools   │  └─────────┘
└──────────┘  └──────────┘  │  Interrupt   │  │  Abort   │
                            │  Backpressure│  │  Iterate │
                            └──────────────┘  └──────────┘
```

| Layer | What it does |
|-------|-------------|
| **Channels** | Discord (discord.js), WhatsApp (Baileys v7). Adapter pattern — add any platform. |
| **Router** | Policy enforcement, JID normalization, deduplication, interrupt detection, priority. |
| **Message Bus** | Priority queue with interrupt bypass, message coalescing, backpressure management. |
| **Agent Runner** | Agentic loop — tool calling, context management, abort signals, iteration limits. |
| **Providers** | GitHub Copilot, Anthropic, OpenAI, Gladius (local). Hot-swappable mid-session. |
| **Tools** | 18 built-in. File I/O, shell, browser, TTS, memory, process management, messaging. |
| **Sessions** | Persistent, labeled, TTL-aware. Sub-agent spawning up to depth 3. |

---

## 🔥 What Makes Mach6 Different

### Real-Time Interrupts

Most agent frameworks are request-response: you send a message, you wait, you get a reply. If the agent is mid-turn, your new message queues silently. You can't stop it. You can't redirect it.

**Mach6 doesn't work that way.** Every message is priority-classified in real-time:

```
interrupt  →  Bypasses queue. Cancels active turn immediately.
high       →  Skips coalescing. Next in line.
normal     →  Standard processing with coalescing.
low        →  Reactions, group mentions. Queued politely.
background →  Typing indicators. Dropped under backpressure.
```

Send "stop" while the agent is mid-thought → the agent stops. Immediately. Not after the current tool call. Not after the current paragraph. **Now.**

### Message Coalescing

Three messages in rapid succession? Mach6 buffers and merges them:

```
"hey"              → buffered
"can you"          → buffered
"check the logs"   → 2s timer expires → merged into one envelope
```

One coherent request, one turn, no wasted tokens.

### Single Process, Zero Infrastructure

One Node.js daemon. No Docker. No Redis. No Kubernetes. No microservices. Install, configure, run. It's a binary that talks to LLMs and messaging platforms. That's it.

---

## ⚙ Configuration

### `mach6.json` — Agent configuration

```jsonc
{
  "defaultProvider": "github-copilot",
  "defaultModel": "claude-opus-4-6",
  "maxTokens": 8192,
  "maxIterations": 50,
  "temperature": 0.3,

  // Use forward slashes on all platforms
  // Windows: "C:/Users/you/workspace"
  "workspace": "/home/you/workspace",
  "sessionsDir": ".sessions",

  "providers": {
    "github-copilot": {},
    "anthropic": {},
    "openai": {},
    "gladius": { "baseUrl": "http://127.0.0.1:8741" }
  },

  "ownerIds": [
    "your-discord-user-id",
    "your-phone@s.whatsapp.net"
  ],

  "discord": {
    "enabled": true,
    "token": "${DISCORD_BOT_TOKEN}",
    "botId": "${DISCORD_CLIENT_ID}",
    "siblingBotIds": [],
    "policy": {
      "dmPolicy": "allowlist",
      "groupPolicy": "mention-only",
      "requireMention": true,
      "allowedSenders": ["your-discord-user-id"],
      "allowedGroups": []
    }
  },

  "whatsapp": {
    "enabled": true,
    "authDir": "~/.mach6/whatsapp-auth",
    "phoneNumber": "your-phone-number",
    "autoRead": true,
    "policy": {
      "dmPolicy": "allowlist",
      "groupPolicy": "mention-only",
      "allowedSenders": ["your-phone@s.whatsapp.net"],
      "allowedGroups": []
    }
  },

  "apiPort": 3006
}
```

All string values support `${ENV_VAR}` interpolation.

### `.env` — Secrets

```bash
# LLM Providers
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# GitHub Copilot — usually automatic via `gh auth login`
# COPILOT_GITHUB_TOKEN=

# Discord
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=

# HTTP API authentication
MACH6_API_KEY=

# Port (default: 3006)
MACH6_PORT=3006
```

> Run `mach6 init` to generate both files interactively.

---

## 🧠 Providers

| Provider | Config Key | How it authenticates |
|----------|-----------|---------------------|
| **GitHub Copilot** | `github-copilot` | Auto-resolved (see below) — no API key needed |
| **Anthropic** | `anthropic` | `ANTHROPIC_API_KEY` env var |
| **OpenAI** | `openai` | `OPENAI_API_KEY` env var |
| **Gladius** | `gladius` | Local HTTP endpoint |

### GitHub Copilot token resolution

No API key required if `gh` CLI is installed and authenticated. Token resolves in order:

1. `COPILOT_GITHUB_TOKEN` env var
2. `~/.copilot-cli-access-token` file
3. `GH_TOKEN` / `GITHUB_TOKEN` env vars
4. `~/.config/github-copilot/hosts.json` (Linux/macOS)
5. `%APPDATA%\github-copilot\hosts.json` (Windows)
6. `gh auth token` CLI fallback (all platforms)

### Available models (via Copilot proxy)

| Model | Config value |
|-------|-------------|
| Claude Opus 4.6 | `claude-opus-4-6` |
| Claude Sonnet 4 | `claude-sonnet-4` |
| GPT-4o | `gpt-4o` |
| o3-mini | `o3-mini` |

Providers are hot-swappable mid-session via `/provider` and `/model` commands.

---

## 🛠 Tools

18 built-in tools, available to the agent by default:

| Tool | Description |
|------|------------|
| `read` | Read file contents (with offset/limit for large files) |
| `write` | Write/create files (auto-creates parent directories) |
| `edit` | Surgical find-and-replace editing |
| `exec` | Execute shell commands |
| `image` | Analyze images with vision models |
| `web_fetch` | Fetch URLs, strip HTML to text |
| `tts` | Text-to-speech (Edge TTS, multiple voices) |
| `memory_search` | Hybrid BM25 + vector search over indexed files |
| `comb_recall` | Recall persistent session-to-session memory |
| `comb_stage` | Stage information for next session |
| `message` | Send messages, media, and reactions to any channel |
| `typing` | Send typing indicators |
| `presence` | Update presence status |
| `delete_message` | Delete messages |
| `mark_read` | Send read receipts |
| `process_start` | Start background processes |
| `process_poll` | Poll background process output |
| `process_kill` | Kill background processes |
| `process_list` | List background processes |
| `spawn` | Spawn sub-agents (up to depth 3) |

Tools are sandboxed per-session via the policy engine. MCP bridge available for external tool servers.

---

## 🖥 Web UI

Mach6 ships with a built-in web interface at `http://localhost:3006`:

- **Session management** — create, switch, delete sessions
- **Streaming responses** — real-time SSE with tool call visualization
- **Config panel** — change provider, model, temperature, API keys live
- **Sub-agent monitoring** — view and kill running sub-agents
- **Generative UI** — file reads, exec outputs, and fetches render as rich cards

No build step. No npm dependencies. One static HTML file.

---

## 🖥 CLI

### Interactive REPL

```bash
node dist/index.js --config=mach6.json
```

```
Mach6 v0.2 | github-copilot/claude-opus-4-6 | session: default
Tools (18): read, write, edit, exec, image, web_fetch, tts, ...
Type /help for commands

❯ What's in the logs?
⚡ exec
✓ exec tail -50 /var/log/syslog
...
```

### Commands

| Command | Description |
|---------|------------|
| `/help` | Show all commands |
| `/tools` | List available tools |
| `/model <name>` | Switch model mid-session |
| `/provider <name>` | Switch provider mid-session |
| `/spawn <task>` | Spawn a sub-agent |
| `/status` | Session stats (tokens, tool usage) |
| `/sessions` | List all sessions |
| `/history [N]` | Show last N messages |
| `/clear` | Clear current session |
| `/quit` | Exit |

### One-shot mode

```bash
node dist/index.js "Summarize the README in this directory"
```

---

## 🐧 Running as a Service

### Linux (systemd)

```bash
# Copy the included service file
sudo cp mach6-gateway.service /etc/systemd/system/
# Edit it — set your paths and user
sudo systemctl enable --now mach6-gateway

# Hot-reload config without restarting:
kill -USR1 $(pgrep -f "gateway/daemon.js")
```

### macOS (launchd)

Create `~/Library/LaunchAgents/com.mach6.gateway.plist` pointing to `node dist/gateway/daemon.js`.

### Windows

Use [NSSM](https://nssm.cc/) or Task Scheduler to run `node dist/gateway/daemon.js --config=mach6.json`.

> **Note:** `SIGUSR1` hot-reload is not available on Windows. Restart the process to reload config.

---

## 📁 Project Structure

```
mach6/
├── src/
│   ├── agent/          # Runner, context manager, system prompt builder
│   ├── boot/           # Boot sequence & validation
│   ├── channels/       # Adapter pattern — Discord, WhatsApp, router, bus
│   │   ├── bus.ts      # Priority queue, coalescing, interrupts, backpressure
│   │   ├── router.ts   # Policy, dedup, JID normalization, priority
│   │   └── adapters/   # Discord (discord.js), WhatsApp (Baileys v7)
│   ├── cli/            # Interactive setup wizard
│   ├── config/         # Config loader, validator, env interpolation
│   ├── cron/           # Cron budget management
│   ├── formatters/     # Platform-aware markdown formatting
│   ├── gateway/        # Persistent daemon — signals, hot-reload, turns
│   ├── heartbeat/      # Activity-aware periodic health checks
│   ├── memory/         # Index integrity checks
│   ├── providers/      # LLM providers — Copilot, Anthropic, OpenAI, Gladius
│   ├── security/       # Input sanitization
│   ├── sessions/       # Session store, queue, sub-agents
│   ├── tools/          # 18 built-in tools, policy engine, registry, MCP bridge
│   └── web/            # Web UI server (SSE streaming, static serving)
├── web/                # Web UI (single HTML file)
├── mach6.example.json  # Example config
├── .env.example        # Example environment variables
├── mach6.sh            # Linux/macOS start script
├── mach6.ps1           # Windows start script
└── mach6-gateway.service  # systemd unit file
```

---

## 🔒 Hardening

20 production pain points addressed:

- **Config validation** with human-readable diagnostics at boot
- **Context monitor** with progressive warnings (70/80/90% thresholds)
- **Priority message queue** — real messages never drop, only background signals shed under backpressure
- **Tool policy engine** — scope available tools per session and security tier
- **Provider diagnostics** — health checks and automatic failover
- **Activity-aware heartbeat** — adapts frequency to system load
- **Cron budget management** — prevents runaway scheduled tasks
- **Boot sequence validation** — catch misconfigurations before they become incidents
- **JID normalization** for WhatsApp Baileys v7 (device suffix stripping)
- **Abort signal propagation** through agent runner → LLM stream → tool execution
- **MCP bridge** for connecting external tool servers
- **Sibling bot yield** — @mention one bot, only that one responds

---

## 📊 Stats

| Metric | Value |
|--------|-------|
| Lines of TypeScript | ~8,400 |
| Built-in tools | 18 |
| LLM providers | 4 |
| Channel adapters | 2 + HTTP API |
| Cold boot to connected | ~2.3s |
| External runtime deps | Node.js only |

---

## 🌐 Platform Compatibility

| Feature | Windows | Linux | macOS |
|---------|---------|-------|-------|
| Gateway daemon | ✅ | ✅ | ✅ |
| Discord adapter | ✅ | ✅ | ✅ |
| WhatsApp adapter | ✅ | ✅ | ✅ |
| HTTP API + Web UI | ✅ | ✅ | ✅ |
| CLI (REPL + one-shot) | ✅ | ✅ | ✅ |
| Hot-reload (SIGUSR1) | ❌ | ✅ | ✅ |
| Service manager | Task Scheduler | systemd | launchd |
| Temp directory | `%TEMP%` | `/tmp` | `/tmp` |
| Home directory | `%USERPROFILE%` | `~` | `~` |

All paths resolved via `os.tmpdir()` and `os.homedir()` — zero hardcoded Unix paths.

---

## 📜 History

| Date | Milestone |
|------|----------|
| **Feb 22, 2026** | Built from scratch. WhatsApp, Discord, gateway, config, tools, sessions. |
| **Feb 22, 2026** | 14/14 smoke tests. 20 hardening fixes. Flipped to production same day. |
| **Feb 23, 2026** | Open-sourced. MIT license. |
| **Feb 28, 2026** | Cross-platform (Windows/Linux/macOS). CLI wizard. v1.0.0. |

---

## 📄 License

[MIT](LICENSE) — do whatever you want with it.

---

<div align="center">

Built by **[Artifact Virtual](https://artifactvirtual.com)**

Open-sourced because infrastructure wants to be free.

</div>
