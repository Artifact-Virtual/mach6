// Mach6 — Builtin tool: text-to-speech

import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition } from '../types.js';

const TTS_OUTPUT_DIR = '/tmp/mach6-tts';

export const ttsTool: ToolDefinition = {
  name: 'tts',
  description: 'Convert text to speech using OpenAI TTS API. Returns the path to the generated audio file.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to convert to speech' },
      voice: { type: 'string', description: 'Voice to use (alloy, echo, fable, onyx, nova, shimmer). Default: nova', enum: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] },
      model: { type: 'string', description: 'TTS model (tts-1 or tts-1-hd). Default: tts-1' },
      speed: { type: 'number', description: 'Speed multiplier (0.25 to 4.0). Default: 1.0' },
    },
    required: ['text'],
  },
  async execute(input) {
    const text = input.text as string;
    const voice = (input.voice as string) ?? 'nova';
    const model = (input.model as string) ?? 'tts-1';
    const speed = (input.speed as number) ?? 1.0;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return 'Error: OPENAI_API_KEY not set';

    try {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, input: text, voice, speed, response_format: 'mp3' }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const errText = await res.text();
        return `Error: OpenAI TTS API returned ${res.status}: ${errText}`;
      }

      fs.mkdirSync(TTS_OUTPUT_DIR, { recursive: true });
      const filename = `tts-${Date.now()}.mp3`;
      const filepath = path.join(TTS_OUTPUT_DIR, filename);
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(filepath, buffer);

      return JSON.stringify({ path: filepath, size: buffer.length, voice, model });
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
