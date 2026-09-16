import { Prisma, type PrismaClient } from '../generated/client';
import { toVectorLiteral } from './vector';

/**
 * Writes embeddings for chunks that Prisma cannot type. Runs as a single
 * multi-row UPDATE ... FROM so a batch costs one round trip.
 */
async function writeEmbeddings(
  prisma: PrismaClient,
  table: Prisma.Sql,
  rows: Array<{ id: string; embedding: number[] }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const values = Prisma.join(
    rows.map((row) => Prisma.sql`(${row.id}::uuid, ${toVectorLiteral(row.embedding)}::vector)`),
  );
  const result = await prisma.$executeRaw(Prisma.sql`
    UPDATE ${table} AS t
    SET "embedding" = v."embedding"
    FROM (VALUES ${values}) AS v("id", "embedding")
    WHERE t."id" = v."id"
  `);
  return result;
}

export function setDocumentChunkEmbeddings(
  prisma: PrismaClient,
  rows: Array<{ id: string; embedding: number[] }>,
): Promise<number> {
  return writeEmbeddings(prisma, Prisma.sql`"document_chunks"`, rows);
}

export function setMeetingChunkEmbeddings(
  prisma: PrismaClient,
  rows: Array<{ id: string; embedding: number[] }>,
): Promise<number> {
  return writeEmbeddings(prisma, Prisma.sql`"meeting_chunks"`, rows);
}

export function setMessageChunkEmbeddings(
  prisma: PrismaClient,
  rows: Array<{ id: string; embedding: number[] }>,
): Promise<number> {
  return writeEmbeddings(prisma, Prisma.sql`"message_chunks"`, rows);
}

export async function setUnansweredQuestionEmbedding(
  prisma: PrismaClient,
  id: string,
  embedding: number[],
): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "unanswered_questions"
    SET "embedding" = ${toVectorLiteral(embedding)}::vector
    WHERE "id" = ${id}::uuid
  `);
}

/** Counts chunks that still need an embedding, per table. */
export async function countPendingEmbeddings(prisma: PrismaClient): Promise<{
  documents: number;
  meetings: number;
  messages: number;
}> {
  const rows = await prisma.$queryRaw<Array<{ documents: bigint; meetings: bigint; messages: bigint }>>(
    Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM "document_chunks" WHERE "embedding" IS NULL) AS "documents",
        (SELECT COUNT(*) FROM "meeting_chunks"  WHERE "embedding" IS NULL) AS "meetings",
        (SELECT COUNT(*) FROM "message_chunks"  WHERE "embedding" IS NULL) AS "messages"
    `,
  );
  const row = rows[0];
  return {
    documents: Number(row?.documents ?? 0),
    meetings: Number(row?.meetings ?? 0),
    messages: Number(row?.messages ?? 0),
  };
}

/** Total embedded knowledge chunks — surfaced on the admin dashboard. */
export async function countKnowledgeChunks(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM "document_chunks") +
      (SELECT COUNT(*) FROM "meeting_chunks") +
      (SELECT COUNT(*) FROM "message_chunks") AS "total"
  `);
  return Number(rows[0]?.total ?? 0);
}
