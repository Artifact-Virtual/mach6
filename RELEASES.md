# Mach6 Release Notes

## v0.2.0 — Adaptive Temperature Modulation (ATM)
**Release Date:** 2026-03-02

### New Features
- **Adaptive Temperature Modulation (ATM):** Dynamic per-iteration temperature control based on task classification
- **Task Classifier:** Heuristic-based task categorization (code, creative, analysis, conversation, system ops, research, planning)
- **Temperature Profiles:** Configurable temperature mappings per task category
- **mach6.json Integration:** Full configuration support via `adaptiveTemperature` block
- **Temperature History:** RunResult now includes temperature adjustment history for debugging
- **49 unit tests** for classifier accuracy, temperature resolution, and edge cases

### Task Categories & Default Temperatures
| Category | Temperature | Use Case |
|----------|------------|----------|
| system_ops | 0.15 | File operations, shell commands |
| code_review | 0.20 | Code auditing, review |
| analysis | 0.25 | Data analysis, math, logic |
| code_generation | 0.30 | Writing code, scripts |
| search_research | 0.40 | Information lookup, research |
| planning | 0.55 | Strategy, architecture |
| conversation | 0.60 | Chat, discussion |
| creative_writing | 0.80 | Articles, stories, naming |

### How It Works
The ATM system uses a two-strategy heuristic classifier (no LLM calls — zero overhead):

1. **Tool-call signal** (highest priority): If the previous iteration used tools, the tool names determine the category. `exec` + `read` → `system_ops`, `web_fetch` → `search_research`, etc.
2. **Keyword matching**: The last user message is scanned against regex patterns per category. Patterns are ordered by specificity.
3. **Fallback**: `unknown` → uses the configured default temperature.

### Configuration
Add to `mach6.json`:
```json
{
  "adaptiveTemperature": {
    "adaptive": true,
    "profile": {
      "code_generation": 0.3,
      "creative_writing": 0.8
    },
    "default": 0.5,
    "logChanges": true
  }
}
```

### API Changes

**`RunnerConfig`** — new optional field:
```typescript
temperatureConfig?: TemperatureConfig;
```

**`RunResult`** — new optional field:
```typescript
temperatureHistory?: Array<{ iteration: number; category: TaskCategory; temperature: number }>;
```

**`Mach6Config`** — new optional field:
```typescript
adaptiveTemperature?: { adaptive?: boolean; profile?: Partial<Record<string, number>>; default?: number; logChanges?: boolean; };
```

**New exports from `src/agent/temperature.ts`:**
- `TaskCategory` — union type of all task categories
- `DEFAULT_TEMP_PROFILE` — default temperature mapping
- `TemperatureConfig` — configuration interface
- `classifyTask(messages, recentToolCalls)` — heuristic classifier
- `getTemperature(category, config)` — temperature resolver

**New export from `src/config/config.ts`:**
- `toTemperatureConfig(config)` — converts raw mach6.json config to TemperatureConfig

### Breaking Changes
None — ATM is opt-in via config. Existing behavior unchanged when `adaptive` is false or unset. All existing tests continue to pass.
