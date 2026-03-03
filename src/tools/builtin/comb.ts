// Mach6 — COMB lossless operational memory tools

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolDefinition } from '../types.js';

const execFileAsync = promisify(execFile);

// Resolve paths from MACH6_WORKSPACE env var (set by daemon) or fallback to cwd
function getWorkspace(): string {
  return process.env.MACH6_WORKSPACE ?? process.cwd();
}

// Direct python binary — no venv activation overhead, no bash shell
function getPython(ws: string): string {
  return `${ws}/.hektor-env/bin/python3`;
}

function getFlushScript(ws: string): string {
  return `${ws}/.ava-memory/flush.py`;
}

export const combRecallTool: ToolDefinition = {
  name: 'comb_recall',
  description: 'Recall operational memory from COMB — lossless session-to-session context that persists across restarts.',
  parameters: { type: 'object', properties: {}, required: [] },
  async execute() {
    const ws = getWorkspace();
    try {
      const { stdout } = await execFileAsync(getPython(ws), [getFlushScript(ws), 'recall'], {
        encoding: 'utf-8',
        timeout: 30000,
        cwd: ws,
      });
      return stdout.trim() || 'No staged memories found.';
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
      const { stdout } = await execFileAsync(getPython(ws), [getFlushScript(ws), 'stage', content], {
        encoding: 'utf-8',
        timeout: 30000,
        cwd: ws,
      });
      return stdout.trim() || 'Staged successfully.';
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  },
};
