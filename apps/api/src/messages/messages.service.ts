import { Inject, Injectable } from '@nestjs/common';
import { JOB_NAMES, QUEUE_NAMES, type Env } from '@unipods/config';
import { MessageImportError, persistMessages, resolveImporter } from '@unipods/ingest';
import type { MessageDto, MessageImportResult, Paginated } from '@unipods/types';
import { AppException, ERROR_CODES } from '../common/errors';
import { decodeTextUpload, validateUpload, type UploadedFile } from '../common/file-validation';
import { StructuredLogger } from '../common/logger';
import { ENV } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import type { ImportMessagesDto, ListMessagesQueryDto } from './dto/messages.dto';

const IMPORT_EXTENSIONS = ['.json', '.csv', '.txt'] as const;
const IMPORT_MIME_TYPES = [
  'application/json',
  'text/json',
  'text/csv',
  'application/csv',
  'text/plain',
  'application/octet-stream',
] as const;

@Injectable()
export class MessagesService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * Parses and stores an export, then queues chunking and embedding.
   *
   * Parsing happens inline so the uploader immediately learns how many rows
   * were read, imported and skipped, and why — a silent background failure on a
   * malformed export is far more frustrating than a slightly slower request.
   */
  async import(
    file: UploadedFile | undefined,
    dto: ImportMessagesDto,
  ): Promise<MessageImportResult> {
    const validated = validateUpload(file, {
      mimeTypes: IMPORT_MIME_TYPES,
      extensions: IMPORT_EXTENSIONS,
      maxBytes: Math.min(this.env.MAX_FILE_SIZE, 50 * 1024 * 1024),
      label: 'message export',
    });
    const content = decodeTextUpload(validated);

    try {
      const importer = resolveImporter(dto.format, validated.originalname);
      const outcome = await importer.import(content, {
        ...(dto.channel ? { channel: dto.channel } : {}),
        ...(dto.markAsAnnouncement !== undefined
          ? { markAsAnnouncement: dto.markAsAnnouncement }
          : {}),
      });

      const persisted = await persistMessages(this.prisma, outcome.messages, {
        isDemo: this.env.DEMO_MODE,
      });

      if (persisted.messageIds.length > 0) {
        await this.queues.enqueue(QUEUE_NAMES.MESSAGE_PROCESSING, JOB_NAMES.MESSAGE_PROCESS, {
          messageIds: persisted.messageIds,
        });
      }

      this.logger.event('log', 'messages imported', {
        format: importer.format,
        parsed: outcome.messages.length,
        imported: persisted.imported,
        skipped: persisted.skipped,
      });

      return {
        format: importer.format,
        channel: dto.channel ?? outcome.messages[0]?.channel ?? '',
        parsed: outcome.messages.length,
        imported: persisted.imported,
        skipped: persisted.skipped,
        warnings: outcome.warnings.slice(0, 25),
      };
    } catch (error) {
      if (error instanceof MessageImportError) {
        throw AppException.badRequest(error.message, ERROR_CODES.MESSAGE_IMPORT_FAILED);
      }
      throw error;
    }
  }

  async list(query: ListMessagesQueryDto): Promise<Paginated<MessageDto>> {
    const where = {
      ...this.demoScope(),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.announcementsOnly ? { isAnnouncement: true } : {}),
      ...(query.search ? { content: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: { messageDate: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.message.count({ where }),
    ]);

    return {
      items: rows.map(toMessageDto),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async channels(): Promise<Array<{ channel: string; count: number }>> {
    const rows = await this.prisma.message.groupBy({
      by: ['channel'],
      where: this.demoScope(),
      _count: { _all: true },
      orderBy: { _count: { channel: 'desc' } },
    });
    return rows.map((row) => ({ channel: row.channel, count: row._count._all }));
  }

  async remove(id: string): Promise<void> {
    const message = await this.prisma.message.findUnique({ where: { id } });
    if (!message) throw AppException.notFound('That message');
    await this.prisma.message.delete({ where: { id } });
  }

  private demoScope(): { isDemo?: boolean } {
    return this.env.DEMO_MODE ? { isDemo: true } : { isDemo: false };
  }
}

export function toMessageDto(message: {
  id: string;
  externalId: string | null;
  channel: string;
  authorName: string;
  authorId: string | null;
  content: string;
  messageDate: Date;
  replyToId: string | null;
  isAnnouncement: boolean;
  isDemo: boolean;
  metadata: unknown;
}): MessageDto {
  return {
    id: message.id,
    externalId: message.externalId,
    channel: message.channel,
    authorName: message.authorName,
    authorId: message.authorId,
    content: message.content,
    messageDate: message.messageDate.toISOString(),
    replyToId: message.replyToId,
    isAnnouncement: message.isAnnouncement,
    isDemo: message.isDemo,
    metadata: (message.metadata ?? {}) as Record<string, unknown>,
  };
}
