import { Injectable } from '@nestjs/common';
import { LlmService } from '@unipods/ai';
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
import { RagService } from '../rag/rag.service';
import { toSourceRef } from '../sources/sources.service';

/** How much of a chunk is kept as the verbatim excerpt on a citation card. */
const QUOTE_MAX_CHARS = 280;

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

    const citations = await this.persistCitations(assistantMessage.id, result.cited);

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
        content: assistantMessage.content,
        createdAt: assistantMessage.createdAt.toISOString(),
        citations,
        diagnostics: result.diagnostics,
      },
      citations,
      diagnostics: result.diagnostics,
    };
  }

  /**
   * Deduplicates by source: several chunks from one document produce one
   * citation card, keeping the highest-scoring excerpt.
   */
  private async persistCitations(
    chatMessageId: string,
    cited: RankedChunk[],
  ): Promise<Citation[]> {
    if (cited.length === 0) return [];

    const bySource = new Map<string, RankedChunk>();
    for (const chunk of cited) {
      const existing = bySource.get(chunk.sourceId);
      if (!existing || chunk.score > existing.score) bySource.set(chunk.sourceId, chunk);
    }

    const rows = await this.prisma.$transaction(
      [...bySource.values()].map((chunk) =>
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

    return rows.map((row) => ({
      id: row.id,
      sourceId: row.sourceId,
      title: row.source.title,
      type: row.source.type,
      quote: row.quote,
      score: row.score,
      metadata: (row.metadata ?? {}) as SourceLocator,
      source: toSourceRef(row.source),
    }));
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

/** Trims a chunk to a readable excerpt on a sentence or word boundary. */
export function excerpt(content: string, max = QUOTE_MAX_CHARS): string {
  const text = content.trim().replace(/\s+/g, ' ');
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
