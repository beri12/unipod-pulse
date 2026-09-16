import { Inject, Injectable } from '@nestjs/common';
import { JOB_NAMES, QUEUE_NAMES, type Env } from '@unipods/config';
import type {
  DocumentDetail,
  DocumentDto,
  DocumentType,
  Paginated,
  ProcessingStatus,
  SourceLocator,
} from '@unipods/types';
import { AppException, ERROR_CODES } from '../common/errors';
import { validateUpload, type UploadedFile } from '../common/file-validation';
import { StructuredLogger } from '../common/logger';
import { ENV } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { StorageService } from '../storage/storage.service';
import { SourcesService } from '../sources/sources.service';
import type { CreateDocumentDto, ListDocumentsQueryDto } from './dto/documents.dto';

const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.markdown'] as const;
const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/octet-stream',
] as const;

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queues: QueueService,
    private readonly sources: SourcesService,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * Stores the file, records it as PENDING and hands processing to the worker.
   * The request returns as soon as the bytes are safe — extraction, chunking
   * and embedding never run inside an HTTP request.
   */
  async upload(
    userId: string,
    file: UploadedFile | undefined,
    dto: CreateDocumentDto,
  ): Promise<DocumentDto> {
    const validated = validateUpload(file, {
      mimeTypes: DOCUMENT_MIME_TYPES,
      extensions: DOCUMENT_EXTENSIONS,
      maxBytes: this.env.MAX_FILE_SIZE,
      label: 'document',
    });

    const stored = await this.storage.upload(
      'documents',
      validated.originalname,
      validated.buffer,
      validated.mimetype,
    );

    const document = await this.prisma.document.create({
      data: {
        title: (dto.title?.trim() || stripExtension(validated.originalname)).slice(0, 300),
        description: dto.description?.trim() || null,
        type: documentTypeFor(validated.originalname, validated.mimetype),
        sourceType: 'DOCUMENT',
        originalFileName: validated.originalname,
        storageKey: stored.key,
        mimeType: validated.mimetype,
        fileSize: validated.size,
        status: 'PENDING',
        publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : null,
        isDemo: this.env.DEMO_MODE,
        createdById: userId,
      },
      include: documentInclude,
    });

    // The Source row exists from the start so the document is addressable even
    // while it is still processing.
    await this.sources.upsert({
      type: 'DOCUMENT',
      title: document.title,
      referenceId: document.id,
      documentId: document.id,
      occurredAt: document.publishedAt ?? document.createdAt,
      metadata: { fileName: document.originalFileName },
    });

    await this.enqueueProcessing(document.id);
    this.logger.event('log', 'document uploaded', {
      documentId: document.id,
      bytes: validated.size,
    });

    return toDocumentDto(document);
  }

  async enqueueProcessing(documentId: string): Promise<void> {
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'PENDING', statusMessage: 'Queued for processing…' },
    });
    // A stable job id makes re-queuing the same document idempotent while the
    // previous attempt is still waiting.
    await this.queues.enqueue(
      QUEUE_NAMES.DOCUMENT_PROCESSING,
      JOB_NAMES.DOCUMENT_PROCESS,
      { documentId },
      { jobId: `document-${documentId}` },
    );
  }

  async reprocess(documentId: string): Promise<DocumentDto> {
    const document = await this.requireDocument(documentId);
    if (!document.storageKey) {
      throw AppException.badRequest(
        'This document has no stored file, so it cannot be reprocessed.',
        ERROR_CODES.DOCUMENT_PROCESSING_FAILED,
      );
    }
    await this.enqueueProcessing(documentId);
    return this.byId(documentId).then((detail) => detail);
  }

  async list(query: ListDocumentsQueryDto): Promise<Paginated<DocumentDto>> {
    const where = {
      ...this.demoScope(),
      ...(query.status ? { status: query.status as ProcessingStatus } : {}),
      ...(query.type ? { type: query.type as DocumentType } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' as const } },
              { description: { contains: query.search, mode: 'insensitive' as const } },
              { originalFileName: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
        include: documentInclude,
      }),
      this.prisma.document.count({ where }),
    ]);

    return {
      items: rows.map(toDocumentDto),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async byId(id: string): Promise<DocumentDetail> {
    const document = await this.prisma.document.findUnique({
      where: { id },
      include: {
        ...documentInclude,
        chunks: {
          orderBy: { chunkIndex: 'asc' },
          select: {
            id: true,
            chunkIndex: true,
            content: true,
            tokenCount: true,
            metadata: true,
          },
        },
      },
    });
    if (!document) throw AppException.notFound('That document');

    const embeddedIds = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "document_chunks" WHERE "documentId" = ${id}::uuid AND "embedding" IS NOT NULL
    `;
    const embedded = new Set(embeddedIds.map((row) => row.id));

    return {
      ...toDocumentDto(document),
      embeddedChunkCount: embedded.size,
      chunks: document.chunks.map((chunk) => ({
        id: chunk.id,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        metadata: (chunk.metadata ?? {}) as SourceLocator,
        hasEmbedding: embedded.has(chunk.id),
      })),
      downloadUrl: document.storageKey ? await this.storage.signedUrl(document.storageKey) : null,
    };
  }

  async remove(id: string): Promise<void> {
    const document = await this.requireDocument(id);
    if (document.storageKey) await this.storage.delete(document.storageKey);
    // Chunks and the Source row cascade from the document row.
    await this.prisma.document.delete({ where: { id } });
    this.logger.event('log', 'document deleted', { documentId: id });
  }

  private async requireDocument(id: string) {
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document) throw AppException.notFound('That document');
    return document;
  }

  /** Demo and real content are kept apart everywhere, listings included. */
  private demoScope(): { isDemo?: boolean } {
    return this.env.DEMO_MODE ? { isDemo: true } : { isDemo: false };
  }
}

const documentInclude = {
  createdBy: { select: { id: true, name: true } },
  _count: { select: { chunks: true } },
} as const;

type DocumentRow = {
  id: string;
  title: string;
  description: string | null;
  type: DocumentType;
  sourceType: 'DOCUMENT' | 'MEETING' | 'MESSAGE' | 'ANNOUNCEMENT';
  originalFileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  status: ProcessingStatus;
  statusMessage: string | null;
  pageCount: number | null;
  publishedAt: Date | null;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { id: string; name: string } | null;
  _count: { chunks: number };
};

export function toDocumentDto(document: DocumentRow): DocumentDto {
  return {
    id: document.id,
    title: document.title,
    description: document.description,
    type: document.type,
    sourceType: document.sourceType,
    originalFileName: document.originalFileName,
    mimeType: document.mimeType,
    fileSize: document.fileSize,
    status: document.status,
    statusMessage: document.statusMessage,
    pageCount: document.pageCount,
    publishedAt: document.publishedAt ? document.publishedAt.toISOString() : null,
    chunkCount: document._count.chunks,
    // Filled in by `byId`; a listing does not pay for the extra query.
    embeddedChunkCount: 0,
    isDemo: document.isDemo,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    createdBy: document.createdBy,
  };
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || fileName;
}

export function documentTypeFor(fileName: string, mimeType: string): DocumentType {
  const lower = fileName.toLowerCase();
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) return 'PDF';
  if (lower.endsWith('.docx') || mimeType.includes('wordprocessingml')) return 'DOCX';
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || mimeType.includes('markdown')) {
    return 'MARKDOWN';
  }
  if (lower.endsWith('.txt') || mimeType === 'text/plain') return 'TXT';
  return 'OTHER';
}
