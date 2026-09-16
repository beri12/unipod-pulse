import type { Env } from '@unipods/config';
import type { RetrievedRow } from '@unipods/database';
import { describe, expect, it } from 'vitest';
import { decay, RankingService } from './ranking.service';

const env = {
  RAG_WEIGHT_SEMANTIC: 0.6,
  RAG_WEIGHT_KEYWORD: 0.25,
  RAG_WEIGHT_RECENCY: 0.1,
  RAG_WEIGHT_SOURCE: 0.05,
} as unknown as Env;

const NOW = new Date('2026-09-16T12:00:00.000Z');

function row(overrides: Partial<RetrievedRow> & { chunkId: string }): RetrievedRow {
  return {
    chunkIndex: 0,
    content: 'content',
    chunkMetadata: {},
    tokenCount: 10,
    sourceId: `source-${overrides.chunkId}`,
    sourceType: 'DOCUMENT',
    sourceTitle: 'Untitled source',
    sourceUrl: null,
    sourceAuthor: null,
    sourceOccurredAt: NOW,
    sourceMetadata: {},
    referenceId: 'ref',
    isDemo: false,
    vectorScore: 0,
    keywordScore: 0,
    ...overrides,
  };
}

describe('decay', () => {
  it('scores something from now at 1 and something a half-life old at 0.5', () => {
    expect(decay(NOW, NOW, 30)).toBe(1);
    expect(decay(new Date('2026-08-17T12:00:00.000Z'), NOW, 30)).toBeCloseTo(0.5, 2);
  });

  it('treats an undated source as neutral rather than old', () => {
    expect(decay(null, NOW)).toBe(0.5);
  });
});

describe('RankingService', () => {
  const ranking = new RankingService(env);

  it('normalises weights so scores stay inside [0,1]', () => {
    const weights = ranking.currentWeights;
    const total = weights.semantic + weights.keyword + weights.recency + weights.source;
    expect(total).toBeCloseTo(1, 6);
  });

  it('merges a chunk found by both retrievers, keeping both signals', () => {
    const ranked = ranking.rank(
      'deadline',
      [row({ chunkId: 'a', vectorScore: 0.8 })],
      [row({ chunkId: 'a', keywordScore: 0.7 })],
      { limit: 5, minScore: 0, now: NOW },
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.vectorScore).toBe(0.8);
    expect(ranked[0]?.keywordScore).toBe(0.7);
  });

  it('ranks a chunk found by both retrievers above one found by only one', () => {
    const ranked = ranking.rank(
      'deadline',
      [row({ chunkId: 'both', vectorScore: 0.6 }), row({ chunkId: 'vector', vectorScore: 0.6 })],
      [row({ chunkId: 'both', keywordScore: 0.9 })],
      { limit: 5, minScore: 0, now: NOW },
    );
    expect(ranked[0]?.chunkId).toBe('both');
  });

  it('prefers the more recent of two equally similar chunks', () => {
    const ranked = ranking.rank(
      'deadline',
      [
        row({ chunkId: 'old', vectorScore: 0.7, sourceOccurredAt: new Date('2026-06-01T00:00:00Z') }),
        row({ chunkId: 'new', vectorScore: 0.7, sourceOccurredAt: NOW }),
      ],
      [],
      { limit: 5, minScore: 0, now: NOW },
    );
    expect(ranked[0]?.chunkId).toBe('new');
  });

  it('credits a source whose title matches the question', () => {
    const ranked = ranking.rank(
      'hackathon guidelines',
      [
        row({ chunkId: 'titled', vectorScore: 0.5, sourceTitle: 'Hackathon Guidelines' }),
        row({ chunkId: 'untitled', vectorScore: 0.5, sourceTitle: 'Random notes' }),
      ],
      [],
      { limit: 5, minScore: 0, now: NOW },
    );
    expect(ranked[0]?.chunkId).toBe('titled');
  });

  it('does not weight a source kind: a message can outrank a document', () => {
    const ranked = ranking.rank(
      'deadline',
      [
        row({ chunkId: 'doc', vectorScore: 0.4, sourceType: 'DOCUMENT' }),
        row({ chunkId: 'msg', vectorScore: 0.9, sourceType: 'MESSAGE' }),
      ],
      [],
      { limit: 5, minScore: 0, now: NOW },
    );
    expect(ranked[0]?.chunkId).toBe('msg');
  });

  it('respects the requested limit', () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      row({ chunkId: `c${index}`, vectorScore: 0.9 - index * 0.01 }),
    );
    expect(ranking.rank('x', rows, [], { limit: 4, minScore: 0, now: NOW })).toHaveLength(4);
  });

  it('keeps close runners-up even when the absolute floor is high', () => {
    const ranked = ranking.rank(
      'deadline',
      [row({ chunkId: 'best', vectorScore: 0.5 }), row({ chunkId: 'close', vectorScore: 0.45 })],
      [],
      { limit: 5, minScore: 0.9, now: NOW },
    );
    expect(ranked.map((chunk) => chunk.chunkId)).toEqual(['best', 'close']);
  });

  it('returns the single best candidate rather than nothing at all', () => {
    const ranked = ranking.rank('deadline', [row({ chunkId: 'weak', vectorScore: 0.01 })], [], {
      limit: 5,
      minScore: 0.9,
      now: NOW,
    });
    expect(ranked).toHaveLength(1);
  });

  it('returns nothing when there is nothing to rank', () => {
    expect(ranking.rank('deadline', [], [], { limit: 5, minScore: 0, now: NOW })).toEqual([]);
  });
});
