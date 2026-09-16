import { Injectable } from '@nestjs/common';
import { contentTokens, EmbeddingService } from '@unipods/ai';
import { findSimilarUnansweredQuestion, setUnansweredQuestionEmbedding } from '@unipods/database';
import type { Paginated, QuestionLogDto, QuestionStatus, UnansweredQuestionDto } from '@unipods/types';
import { AppException } from '../common/errors';
import { StructuredLogger } from '../common/logger';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cosine similarity above which two questions are treated as the same
 * information gap. Set conservatively: over-grouping hides distinct gaps, which
 * is worse for an admin than seeing two near-identical rows.
 */
const SEMANTIC_GROUPING_THRESHOLD = 0.82;

@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingService,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * Records every question asked, answered or not.
   *
   * The question text is stored (admins need to read it to close the gap) but
   * nothing else about the asker beyond their user id.
   */
  async log(entry: {
    userId?: string | null;
    conversationId?: string | null;
    question: string;
    answered: boolean;
    confidence: number;
    latencyMs?: number;
  }): Promise<void> {
    await this.prisma.questionLog.create({
      data: {
        userId: entry.userId ?? null,
        conversationId: entry.conversationId ?? null,
        question: entry.question.slice(0, 2_000),
        answered: entry.answered,
        confidence: entry.confidence,
        latencyMs: entry.latencyMs ?? null,
      },
    });

    if (!entry.answered) {
      await this.recordUnanswered(entry.question);
    }
  }

  /**
   * Groups an unanswered question with existing ones.
   *
   * Two passes: an exact match on the normalised form (cheap, catches word-order
   * and punctuation variants), then a vector nearest-neighbour lookup so
   * "when does registration end" joins "what's the registration deadline".
   */
  async recordUnanswered(question: string): Promise<string> {
    const text = question.trim().slice(0, 2_000);
    const normalized = normaliseQuestionKey(text);

    const exact = await this.prisma.unansweredQuestion.findUnique({
      where: { normalizedQuestion: normalized },
      select: { id: true },
    });
    if (exact) return this.bump(exact.id);

    let embedding: number[] | null = null;
    try {
      embedding = await this.embeddings.embedText(normalized);
      const similar = await findSimilarUnansweredQuestion(
        this.prisma,
        embedding,
        SEMANTIC_GROUPING_THRESHOLD,
      );
      if (similar) {
        this.logger.event('debug', 'grouped unanswered question', {
          questionId: similar.id,
          similarity: similar.similarity,
        });
        return this.bump(similar.id);
      }
    } catch (error) {
      // Grouping is a nicety; failing to embed must not lose the record.
      this.logger.warn('Could not embed unanswered question', {
        reason: (error as Error).message,
      });
    }

    const created = await this.prisma.unansweredQuestion.upsert({
      where: { normalizedQuestion: normalized },
      create: { question: text, normalizedQuestion: normalized, count: 1, lastAskedAt: new Date() },
      update: { count: { increment: 1 }, lastAskedAt: new Date() },
      select: { id: true },
    });

    if (embedding) {
      await setUnansweredQuestionEmbedding(this.prisma, created.id, embedding);
    }
    return created.id;
  }

  private async bump(id: string): Promise<string> {
    await this.prisma.unansweredQuestion.update({
      where: { id },
      data: { count: { increment: 1 }, lastAskedAt: new Date() },
    });
    return id;
  }

  async listUnanswered(params: {
    page: number;
    limit: number;
    status?: QuestionStatus;
    search?: string;
  }): Promise<Paginated<UnansweredQuestionDto>> {
    const where = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.search
        ? { question: { contains: params.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.unansweredQuestion.findMany({
        where,
        orderBy: [{ count: 'desc' }, { lastAskedAt: 'desc' }],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.unansweredQuestion.count({ where }),
    ]);

    return {
      items: rows.map(toUnansweredDto),
      total,
      page: params.page,
      limit: params.limit,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    };
  }

  async updateStatus(
    id: string,
    status: QuestionStatus,
    resolutionNote?: string,
  ): Promise<UnansweredQuestionDto> {
    const existing = await this.prisma.unansweredQuestion.findUnique({ where: { id } });
    if (!existing) throw AppException.notFound('That question');
    const updated = await this.prisma.unansweredQuestion.update({
      where: { id },
      data: { status, resolutionNote: resolutionNote ?? existing.resolutionNote },
    });
    return toUnansweredDto(updated);
  }

  async listLogs(params: {
    page: number;
    limit: number;
    answered?: boolean;
  }): Promise<Paginated<QuestionLogDto>> {
    const where = params.answered === undefined ? {} : { answered: params.answered };
    const [rows, total] = await Promise.all([
      this.prisma.questionLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: { user: { select: { id: true, name: true } } },
      }),
      this.prisma.questionLog.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        question: row.question,
        answered: row.answered,
        confidence: row.confidence,
        latencyMs: row.latencyMs,
        createdAt: row.createdAt.toISOString(),
        user: row.user ? { id: row.user.id, name: row.user.name } : null,
      })),
      total,
      page: params.page,
      limit: params.limit,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    };
  }

  async stats(): Promise<{
    today: number;
    total: number;
    answered: number;
    unanswered: number;
    openUnansweredGroups: number;
  }> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [today, total, answered, openUnansweredGroups] = await Promise.all([
      this.prisma.questionLog.count({ where: { createdAt: { gte: startOfDay } } }),
      this.prisma.questionLog.count(),
      this.prisma.questionLog.count({ where: { answered: true } }),
      this.prisma.unansweredQuestion.count({ where: { status: 'OPEN' } }),
    ]);

    return { today, total, answered, unanswered: total - answered, openUnansweredGroups };
  }
}

function toUnansweredDto(row: {
  id: string;
  question: string;
  normalizedQuestion: string;
  count: number;
  lastAskedAt: Date;
  status: QuestionStatus;
  resolutionNote: string | null;
  createdAt: Date;
}): UnansweredQuestionDto {
  return {
    id: row.id,
    question: row.question,
    normalizedQuestion: row.normalizedQuestion,
    count: row.count,
    lastAskedAt: row.lastAskedAt.toISOString(),
    status: row.status,
    resolutionNote: row.resolutionNote,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Order-independent key: stopwords dropped, words stemmed and sorted, so
 * "when is the deadline" and "the deadline is when?" collapse to one row.
 */
export function normaliseQuestionKey(question: string): string {
  const tokens = contentTokens(question);
  const key = [...new Set(tokens)].sort().join(' ');
  return (key || question.toLowerCase().trim()).slice(0, 500);
}
