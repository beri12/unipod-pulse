import { Injectable } from '@nestjs/common';
import type { IncomingMessage } from '../bot/bot.types.js';
import { KnowledgeClaudeService } from './claude.service.js';
import { KnowledgeStoreService } from './knowledge-store.service.js';

const DEFAULT_HOURS = 24;
const MAX_HOURS = 24 * 14;

/**
 * "What did I miss?" — the answer to a group too busy to read.
 *
 * Summarises the archived messages of a chat into decisions, answered
 * questions, and what is still open.
 */
@Injectable()
export class CatchupService {
  constructor(
    private readonly store: KnowledgeStoreService,
    private readonly claude: KnowledgeClaudeService,
  ) {}

  async catchUp(message: IncomingMessage, requestedHours?: number): Promise<string> {
    const hours = this.clampHours(requestedHours);
    const since = new Date(Date.now() - hours * 3600_000);
    const messages = this.store.archivedSince(message.chatId, since);

    if (messages.length === 0) {
      return `Nothing recorded here in the last ${hours} hours.`;
    }
    if (!this.claude.enabled) {
      return `I have ${messages.length} messages from the last ${hours} hours, but summarising needs ANTHROPIC_API_KEY.`;
    }

    const summary = await this.claude.catchUp(messages, hours);
    if (!summary) return 'I could not build the summary just now. Try again in a moment.';

    return `Here is what you missed in the last ${hours}h:\n\n${summary}`;
  }

  private clampHours(requested?: number): number {
    if (!requested || !Number.isFinite(requested) || requested <= 0) return DEFAULT_HOURS;
    return Math.min(Math.floor(requested), MAX_HOURS);
  }
}
