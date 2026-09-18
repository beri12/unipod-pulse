import type { BotChannel } from '../bot/bot.types.js';

/** One question/answer pair the bot learned from a group admin. */
export interface FaqEntry {
  id: string;
  /** The member's question, in the words they used. */
  question: string;
  /** The admin's answer, stored verbatim — the bot never rewrites facts. */
  answer: string;
  channel: BotChannel;
  chatId: string;
  /** Who asked, and who answered. Useful for auditing what the bot learned. */
  askedBy?: string;
  answeredBy?: string;
  answeredByName?: string;
  createdAt: string;
  /** How many times this entry has been used to answer someone. */
  useCount: number;
  lastUsedAt?: string;
}

export interface FaqMatch {
  entry: FaqEntry;
  confidence: number;
}
