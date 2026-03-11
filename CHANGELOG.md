# Changelog

## v2.0.0 — Symbiote (2026-03-11)

### Rebrand
- Mach6 -> Symbiote across all source, configs, UI, boot messages, docs
- Package name: symbiote
- Boot banner: SYMBIOTE v2.0.0

### Web Automation Suite (14 new tools)
- Browser engine: Python Playwright sidecar with JSON-RPC over stdin/stdout
- 14 tools: web_browse, web_click, web_type, web_screenshot, web_extract, web_scroll, web_wait, web_session, web_tab_open, web_tab_switch, web_tab_close, web_tabs, web_download, web_upload
- Persistent browser profiles with AES-256 encrypted cookies
- Multi-tab management
- Smart text extraction (Readability pipeline, 4000 token cap)
- Screenshot pipeline
- Cookie banner auto-dismissal
- Sidecar launches lazily, closes after 5min idle (zero idle cost)
- Credentials never enter LLM context

### Memory
- VDB: BM25 + TF-IDF hybrid search engine (450 lines)
- 10-second real-time indexing pulse
- 3 tools: memory_recall, memory_ingest, memory_stats
- COMB -> HEKTOR vectorization sidecar (no more memory loss)

### Webchat
- Complete UI overhaul: dark glass aesthetic, Inter + JetBrains Mono
- Markdown rendering (tables, code blocks, blockquotes)
- Session sidebar with time-grouped conversations
- Copy-to-clipboard on code blocks
- Mobile responsive with slide-out sidebar
- Animated welcome orb

### Infrastructure
- maxTokens raised 8192 -> 16384 across all providers
- LAN-accessible webchat via webHost config
- UTF-8 BOM stripping for Windows config compatibility
- One-command installer (bash + PowerShell)

### Tool Count
- v1.x: 17 tools
- v2.0.0: 31 tools

---

## v1.7.0 (2026-03-10)

### Features
- VDB persistent memory engine
- 10-second real-time indexing pulse
- COMB -> HEKTOR vectorization sidecar

---

## v1.6.0 (2026-03-08)

### Features
- Provider chain with circuit-breaker failover
- Session archival and context windowing
- WhatsApp Web integration

---

## v1.5.0 and earlier

See git history.
