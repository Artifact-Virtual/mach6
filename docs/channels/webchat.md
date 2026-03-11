# Web UI (Webchat)

Mach6 ships with a built-in web interface — a single-page chat UI served directly from the gateway. No build step. No CDN. No external dependencies.

## Overview

The Web UI provides a browser-based chat interface to any Mach6 agent. It connects to the HTTP API via Server-Sent Events (SSE) for real-time streaming responses.

```
Browser → Web UI (port 3009) → HTTP API (port 3006) → Agent Runner → LLM
                                      ↑
                                    SSE stream
```

## Accessing the Web UI

The Web UI is served on the `webPort` configured in `mach6.json`:

```
http://127.0.0.1:3009    # AVA instance
http://127.0.0.1:3010    # Aria instance
http://192.168.1.13:3009  # LAN access (if firewall allows)
```

> **Security:** As of v1.7.0, the webchat binds to `0.0.0.0` by default but should be restricted via firewall rules. The HTTP API binds to `127.0.0.1` only.

## Features

- **Dark glass aesthetic** — Artifact Virtual branding, gradient headers
- **Real-time streaming** — SSE-based response streaming (tokens appear as generated)
- **Session persistence** — conversations persist in the browser via localStorage
- **Agent identity** — agent name and emoji pulled from config, not hardcoded
- **Mobile responsive** — works on desktop and mobile browsers
- **Zero build step** — single HTML file with inline CSS and JavaScript

## Configuration

In `mach6.json`:

```json
{
  "webPort": 3009,
  "httpPort": 3006
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `webPort` | `3009` | Port for the Web UI server |
| `httpPort` | `3006` | Port for the HTTP API (webchat proxies to this) |

## Architecture

The Web UI server (`src/web/server.ts`) is a lightweight HTTP server that:

1. Serves the single-page HTML interface on `GET /`
2. Proxies chat requests to the HTTP API on the agent's `httpPort`
3. Forwards SSE events from the API to the browser client
4. Manages server-side session creation for webchat-originated sessions

### Session Handling

- Sessions created in the browser are auto-created server-side on first message
- Session IDs are generated client-side and persisted in localStorage
- The `senderId` for webchat sessions is `webchat-owner`
- The `source` is tagged as `webchat` for VDB indexing

## Static File Serving

The Web UI server also serves static files from the workspace with proper MIME types:

```
.html → text/html
.css  → text/css
.js   → application/javascript
.json → application/json
.png  → image/png
.svg  → image/svg+xml
```

---

*Enhanced in v1.7.0 with dark glass visual overhaul, Artifact Virtual branding, and localhost-only API binding.*
