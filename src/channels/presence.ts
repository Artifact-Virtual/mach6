// Mach6 — Social Presence Manager
// Sustained typing indicators + online/offline presence for all channels.
//
// Problem: WhatsApp typing fires once for 3s then dies. During a 60s agent
// turn, the user sees "typing..." briefly then nothing. Discord typing
// expires after 10s. Both need continuous refresh.
//
// Solution: TypingKeepAlive — starts a periodic typing refresh when the
// agent begins processing, stops when the response is sent.

export interface TypingTarget {
  adapterId: string;
  chatId: string;
}

type TypingFunction = (chatId: string, durationMs?: number) => Promise<void>;

interface ActiveTyping {
  target: TypingTarget;
  interval: ReturnType<typeof setInterval>;
  startedAt: number;
}

export class PresenceManager {
  private activeTyping = new Map<string, ActiveTyping>();
  private typingFunctions = new Map<string, TypingFunction>();

  // How often to refresh typing indicator (ms)
  // WhatsApp composing lasts ~5s, Discord lasts ~10s
  private refreshIntervalMs = 4000;

  // Safety: max typing duration to prevent zombie typing (5 min)
  private maxTypingMs = 5 * 60 * 1000;

  /**
   * Register a typing function for an adapter.
   * Called during adapter setup.
   */
  registerAdapter(adapterId: string, typingFn: TypingFunction): void {
    this.typingFunctions.set(adapterId, typingFn);
  }

  /**
   * Unregister an adapter (on disconnect).
   */
  unregisterAdapter(adapterId: string): void {
    // Stop any active typing for this adapter
    for (const [key, active] of this.activeTyping) {
      if (active.target.adapterId === adapterId) {
        this.stopTyping(active.target);
      }
    }
    this.typingFunctions.delete(adapterId);
  }

  /**
   * Start sustained typing indicator. Refreshes automatically
   * until stopTyping is called or maxTypingMs is reached.
   */
  startTyping(target: TypingTarget): void {
    const key = `${target.adapterId}:${target.chatId}`;

    // Already typing? Reset timer
    if (this.activeTyping.has(key)) {
      this.stopTyping(target);
    }

    const typingFn = this.typingFunctions.get(target.adapterId);
    if (!typingFn) return;

    // Fire immediately
    typingFn(target.chatId).catch(() => {});

    // Set up refresh interval
    const interval = setInterval(() => {
      const active = this.activeTyping.get(key);
      if (!active) return;

      // Safety timeout
      if (Date.now() - active.startedAt > this.maxTypingMs) {
        console.warn(`[presence] Typing timeout for ${key} (>${this.maxTypingMs}ms)`);
        this.stopTyping(target);
        return;
      }

      typingFn(target.chatId).catch(() => {});
    }, this.refreshIntervalMs);

    this.activeTyping.set(key, {
      target,
      interval,
      startedAt: Date.now(),
    });
  }

  /**
   * Stop typing indicator for a target.
   */
  stopTyping(target: TypingTarget): void {
    const key = `${target.adapterId}:${target.chatId}`;
    const active = this.activeTyping.get(key);
    if (active) {
      clearInterval(active.interval);
      this.activeTyping.delete(key);
    }

    // Send "paused" to WhatsApp to clear the indicator immediately
    const typingFn = this.typingFunctions.get(target.adapterId);
    if (typingFn && target.adapterId.startsWith('whatsapp')) {
      // The typing function in WA adapter already handles pause after duration
      // But we want immediate stop — we'll add a pause method
    }
  }

  /**
   * Stop all active typing (shutdown).
   */
  stopAll(): void {
    for (const [, active] of this.activeTyping) {
      clearInterval(active.interval);
    }
    this.activeTyping.clear();
  }

  /**
   * Get stats for monitoring.
   */
  stats(): { activeCount: number; adapters: number } {
    return {
      activeCount: this.activeTyping.size,
      adapters: this.typingFunctions.size,
    };
  }
}

// Singleton — one presence manager for the entire gateway
export const presenceManager = new PresenceManager();
