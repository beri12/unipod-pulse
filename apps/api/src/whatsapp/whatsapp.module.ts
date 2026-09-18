import { Module } from '@nestjs/common';
import { CloudApiService } from './cloud/cloud-api.service.js';
import { CloudWebhookController } from './cloud/cloud-webhook.controller.js';
import { CommandRouterService } from './commands/command-router.service.js';
import { DedupeService } from './dedupe.service.js';
import { GroupBotService } from './group/group-bot.service.js';
import { MessageLogService } from './message-log.service.js';
import { WHATSAPP_CONFIG, loadWhatsappConfig } from './whatsapp.config.js';

/**
 * Both WhatsApp transports, sharing one command layer:
 *
 *   Cloud API (official)  ─┐
 *                          ├─> CommandRouterService ─> reply
 *   Baileys group bot     ─┘
 *
 * Either half can be switched off with environment variables; the module
 * always loads so the app boots with no credentials at all.
 */
@Module({
  controllers: [CloudWebhookController],
  providers: [
    { provide: WHATSAPP_CONFIG, useFactory: () => loadWhatsappConfig() },
    // Built by hand: the TTL constructor argument is not injectable.
    { provide: DedupeService, useFactory: () => new DedupeService() },
    MessageLogService,
    CommandRouterService,
    CloudApiService,
    GroupBotService,
  ],
  exports: [CommandRouterService, CloudApiService, WHATSAPP_CONFIG],
})
export class WhatsappModule {}
