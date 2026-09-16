import { Prisma, type PrismaClient, type SourceKind } from '../generated/client';
import { toVectorLiteral } from './vector';

/** A chunk returned by one of the retrievers, already joined to its Source. */
export interface RetrievedRow {
  chunkId: string;
  chunkIndex: number;
  content: string;
  chunkMetadata: Record<string, unknown>;
  tokenCount: number;
  sourceId: string;
  sourceType: SourceKind;
  sourceTitle: string;
  sourceUrl: string | null;
  sourceAuthor: string | null;
  sourceOccurredAt: Date | null;
  sourceMetadata: Record<string, unknown>;
  referenceId: string;
  isDemo: boolean;
  /** Cosine similarity in [0,1]; only set by the vector retriever. */
  vectorScore: number;
  /** ts_rank_cd normalised to [0,1]; only set by the keyword retriever. */
  keywordScore: number;
}

export interface RetrievalFilters {
  sourceTypes?: SourceKind[];
  /** Only consider content that occurred at or after this instant. */
  from?: Date;
  /** Only consider content that occurred at or before this instant. */
  to?: Date;
  /** When false, synthetic demo content is excluded from retrieval. */
  includeDemo?: boolean;
  /** When true, ONLY demo content is retrieved (demo mode). */
  onlyDemo?: boolean;
}

export interface VectorSearchOptions extends RetrievalFilters {
  limit: number;
}

export interface KeywordSearchOptions extends RetrievalFilters {
  limit: number;
}

const ALL_SOURCE_TYPES: SourceKind[] = ['DOCUMENT', 'MEETING', 'MESSAGE', 'ANNOUNCEMENT'];

function resolveKinds(filters: RetrievalFilters): Set<SourceKind> {
  const requested = filters.sourceTypes?.length ? filters.sourceTypes : ALL_SOURCE_TYPES;
  return new Set(requested.filter((kind) => ALL_SOURCE_TYPES.includes(kind)));
}

/**
 * Demo isolation: demo rows and real rows are never returned by the same query.
 * `onlyDemo` wins, then `includeDemo`, and the default is "real content only".
 */
function demoCondition(alias: string, filters: RetrievalFilters): Prisma.Sql {
  const column = Prisma.raw(`"${alias}"."isDemo"`);
  if (filters.onlyDemo) return Prisma.sql`${column} = TRUE`;
  if (filters.includeDemo) return Prisma.sql`TRUE`;
  return Prisma.sql`${column} = FALSE`;
}

function dateCondition(expr: Prisma.Sql, filters: RetrievalFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (filters.from) parts.push(Prisma.sql`${expr} >= ${filters.from}`);
  if (filters.to) parts.push(Prisma.sql`${expr} <= ${filters.to}`);
  if (parts.length === 0) return Prisma.sql`TRUE`;
  return Prisma.join(parts, ' AND ');
}

/**
 * Raw rows come back with snake/camel keys exactly as aliased below. The shape
 * is identical for every branch of the UNION so results can be merged directly.
 */
interface RawRow {
  chunkId: string;
  chunkIndex: number;
  content: string;
  chunkMetadata: Record<string, unknown> | null;
  tokenCount: number;
  sourceId: string;
  sourceType: SourceKind;
  sourceTitle: string;
  sourceUrl: string | null;
  sourceAuthor: string | null;
  sourceOccurredAt: Date | null;
  sourceMetadata: Record<string, unknown> | null;
  referenceId: string;
  isDemo: boolean;
  score: number;
}

function normalise(row: RawRow, kind: 'vector' | 'keyword'): RetrievedRow {
  const score = Number.isFinite(row.score) ? row.score : 0;
  return {
    chunkId: row.chunkId,
    chunkIndex: row.chunkIndex,
    content: row.content,
    chunkMetadata: (row.chunkMetadata ?? {}) as Record<string, unknown>,
    tokenCount: row.tokenCount ?? 0,
    sourceId: row.sourceId,
    sourceType: row.sourceType,
    sourceTitle: row.sourceTitle,
    sourceUrl: row.sourceUrl,
    sourceAuthor: row.sourceAuthor,
    sourceOccurredAt: row.sourceOccurredAt,
    sourceMetadata: (row.sourceMetadata ?? {}) as Record<string, unknown>,
    referenceId: row.referenceId,
    isDemo: row.isDemo,
    vectorScore: kind === 'vector' ? Math.max(0, Math.min(1, score)) : 0,
    keywordScore: kind === 'keyword' ? Math.max(0, Math.min(1, score)) : 0,
  };
}

/**
 * Approximate nearest-neighbour search across every embedded chunk table.
 *
 * Each branch is a separately LIMIT-ed subquery so Postgres can use that
 * table's HNSW index; the union is then re-sorted and truncated. The embedding
 * is bound as a parameter (`$n::vector`) — never interpolated.
 */
export async function searchSimilarChunks(
  prisma: PrismaClient,
  embedding: number[],
  options: VectorSearchOptions,
): Promise<RetrievedRow[]> {
  const kinds = resolveKinds(options);
  const limit = Math.max(1, Math.min(options.limit, 200));
  const vector = toVectorLiteral(embedding);
  const branches: Prisma.Sql[] = [];

  if (kinds.has('DOCUMENT')) {
    branches.push(Prisma.sql`
      (SELECT c."id"           AS "chunkId",
              c."chunkIndex"   AS "chunkIndex",
              c."content"      AS "content",
              c."metadata"     AS "chunkMetadata",
              c."tokenCount"   AS "tokenCount",
              s."id"           AS "sourceId",
              s."type"         AS "sourceType",
              s."title"        AS "sourceTitle",
              s."url"          AS "sourceUrl",
              s."authorName"   AS "sourceAuthor",
              s."occurredAt"   AS "sourceOccurredAt",
              s."metadata"     AS "sourceMetadata",
              d."id"           AS "referenceId",
              d."isDemo"       AS "isDemo",
              1 - (c."embedding" <=> ${vector}::vector) AS "score"
       FROM "document_chunks" c
       JOIN "documents" d ON d."id" = c."documentId"
       JOIN "sources"   s ON s."documentId" = d."id"
       WHERE c."embedding" IS NOT NULL
         AND d."status" = 'COMPLETED'
         AND ${demoCondition('d', options)}
         AND ${dateCondition(Prisma.sql`COALESCE(d."publishedAt", d."createdAt")`, options)}
       ORDER BY c."embedding" <=> ${vector}::vector
       LIMIT ${limit})`);
  }

  if (kinds.has('MEETING')) {
    branches.push(Prisma.sql`
      (SELECT c."id", c."chunkIndex", c."content", c."metadata", c."tokenCount",
              s."id", s."type", s."title", s."url", s."authorName", s."occurredAt", s."metadata",
              m."id", m."isDemo",
              1 - (c."embedding" <=> ${vector}::vector)
       FROM "meeting_chunks" c
       JOIN "meetings" m ON m."id" = c."meetingId"
       JOIN "sources"  s ON s."meetingId" = m."id"
       WHERE c."embedding" IS NOT NULL
         AND ${demoCondition('m', options)}
         AND ${dateCondition(Prisma.sql`m."meetingDate"`, options)}
       ORDER BY c."embedding" <=> ${vector}::vector
       LIMIT ${limit})`);
  }

  if (kinds.has('MESSAGE') || kinds.has('ANNOUNCEMENT')) {
    branches.push(Prisma.sql`
      (SELECT c."id", c."chunkIndex", c."content", c."metadata", c."tokenCount",
              s."id", s."type", s."title", s."url", s."authorName", s."occurredAt", s."metadata",
              msg."id", msg."isDemo",
              1 - (c."embedding" <=> ${vector}::vector)
       FROM "message_chunks" c
       JOIN "messages" msg ON msg."id" = c."messageId"
       JOIN "sources"  s   ON s."messageId" = msg."id"
       WHERE c."embedding" IS NOT NULL
         AND s."type" IN (${Prisma.join(
           [...kinds].filter((k) => k === 'MESSAGE' || k === 'ANNOUNCEMENT'),
         )})
         AND ${demoCondition('msg', options)}
         AND ${dateCondition(Prisma.sql`msg."messageDate"`, options)}
       ORDER BY c."embedding" <=> ${vector}::vector
       LIMIT ${limit})`);
  }

  if (branches.length === 0) return [];

  const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT * FROM (${Prisma.join(branches, ' UNION ALL ')}) AS combined
    ORDER BY "score" DESC
    LIMIT ${limit}
  `);
  return rows.map((row) => normalise(row, 'vector'));
}

/**
 * PostgreSQL full-text search over the same chunk tables.
 *
 * `websearch_to_tsquery` accepts free-form user input safely (quoted phrases,
 * `-exclusion`, `OR`) and is bound as a parameter. ts_rank_cd is squashed into
 * [0,1] with `rank / (rank + 1)` so it can be blended with cosine similarity.
 */
export async function searchKeywordChunks(
  prisma: PrismaClient,
  query: string,
  options: KeywordSearchOptions,
): Promise<RetrievedRow[]> {
  const cleaned = query.trim();
  if (!cleaned) return [];
  const kinds = resolveKinds(options);
  const limit = Math.max(1, Math.min(options.limit, 200));
  const branches: Prisma.Sql[] = [];
  const tsquery = Prisma.sql`websearch_to_tsquery('english', ${cleaned})`;

  if (kinds.has('DOCUMENT')) {
    branches.push(Prisma.sql`
      (SELECT c."id"         AS "chunkId",
              c."chunkIndex" AS "chunkIndex",
              c."content"    AS "content",
              c."metadata"   AS "chunkMetadata",
              c."tokenCount" AS "tokenCount",
              s."id"         AS "sourceId",
              s."type"       AS "sourceType",
              s."title"      AS "sourceTitle",
              s."url"        AS "sourceUrl",
              s."authorName" AS "sourceAuthor",
              s."occurredAt" AS "sourceOccurredAt",
              s."metadata"   AS "sourceMetadata",
              d."id"         AS "referenceId",
              d."isDemo"     AS "isDemo",
              ts_rank_cd(to_tsvector('english', c."content"), ${tsquery}) AS "rank"
       FROM "document_chunks" c
       JOIN "documents" d ON d."id" = c."documentId"
       JOIN "sources"   s ON s."documentId" = d."id"
       WHERE to_tsvector('english', c."content") @@ ${tsquery}
         AND d."status" = 'COMPLETED'
         AND ${demoCondition('d', options)}
         AND ${dateCondition(Prisma.sql`COALESCE(d."publishedAt", d."createdAt")`, options)}
       ORDER BY "rank" DESC
       LIMIT ${limit})`);
  }

  if (kinds.has('MEETING')) {
    branches.push(Prisma.sql`
      (SELECT c."id", c."chunkIndex", c."content", c."metadata", c."tokenCount",
              s."id", s."type", s."title", s."url", s."authorName", s."occurredAt", s."metadata",
              m."id", m."isDemo",
              ts_rank_cd(to_tsvector('english', c."content"), ${tsquery})
       FROM "meeting_chunks" c
       JOIN "meetings" m ON m."id" = c."meetingId"
       JOIN "sources"  s ON s."meetingId" = m."id"
       WHERE to_tsvector('english', c."content") @@ ${tsquery}
         AND ${demoCondition('m', options)}
         AND ${dateCondition(Prisma.sql`m."meetingDate"`, options)}
       ORDER BY ts_rank_cd(to_tsvector('english', c."content"), ${tsquery}) DESC
       LIMIT ${limit})`);
  }

  if (kinds.has('MESSAGE') || kinds.has('ANNOUNCEMENT')) {
    branches.push(Prisma.sql`
      (SELECT c."id", c."chunkIndex", c."content", c."metadata", c."tokenCount",
              s."id", s."type", s."title", s."url", s."authorName", s."occurredAt", s."metadata",
              msg."id", msg."isDemo",
              ts_rank_cd(to_tsvector('english', c."content"), ${tsquery})
       FROM "message_chunks" c
       JOIN "messages" msg ON msg."id" = c."messageId"
       JOIN "sources"  s   ON s."messageId" = msg."id"
       WHERE to_tsvector('english', c."content") @@ ${tsquery}
         AND s."type" IN (${Prisma.join(
           [...kinds].filter((k) => k === 'MESSAGE' || k === 'ANNOUNCEMENT'),
         )})
         AND ${demoCondition('msg', options)}
         AND ${dateCondition(Prisma.sql`msg."messageDate"`, options)}
       ORDER BY ts_rank_cd(to_tsvector('english', c."content"), ${tsquery}) DESC
       LIMIT ${limit})`);
  }

  if (branches.length === 0) return [];

  const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT "chunkId", "chunkIndex", "content", "chunkMetadata", "tokenCount",
           "sourceId", "sourceType", "sourceTitle", "sourceUrl", "sourceAuthor",
           "sourceOccurredAt", "sourceMetadata", "referenceId", "isDemo",
           ("rank" / ("rank" + 1))::float8 AS "score"
    FROM (${Prisma.join(branches, ' UNION ALL ')}) AS combined
    ORDER BY "score" DESC
    LIMIT ${limit}
  `);
  return rows.map((row) => normalise(row, 'keyword'));
}

/** Nearest stored unanswered question, used to group paraphrases. */
export async function findSimilarUnansweredQuestion(
  prisma: PrismaClient,
  embedding: number[],
  threshold: number,
): Promise<{ id: string; similarity: number } | null> {
  const vector = toVectorLiteral(embedding);
  const rows = await prisma.$queryRaw<Array<{ id: string; similarity: number }>>(Prisma.sql`
    SELECT "id", 1 - ("embedding" <=> ${vector}::vector) AS "similarity"
    FROM "unanswered_questions"
    WHERE "embedding" IS NOT NULL
    ORDER BY "embedding" <=> ${vector}::vector
    LIMIT 1
  `);
  const best = rows[0];
  if (!best || best.similarity < threshold) return null;
  return best;
}
