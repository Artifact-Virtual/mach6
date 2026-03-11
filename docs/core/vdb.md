# VDB — Embedded Persistent Memory

VDB is Mach6's built-in persistent memory engine — a zero-dependency, pure TypeScript implementation that gives agents long-term recall across sessions.

## Overview

VDB combines BM25 keyword scoring with TF-IDF cosine similarity in a hybrid search model. No external databases, no vector embedding services, no cloud dependencies. Everything runs in-process and persists to local JSONL files.

```
Session messages → VDB auto-ingest → BM25 + TF-IDF index → Hybrid search
                                          ↓
                                    JSONL on disk (append-only)
```

## Architecture

| Component | What it does |
|-----------|-------------|
| **BM25 Index** | Term frequency with inverse document frequency. Handles exact keyword matches. |
| **TF-IDF Vectors** | Sparse term vectors with cosine similarity. Handles semantic proximity. |
| **Hybrid Scoring** | `BM25 × 0.4 + TF-IDF × 0.6` with recency boost (10% for <24h, 5% for <7d). |
| **JSONL Storage** | Append-only document store. Compact on demand. |
| **Idle Eviction** | Memory-mapped on first query, evicted after configurable idle timeout (default 5 min). |
| **Deduplication** | Content-hash based. Same text is never indexed twice. |

## What Gets Indexed

- WhatsApp conversations (user ↔ agent turns)
- Discord conversations
- COMB staged memories
- Webchat sessions
- Any text the agent manually indexes

**What does NOT get indexed:** tool calls/results (noise), system prompts (already in context), binary/image content.

## Tools

VDB exposes four tools to the agent:

| Tool | Description |
|------|-------------|
| `memory_search` | Hybrid search across all indexed documents. Supports BM25, vector, or hybrid mode. |
| `memory_recall` | Search past conversations filtered by source (WhatsApp, Discord, webchat, COMB). |
| `memory_ingest` | Trigger a full re-ingest of all session files. |
| `memory_stats` | Show document count, term count, disk usage, source breakdown. |

### Example: Searching Memory

```typescript
// From an agent's perspective (tool call):
memory_search({ query: "trading system architecture", k: 5, mode: "hybrid" })

// Returns ranked results with scores, timestamps, and source attribution
```

## Auto-Ingest

VDB automatically ingests session files on startup and periodically during runtime. It scans:

- Active session directory
- Session archive directory
- Filters by adapter source (WhatsApp, Discord, webchat)
- Skips tool calls, system prompts, and short messages (<15 chars)
- Skips Blink system messages

## Real-Time Pulse

VDB integrates with Mach6's Pulse system. Every 5 seconds during active sessions, new messages are indexed in real-time — no need to wait for session end.

## Configuration

VDB is enabled by default. Configuration in `mach6.json`:

```json
{
  "vdb": {
    "enabled": true,
    "idleTimeoutMs": 300000,
    "autoIngest": true
  }
}
```

## Storage

Data lives in `<workspace>/.vdb/`:

| File | Purpose |
|------|---------|
| `documents.jsonl` | Append-only document store (all indexed content) |
| `index.json` | Index metadata (document count, term count, last saved) |

### Compaction

Over time, the JSONL file accumulates. Run `compact()` to deduplicate and rewrite clean:

```typescript
const saved = db.compact(); // returns bytes saved
```

## Design Philosophy

> "So light it doesn't even exist."

VDB was designed to give every Mach6 agent persistent memory without any infrastructure overhead. No Redis. No PostgreSQL. No Pinecone. Just files on disk and an in-memory index that loads in milliseconds.

For agents that need industrial-scale memory (tens of thousands of documents, dense vector embeddings), use HEKTOR alongside VDB. They complement each other — VDB for lightweight, always-on recall; HEKTOR for deep semantic search across large corpora.

---

*Added in v1.7.0*
