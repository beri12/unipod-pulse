import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IncomingMessage } from '../bot/bot.types.js';
import { FaqMatcherService } from './faq-matcher.service.js';
import { FaqStoreService } from './faq-store.service.js';
import { FAQ_CONFIG, type FaqConfig } from './faq.config.js';
import type { FaqEntry } from './faq.types.js';
import { looksLikeQuestion } from './question.js';

/**
 * Learns from group admins and answers repeat questions.
 *
 * Learning: an admin replies to a member's question -> the pair is stored.
 * Answering: a member asks something -> Claude checks whether an admin has
 * already answered that same question, in any language or wording, and the
 * bot repeats the admin's answer verbatim.
 */
@Injectable()
export class FaqService {
  private readonly logger = new Logger(FaqService.name);

  constructor(
    @Inject(FAQ_CONFIG) private readonly config: FaqConfig,
    private readonly store: FaqStoreService,
    private readonly matcher: FaqMatcherService,
  ) {}

  get enabled(): boolean {
    return this.matcher.enabled;
  }

  /**
   * Watches every message for an admin answering a member's question.
   *
   * @returns the entry that was learned, or null.
   */
  async observe(message: IncomingMessage): Promise<FaqEntry | null> {
    if (!this.config.autoLearn) return null;
    if (!message.isGroup) return null;
    if (message.senderIsAdmin !== true) return null;

    const quoted = message.quoted;
    if (!quoted?.text) return null;
    // Replying to the bot is a correction or a thank-you, not a new answer.
    if (quoted.fromBot) return null;
    if (!looksLikeQuestion(quoted.text)) return null;

    const answer = message.text.trim();
    // A command, a bare "yes", or an emoji is not an answer worth keeping.
    if (answer.length < 4) return null;

    const entry = await this.store.add({
      question: quoted.text.trim(),
      answer,
      channel: message.channel,
      chatId: message.chatId,
      askedBy: quoted.senderId,
      answeredBy: message.senderId,
      answeredByName: message.senderName,
    });

    this.logger.log(`Learned: "${entry.question}" -> "${entry.answer}"`);
    return entry;
  }

  /**
   * Answers a question when an admin has already answered the same one.
   *
   * @returns the stored answer, or null to stay silent.
   */
  async answer(message: IncomingMessage): Promise<string | null> {
    if (!this.enabled) return null;

    const question = message.text.trim();
    if (!looksLikeQuestion(question)) return null;

    // Only answers from this same chat: a group's opening hours are not
    // necessarily another group's.
    const entries = this.store.all().filter((entry) => entry.chatId === message.chatId);
    if (entries.length === 0) return null;

    const match = await this.matcher.match(question, entries);
    if (!match) return null;

    if (match.confidence < this.config.minConfidence) {
      this.logger.debug(
        `Skipping a ${match.confidence} match (below ${this.config.minConfidence}): "${question}"`,
      );
      return null;
    }

    await this.store.markUsed(match.entry.id);
    return match.entry.answer;
  }

  /** Teaches a pair directly, from the !learn command. */
  teach(
    message: IncomingMessage,
    question: string,
    answer: string,
  ): Promise<FaqEntry> {
    return this.store.add({
      question: question.trim(),
      answer: answer.trim(),
      channel: message.channel,
      chatId: message.chatId,
      answeredBy: message.senderId,
      answeredByName: message.senderName,
    });
  }

  forget(id: string): Promise<boolean> {
    return this.store.remove(id);
  }

  listFor(chatId: string): FaqEntry[] {
    return this.store.all().filter((entry) => entry.chatId === chatId);
  }
}
