/**
 * Mach6 Web UI Server
 * Zero dependencies — native Node.js http + SSE streaming
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ── Types ──────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  name: string;
  systemPrompt: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  tokensUsed: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  toolCalls?: ToolCall[];
}

interface ToolCall {
  id: string;
  name: string;
  input: string;
  output?: string;
  status: 'running' | 'done' | 'error';
  startedAt: number;
  finishedAt?: number;
}

interface Config {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiKeys: Record<string, string>;
}

interface SubAgent {
  id: string;
  label: string;
  status: 'running' | 'done' | 'killed';
  startedAt: number;
}

// ── State ──────────────────────────────────────────────────────────────────

const startTime = Date.now();
const sessions = new Map<string, Session>();
const subAgents: SubAgent[] = [];
let totalTokens = 0;

let config: Config = {
  provider: 'anthropic',
  model: 'claude-opus-4-6',
  temperature: 0.7,
  maxTokens: 8192,
  apiKeys: {},
};

// Load config from mach6.json if exists
const configPath = path.resolve(process.cwd(), 'mach6.json');
try {
  const raw = fs.readFileSync(configPath, 'utf-8');
  const loaded = JSON.parse(raw);
  config = { ...config, ...loaded };
} catch { /* no config file yet */ }

// ── Helpers ────────────────────────────────────────────────────────────────

function uid(): string {
  return crypto.randomUUID();
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function redactKeys(keys: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(keys)) {
    out[k] = v ? v.slice(0, 6) + '•'.repeat(Math.max(0, v.length - 10)) + v.slice(-4) : '';
  }
  return out;
}

function matchRoute(pattern: string, pathname: string): Record<string, string> | null {
  const patParts = pattern.split('/');
  const urlParts = pathname.split('/');
  if (patParts.length !== urlParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i].startsWith(':')) {
      params[patParts[i].slice(1)] = urlParts[i];
    } else if (patParts[i] !== urlParts[i]) {
      return null;
    }
  }
  return params;
}

// ── Providers (simulated for now — will integrate real APIs) ───────────────

const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-haiku-20241022'] },

  { id: 'github-copilot', name: 'GitHub Copilot', models: ['claude-opus-4-6', 'claude-sonnet-4-20250514', 'gpt-4o', 'o3-mini'] },
  { id: 'gladius', name: 'Local (Gladius)', models: ['gladius-125m', 'gladius-1b'] },
];

const TOOLS = [
  { name: 'read', description: 'Read file contents' },
  { name: 'write', description: 'Create or overwrite files' },
  { name: 'edit', description: 'Make precise edits to files' },
  { name: 'exec', description: 'Run shell commands' },
  { name: 'web_fetch', description: 'Fetch URL content' },
  { name: 'browser', description: 'Control web browser' },
  { name: 'image', description: 'Analyze images' },
];

// ── Simulated chat streaming ───────────────────────────────────────────────

async function streamChat(
  res: http.ServerResponse,
  sessionId: string,
  userMessage: string
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    json(res, { error: 'Session not found' }, 404);
    return;
  }

  // Add user message
  const userMsg: Message = {
    id: uid(),
    role: 'user',
    content: userMessage,
    timestamp: Date.now(),
    tokensIn: Math.ceil(userMessage.length / 4),
  };
  session.messages.push(userMsg);

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const startMs = Date.now();

  // Simulate tool call for certain keywords
  const assistantId = uid();
  const toolCalls: ToolCall[] = [];

  if (userMessage.toLowerCase().includes('file') || userMessage.toLowerCase().includes('read')) {
    const tc: ToolCall = {
      id: uid(),
      name: 'read',
      input: JSON.stringify({ path: 'example.ts' }),
      status: 'running',
      startedAt: Date.now(),
    };
    toolCalls.push(tc);
    res.write(`data: ${JSON.stringify({ type: 'tool_start', toolCall: tc })}\n\n`);
    await delay(500);
    tc.status = 'done';
    tc.output = '// example file content\nexport const hello = "world";';
    tc.finishedAt = Date.now();
    res.write(`data: ${JSON.stringify({ type: 'tool_end', toolCall: tc })}\n\n`);
  }

  if (userMessage.toLowerCase().includes('run') || userMessage.toLowerCase().includes('exec')) {
    const tc: ToolCall = {
      id: uid(),
      name: 'exec',
      input: JSON.stringify({ command: 'echo "Hello from Mach6"' }),
      status: 'running',
      startedAt: Date.now(),
    };
    toolCalls.push(tc);
    res.write(`data: ${JSON.stringify({ type: 'tool_start', toolCall: tc })}\n\n`);
    await delay(400);
    tc.status = 'done';
    tc.output = 'Hello from Mach6';
    tc.finishedAt = Date.now();
    res.write(`data: ${JSON.stringify({ type: 'tool_end', toolCall: tc })}\n\n`);
  }

  // Simulate streaming response
  const response = generateResponse(userMessage);
  let fullContent = '';

  for (let i = 0; i < response.length; i++) {
    const chunk = response[i];
    fullContent += chunk;
    res.write(`data: ${JSON.stringify({ type: 'text', content: chunk, id: assistantId })}\n\n`);
    await delay(15 + Math.random() * 25);
  }

  const latency = Date.now() - startMs;
  const tokensOut = Math.ceil(fullContent.length / 4);
  totalTokens += (userMsg.tokensIn ?? 0) + tokensOut;
  session.tokensUsed += (userMsg.tokensIn ?? 0) + tokensOut;

  const assistantMsg: Message = {
    id: assistantId,
    role: 'assistant',
    content: fullContent,
    timestamp: Date.now(),
    tokensIn: userMsg.tokensIn,
    tokensOut,
    latencyMs: latency,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
  session.messages.push(assistantMsg);
  session.updatedAt = Date.now();

  res.write(`data: ${JSON.stringify({ type: 'done', message: assistantMsg })}\n\n`);
  res.end();
}

function generateResponse(input: string): string {
  const responses = [
    `I understand you're asking about **${input.split(' ').slice(0, 3).join(' ')}**. Let me help with that.\n\nHere's what I can tell you:\n\n1. The system is running smoothly\n2. All components are operational\n3. Memory usage is within normal parameters\n\n\`\`\`typescript\n// Example code block\nconst status = await checkSystem();\nconsole.log(status);\n\`\`\`\n\nLet me know if you need anything else.`,
    `Great question! Here's a detailed breakdown:\n\n**Key Points:**\n- Mach6 is running in sovereign mode\n- All providers are configured\n- Zero external dependencies\n\n> "The best code is no code at all." — Someone wise\n\nWould you like me to elaborate on any of these points?`,
    `Processing your request...\n\nI've analyzed the situation and here's my assessment:\n\n### Summary\nEverything looks good. The architecture is clean, the performance is solid, and the codebase is maintainable.\n\n### Details\n- **Latency:** < 100ms p99\n- **Memory:** 45MB RSS\n- **Uptime:** 99.97%\n\n\`\`\`json\n{\n  "status": "healthy",\n  "version": "0.1.0",\n  "engine": "mach6"\n}\n\`\`\``,
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Serve static files ─────────────────────────────────────────────────────

function serveStatic(res: http.ServerResponse, filePath: string): void {
  const ext = path.extname(filePath);
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}

// ── Router ─────────────────────────────────────────────────────────────────

const WEB_DIR = path.resolve(import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url)), '../../web');

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // ── API Routes ─────────────────────────────────────────────────────────

  // GET /api/status
  if (method === 'GET' && pathname === '/api/status') {
    return json(res, {
      uptime: Date.now() - startTime,
      uptimeHuman: formatUptime(Date.now() - startTime),
      sessions: sessions.size,
      totalTokens,
      model: config.model,
      provider: config.provider,
      version: '0.1.0',
    });
  }

  // GET /api/providers
  if (method === 'GET' && pathname === '/api/providers') {
    return json(res, PROVIDERS);
  }

  // GET /api/tools
  if (method === 'GET' && pathname === '/api/tools') {
    return json(res, TOOLS);
  }

  // GET /api/config
  if (method === 'GET' && pathname === '/api/config') {
    return json(res, { ...config, apiKeys: redactKeys(config.apiKeys) });
  }

  // PUT /api/config
  if (method === 'PUT' && pathname === '/api/config') {
    const body = JSON.parse(await readBody(req));
    config = { ...config, ...body };
    // Don't overwrite keys with redacted versions
    if (body.apiKeys) {
      for (const [k, v] of Object.entries(body.apiKeys as Record<string, string>)) {
        if (v && !v.includes('•')) config.apiKeys[k] = v;
      }
    }
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch { /* ignore */ }
    return json(res, { ok: true });
  }

  // GET /api/sessions
  if (method === 'GET' && pathname === '/api/sessions') {
    const list = Array.from(sessions.values()).map(s => ({
      id: s.id,
      name: s.name,
      messageCount: s.messages.length,
      lastMessage: s.messages.length > 0
        ? s.messages[s.messages.length - 1].content.slice(0, 100)
        : '',
      tokensUsed: s.tokensUsed,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    return json(res, list);
  }

  // POST /api/sessions
  if (method === 'POST' && pathname === '/api/sessions') {
    const body = JSON.parse(await readBody(req) || '{}');
    const session: Session = {
      id: uid(),
      name: body.name || `Session ${sessions.size + 1}`,
      systemPrompt: body.systemPrompt || '',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tokensUsed: 0,
    };
    if (session.systemPrompt) {
      session.messages.push({
        id: uid(),
        role: 'system',
        content: session.systemPrompt,
        timestamp: Date.now(),
      });
    }
    sessions.set(session.id, session);
    return json(res, session, 201);
  }

  // DELETE /api/sessions/:id
  let params = matchRoute('/api/sessions/:id', pathname);
  if (method === 'DELETE' && params) {
    sessions.delete(params.id);
    return json(res, { ok: true });
  }

  // GET /api/sessions/:id/messages
  params = matchRoute('/api/sessions/:id/messages', pathname);
  if (method === 'GET' && params) {
    const session = sessions.get(params.id);
    if (!session) return json(res, { error: 'Not found' }, 404);
    return json(res, session.messages);
  }

  // POST /api/chat
  if (method === 'POST' && pathname === '/api/chat') {
    const body = JSON.parse(await readBody(req));
    const { sessionId, message } = body;
    if (!sessionId || !message) return json(res, { error: 'sessionId and message required' }, 400);
    return streamChat(res, sessionId, message);
  }

  // GET /api/agents
  if (method === 'GET' && pathname === '/api/agents') {
    return json(res, subAgents);
  }

  // DELETE /api/agents/:id
  params = matchRoute('/api/agents/:id', pathname);
  if (method === 'DELETE' && params) {
    const agent = subAgents.find(a => a.id === params!.id);
    if (agent) agent.status = 'killed';
    return json(res, { ok: true });
  }

  // ── Static Files ───────────────────────────────────────────────────────

  if (method === 'GET') {
    if (pathname === '/' || pathname === '/index.html') {
      return serveStatic(res, path.join(WEB_DIR, 'index.html'));
    }
    // Serve other static files
    const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    return serveStatic(res, path.join(WEB_DIR, safePath));
  }

  // 404
  json(res, { error: 'Not found' }, 404);
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ── Server ─────────────────────────────────────────────────────────────────

export function startWebServer(port = 3006): http.Server {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(err => {
      console.error('[mach6-web]', err);
      if (!res.headersSent) {
        json(res, { error: 'Internal server error' }, 500);
      }
    });
  });

  // Create a default session
  const defaultSession: Session = {
    id: uid(),
    name: 'Default Session',
    systemPrompt: '',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tokensUsed: 0,
  };
  sessions.set(defaultSession.id, defaultSession);

  server.listen(port, () => {
    console.log(`\n  ⚡ Mach6 Web UI → http://localhost:${port}\n`);
  });

  return server;
}

// Run directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('web/server.js')) {
  const port = parseInt(process.env.MACH6_PORT ?? '3006', 10);
  startWebServer(port);
}
