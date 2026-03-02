# Configuration

Mach6 uses two files for configuration: `mach6.json` for agent settings and `.env` for secrets.

## mach6.json

```jsonc
{
  // LLM Settings
  "defaultProvider": "github-copilot",
  "defaultModel": "claude-opus-4-6",
  "maxTokens": 8192,
  "maxIterations": 50,
  "temperature": 0.3,

  // Workspace — agent's working directory for file operations
  // Use forward slashes on all platforms (Windows: "C:/Users/you/workspace")
  "workspace": "/home/you/workspace",
  "sessionsDir": ".sessions",

  // Provider configuration
  "providers": {
    "github-copilot": {},
    "anthropic": {},
    "openai": {},
    "gladius": { "baseUrl": "http://127.0.0.1:8741" }
  },

  // Owner IDs — users with full access (bypasses policies)
  "ownerIds": [
    "your-discord-user-id",
    "your-phone@s.whatsapp.net"
  ],

  // Channel configuration (see Channels section for details)
  "discord": { ... },
  "whatsapp": { ... },

  // HTTP API port
  "apiPort": 3006
}
```

### Environment Variable Interpolation

All string values in `mach6.json` support `${ENV_VAR}` syntax:

```json
{
  "discord": {
    "token": "${DISCORD_BOT_TOKEN}",
    "botId": "${DISCORD_CLIENT_ID}"
  }
}
```

Variables are resolved from `process.env` at load time.

## .env

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

## Key Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `defaultProvider` | string | `"github-copilot"` | Active LLM provider |
| `defaultModel` | string | `"claude-sonnet-4"` | Active model |
| `maxTokens` | number | `8192` | Max tokens per response |
| `maxIterations` | number | `50` | Max tool-call loops per turn |
| `temperature` | number | `0.7` | Response temperature (0.0–1.2) |
| `workspace` | string | `cwd()` | Agent's file system root |
| `sessionsDir` | string | `".sessions"` | Session persistence directory |
| `apiPort` | number | `3006` | HTTP API and Web UI port |

## Channel Policies

Each channel (Discord, WhatsApp) supports granular access control:

```jsonc
{
  "discord": {
    "enabled": true,
    "token": "${DISCORD_BOT_TOKEN}",
    "botId": "${DISCORD_CLIENT_ID}",
    "siblingBotIds": [],        // Other bot IDs to ignore (prevents echo loops)
    "policy": {
      "dmPolicy": "allowlist",       // "allowlist" | "open"
      "groupPolicy": "mention-only", // "mention-only" | "open" | "deny"
      "requireMention": true,
      "allowedSenders": ["your-discord-user-id"],
      "allowedGroups": []
    }
  }
}
```

| Policy | Options | Description |
|--------|---------|-------------|
| `dmPolicy` | `allowlist`, `open` | Who can DM the bot |
| `groupPolicy` | `mention-only`, `open`, `deny` | How the bot responds in servers |
| `requireMention` | boolean | Whether @mention is required in groups |
| `allowedSenders` | string[] | User IDs with DM access |
| `allowedGroups` | string[] | Channel/group IDs the bot responds in |

## Hot Reload

Reload configuration without restarting the daemon:

```bash
# Linux/macOS
kill -USR1 $(pgrep -f "gateway/daemon.js")
```

> **Note:** `SIGUSR1` hot-reload is not available on Windows. Restart the process to apply config changes.

## Validation

Mach6 validates configuration at boot with human-readable diagnostics. Missing required fields, invalid types, and unreachable providers are caught before the agent starts — not at runtime.
