// Mach6 — Core Agent Runner
// The heart: prompt → LLM → tool calls → loop → response

import type { Message, ToolCall, StreamEvent, Provider, ProviderConfig } from '../providers/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import { truncateContext } from './context.js';
import { ContextMonitor } from './context-monitor.js';
import type { PolicyEngine } from '../tools/policy.js';

export interface RunnerConfig {
  provider: Provider;
  providerConfig: ProviderConfig;
  toolRegistry: ToolRegistry;
  maxIterations?: number;
  maxContextTokens?: number;
  sessionId?: string;
  contextMonitor?: ContextMonitor;
  policyEngine?: PolicyEngine;
  abortSignal?: AbortSignal;
  onEvent?: (event: StreamEvent) => void;
  onToolStart?: (name: string, input: Record<string, unknown>) => void;
  onToolEnd?: (name: string, result: string) => void;
}

export interface RunResult {
  text: string;
  messages: Message[];
  toolCalls: { name: string; input: Record<string, unknown>; result: string }[];
  iterations: number;
}

/**
 * Run the agent loop: send messages to LLM, process tool calls, repeat until done.
 */
export async function runAgent(
  messages: Message[],
  config: RunnerConfig,
): Promise<RunResult> {
  const maxIter = config.maxIterations ?? 25;
  const maxCtx = config.maxContextTokens ?? 100_000;
  const allToolCalls: RunResult['toolCalls'] = [];
  let currentMessages = [...messages];
  let iterations = 0;

  while (iterations < maxIter) {
    iterations++;

    // Check if aborted (interrupt from bus)
    if (config.abortSignal?.aborted) {
      const reason = config.abortSignal.reason ?? 'aborted';
      throw new Error(`Agent turn aborted: ${reason}`);
    }

    // Check context monitor before each iteration (Pain #3)
    if (config.contextMonitor) {
      currentMessages = await config.contextMonitor.manage(currentMessages);
    }

    // Check iteration limit with warning (Pain #12)
    if (config.policyEngine && config.sessionId) {
      const iterCheck = config.policyEngine.checkIteration(config.sessionId, iterations);
      if (iterCheck.warning) {
        console.warn(`⚠️  ${iterCheck.warning}`);
      }
      if (!iterCheck.ok) {
        return {
          text: `[${iterCheck.warning}]`,
          messages: currentMessages,
          toolCalls: allToolCalls,
          iterations,
        };
      }
    }

    // Truncate context if needed
    const truncated = truncateContext(currentMessages, maxCtx);

    // Stream from LLM
    const tools = config.toolRegistry.toProviderFormat();
    console.log(`[runner] Iteration ${iterations}/${maxIter}: ${truncated.length} messages, calling LLM...`);
    const streamStartTime = Date.now();
    const stream = config.provider.stream(truncated, tools, config.providerConfig);

    // Collect response
    let textAccum = '';
    const pendingToolCalls: ToolCall[] = [];
    const toolInputBuffers = new Map<string, string>(); // id → accumulated JSON string
    let currentToolId = '';

    for await (const event of stream) {
      config.onEvent?.(event);

      switch (event.type) {
        case 'text_delta':
          textAccum += event.text;
          break;

        case 'tool_use_start':
          currentToolId = event.id;
          toolInputBuffers.set(event.id, '');
          break;

        case 'tool_use_delta':
          // Accumulate tool input JSON fragments
          const existing = toolInputBuffers.get(event.id) ?? '';
          toolInputBuffers.set(event.id, existing + event.input);
          break;

        case 'tool_use_end': {
          const rawInput = toolInputBuffers.get(event.id) ?? '{}';
          let parsedInput: Record<string, unknown> = {};
          try { parsedInput = JSON.parse(rawInput); } catch { /* empty */ }

          // Find the tool name from the start event — we need to track it
          // The tool_use_start already has the name, but tool_use_end doesn't
          // We look it up from pending or use the last started tool
          const startEvent = pendingToolCalls.find(tc => tc.id === event.id);
          if (!startEvent) {
            // This end corresponds to a start we haven't pushed yet — shouldn't happen
            // but handle gracefully
          }
          break;
        }

        case 'done':
          break;
      }

      // On tool_use_start, record the pending call
      if (event.type === 'tool_use_start') {
        pendingToolCalls.push({ id: event.id, name: event.name, input: {} });
      }
    }

    const streamElapsed = Date.now() - streamStartTime;
    console.log(`[runner] Stream complete (${streamElapsed}ms): ${pendingToolCalls.length} tool calls, ${textAccum.length} chars text`);

    // Finalize tool call inputs
    for (const tc of pendingToolCalls) {
      const rawInput = toolInputBuffers.get(tc.id) ?? '{}';
      try { tc.input = JSON.parse(rawInput); } catch { tc.input = {}; }
    }

    // If no tool calls, we're done
    if (pendingToolCalls.length === 0) {
      console.log(`[runner] Agent complete after ${iterations} iterations, ${allToolCalls.length} total tool calls`);
      return { text: textAccum, messages: currentMessages, toolCalls: allToolCalls, iterations };
    }

    // Append assistant message with tool calls
    const assistantMsg: Message = {
      role: 'assistant',
      content: textAccum || '',
      tool_calls: pendingToolCalls,
    };
    currentMessages.push(assistantMsg);

    // Execute tool calls concurrently and append results
    const MAX_RESULT_SIZE = 50 * 1024; // 50KB
    const toolResults = await Promise.allSettled(
      pendingToolCalls.map(async (tc) => {
        config.onToolStart?.(tc.name, tc.input);
        try {
          let result = await config.toolRegistry.execute(tc.name, tc.input);
          if (result.length > MAX_RESULT_SIZE) {
            result = result.slice(0, MAX_RESULT_SIZE) + `\n\n[Truncated: result was ${result.length} bytes, limit is ${MAX_RESULT_SIZE}]`;
          }
          config.onToolEnd?.(tc.name, result);
          return { tc, result, isError: false };
        } catch (err) {
          const errMsg = JSON.stringify({ error: err instanceof Error ? err.message : String(err), is_error: true });
          config.onToolEnd?.(tc.name, errMsg);
          return { tc, result: errMsg, isError: true };
        }
      }),
    );

    for (const settled of toolResults) {
      const { tc, result, isError } = settled.status === 'fulfilled'
        ? settled.value
        : { tc: pendingToolCalls[0], result: JSON.stringify({ error: 'Tool execution failed', is_error: true }), isError: true };

      allToolCalls.push({ name: tc.name, input: tc.input, result });

      currentMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
        ...(isError ? { name: '__error' } : {}),
      });
    }

    // Check abort after tool execution before next LLM call
    if (config.abortSignal?.aborted) {
      const reason = config.abortSignal.reason ?? 'aborted';
      throw new Error(`Agent turn aborted: ${reason}`);
    }

    // Loop — send updated messages back to LLM
  }

  // Max iterations reached
  console.warn(`[runner] Max iterations (${maxIter}) reached after ${allToolCalls.length} tool calls`);
  return {
    text: '[Max iterations reached]',
    messages: currentMessages,
    toolCalls: allToolCalls,
    iterations,
  };
}
