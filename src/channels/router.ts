/**
 * Mach6 — Inbound Router
 * 
 * Sits between channel adapters and the message bus.
 * Handles: policy enforcement, session routing, priority assignment,
 * deduplication, interrupt detection.
 */

import { randomUUID } from 'node:crypto';
import type {
  BusEnvelope,
  ChannelPolicy,
  ChannelSource,
  InboundPayload,
  MessagePriority,
  SessionRoute,
} from './types.js';
import type { Mach6Bus } from './bus.js';

// ─── WhatsApp JID Normalization ────────────────────────────────────────────
// Baileys v7 uses JIDs with device suffix: "1234567890:5@s.whatsapp.net"
// Config stores them without suffix: "1234567890@s.whatsapp.net"
// Normalize by stripping the device part before comparison.

function normalizeJid(jid: string): string {
  // Strip device suffix from WhatsApp JIDs: "num:device@s.whatsapp.net" → "num@s.whatsapp.net"
  return jid.replace(/:\d+@s\.whatsapp\.net$/, '@s.whatsapp.net');
}

function jidMatches(jid: string, target: string): boolean {
  return normalizeJid(jid) === normalizeJid(target);
}

function jidInList(jid: string, list: string[]): boolean {
  const normalized = normalizeJid(jid);
  return list.some(item => normalizeJid(item) === normalized);
}

// ─── Interrupt Detection ───────────────────────────────────────────────────

const INTERRUPT_PATTERNS = [
  /^(stop|wait|hold on|pause|cancel|actually|never ?mind)/i,
  /^(no[,.]?\s|don'?t\s|abort)/i,
  /^(scratch that|forget it|hold up)/i,
];

// ─── Deduplication ─────────────────────────────────────────────────────────

class DeduplicationCache {
  private seen = new Map<string, number>(); // messageId → timestamp
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize = 10_000, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /** Returns true if this is a duplicate */
  check(id: string): boolean {
    const now = Date.now();
    this.evict(now);

    if (this.seen.has(id)) return true;
    this.seen.set(id, now);
    return false;
  }

  private evict(now: number): void {
    if (this.seen.size < this.maxSize) return;
    // Remove expired entries
    for (const [id, ts] of this.seen) {
      if (now - ts > this.ttlMs) this.seen.delete(id);
    }
    // If still over, remove oldest
    if (this.seen.size >= this.maxSize) {
      const oldest = this.seen.keys().next().value;
      if (oldest) this.seen.delete(oldest);
    }
  }
}

// ─── Router ────────────────────────────────────────────────────────────────

export interface RouterConfig {
  /** Policy per channel type */
  policies: Map<string, ChannelPolicy>;
  /** Default policy if no channel-specific one exists */
  defaultPolicy?: ChannelPolicy;
  /** Global owner IDs — always allowed on any channel */
  globalOwnerIds?: string[];
  /** Active session tracking — which sessions have an agent turn in progress */
  getActiveSessions?: () => Set<string>;
}

export class InboundRouter {
  private bus: Mach6Bus;
  private config: RouterConfig;
  private dedup = new DeduplicationCache();
  private routes = new Map<string, SessionRoute>(); // "channelType:chatId" → route
  private sessionCounter = 0;

  constructor(bus: Mach6Bus, config: RouterConfig) {
    this.bus = bus;
    this.config = config;
  }

  /**
   * Route an inbound message from a channel adapter.
   * Returns false if the message was rejected by policy.
   */
  route(source: ChannelSource, payload: InboundPayload, platformMessageId?: string): boolean {
    // 1. Deduplication
    const dedupKey = platformMessageId ?? `${source.adapterId}:${source.chatId}:${Date.now()}`;
    if (this.dedup.check(dedupKey)) return false;

    // 2. Policy check
    const policy = this.getPolicy(source.channelType);
    if (!this.checkPolicy(policy, source)) return false;

    // 3. Resolve session
    const sessionId = this.resolveSession(source);

    // 4. Determine priority
    const priority = this.assignPriority(policy, source, payload, sessionId);

    // 5. Build envelope
    const envelope: BusEnvelope = {
      id: randomUUID(),
      timestamp: Date.now(),
      priority,
      source,
      sessionId,
      payload,
      metadata: {
        platformMessageId,
        guildId: (source as any).guildId,
      },
    };

    // 6. Publish to bus
    this.bus.publish(envelope);
    return true;
  }

  // ── Policy ─────────────────────────────────────────────────────────────

  private getPolicy(channelType: string): ChannelPolicy {
    return this.config.policies.get(channelType) ?? this.config.defaultPolicy ?? {
      dmPolicy: 'deny',
      groupPolicy: 'deny',
      ownerIds: [],
    };
  }

  private checkPolicy(policy: ChannelPolicy, source: ChannelSource): boolean {
    // Sibling bot yield: if message explicitly @mentions a sibling bot but NOT us, yield.
    // This applies even for owners — ensures @Plug → only Plug, @AVA → only AVA.
    // No mention at all → both respond (owner bypass or normal policy applies).
    if (policy.siblingBotIds?.length && policy.selfId && source.mentions?.length) {
      const mentionsMe = source.mentions.includes(policy.selfId);
      const mentionsSibling = source.mentions.some(id => policy.siblingBotIds!.includes(id));
      if (mentionsSibling && !mentionsMe) return false;
    }

    const isOwner = this.isOwner(policy, source.senderId);
    if (isOwner) return true; // Owners bypass all policy

    if (source.chatType === 'dm') {
      switch (policy.dmPolicy) {
        case 'open': return true;
        case 'allowlist': return jidInList(source.senderId, policy.allowedSenders ?? []);
        case 'deny': return false;
      }
    }

    if (source.chatType === 'group' || source.chatType === 'channel') {
      switch (policy.groupPolicy) {
        case 'open': return true;
        case 'allowlist': return jidInList(source.chatId, policy.allowedGroups ?? []);
        case 'mention-only': return this.isMentioned(policy, source);
        case 'deny': return false;
      }
    }

    // Threads inherit parent policy (treat as group)
    if (source.chatType === 'thread') {
      return policy.groupPolicy !== 'deny';
    }

    return false;
  }

  private isOwner(policy: ChannelPolicy, senderId: string): boolean {
    if (jidInList(senderId, policy.ownerIds)) return true;
    if (this.config.globalOwnerIds && jidInList(senderId, this.config.globalOwnerIds)) return true;
    return false;
  }

  private isMentioned(policy: ChannelPolicy, source: ChannelSource): boolean {
    if (!policy.selfId || !source.mentions) return false;
    return source.mentions.includes(policy.selfId);
  }

  // ── Session Resolution ─────────────────────────────────────────────────

  private resolveSession(source: ChannelSource): string {
    const routeKey = `${source.channelType}:${source.chatId}`;
    const existing = this.routes.get(routeKey);

    if (existing) {
      existing.lastActive = Date.now();
      return existing.sessionId;
    }

    // Create new session route
    const sessionId = `${source.channelType}-${source.chatId}-${++this.sessionCounter}`;
    this.routes.set(routeKey, {
      channelType: source.channelType,
      chatId: source.chatId,
      sessionId,
      lastActive: Date.now(),
    });

    return sessionId;
  }

  // ── Priority Assignment ────────────────────────────────────────────────

  private assignPriority(
    policy: ChannelPolicy,
    source: ChannelSource,
    payload: InboundPayload,
    sessionId: string,
  ): MessagePriority {
    // Non-text payloads
    if (payload.type === 'typing' || payload.type === 'presence') return 'background';
    if (payload.type === 'reaction') return 'low';

    const isOwner = this.isOwner(policy, source.senderId);
    const text = payload.text?.trim() ?? '';

    // Check if this session has an active agent turn
    const activeSessions = this.config.getActiveSessions?.() ?? new Set();
    const sessionActive = activeSessions.has(sessionId);

    // Owner message during active turn → interrupt
    if (isOwner && sessionActive) {
      // Check for explicit interrupt patterns
      if (INTERRUPT_PATTERNS.some(p => p.test(text))) {
        return 'interrupt';
      }
      // Owner sending anything during active turn is at least high priority
      // The bus coalesce logic will handle rapid-fire messages
      return 'high';
    }

    // Owner message (no active turn) → high
    if (isOwner) return 'high';

    // DM from non-owner → normal
    if (source.chatType === 'dm') return 'normal';

    // Group mention → normal
    if (source.chatType === 'group' && this.isMentioned(policy, source)) return 'normal';

    // Group without mention → low
    return 'low';
  }

  // ── Route Management ───────────────────────────────────────────────────

  /** Get all active routes */
  getRoutes(): SessionRoute[] {
    return Array.from(this.routes.values());
  }

  /** Get session ID for a channel + chat */
  getSessionId(channelType: string, chatId: string): string | undefined {
    return this.routes.get(`${channelType}:${chatId}`)?.sessionId;
  }

  /** Manually set a route (for restoring state) */
  setRoute(route: SessionRoute): void {
    this.routes.set(`${route.channelType}:${route.chatId}`, route);
  }

  /** Clean up stale routes (not active for given duration) */
  pruneRoutes(maxIdleMs: number): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, route] of this.routes) {
      if (now - route.lastActive > maxIdleMs) {
        this.routes.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  /** Update policy for a channel */
  setPolicy(channelType: string, policy: ChannelPolicy): void {
    this.config.policies.set(channelType, policy);
  }
}
