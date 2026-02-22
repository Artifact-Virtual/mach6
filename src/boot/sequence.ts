// Mach6 — Clean Boot Sequence (fixes Pain #20)
// Single entry point. Each step has timeout + fallback. Never crash on partial failure.

export type BootStepStatus = 'pending' | 'running' | 'ok' | 'degraded' | 'failed';

export interface BootStep {
  name: string;
  description: string;
  timeoutMs: number;
  required: boolean; // if false, failure = degraded, not fatal
  execute: () => Promise<void>;
}

export interface BootResult {
  step: string;
  status: BootStepStatus;
  durationMs: number;
  error?: string;
}

/**
 * Run the boot sequence. Each step runs in order with timeout.
 * Non-required steps degrade gracefully instead of crashing.
 */
export async function runBootSequence(steps: BootStep[]): Promise<{
  results: BootResult[];
  ready: boolean;
  degraded: string[];
}> {
  const results: BootResult[] = [];
  const degraded: string[] = [];
  let fatal = false;

  console.log('🚀 Mach6 boot sequence starting...\n');

  for (const step of steps) {
    if (fatal) {
      results.push({ step: step.name, status: 'pending', durationMs: 0, error: 'Skipped (prior fatal error)' });
      continue;
    }

    const start = Date.now();
    console.log(`  ⏳ ${step.name}: ${step.description}...`);

    try {
      await Promise.race([
        step.execute(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${step.timeoutMs}ms`)), step.timeoutMs)
        ),
      ]);

      const duration = Date.now() - start;
      results.push({ step: step.name, status: 'ok', durationMs: duration });
      console.log(`  ✅ ${step.name} (${duration}ms)`);

    } catch (err) {
      const duration = Date.now() - start;
      const errMsg = err instanceof Error ? err.message : String(err);

      if (step.required) {
        results.push({ step: step.name, status: 'failed', durationMs: duration, error: errMsg });
        console.error(`  ❌ ${step.name} FAILED (required): ${errMsg}`);
        fatal = true;
      } else {
        results.push({ step: step.name, status: 'degraded', durationMs: duration, error: errMsg });
        degraded.push(step.name);
        console.warn(`  ⚠️  ${step.name} degraded: ${errMsg}`);
      }
    }
  }

  const ready = !fatal;
  const totalMs = results.reduce((s, r) => s + r.durationMs, 0);

  if (ready) {
    if (degraded.length > 0) {
      console.log(`\n🟡 Mach6 ready (degraded: ${degraded.join(', ')}) — ${totalMs}ms total\n`);
    } else {
      console.log(`\n🟢 Mach6 ready — ${totalMs}ms total\n`);
    }
  } else {
    console.error(`\n🔴 Mach6 boot FAILED — cannot start\n`);
  }

  return { results, ready, degraded };
}

/**
 * Create standard boot steps for Mach6.
 */
export function createDefaultBootSteps(hooks: {
  loadConfig: () => Promise<void>;
  validateConfig: () => Promise<void>;
  combRecall: () => Promise<void>;
  hektorWarm: () => Promise<void>;
  channelConnect: () => Promise<void>;
}): BootStep[] {
  return [
    { name: 'config-load', description: 'Loading configuration', timeoutMs: 5_000, required: true, execute: hooks.loadConfig },
    { name: 'config-validate', description: 'Validating configuration', timeoutMs: 5_000, required: true, execute: hooks.validateConfig },
    { name: 'comb-recall', description: 'Recalling operational memory (COMB)', timeoutMs: 15_000, required: false, execute: hooks.combRecall },
    { name: 'hektor-warm', description: 'Warming HEKTOR search index', timeoutMs: 60_000, required: false, execute: hooks.hektorWarm },
    { name: 'channel-connect', description: 'Connecting channels', timeoutMs: 30_000, required: false, execute: hooks.channelConnect },
  ];
}
