import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { IngestService, type IngestRequest } from './ingest.service.js';
import { KnowledgeStoreService } from './knowledge-store.service.js';
import { KNOWLEDGE_CONFIG, type KnowledgeConfig } from './knowledge.config.js';
import type { SourceType } from './knowledge.types.js';

const TYPES: SourceType[] = ['qa', 'meeting', 'chat', 'note'];

/**
 * How call transcripts, meeting notes and documents get in.
 *
 * Protected by KNOWLEDGE_INGEST_TOKEN when set — without it anyone who can
 * reach the server could put words in the bot's mouth.
 */
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    @Inject(KNOWLEDGE_CONFIG) private readonly config: KnowledgeConfig,
    private readonly store: KnowledgeStoreService,
    private readonly ingest: IngestService,
  ) {}

  @Post('documents')
  async addDocument(
    @Body() body: Partial<IngestRequest>,
    @Headers('authorization') authorization?: string,
  ) {
    this.authorise(authorization);

    const title = body.title?.trim();
    const content = body.content?.trim();
    if (!title) throw new BadRequestException('title is required');
    if (!content) throw new BadRequestException('content is required');
    if (body.type && !TYPES.includes(body.type)) {
      throw new BadRequestException(`type must be one of: ${TYPES.join(', ')}`);
    }

    const entries = await this.ingest.ingestDocument({ ...body, title, content });
    return {
      imported: entries.length,
      title,
      ids: entries.map((entry) => entry.id),
    };
  }

  @Get('entries')
  entries(@Headers('authorization') authorization?: string) {
    this.authorise(authorization);
    return this.store.entries().map(({ content, ...rest }) => ({
      ...rest,
      preview: content.slice(0, 120),
    }));
  }

  @Get('gaps')
  gaps(@Headers('authorization') authorization?: string) {
    this.authorise(authorization);
    return this.store.openGaps();
  }

  private authorise(authorization?: string): void {
    const expected = this.config.ingestToken;
    if (!expected) return;

    if (authorization !== `Bearer ${expected}`) {
      throw new UnauthorizedException();
    }
  }
}
