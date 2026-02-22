// Mach6 — Context window management (truncation)

import type { Message } from '../providers/types.js';

/** Rough token estimate: ~4 chars per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function messageSize(msg: Message): number {
  if (typeof msg.content === 'string') return estimateTokens(msg.content);
  return msg.content.reduce((sum, b) => {
    if (b.text) return sum + estimateTokens(b.text);
    if (b.content) return sum + estimateTokens(b.content);
    if (b.input) return sum + estimateTokens(JSON.stringify(b.input));
    return sum + 50; // base cost for structured blocks
  }, 0);
}

/**
 * Truncate message history to fit within a token budget.
 * Strategy: keep system prompt + last N messages, drop oldest user/assistant pairs.
 */
export function truncateContext(messages: Message[], maxTokens: number): Message[] {
  const total = messages.reduce((sum, m) => sum + messageSize(m), 0);
  if (total <= maxTokens) return messages;

  // Always keep the first system message and last few messages
  const system = messages.filter(m => m.role === 'system');
  const rest = messages.filter(m => m.role !== 'system');

  let budget = maxTokens - system.reduce((s, m) => s + messageSize(m), 0);
  const kept: Message[] = [];

  // Walk from newest to oldest
  for (let i = rest.length - 1; i >= 0; i--) {
    const size = messageSize(rest[i]);
    if (budget - size < 0 && kept.length > 2) break;
    budget -= size;
    kept.unshift(rest[i]);
  }

  return [...system, ...kept];
}
