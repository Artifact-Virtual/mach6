# Release Notes - v1.6.0

## Mach6 v1.6.0 - Native Gemini, 8 Providers, Multi-User Deployment

**Date:** March 7, 2026

This release adds native Google Gemini integration, bringing the total provider count to 8. Plus multi-user deployment support, a de-branded web UI, and self-contained QR pairing.

### Native Gemini Provider

**Direct SDK integration** - Uses `@google/genai` SDK natively. Not an OpenAI-compatible shim. Full streaming, function calling, and thinking support out of the box.

**Thinking support** - Gemini models with thinking enabled return `thoughtSignature` fields. Mach6 automatically preserves these across tool call roundtrips - required by the Gemini API for thinking-enabled sessions. Configure depth via `thinkingBudget` in provider config.

**Automatic schema adaptation** - Gemini rejects `additionalProperties` in tool schemas. Mach6 strips them automatically so your existing tools work without modification.

**System instructions** - System prompts are passed via Gemini's dedicated `systemInstruction` field, not injected into message history. Cleaner context separation.

### Models

| Model | Config Value | Notes |
|-------|-------------|-------|
| Gemini 2.5 Pro | `gemini-2.5-pro-preview-05-06` | Strongest reasoning, thinking support |
| Gemini 2.5 Flash | `gemini-2.5-flash-preview-04-17` | Fast + thinking support |
| Gemini 2.0 Flash | `gemini-2.0-flash` | Fast, general purpose |
| Gemini 1.5 Pro | `gemini-1.5-pro` | Long context (1M tokens) |
| Gemini 1.5 Flash | `gemini-1.5-flash` | Budget-friendly |

### Multi-User Deployment

One Mach6 install can now serve multiple user profiles with isolated workspaces, configs, and sessions. Each user gets their own identity files and conversation history.

### Other Changes

- **Sandbox wildcard ownerIds** - `"*"` allows open access for testing/demo deployments
- **De-branded web UI** - agent name and emoji pulled from config, not hardcoded
- **Self-contained QR HTML** - WhatsApp QR pairing page works without CDN dependencies
- **Landing page** - `mach6.artifactvirtual.com` with CNAME support
- **dotenv auto-import** - `.env` files loaded automatically at startup
- **xAI provider registration** - `xai` was defined but not registered in the provider map. Fixed.
- **Default provider** - changed from `github-copilot` to `groq` (free, fastest)
- **Discord chatType detection** - correctly identifies channel vs thread messages

### Configuration

```json
{
  "providers": {
    "gemini": {}
  }
}
```

```bash
# .env
GEMINI_API_KEY=AIza...    # https://aistudio.google.com/apikey
```

### Upgrade Path

Fully backward compatible. Existing configs work unchanged.

```bash
git pull origin master
npm install && npm run build
```

### Stats

- 8 LLM providers
- 18+ built-in tools
- 2 channel adapters + HTTP API
- 38 documentation files

---

Built by [Artifact Virtual](https://artifactvirtual.com). MIT License.
