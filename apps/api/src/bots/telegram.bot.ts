import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { Env } from '@unipods/config';
import { StructuredLogger } from '../common/logger';
import { ENV } from '../config/config.module';
import { BotAnswerService } from './bot-answer.service';
import { BotIngestService } from './bot-ingest.service';
import { parseAddressedQuestion } from './telegram.parse';

/** Telegram holds a long-poll open this long before returning an empty batch. */
const POLL_TIMEOUT_SECONDS = 30;
/** Back-off after a failed poll, so a network blip does not become a hot loop. */
const RETRY_DELAY_MS = 5_000;
const MAX_REPLY_CHARS = 4_096;

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number; type: string; title?: string };
  date: number;
  text?: string;
  caption?: string;
  reply_to_message?: { message_id: number; from?: TelegramUser };
  entities?: Array<{ type: string; offset: number; length: number }>;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

/**
 * A Telegram bot that sits in the community's group.
 *
 * Long polling, not webhooks, and that is deliberate: a webhook needs a public
 * HTTPS URL, which a laptop does not have. Polling works from anywhere,
 * including behind a home router, so the bot is demonstrable without tunnels.
 *
 * It does two jobs at once. Every group message is stored, which is what makes
 * "what did I miss?" answerable at all. And when someone addresses the bot, it
 * answers from the same knowledge base the web app uses, with the same
 * citations and the same refusal when the answer is not there — the bot cannot
 * be more confident than the product.
 *
 * With no `TELEGRAM_BOT_TOKEN` set the service starts and does nothing, so the
 * API runs unchanged for anyone not using Telegram.
 */
@Injectable()
export class TelegramBotService implements OnModuleInit, OnApplicationShutdown {
  private offset = 0;
  private running = false;
  private botUsername: string | null = null;
  private loop: Promise<void> | null = null;
  private controller: AbortController | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly ingest: BotIngestService,
    private readonly answers: BotAnswerService,
    private readonly logger: StructuredLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.env.TELEGRAM_BOT_TOKEN) return;

    const me = await this.call<TelegramUser>('getMe').catch((error: Error) => {
      this.logger.event('warn', 'telegram bot could not start', { reason: error.message });
      return null;
    });
    if (!me) return;

    this.botUsername = me.username ?? null;
    this.running = true;
    this.loop = this.poll();

    this.logger.event('log', 'telegram bot started', {
      username: this.botUsername,
      allowedChats: this.env.TELEGRAM_ALLOWED_CHATS.length || 'all',
    });
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    this.controller?.abort();
    await this.loop?.catch(() => undefined);
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.call<TelegramUpdate[]>('getUpdates', {
          offset: this.offset,
          timeout: POLL_TIMEOUT_SECONDS,
          allowed_updates: ['message', 'channel_post'],
        });

        for (const update of updates) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          const message = update.message ?? update.channel_post;
          if (!message) continue;
          // One bad message must not stop the bot reading the rest.
          await this.handle(message).catch((error: Error) => {
            this.logger.event('warn', 'telegram message failed', { reason: error.message });
          });
        }
      } catch (error) {
        if (!this.running) return;
        this.logger.event('warn', 'telegram poll failed', { reason: (error as Error).message });
        await delay(RETRY_DELAY_MS);
      }
    }
  }

  private async handle(message: TelegramMessage): Promise<void> {
    const text = (message.text ?? message.caption ?? '').trim();
    if (!text) return;
    if (message.from?.is_bot) return;
    if (!this.chatAllowed(message.chat.id)) return;

    const channel = message.chat.title ?? `telegram:${message.chat.id}`;
    const question = parseAddressedQuestion(text, {
      botUsername: this.botUsername,
      chatType: message.chat.type,
      replyToBot: message.reply_to_message?.from?.is_bot === true,
    });

    // Stored first, and always — including questions. A question asked in the
    // group is part of the group's record, and storing it before answering
    // means the answer cannot cite a message the archive does not have.
    await this.ingest.ingest([
      {
        externalId: `tg:${message.chat.id}:${message.message_id}`,
        channel,
        authorName: displayName(message.from),
        ...(message.from ? { authorId: String(message.from.id) } : {}),
        content: text,
        messageDate: new Date(message.date * 1000).toISOString(),
        ...(message.reply_to_message
          ? { replyToExternalId: `tg:${message.chat.id}:${message.reply_to_message.message_id}` }
          : {}),
      },
    ]);

    if (question === null) return;

    const answer = await this.answers.answer(question, { channel });
    await this.reply(message, answer.text);
  }

  private chatAllowed(chatId: number): boolean {
    const allowed = this.env.TELEGRAM_ALLOWED_CHATS;
    return allowed.length === 0 || allowed.includes(String(chatId));
  }

  private async reply(message: TelegramMessage, text: string): Promise<void> {
    await this.call('sendMessage', {
      chat_id: message.chat.id,
      reply_to_message_id: message.message_id,
      text: text.slice(0, MAX_REPLY_CHARS),
      disable_web_page_preview: true,
    });
  }

  private async call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    this.controller = new AbortController();
    const response = await fetch(
      `https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/${method}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: this.controller.signal,
      },
    );

    const payload = (await response.json()) as { ok: boolean; result?: T; description?: string };
    if (!payload.ok) {
      throw new Error(payload.description ?? `Telegram ${method} failed (${response.status})`);
    }
    return payload.result as T;
  }
}

function displayName(user: TelegramUser | undefined): string {
  if (!user) return 'Unknown';
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || user.username || `user${user.id}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
