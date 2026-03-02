# Quick Start

Get a working agent in under 2 minutes.

## 1. Initialize

```bash
npx mach6 init
```

The interactive wizard generates two files:

- **`mach6.json`** — agent configuration (provider, model, channels, policies)
- **`.env`** — secrets (API keys, bot tokens)

## 2. Start the Daemon

```bash
node dist/gateway/daemon.js --config=mach6.json
```

You'll see the boot sequence:

```
⚡ Mach6 v1.3.0
◈ config-load .............. ✓
◈ config-validate .......... ✓
◎ comb-recall .............. ✓
◉ discord .................. ✓
◉ whatsapp ................. ✓
◉ http-api ................. ✓
─────────────────────────────────
Gateway ready. Channels: 3 | Tools: 18
```

## 3. Talk to Your Agent

- **Discord** — mention your bot or DM it
- **WhatsApp** — send a message to the connected number
- **HTTP API** — `POST http://localhost:3006/api/v1/chat`
- **CLI REPL** — run `node dist/index.js` for an interactive terminal

## Manual Setup (Without Wizard)

```bash
cp mach6.example.json mach6.json
cp .env.example .env
```

Edit both files — set your API keys, channel tokens, workspace path, and owner IDs. See [Configuration](configuration.md) for details.

## Windows

Same commands. Mach6 is fully cross-platform. Alternatively, use the included start scripts:

```powershell
# PowerShell
.\mach6.ps1

# Or directly
node dist\gateway\daemon.js --config=mach6.json
```
