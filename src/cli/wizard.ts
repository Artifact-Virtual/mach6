/**
 * Mach6 CLI Config Wizard
 * Interactive first-time setup — generates mach6.json + .env
 */

import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

// ── Types ────────────────────────────────────────────────────

interface WizardConfig {
  provider: string;
  model: string;
  apiKey: string;
  workspace: string;
  temperature: number;
  maxTokens: number;
  maxIterations: number;
  apiPort: number;
  apiSecret: string;
  discord: {
    enabled: boolean;
    token: string;
    botId: string;
    siblingBotIds: string[];
  };
  whatsapp: {
    enabled: boolean;
    phoneNumber: string;
    authDir: string;
  };
  ownerIds: string[];
  dmPolicy: string;
  groupPolicy: string;
}

// ── Constants ────────────────────────────────────────────────

const PROVIDERS = [
  { id: 'github-copilot', name: 'GitHub Copilot (auto-auth via gh CLI)', defaultModel: 'claude-sonnet-4', needsKey: false },
  { id: 'anthropic', name: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-4-20250514', needsKey: true },
  { id: 'openai', name: 'OpenAI (GPT-4o)', defaultModel: 'gpt-4o', needsKey: true },
  { id: 'gladius', name: 'Gladius (local model)', defaultModel: 'gladius-125m', needsKey: false },
];

const MODELS_BY_PROVIDER: Record<string, { id: string; name: string }[]> = {
  'github-copilot': [
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
    { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'o3-mini', name: 'o3-mini' },
  ],
  'anthropic': [
    { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
  ],
  'openai': [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'o3-mini', name: 'o3-mini' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  ],
  'gladius': [
    { id: 'gladius-125m', name: 'Gladius 125M' },
  ],
};

const POLICIES = [
  { id: 'allowlist', name: 'Allowlist — only specified senders' },
  { id: 'open', name: 'Open — respond to everyone' },
];

const GROUP_POLICIES = [
  { id: 'mention-only', name: 'Mention-only — respond when @mentioned' },
  { id: 'allowlist', name: 'Allowlist — only from allowed senders in allowed groups' },
  { id: 'off', name: 'Disabled — ignore all group messages' },
];

// ── ANSI Colors ──────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
};

function print(msg: string): void { process.stdout.write(msg); }
function println(msg = ''): void { console.log(msg); }

// ── Wizard Class ─────────────────────────────────────────────

class Wizard {
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  private ask(prompt: string, defaultVal?: string): Promise<string> {
    const hint = defaultVal ? ` ${c.dim}(${defaultVal})${c.reset}` : '';
    return new Promise(resolve => {
      this.rl.question(`${c.cyan}? ${c.bold}${prompt}${c.reset}${hint} `, answer => {
        resolve(answer.trim() || defaultVal || '');
      });
    });
  }

  private async askMasked(prompt: string): Promise<string> {
    return new Promise(resolve => {
      print(`${c.cyan}? ${c.bold}${prompt}${c.reset} `);
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
          resolve(value);
        } else if (ch === '\x7f' || ch === '\b') {
          if (value.length > 0) { value = value.slice(0, -1); print('\b \b'); }
        } else if (ch === '\x03') { println(); process.exit(0); }
        else if (ch.charCodeAt(0) >= 32) { value += ch; print('•'); }
      };
      stdin.on('data', onData);
    });
  }

  private async selectOne(prompt: string, choices: { id: string; name: string }[]): Promise<string> {
    if (!process.stdin.isTTY) {
      println(`${c.cyan}? ${c.bold}${prompt}${c.reset}`);
      choices.forEach((ch, i) => println(`  ${i + 1}. ${ch.name}`));
      const answer = await this.ask(`  Enter number (1-${choices.length}):`);
      const idx = parseInt(answer, 10) - 1;
      return choices[Math.max(0, Math.min(idx, choices.length - 1))].id;
    }

    return new Promise(resolve => {
      let selected = 0;
      const render = (): void => {
        print(`\x1b[${choices.length + 1}A`);
        println(`${c.cyan}? ${c.bold}${prompt}${c.reset}`);
        choices.forEach((ch, i) => {
          println(i === selected
            ? `  ${c.cyan}❯ ${ch.name}${c.reset}`
            : `    ${c.dim}${ch.name}${c.reset}`);
        });
      };

      println(`${c.cyan}? ${c.bold}${prompt}${c.reset}`);
      choices.forEach((ch, i) => {
        println(i === selected
          ? `  ${c.cyan}❯ ${ch.name}${c.reset}`
          : `    ${c.dim}${ch.name}${c.reset}`);
      });

      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();

      const onData = (buf: Buffer): void => {
        const key = buf.toString();
        if (key === '\x1b[A' || key === 'k') { selected = Math.max(0, selected - 1); render(); }
        else if (key === '\x1b[B' || key === 'j') { selected = Math.min(choices.length - 1, selected + 1); render(); }
        else if (key === '\r' || key === '\n') {
          stdin.removeListener('data', onData);
          stdin.setRawMode(false);
          print(`\x1b[${choices.length + 1}A`);
          println(`${c.cyan}? ${c.bold}${prompt} ${c.green}${choices[selected].name}${c.reset}`);
          for (let i = 0; i < choices.length; i++) println('\x1b[2K');
          print(`\x1b[${choices.length}A`);
          resolve(choices[selected].id);
        } else if (key === '\x03') { println(); process.exit(0); }
      };
      stdin.on('data', onData);
    });
  }

  private async confirm(prompt: string, defaultYes = true): Promise<boolean> {
    const hint = defaultYes ? 'Y/n' : 'y/N';
    const answer = await this.ask(`${prompt} (${hint})`);
    if (answer === '') return defaultYes;
    return answer.toLowerCase().startsWith('y');
  }

  private section(title: string): void {
    println();
    println(`${c.magenta}  ── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}${c.reset}`);
    println();
  }

  private done(msg: string): void {
    println(`  ${c.green}✓${c.reset} ${msg}`);
  }

  // ── Validation ──────────────────────────────────────

  private validatePort(port: string): boolean {
    const n = parseInt(port, 10);
    return !isNaN(n) && n >= 1 && n <= 65535;
  }

  private validateDiscordToken(token: string): boolean {
    // Discord tokens are base64-encoded and have 3 parts separated by dots
    return token.length > 50 && token.split('.').length >= 2;
  }

  private validatePhoneNumber(phone: string): boolean {
    // Basic: starts with + or digits, 7-15 chars
    return /^\+?[\d\s\-()]{7,20}$/.test(phone);
  }

  // ── Main Flow ───────────────────────────────────────

  async run(): Promise<void> {
    println();
    println(`${c.bold}${c.cyan}  ⚡ Mach6 Setup${c.reset}`);
    println(`${c.dim}  Interactive configuration wizard${c.reset}`);

    const config: WizardConfig = {
      provider: '', model: '', apiKey: '', workspace: process.cwd(),
      temperature: 0.3, maxTokens: 8192, maxIterations: 50, apiPort: 3006,
      apiSecret: crypto.randomBytes(32).toString('hex'),
      discord: { enabled: false, token: '', botId: '', siblingBotIds: [] },
      whatsapp: { enabled: false, phoneNumber: '', authDir: path.join(os.homedir(), '.mach6', 'whatsapp-auth') },
      ownerIds: [], dmPolicy: 'allowlist', groupPolicy: 'mention-only',
    };

    // ── 1. Provider ──────────────────────────────────

    this.section('LLM Provider');

    config.provider = await this.selectOne('Default provider:', PROVIDERS.map(p => ({ id: p.id, name: p.name })));
    const provider = PROVIDERS.find(p => p.id === config.provider)!;

    // API Key
    if (provider.needsKey) {
      config.apiKey = await this.askMasked(`API key for ${provider.name}:`);
      if (config.apiKey) this.done('API key set');
      else println(`  ${c.yellow}⚠${c.reset} No API key — set it in .env later`);
    } else if (config.provider === 'github-copilot') {
      println(`  ${c.dim}GitHub Copilot auto-resolves tokens via \`gh auth login\`${c.reset}`);
    }

    // Model
    const models = MODELS_BY_PROVIDER[config.provider] || [];
    if (models.length > 1) {
      config.model = await this.selectOne('Model:', models);
    } else {
      config.model = provider.defaultModel;
    }
    this.done(`Provider: ${provider.name} / ${config.model}`);

    // ── 2. Channels ──────────────────────────────────

    this.section('Channels');

    // Discord
    config.discord.enabled = await this.confirm('Enable Discord?', false);
    if (config.discord.enabled) {
      config.discord.token = await this.askMasked('Discord bot token:');
      if (config.discord.token && !this.validateDiscordToken(config.discord.token)) {
        println(`  ${c.yellow}⚠${c.reset} Token looks short — make sure it's correct`);
      }
      config.discord.botId = await this.ask('Discord bot (client) ID:');
      const siblings = await this.ask('Sibling bot IDs (comma-separated, or blank):');
      if (siblings) config.discord.siblingBotIds = siblings.split(',').map(s => s.trim()).filter(Boolean);
      this.done('Discord configured');
    }

    // WhatsApp
    config.whatsapp.enabled = await this.confirm('Enable WhatsApp?', false);
    if (config.whatsapp.enabled) {
      config.whatsapp.phoneNumber = await this.ask('Your phone number (with country code):');
      if (config.whatsapp.phoneNumber && !this.validatePhoneNumber(config.whatsapp.phoneNumber)) {
        println(`  ${c.yellow}⚠${c.reset} Phone format looks unusual — expected: +1234567890`);
      }
      const authDefault = config.whatsapp.authDir.replace(/\\/g, '/');
      const authAnswer = await this.ask('WhatsApp auth directory:', authDefault);
      config.whatsapp.authDir = authAnswer;
      println(`  ${c.dim}On first start, scan the QR code or enter pairing code${c.reset}`);
      this.done('WhatsApp configured');
    }

    if (!config.discord.enabled && !config.whatsapp.enabled) {
      println(`  ${c.dim}No channels enabled — you can still use the CLI and Web UI${c.reset}`);
    }

    // ── 3. Owner & Policies ──────────────────────────

    this.section('Access Control');

    const ownerInput = await this.ask('Owner IDs (comma-separated Discord IDs and/or phone@s.whatsapp.net):');
    config.ownerIds = ownerInput ? ownerInput.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (config.ownerIds.length === 0) {
      println(`  ${c.yellow}⚠${c.reset} No owner IDs — the agent won't respond to anyone on channels`);
    } else {
      this.done(`${config.ownerIds.length} owner(s) configured`);
    }

    const customPolicies = await this.confirm('Customize channel policies?', false);
    if (customPolicies) {
      config.dmPolicy = await this.selectOne('DM policy:', POLICIES);
      config.groupPolicy = await this.selectOne('Group policy:', GROUP_POLICIES);
    }
    this.done(`DM: ${config.dmPolicy} | Group: ${config.groupPolicy}`);

    // ── 4. Workspace & Server ────────────────────────

    this.section('Workspace');

    const wsDefault = process.cwd().replace(/\\/g, '/');
    const wsAnswer = await this.ask('Workspace directory:', wsDefault);
    config.workspace = wsAnswer;
    if (process.platform === 'win32') {
      println(`  ${c.dim}Tip: use forward slashes — "C:/Users/you/workspace"${c.reset}`);
    }

    const portAnswer = await this.ask('API + Web UI port:', '3006');
    if (this.validatePort(portAnswer)) {
      config.apiPort = parseInt(portAnswer, 10);
    } else {
      println(`  ${c.yellow}⚠${c.reset} Invalid port, using default 3006`);
    }
    this.done(`Workspace: ${config.workspace} | Port: ${config.apiPort}`);

    // ── 5. Summary ───────────────────────────────────

    this.section('Summary');

    println(`  Provider:   ${c.cyan}${provider.name}${c.reset} / ${config.model}`);
    println(`  Discord:    ${config.discord.enabled ? `${c.green}enabled${c.reset}` : `${c.dim}disabled${c.reset}`}`);
    println(`  WhatsApp:   ${config.whatsapp.enabled ? `${c.green}enabled${c.reset}` : `${c.dim}disabled${c.reset}`}`);
    println(`  Owners:     ${config.ownerIds.length > 0 ? config.ownerIds.join(', ') : `${c.dim}none${c.reset}`}`);
    println(`  Workspace:  ${config.workspace}`);
    println(`  Port:       ${config.apiPort}`);
    println(`  DM policy:  ${config.dmPolicy}`);
    println(`  Group:      ${config.groupPolicy}`);
    println();

    const proceed = await this.confirm('Write configuration files?', true);
    if (!proceed) {
      println(`\n  ${c.dim}Cancelled. No files written.${c.reset}\n`);
      this.rl.close();
      return;
    }

    // ── 6. Write Files ───────────────────────────────

    this.section('Writing Files');

    // Check for existing files
    const configPath = path.resolve(process.cwd(), 'mach6.json');
    const envPath = path.resolve(process.cwd(), '.env');

    if (fs.existsSync(configPath)) {
      const overwrite = await this.confirm('mach6.json already exists. Overwrite?', false);
      if (!overwrite) {
        println(`  ${c.dim}Skipping mach6.json${c.reset}`);
      } else {
        this.writeConfig(configPath, config);
      }
    } else {
      this.writeConfig(configPath, config);
    }

    if (fs.existsSync(envPath)) {
      const overwrite = await this.confirm('.env already exists. Overwrite?', false);
      if (!overwrite) {
        println(`  ${c.dim}Skipping .env${c.reset}`);
      } else {
        this.writeEnv(envPath, config);
      }
    } else {
      this.writeEnv(envPath, config);
    }

    // ── Done ─────────────────────────────────────────

    println();
    println(`${c.bold}${c.green}  ✓ Setup complete!${c.reset}`);
    println();
    println(`  ${c.dim}Next steps:${c.reset}`);
    println(`    1. Review ${c.cyan}mach6.json${c.reset} and ${c.cyan}.env${c.reset}`);
    println(`    2. Build:  ${c.cyan}npm run build${c.reset}`);
    println(`    3. Start:  ${c.cyan}node dist/gateway/daemon.js --config=mach6.json${c.reset}`);
    if (config.whatsapp.enabled) {
      println(`    4. Scan the WhatsApp QR code on first boot`);
    }
    println();

    this.rl.close();
  }

  // ── File Writers ────────────────────────────────────

  private writeConfig(filepath: string, config: WizardConfig): void {
    const json: Record<string, unknown> = {
      defaultProvider: config.provider,
      defaultModel: config.model,
      maxTokens: config.maxTokens,
      maxIterations: config.maxIterations,
      temperature: config.temperature,
      workspace: config.workspace,
      sessionsDir: '.sessions',
      providers: {
        'github-copilot': {},
        'anthropic': {},
        'openai': {},
        'gladius': { baseUrl: 'http://127.0.0.1:8741' },
      },
      ownerIds: config.ownerIds,
      apiPort: config.apiPort,
    };

    if (config.discord.enabled) {
      json.discord = {
        enabled: true,
        token: '${DISCORD_BOT_TOKEN}',
        botId: config.discord.botId || '${DISCORD_CLIENT_ID}',
        siblingBotIds: config.discord.siblingBotIds,
        policy: {
          dmPolicy: config.dmPolicy,
          groupPolicy: config.groupPolicy,
          requireMention: config.groupPolicy === 'mention-only',
          allowedSenders: config.ownerIds.filter(id => !id.includes('@')),
          allowedGroups: [],
        },
      };
    } else {
      json.discord = { enabled: false };
    }

    if (config.whatsapp.enabled) {
      json.whatsapp = {
        enabled: true,
        authDir: config.whatsapp.authDir,
        phoneNumber: config.whatsapp.phoneNumber,
        autoRead: true,
        policy: {
          dmPolicy: config.dmPolicy,
          groupPolicy: config.groupPolicy,
          allowedSenders: config.ownerIds.filter(id => id.includes('@')),
          allowedGroups: [],
        },
      };
    } else {
      json.whatsapp = { enabled: false };
    }

    fs.writeFileSync(filepath, JSON.stringify(json, null, 2) + '\n');
    this.done(`Config saved to ${filepath}`);
  }

  private writeEnv(filepath: string, config: WizardConfig): void {
    const lines: string[] = [
      '# Mach6 — Environment Variables',
      '# Generated by `mach6 init`',
      '',
    ];

    // Provider keys
    if (config.provider === 'anthropic' && config.apiKey) {
      lines.push(`ANTHROPIC_API_KEY=${config.apiKey}`);
    } else {
      lines.push('# ANTHROPIC_API_KEY=');
    }

    if (config.provider === 'openai' && config.apiKey) {
      lines.push(`OPENAI_API_KEY=${config.apiKey}`);
    } else {
      lines.push('# OPENAI_API_KEY=');
    }

    lines.push('');

    // Discord
    if (config.discord.enabled) {
      lines.push(`DISCORD_BOT_TOKEN=${config.discord.token}`);
      if (config.discord.botId) lines.push(`DISCORD_CLIENT_ID=${config.discord.botId}`);
    } else {
      lines.push('# DISCORD_BOT_TOKEN=');
      lines.push('# DISCORD_CLIENT_ID=');
    }

    lines.push('');

    // API
    lines.push(`MACH6_API_KEY=${config.apiSecret}`);
    lines.push(`MACH6_PORT=${config.apiPort}`);

    lines.push('');

    fs.writeFileSync(filepath, lines.join('\n') + '\n');
    this.done(`.env saved to ${filepath}`);
  }
}

// ── Entry Point ──────────────────────────────────────────────

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
