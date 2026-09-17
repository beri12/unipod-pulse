import { Module } from '@nestjs/common';
import { QuestionsModule } from '../questions/questions.module';
import { RagModule } from '../rag/rag.module';
import { BotAnswerService } from './bot-answer.service';
import { BotIngestService } from './bot-ingest.service';
import { BotSecretGuard } from './bot-secret.guard';
import { BotsController } from './bots.controller';
import { TelegramBotService } from './telegram.bot';

@Module({
  imports: [RagModule, QuestionsModule],
  controllers: [BotsController],
  providers: [BotIngestService, BotAnswerService, BotSecretGuard, TelegramBotService],
  exports: [BotIngestService, BotAnswerService],
})
export class BotsModule {}
