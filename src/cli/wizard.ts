/**
 * Mach6 CLI Config Wizard
 * Interactive first-time setup — generates mach6.json + .env
 * 
 * Built by Artifact Virtual.
 */

import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import {
  palette, gradient, multiGradient, banner, logo, tagline,
  box, sectionHeader, ok, warn, fail, info, step, kvLine,
  divider, thickDivider, progressBar, versionBanner,
} from './brand.js';

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
  { id: 'github-copilot', name: 'GitHub Copilot', detail: 'auto-auth via gh CLI', defaultModel: 'claude-sonnet-4', needsKey: false, icon: '◈' },
  { id: 'anthropic', name: 'Anthropic', detail: 'Claude models', defaultModel: 'claude-sonnet-4-20250514', needsKey: true, icon: '◉' },
  { id: 'openai', name: 'OpenAI', detail: 'GPT-4o / o3', defaultModel: 'gpt-4o', needsKey: true, icon: '◎' },
  { id: 'gladius', name: 'Gladius', detail: 'local model', defaultModel: 'gladius-125m', needsKey: false, icon: '◇' },
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
  { id: 'allowlist', name: 'Allowlist', detail: 'only specified senders' },
  { id: 'open', name: 'Open', detail: 'respond to everyone' },
];

const GROUP_POLICIES = [
  { id: 'mention-only', name: 'Mention-only', detail: 'respond when @mentioned' },
  { id: 'allowlist', name: 'Allowlist', detail: 'allowed senders in allowed groups' },
  { id: 'off', name: 'Disabled', detail: 'ignore all group messages' },
];

const WIZARD_STEPS = ['Provider', 'Channels', 'Access', 'Workspace', 'Review'];

// ── Wizard Class ─────────────────────────────────────────────

class Wizard {
  private rl: readline.Interface;
  private currentStep = 0;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  private print(msg: string): void { process.stdout.write(msg); }
  private println(msg = ''): void { console.log(msg); }

  // ── Step Progress ───────────────────────────────────

  private stepProgress(): string {
    return WIZARD_STEPS.map((s, i) => {
      if (i < this.currentStep) return `${palette.green}● ${s}${palette.reset}`;
      if (i === this.currentStep) return `${palette.bold}${palette.cyan}◉ ${s}${palette.reset}`;
      return `${palette.dim}○ ${s}${palette.reset}`;
    }).join(`${palette.dark}  ─  ${palette.reset}`);
  }

  // ── Input Methods ───────────────────────────────────

  private ask(prompt: string, defaultVal?: string): Promise<string> {
    const hint = defaultVal ? ` ${palette.dim_attr}${palette.dim}(${defaultVal})${palette.reset}` : '';
    const arrow = `${palette.violet}❯${palette.reset}`;
    return new Promise(resolve => {
      this.rl.question(`  ${arrow} ${palette.bold}${palette.white}${prompt}${palette.reset}${hint} `, answer => {
        resolve(answer.trim() || defaultVal || '');
      });
    });
  }

  private async askMasked(prompt: string): Promise<string> {
    const arrow = `${palette.violet}❯${palette.reset}`;
    return new Promise(resolve => {
      this.print(`  ${arrow} ${palette.bold}${palette.white}${prompt}${palette.reset} `);
      let value = '';
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      if (stdin.isTTY) stdin.setRawMode(true);

      const onData = (buf: Buffer): void => {
        const ch = buf.toString();
        if (ch === '\r' || ch === '\n') {
          stdin.removeListener('data', onData);
          if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
          this.println();
          resolve(value);
        } else if (ch === '\x7f' || ch === '\b') {
          if (value.length > 0) { value = value.slice(0, -1); this.print('\b \b'); }
        } else if (ch === '\x03') { this.println(); process.exit(0); }
        else if (ch.charCodeAt(0) >= 32) { value += ch; this.print(`${palette.gold}•${palette.reset}`); }
      };
      stdin.on('data', onData);
    });
  }

  private async selectOne(prompt: string, choices: { id: string; name: string; detail?: string }[]): Promise<string> {
    if (!process.stdin.isTTY) {
      this.println(`  ${palette.violet}❯${palette.reset} ${palette.bold}${prompt}${palette.reset}`);
      choices.forEach((ch, i) => this.println(`    ${palette.silver}${i + 1}.${palette.reset} ${ch.name}${ch.detail ? ` ${palette.dim}— ${ch.detail}${palette.reset}` : ''}`));
      const answer = await this.ask(`  Enter number (1-${choices.length}):`);
      const idx = parseInt(answer, 10) - 1;
      return choices[Math.max(0, Math.min(idx, choices.length - 1))].id;
    }

    return new Promise(resolve => {
      let selected = 0;
      const render = (): void => {
        this.print(`\x1b[${choices.length + 1}A`);
        this.println(`  ${palette.violet}❯${palette.reset} ${palette.bold}${palette.white}${prompt}${palette.reset}`);
        choices.forEach((ch, i) => {
          if (i === selected) {
            const name = gradient(ch.name, [0, 229, 255], [138, 43, 226]);
            const detail = ch.detail ? ` ${palette.silver}— ${ch.detail}${palette.reset}` : '';
            this.println(`    ${palette.cyan}▸${palette.reset} ${name}${detail}`);
          } else {
            this.println(`    ${palette.dim}  ${ch.name}${ch.detail ? ` — ${ch.detail}` : ''}${palette.reset}`);
          }
        });
      };

      this.println(`  ${palette.violet}❯${palette.reset} ${palette.bold}${palette.white}${prompt}${palette.reset}`);
      choices.forEach((ch, i) => {
        if (i === selected) {
          const name = gradient(ch.name, [0, 229, 255], [138, 43, 226]);
          const detail = ch.detail ? ` ${palette.silver}— ${ch.detail}${palette.reset}` : '';
          this.println(`    ${palette.cyan}▸${palette.reset} ${name}${detail}`);
        } else {
          this.println(`    ${palette.dim}  ${ch.name}${ch.detail ? ` — ${ch.detail}` : ''}${palette.reset}`);
        }
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
          // Collapse the selector into a single confirmed line
          this.print(`\x1b[${choices.length + 1}A`);
          const confirmed = gradient(choices[selected].name, [0, 229, 255], [138, 43, 226]);
          this.println(`  ${palette.green}✓${palette.reset} ${palette.white}${prompt}${palette.reset} ${confirmed}`);
          for (let i = 0; i < choices.length; i++) this.println('\x1b[2K');
          this.print(`\x1b[${choices.length}A`);
          resolve(choices[selected].id);
        } else if (key === '\x03') { this.println(); process.exit(0); }
      };
      stdin.on('data', onData);
    });
  }

  private async confirm(prompt: string, defaultYes = true): Promise<boolean> {
    const hint = defaultYes
      ? `${palette.green}Y${palette.reset}${palette.dim}/n${palette.reset}`
      : `${palette.dim}y/${palette.reset}${palette.green}N${palette.reset}`;
    const answer = await this.ask(`${prompt} (${hint})`);
    if (answer === '') return defaultYes;
    return answer.toLowerCase().startsWith('y');
  }

  // ── Validation ──────────────────────────────────────

  private validatePort(port: string): boolean {
    const n = parseInt(port, 10);
    return !isNaN(n) && n >= 1 && n <= 65535;
  }

  private validateDiscordToken(token: string): boolean {
    return token.length > 50 && token.split('.').length >= 2;
  }

  private validatePhoneNumber(phone: string): boolean {
    return /^\+?[\d\s\-()]{7,20}$/.test(phone);
  }

  // ── Main Flow ───────────────────────────────────────

  async run(): Promise<void> {
    // ── Banner ────────────────────────────────────────

    this.println();
    this.println(banner());
    this.println();
    this.println(`  ${palette.bold}${gradient('SETUP WIZARD', [255, 193, 37], [255, 160, 0])}${palette.reset}`);
    this.println(tagline());
    this.println();
    this.println(thickDivider());

    const config: WizardConfig = {
      provider: '', model: '', apiKey: '', workspace: process.cwd(),
      temperature: 0.3, maxTokens: 8192, maxIterations: 50, apiPort: 3006,
      apiSecret: crypto.randomBytes(32).toString('hex'),
      discord: { enabled: false, token: '', botId: '', siblingBotIds: [] },
      whatsapp: { enabled: false, phoneNumber: '', authDir: path.join(os.homedir(), '.mach6', 'whatsapp-auth') },
      ownerIds: [], dmPolicy: 'allowlist', groupPolicy: 'mention-only',
    };

    // ── 1. Provider ──────────────────────────────────

    this.currentStep = 0;
    this.println(sectionHeader('LLM Provider'));
    this.println(`  ${this.stepProgress()}`);
    this.println();

    config.provider = await this.selectOne(
      'Default provider:',
      PROVIDERS.map(p => ({ id: p.id, name: `${p.icon} ${p.name}`, detail: p.detail })),
    );
    const provider = PROVIDERS.find(p => p.id === config.provider)!;

    // API Key
    if (provider.needsKey) {
      config.apiKey = await this.askMasked(`API key for ${provider.name}:`);
      if (config.apiKey) this.println(ok('API key set'));
      else this.println(warn(`No API key — set it in .env later`));
    } else if (config.provider === 'github-copilot') {
      this.println(info(`Auto-resolves tokens via ${palette.cyan}\`gh auth login\`${palette.reset}`));
    }

    // Model
    const models = MODELS_BY_PROVIDER[config.provider] || [];
    if (models.length > 1) {
      config.model = await this.selectOne('Model:', models);
    } else {
      config.model = provider.defaultModel;
    }
    this.println(ok(`${palette.white}${provider.name}${palette.reset} ${palette.dim}/${palette.reset} ${palette.cyan}${config.model}${palette.reset}`));

    // ── 2. Channels ──────────────────────────────────

    this.currentStep = 1;
    this.println(sectionHeader('Channels'));
    this.println(`  ${this.stepProgress()}`);
    this.println();

    // Discord
    config.discord.enabled = await this.confirm('Enable Discord?', false);
    if (config.discord.enabled) {
      config.discord.token = await this.askMasked('Discord bot token:');
      if (config.discord.token && !this.validateDiscordToken(config.discord.token)) {
        this.println(warn('Token looks short — make sure it\'s correct'));
      }
      config.discord.botId = await this.ask('Discord bot (client) ID:');
      const siblings = await this.ask('Sibling bot IDs (comma-separated, or blank):');
      if (siblings) config.discord.siblingBotIds = siblings.split(',').map(s => s.trim()).filter(Boolean);
      this.println(ok(`Discord ${palette.green}enabled${palette.reset}`));
    } else {
      this.println(info(`Discord ${palette.dim}skipped${palette.reset}`));
    }

    this.println();

    // WhatsApp
    config.whatsapp.enabled = await this.confirm('Enable WhatsApp?', false);
    if (config.whatsapp.enabled) {
      config.whatsapp.phoneNumber = await this.ask('Your phone number (with country code):');
      if (config.whatsapp.phoneNumber && !this.validatePhoneNumber(config.whatsapp.phoneNumber)) {
        this.println(warn('Phone format looks unusual — expected: +1234567890'));
      }
      const authDefault = config.whatsapp.authDir.replace(/\\/g, '/');
      const authAnswer = await this.ask('WhatsApp auth directory:', authDefault);
      config.whatsapp.authDir = authAnswer;
      this.println(info(`Scan QR code on first start`));
      this.println(ok(`WhatsApp ${palette.green}enabled${palette.reset}`));
    } else {
      this.println(info(`WhatsApp ${palette.dim}skipped${palette.reset}`));
    }

    if (!config.discord.enabled && !config.whatsapp.enabled) {
      this.println();
      this.println(info(`No channels — CLI and Web UI still work`));
    }

    // ── 3. Owner & Policies ──────────────────────────

    this.currentStep = 2;
    this.println(sectionHeader('Access Control'));
    this.println(`  ${this.stepProgress()}`);
    this.println();

    const ownerInput = await this.ask('Owner IDs (comma-separated Discord IDs / phone@s.whatsapp.net):');
    config.ownerIds = ownerInput ? ownerInput.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (config.ownerIds.length === 0) {
      this.println(warn('No owner IDs — agent won\'t respond on channels'));
    } else {
      this.println(ok(`${palette.white}${config.ownerIds.length}${palette.reset} owner(s) configured`));
    }

    const customPolicies = await this.confirm('Customize channel policies?', false);
    if (customPolicies) {
      config.dmPolicy = await this.selectOne('DM policy:', POLICIES);
      config.groupPolicy = await this.selectOne('Group policy:', GROUP_POLICIES);
    }
    this.println(ok(`DM: ${palette.cyan}${config.dmPolicy}${palette.reset} ${palette.dim}|${palette.reset} Group: ${palette.cyan}${config.groupPolicy}${palette.reset}`));

    // ── 4. Workspace & Server ────────────────────────

    this.currentStep = 3;
    this.println(sectionHeader('Workspace'));
    this.println(`  ${this.stepProgress()}`);
    this.println();

    const wsDefault = process.cwd().replace(/\\/g, '/');
    const wsAnswer = await this.ask('Workspace directory:', wsDefault);
    config.workspace = wsAnswer;
    if (process.platform === 'win32') {
      this.println(info('Tip: use forward slashes — "C:/Users/you/workspace"'));
    }

    const portAnswer = await this.ask('API + Web UI port:', '3006');
    if (this.validatePort(portAnswer)) {
      config.apiPort = parseInt(portAnswer, 10);
    } else {
      this.println(warn('Invalid port, using default 3006'));
    }
    this.println(ok(`${palette.cyan}${config.workspace}${palette.reset} ${palette.dim}:${palette.reset}${palette.gold}${config.apiPort}${palette.reset}`));

    // ── 5. Summary ───────────────────────────────────

    this.currentStep = 4;
    this.println(sectionHeader('Review'));
    this.println(`  ${this.stepProgress()}`);
    this.println();

    const summaryLines = [
      kvLine('Provider', `${palette.cyan}${provider.name}${palette.reset} ${palette.dim}/${palette.reset} ${palette.white}${config.model}${palette.reset}`),
      kvLine('Discord', config.discord.enabled ? `${palette.green}● enabled${palette.reset}` : `${palette.dim}○ disabled${palette.reset}`),
      kvLine('WhatsApp', config.whatsapp.enabled ? `${palette.green}● enabled${palette.reset}` : `${palette.dim}○ disabled${palette.reset}`),
      kvLine('Owners', config.ownerIds.length > 0 ? `${palette.white}${config.ownerIds.join(', ')}${palette.reset}` : `${palette.dim}none${palette.reset}`),
      kvLine('Workspace', `${palette.cyan}${config.workspace}${palette.reset}`),
      kvLine('Port', `${palette.gold}${config.apiPort}${palette.reset}`),
      kvLine('DM Policy', `${palette.white}${config.dmPolicy}${palette.reset}`),
      kvLine('Group Policy', `${palette.white}${config.groupPolicy}${palette.reset}`),
    ];

    this.println(box(summaryLines, {
      borderColor: palette.violet,
      title: gradient('CONFIGURATION', [255, 193, 37], [255, 160, 0]),
      width: 58,
    }));
    this.println();

    const proceed = await this.confirm('Write configuration files?', true);
    if (!proceed) {
      this.println();
      this.println(info('Cancelled. No files written.'));
      this.println();
      this.rl.close();
      return;
    }

    // ── 6. Write Files ───────────────────────────────

    this.println(sectionHeader('Writing Files'));

    const configPath = path.resolve(process.cwd(), 'mach6.json');
    const envPath = path.resolve(process.cwd(), '.env');

    if (fs.existsSync(configPath)) {
      const overwrite = await this.confirm('mach6.json already exists. Overwrite?', false);
      if (!overwrite) {
        this.println(info('Skipping mach6.json'));
      } else {
        this.writeConfig(configPath, config);
      }
    } else {
      this.writeConfig(configPath, config);
    }

    if (fs.existsSync(envPath)) {
      const overwrite = await this.confirm('.env already exists. Overwrite?', false);
      if (!overwrite) {
        this.println(info('Skipping .env'));
      } else {
        this.writeEnv(envPath, config);
      }
    } else {
      this.writeEnv(envPath, config);
    }

    // ── Done ─────────────────────────────────────────

    this.println();
    this.println(thickDivider());
    this.println();

    const doneMsg = gradient('SETUP COMPLETE', [0, 230, 118], [0, 188, 212]);
    this.println(`  ${palette.bold}${palette.green}⚡${palette.reset} ${palette.bold}${doneMsg}${palette.reset}`);
    this.println();

    const nextSteps = [
      `${palette.dim}1.${palette.reset} Review ${palette.cyan}mach6.json${palette.reset} and ${palette.cyan}.env${palette.reset}`,
      `${palette.dim}2.${palette.reset} Build:  ${palette.gold}npm run build${palette.reset}`,
      `${palette.dim}3.${palette.reset} Start:  ${palette.gold}node dist/gateway/daemon.js --config=mach6.json${palette.reset}`,
    ];
    if (config.whatsapp.enabled) {
      nextSteps.push(`${palette.dim}4.${palette.reset} Scan the WhatsApp QR code on first boot`);
    }

    this.println(box(nextSteps, {
      borderColor: palette.teal,
      title: gradient('NEXT STEPS', [0, 229, 255], [0, 188, 212]),
      width: 60,
    }));
    this.println();
    this.println(tagline());
    this.println();

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
    this.println(ok(`Config saved to ${palette.cyan}${filepath}${palette.reset}`));
  }

  private writeEnv(filepath: string, config: WizardConfig): void {
    const lines: string[] = [
      '# ⚡ Mach6 — Environment Variables',
      '# Generated by `mach6 init` · Artifact Virtual',
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
    this.println(ok(`.env saved to ${palette.cyan}${filepath}${palette.reset}`));
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
