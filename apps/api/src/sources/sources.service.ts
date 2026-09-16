import { Injectable } from '@nestjs/common';
import { formatTimestamp } from '@unipods/ai';
import type { SourceKind, SourceLocator, SourceRef } from '@unipods/types';
import type { Prisma } from '@unipods/database';
import { AppException } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

export interface SourceSeed {
  type: SourceKind;
  title: string;
  referenceId: string;
  url?: string | null;
  authorName?: string | null;
  occurredAt?: Date | null;
  metadata?: Prisma.InputJsonValue;
  documentId?: string;
  meetingId?: string;
  messageId?: string;
}

/**
 * The `Source` table is the single citable identity for everything in the
 * knowledge base. Documents, meetings and messages each own exactly one row,
 * created or refreshed here, so a citation never points at a raw table id.
 */
@Injectable()
export class SourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(seed: SourceSeed): Promise<{ id: string }> {
    const data = {
      type: seed.type,
      title: seed.title,
      referenceId: seed.referenceId,
      url: seed.url ?? null,
      authorName: seed.authorName ?? null,
      occurredAt: seed.occurredAt ?? null,
      metadata: seed.metadata ?? {},
      documentId: seed.documentId ?? null,
      meetingId: seed.meetingId ?? null,
      messageId: seed.messageId ?? null,
    };
    return this.prisma.source.upsert({
      where: { type_referenceId: { type: seed.type, referenceId: seed.referenceId } },
      create: data,
      update: {
        title: data.title,
        url: data.url,
        authorName: data.authorName,
        occurredAt: data.occurredAt,
        metadata: data.metadata,
      },
      select: { id: true },
    });
  }

  async byId(id: string): Promise<SourceRef> {
    const source = await this.prisma.source.findUnique({ where: { id } });
    if (!source) throw AppException.notFound('That source');
    return toSourceRef(source);
  }

  async byIds(ids: string[]): Promise<Map<string, SourceRef>> {
    if (ids.length === 0) return new Map();
    const sources = await this.prisma.source.findMany({ where: { id: { in: ids } } });
    return new Map(sources.map((source) => [source.id, toSourceRef(source)]));
  }
}

export function toSourceRef(source: {
  id: string;
  type: SourceKind;
  title: string;
  referenceId: string;
  url: string | null;
  authorName: string | null;
  occurredAt: Date | null;
  metadata: unknown;
}): SourceRef {
  return {
    id: source.id,
    type: source.type,
    title: source.title,
    referenceId: source.referenceId,
    url: source.url,
    authorName: source.authorName,
    occurredAt: source.occurredAt ? source.occurredAt.toISOString() : null,
    metadata: (source.metadata ?? {}) as SourceLocator,
  };
}

/**
 * Human-readable position inside a source: what the UI prints under the title
 * on a citation card, and what the LLM sees in the context header.
 */
export function describeLocator(type: SourceKind, locator: SourceLocator): string {
  switch (type) {
    case 'DOCUMENT': {
      if (typeof locator.page === 'number') {
        const end = typeof locator.pageEnd === 'number' ? locator.pageEnd : undefined;
        return end && end !== locator.page
          ? `Pages ${locator.page}-${end}`
          : `Page ${locator.page}`;
      }
      if (typeof locator.section === 'string') return locator.section;
      return typeof locator.chunkIndex === 'number' ? `Part ${locator.chunkIndex + 1}` : '';
    }
    case 'MEETING': {
      if (typeof locator.startTime === 'number') return formatTimestamp(locator.startTime);
      return '';
    }
    case 'MESSAGE':
    case 'ANNOUNCEMENT': {
      const channel = typeof locator.channel === 'string' ? locator.channel : '';
      const date =
        typeof locator.messageDate === 'string'
          ? new Date(locator.messageDate).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
          : '';
      return [channel, date].filter(Boolean).join(' · ');
    }
    default:
      return '';
  }
}
