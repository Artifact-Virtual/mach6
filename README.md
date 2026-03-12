<div align="center">

# Symbiote

**Autonomous AI agent gateway with web automation. Single process. Any machine.**

v2.1.0

</div>

---

## What Is Symbiote?

Symbiote is a self-contained AI agent gateway. One TypeScript process that handles multi-channel communication (Discord, WhatsApp, webchat, HTTP API), persistent memory, web browsing, and tool execution.

Built by [Artifact Virtual](https://artifactvirtual.com).

---

## Features

- **Multi-channel** — Discord, WhatsApp, webchat, HTTP API from one process
- **Web automation** — Playwright-powered browsing with persistent sessions and encrypted profiles
- **Persistent memory** — VDB (vector database) with BM25 + TF-IDF hybrid search, 10-second real-time indexing
- **31 tools** — exec, read, write, edit, web browsing (14 tools), memory, COMB, TTS, messaging
- **Session management** — concurrent sessions, context windowing, auto-archival
- **Provider chain** — multiple LLM providers with circuit-breaker failover
- **Zero external dependencies** — no Docker, no Redis, no database server

---

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.10+ (for web automation sidecar)
- Playwright Chromium: `python3 -m playwright install chromium`

### Install

```bash
git clone https://github.com/Artifact-Virtual/mach6.git
cd mach6
npm install
npx tsc
```

### Configure

```bash
cp mach6.example.json mach6.json
```

Required fields:
```json
{
  "llm": {
    "provider": "copilot",
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 16384
  },
  "discord": {
    "enabled": true,
    "token": "YOUR_DISCORD_BOT_TOKEN"
  }
}
```

### Run

```bash
node dist/gateway/daemon.js
```

Boot output:
```
SYMBIOTE v2.1.0 — Autonomous Agent Gateway
[symbiote] Tools registered: 31
[symbiote] Discord: connected
[symbiote] WhatsApp: connected  
[symbiote] Web UI: http://localhost:3009
[symbiote] SYMBIOTE READY
```

---

## Architecture

```
                    Symbiote Gateway
                    ================
                    
  Discord ──────┐
  WhatsApp ─────┤  Agent Pipeline
  Webchat ──────┤  - System prompt + context window
  HTTP API ─────┤  - Tool execution (31 tools)
                |  - LLM provider chain w/ failover
                |  - Response streaming
                |
                |  Session Manager
                |  - Per-user sessions
                |  - Auto-archival on context limit
                |  - Context windowing
                |
                |  VDB Memory Engine
                |  - BM25 keyword index
                |  - TF-IDF semantic vectors
                |  - 10-second real-time pulse
                |  - JSONL persistence
                |
                |  Web Suite (Playwright)
                |  - Python sidecar (JSON-RPC)
                |  - Encrypted browser profiles
                |  - Multi-tab browsing
                |  - Screenshot pipeline
                |
                |  COMB Persistence
                |  - Stage/recall across restarts
                |  - HEKTOR vectorization sidecar
                └──────────────────────
```

---

## Tools (31)

### Core (5)
| Tool | Description |
|------|-------------|
| `exec` | Execute shell commands |
| `read` | Read file contents |
| `write` | Write/create files |
| `edit` | Find-and-replace in files |
| `message` | Send messages to channels |

### Web Automation (14)
| Tool | Description |
|------|-------------|
| `web_browse` | Navigate to URL, extract page content |
| `web_click` | Click element by CSS selector or text |
| `web_type` | Type into input fields |
| `web_screenshot` | Capture page as image |
| `web_extract` | Extract content by CSS selector |
| `web_scroll` | Scroll viewport |
| `web_wait` | Wait for element or navigation |
| `web_session` | Switch browser profile |
| `web_tab_open` | Open new browser tab |
| `web_tab_switch` | Switch between tabs |
| `web_tab_close` | Close current tab |
| `web_tabs` | List all open tabs |
| `web_download` | Save downloaded file |
| `web_upload` | Upload file to input |

### Memory (3)
| Tool | Description |
|------|-------------|
| `memory_recall` | Search VDB with hybrid BM25 + TF-IDF scoring |
| `memory_ingest` | Bootstrap session archives into VDB |
| `memory_stats` | Show VDB statistics |

### COMB (2)
| Tool | Description |
|------|-------------|
| `comb_stage` | Persist context for next session |
| `comb_recall` | Recall context from previous sessions |

### Communication (5)
| Tool | Description |
|------|-------------|
| `discord_send` | Send Discord message |
| `discord_react` | React to Discord message |
| `whatsapp_send` | Send WhatsApp message |
| `tts_speak` | Text-to-speech |
| `tts_stop` | Stop TTS playback |

### Utility (2)
| Tool | Description |
|------|-------------|
| `sleep` | Pause execution |
| `think` | Internal reasoning (not sent to user) |

---

## Web Automation

Symbiote includes a full web browsing suite powered by a Python Playwright sidecar.

### How It Works

```
Agent calls web_browse("https://example.com")
    |
    TypeScript tool spawns Python sidecar (if not running)
    |
    Sidecar: Playwright opens page -> extracts text -> takes screenshot
    |
    Returns: { title, url, text (4000 token cap), screenshot_path }
    |
    Agent reasons about page content, decides next action
    |
    Sidecar closes after 5min idle (zero resource cost when not browsing)
```

### Browser Profiles

Encrypted browser profiles persist cookies and sessions:

```
~/.symbiote/profiles/
  default/
    cookies.enc        -- AES-256 encrypted
    config.json
  ali/
  ava/
  scarlet/
```

Switch profiles: `web_session("ali")` loads saved cookies. Logged-in sessions survive restarts.

### Security

- Credentials never enter LLM context. Agent sees page text only.
- Password fields detected but not read. Flagged for human intervention.
- Profile isolation. Separate browser contexts per profile.
- AES-256 cookie encryption at rest.
- Downloads sandboxed to ~/.symbiote/downloads/

---

## Configuration

Config file: `mach6.json` (name preserved for backward compatibility)

```json
{
  "llm": {
    "provider": "copilot",
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 16384,
    "temperature": 0.7
  },
  "discord": {
    "enabled": true,
    "token": "BOT_TOKEN"
  },
  "whatsapp": {
    "enabled": true,
    "authDir": ".wwebjs_auth"
  },
  "webPort": 3009,
  "webHost": "0.0.0.0",
  "agentFile": ".ava/agent.md",
  "sessionDir": ".sessions",
  "maxContextMessages": 100,
  "maxContextTokens": 32000
}
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `SYMBIOTE_ENCRYPTION_KEY` | AES-256 key for browser profile encryption |
| `COPILOT_PROXY_URL` | URL for Copilot proxy LLM provider |
| `OPENAI_API_KEY` | OpenAI API key (if using OpenAI provider) |
| `ANTHROPIC_API_KEY` | Anthropic API key (if using Anthropic provider) |

---

## Deployment

### Systemd (Linux)

```ini
[Unit]
Description=Symbiote Gateway
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/ava/mach6
ExecStart=/usr/bin/node dist/gateway/daemon.js
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

### NSSM (Windows)

```powershell
nssm install symbiote "C:\Program Files\nodejs\node.exe" "dist\gateway\daemon.js"
nssm set symbiote AppDirectory "C:\path\to\symbiote"
nssm start symbiote
```

---

## License

Proprietary. Artifact Virtual. All rights reserved.
