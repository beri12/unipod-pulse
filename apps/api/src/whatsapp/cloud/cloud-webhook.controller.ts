import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CommandRouterService } from '../../bot/commands/command-router.service.js';
import { DedupeService } from '../../bot/dedupe.service.js';
import { MessageLogService } from '../../bot/message-log.service.js';
import { WHATSAPP_CONFIG, type WhatsappConfig } from '../whatsapp.config.js';
import type { IncomingMessage } from '../../bot/bot.types.js';
import { CloudApiService } from './cloud-api.service.js';
import type { CloudContact, CloudTextMessage, CloudWebhookBody } from './cloud-api.types.js';
import { isValidCloudSignature } from './cloud-signature.js';

@Controller('whatsapp')
export class CloudWebhookController {
  private readonly logger = new Logger(CloudWebhookController.name);

  constructor(
    @Inject(WHATSAPP_CONFIG) private readonly config: WhatsappConfig,
    private readonly cloudApi: CloudApiService,
    private readonly router: CommandRouterService,
    private readonly dedupe: DedupeService,
    private readonly messageLog: MessageLogService,
  ) {}

  /**
   * Meta calls this once when you save the callback URL. It must echo
   * `hub.challenge` back as plain text or the subscription will not save.
   */
  @Get('webhook')
  @Header('Content-Type', 'text/plain')
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    const expected = this.config.cloud.verifyToken;

    if (!expected) {
      this.logger.error('WHATSAPP_VERIFY_TOKEN is not set — cannot verify the webhook');
      throw new ForbiddenException();
    }
    if (mode !== 'subscribe' || token !== expected) {
      this.logger.warn('Webhook verification rejected: wrong mode or verify token');
      throw new ForbiddenException();
    }

    this.logger.log('Webhook verified by Meta');
    return challenge ?? '';
  }

  /**
   * Inbound messages. Always answers 200 — anything else makes Meta retry the
   * same delivery, and a retry storm is far worse than one dropped message.
   */
  @Post('webhook')
  @HttpCode(200)
  async receive(@Req() request: RawBodyRequest<Request>): Promise<string> {
    const { appSecret } = this.config.cloud;

    if (appSecret) {
      const signature = request.headers['x-hub-signature-256'];
      const valid = isValidCloudSignature(
        request.rawBody,
        Array.isArray(signature) ? signature[0] : signature,
        appSecret,
      );
      if (!valid) {
        // Someone POSTing to a public URL that is not Meta. Swallow it.
        this.logger.warn('Rejected a webhook with an invalid signature');
        return 'EVENT_RECEIVED';
      }
    }

    try {
      await this.handle(request.body as CloudWebhookBody);
    } catch (error) {
      this.logger.error('Failed to handle a webhook payload', error as Error);
    }
    return 'EVENT_RECEIVED';
  }

  private async handle(body: CloudWebhookBody): Promise<void> {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages?.length) continue; // delivery/read receipts

        for (const raw of value.messages) {
          const message = this.normalise(raw, value.contacts ?? []);
          if (!message) continue;

          if (!this.dedupe.markIfNew(message.messageId)) {
            this.logger.debug(`Skipping duplicate delivery ${message.messageId}`);
            continue;
          }

          const reply = await this.router.route(message);
          this.messageLog.record(message, reply?.text ?? null);

          if (reply) {
            await this.cloudApi.markRead(message.messageId);
            await this.cloudApi.sendText(message.chatId, reply.text);
          }
        }
      }
    }
  }

  private normalise(raw: CloudTextMessage, contacts: CloudContact[]): IncomingMessage | null {
    const text = raw.text?.body ?? raw.image?.caption ?? raw.video?.caption ?? '';
    if (!text) return null; // stickers, audio, locations — nothing to route yet

    const contact = contacts.find((entry) => entry.wa_id === raw.from);
    const seconds = Number(raw.timestamp);

    return {
      channel: 'whatsapp-cloud',
      chatId: raw.from,
      senderId: raw.from,
      senderName: contact?.profile?.name,
      messageId: raw.id,
      text,
      // The Cloud API cannot deliver group messages at all — always 1-to-1.
      isGroup: false,
      mentionedMe: false,
      timestamp: Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date(),
    };
  }
}
