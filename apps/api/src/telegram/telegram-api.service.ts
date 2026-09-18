import { Inject, Injectable, Logger } from '@nestjs/common';
import { TELEGRAM_CONFIG, type TelegramConfig } from './telegram.config.js';
import type { TelegramUpdate, TelegramUser } from './telegram.types.js';

/**
 * Telegram Bot API over plain HTTP.
 *
 * The API is simple enough that a client library would add a dependency
 * without adding much, and this keeps the transport easy to stub in tests.
 */
@Injectable()
export class TelegramApiService {
  private readonly logger = new Logger(TelegramApiService.name);

  constructor(@Inject(TELEGRAM_CONFIG) private readonly config: TelegramConfig) {}

  get enabled(): boolean {
    return this.config.enabled;
  }

  getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>('getMe');
  }

  /**
   * Long polling. Telegram holds the request open until an update arrives or
   * `timeout` seconds pass, so this is cheap rather than a busy loop.
   */
  getUpdates(offset: number, timeoutSeconds = 25): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>(
      'getUpdates',
      { offset, timeout: timeoutSeconds, allowed_updates: ['message'] },
      // Outlive the long poll itself, or every request aborts.
      (timeoutSeconds + 10) * 1000,
    );
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.call('sendMessage', { chat_id: chatId, text });
  }

  async setWebhook(url: string, secretToken?: string): Promise<void> {
    await this.call('setWebhook', {
      url,
      secret_token: secretToken || undefined,
      allowed_updates: ['message'],
    });
  }

  async deleteWebhook(): Promise<void> {
    await this.call('deleteWebhook');
  }

  private async call<T>(
    method: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 15_000,
  ): Promise<T> {
    if (!this.config.enabled) {
      throw new Error('Telegram is not configured (set TELEGRAM_BOT_TOKEN)');
    }

    const response = await fetch(`https://api.telegram.org/bot${this.config.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const body = (await response.json()) as { ok: boolean; result?: T; description?: string };

    if (!response.ok || !body.ok) {
      // 401 here means the token is wrong or was revoked in @BotFather.
      throw new Error(
        `Telegram ${method} failed (${response.status}): ${body.description ?? 'unknown error'}`,
      );
    }
    return body.result as T;
  }
}
