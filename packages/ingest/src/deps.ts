import type { EmbeddingService, LlmService, TranscriptionService } from '@unipods/ai';
import type { PrismaClient } from '@unipods/database';

/** Minimal object-store contract the pipelines need. */
export interface ObjectStore {
  download(key: string): Promise<Buffer>;
}

export interface PipelineLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export const noopLogger: PipelineLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Everything a pipeline needs, passed in explicitly.
 *
 * Keeping these pipelines free of any framework means the worker, the API's
 * tests and the RAG evaluation script all run exactly the same ingestion code.
 */
export interface IngestDeps {
  prisma: PrismaClient;
  embeddings: EmbeddingService;
  llm: LlmService;
  transcription?: TranscriptionService;
  storage: ObjectStore;
  logger?: PipelineLogger;
  chunking?: { targetTokens?: number; overlapTokens?: number };
}

export interface PipelineResult {
  ok: boolean;
  chunks: number;
  embedded: number;
  message?: string;
}
