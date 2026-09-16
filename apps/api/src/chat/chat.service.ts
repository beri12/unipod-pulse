import { Injectable } from '@nestjs/common';
import { LlmService } from '@unipods/ai';
import { stripHeader } from '@unipods/ingest';
import type {
  ChatMessageDto,
  ChatResponse,
  Citation,
  ConversationDetail,
  ConversationSummary,
  SourceLocator,
} from '@unipods/types';
import { AppException } from '../common/errors';
import { StructuredLogger } from '../common/logger';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionsService } from '../questions/questions.service';
import type { RankedChunk } from '../rag/ranking.service';
import { RagService, type CitedChunk } from '../rag/rag.service';
import { toSourceRef } from '../sources/sources.service';

/** How much of a chunk is kept as the verbatim excerpt on a citation card. */
const QUOTE_MAX_CHARS = 280;
/** Cards from one source, so a long document cannot crowd out other evidence. */
const MAX_CITATIONS_PER_SOURCE = 2;
/** Cards in total on one answer. */
const MAX_CITATIONS = 6;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rag: RagService,
    private readonly llm: LlmService,
    private readonly questions: QuestionsService,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * One turn of conversation: retrieve, answer, persist, cite.
   *
   * Citations are written from the chunks the answer actually used, each linked
   * to a real `Source` row, with a quote copied verbatim out of the retrieved
   * chunk. Nothing on a citation card is model-generated.
   */
  async ask(
    userId: string,
    input: { conversationId?: string; message: string },
  ): Promise<ChatResponse> {
    const startedAt = Date.now();
    const question = input.message.trim();

    const conversation = input.conversationId
      ? await this.requireConversation(userId, input.conversationId)
      : await this.prisma.conversation.create({
          data: { userId, title: await this.llm.generateTitle(question) },
        });

    const history = await this.recentHistory(conversation.id);

    await this.prisma.chatMessage.create({
      data: { conversationId: conversation.id, role: 'USER', content: question },
    });

    const result = await this.rag.answer(question, history);

    const assistantMessage = await this.prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: result.answer,
        metadata: { ...result.diagnostics },
      },
    });

    const { citations, content } = await this.persistCitations(
      assistantMessage.id,
      result.answer,
      result.cited,
    );

    if (content !== result.answer) {
      await this.prisma.chatMessage.update({
        where: { id: assistantMessage.id },
        data: { content },
      });
    }

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    const latencyMs = Date.now() - startedAt;
    await this.questions.log({
      userId,
      conversationId: conversation.id,
      question,
      answered: result.diagnostics.answered,
      confidence: result.diagnostics.confidence,
      latencyMs,
    });

    this.logger.event('log', 'chat answered', {
      conversationId: conversation.id,
      answered: result.diagnostics.answered,
      confidence: result.diagnostics.confidence,
      citations: citations.length,
      latencyMs,
    });

    return {
      conversationId: conversation.id,
      message: {
        id: assistantMessage.id,
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content,
        createdAt: assistantMessage.createdAt.toISOString(),
        citations,
        diagnostics: result.diagnostics,
      },
      citations,
      diagnostics: result.diagnostics,
    };
  }

  /**
   * Turns the cited chunks into citation cards.
   *
   * Deduplication is by *location*, not by source: two passages from different
   * moments of the same meeting are two different things to check, and
   * collapsing them would leave the card pointing at a timestamp the answer
   * never used. A single source still contributes at most
   * `MAX_CITATIONS_PER_SOURCE` cards so one long document cannot crowd out the
   * rest.
   */
  private async persistCitations(
    chatMessageId: string,
    answer: string,
    cited: CitedChunk[],
  ): Promise<{ citations: Citation[]; content: string }> {
    if (cited.length === 0) return { citations: [], content: stripCitationMarkers(answer) };

    // Order follows the answer, not the retrieval score: the cards a reader
    // checks first should be the passages the answer leaned on first.
    const locationToCard = new Map<string, number>();
    const perSource = new Map<string, number>();
    const selected: CitedChunk[] = [];
    /** Bracket number used by the answer -> position of the card it maps to. */
    const renumber = new Map<number, number>();

    for (const chunk of cited) {
      const key = `${chunk.sourceId}:${locationKey(chunk)}`;
      const existingCard = locationToCard.get(key);
      if (existingCard !== undefined) {
        renumber.set(chunk.contextIndex, existingCard);
        continue;
      }
      const used = perSource.get(chunk.sourceId) ?? 0;
      if (used >= MAX_CITATIONS_PER_SOURCE || selected.length >= MAX_CITATIONS) continue;
      perSource.set(chunk.sourceId, used + 1);
      selected.push(chunk);
      const card = selected.length;
      locationToCard.set(key, card);
      renumber.set(chunk.contextIndex, card);
    }

    const rows = await this.prisma.$transaction(
      selected.map((chunk) =>
        this.prisma.chatCitation.create({
          data: {
            chatMessageId,
            sourceId: chunk.sourceId,
            quote: excerpt(chunk.content),
            score: chunk.score,
            metadata: {
              ...(chunk.chunkMetadata as SourceLocator),
              vectorScore: chunk.vectorScore,
              keywordScore: chunk.keywordScore,
              recencyScore: chunk.recencyScore,
            },
          },
          include: { source: true },
        }),
      ),
    );

    return {
      citations: rows.map((row) => ({
        id: row.id,
        sourceId: row.sourceId,
        title: row.source.title,
        type: row.source.type,
        quote: row.quote,
        score: row.score,
        metadata: (row.metadata ?? {}) as SourceLocator,
        source: toSourceRef(row.source),
      })),
      content: applyRenumbering(answer, renumber),
    };
  }

  private async recentHistory(
    conversationId: string,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const messages = await this.prisma.chatMessage.findMany({
      where: { conversationId, role: { in: ['USER', 'ASSISTANT'] } },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { role: true, content: true },
    });
    return messages
      .reverse()
      .map((message) => ({
        role: message.role === 'USER' ? ('user' as const) : ('assistant' as const),
        content: message.content,
      }));
  }

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    const conversations = await this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { messages: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true } },
      },
    });

    return conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messageCount: conversation._count.messages,
      lastMessagePreview: conversation.messages[0]?.content.slice(0, 160) ?? null,
    }));
  }

  async getConversation(userId: string, id: string): Promise<ConversationDetail> {
    const conversation = await this.requireConversation(userId, id);
    const messages = await this.prisma.chatMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      include: { citations: { include: { source: true } } },
    });

    const dtos: ChatMessageDto[] = messages.map((message) => ({
      id: message.id,
      conversationId: id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      citations: message.citations.map((citation) => ({
        id: citation.id,
        sourceId: citation.sourceId,
        title: citation.source.title,
        type: citation.source.type,
        quote: citation.quote,
        score: citation.score,
        metadata: (citation.metadata ?? {}) as SourceLocator,
        source: toSourceRef(citation.source),
      })),
      diagnostics: (message.metadata ?? undefined) as unknown as ChatMessageDto['diagnostics'],
    }));

    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messageCount: messages.length,
      lastMessagePreview: messages[messages.length - 1]?.content.slice(0, 160) ?? null,
      messages: dtos,
    };
  }

  async deleteConversation(userId: string, id: string): Promise<void> {
    await this.requireConversation(userId, id);
    await this.prisma.conversation.delete({ where: { id } });
  }

  /** Conversations are private: ownership is checked on every access. */
  private async requireConversation(userId: string, id: string) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id } });
    if (!conversation) throw AppException.notFound('That conversation');
    if (conversation.userId !== userId) {
      throw AppException.forbidden('This conversation belongs to someone else.');
    }
    return conversation;
  }
}

/**
 * Rewrites the answer's bracket markers to match the citation cards shown.
 *
 * The model (or the extractive answerer) cites by position in the retrieved
 * context, but the reader sees a shorter, deduplicated list of cards. Without
 * this, "[6]" would point at nothing. Markers whose evidence did not make the
 * final list are removed rather than left dangling.
 */
export function applyRenumbering(answer: string, renumber: Map<number, number>): string {
  return answer
    .replace(/\[(\d+)\]/g, (_match, group: string) => {
      const card = renumber.get(Number.parseInt(group, 10));
      return card === undefined ? '' : `[${card}]`;
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([.,;:])/g, '$1')
    .trimEnd();
}

/** Removes every bracket marker, for an answer that ended up with no cards. */
export function stripCitationMarkers(answer: string): string {
  return applyRenumbering(answer, new Map());
}

/** Identifies where in a source a chunk sits, for citation deduplication. */
function locationKey(chunk: RankedChunk): string {
  const metadata = chunk.chunkMetadata as SourceLocator;
  if (typeof metadata.startTime === 'number') return `t${Math.round(metadata.startTime)}`;
  if (typeof metadata.page === 'number') return `p${metadata.page}`;
  if (typeof metadata.section === 'string') return `s${metadata.section}`;
  return `c${chunk.chunkIndex}`;
}

/**
 * Trims a chunk to a readable excerpt on a sentence or word boundary.
 *
 * The contextual header the indexer prepends is removed first: it exists for
 * retrieval, and quoting it back would misrepresent what the source says.
 */
export function excerpt(content: string, max = QUOTE_MAX_CHARS): string {
  const text = stripHeader(content).trim().replace(/\s+/g, ' ');
  if (text.length <= max) return text;
  const sliced = text.slice(0, max);
  const sentenceEnd = Math.max(
    sliced.lastIndexOf('. '),
    sliced.lastIndexOf('! '),
    sliced.lastIndexOf('? '),
  );
  if (sentenceEnd > max * 0.5) return sliced.slice(0, sentenceEnd + 1);
  const wordEnd = sliced.lastIndexOf(' ');
  return `${(wordEnd > max * 0.5 ? sliced.slice(0, wordEnd) : sliced).trimEnd()}…`;
}
