import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { BotPipelineService } from '../bot/bot-pipeline.service.js';
import { CommandRouterService } from '../bot/commands/command-router.service.js';
import { AnswerService } from './answer.service.js';
import { CatchupService } from './catchup.service.js';
import { KnowledgeClaudeService } from './claude.service.js';
import { IngestService } from './ingest.service.js';
import { KnowledgeStoreService } from './knowledge-store.service.js';
import { knowledgeCommands } from './knowledge.commands.js';
import { KNOWLEDGE_CONFIG, loadKnowledgeConfig } from './knowledge.config.js';
import { KnowledgeController } from './knowledge.controller.js';

/**
 * Connects the knowledge base to the shared command layer:
 *
 * - every message is archived (for "what did I miss") and checked for an
 *   admin answering a question (which is learned)
 * - a question no command matched is answered from everything known, or
 *   recorded as a gap for an organiser
 */
@Injectable()
class KnowledgeWiring implements OnModuleInit {
  constructor(
    private readonly store: KnowledgeStoreService,
    private readonly ingest: IngestService,
    private readonly answer: AnswerService,
    private readonly catchup: CatchupService,
    private readonly router: CommandRouterService,
    private readonly pipeline: BotPipelineService,
  ) {}

  onModuleInit(): void {
    for (const command of knowledgeCommands({
      store: this.store,
      ingest: this.ingest,
      answer: this.answer,
      catchup: this.catchup,
    })) {
      this.router.register(command);
    }

    this.pipeline.registerObserver(async (message) => {
      await this.store.archive({
        chatId: message.chatId,
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        at: message.timestamp.toISOString(),
      });
      await this.ingest.learnFromAdminReply(message);
    });

    this.router.setAnswerer((message) => this.answer.answer(message));
  }
}

@Module({
  imports: [BotModule],
  controllers: [KnowledgeController],
  providers: [
    { provide: KNOWLEDGE_CONFIG, useFactory: () => loadKnowledgeConfig() },
    KnowledgeStoreService,
    KnowledgeClaudeService,
    IngestService,
    AnswerService,
    CatchupService,
    KnowledgeWiring,
  ],
  exports: [KnowledgeStoreService, IngestService, AnswerService],
})
export class KnowledgeModule {}
