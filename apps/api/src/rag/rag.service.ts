import { Inject, Injectable } from '@nestjs/common';
import {
  EmbeddingService,
  LlmService,
  truncateToTokens,
  type GroundedContextItem,
} from '@unipods/ai';
import { NO_ANSWER_SENTENCE, RAG_DEFAULTS, type Env } from '@unipods/config';
import { searchKeywordChunks, searchSimilarChunks, type RetrievalFilters } from '@unipods/database';
import type { AnswerDiagnostics, SourceKind, SourceLocator } from '@unipods/types';
import { StructuredLogger } from '../common/logger';
import { ENV } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { describeLocator } from '../sources/sources.service';
import { RankingService, type RankedChunk } from './ranking.service';

export interface RetrieveOptions extends RetrievalFilters {
  topK?: number;
  minScore?: number;
}

export interface RetrievalOutcome {
  chunks: RankedChunk[];
  candidates: number;
  retrievalMs: number;
}

export interface GroundedAnswer {
  answer: string;
  /** Chunks the answer actually cited, in citation order. */
  cited: RankedChunk[];
  diagnostics: AnswerDiagnostics;
}

@Injectable()
export class RagService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingService,
    private readonly llm: LlmService,
    private readonly ranking: RankingService,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * Demo content and real content are never mixed. In demo mode the knowledge
   * base is the synthetic dataset; otherwise demo rows are excluded entirely.
   */
  demoFilter(): Pick<RetrievalFilters, 'includeDemo' | 'onlyDemo'> {
    return this.env.DEMO_MODE ? { onlyDemo: true } : { includeDemo: false };
  }

  /** Question -> embedding -> vector + keyword search -> hybrid ranking. */
  async retrieve(question: string, options: RetrieveOptions = {}): Promise<RetrievalOutcome> {
    const started = Date.now();
    const topK = options.topK ?? this.env.RAG_TOP_K;
    const candidateLimit = Math.min(200, topK * RAG_DEFAULTS.candidateMultiplier);
    const filters: RetrievalFilters = {
      ...this.demoFilter(),
      ...(options.sourceTypes ? { sourceTypes: options.sourceTypes } : {}),
      ...(options.from ? { from: options.from } : {}),
      ...(options.to ? { to: options.to } : {}),
      ...(options.includeDemo !== undefined ? { includeDemo: options.includeDemo } : {}),
      ...(options.onlyDemo !== undefined ? { onlyDemo: options.onlyDemo } : {}),
    };

    const normalised = normaliseQuestion(question);
    const embedding = await this.embeddings.embedText(normalised);

    // The two retrievers are independent, so they run concurrently.
    const [vectorRows, keywordRows] = await Promise.all([
      searchSimilarChunks(this.prisma, embedding, { ...filters, limit: candidateLimit }),
      searchKeywordChunks(this.prisma, normalised, { ...filters, limit: candidateLimit }),
    ]);

    const chunks = this.ranking.rank(normalised, vectorRows, keywordRows, {
      limit: topK,
      minScore: options.minScore ?? this.env.RAG_MIN_SCORE,
    });

    const retrievalMs = Date.now() - started;
    this.logger.event('debug', 'retrieval', {
      question: normalised.slice(0, 120),
      vectorCandidates: vectorRows.length,
      keywordCandidates: keywordRows.length,
      kept: chunks.length,
      retrievalMs,
    });

    return { chunks, candidates: vectorRows.length + keywordRows.length, retrievalMs };
  }

  /**
   * The full grounded-answer path.
   *
   * Citations are derived from the indexes the answer itself referenced, mapped
   * back onto the chunks that were actually retrieved — so a citation can only
   * ever point at a real record.
   */
  async answer(
    question: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    options: RetrieveOptions = {},
  ): Promise<GroundedAnswer> {
    const retrieval = await this.retrieve(question, options);
    const context = retrieval.chunks.map((chunk, index) => this.toContextItem(chunk, index + 1));

    const generationStarted = Date.now();
    const result = await this.llm.generateAnswer({ question, context, history });
    const generationMs = Date.now() - generationStarted;

    const cited = result.citedIndexes
      .map((index) => retrieval.chunks[index - 1])
      .filter((chunk): chunk is RankedChunk => Boolean(chunk));

    const answered = result.answered && cited.length > 0;
    const diagnostics: AnswerDiagnostics = {
      answered,
      confidence: answered ? confidenceOf(cited) : 0,
      retrievedChunks: retrieval.chunks.length,
      usedChunks: cited.length,
      retrievalMs: retrieval.retrievalMs,
      generationMs,
      model: this.llm.model,
      provider: this.llm.providerName,
      conflicting: result.conflicting,
    };

    return {
      answer: answered ? result.answer : NO_ANSWER_SENTENCE,
      cited,
      diagnostics,
    };
  }

  /** Packs a chunk into the numbered context block the prompt describes. */
  private toContextItem(chunk: RankedChunk, index: number): GroundedContextItem {
    const locator = chunk.chunkMetadata as SourceLocator;
    return {
      index,
      sourceId: chunk.sourceId,
      title: chunk.sourceTitle,
      kind: chunk.sourceType,
      locator: describeLocator(chunk.sourceType as SourceKind, {
        ...locator,
        ...(chunk.sourceMetadata as SourceLocator),
      }),
      date: chunk.sourceOccurredAt ? chunk.sourceOccurredAt.toISOString() : null,
      // Guard the context window: an oversized chunk is trimmed rather than
      // silently pushing earlier evidence out of the prompt.
      content: truncateToTokens(chunk.content, 1_200),
    };
  }
}

/**
 * Light normalisation only.
 *
 * Deliberately does *not* rewrite the question: stripping "what/when/who" would
 * remove exactly the signal the ranker uses to prefer dated statements, and
 * paraphrasing risks answering a question the user did not ask.
 */
export function normaliseQuestion(question: string): string {
  return question.replace(/\s+/g, ' ').trim().slice(0, 1_000);
}

/**
 * Confidence is a function of the evidence, not of the model's tone: how
 * strongly the best cited chunk matched, and whether more than one source
 * supports the answer.
 */
export function confidenceOf(cited: RankedChunk[]): number {
  if (cited.length === 0) return 0;
  const best = Math.max(...cited.map((chunk) => chunk.score));
  const distinctSources = new Set(cited.map((chunk) => chunk.sourceId)).size;
  const corroboration = Math.min(1, distinctSources / 2);
  const value = best * (0.75 + 0.25 * corroboration);
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}
