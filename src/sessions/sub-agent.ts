// Mach6 — Sub-agent spawning and management

import { randomUUID } from 'node:crypto';
import type { SubAgentConfig, SubAgentHandle, Session } from './types.js';
import type { SessionManager } from './manager.js';
import type { Provider, ProviderConfig, Message } from '../providers/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import { runAgent } from '../agent/runner.js';
import { buildSystemPrompt } from '../agent/system-prompt.js';

const MAX_DEPTH = 3;

export class SubAgentManager {
  private agents = new Map<string, SubAgentHandle>();
  private sessionManager: SessionManager;
  private onComplete?: (parentSessionId: string, handle: SubAgentHandle) => void;

  constructor(sessionManager: SessionManager, onComplete?: (parentSessionId: string, handle: SubAgentHandle) => void) {
    this.sessionManager = sessionManager;
    this.onComplete = onComplete;
  }

  async spawn(
    config: SubAgentConfig,
    provider: Provider,
    providerConfig: ProviderConfig,
    toolRegistry: ToolRegistry,
    workspace: string,
  ): Promise<SubAgentHandle> {
    if (config.depth >= MAX_DEPTH) {
      return {
        sessionId: '',
        task: config.task,
        status: 'failed',
        startedAt: Date.now(),
        error: `Max sub-agent depth (${MAX_DEPTH}) reached`,
      };
    }

    const sessionId = `subagent:${randomUUID().slice(0, 8)}`;
    const session = this.sessionManager.create(sessionId, {
      label: `Sub-agent: ${config.task.slice(0, 50)}`,
      provider: config.provider ?? providerConfig.model,
      model: config.model ?? providerConfig.model,
      parentSessionId: config.parentSessionId,
      depth: config.depth,
    });

    const handle: SubAgentHandle = {
      sessionId,
      task: config.task,
      status: 'running',
      startedAt: Date.now(),
    };
    this.agents.set(sessionId, handle);

    // Build system prompt for sub-agent
    const systemPrompt = buildSystemPrompt({
      workspace,
      tools: toolRegistry.list().map(t => t.name),
      extraContext: `You are a sub-agent spawned for a specific task. Complete it and provide a concise result.\n\nTask: ${config.task}`,
    });

    session.messages.push({ role: 'system', content: systemPrompt });
    session.messages.push({ role: 'user', content: config.task });

    // Run asynchronously — don't await
    this.runSubAgent(session, handle, config, provider, providerConfig, toolRegistry);

    return handle;
  }

  private async runSubAgent(
    session: Session,
    handle: SubAgentHandle,
    config: SubAgentConfig,
    provider: Provider,
    providerConfig: ProviderConfig,
    toolRegistry: ToolRegistry,
  ): Promise<void> {
    try {
      const result = await runAgent(session.messages, {
        provider,
        providerConfig: { ...providerConfig, systemPrompt: session.messages[0]?.content as string },
        toolRegistry,
        maxIterations: config.maxIterations ?? 15,
        sessionId: session.id,
      });

      handle.status = 'completed';
      handle.result = result.text;
      handle.completedAt = Date.now();

      session.messages = result.messages;
      if (result.text) session.messages.push({ role: 'assistant', content: result.text });
      this.sessionManager.save(session);

      this.onComplete?.(config.parentSessionId, handle);
    } catch (err) {
      handle.status = 'failed';
      handle.error = err instanceof Error ? err.message : String(err);
      handle.completedAt = Date.now();
      this.onComplete?.(config.parentSessionId, handle);
    }
  }

  kill(sessionId: string): boolean {
    const handle = this.agents.get(sessionId);
    if (!handle || handle.status !== 'running') return false;
    handle.status = 'killed';
    handle.completedAt = Date.now();
    return true;
  }

  steer(sessionId: string, message: string): boolean {
    const handle = this.agents.get(sessionId);
    if (!handle || handle.status !== 'running') return false;
    // Inject a steering message into the sub-agent's session
    const session = this.sessionManager.load(sessionId);
    if (!session) return false;
    session.messages.push({ role: 'user', content: `[Steering from parent]: ${message}` });
    this.sessionManager.save(session);
    return true;
  }

  get(sessionId: string): SubAgentHandle | undefined {
    return this.agents.get(sessionId);
  }

  list(): SubAgentHandle[] {
    return [...this.agents.values()];
  }

  listRunning(): SubAgentHandle[] {
    return [...this.agents.values()].filter(a => a.status === 'running');
  }
}
