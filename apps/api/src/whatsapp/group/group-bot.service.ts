import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { WAMessage, WASocket } from '@whiskeysockets/baileys';
import { BotPipelineService } from '../../bot/bot-pipeline.service.js';
import { DedupeService } from '../../bot/dedupe.service.js';
import { WHATSAPP_CONFIG, type WhatsappConfig } from '../whatsapp.config.js';
import type { IncomingMessage } from '../../bot/bot.types.js';

const GROUP_SUFFIX = '@g.us';
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60_000;
/** How long to wait for a QR or a live connection before saying something. */
const HANDSHAKE_WARN_MS = 30_000;
/** How long a group's admin list is trusted before refetching. */
const ADMIN_CACHE_MS = 5 * 60_000;

/** "212600000000:12@s.whatsapp.net" -> "212600000000" */
const bareId = (jid?: string | null): string => jid?.split('@')[0]?.split(':')[0] ?? '';

/**
 * Unofficial group bot, built on Baileys.
 *
 * This logs in as a LINKED DEVICE of a normal WhatsApp account (the same
 * mechanism as WhatsApp Web), which is how it can see group messages at all —
 * the official Cloud API cannot. It is against WhatsApp's Terms of Service and
 * the number can be banned, so use a dedicated SIM, never a personal one.
 *
 * Disabled unless WHATSAPP_GROUP_BOT_ENABLED=true.
 */
@Injectable()
export class GroupBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GroupBotService.name);
  private socket?: WASocket;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private handshakeTimer?: NodeJS.Timeout;
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
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    // `end` stops the socket without logging out, so the session stays valid
    // and no QR rescan is needed on the next boot.
    this.socket?.end(undefined);
  }

  private async connect(): Promise<void> {
    // Imported lazily: Baileys is heavy and pulls in crypto/protobuf work that
    // nothing else needs when the group bot is switched off.
    const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } =
      await import('@whiskeysockets/baileys');
    const { default: qrcode } = await import('qrcode-terminal');
    const { default: pino } = await import('pino');

    const { state, saveCreds } = await useMultiFileAuthState(this.config.group.sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      auth: state,
      version,
      browser: ['UniPod Pulse', 'Chrome', '1.0.0'],
      // Baileys is chatty; its logs would drown the Nest ones.
      logger: pino({ level: 'silent' }),
      markOnlineOnConnect: false,
    });
    this.socket = socket;
    this.startHandshakeWatchdog();

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (connection === 'connecting') {
        this.logger.log('Connecting to WhatsApp...');
      }

      if (qr) {
        this.clearHandshakeWatchdog();
        this.logger.warn('Scan this QR in WhatsApp → Settings → Linked devices');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        this.clearHandshakeWatchdog();
        this.reconnectAttempts = 0;
        this.logger.log(`Group bot connected as ${socket.user?.id ?? 'unknown'}`);
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
          ?.statusCode;

        this.clearHandshakeWatchdog();

        if (statusCode === DisconnectReason.loggedOut) {
          this.logger.error(
            `Logged out by WhatsApp. Delete "${this.config.group.sessionPath}" and scan the QR again.`,
          );
          return;
        }
        this.scheduleReconnect();
      }
    });

    socket.ev.on('messages.upsert', ({ messages, type }) => {
      // "append" is history sync replaying old messages; answering those would
      // make the bot reply to days-old chatter on every reconnect.
      if (type !== 'notify') return;
      for (const message of messages) {
        void this.onMessage(message).catch((error) =>
          this.logger.error('Failed to handle a group message', error as Error),
        );
      }
    });
  }

  /**
   * Baileys can sit in "connecting" indefinitely when a network blocks its
   * WebSocket (corporate proxies and locked-down containers do), and its own
   * logger is silenced. Without this the bot just looks dead.
   */
  private startHandshakeWatchdog(): void {
    this.clearHandshakeWatchdog();
    this.handshakeTimer = setTimeout(() => {
      this.logger.error(
        'Still no QR code or connection after 30s. WhatsApp needs a direct WebSocket ' +
          'to web.whatsapp.com — check that a proxy or firewall is not blocking it.',
      );
    }, HANDSHAKE_WARN_MS);
  }

  private clearHandshakeWatchdog(): void {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = undefined;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping) return;

    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts += 1;
    this.logger.warn(`Connection closed, reconnecting in ${Math.round(delay / 1000)}s`);

    this.reconnectTimer = setTimeout(() => {
      void this.connect().catch((error) => {
        this.logger.error('Reconnect failed', error as Error);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private async onMessage(raw: WAMessage): Promise<void> {
    const socket = this.socket;
    if (!socket) return;
    if (raw.key.fromMe) return; // never answer ourselves

    const chatId = raw.key.remoteJid;
    if (!chatId) return;

    const isGroup = chatId.endsWith(GROUP_SUFFIX);
    const { allowedGroups } = this.config.group;
    if (isGroup && allowedGroups.length > 0 && !allowedGroups.includes(chatId)) return;

    const text = this.extractText(raw);
    if (!text) return;

    const messageId = raw.key.id ?? '';
    if (messageId && !this.dedupe.markIfNew(`group:${messageId}`)) return;

    const quoted = this.extractQuote(raw, socket);
    const senderId = isGroup ? (raw.key.participant ?? chatId) : chatId;

    const message: IncomingMessage = {
      channel: 'whatsapp-group',
      chatId,
      senderId,
      senderName: raw.pushName ?? undefined,
      messageId,
      text,
      isGroup,
      mentionedMe: this.isMentioned(raw, socket),
      timestamp: new Date(Number(raw.messageTimestamp ?? 0) * 1000),
      quoted,
      senderIsAdmin: isGroup ? await this.isAdmin(chatId, senderId) : undefined,
    };

    const reply = await this.pipeline.handle(message);
    if (!reply) return;

    await socket.readMessages([raw.key]);
    await socket.sendPresenceUpdate('composing', chatId);
    // A pause so replies do not land instantly one after another.
    await this.sleep(this.config.group.replyDelayMs);
    await socket.sendMessage(chatId, { text: reply.text }, { quoted: raw });
  }

  /**
   * @returns true or false when known, undefined when the group metadata could
   * not be read — the caller must not treat "unknown" as "admin".
   */
  private async isAdmin(chatId: string, senderId: string): Promise<boolean | undefined> {
    const cached = this.adminCache.get(chatId);
    if (cached && Date.now() - cached.fetchedAt < ADMIN_CACHE_MS) {
      return cached.ids.has(bareId(senderId));
    }

    try {
      const metadata = await this.socket?.groupMetadata(chatId);
      if (!metadata) return undefined;

      const ids = new Set(
        metadata.participants
          // "admin" and "superadmin"; a plain member has no admin field.
          .filter((participant) => Boolean(participant.admin))
          .flatMap((participant) => [bareId(participant.id), bareId(participant.lid)])
          .filter(Boolean),
      );
      this.adminCache.set(chatId, { ids, fetchedAt: Date.now() });
      return ids.has(bareId(senderId));
    } catch (error) {
      this.logger.warn(`Could not read admins of ${chatId}: ${(error as Error).message}`);
      return undefined;
    }
  }

  private extractQuote(raw: WAMessage, socket: WASocket): IncomingMessage['quoted'] {
    const context = raw.message?.extendedTextMessage?.contextInfo;
    const quoted = context?.quotedMessage;
    if (!quoted) return undefined;

    const text = (
      quoted.conversation ??
      quoted.extendedTextMessage?.text ??
      quoted.imageMessage?.caption ??
      quoted.videoMessage?.caption ??
      ''
    ).trim();
    if (!text) return undefined;

    const author = context?.participant ?? undefined;
    const me = new Set([bareId(socket.user?.id), bareId(socket.user?.lid)].filter(Boolean));

    return {
      messageId: context?.stanzaId ?? undefined,
      text,
      senderId: author,
      fromBot: author ? me.has(bareId(author)) : false,
    };
  }

  private extractText(raw: WAMessage): string {
    const content = raw.message;
    return (
      content?.conversation ??
      content?.extendedTextMessage?.text ??
      content?.imageMessage?.caption ??
      content?.videoMessage?.caption ??
      ''
    );
  }

  private isMentioned(raw: WAMessage, socket: WASocket): boolean {
    const mentioned = raw.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
    if (mentioned.length === 0) return false;

    // Newer accounts are addressed by their LID rather than their phone JID,
    // so check both identities.
    const me = new Set([bareId(socket.user?.id), bareId(socket.user?.lid)].filter(Boolean));
    return mentioned.some((jid) => me.has(bareId(jid)));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
