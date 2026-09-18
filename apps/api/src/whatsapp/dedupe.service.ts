import { Injectable } from '@nestjs/common';

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;

/**
 * Remembers message ids we have already handled.
 *
 * Meta re-delivers a webhook if we do not answer 200 quickly enough, and
 * Baileys can re-emit a message after a reconnect. Without this the bot
 * answers the same question two or three times.
 */
@Injectable()
export class DedupeService {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  /**
   * @returns true the first time an id is seen, false on every repeat.
   */
  markIfNew(id: string, now: number = Date.now()): boolean {
    this.prune(now);
    if (this.seen.has(id)) return false;
    this.seen.set(id, now + this.ttlMs);
    return true;
  }

  private prune(now: number): void {
    for (const [id, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(id);
    }
    // Hard cap so a burst cannot grow the map without bound. Map preserves
    // insertion order, so this drops the oldest ids first.
    while (this.seen.size > MAX_ENTRIES) {
      const oldest = this.seen.keys().next();
      if (oldest.done) break;
      this.seen.delete(oldest.value);
    }
  }
}
