# Mach6

**Production-grade AI agent framework. Single process. Any machine.**

Mach6 is a persistent daemon that connects messaging platforms, LLM providers, and tool execution into a single agentic loop — with real-time interrupts, message coalescing, and sub-agent orchestration.

No Docker. No Redis. No cloud dependencies. **Your machine, your data, your keys.**

---

## Why Mach6?

Most agent frameworks treat messaging as an afterthought — bolted-on REST endpoints that queue messages and pray. Mach6 was built messaging-first:

- **Real-time interrupts** — say "stop" mid-turn and the agent stops. Immediately. Not after the current tool call.
- **Message coalescing** — three rapid messages become one coherent request. One turn, no wasted tokens.
- **Single process** — one Node.js daemon runs channels, routing, sessions, tools, providers, and a web UI. The same binary runs on a $200 VPS or bare metal.
- **Sovereign** — CPU-only, no GPU required. If it runs Node.js 20+, it runs Mach6.

## What You Can Build

| Use Case | How |
|----------|-----|
| Personal AI assistant | Discord bot + WhatsApp, always-on daemon |
| Development copilot | CLI REPL with file/exec tools, persistent sessions |
| Multi-agent system | Sub-agent spawning with depth control |
| Enterprise chatbot | HTTP API + tool policy engine + session management |
| Multi-platform bridge | Same agent identity across Discord, WhatsApp, and HTTP |

## Quick Links

- [Installation →](getting-started/installation.md)
- [Quick Start →](getting-started/quick-start.md)
- [Architecture →](core/architecture.md)
- [GitHub](https://github.com/Artifact-Virtual/mach6)
- [npm](https://www.npmjs.com/package/mach6-core)

---

Built by [Artifact Virtual](https://artifactvirtual.com). MIT License.
