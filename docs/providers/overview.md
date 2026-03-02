# Providers Overview

Mach6 supports multiple LLM providers through a unified `Provider` interface. Providers are hot-swappable mid-session — switch models without losing conversation context.

## Supported Providers

| Provider | Config Key | Auth Method | GPU Required |
|----------|-----------|-------------|--------------|
| [GitHub Copilot](github-copilot.md) | `github-copilot` | Auto-resolved from `gh` CLI | No |
| [Anthropic](anthropic.md) | `anthropic` | `ANTHROPIC_API_KEY` env var | No |
| [OpenAI](openai.md) | `openai` | `OPENAI_API_KEY` env var | No |
| [Gladius](gladius.md) | `gladius` | Local HTTP endpoint | Optional |

## Configuration

Register providers in `mach6.json`:

```json
{
  "providers": {
    "github-copilot": {},
    "anthropic": {},
    "openai": {},
    "gladius": { "baseUrl": "http://127.0.0.1:8741" }
  },
  "defaultProvider": "github-copilot",
  "defaultModel": "claude-opus-4-6"
}
```

Only configured providers are available. Omit a provider to disable it.

## Hot-Swapping

Switch provider or model mid-session:

```
/provider anthropic
/model claude-sonnet-4
```

The session's conversation history carries over. The new provider picks up where the old one left off.

## Provider Interface

All providers implement the same interface:

```typescript
interface Provider {
  chat(
    messages: Message[],
    config: ProviderConfig,
    onEvent?: (event: StreamEvent) => void,
  ): Promise<ProviderResponse>;
}
```

This makes adding new providers straightforward — implement `chat()` and register it.

## Diagnostics

Mach6 runs provider health checks at boot:

- Token validation
- Endpoint reachability
- Model availability

Failed providers log warnings but don't prevent startup. The gateway enters degraded mode and falls back to the next available provider.

## Retry Logic

All providers include automatic retry with exponential backoff:

- **Rate limits (429)** — respects `Retry-After` header
- **Server errors (500–503)** — retries up to 3 times
- **Timeouts** — configurable per-provider via `timeoutMs`
