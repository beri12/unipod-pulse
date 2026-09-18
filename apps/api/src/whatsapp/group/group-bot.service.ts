import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Client, GroupChat, Message } from 'whatsapp-web.js';
import { BotPipelineService } from '../../bot/bot-pipeline.service.js';
import type { IncomingAudio, IncomingMessage } from '../../bot/bot.types.js';
import { DedupeService } from '../../bot/dedupe.service.js';
import { WHATSAPP_CONFIG, type WhatsappConfig } from '../whatsapp.config.js';

const GROUP_SUFFIX = '@g.us';
/** How long a group's admin list is trusted before refetching. */
const ADMIN_CACHE_MS = 5 * 60_000;
/** How long to wait for a QR or a live connection before saying something. */
const HANDSHAKE_WARN_MS = 60_000;
const RETRY_BASE_MS = 10_000;
const RETRY_MAX_MS = 5 * 60_000;
/** Message types worth transcribing: a voice note, or an audio file. */
const AUDIO_TYPES = new Set(['ptt', 'audio']);

/** "212600000000@c.us" -> "212600000000" */
const bareId = (id?: string | null): string => id?.split('@')[0]?.split(':')[0] ?? '';

/**
 * WhatsApp group bot, built on whatsapp-web.js.
 *
 * It drives a real WhatsApp Web session in Chromium, logged in as a LINKED
 * DEVICE of a normal account - the same thing you do when you open
 * web.whatsapp.com. That is how it can see group messages at all; the official
 * Cloud API cannot. It is against WhatsApp's Terms of Service and the number
 * can be banned, so use a dedicated SIM, never a personal one.
 *
 * Disabled unless WHATSAPP_GROUP_BOT_ENABLED=true.
 */
@Injectable()
export class GroupBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GroupBotService.name);
  private client?: Client;
  private handshakeTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private retries = 0;
  private stopping = false;
  private readonly adminCache = new Map<string, { ids: Set<string>; fetchedAt: number }>();

  constructor(
    @Inject(WHATSAPP_CONFIG) private readonly config: WhatsappConfig,
    private readonly pipeline: BotPipelineService,
    private readonly dedupe: DedupeService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.group.enabled) {
      this.logger.log('Group bot disabled (set WHATSAPP_GROUP_BOT_ENABLED=true to turn it on)');
      return;
    }
    await this.start();
  }

  /**
   * WhatsApp being unreachable must never take the process down: Telegram, the
   * webhooks and the knowledge endpoints keep working while this retries.
   */
  private async start(): Promise<void> {
    try {
      await this.connect();
      this.retries = 0;
    } catch (error) {
      this.clearHandshakeWatchdog();
      await this.client?.destroy().catch(() => undefined);
      this.client = undefined;

      this.logger.error(`Could not start WhatsApp Web: ${(error as Error).message}`);
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (this.stopping) return;

    const delay = Math.min(RETRY_BASE_MS * 2 ** this.retries, RETRY_MAX_MS);
    this.retries += 1;
    this.logger.warn(`Retrying WhatsApp in ${Math.round(delay / 1000)}s`);

    this.retryTimer = setTimeout(() => void this.start(), delay);
    // Do not hold the process open just for a retry.
    this.retryTimer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.clearHandshakeWatchdog();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    // destroy() closes Chromium without logging out, so the session stays
    // valid and no QR rescan is needed on the next boot.
    await this.client?.destroy().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    // Imported lazily: whatsapp-web.js launches Chromium and pulls in
    // Puppeteer, which nothing else needs when the group bot is off.
    //
    // It is CommonJS (`export = WAWebJS`), and Node's named-export detection
    // finds `Client` but not `LocalAuth`, so take both off the module object.
    const wwebjs = await import('whatsapp-web.js');
    const { Client, LocalAuth } = wwebjs.default ?? wwebjs;
    const { default: qrcode } = await import('qrcode-terminal');

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: this.config.group.sessionPath }),
      puppeteer: {
        headless: true,
        ...(this.config.group.chromePath ? { executablePath: this.config.group.chromePath } : {}),
        // Required in containers, where Chromium's sandbox cannot start and
        // /dev/shm is too small for it.
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
    });
    this.client = client;
    this.startHandshakeWatchdog();

    client.on('qr', (qr) => {
      this.clearHandshakeWatchdog();
      this.logger.warn('Scan this QR in WhatsApp -> Settings -> Linked devices');
      qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
      this.clearHandshakeWatchdog();
      this.logger.log(`Group bot connected as ${client.info?.wid?._serialized ?? 'unknown'}`);
    });

    client.on('auth_failure', (reason) => {
      this.clearHandshakeWatchdog();
      this.logger.error(
        `Authentication failed (${reason}). Delete "${this.config.group.sessionPath}" and scan the QR again.`,
      );
    });

    client.on('disconnected', (reason) => {
      this.logger.warn(`Disconnected (${reason})`);
      // whatsapp-web.js reconnects by itself unless the session was revoked,
      // in which case a rescan is the only fix.
      if (!this.stopping && String(reason).toUpperCase().includes('LOGOUT')) {
        this.logger.error(
          `Logged out by WhatsApp. Delete "${this.config.group.sessionPath}" and scan the QR again.`,
        );
      }
    });

    client.on('message', (message) => {
      void this.onMessage(message).catch((error) =>
        this.logger.error('Failed to handle a WhatsApp message', error as Error),
      );
    });

    this.logger.log('Starting WhatsApp Web (this takes a moment the first time)...');
    await client.initialize();
  }

  private async onMessage(raw: Message): Promise<void> {
    const client = this.client;
    if (!client) return;
    if (raw.fromMe) return; // never answer ourselves

    const chatId = raw.from;
    const isGroup = chatId.endsWith(GROUP_SUFFIX);
    const { allowedGroups } = this.config.group;
    if (isGroup && allowedGroups.length > 0 && !allowedGroups.includes(chatId)) return;

    const messageId = raw.id?._serialized ?? '';
    if (messageId && !this.dedupe.markIfNew(`whatsapp:${messageId}`)) return;

    const audio = AUDIO_TYPES.has(raw.type) ? await this.downloadAudio(raw) : undefined;
    const text = raw.body?.trim() ?? '';
    if (!text && !audio) return;

    const senderId = isGroup ? (raw.author ?? chatId) : chatId;
    const me = bareId(client.info?.wid?._serialized);

    const message: IncomingMessage = {
      channel: 'whatsapp-group',
      chatId,
      senderId,
      senderName: await this.senderName(raw),
      messageId,
      text,
      isGroup,
      mentionedMe: (raw.mentionedIds ?? []).some((id) => bareId(id) === me),
      timestamp: new Date((raw.timestamp ?? 0) * 1000),
      quoted: await this.extractQuote(raw, me),
      senderIsAdmin: isGroup ? await this.isAdmin(raw, senderId) : undefined,
      audio,
    };

    const reply = await this.pipeline.handle(message);
    if (!reply) return;

    const chat = await raw.getChat();
    await chat.sendSeen();
    await chat.sendStateTyping();
    // A pause so replies do not land instantly one after another.
    await this.sleep(this.config.group.replyDelayMs);
    await raw.reply(reply.text);
  }

  private async senderName(raw: Message): Promise<string | undefined> {
    try {
      const contact = await raw.getContact();
      return contact.pushname || contact.name || undefined;
    } catch {
      return undefined;
    }
  }

  private async downloadAudio(raw: Message): Promise<IncomingAudio | undefined> {
    try {
      const media = await raw.downloadMedia();
      if (!media?.data) return undefined;

      return {
        data: Buffer.from(media.data, 'base64'),
        // WhatsApp voice notes are opus in an ogg container; the extension is
        // what tells the transcription API how to decode them.
        filename: media.filename ?? (raw.type === 'ptt' ? 'voice.ogg' : 'audio.mp3'),
        durationSeconds: Number(raw.duration) || undefined,
      };
    } catch (error) {
      this.logger.warn(`Could not download audio: ${(error as Error).message}`);
      return undefined;
    }
  }

  private async extractQuote(
    raw: Message,
    me: string,
  ): Promise<IncomingMessage['quoted'] | undefined> {
    if (!raw.hasQuotedMsg) return undefined;

    try {
      const quoted = await raw.getQuotedMessage();
      const text = quoted.body?.trim();
      if (!text) return undefined;

      const author = quoted.author ?? quoted.from;
      return {
        messageId: quoted.id?._serialized,
        text,
        senderId: author,
        fromBot: quoted.fromMe || bareId(author) === me,
      };
    } catch (error) {
      this.logger.warn(`Could not read the quoted message: ${(error as Error).message}`);
      return undefined;
    }
  }

  /**
   * @returns true or false when known, undefined when the group could not be
   * read - the caller must not treat "unknown" as "admin".
   */
  private async isAdmin(raw: Message, senderId: string): Promise<boolean | undefined> {
    const chatId = raw.from;
    const cached = this.adminCache.get(chatId);
    if (cached && Date.now() - cached.fetchedAt < ADMIN_CACHE_MS) {
      return cached.ids.has(bareId(senderId));
    }

    try {
      const chat = (await raw.getChat()) as GroupChat;
      if (!chat.isGroup) return undefined;

      const ids = new Set(
        chat.participants
          .filter((participant) => participant.isAdmin || participant.isSuperAdmin)
          .map((participant) => bareId(participant.id?._serialized))
          .filter(Boolean),
      );
      this.adminCache.set(chatId, { ids, fetchedAt: Date.now() });
      return ids.has(bareId(senderId));
    } catch (error) {
      this.logger.warn(`Could not read admins of ${chatId}: ${(error as Error).message}`);
      return undefined;
    }
  }

  /**
   * whatsapp-web.js can sit silently while Chromium fails to start or the
   * network blocks web.whatsapp.com. Without this the bot just looks dead.
   */
  private startHandshakeWatchdog(): void {
    this.clearHandshakeWatchdog();
    this.handshakeTimer = setTimeout(() => {
      this.logger.error(
        'Still no QR code or connection after 60s. Check that Chromium can start ' +
          '(set WHATSAPP_CHROME_PATH) and that web.whatsapp.com is reachable.',
      );
    }, HANDSHAKE_WARN_MS);
  }

  private clearHandshakeWatchdog(): void {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = undefined;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
