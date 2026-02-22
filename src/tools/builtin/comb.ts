// Mach6 — COMB lossless operational memory tools

import { execSync } from 'node:child_process';
import type { ToolDefinition } from '../types.js';

// Resolve paths from MACH6_WORKSPACE env var (set by daemon) or fallback to cwd
function getWorkspace(): string {
  return process.env.MACH6_WORKSPACE ?? process.cwd();
}

export const combRecallTool: ToolDefinition = {
  name: 'comb_recall',
  description: 'Recall operational memory from COMB — lossless session-to-session context that persists across restarts.',
  parameters: { type: 'object', properties: {}, required: [] },
  async execute() {
    const ws = getWorkspace();
    try {
      const venv = `source ${ws}/.hektor-env/bin/activate`;
      const flush = `python3 ${ws}/.ava-memory/flush.py`;
      const out = execSync(`${venv} && ${flush} recall`, { encoding: 'utf-8', timeout: 15000, shell: '/bin/bash' });
      return out.trim() || 'No staged memories found.';
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
    const ws = getWorkspace();
    try {
      const venv = `source ${ws}/.hektor-env/bin/activate`;
      const flush = `python3 ${ws}/.ava-memory/flush.py`;
      const out = execSync(`${venv} && ${flush} stage "${content.replace(/"/g, '\\"')}"`, {
        encoding: 'utf-8', timeout: 15000, shell: '/bin/bash',
      });
      return out.trim() || 'Staged successfully.';
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  },
};
