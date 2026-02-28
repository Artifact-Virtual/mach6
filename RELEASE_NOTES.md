# Release Notes — v1.0.0

## ⚡ Mach6 v1.0.0 — First Stable Release

**Date:** February 28, 2026

Mach6 is a multi-channel AI agent framework — a persistent daemon that connects to messaging platforms, routes conversations through LLM providers, and executes tool calls in an agentic loop. No cloud dependencies. No vendor lock-in. Runs on a laptop.

### Highlights

🚀 **Interactive Setup Wizard** — `npx mach6 init` walks you through provider, channels, policies, and generates `mach6.json` + `.env` automatically.

🖥 **Cross-Platform** — Windows, Linux, macOS. All paths use `os.tmpdir()` and `os.homedir()`. Zero hardcoded Unix paths. Start scripts for Bash and PowerShell.

⚡ **Real-Time Interrupts** — Send "stop" mid-turn and the agent stops immediately. Priority-classified message queue with interrupt bypass, coalescing, and backpressure management.

🔌 **Multi-Channel** — Discord (discord.js) and WhatsApp (Baileys v7) adapters. HTTP API with SSE streaming. Sibling bot yield for multi-bot setups.

🧠 **4 LLM Providers** — GitHub Copilot (auto-auth via `gh` CLI), Anthropic, OpenAI, and Gladius (local). Hot-swappable mid-session.

🛠 **18 Built-in Tools** — File I/O, shell execution, image analysis, text-to-speech, memory search, process management, messaging, sub-agent spawning.

🌐 **Web UI** — Built-in chat interface with session management, streaming responses, tool call visualization, and config panel. Single HTML file, no build step.

🔒 **Production Hardened** — Config validation, context monitoring, tool sandboxing, abort signal propagation, JID normalization, cron budget management, boot sequence validation.

### What's New Since 0.1.0

- Interactive CLI wizard (`mach6 init`)
- Full Windows/macOS support (cross-platform path resolution)
- Bash + PowerShell start scripts
- Cleaned up repository (removed internal dev artifacts)
- Polished README with comprehensive documentation
- Updated package.json with proper metadata, keywords, engines

### Getting Started

```bash
git clone https://github.com/amuzetnoM/mach6.git
cd mach6
npm install && npm run build
npx mach6 init
node dist/gateway/daemon.js --config=mach6.json
```

### Requirements

- Node.js 20+
- npm 9+

---

Built by [Artifact Virtual](https://artifactvirtual.com). MIT License.
