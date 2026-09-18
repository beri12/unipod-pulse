import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { BotPipelineService } from '../bot/bot-pipeline.service.js';
import { CommandRouterService } from '../bot/commands/command-router.service.js';
import { FaqMatcherService } from './faq-matcher.service.js';
import { FaqStoreService } from './faq-store.service.js';
import { faqCommands } from './faq.commands.js';
import { FAQ_CONFIG, loadFaqConfig } from './faq.config.js';
import { FaqService } from './faq.service.js';

/**
 * Plugs the learned-answers feature into the shared command layer: it watches
 * every message for something to learn, and answers questions no command
 * matched.
 */
@Injectable()
class FaqWiring implements OnModuleInit {
  constructor(
    private readonly faq: FaqService,
    private readonly router: CommandRouterService,
    private readonly pipeline: BotPipelineService,
  ) {}

  onModuleInit(): void {
    for (const command of faqCommands(this.faq)) this.router.register(command);
    this.pipeline.registerObserver((message) => this.faq.observe(message));
    this.router.setAnswerer((message) => this.faq.answer(message));
  }
}

@Module({
  imports: [BotModule],
  providers: [
    { provide: FAQ_CONFIG, useFactory: () => loadFaqConfig() },
    FaqStoreService,
    FaqMatcherService,
    FaqService,
    FaqWiring,
  ],
  exports: [FaqService],
})
export class FaqModule {}
