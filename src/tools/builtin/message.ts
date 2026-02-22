// Mach6 — Builtin tool: proactive messaging
// Send messages, media, and reactions to any connected channel.
// This is what makes AVA proactive instead of just reactive.

import type { ToolDefinition } from '../types.js';
import type { ChannelRegistry } from '../../channels/registry.js';
import type { OutboundMessage, MediaPayload } from '../../channels/types.js';

/** Factory — needs registry reference from daemon */
export function createMessageTool(registry: ChannelRegistry): ToolDefinition {
  return {
    name: 'message',
    description: [
      'Send a message to a chat on any connected channel (WhatsApp, Discord).',
      'Can send text, media (images/audio/docs), and reactions.',
      'Use this to proactively reach out, send files, or react to messages.',
      'For reactions, set action="react" with emoji and messageId.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'Channel type: "whatsapp" or "discord"',
          enum: ['whatsapp', 'discord'],
        },
        chatId: {
          type: 'string',
          description: 'Chat/channel ID. WhatsApp: "1234567890@s.whatsapp.net" or group JID. Discord: channel ID.',
        },
        content: {
          type: 'string',
          description: 'Text message content. Required unless sending a reaction.',
        },
        action: {
          type: 'string',
          description: 'Action type: "send" (default) or "react"',
          enum: ['send', 'react'],
        },
        replyToId: {
          type: 'string',
          description: 'Message ID to reply to (optional)',
        },
        media: {
          type: 'object',
          description: 'Media attachment. Properties: type ("image"|"audio"|"video"|"document"|"voice"|"sticker"), path (local file path or URL), caption (optional)',
          properties: {
            type: { type: 'string' },
            path: { type: 'string' },
            caption: { type: 'string' },
            filename: { type: 'string' },
          },
        },
        emoji: {
          type: 'string',
          description: 'Emoji for reactions (when action="react")',
        },
        messageId: {
          type: 'string',
          description: 'Target message ID for reactions (when action="react")',
        },
      },
      required: ['channel', 'chatId'],
    },
    async execute(input) {
      const channel = input.channel as string;
      const chatId = input.chatId as string;
      const action = (input.action as string) ?? 'send';
      const content = input.content as string | undefined;
      const replyToId = input.replyToId as string | undefined;
      const emoji = input.emoji as string | undefined;
      const messageId = input.messageId as string | undefined;

      // Find the adapter for this channel type
      const adapters = registry.list();
      const target = adapters.find(a => a.channelType === channel && a.status === 'running');
      if (!target) {
        return JSON.stringify({ error: `No running adapter for channel "${channel}". Available: ${adapters.map(a => `${a.channelType}(${a.status})`).join(', ')}` });
      }

      // ── Reaction ──
      if (action === 'react') {
        if (!emoji) return JSON.stringify({ error: 'emoji is required for reactions' });
        if (!messageId) return JSON.stringify({ error: 'messageId is required for reactions' });

        const adapter = registry.get(target.id);
        if (!adapter) return JSON.stringify({ error: 'Adapter not found' });

        if (typeof (adapter as any).react === 'function') {
          try {
            await (adapter as any).react(chatId, messageId, emoji);
            return JSON.stringify({ success: true, action: 'react', emoji, messageId });
          } catch (err) {
            return JSON.stringify({ error: `Reaction failed: ${err instanceof Error ? err.message : String(err)}` });
          }
        }
        return JSON.stringify({ error: `Adapter "${channel}" does not support reactions` });
      }

      // ── Send message ──
      if (!content && !input.media) {
        return JSON.stringify({ error: 'Either content or media is required for sending' });
      }

      const outbound: OutboundMessage = {
        content: content ?? '',
        replyToId,
      };

      // Attach media if provided
      if (input.media) {
        const m = input.media as Record<string, unknown>;
        const mediaPayload: MediaPayload = {
          type: (m.type as MediaPayload['type']) ?? 'document',
          caption: m.caption as string | undefined,
          filename: m.filename as string | undefined,
        };

        const mediaPath = m.path as string;
        if (mediaPath?.startsWith('http://') || mediaPath?.startsWith('https://')) {
          mediaPayload.url = mediaPath;
        } else if (mediaPath) {
          mediaPayload.path = mediaPath;
        }

        outbound.media = [mediaPayload];
      }

      try {
        const result = await registry.sendToChannel(channel, chatId, outbound);
        return JSON.stringify({
          success: true,
          action: 'send',
          channel,
          chatId,
          messageId: (result as any)?.messageId,
          ...(outbound.media ? { mediaAttached: true } : {}),
        });
      } catch (err) {
        return JSON.stringify({ error: `Send failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    },
  };
}
