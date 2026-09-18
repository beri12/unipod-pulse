import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IncomingMessage } from '../bot/bot.types.js';
import { KnowledgeClaudeService } from './claude.service.js';
import { KnowledgeStoreService } from './knowledge-store.service.js';
import { KNOWLEDGE_CONFIG, type KnowledgeConfig } from './knowledge.config.js';
import type { KnowledgeEntry } from './knowledge.types.js';
import { looksLikeQuestion } from './question.js';

/** What the bot says when the community's information does not cover it. */
export const NO_ANSWER_REPLY = [
  "I couldn't find a confirmed answer in the available community information.",
  'This question has been recorded so an organiser can fill the gap.',
].join('\n');

/**
 * Answers a question from everything the community knows — admin answers,
 * call transcripts, notes — and records what it could not answer.
 */
@Injectable()
export class AnswerService {
  private readonly logger = new Logger(AnswerService.name);

  constructor(
    @Inject(KNOWLEDGE_CONFIG) private readonly config: KnowledgeConfig,
    private readonly store: KnowledgeStoreService,
    private readonly claude: KnowledgeClaudeService,
  ) {}

  get enabled(): boolean {
    return this.claude.enabled;
  }

  /**
   * @param explicit true when the member used !ask, which skips the
   *                 "does this look like a question" gate.
   * @returns the reply, or null to stay silent.
   */
  async answer(message: IncomingMessage, explicit = false): Promise<string | null> {
    if (!this.enabled) return null;

    const question = message.text.trim();
    if (!explicit && !looksLikeQuestion(question)) return null;

    const entries = await this.findAnswerSources(question, message.chatId);
    const composed = await this.claude.composeAnswer(question, entries);

    if (composed.answer && composed.confidence >= this.config.minConfidence) {
      const citations = composed.citationIds
        .map((id) => this.store.findEntry(id))
        .filter((entry): entry is KnowledgeEntry => Boolean(entry));

      await this.store.markUsed(citations.map((entry) => entry.id));
      return this.render(composed.answer, citations);
    }

    this.logger.log(
      `No confident answer for "${question}" (${composed.confidence}) — recording a gap`,
    );
    await this.store.recordGap({
      question,
      scope: message.chatId,
      channel: message.channel,
      askedBy: message.senderId,
      askedByName: message.senderName,
    });
    return NO_ANSWER_REPLY;
  }

  /**
   * Picks what to read. A small knowledge base is read whole in one call; a
   * large one is narrowed by summary first, so cost does not grow with the
   * number of call transcripts imported.
   */
  private async findAnswerSources(question: string, scope: string): Promise<KnowledgeEntry[]> {
    const candidates = this.store.entriesFor(scope);
    if (candidates.length === 0) return [];
    if (candidates.length <= this.config.maxReadEntries) return candidates;

    const pool = candidates.slice(-this.config.maxCandidates);
    const selected = await this.claude.selectRelevant(question, pool);

    return selected
      .map((id) => this.store.findEntry(id))
      .filter((entry): entry is KnowledgeEntry => Boolean(entry));
  }

  /** Adds a short "where this came from" line, which builds trust. */
  private render(answer: string, citations: KnowledgeEntry[]): string {
    const labels = [
      ...new Set(
        citations
          .map((entry) => {
            const source = entry.source;
            if (entry.type === 'qa') {
              return source?.author ? `answered by ${source.author}` : 'answered in the group';
            }
            return [source?.label, source?.date].filter(Boolean).join(', ');
          })
          .filter(Boolean),
      ),
    ].slice(0, 2);

    return labels.length > 0 ? `${answer}\n\n📌 ${labels.join(' · ')}` : answer;
  }
}
