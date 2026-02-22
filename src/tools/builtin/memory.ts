// Mach6 — HEKTOR memory search tool

import { execSync } from 'node:child_process';
import type { ToolDefinition } from '../types.js';

// Resolve paths from MACH6_WORKSPACE env var (set by daemon) or fallback to cwd
function getWorkspace(): string {
  return process.env.MACH6_WORKSPACE ?? process.cwd();
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
    try {
      const venv = `source ${ws}/.hektor-env/bin/activate`;
      const script = `python3 ${ws}/.ava-memory/ava_memory_fast.py`;
      const cmd = `${venv} && ${script} search "${query.replace(/"/g, '\\"')}" --mode ${mode} -k ${k}`;
      const out = execSync(cmd, { encoding: 'utf-8', timeout: 30000, shell: '/bin/bash' });
      return out.trim() || 'No results found.';
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  },
};
