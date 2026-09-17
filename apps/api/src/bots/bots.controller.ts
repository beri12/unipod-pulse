import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { BotAnswerService } from './bot-answer.service';
import { BotIngestService } from './bot-ingest.service';
import { BOT_SECRET_HEADER, BotSecretGuard } from './bot-secret.guard';
import { BotAskDto, IngestMessagesDto } from './dto/ingest.dto';

/**
 * The seam automation talks to.
 *
 * Two routes, both machine-to-machine: post what the group said, and ask what
 * the group knows. n8n uses these; the built-in Telegram bot calls the same
 * services directly. Keeping both on one pair of operations means a workflow
 * and the bundled bot cannot drift apart in behaviour.
 */
@ApiTags('bots')
@ApiHeader({ name: BOT_SECRET_HEADER, description: 'Shared secret (BOT_INGEST_SECRET)', required: true })
@Public()
@UseGuards(BotSecretGuard)
@Controller('ingest')
export class BotsController {
  constructor(
    private readonly ingest: BotIngestService,
    private readonly answers: BotAnswerService,
  ) {}

  @Post('message')
  @ApiOperation({
    summary: 'Store messages captured from a chat platform',
    description:
      'De-duplicates on (channel, externalId), so replaying a batch is safe. Indexing is queued; the response reports what was stored.',
  })
  ingestMessages(@Body() dto: IngestMessagesDto) {
    return this.ingest.ingest(dto.messages);
  }

  @Post('ask')
  @ApiOperation({
    summary: 'Answer a question asked in a group chat',
    description:
      'Returns the grounded answer with its sources, already formatted for posting back into a chat. Refuses when the knowledge base has no answer.',
  })
  ask(@Body() dto: BotAskDto) {
    return this.answers.answer(dto.question, { channel: dto.channel ?? 'bot' });
  }
}
