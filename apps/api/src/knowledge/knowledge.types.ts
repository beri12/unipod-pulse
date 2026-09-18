import type { BotChannel } from '../bot/bot.types.js';

/**
 * Where a piece of knowledge came from.
 *
 * qa      — an admin answered a member's question in the group
 * meeting — a chunk of a call transcript or meeting notes
 * chat    — a summarised slice of group conversation
 * note    — a document an organiser uploaded (rules, prices, how-tos)
 */
export type SourceType = 'qa' | 'meeting' | 'chat' | 'note';

/** Applies to one chat, or to the whole community. */
export const GLOBAL_SCOPE = 'global';

export interface EntrySource {
  /** Human label shown in citations, e.g. "Weekly call — 12 Sep". */
  label?: string;
  /** ISO date of the call/message/document, not of the import. */
  date?: string;
  /** Admin who answered, or the speakers in this part of a call. */
  author?: string;
  /** Position when a long document was split. */
  part?: number;
  parts?: number;
}

export interface KnowledgeEntry {
  id: string;
  type: SourceType;
  /** For `qa` the member's question; otherwise a heading for the chunk. */
  title: string;
  /** The text an answer may be built from. */
  content: string;
  /** One line describing what this covers — used for cheap retrieval. */
  summary: string;
  /** A chat id, or GLOBAL_SCOPE for community-wide sources. */
  scope: string;
  channel?: BotChannel;
  source?: EntrySource;
  createdAt: string;
  useCount: number;
  lastUsedAt?: string;
}

/** A question nobody could answer — the backlog for organisers. */
export interface KnowledgeGap {
  id: string;
  question: string;
  scope: string;
  channel?: BotChannel;
  askedBy?: string;
  askedByName?: string;
  createdAt: string;
  /** How many people have asked this. Popular gaps deserve answering first. */
  timesAsked: number;
  lastAskedAt: string;
  resolved: boolean;
  resolvedAnswer?: string;
  resolvedBy?: string;
}

/** One message kept so the bot can tell someone what they missed. */
export interface ArchivedMessage {
  chatId: string;
  senderId: string;
  senderName?: string;
  text: string;
  at: string;
  /** What the bot replied, when it did. */
  reply?: string;
}

export interface AnswerResult {
  answer: string;
  confidence: number;
  /** Entries the answer was built from. */
  citations: KnowledgeEntry[];
}
