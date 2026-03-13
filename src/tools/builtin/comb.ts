// Symbiote — COMB: Lossless Operational Memory
//
// Pure Node.js. Zero external dependencies. No Python. No IPC.
//
// Architecture:
//   workspace/.comb/
//     staging/         — today's staged entries (one JSON file per day)
//     archive/         — rolled-up permanent documents (one JSON file per day)
//     state.json       — metadata (last rollup, entry count, etc.)
//
// Every staged entry is also pushed to VDB for immediate searchability.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolDefinition } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function getWorkspace(): string {
  return process.env.MACH6_WORKSPACE ?? process.cwd();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── Native COMB Store ────────────────────────────────────────────────────

interface StagingEntry {
  text: string;
  timestamp: string;
  source: string;
}

interface ArchiveDocument {
  date: string;
  content: string;
  entryCount: number;
  rolledAt: string;
}

// VDB index hook — set externally by daemon to avoid circular imports
let _vdbIndexHook: ((text: string, source: string) => void) | null = null;

export function setCombVdbHook(hook: (text: string, source: string) => void): void {
  _vdbIndexHook = hook;
}

class NativeCombStore {
  private stagingDir: string;
  private archiveDir: string;
  private stateFile: string;

  constructor(ws: string) {
    const combRoot = path.join(ws, '.comb');
    this.stagingDir = path.join(combRoot, 'staging');
    this.archiveDir = path.join(combRoot, 'archive');
    this.stateFile = path.join(combRoot, 'state.json');
    fs.mkdirSync(this.stagingDir, { recursive: true });
    fs.mkdirSync(this.archiveDir, { recursive: true });
  }

  /** Stage text for later recall */
  stage(text: string, source = 'agent'): void {
    const date = today();
    const filePath = path.join(this.stagingDir, `${date}.json`);

    let entries: StagingEntry[] = [];
    try {
      entries = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch { /* new file */ }

    entries.push({
      text,
      timestamp: new Date().toISOString(),
      source,
    });

    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));

    // Push to VDB for immediate searchability
    if (_vdbIndexHook) {
      try {
        _vdbIndexHook(text, 'comb');
      } catch {
        // Non-fatal — COMB still has the data
      }
    }

    // Auto-rollup: if > 10 entries for today, roll up
    if (entries.length > 10) {
      this.rollup(date);
    }
  }

  /** Roll up staging entries into an archive document */
  rollup(date?: string): boolean {
    const targetDate = date ?? today();
    const stagingFile = path.join(this.stagingDir, `${targetDate}.json`);

    if (!fs.existsSync(stagingFile)) return false;

    let entries: StagingEntry[] = [];
    try {
      entries = JSON.parse(fs.readFileSync(stagingFile, 'utf-8'));
    } catch { return false; }

    if (entries.length === 0) return false;

    const content = entries.map(e => {
      const time = new Date(e.timestamp).toLocaleTimeString('en-US', { hour12: false });
      return `[${time}] ${e.text}`;
    }).join('\n\n');

    const doc: ArchiveDocument = {
      date: targetDate,
      content,
      entryCount: entries.length,
      rolledAt: new Date().toISOString(),
    };

    const archiveFile = path.join(this.archiveDir, `${targetDate}.json`);
    let existing: ArchiveDocument[] = [];
    try {
      existing = JSON.parse(fs.readFileSync(archiveFile, 'utf-8'));
      if (!Array.isArray(existing)) existing = [existing];
    } catch { /* new file */ }
    existing.push(doc);
    fs.writeFileSync(archiveFile, JSON.stringify(existing, null, 2));

    // Remove staging file (rolled up)
    fs.unlinkSync(stagingFile);

    // Update state
    this.updateState({
      lastRollup: targetDate,
      totalArchived: (this.getState().totalArchived ?? 0) + entries.length,
    });

    return true;
  }

  /** Recall — pull recent staged + archived context for session start */
  recall(): string {
    const lines: string[] = [
      '=== COMB RECALL — Session Continuity ===',
      '',
    ];

    let hasStaging = false;
    for (const date of [today(), yesterday()]) {
      const stagingFile = path.join(this.stagingDir, `${date}.json`);
      if (!fs.existsSync(stagingFile)) continue;

      try {
        const entries: StagingEntry[] = JSON.parse(fs.readFileSync(stagingFile, 'utf-8'));
        if (entries.length === 0) continue;

        hasStaging = true;
        lines.push(`--- Staged [${date}] (${entries.length} entries) ---`);
        for (const entry of entries.slice(-8)) {
          const preview = entry.text.length > 600 ? entry.text.slice(0, 600) + ' [...]' : entry.text;
          lines.push(preview);
          lines.push('');
        }
      } catch { continue; }
    }

    let hasArchive = false;
    for (const date of [today(), yesterday()]) {
      const archiveFile = path.join(this.archiveDir, `${date}.json`);
      if (!fs.existsSync(archiveFile)) continue;

      try {
        let docs: ArchiveDocument[] = JSON.parse(fs.readFileSync(archiveFile, 'utf-8'));
        if (!Array.isArray(docs)) docs = [docs];
        if (docs.length === 0) continue;

        hasArchive = true;
        const latest = docs[docs.length - 1];
        const preview = latest.content.length > 800 ? latest.content.slice(0, 800) + '\n[...]' : latest.content;
        lines.push(`--- Archive [${date}] (${latest.entryCount} entries) ---`);
        lines.push(preview);
        lines.push('');
      } catch { continue; }
    }

    // Auto-rollup stale staging
    try {
      const stagingFiles = fs.readdirSync(this.stagingDir).filter(f => f.endsWith('.json'));
      const cutoff = yesterday();
      for (const file of stagingFiles) {
        const fileDate = file.replace('.json', '');
        if (fileDate < cutoff) {
          this.rollup(fileDate);
        }
      }
    } catch { /* non-fatal */ }

    if (!hasStaging && !hasArchive) {
      lines.push('No staged memories found. Fresh start.');
    }

    return lines.join('\n');
  }

  /** Flush session messages into COMB (called on shutdown) */
  flushMessages(sessionLabel: string, messages: Array<{ role: string; content: string | any }>, tailCount = 4): void {
    const convMessages = messages.filter(m => m.role !== 'system' && m.role !== 'tool');
    const tail = convMessages.slice(-tailCount);
    if (tail.length === 0) return;

    const lines: string[] = [`[Session: ${sessionLabel}]`];
    for (const msg of tail) {
      const role = msg.role === 'assistant' ? 'Agent' : msg.role === 'user' ? 'Human' : msg.role;
      let content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (content.length > 500) content = content.slice(0, 500) + '... [truncated]';
      lines.push(`${role}: ${content}`);
    }

    this.stage(lines.join('\n'), 'auto-flush');
  }

  private getState(): Record<string, any> {
    try {
      return JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
    } catch {
      return {};
    }
  }

  private updateState(updates: Record<string, any>): void {
    const state = { ...this.getState(), ...updates, updatedAt: new Date().toISOString() };
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
  }
}

// ── Singleton Store ──────────────────────────────────────────────────────

let _nativeStore: NativeCombStore | null = null;
let _nativeStoreWs: string = '';

export function getNativeCombStore(ws?: string): NativeCombStore {
  const workspace = ws ?? getWorkspace();
  if (!_nativeStore || _nativeStoreWs !== workspace) {
    _nativeStore = new NativeCombStore(workspace);
    _nativeStoreWs = workspace;
  }
  return _nativeStore;
}

// ── Tool Definitions ─────────────────────────────────────────────────────

export const combRecallTool: ToolDefinition = {
  name: 'comb_recall',
  description: 'Recall operational memory from COMB — lossless session-to-session context that persists across restarts.',
  parameters: { type: 'object', properties: {}, required: [] },
  async execute() {
    try {
      const store = getNativeCombStore();
      return store.recall();
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  },
};

export const combStageTool: ToolDefinition = {
  name: 'comb_stage',
  description: 'Stage key information in COMB for the next session. Persists across restarts.',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Information to stage for next session' },
    },
    required: ['content'],
  },
  async execute(input) {
    const content = String(input.content ?? '');
    try {
      const store = getNativeCombStore();
      store.stage(content, 'agent');
      return `Staged ${content.length} chars into COMB.`;
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  },
};
