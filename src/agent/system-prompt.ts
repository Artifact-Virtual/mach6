// Mach6 — System prompt builder (v2 — HEKTOR-native)
// 
// v1 loaded 7 markdown files (~95K chars) into every session.
// v2 loads only identity core (~15K chars) + COMB recall (~2K chars).
// Everything else lives in HEKTOR — searched on demand, zero idle cost.
//
// Architecture:
//   System prompt = SOUL + IDENTITY + USER_CORE + AGENTS_CORE + COMB recall + tools
//   HEKTOR = TOOLS.md, AGENTS.md, USER.md, HEARTBEAT.md, WORKFLOW_AUTO.md, memory/*, long-term.md
//   COMB = lossless session-to-session operational memory

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

export interface SystemPromptParams {
  workspace: string;
  tools: string[];
  channel?: string;          // whatsapp | discord | etc.
  chatType?: string;         // direct | group
  senderId?: string;
  extraContext?: string;
}

/** 
 * Identity core — loaded every session. These define WHO the agent IS.
 * Everything else is searchable via HEKTOR (memory_search tool).
 */
const IDENTITY_FILES = [
  { path: 'SOUL.md',         label: 'Soul' },          // ~3.5K
  { path: 'IDENTITY.md',     label: 'Identity' },      // ~5.5K
  { path: 'USER_CORE.md',    label: 'About the User' },// ~3K (slim)
  { path: 'AGENTS_CORE.md',  label: 'Operating Protocol' }, // ~3.5K (rules only)
];

/** Max bytes per identity file */
const MAX_FILE_BYTES = 15_000;

/** Max total prompt size — much lower now since we're lean */
const MAX_TOTAL_CHARS = 50_000;

function readFileSafe(filePath: string, maxBytes: number): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) return null;
    let content = fs.readFileSync(filePath, 'utf-8');
    if (content.length > maxBytes) {
      content = content.slice(0, maxBytes) + '\n\n[... truncated at ' + maxBytes + ' bytes]';
    }
    return content.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Recall operational memory from COMB.
 * Returns the most recent/relevant context for session continuity.
 * Runs flush.py recall and captures output (~2-3K chars).
 */
function recallCOMB(workspace: string): string | null {
  try {
    const flushScript = path.join(workspace, '.ava-memory', 'flush.py');
    if (!fs.existsSync(flushScript)) return null;
    
    const result = execSync(
      `python3 "${flushScript}" recall`,
      { 
        cwd: workspace, 
        timeout: 10_000,
        encoding: 'utf-8',
        env: { ...process.env, PATH: `${workspace}/.hektor-env/bin:${process.env.PATH}` }
      }
    );
    
    // Limit to 5K chars max
    const trimmed = result.trim();
    if (!trimmed || trimmed.includes('COMB is empty')) return null;
    return trimmed.length > 5000 ? trimmed.slice(0, 5000) + '\n[... recall truncated]' : trimmed;
  } catch (err) {
    // COMB recall failure is non-fatal — agent can still search HEKTOR
    return null;
  }
}

export function buildSystemPrompt(params: SystemPromptParams): string {
  const parts: string[] = [];
  let totalChars = 0;

  function addSection(label: string, content: string): boolean {
    const section = `## ${label}\n${content}\n`;
    if (totalChars + section.length > MAX_TOTAL_CHARS) return false;
    parts.push(section);
    totalChars += section.length;
    return true;
  }

  // ── Runtime header ──
  const now = new Date();
  const tz = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localTime = now.toLocaleString('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' });

  addSection('Runtime', [
    `- Date: ${localTime}`,
    `- Timezone: ${tz}`,
    `- Host: ${os.hostname()}`,
    `- OS: ${os.platform()} ${os.arch()}`,
    `- Workspace: ${params.workspace}`,
    `- Channel: ${params.channel ?? 'unknown'}`,
    `- Chat type: ${params.chatType ?? 'unknown'}`,
    params.senderId ? `- Sender: ${params.senderId}` : '',
  ].filter(Boolean).join('\n'));

  // ── Identity core (always loaded — this is WHO you are) ──
  for (const file of IDENTITY_FILES) {
    const filePath = path.join(params.workspace, file.path);
    const content = readFileSafe(filePath, MAX_FILE_BYTES);
    if (content) {
      if (!addSection(file.label, content)) break;
    }
  }

  // ── COMB operational recall (lossless session memory) ──
  const combRecall = recallCOMB(params.workspace);
  if (combRecall) {
    addSection('Operational Memory (COMB)', combRecall);
  }

  // ── Tools ──
  if (params.tools.length > 0) {
    addSection('Available Tools', [
      `You have access to: ${params.tools.join(', ')}`,
      '',
      'Call tools when needed. For file operations, use read/write. For shell commands, use exec.',
      'Be resourceful — search HEKTOR (memory_search) before guessing.',
    ].join('\n'));
  }

  // ── Extra context (channel-specific, message metadata, etc.) ──
  if (params.extraContext) {
    addSection('Context', params.extraContext);
  }

  // ── Guidelines ──
  addSection('Core Guidelines', [
    '- Embody your SOUL.md persona. No generic chatbot behavior.',
    '- Follow AGENTS_CORE.md operating rules (delegation, safety, memory).',
    '- **Search HEKTOR** (memory_search) for tool details, account info, workflows, history.',
    '- HEKTOR has 35K+ documents indexed — TOOLS.md, AGENTS.md, USER.md, memory/*, everything.',
    '- Be direct and concise. Help, don\'t perform helpfulness.',
    '- Use tools proactively — search before asking, read before guessing.',
    '- When in group chats: participate, don\'t dominate.',
    '- Private things stay private. When in doubt, ask before external actions.',
    '- Write to memory files — mental notes don\'t survive restarts.',
    '- Stage critical context in COMB (comb_stage) before session ends.',
  ].join('\n'));

  return parts.join('\n');
}
