import { Injectable } from '@nestjs/common';
import type { SearchResponse, SearchResultDto, SourceKind, SourceLocator } from '@unipods/types';
import { RagService } from '../rag/rag.service';
import { describeLocator, toSourceRef } from '../sources/sources.service';
import { PrismaService } from '../prisma/prisma.service';
import { excerpt } from '../chat/chat.service';

@Injectable()
export class SearchService {
  constructor(
    private readonly rag: RagService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Global search over the same hybrid retrieval the chat uses — so a result
   * the search page shows is a result the assistant could have cited.
   */
  async search(
    query: string,
    options: { types?: SourceKind[]; limit: number },
  ): Promise<SearchResponse> {
    const started = Date.now();
    const trimmed = query.trim();
    if (!trimmed) {
      return { query: trimmed, results: [], took: 0 };
    }

    const retrieval = await this.rag.retrieve(trimmed, {
      topK: options.limit,
      // Search should show weak matches too; the score is displayed so the
      // reader can judge. Only the assistant applies a confidence threshold.
      minScore: 0,
      ...(options.types?.length ? { sourceTypes: options.types } : {}),
    });

    const sourceIds = [...new Set(retrieval.chunks.map((chunk) => chunk.sourceId))];
    const sources = await this.prisma.source.findMany({ where: { id: { in: sourceIds } } });
    const sourceById = new Map(sources.map((source) => [source.id, source]));

    const results: SearchResultDto[] = retrieval.chunks.map((chunk) => {
      const source = sourceById.get(chunk.sourceId);
      const locator = {
        ...(chunk.chunkMetadata as SourceLocator),
        ...((source?.metadata ?? {}) as SourceLocator),
      };
      const position = describeLocator(chunk.sourceType as SourceKind, locator);
      return {
        id: chunk.chunkId,
        title: appendPosition(chunk.sourceTitle, position),
        snippet: highlight(excerpt(chunk.content, 260), trimmed),
        type: chunk.sourceType,
        score: Math.round(chunk.score * 1000) / 1000,
        occurredAt: chunk.sourceOccurredAt ? chunk.sourceOccurredAt.toISOString() : null,
        source: source
          ? toSourceRef(source)
          : {
              id: chunk.sourceId,
              type: chunk.sourceType,
              title: chunk.sourceTitle,
              referenceId: chunk.referenceId,
              url: chunk.sourceUrl,
              authorName: chunk.sourceAuthor,
              occurredAt: chunk.sourceOccurredAt ? chunk.sourceOccurredAt.toISOString() : null,
              metadata: locator,
            },
      };
    });

    return { query: trimmed, results, took: Date.now() - started };
  }
}

/**
 * Appends the position to the title, skipping parts the title already states.
 * A message source is titled "build-help · Kelechi Anyanwu", so repeating the
 * channel would only make the result harder to scan.
 */
export function appendPosition(title: string, position: string): string {
  if (!position) return title;
  const lower = title.toLowerCase();
  const parts = position
    .split(' · ')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !lower.includes(part.toLowerCase()));
  return parts.length > 0 ? `${title} · ${parts.join(' · ')}` : title;
}

/**
 * Wraps matched terms in `<mark>`. The snippet is escaped first, so the only
 * markup in the output is the highlighting this function adds.
 */
export function highlight(snippet: string, query: string): string {
  const escaped = escapeHtml(snippet);
  const terms = [...new Set(query.toLowerCase().split(/\s+/).filter((term) => term.length > 2))];
  if (terms.length === 0) return escaped;
  const pattern = new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'gi');
  return escaped.replace(pattern, '<mark>$1</mark>');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
