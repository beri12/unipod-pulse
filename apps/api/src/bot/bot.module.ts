import { Module } from '@nestjs/common';
import { BOT_CONFIG, loadBotConfig } from './bot.config.js';
import { BotController } from './bot.controller.js';
import { CommandRouterService } from './commands/command-router.service.js';
import { DedupeService } from './dedupe.service.js';
import { MessageLogService } from './message-log.service.js';

/**
 * Transport-independent half of the bot: what a command means and what the
 * answer is. WhatsApp and Telegram both import this and supply only the
 * plumbing for their own protocol.
 */
@Module({
  controllers: [BotController],
  providers: [
    { provide: BOT_CONFIG, useFactory: () => loadBotConfig() },
    // Built by hand: the TTL constructor argument is not injectable.
    { provide: DedupeService, useFactory: () => new DedupeService() },
    MessageLogService,
    CommandRouterService,
  ],
  exports: [CommandRouterService, DedupeService, MessageLogService, BOT_CONFIG],
})
export class BotModule {}
