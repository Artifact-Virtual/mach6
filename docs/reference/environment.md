# Environment Variables

All environment variables used by Mach6.

## LLM Providers

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | If using Anthropic | Anthropic API key (`sk-ant-...`) |
| `OPENAI_API_KEY` | If using OpenAI | OpenAI API key (`sk-...`) |
| `COPILOT_GITHUB_TOKEN` | No | GitHub Copilot token (auto-resolved if `gh` CLI is authenticated) |
| `GH_TOKEN` | No | GitHub token (fallback for Copilot) |
| `GITHUB_TOKEN` | No | GitHub token (fallback for Copilot) |

## Discord

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | If using Discord | Discord bot token |
| `DISCORD_CLIENT_ID` | If using Discord | Discord bot application ID |

## HTTP API

| Variable | Required | Description |
|----------|----------|-------------|
| `MACH6_API_KEY` | If using HTTP API | Bearer token for API authentication |
| `MACH6_PORT` | No | HTTP API port (default: `3006`) |

## Resolution Order

Environment variables can be set in:

1. **`.env` file** — loaded at startup (recommended for secrets)
2. **Shell environment** — `export VAR=value`
3. **systemd service** — `Environment=VAR=value`
4. **`mach6.json`** — via `${VAR}` interpolation in string values

`.env` values do not override existing shell environment variables.
