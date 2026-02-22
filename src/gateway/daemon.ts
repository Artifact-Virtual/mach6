/**
 * Mach6 — Gateway Daemon
 * 
 * The persistent process. Manages channel lifecycle, agent sessions,
 * signal handling, graceful shutdown, and hot-reload.
 * 
 * This replaces OpenClaw's gateway.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
// Use global process (don't import — it shadows signal handlers)
import { ChannelRegistry } from '../channels/registry.js';
import { DiscordAdapter } from '../channels/adapters/discord.js';
import { WhatsAppAdapter } from '../channels/adapters/whatsapp.js';
import { ToolRegistry } from '../tools/registry.js';
import { presenceManager } from '../channels/presence.js';
import { readTool } from '../tools/builtin/read.js';
import { writeTool } from '../tools/builtin/write.js';
import { execTool } from '../tools/builtin/exec.js';
import { editTool } from '../tools/builtin/edit.js';
import { imageTool } from '../tools/builtin/image.js';
import {
  processStartTool,
  processPollTool,
  processKillTool,
  processListTool,
} from '../tools/builtin/process.js';
import { ttsTool } from '../tools/builtin/tts.js';
import { webFetchTool } from '../tools/builtin/web-fetch.js';
import { memorySearchTool } from '../tools/builtin/memory.js';
import { combRecallTool, combStageTool } from '../tools/builtin/comb.js';
import { createMessageTool, createTypingTool, createPresenceTool, createDeleteMessageTool, createMarkReadTool } from '../tools/builtin/message.js';
import { SessionManager } from '../sessions/manager.js';
import { buildSystemPrompt } from '../agent/system-prompt.js';
import { runAgent } from '../agent/runner.js';
import { loadConfig, type Mach6Config } from '../config/config.js';
import type { Provider, ProviderConfig } from '../providers/types.js';
import { anthropicProvider } from '../providers/anthropic.js';
import { openaiProvider } from '../providers/openai.js';
import { githubCopilotProvider } from '../providers/github-copilot.js';
import { gladiusProvider } from '../providers/gladius.js';
import type { BusEnvelope, ChannelPolicy, OutboundMessage } from '../channels/types.js';
import { formatForChannel } from '../channels/formatter.js';

// ─── Types ─────────────────────────────────────────────────────────────────

interface GatewayConfig {
  /** Path to mach6.json */
  configPath?: string;
  /** Channels to enable */
  channels?: {
    discord?: {
      enabled: boolean;
      token: string;
      botId?: string;
      policy?: Partial<ChannelPolicy>;
    };
    whatsapp?: {
      enabled: boolean;
      authDir: string;
      phoneNumber?: string;
      autoRead?: boolean;
      policy?: Partial<ChannelPolicy>;
    };
  };
  /** Owner IDs across all channels */
  ownerIds?: string[];
  /** HTTP API port */
  apiPort?: number;
}

interface ActiveTurn {
  sessionId: string;
  abortController: AbortController;
  startedAt: number;
  channelType: string;
  chatId: string;
  adapterId: string;
}

// ─── Provider Registry ─────────────────────────────────────────────────────

const PROVIDERS = new Map<string, Provider>([
  ['anthropic', anthropicProvider],
  ['openai', openaiProvider],
  ['github-copilot', githubCopilotProvider],
  ['gladius', gladiusProvider],
]);

// ─── Gateway ───────────────────────────────────────────────────────────────

export class Mach6Gateway {
  private config: Mach6Config;
  private gatewayConfig: GatewayConfig;
  private channelRegistry: ChannelRegistry;
  private toolRegistry: ToolRegistry;
  private sessionManager: SessionManager;
  private activeTurns = new Map<string, ActiveTurn>();
  private provider: Provider;
  private providerName: string;
  private model: string;
  private systemPrompt: string;
  private shutdownRequested = false;
  private startTime = Date.now();

  constructor(gatewayConfig: GatewayConfig) {
    this.gatewayConfig = gatewayConfig;
    this.config = loadConfig(gatewayConfig.configPath);

    // Set cwd to workspace so tools resolve relative paths correctly
    if (this.config.workspace) {
      process.chdir(this.config.workspace);
      process.env.MACH6_WORKSPACE = this.config.workspace;
      console.log(`[gateway] Working directory: ${this.config.workspace}`);
    }

    // Provider
    this.providerName = this.config.defaultProvider;
    this.provider = PROVIDERS.get(this.providerName)!;
    if (!this.provider) {
      throw new Error(`Unknown provider: ${this.providerName}`);
    }
    this.model = this.config.defaultModel;

    // Tools
    this.toolRegistry = new ToolRegistry();
    for (const tool of [
      readTool, writeTool, editTool, execTool, imageTool,
      processStartTool, processPollTool, processKillTool, processListTool,
      ttsTool, webFetchTool, memorySearchTool, combRecallTool, combStageTool,
    ]) {
      this.toolRegistry.register(tool);
    }

    // Sessions
    this.sessionManager = new SessionManager(this.config.sessionsDir);

    // System prompt (base — rebuilt per-message with channel context)
    this.systemPrompt = buildSystemPrompt({
      workspace: this.config.workspace,
      tools: this.toolRegistry.list().map(t => t.name),
    });
    console.log(`[gateway] System prompt assembled (${this.systemPrompt.length} chars, workspace files loaded)`);

    // Channel registry
    this.channelRegistry = new ChannelRegistry({
      globalOwnerIds: gatewayConfig.ownerIds,
      onAdapterHealthChange: (id, health) => {
        console.log(`[gateway] Adapter ${id}: ${health.state}${health.lastError ? ` (${health.lastError})` : ''}`);
      },
    });

    // Register message tool (needs channelRegistry — must come after registry creation)
    this.toolRegistry.register(createMessageTool(this.channelRegistry));
    this.toolRegistry.register(createTypingTool(this.channelRegistry));
    this.toolRegistry.register(createPresenceTool(this.channelRegistry));
    this.toolRegistry.register(createDeleteMessageTool(this.channelRegistry));
    this.toolRegistry.register(createMarkReadTool(this.channelRegistry));

    // Rebuild system prompt now that all tools are registered
    this.systemPrompt = buildSystemPrompt({
      workspace: this.config.workspace,
      tools: this.toolRegistry.list().map(t => t.name),
    });
  }

  // ── Start ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    console.log(`\n  ⚡ Mach6 Gateway starting...`);
    console.log(`  Provider: ${this.providerName}/${this.model}`);
    console.log(`  Tools: ${this.toolRegistry.list().length}`);
    console.log(`  Workspace: ${this.config.workspace}`);

    // Register signal handlers
    this.setupSignals();

    // Subscribe to bus messages
    const bus = this.channelRegistry.getBus();
    // We use a wildcard-style approach: listen for all sessions
    // Each time a new session is routed, we subscribe
    // For now, use a polling approach on the bus
    this.startMessageLoop();

    // Start channels
    await this.startChannels();

    const elapsed = Date.now() - this.startTime;
    console.log(`  ✅ Gateway ready (${elapsed}ms)\n`);
  }

  // ── Channel Setup ──────────────────────────────────────────────────────

  private async startChannels(): Promise<void> {
    const channels = this.gatewayConfig.channels;
    if (!channels) return;

    // Discord
    if (channels.discord?.enabled) {
      console.log('  Starting Discord adapter...');
      const adapter = new DiscordAdapter('discord-main');
      const policy: ChannelPolicy = {
        dmPolicy: 'open',
        groupPolicy: 'mention-only',
        ownerIds: this.gatewayConfig.ownerIds ?? [],
        requireMention: true,
        selfId: channels.discord.botId, // Required for mention detection
        ...channels.discord.policy,
      };

      await this.channelRegistry.register(
        adapter,
        { token: channels.discord.token, botId: channels.discord.botId },
        policy,
      );
      console.log('  ✅ Discord connected');
      presenceManager.registerAdapter('discord-main', (chatId) => adapter.typing(chatId));
    }

    // WhatsApp
    if (channels.whatsapp?.enabled) {
      console.log('  Starting WhatsApp adapter...');
      const adapter = new WhatsAppAdapter('whatsapp-main');
      const policy: ChannelPolicy = {
        dmPolicy: 'allowlist',
        groupPolicy: 'mention-only',
        ownerIds: this.gatewayConfig.ownerIds ?? [],
        allowedSenders: this.gatewayConfig.ownerIds ?? [],
        ...channels.whatsapp.policy,
      };

      await this.channelRegistry.register(
        adapter,
        {
          authDir: channels.whatsapp.authDir,
          phoneNumber: channels.whatsapp.phoneNumber,
          autoRead: channels.whatsapp.autoRead ?? true,
          onQR: (qr: string) => {
            console.log(`\n📱 WhatsApp QR Code — scan to link:\n${qr}\n`);
          },
        },
        policy,
      );
      console.log('  ✅ WhatsApp connected');
      presenceManager.registerAdapter('whatsapp-main', (chatId) => adapter.typing(chatId));
    }
  }

  // ── Message Loop ───────────────────────────────────────────────────────

  /**
   * The core message loop. Polls the bus for new messages and dispatches
   * agent turns. Each session gets at most one concurrent agent turn.
   * 
   * When a new message arrives during an active turn, the bus handles it:
   * - interrupt priority → cancels current turn
   * - high priority → queued, injected at next iteration
   * - normal/low → queued for after current turn
   */
  private startMessageLoop(): void {
    const bus = this.channelRegistry.getBus();
    const knownSessions = new Set<string>();

    // Check for new sessions periodically
    setInterval(() => {
      if (this.shutdownRequested) return;

      const routes = this.channelRegistry.getRouter().getRoutes();
      for (const route of routes) {
        if (knownSessions.has(route.sessionId)) continue;
        knownSessions.add(route.sessionId);

        // Subscribe to this session
        bus.subscribe(route.sessionId, (envelope) => {
          this.handleEnvelope(envelope);
        });

        // Subscribe to interrupts
        bus.onInterrupt(route.sessionId, (envelope) => {
          this.handleInterrupt(envelope);
        });
      }
    }, 100);
  }

  private pendingEnvelopes = new Map<string, BusEnvelope[]>();

  private async handleEnvelope(envelope: BusEnvelope): Promise<void> {
    const sessionId = envelope.sessionId!;

    // Check if there's already an active turn for this session
    if (this.activeTurns.has(sessionId)) {
      // Queue the envelope for when the current turn finishes
      const pending = this.pendingEnvelopes.get(sessionId) ?? [];
      pending.push(envelope);
      this.pendingEnvelopes.set(sessionId, pending);
      console.log(`[gateway] Queued message for active session ${sessionId} (${pending.length} pending)`);
      return;
    }

    // Start a new agent turn
    await this.runAgentTurn(envelope);
  }

  private handleInterrupt(envelope: BusEnvelope): void {
    const sessionId = envelope.sessionId!;
    const active = this.activeTurns.get(sessionId);
    if (!active) return;

    console.log(`[gateway] Interrupting session ${sessionId}`);
    active.abortController.abort('new_message');
  }

  // ── Agent Turn ─────────────────────────────────────────────────────────

  private async runAgentTurn(envelope: BusEnvelope): Promise<void> {
    const sessionId = envelope.sessionId!;
    const controller = new AbortController();

    const turn: ActiveTurn = {
      sessionId,
      abortController: controller,
      startedAt: Date.now(),
      channelType: envelope.source.channelType,
      chatId: envelope.source.chatId,
      adapterId: envelope.source.adapterId,
    };

    this.activeTurns.set(sessionId, turn);
    this.channelRegistry.setSessionActive(sessionId, true);

    // Start sustained typing (refreshes every 4s until response sent)
    const typingTarget = { adapterId: envelope.source.adapterId, chatId: envelope.source.chatId };
    presenceManager.startTyping(typingTarget);

    try {
      // Load or create session
      let session = this.sessionManager.load(sessionId) ?? this.sessionManager.create(sessionId, {
        provider: this.providerName,
        model: this.model,
      });

      // Build channel-aware system prompt (refreshes workspace files each turn)
      const turnPrompt = buildSystemPrompt({
        workspace: this.config.workspace,
        tools: this.toolRegistry.list().map(t => t.name),
        channel: envelope.source.channelType,
        chatType: envelope.source.chatId.includes('@g.') ? 'group' : 'direct',
        senderId: envelope.source.senderId,
      });
      // Replace or insert system prompt (always fresh — workspace files may have changed)
      if (session.messages.length > 0 && session.messages[0].role === 'system') {
        session.messages[0].content = turnPrompt;
      } else {
        session.messages.unshift({ role: 'system', content: turnPrompt });
      }

      // Add user message
      const userContent = this.buildUserContent(envelope);
      session.messages.push({ role: 'user', content: userContent });

      // Provider config
      const providerCfg = (this.config.providers as Record<string, any>)[this.providerName] ?? {};
      const provConfig: ProviderConfig = {
        model: this.model,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
        systemPrompt: this.systemPrompt,
        ...providerCfg,
      };

      // Run agent
      console.log(`[gateway] Starting agent turn for ${sessionId} (${envelope.source.channelType}/${envelope.source.chatId})`);
      const turnStartTime = Date.now();
      const result = await runAgent(session.messages, {
        provider: this.provider,
        providerConfig: provConfig,
        toolRegistry: this.toolRegistry,
        sessionId,
        maxIterations: this.config.maxIterations ?? 50,
        abortSignal: controller.signal,
        onEvent: (ev) => {
          if (ev.type === 'usage') {
            // Track tokens
          }
        },
        onToolStart: (name) => {
          console.log(`  ⚡ ${name}`);
        },
        onToolEnd: (name, res) => {
          const preview = res.length > 100 ? res.slice(0, 100) + '...' : res;
          console.log(`  ✓ ${name}: ${preview.split('\n')[0]}`);
        },
      });

      const turnElapsed = Date.now() - turnStartTime;
      console.log(`[gateway] Agent turn completed in ${turnElapsed}ms (${result.iterations} iterations, ${result.toolCalls.length} tool calls)`);

      // Save session
      session.messages = result.messages;
      if (result.text) {
        session.messages.push({ role: 'assistant', content: result.text });
      }
      this.sessionManager.save(session);

      // Send response back through the channel
      if (result.text && result.text !== 'NO_REPLY' && result.text !== 'HEARTBEAT_OK') {
        console.log(`[gateway] Sending response to ${envelope.source.adapterId}/${envelope.source.chatId} (${result.text.length} chars)`);
        try {
          const sendResult = await this.channelRegistry.send(
            envelope.source.adapterId,
            envelope.source.chatId,
            {
              content: result.text,
              replyToId: envelope.metadata.platformMessageId,
            },
          );
          console.log(`[gateway] Send result:`, JSON.stringify(sendResult));
        } catch (sendErr) {
          console.error(`[gateway] Send FAILED:`, sendErr);
        }
      } else {
        console.log(`[gateway] No response to send (text=${result.text ? result.text.slice(0, 50) : 'null'})`);
      }

    } catch (err) {
      if (controller.signal.aborted) {
        console.log(`[gateway] Turn interrupted for ${sessionId}`);
        // Re-process with accumulated messages
        // Check our pending queue + bus drain
        const pending = this.pendingEnvelopes.get(sessionId) ?? [];
        const busPending = this.channelRegistry.getBus().drain(sessionId);
        const allPending = [...pending, ...busPending];
        this.pendingEnvelopes.delete(sessionId);
        if (allPending.length > 0) {
          // Recursion with new context
          this.activeTurns.delete(sessionId);
          this.channelRegistry.setSessionActive(sessionId, false);
          await this.runAgentTurn(allPending[allPending.length - 1]); // most recent message
          return;
        }
      } else {
        console.error(`[gateway] Agent turn error for ${sessionId}:`, err);
        // Send error message
        try {
          await this.channelRegistry.send(
            envelope.source.adapterId,
            envelope.source.chatId,
            { content: `⚠️ Error: ${err instanceof Error ? err.message : String(err)}` },
          );
        } catch { /* ignore send errors */ }
      }
    } finally {
      this.activeTurns.delete(sessionId);
      this.channelRegistry.setSessionActive(sessionId, false);
      presenceManager.stopTyping(typingTarget);

      // Process any pending messages that arrived during this turn
      const pending = this.pendingEnvelopes.get(sessionId);
      if (pending && pending.length > 0) {
        this.pendingEnvelopes.delete(sessionId);
        console.log(`[gateway] Processing ${pending.length} pending message(s) for ${sessionId}`);
        // Process the most recent pending message (others are stale context)
        await this.runAgentTurn(pending[pending.length - 1]);
      }
    }
  }

  private buildUserContent(envelope: BusEnvelope): string {
    const parts: string[] = [];

    // Sender context
    if (envelope.source.senderName) {
      parts.push(`[${envelope.source.senderName}]`);
    }

    // Reply context
    if (envelope.source.replyToId) {
      parts.push(`(replying to message ${envelope.source.replyToId})`);
    }

    // Text
    if (envelope.payload.text) {
      parts.push(envelope.payload.text);
    }

    // Media descriptions — include local path if downloaded
    if (envelope.payload.media?.length) {
      for (const m of envelope.payload.media) {
        const desc: string[] = [m.type];
        if (m.filename) desc.push(m.filename);
        else if (m.mimeType) desc.push(m.mimeType);
        if (m.path) desc.push(`path=${m.path}`);
        if (m.caption) desc.push(`caption="${m.caption}"`);
        if (m.width && m.height) desc.push(`${m.width}x${m.height}`);
        parts.push(`[${desc.join(', ')}]`);
      }
    }

    return parts.join(' ');
  }

  // ── Signals ────────────────────────────────────────────────────────────

  private setupSignals(): void {
    const shutdown = async (signal: string) => {
      if (this.shutdownRequested) return;
      this.shutdownRequested = true;
      console.log(`\n[gateway] ${signal} received, shutting down...`);

      // Cancel all active turns
      for (const [, turn] of this.activeTurns) {
        turn.abortController.abort('shutdown');
      }

      // Disconnect all channels
      await this.channelRegistry.destroy();

      presenceManager.stopAll();
      console.log('[gateway] Shutdown complete.');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // SIGUSR1 = hot-reload config
    process.on('SIGUSR1', () => {
      console.log('[gateway] SIGUSR1 — reloading config...');
      try {
        this.config = loadConfig(this.gatewayConfig.configPath);
        this.providerName = this.config.defaultProvider;
        this.provider = PROVIDERS.get(this.providerName)!;
        this.model = this.config.defaultModel;
        this.systemPrompt = buildSystemPrompt({
          workspace: this.config.workspace,
          tools: this.toolRegistry.list().map(t => t.name),
        });
        console.log(`[gateway] System prompt refreshed (${this.systemPrompt.length} chars)`);
        console.log('[gateway] Config reloaded successfully.');
      } catch (err) {
        console.error('[gateway] Config reload failed:', err);
      }
    });
  }

  // ── Status ─────────────────────────────────────────────────────────────

  status() {
    return {
      uptime: Date.now() - this.startTime,
      provider: `${this.providerName}/${this.model}`,
      channels: this.channelRegistry.list(),
      activeTurns: this.activeTurns.size,
      sessions: this.sessionManager.list().length,
      tools: this.toolRegistry.list().length,
    };
  }
}

// ─── CLI Entry ─────────────────────────────────────────────────────────────

export async function startGateway(configPath?: string): Promise<Mach6Gateway> {
  // Load gateway config from mach6.json or env
  const config = loadConfig(configPath);

  // Build gateway config from environment + mach6.json
  const gatewayConfig: GatewayConfig = {
    configPath,
    ownerIds: (config as any).ownerIds ?? [],
    channels: {
      discord: {
        enabled: !!process.env.DISCORD_BOT_TOKEN || !!(config as any).discord?.token,
        token: process.env.DISCORD_BOT_TOKEN ?? (config as any).discord?.token ?? '',
        botId: (config as any).discord?.botId,
        policy: (config as any).discord?.policy,
      },
      whatsapp: {
        enabled: !!(config as any).whatsapp?.enabled,
        authDir: (config as any).whatsapp?.authDir ?? path.join(process.env.HOME ?? '~', '.mach6/whatsapp-auth'),
        phoneNumber: (config as any).whatsapp?.phoneNumber,
        autoRead: (config as any).whatsapp?.autoRead ?? true,
        policy: (config as any).whatsapp?.policy,
      },
    },
    apiPort: (config as any).apiPort ?? 3006,
  };

  const gateway = new Mach6Gateway(gatewayConfig);
  await gateway.start();
  return gateway;
}

// Run directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('gateway/daemon.js')) {
  const configPath = process.argv.find(a => a.startsWith('--config='))?.split('=')[1];
  startGateway(configPath).catch(err => {
    console.error('Gateway startup failed:', err);
    process.exit(1);
  });
}
