import { Controller, HttpCode, Inject, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TelegramBotService } from './telegram-bot.service.js';
import { TELEGRAM_CONFIG, type TelegramConfig } from './telegram.config.js';
import type { TelegramUpdate } from './telegram.types.js';

@Controller('telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(
    @Inject(TELEGRAM_CONFIG) private readonly config: TelegramConfig,
    private readonly bot: TelegramBotService,
  ) {}

  /**
   * Inbound updates in webhook mode. Always answers 200 — Telegram retries any
   * other status, and a retry storm is worse than one dropped update.
   */
  @Post('webhook')
  @HttpCode(200)
  async receive(@Req() request: Request): Promise<string> {
    const { webhookSecret } = this.config;

    if (webhookSecret) {
      // Telegram echoes back the secret given to setWebhook, which is what
      // stops anyone else POSTing to a public URL.
      const provided = request.headers['x-telegram-bot-api-secret-token'];
      if (provided !== webhookSecret) {
        this.logger.warn('Rejected a Telegram update with a bad secret token');
        return 'OK';
      }
    }

    try {
      await this.bot.handleUpdate(request.body as TelegramUpdate);
    } catch (error) {
      this.logger.error('Failed to handle a Telegram update', error as Error);
    }
    return 'OK';
  }
}
