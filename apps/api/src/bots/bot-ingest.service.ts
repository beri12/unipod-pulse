import { Inject, Injectable } from '@nestjs/common';
import { JOB_NAMES, QUEUE_NAMES, type Env } from '@unipods/config';
import { persistMessages, type NormalizedMessage } from '@unipods/ingest';
import { StructuredLogger } from '../common/logger';
import { ENV } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import type { IngestMessageDto } from './dto/ingest.dto';

export interface BotIngestResult {
  received: number;
  imported: number;
  skipped: number;
}

/**
 * Stores messages captured live from a chat platform.
 *
 * This is the same path a message export takes — `persistMessages` then the
 * embedding queue — so a message that arrives through the Telegram bot is
 * indexed, retrieved and cited identically to one imported from a file. Keeping
 * one path means live capture cannot quietly diverge from what the evaluation
 * measures.
 *
 * De-duplication on `(channel, externalId)` makes this safely repeatable: an
 * automation that replays the same batch after a failure imports nothing twice.
 */
@Injectable()
export class BotIngestService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly logger: StructuredLogger,
  ) {}

  async ingest(messages: IngestMessageDto[]): Promise<BotIngestResult> {
    const normalised = messages.map(toNormalized);

    const persisted = await persistMessages(this.prisma, normalised, {
      isDemo: this.env.DEMO_MODE,
    });

    if (persisted.messageIds.length > 0) {
      await this.queues.enqueue(QUEUE_NAMES.MESSAGE_PROCESSING, JOB_NAMES.MESSAGE_PROCESS, {
        messageIds: persisted.messageIds,
      });
    }

    this.logger.event('log', 'bot messages ingested', {
      received: messages.length,
      imported: persisted.imported,
      skipped: persisted.skipped,
    });

    return {
      received: messages.length,
      imported: persisted.imported,
      skipped: persisted.skipped,
    };
  }
}

function toNormalized(message: IngestMessageDto): NormalizedMessage {
  return {
    externalId: message.externalId ?? null,
    channel: message.channel,
    authorName: message.authorName,
    authorId: message.authorId ?? null,
    content: message.content,
    messageDate: new Date(message.messageDate),
    replyToExternalId: message.replyToExternalId ?? null,
    isAnnouncement: message.isAnnouncement ?? false,
    metadata: {},
  };
}
