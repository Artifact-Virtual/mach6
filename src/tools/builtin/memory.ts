// Symbiote — HEKTOR memory search tool

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { ToolDefinition } from '../types.js';

// Resolve paths from MACH6_WORKSPACE env var (set by daemon) or fallback to cwd
function getWorkspace(): string {
  return process.env.MACH6_WORKSPACE ?? process.cwd();
}

// Quick health check — if the daemon socket doesn't exist, HEKTOR is down
function hektorAlive(): boolean {
  const sockPath = `${getWorkspace()}/.ava-memory/ava_daemon.sock`;
  return existsSync(sockPath);
}

export const memorySearchTool: ToolDefinition = {
  name: 'memory_search',
  description: 'Search enterprise memory using HEKTOR (BM25 + vector hybrid search). Returns semantically relevant results from indexed files.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      mode: { type: 'string', description: 'Search mode: bm25, vector, or hybrid (default)', enum: ['bm25', 'vector', 'hybrid'] },
      k: { type: 'number', description: 'Number of results (default 5)' },
    },
    required: ['query'],
  },
  async execute(input) {
    const query = String(input.query ?? '');
    const mode = String(input.mode ?? 'hybrid');
    const k = Number(input.k ?? 5);
    const ws = getWorkspace();

    // Pre-flight: check daemon is running before wasting 15s on a timeout
    if (!hektorAlive()) {
      return 'HEKTOR search unavailable — daemon is not running. Use `exec` to run: source ' +
        `${ws}/.hektor-env/bin/activate && python3 ${ws}/.ava-memory/ava_memory_fast.py daemon start`;
    }

    try {
      const venv = `source ${ws}/.hektor-env/bin/activate`;
      const script = `python3 ${ws}/.ava-memory/ava_memory_fast.py`;
      const cmd = `${venv} && ${script} search "${query.replace(/"/g, '\\"')}" --mode ${mode} -k ${k}`;
      const out = execSync(cmd, { encoding: 'utf-8', timeout: 15000, shell: '/bin/bash' });
      return out.trim() || 'No results found.';
    } catch (err) {
      // Detect timeout specifically (Node sets err.killed = true and err.signal = 'SIGTERM' on timeout)
      if (err instanceof Error && 'killed' in err && (err as any).killed) {
        return 'HEKTOR search timed out — daemon may be overloaded';
      }
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  },
};
