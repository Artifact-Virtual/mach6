# Changelog

## v1.4.0 — MCP Server, Anti-Loop & Degradation Protection (2026-03-05)

### Features
- **MCP server mode** — expose Mach6 tools as an MCP server for external agents and editors
- **Anti-loop system** — structural prevention of bot echo loops in multi-bot Discord environments. Detects coordination phrases, suppresses recursive mentions, maintains normal flow when safe
- **Systemd service integration** — production-grade process management with auto-restart, resource limits, and journal logging

### Improvements
- **Provider retry hardening** — increased retry delays (2s/5s/10s), fresh abort signals on retry to prevent stale timeout propagation
- **GitHub Copilot timeout** — extended token exchange timeout from 15s to 30s for slower networks
- **Source sanitization** — all hardcoded paths replaced with portable `process.cwd()` resolution
- **Full documentation suite** — 28 docs across 7 sections, GitBook-compatible structure

### Stats
- 66 source files, ~13,800 lines of TypeScript
- 14+ built-in tools + MCP bridge + MCP server
- 4 LLM providers (GitHub Copilot, Anthropic, OpenAI, Gladius)
- 2 channel adapters + HTTP API
- 28 documentation files

---

## v1.3.0 — Multi-Bot Coordination & ATM (2026-03-03)

### Features
- **Adaptive Temperature Modulation (ATM)** — dynamic per-task temperature control with four profiles: precise, balanced, creative, exploratory
- **Multi-bot coordination** — sibling bot detection, mention-based yield, cooldown-based echo loop prevention
- **Sister message injection** — context-aware message framing for bot-to-bot communication

### Improvements
- Professional GitBook documentation
- Gitee mirror synchronization

---

## v1.2.0 — Multi-Bot Coordination (2026-02-28)

### Features
- Sibling bot ID configuration for multi-bot environments
- Channel-level cooldown for sister bot messages
- Mention-based routing — @mention one bot, only that one responds

---

## v1.1.0 — Brand Kit & First npm Publish (2026-02-28)

### Features
- Interactive CLI setup wizard (`mach6 init`)
- Branded terminal output with gradient headers
- Published to npm as `mach6-core`

### Fixes
- CVE fix: override `undici >=6.23.0` (GHSA-g9mf-h72j-4rw9)
- README overhaul with Mermaid architecture diagram

---

## v1.0.0 — First Stable Release (2026-02-28)

### Features
- Full cross-platform support (Windows, Linux, macOS)
- Discord adapter (discord.js v14)
- WhatsApp adapter (Baileys v7)
- HTTP API with SSE streaming
- Web UI — single HTML file, no build step
- 18 built-in tools
- 4 LLM providers (GitHub Copilot, Anthropic, OpenAI, Gladius)
- MCP bridge for external tool servers
- Priority message bus with interrupts and coalescing
- Session management with TTL and persistence
- Sub-agent spawning (max depth 3)
- Tool policy engine with resource budgets
- Boot sequence validation
- Graceful shutdown with session persistence
- Hot-reload via SIGUSR1

### Stats
- ~8,400 lines of TypeScript
- 18 built-in tools
- 4 LLM providers
- 2 channel adapters + HTTP API
- Cold boot to connected: ~2.3s

---

Built by [Artifact Virtual](https://artifactvirtual.com). MIT License.
