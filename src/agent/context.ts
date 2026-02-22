// Mach6 — Context window management (truncation)

import type { Message, ContentBlock } from '../providers/types.js';

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

/** Check if a message contains tool_use blocks (assistant requesting tool calls) */
function hasToolUse(msg: Message): boolean {
  if (typeof msg.content === 'string') return false;
  return msg.content.some((b: ContentBlock) => b.type === 'tool_use');
}

/** Check if a message contains tool_result blocks (user returning tool results) */
function hasToolResult(msg: Message): boolean {
  if (typeof msg.content === 'string') return false;
  return msg.content.some((b: ContentBlock) => b.type === 'tool_result');
}

/** Get all tool_use IDs from a message */
function getToolUseIds(msg: Message): Set<string> {
  const ids = new Set<string>();
  if (typeof msg.content === 'string') return ids;
  for (const b of msg.content) {
    if (b.type === 'tool_use' && b.id) ids.add(b.id);
  }
  return ids;
}

/** Get all tool_use_ids referenced by tool_result blocks in a message */
function getToolResultRefs(msg: Message): Set<string> {
  const ids = new Set<string>();
  if (typeof msg.content === 'string') return ids;
  for (const b of msg.content) {
    if (b.type === 'tool_result' && b.tool_use_id) ids.add(b.tool_use_id);
  }
  return ids;
}

/**
 * Truncate message history to fit within a token budget.
 * Strategy: keep system prompt + last N messages, drop oldest first.
 * CRITICAL: tool_use (assistant) and tool_result (user) messages must stay paired.
 * If a tool_result survives, its preceding tool_use must also survive, and vice versa.
 */
export function truncateContext(messages: Message[], maxTokens: number): Message[] {
  const total = messages.reduce((sum, m) => sum + messageSize(m), 0);
  if (total <= maxTokens) return messages;

  // Always keep the first system message and last few messages
  const system = messages.filter(m => m.role === 'system');
  const rest = messages.filter(m => m.role !== 'system');

  let budget = maxTokens - system.reduce((s, m) => s + messageSize(m), 0);

  // Build keep-set walking from newest to oldest
  const keepFlags = new Array(rest.length).fill(false);

  for (let i = rest.length - 1; i >= 0; i--) {
    const size = messageSize(rest[i]);
    if (budget - size < 0 && keepFlags.filter(Boolean).length > 2) break;
    budget -= size;
    keepFlags[i] = true;
  }

  // Integrity pass: ensure tool_use/tool_result pairs are complete.
  // Walk forward through kept messages and enforce pairing.
  let changed = true;
  while (changed) {
    changed = false;

    for (let i = 0; i < rest.length; i++) {
      if (!keepFlags[i]) continue;

      // If this message has tool_results, find the preceding assistant with matching tool_use
      if (hasToolResult(rest[i])) {
        const refs = getToolResultRefs(rest[i]);
        // Search backwards for the assistant message with these tool_use IDs
        for (let j = i - 1; j >= 0; j--) {
          if (rest[j].role === 'assistant' && hasToolUse(rest[j])) {
            const useIds = getToolUseIds(rest[j]);
            const hasMatch = [...refs].some(r => useIds.has(r));
            if (hasMatch && !keepFlags[j]) {
              keepFlags[j] = true;
              budget -= messageSize(rest[j]);
              changed = true;
            }
            if (hasMatch) break; // found the pair
          }
        }
      }

      // If this message has tool_use, find the following user message with matching tool_results
      if (rest[i].role === 'assistant' && hasToolUse(rest[i])) {
        const useIds = getToolUseIds(rest[i]);
        for (let j = i + 1; j < rest.length; j++) {
          if (hasToolResult(rest[j])) {
            const refs = getToolResultRefs(rest[j]);
            const hasMatch = [...useIds].some(u => refs.has(u));
            if (hasMatch && !keepFlags[j]) {
              keepFlags[j] = true;
              budget -= messageSize(rest[j]);
              changed = true;
            }
            if (hasMatch) break; // found the pair
          }
        }
      }
    }
  }

  // If we're still over budget after pairing, drop the oldest pairs until we fit
  if (budget < 0) {
    for (let i = 0; i < rest.length && budget < 0; i++) {
      if (!keepFlags[i]) continue;
      // Don't orphan a pair — check if dropping this would orphan something
      const canDrop = !wouldOrphan(rest, keepFlags, i);
      if (canDrop) {
        keepFlags[i] = false;
        budget += messageSize(rest[i]);
      }
    }
  }

  const kept = rest.filter((_, i) => keepFlags[i]);

  // Final safety: ensure conversation doesn't start with a tool_result
  // (which would mean its tool_use got dropped despite our efforts)
  while (kept.length > 0 && hasToolResult(kept[0])) {
    kept.shift();
  }

  return [...system, ...kept];
}

/** Check if dropping message at index would orphan a tool pair */
function wouldOrphan(msgs: Message[], flags: boolean[], dropIdx: number): boolean {
  const msg = msgs[dropIdx];

  if (msg.role === 'assistant' && hasToolUse(msg)) {
    const useIds = getToolUseIds(msg);
    // Check if any kept message references these tool_use IDs
    for (let j = dropIdx + 1; j < msgs.length; j++) {
      if (!flags[j]) continue;
      if (hasToolResult(msgs[j])) {
        const refs = getToolResultRefs(msgs[j]);
        if ([...useIds].some(u => refs.has(u))) return true;
      }
    }
  }

  if (hasToolResult(msg)) {
    const refs = getToolResultRefs(msg);
    // Check if any kept assistant message has these tool_use IDs
    for (let j = dropIdx - 1; j >= 0; j--) {
      if (!flags[j]) continue;
      if (msgs[j].role === 'assistant' && hasToolUse(msgs[j])) {
        const useIds = getToolUseIds(msgs[j]);
        if ([...refs].some(r => useIds.has(r))) return true;
      }
    }
  }

  return false;
}
