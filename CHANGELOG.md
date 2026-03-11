# Changelog

## v2.0.0 — Birthday Release (2026-03-12)

Ali's 38th birthday. The version number earned, not bumped.

### 🔧 Provider Health Monitor — Circuit Breaker + Intelligent Failover
- **Circuit breaker pattern:** Providers that fail 3× consecutively are automatically disabled for 60s cooldown
- **Latency-aware routing:** Tracks moving average latency per provider, prefers faster ones when all healthy
- **Auto-recovery:** Half-open probes after cooldown, full recovery after 2 consecutive successes
- **Health states:** healthy → degraded → unhealthy → circuit-open (with automatic state transitions)
- **Fallback chain integration:** Circuit-open providers are skipped during failover — no wasted retries
- File: `src/providers/health.ts` (202 lines)

### 🔥 Session Hot Resume — Survive Restarts
- **Session state persistence:** Active session metadata saved to disk every 60s
- **Graceful shutdown capture:** On SIGTERM/SIGINT, all active sessions marked and saved
- **Startup restoration:** Previous session state restored on boot with age validation (24h expiry)
- **Zero-loss restarts:** Gateway restarts no longer lose conversation context registration
- File: `src/sessions/hot-resume.ts` (193 lines)

### 📊 Metrics Collector — Runtime Observability
- **Provider metrics:** Call count, error count, token usage (in/out), latency histograms (p50/p90/p99)
- **Tool metrics:** Per-tool call frequency, latency, error rates
- **Session metrics:** Turn count, active sessions tracking
- **Ring buffer design:** Bounded memory, automatic eviction of old samples
- **Persistent:** Auto-flush to JSON every 5 minutes + shutdown flush
- **Zero dependencies:** Pure Node.js stdlib, non-blocking fire-and-forget recording
- File: `src/metrics/collector.ts` (466 lines)

### 🏥 Enhanced Health Endpoint
- `GET /api/v1/health` now returns comprehensive gateway status:
  - Version, uptime (human-readable), PID
  - Provider health states (circuit breaker status per provider)
  - Metrics snapshot (tokens, latency, errors)
  - Memory usage (RSS + heap in MB)
  - Active turns, session count, tool count, connected channels

### Infrastructure
- Symbiote rebrand (v1.7 → v2.0 naming)
- IPC Identity (HMAC-SHA256 inter-agent authentication)
- Web Automation Suite (14 browser tools via Playwright sidecar)
- VDB embedded vector database with 5s real-time indexing pulse
- Voice middleware (Whisper transcription + MeloTTS generation)
- Webchat dark glass UI overhaul
- One-command installer (bash + PowerShell)
- UTF-8 BOM stripping for Windows config compatibility

### By the Numbers
- **Total source:** ~19,000 lines TypeScript
- **Built-in tools:** 31
- **Providers:** 8 (Anthropic, OpenAI, GitHub Copilot, Gemini, Groq, Ollama, xAI, GLADIUS)
- **New v2.0 code:** 861 lines across 3 new modules

---

## v1.7.0 (2026-03-10)

### Features
- VDB persistent memory engine
- 10-second real-time indexing pulse
- COMB → HEKTOR vectorization sidecar
- Context Monitor (proactive context management)

---

## v1.6.0 (2026-03-08)

### Features
- Provider fallback chain
- Session archival and context windowing
- WhatsApp Web integration
- Webchat visual overhaul

---

## v1.5.0 and earlier

See git history.
