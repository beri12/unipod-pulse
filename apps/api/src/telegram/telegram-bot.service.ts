import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { BOT_CONFIG, type BotConfig } from '../bot/bot.config.js';
import type { IncomingAudio } from '../bot/bot.types.js';
import { BotPipelineService } from '../bot/bot-pipeline.service.js';
import { DedupeService } from '../bot/dedupe.service.js';
import { TelegramApiService } from './telegram-api.service.js';
import { mapTelegramMessage } from './telegram-message.mapper.js';
import { TELEGRAM_CONFIG, type TelegramConfig } from './telegram.config.js';
import type { TelegramAudio, TelegramUpdate } from './telegram.types.js';

const POLL_ERROR_BASE_MS = 2000;
const POLL_ERROR_MAX_MS = 60_000;
/** How often to retry getMe after it failed, in ms. */
const USERNAME_RETRY_MS = 60_000;
/** How long a group's admin list is trusted before refetching. */
const ADMIN_CACHE_MS = 5 * 60_000;

/**
 * Telegram transport.
 *
 * Unlike WhatsApp, groups are officially supported here — no unofficial
 * library, no terms-of-service problem, no risk of a banned number.
 */
@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private botUsername = '';
  private offset = 0;
  private stopping = false;
  private pollFailures = 0;
  private usernameAttemptedAt = 0;
  private readonly adminCache = new Map<string, { ids: Set<string>; fetchedAt: number }>();

  constructor(
    @Inject(TELEGRAM_CONFIG) private readonly config: TelegramConfig,
    @Inject(BOT_CONFIG) private readonly botConfig: BotConfig,
    private readonly api: TelegramApiService,
    private readonly pipeline: BotPipelineService,
    private readonly dedupe: DedupeService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.log('Telegram disabled (set TELEGRAM_BOT_TOKEN to turn it on)');
      return;
    }

    await this.ensureUsername();

    if (this.config.mode === 'polling') {
      void this.pollLoop();
    } else {
      this.logger.log('Telegram in webhook mode — register your public URL with setWebhook');
    }
  }

  onModuleDestroy(): void {
    this.stopping = true;
  }

  /** Called by both the poller and the webhook controller. */
  async handleUpdate(update: TelegramUpdate): Promise<void> {
    // Edited messages are ignored on purpose: re-answering a message someone
    // fixed a typo in is noise.
    const raw = update.message;
    if (!raw) return;

    // Without its own @name the bot cannot tell whose command it is reading,
    // so it refuses group commands addressed to anyone. Keep trying to learn it.
    await this.ensureUsername();

    const message = mapTelegramMessage(raw, {
      botUsername: this.botUsername,
      commandPrefix: this.botConfig.commandPrefix,
    });
    if (!message) return;

    const { allowedChats } = this.config;
    if (allowedChats.length > 0 && !allowedChats.includes(message.chatId)) return;

    if (!this.dedupe.markIfNew(`telegram:${message.messageId}`)) return;

    if (message.isGroup) {
      message.senderIsAdmin = await this.isAdmin(message.chatId, message.senderId);
    }

    const spoken = raw.voice ?? raw.audio ?? raw.video_note;
    if (spoken) {
      message.audio = (await this.downloadAudio(spoken)) ?? undefined;
      // Audio we could not fetch and with no caption leaves nothing to act on.
      if (!message.audio && !message.text) return;
    }

    const reply = await this.pipeline.handle(message);
    if (!reply) return;

    await this.api.sendMessage(message.chatId, reply.text);
  }

  /**
   * Resolves the bot's own @username, retrying at most once a minute.
   *
   * getMe can fail at boot (no network yet, wrong token) and the bot must not
   * be stuck without an identity for the rest of the process's life.
   */
  private async ensureUsername(): Promise<void> {
    if (this.botUsername || !this.config.enabled) return;

    const now = Date.now();
    if (now - this.usernameAttemptedAt < USERNAME_RETRY_MS) return;
    this.usernameAttemptedAt = now;

    try {
      const me = await this.api.getMe();
      this.botUsername = me.username ?? '';
      this.logger.log(`Telegram connected as @${this.botUsername}`);
    } catch (error) {
      this.logger.error(`Could not reach Telegram: ${(error as Error).message}`);
    }
  }

  private async downloadAudio(spoken: TelegramAudio): Promise<IncomingAudio | null> {
    try {
      const file = await this.api.downloadFile(spoken.file_id);
      if (!file) return null;

      return {
        data: file.data,
        // Telegram voice notes are opus in an ogg container; the extension is
        // what tells the transcription API how to decode them.
        filename: spoken.file_name ?? file.filename,
        durationSeconds: spoken.duration,
      };
    } catch (error) {
      this.logger.warn(`Could not download audio: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * @returns true or false when known, undefined when Telegram could not be
   * asked — the caller must not treat "unknown" as "admin".
   */
  private async isAdmin(chatId: string, userId: string): Promise<boolean | undefined> {
    const cached = this.adminCache.get(chatId);
    if (cached && Date.now() - cached.fetchedAt < ADMIN_CACHE_MS) {
      return cached.ids.has(userId);
    }

    try {
      const administrators = await this.api.getChatAdministrators(chatId);
      const ids = new Set(administrators.map((entry) => String(entry.user.id)));
      this.adminCache.set(chatId, { ids, fetchedAt: Date.now() });
      return ids.has(userId);
    } catch (error) {
      this.logger.warn(`Could not read admins of ${chatId}: ${(error as Error).message}`);
      return undefined;
    }
  }

  private async pollLoop(): Promise<void> {
    this.logger.log('Telegram long polling started');

    while (!this.stopping) {
      try {
        const updates = await this.api.getUpdates(this.offset);
        this.pollFailures = 0;
        await this.ensureUsername();

        for (const update of updates) {
          // Advance first: a message that makes the handler throw must not be
          // fetched again forever.
          this.offset = Math.max(this.offset, update.update_id + 1);
          try {
            await this.handleUpdate(update);
          } catch (error) {
            this.logger.error(`Failed to handle update ${update.update_id}`, error as Error);
          }
        }
      } catch (error) {
        if (this.stopping) break;

        const delay = Math.min(POLL_ERROR_BASE_MS * 2 ** this.pollFailures, POLL_ERROR_MAX_MS);
        this.pollFailures += 1;
        this.logger.error(
          `Polling failed (${(error as Error).message}) — retrying in ${Math.round(delay / 1000)}s`,
        );
        await this.sleep(delay);
      }
    }

    this.logger.log('Telegram long polling stopped');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
