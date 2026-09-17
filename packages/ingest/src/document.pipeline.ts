import { chunkSegments, type ChunkSegment } from '@unipods/ai';
import { withHeader } from './context-header';
import { setDocumentChunkEmbeddings } from '@unipods/database';
import { describeFailure } from './failure';
import { noopLogger, type IngestDeps, type PipelineResult } from './deps';
import { DocumentExtractionError, resolveParser } from './parsers';

/** A PROCESSING claim older than this is treated as abandoned. */
const STALE_CLAIM_MS = 15 * 60 * 1000;

interface DocumentChunkMetadata extends Record<string, unknown> {
  source: 'document';
  page?: number;
  section?: string;
}

/**
 * Upload -> extract -> clean -> chunk -> embed -> pgvector.
 *
 * The document's `status` column is advanced at each stage so the UI can show
 * real progress, and a failure records *why* in `statusMessage` instead of
 * leaving the row stuck on PROCESSING.
 */
export async function processDocument(
  deps: IngestDeps,
  documentId: string,
): Promise<PipelineResult> {
  const { prisma, embeddings, storage } = deps;
  const logger = deps.logger ?? noopLogger;

  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) {
    return { ok: false, chunks: 0, embedded: 0, message: 'Document no longer exists.' };
  }
  if (!document.storageKey) {
    await fail(deps, documentId, 'This document has no stored file to process.');
    return { ok: false, chunks: 0, embedded: 0, message: 'No stored file.' };
  }

  // Claim the document before doing any work. Two processors running at once —
  // a queue retry racing a manual reprocess, say — would each delete the
  // other's chunks halfway through and collide on (documentId, chunkIndex).
  // A stale claim is reclaimable so a crashed worker cannot block the document
  // forever.
  const claimed = await prisma.document.updateMany({
    where: {
      id: documentId,
      OR: [
        { status: { not: 'PROCESSING' } },
        { updatedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } },
      ],
    },
    data: { status: 'PROCESSING', statusMessage: null },
  });
  if (claimed.count === 0) {
    logger.info('document already being processed', { documentId });
    return {
      ok: true,
      chunks: 0,
      embedded: 0,
      message: 'Another processor is already working on this document.',
    };
  }

  try {
    const buffer = await storage.download(document.storageKey);
    const parser = resolveParser(document.mimeType ?? '', document.originalFileName ?? '');
    const extracted = await parser.extract(buffer, document.originalFileName ?? 'document');

    if (extracted.text.trim().length === 0) {
      throw new DocumentExtractionError('No readable text was found in this document.');
    }

    const segments: Array<ChunkSegment<DocumentChunkMetadata>> = extracted.pages.map((page) => ({
      text: page.text,
      metadata: {
        source: 'document',
        ...(page.page !== undefined ? { page: page.page } : {}),
        ...(page.section !== undefined ? { section: page.section } : {}),
      },
    }));

    const chunks = chunkSegments(segments, deps.chunking);
    if (chunks.length === 0) {
      throw new DocumentExtractionError('This document produced no indexable content.');
    }

    // Contextual header: a chunk taken out of the middle of a file loses every
    // clue about what it belongs to, which both retrievers need. "Judging
    // criteria" only matches a question about the hackathon if the chunk says
    // which document it came from.
    const withContext = chunks.map((chunk) => ({
      ...chunk,
      content: withHeader(
        [document.title, typeof chunk.metadata.section === 'string' ? chunk.metadata.section : null],
        chunk.content,
      ),
    }));

    // Re-processing replaces the previous index for this document atomically,
    // so a retry can never leave a mix of old and new chunks behind.
    await prisma.$transaction([
      prisma.documentChunk.deleteMany({ where: { documentId } }),
      prisma.documentChunk.createMany({
        data: withContext.map((chunk) => ({
          documentId,
          content: chunk.content,
          chunkIndex: chunk.chunkIndex,
          tokenCount: chunk.tokenCount,
          metadata: { ...chunk.metadata, chunkIndex: chunk.chunkIndex },
        })),
      }),
    ]);

    const stored = await prisma.documentChunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: 'asc' },
      select: { id: true, content: true },
    });

    const vectors = await embeddings.embedTexts(stored.map((chunk) => chunk.content));
    const embedded = await setDocumentChunkEmbeddings(
      prisma,
      stored.map((chunk, index) => ({ id: chunk.id, embedding: vectors[index] as number[] })),
    );

    const pageCount =
      typeof extracted.metadata.pageCount === 'number'
        ? extracted.metadata.pageCount
        : extracted.pages.filter((page) => page.page !== undefined).length || null;

    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: 'COMPLETED',
        statusMessage: null,
        pageCount,
      },
    });

    await prisma.source.upsert({
      where: { type_referenceId: { type: 'DOCUMENT', referenceId: documentId } },
      create: {
        type: 'DOCUMENT',
        title: document.title,
        referenceId: documentId,
        documentId,
        occurredAt: document.publishedAt ?? document.createdAt,
        metadata: { pageCount, fileName: document.originalFileName },
      },
      update: {
        title: document.title,
        occurredAt: document.publishedAt ?? document.createdAt,
        metadata: { pageCount, fileName: document.originalFileName },
      },
    });

    logger.info('document processed', { documentId, chunks: chunks.length, embedded });
    return { ok: true, chunks: chunks.length, embedded };
  } catch (error) {
    // What the uploader is told and what is logged are not the same thing: a
    // raw error carries server paths and SQL fragments that help nobody
    // outside the system.
    const { userMessage, logDetail } = describeFailure(error);
    logger.error('document processing failed', { documentId, reason: logDetail });
    await fail(deps, documentId, userMessage);
    return { ok: false, chunks: 0, embedded: 0, message: userMessage };
  }
}

async function fail(deps: IngestDeps, documentId: string, message: string): Promise<void> {
  await deps.prisma.document.update({
    where: { id: documentId },
    data: { status: 'FAILED', statusMessage: message.slice(0, 500) },
  });
}
