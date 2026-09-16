import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '@unipods/config';
import { countKnowledgeChunks, countPendingEmbeddings } from '@unipods/database';
import type { AdminStats, Paginated, SourceKind, SourceRef, SystemStatus } from '@unipods/types';
import { ENV } from '../config/config.module';
import { HealthService } from '../health/health.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionsService } from '../questions/questions.service';
import { toSourceRef } from '../sources/sources.service';

@Injectable()
export class AdminService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly questions: QuestionsService,
    private readonly health: HealthService,
  ) {}

  async stats(): Promise<AdminStats> {
    const demo = this.env.DEMO_MODE ? { isDemo: true } : { isDemo: false };

    const [
      documentsTotal,
      documentsCompleted,
      documentsFailed,
      documentsPending,
      meetingsTotal,
      meetingsCompleted,
      meetingsFailed,
      meetingsPending,
      messagesTotal,
      announcements,
      chunks,
      pending,
      questionStats,
    ] = await Promise.all([
      this.prisma.document.count({ where: demo }),
      this.prisma.document.count({ where: { ...demo, status: 'COMPLETED' } }),
      this.prisma.document.count({ where: { ...demo, status: 'FAILED' } }),
      this.prisma.document.count({ where: { ...demo, status: { in: ['PENDING', 'PROCESSING'] } } }),
      this.prisma.meeting.count({ where: demo }),
      this.prisma.meeting.count({ where: { ...demo, status: 'COMPLETED' } }),
      this.prisma.meeting.count({ where: { ...demo, status: 'FAILED' } }),
      this.prisma.meeting.count({ where: { ...demo, status: { in: ['PENDING', 'PROCESSING'] } } }),
      this.prisma.message.count({ where: demo }),
      this.prisma.message.count({ where: { ...demo, isAnnouncement: true } }),
      countKnowledgeChunks(this.prisma),
      countPendingEmbeddings(this.prisma),
      this.questions.stats(),
    ]);

    return {
      documents: {
        total: documentsTotal,
        completed: documentsCompleted,
        failed: documentsFailed,
        pending: documentsPending,
      },
      meetings: {
        total: meetingsTotal,
        completed: meetingsCompleted,
        failed: meetingsFailed,
        pending: meetingsPending,
      },
      messages: { total: messagesTotal, announcements },
      knowledge: {
        chunks,
        pendingEmbeddings: pending.documents + pending.meetings + pending.messages,
      },
      questions: questionStats,
      demoMode: this.env.DEMO_MODE,
    };
  }

  status(): Promise<SystemStatus> {
    return this.health.status();
  }

  /**
   * Browsable index of everything citable, for admins auditing what the
   * assistant can see.
   */
  async knowledge(params: {
    page: number;
    limit: number;
    search?: string;
    type?: SourceKind;
  }): Promise<Paginated<SourceRef & { chunkCount: number }>> {
    const where = {
      ...(params.type ? { type: params.type } : {}),
      ...(params.search ? { title: { contains: params.search, mode: 'insensitive' as const } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.source.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: {
          document: { select: { _count: { select: { chunks: true } } } },
          meeting: { select: { _count: { select: { chunks: true } } } },
          message: { select: { _count: { select: { chunks: true } } } },
        },
      }),
      this.prisma.source.count({ where }),
    ]);

    return {
      items: rows.map((source) => ({
        ...toSourceRef(source),
        chunkCount:
          source.document?._count.chunks ??
          source.meeting?._count.chunks ??
          source.message?._count.chunks ??
          0,
      })),
      total,
      page: params.page,
      limit: params.limit,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    };
  }
}
