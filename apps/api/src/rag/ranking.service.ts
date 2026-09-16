import { Inject, Injectable } from '@nestjs/common';
import { contentTokens } from '@unipods/ai';
import { RAG_DEFAULTS, type Env } from '@unipods/config';
import type { RetrievedRow } from '@unipods/database';
import { ENV } from '../config/config.module';

export interface RankedChunk extends RetrievedRow {
  recencyScore: number;
  /** How well the source's own title/metadata matches the question. */
  metadataScore: number;
  score: number;
}

/** A chunk scoring at least this fraction of the best match is still context. */
const RELATIVE_SCORE_FLOOR = 0.45;

export interface RankingWeights {
  semantic: number;
  keyword: number;
  recency: number;
  source: number;
}

/**
 * Hybrid re-ranking.
 *
 * Semantic similarity alone is not trustworthy: it happily returns a chunk that
 * is *about* deadlines when asked for *the* deadline, and it has no notion of
 * which of two contradicting sources is current. So the final ordering blends
 * four independent signals, each normalised to [0,1]:
 *
 *   semantic  - cosine similarity from pgvector
 *   keyword   - PostgreSQL full-text rank, which catches exact terms, names and
 *               numbers that embeddings routinely blur
 *   recency   - exponential decay, because community facts go stale fast
 *   metadata  - overlap between the question and the source's own title
 *
 * Weights are configuration, not constants, and no weight is attached to the
 * *kind* of source: a message is not inherently worth less than a PDF.
 */
@Injectable()
export class RankingService {
  private readonly weights: RankingWeights;

  constructor(@Inject(ENV) env: Env) {
    this.weights = normaliseWeights({
      semantic: env.RAG_WEIGHT_SEMANTIC,
      keyword: env.RAG_WEIGHT_KEYWORD,
      recency: env.RAG_WEIGHT_RECENCY,
      source: env.RAG_WEIGHT_SOURCE,
    });
  }

  get currentWeights(): RankingWeights {
    return { ...this.weights };
  }

  /**
   * Merges the two retrievers' results, scores them and returns the best
   * `limit` chunks above `minScore`.
   */
  rank(
    question: string,
    vectorRows: RetrievedRow[],
    keywordRows: RetrievedRow[],
    options: { limit: number; minScore: number; now?: Date },
  ): RankedChunk[] {
    const now = options.now ?? new Date();
    const questionTerms = new Set(contentTokens(question));

    // A chunk found by both retrievers keeps both scores.
    const merged = new Map<string, RetrievedRow>();
    for (const row of [...vectorRows, ...keywordRows]) {
      const existing = merged.get(row.chunkId);
      if (existing) {
        existing.vectorScore = Math.max(existing.vectorScore, row.vectorScore);
        existing.keywordScore = Math.max(existing.keywordScore, row.keywordScore);
      } else {
        merged.set(row.chunkId, { ...row });
      }
    }

    const ranked: RankedChunk[] = [...merged.values()].map((row) => {
      const recencyScore = decay(row.sourceOccurredAt, now);
      const metadataScore = titleOverlap(questionTerms, row.sourceTitle);
      const score =
        this.weights.semantic * row.vectorScore +
        this.weights.keyword * row.keywordScore +
        this.weights.recency * recencyScore +
        this.weights.source * metadataScore;
      return { ...row, recencyScore, metadataScore, score };
    });

    ranked.sort((a, b) => b.score - a.score);

    // The absolute floor alone is a poor filter, because the useful range of
    // scores depends on the embedding model: a strong match is ~0.8 cosine for
    // a trained model and ~0.3 for the offline lexical one. So a chunk is kept
    // if it clears the configured floor *or* sits close behind the best match.
    const top = ranked[0]?.score ?? 0;
    const relativeFloor = top * RELATIVE_SCORE_FLOOR;
    const kept = ranked
      .filter((row) => row.score >= options.minScore || row.score >= relativeFloor)
      .slice(0, options.limit);

    // Never return nothing purely because the threshold was strict: hand back
    // the best candidate and let the answerer decide whether the evidence is
    // good enough. Saying "no confirmed answer" after looking beats not looking.
    if (kept.length === 0 && ranked.length > 0) {
      return ranked.slice(0, 1);
    }
    return kept;
  }
}

function normaliseWeights(weights: RankingWeights): RankingWeights {
  const total = weights.semantic + weights.keyword + weights.recency + weights.source;
  if (total <= 0) return { ...RAG_DEFAULTS.weights };
  return {
    semantic: weights.semantic / total,
    keyword: weights.keyword / total,
    recency: weights.recency / total,
    source: weights.source / total,
  };
}

/** Exponential decay with a configurable half-life; undated sources score 0.5. */
export function decay(
  occurredAt: Date | null,
  now: Date,
  halfLifeDays = RAG_DEFAULTS.recencyHalfLifeDays,
): number {
  if (!occurredAt) return 0.5;
  const ageDays = (now.getTime() - occurredAt.getTime()) / 86_400_000;
  if (ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function titleOverlap(questionTerms: Set<string>, title: string): number {
  if (questionTerms.size === 0) return 0;
  const titleTerms = new Set(contentTokens(title));
  if (titleTerms.size === 0) return 0;
  let matches = 0;
  for (const term of questionTerms) if (titleTerms.has(term)) matches += 1;
  return matches / questionTerms.size;
}
