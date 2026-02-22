/**
 * Mach6 CLI Config Wizard
 * Interactive first-time setup using native readline
 */

import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface WizardConfig {
  provider: string;
  model: string;
  apiKeys: Record<string, string>;
  workspace: string;
  heartbeat: boolean;
  quietHours: boolean;
  temperature: number;
  maxTokens: number;
}

const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-4-20250514' },

  { id: 'github-copilot', name: 'GitHub Copilot', defaultModel: 'claude-sonnet-4-20250514' },
  { id: 'gladius', name: 'GLADIUS (Local)', defaultModel: 'gladius-125m' },
];

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  bgCyan: '\x1b[46m',
};

const c = COLORS;

function print(msg: string): void {
  process.stdout.write(msg);
}

function println(msg = ''): void {
  console.log(msg);
}

class Wizard {
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  private ask(prompt: string): Promise<string> {
    return new Promise(resolve => {
      this.rl.question(prompt, answer => resolve(answer.trim()));
    });
  }

  private async askMasked(prompt: string): Promise<string> {
    return new Promise(resolve => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      // We'll collect chars manually for masking
      print(prompt);
      let value = '';

      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      if (stdin.isTTY) stdin.setRawMode(true);

      const onData = (buf: Buffer): void => {
        const ch = buf.toString();
        if (ch === '\r' || ch === '\n') {
          stdin.removeListener('data', onData);
          if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
          println();
          rl.close();
          resolve(value);
        } else if (ch === '\x7f' || ch === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            print('\b \b');
          }
        } else if (ch === '\x03') {
          // Ctrl+C
          println();
          process.exit(0);
        } else if (ch.charCodeAt(0) >= 32) {
          value += ch;
          print('•');
        }
      };

      stdin.on('data', onData);
    });
  }

  private async selectOne(prompt: string, choices: { id: string; name: string }[]): Promise<string> {
    if (!process.stdin.isTTY) {
      // Fallback for non-TTY: simple number selection
      println(`${c.cyan}? ${c.bold}${prompt}${c.reset}`);
      choices.forEach((ch, i) => println(`  ${i + 1}. ${ch.name}`));
      const answer = await this.ask(`  Enter number (1-${choices.length}): `);
      const idx = parseInt(answer, 10) - 1;
      return choices[Math.max(0, Math.min(idx, choices.length - 1))].id;
    }

    return new Promise(resolve => {
      let selected = 0;
      const render = (): void => {
        // Move cursor up and clear
        if (selected > 0 || true) {
          print(`\x1b[${choices.length + 1}A`);
        }
        println(`${c.cyan}? ${c.bold}${prompt}${c.reset}`);
        choices.forEach((ch, i) => {
          if (i === selected) {
            println(`  ${c.cyan}❯ ${ch.name}${c.reset}`);
          } else {
            println(`    ${c.dim}${ch.name}${c.reset}`);
          }
        });
      };

      // Initial render
      println(`${c.cyan}? ${c.bold}${prompt}${c.reset}`);
      choices.forEach((ch, i) => {
        if (i === selected) {
          println(`  ${c.cyan}❯ ${ch.name}${c.reset}`);
        } else {
          println(`    ${c.dim}${ch.name}${c.reset}`);
        }
      });

      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();

      const onData = (buf: Buffer): void => {
        const key = buf.toString();
        if (key === '\x1b[A' || key === 'k') {
          // Up
          selected = Math.max(0, selected - 1);
          render();
        } else if (key === '\x1b[B' || key === 'j') {
          // Down
          selected = Math.min(choices.length - 1, selected + 1);
          render();
        } else if (key === '\r' || key === '\n') {
          stdin.removeListener('data', onData);
          stdin.setRawMode(false);
          // Show final selection
          print(`\x1b[${choices.length + 1}A`);
          println(`${c.cyan}? ${c.bold}${prompt} ${c.green}${choices[selected].name}${c.reset}`);
          // Clear remaining lines
          for (let i = 0; i < choices.length; i++) {
            println('\x1b[2K');
          }
          print(`\x1b[${choices.length}A`);
          resolve(choices[selected].id);
        } else if (key === '\x03') {
          println();
          process.exit(0);
        }
      };

      stdin.on('data', onData);
    });
  }

  private async confirm(prompt: string, defaultYes = true): Promise<boolean> {
    const hint = defaultYes ? 'Y/n' : 'y/N';
    const answer = await this.ask(`${c.cyan}? ${c.bold}${prompt}${c.reset} (${hint}) `);
    if (answer === '') return defaultYes;
    return answer.toLowerCase().startsWith('y');
  }

  async run(): Promise<void> {
    println();
    println(`${c.bold}${c.cyan}  Welcome to Mach6 🚀${c.reset}`);
    println();
    println(`${c.dim}  Let's configure your agent.${c.reset}`);
    println();

    const config: WizardConfig = {
      provider: '',
      model: '',
      apiKeys: {},
      workspace: process.cwd(),
      heartbeat: true,
      quietHours: true,
      temperature: 0.7,
      maxTokens: 8192,
    };

    // Provider selection
    config.provider = await this.selectOne('Default provider:', PROVIDERS.map(p => ({ id: p.id, name: p.name })));
    const provider = PROVIDERS.find(p => p.id === config.provider)!;

    // API Key
    if (config.provider !== 'gladius') {
      const key = await this.askMasked(`${c.cyan}? ${c.bold}API Key for ${provider.name}:${c.reset} `);
      if (key) config.apiKeys[config.provider] = key;
    }

    // Model
    const modelAnswer = await this.ask(`${c.cyan}? ${c.bold}Default model${c.reset} ${c.dim}(${provider.defaultModel})${c.reset}: `);
    config.model = modelAnswer || provider.defaultModel;
    println(`  ${c.green}${config.model}${c.reset}`);

    // Workspace
    const wsAnswer = await this.ask(`${c.cyan}? ${c.bold}Workspace directory${c.reset} ${c.dim}(${process.cwd()})${c.reset}: `);
    config.workspace = wsAnswer || process.cwd();

    // Heartbeat
    config.heartbeat = await this.confirm('Enable heartbeat?', true);

    // Quiet hours
    config.quietHours = await this.confirm('Quiet hours (23:00-08:00)?', true);

    // Write config
    const outPath = path.resolve(process.cwd(), 'mach6.json');
    const existing: Record<string, unknown> = {};
    try {
      Object.assign(existing, JSON.parse(fs.readFileSync(outPath, 'utf-8')));
    } catch { /* new file */ }

    const finalConfig = {
      ...existing,
      provider: config.provider,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      apiKeys: { ...(existing.apiKeys as Record<string, string> ?? {}), ...config.apiKeys },
      workspace: config.workspace,
      heartbeat: config.heartbeat,
      quietHours: config.quietHours ? { start: '23:00', end: '08:00' } : false,
    };

    fs.writeFileSync(outPath, JSON.stringify(finalConfig, null, 2) + '\n');

    println();
    println(`  ${c.green}Config saved to ./mach6.json ✅${c.reset}`);
    println(`  ${c.dim}Run \`mach6\` to start.${c.reset}`);
    println();

    this.rl.close();
  }
}

// Run directly
export async function runWizard(): Promise<void> {
  const wizard = new Wizard();
  await wizard.run();
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli/wizard.js')) {
  runWizard().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
