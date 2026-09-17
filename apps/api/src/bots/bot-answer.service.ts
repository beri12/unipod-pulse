import { Injectable } from '@nestjs/common';
import { StructuredLogger } from '../common/logger';
import { QuestionsService } from '../questions/questions.service';
import { RagService } from '../rag/rag.service';

export interface BotAnswer {
  /** Ready to send to a chat app: the answer followed by its sources. */
  text: string;
  answered: boolean;
  confidence: number;
  sources: Array<{ title: string; locator: string | null }>;
}

/** Telegram hard-limits a message to 4096 characters. */
const MAX_REPLY_CHARS = 3500;

/**
 * Answers a question asked from a chat platform.
 *
 * This deliberately does not go through `ChatService`: a conversation belongs
 * to a signed-in user, and a group chat has no such user. Questions are still
 * logged (with a null user) so an unanswered question asked in the group shows
 * up in the admin's gap list exactly like one asked in the web app — which is
 * the whole point of putting the bot where the community already talks.
 */
@Injectable()
export class BotAnswerService {
  constructor(
    private readonly rag: RagService,
    private readonly questions: QuestionsService,
    private readonly logger: StructuredLogger,
  ) {}

  async answer(question: string, context: { channel: string }): Promise<BotAnswer> {
    const startedAt = Date.now();
    const result = await this.rag.answer(question);

    const sources = result.cited.map((chunk) => ({
      title: chunk.sourceTitle,
      locator: describeLocation(chunk.chunkMetadata),
    }));

    await this.questions.log({
      question,
      answered: result.diagnostics.answered,
      confidence: result.diagnostics.confidence,
      latencyMs: Date.now() - startedAt,
    });

    this.logger.event('log', 'bot answered', {
      channel: context.channel,
      answered: result.diagnostics.answered,
      citations: sources.length,
      latencyMs: Date.now() - startedAt,
    });

    return {
      text: formatReply(result.answer, sources),
      answered: result.diagnostics.answered,
      confidence: result.diagnostics.confidence,
      sources,
    };
  }
}

/**
 * A human-readable pointer into the source: the page, timestamp or date the
 * passage came from. Returns null when the source has no finer location than
 * itself.
 */
export function describeLocation(metadata: Record<string, unknown> | null): string | null {
  const meta = metadata ?? {};
  const page = asNumber(meta.page);
  if (page !== null) {
    const end = asNumber(meta.pageEnd);
    return end !== null && end !== page ? `pages ${page}–${end}` : `page ${page}`;
  }
  const startTime = asNumber(meta.startTime);
  if (startTime !== null) return `at ${formatClock(startTime)}`;
  const section = asString(meta.section);
  if (section) return section;
  const messageDate = asString(meta.messageDate);
  if (messageDate) return messageDate.slice(0, 10);
  return null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/**
 * Appends the sources as a numbered list matching the `[n]` markers already in
 * the answer, so a reader in the group can check any claim without leaving the
 * chat. An answer with no citations gets no source list — it is a refusal, and
 * dressing it up with sources would be misleading.
 */
export function formatReply(answer: string, sources: BotAnswer['sources']): string {
  const body = truncate(answer.trim(), MAX_REPLY_CHARS);
  if (sources.length === 0) return body;

  const list = sources
    .map((source, index) => {
      const locator = source.locator ? ` — ${source.locator}` : '';
      return `[${index + 1}] ${source.title}${locator}`;
    })
    .join('\n');

  return `${body}\n\nSources:\n${list}`;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}
