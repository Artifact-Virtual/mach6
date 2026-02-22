// Mach6 — Session lifecycle manager

import fs from 'node:fs';
import path from 'node:path';
import type { Session, SessionSummary, SessionMetadata } from './types.js';

const DEFAULT_DIR = '.mach6/sessions';
const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

export class SessionManager {
  private dir: string;
  private ttl: number;

  constructor(baseDir?: string, ttl?: number) {
    this.dir = baseDir ?? path.join(process.env.HOME ?? '/tmp', DEFAULT_DIR);
    this.ttl = ttl ?? DEFAULT_TTL;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private filePath(id: string): string {
    const safe = id.replace(/[^a-zA-Z0-9_\-:.]/g, '_');
    return path.join(this.dir, `${safe}.json`);
  }

  private defaultMetadata(): SessionMetadata {
    return { messageCount: 0, tokenUsage: { input: 0, output: 0 }, toolsUsed: {}, depth: 0 };
  }

  create(id: string, opts?: { label?: string; provider?: string; model?: string; parentSessionId?: string; depth?: number }): Session {
    const session: Session = {
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      metadata: {
        ...this.defaultMetadata(),
        label: opts?.label,
        provider: opts?.provider,
        model: opts?.model,
        parentSessionId: opts?.parentSessionId,
        depth: opts?.depth ?? 0,
      },
    };
    this.save(session);
    return session;
  }

  load(id: string): Session | null {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath(id), 'utf-8')) as Session;
      // Backfill metadata for old sessions
      if (!data.metadata || typeof data.metadata !== 'object' || !('messageCount' in data.metadata)) {
        data.metadata = { ...this.defaultMetadata(), ...(data.metadata as Record<string, unknown> ?? {}) } as SessionMetadata;
      }
      return data;
    } catch {
      return null;
    }
  }

  save(session: Session): void {
    session.updatedAt = Date.now();
    session.metadata.messageCount = session.messages.length;
    fs.writeFileSync(this.filePath(session.id), JSON.stringify(session, null, 2));
  }

  delete(id: string): boolean {
    try { fs.unlinkSync(this.filePath(id)); return true; } catch { return false; }
  }

  list(): SessionSummary[] {
    try {
      const summaries: SessionSummary[] = [];
      for (const f of fs.readdirSync(this.dir).filter(f => f.endsWith('.json'))) {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf-8')) as Session;
          summaries.push({
            id: s.id,
            label: s.metadata?.label,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            messageCount: s.messages.length,
            provider: s.metadata?.provider,
            model: s.metadata?.model,
          });
        } catch { /* skip */ }
      }
      return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  /** Update token usage */
  trackUsage(session: Session, input: number, output: number): void {
    session.metadata.tokenUsage.input += input;
    session.metadata.tokenUsage.output += output;
  }

  /** Track tool call */
  trackToolCall(session: Session, toolName: string): void {
    session.metadata.toolsUsed[toolName] = (session.metadata.toolsUsed[toolName] ?? 0) + 1;
  }

  /** Clean up stale sessions older than TTL */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    try {
      for (const f of fs.readdirSync(this.dir).filter(f => f.endsWith('.json'))) {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf-8')) as Session;
          if (now - s.updatedAt > this.ttl) {
            fs.unlinkSync(path.join(this.dir, f));
            cleaned++;
          }
        } catch { /* skip corrupt files */ }
      }
    } catch { /* dir doesn't exist */ }
    return cleaned;
  }

  /** Rename / label a session */
  setLabel(id: string, label: string): boolean {
    const session = this.load(id);
    if (!session) return false;
    session.metadata.label = label;
    this.save(session);
    return true;
  }
}
