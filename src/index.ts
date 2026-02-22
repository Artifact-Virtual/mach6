#!/usr/bin/env node
// Mach6 — CLI Entry Point (Phase 2: Enhanced)

import * as readline from 'node:readline';
import { loadConfig } from './config/config.js';
import { anthropicProvider } from './providers/anthropic.js';
import { openaiProvider } from './providers/openai.js';
import { githubCopilotProvider } from './providers/github-copilot.js';
import { gladiusProvider } from './providers/gladius.js';
import type { Provider, ProviderConfig } from './providers/types.js';
import { ToolRegistry } from './tools/registry.js';
import { readTool } from './tools/builtin/read.js';
import { writeTool } from './tools/builtin/write.js';
import { execTool } from './tools/builtin/exec.js';
import { editTool } from './tools/builtin/edit.js';
import { imageTool } from './tools/builtin/image.js';
import { processStartTool, processPollTool, processKillTool, processListTool } from './tools/builtin/process.js';
import { ttsTool } from './tools/builtin/tts.js';
import { webFetchTool } from './tools/builtin/web-fetch.js';
import { memorySearchTool } from './tools/builtin/memory.js';
import { combRecallTool, combStageTool } from './tools/builtin/comb.js';
import { SessionManager } from './sessions/manager.js';
import { SubAgentManager } from './sessions/sub-agent.js';
import { buildSystemPrompt } from './agent/system-prompt.js';
import { runAgent } from './agent/runner.js';
import type { Message } from './providers/types.js';
import type { Session } from './sessions/types.js';

// ─── Provider registry ───
const providers = new Map<string, Provider>([
  ['anthropic', anthropicProvider],
  ['openai', openaiProvider],
  ['github-copilot', githubCopilotProvider],
  ['gladius', gladiusProvider],
]);

// ─── Main ───
async function main() {
  const args = process.argv.slice(2);
  const configPath = args.find(a => a.startsWith('--config='))?.split('=')[1];
  const sessionId = args.find(a => a.startsWith('--session='))?.split('=')[1] ?? 'default';
  const providerArg = args.find(a => a.startsWith('--provider='))?.split('=')[1];
  const modelArg = args.find(a => a.startsWith('--model='))?.split('=')[1];
  const oneShot = args.find(a => !a.startsWith('--'));

  const config = loadConfig(configPath);

  // Mutable provider/model for mid-session switching
  let currentProviderName = providerArg ?? config.defaultProvider;
  let currentProvider = providers.get(currentProviderName);
  if (!currentProvider) {
    console.error(`Unknown provider: ${currentProviderName}. Available: ${[...providers.keys()].join(', ')}`);
    process.exit(1);
  }

  let currentModel = modelArg ?? config.defaultModel;

  const makeProviderConfig = (): ProviderConfig => {
    const providerCfg = config.providers[currentProviderName as keyof typeof config.providers] ?? {};
    return {
      model: currentModel,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      ...providerCfg,
    };
  };

  // Setup tools
  const registry = new ToolRegistry();
  for (const tool of [readTool, writeTool, editTool, execTool, imageTool, processStartTool, processPollTool, processKillTool, processListTool, ttsTool, webFetchTool, memorySearchTool, combRecallTool, combStageTool]) {
    registry.register(tool);
  }

  // Setup session manager
  const sessionMgr = new SessionManager(config.sessionsDir);
  let session = sessionMgr.load(sessionId) ?? sessionMgr.create(sessionId, {
    provider: currentProviderName,
    model: currentModel,
  });

  // Sub-agent manager
  const subAgentMgr = new SubAgentManager(sessionMgr, (parentId, handle) => {
    console.log(`\n\x1b[35m🤖 Sub-agent ${handle.sessionId} ${handle.status}: ${(handle.result ?? handle.error ?? '').slice(0, 200)}\x1b[0m\n`);
  });

  // System prompt
  const systemPrompt = buildSystemPrompt({
    workspace: config.workspace,
    tools: registry.list().map(t => t.name),
  });

  if (session.messages.length === 0 || session.messages[0].role !== 'system') {
    session.messages.unshift({ role: 'system', content: systemPrompt });
  }

  console.log(`\x1b[36mMach6\x1b[0m v0.2 | ${currentProvider!.name}/${currentModel} | session: ${sessionId}`);
  console.log(`Tools (${registry.list().length}): ${registry.list().map(t => t.name).join(', ')}`);
  console.log('Type /help for commands\n');

  const runWithCallbacks = async (msgs: Message[], provConfig: ProviderConfig) => {
    return runAgent(msgs, {
      provider: currentProvider!,
      providerConfig: { ...provConfig, systemPrompt },
      toolRegistry: registry,
      sessionId,
      onEvent(ev) {
        if (ev.type === 'text_delta') process.stdout.write(ev.text);
        if (ev.type === 'usage') {
          sessionMgr.trackUsage(session, ev.usage.inputTokens, ev.usage.outputTokens);
        }
      },
      onToolStart(name) {
        sessionMgr.trackToolCall(session, name);
        console.log(`\n\x1b[33m⚡ ${name}\x1b[0m`);
      },
      onToolEnd(name, result) {
        const preview = result.length > 200 ? result.slice(0, 200) + '...' : result;
        console.log(`\x1b[32m✓ ${name}\x1b[0m ${preview.split('\n')[0]}`);
      },
    });
  };

  // One-shot mode
  if (oneShot) {
    session.messages.push({ role: 'user', content: oneShot });
    const result = await runWithCallbacks(session.messages, makeProviderConfig());
    console.log('\n');
    session.messages = result.messages;
    if (result.text) session.messages.push({ role: 'assistant', content: result.text });
    sessionMgr.save(session);
    return;
  }

  // Interactive REPL
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const handleCommand = async (trimmed: string): Promise<boolean> => {
    if (trimmed === '/quit' || trimmed === '/exit') { rl.close(); return true; }

    if (trimmed === '/help') {
      console.log(`
Commands:
  /tools              List available tools
  /history [N]        Show last N messages (default 10)
  /model <name>       Switch model
  /provider <name>    Switch provider
  /spawn <task>       Spawn a sub-agent
  /status             Session stats
  /sessions           List all sessions
  /clear              Clear session
  /quit               Exit
`);
      return true;
    }

    if (trimmed === '/tools') {
      for (const t of registry.list()) {
        console.log(`  \x1b[36m${t.name}\x1b[0m — ${t.description}`);
      }
      console.log('');
      return true;
    }

    if (trimmed.startsWith('/history')) {
      const n = parseInt(trimmed.split(' ')[1] ?? '10', 10);
      const msgs = session.messages.filter(m => m.role !== 'system').slice(-n);
      for (const m of msgs) {
        const text = typeof m.content === 'string' ? m.content.slice(0, 200) : '[structured]';
        const color = m.role === 'user' ? '36' : m.role === 'assistant' ? '37' : '33';
        console.log(`  \x1b[${color}m[${m.role}]\x1b[0m ${text}`);
      }
      console.log('');
      return true;
    }

    if (trimmed.startsWith('/model ')) {
      currentModel = trimmed.slice(7).trim();
      session.metadata.model = currentModel;
      console.log(`Model switched to: ${currentModel}\n`);
      return true;
    }

    if (trimmed.startsWith('/provider ')) {
      const name = trimmed.slice(10).trim();
      const p = providers.get(name);
      if (!p) {
        console.log(`Unknown provider. Available: ${[...providers.keys()].join(', ')}\n`);
      } else {
        currentProviderName = name;
        currentProvider = p;
        session.metadata.provider = name;
        console.log(`Provider switched to: ${name}\n`);
      }
      return true;
    }

    if (trimmed.startsWith('/spawn ')) {
      const task = trimmed.slice(7).trim();
      if (!task) { console.log('Usage: /spawn <task>\n'); return true; }
      const handle = await subAgentMgr.spawn(
        { parentSessionId: sessionId, task, depth: session.metadata.depth + 1 },
        currentProvider!,
        makeProviderConfig(),
        registry,
        config.workspace,
      );
      console.log(`Spawned sub-agent: ${handle.sessionId} (status: ${handle.status})\n`);
      return true;
    }

    if (trimmed === '/status') {
      const m = session.metadata;
      console.log(`
Session: ${session.id}${m.label ? ` (${m.label})` : ''}
Provider: ${m.provider ?? currentProviderName} / ${m.model ?? currentModel}
Messages: ${m.messageCount}
Tokens: ${m.tokenUsage.input} in / ${m.tokenUsage.output} out
Tools used: ${Object.entries(m.toolsUsed).map(([k, v]) => `${k}(${v})`).join(', ') || 'none'}
Sub-agents: ${subAgentMgr.listRunning().length} running
Created: ${new Date(session.createdAt).toLocaleString()}
`);
      return true;
    }

    if (trimmed === '/sessions') {
      const sessions = sessionMgr.list();
      for (const s of sessions) {
        const label = s.label ? ` (${s.label})` : '';
        console.log(`  ${s.id}${label} — ${s.messageCount} msgs, ${new Date(s.updatedAt).toLocaleString()}`);
      }
      console.log('');
      return true;
    }

    if (trimmed === '/clear') {
      session = sessionMgr.create(sessionId, { provider: currentProviderName, model: currentModel });
      session.messages.unshift({ role: 'system', content: systemPrompt });
      console.log('Session cleared.\n');
      return true;
    }

    return false;
  };

  const prompt = () => {
    rl.question('\x1b[36m❯\x1b[0m ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { prompt(); return; }

      if (trimmed.startsWith('/')) {
        const handled = await handleCommand(trimmed);
        if (trimmed === '/quit' || trimmed === '/exit') return;
        if (handled) { prompt(); return; }
      }

      session.messages.push({ role: 'user', content: trimmed });

      try {
        const result = await runWithCallbacks(session.messages, makeProviderConfig());
        console.log('\n');
        session.messages = result.messages;
        if (result.text) session.messages.push({ role: 'assistant', content: result.text });
        sessionMgr.save(session);
      } catch (err) {
        console.error(`\n\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}\n`);
      }

      prompt();
    });
  };

  prompt();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
