import { Prisma } from '../generated/client';

/** Dimension of every vector column. Must match `vector(N)` in the schema. */
export const VECTOR_DIMENSIONS = 1536;

export class VectorDimensionError extends Error {
  constructor(received: number) {
    super(
      `Embedding has ${received} dimensions but the database expects ${VECTOR_DIMENSIONS}. ` +
        'Change EMBEDDING_DIMENSIONS back, or migrate the vector columns to the new size.',
    );
    this.name = 'VectorDimensionError';
  }
}

/**
 * Serialises an embedding into pgvector's text input format.
 *
 * The result is always passed to Postgres as a *bound parameter* (`$n::vector`),
 * never concatenated into SQL, so it cannot be used for injection. Values are
 * still validated as finite numbers to fail fast on NaN from a broken provider.
 */
export function toVectorLiteral(embedding: number[]): string {
  if (embedding.length !== VECTOR_DIMENSIONS) {
    throw new VectorDimensionError(embedding.length);
  }
  for (let i = 0; i < embedding.length; i += 1) {
    if (!Number.isFinite(embedding[i])) {
      throw new Error(`Embedding contains a non-finite value at index ${i}.`);
    }
  }
  return `[${embedding.join(',')}]`;
}

/** Parses pgvector's text output back into numbers. */
export function fromVectorLiteral(value: string | null): number[] | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (trimmed === '') return [];
  return trimmed.split(',').map((part) => Number.parseFloat(part));
}

export type EmbeddingTable = 'document_chunks' | 'meeting_chunks' | 'message_chunks';

/**
 * Whitelist mapping table name -> Prisma.sql identifier. Callers can only pick
 * from this map, so a table name can never originate from user input.
 */
const EMBEDDING_TABLES: Record<EmbeddingTable, Prisma.Sql> = {
  document_chunks: Prisma.sql`"document_chunks"`,
  meeting_chunks: Prisma.sql`"meeting_chunks"`,
  message_chunks: Prisma.sql`"message_chunks"`,
};

export function embeddingTable(table: EmbeddingTable): Prisma.Sql {
  const sql = EMBEDDING_TABLES[table];
  if (!sql) throw new Error(`Unknown embedding table: ${String(table)}`);
  return sql;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Cannot compare vectors of length ${a.length} and ${b.length}.`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
