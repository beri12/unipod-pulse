import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { TelegramApiService } from './telegram-api.service.js';
import { TelegramBotService } from './telegram-bot.service.js';
import { TelegramWebhookController } from './telegram-webhook.controller.js';
import { TELEGRAM_CONFIG, loadTelegramConfig } from './telegram.config.js';

/**
 * Telegram plumbing only — what a command means lives in BotModule, so every
 * command written for WhatsApp works here unchanged.
 */
@Module({
  imports: [BotModule],
  controllers: [TelegramWebhookController],
  providers: [
    { provide: TELEGRAM_CONFIG, useFactory: () => loadTelegramConfig() },
    TelegramApiService,
    TelegramBotService,
  ],
  exports: [TelegramApiService],
})
export class TelegramModule {}
