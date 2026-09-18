import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { CloudApiService } from './cloud/cloud-api.service.js';
import { CloudWebhookController } from './cloud/cloud-webhook.controller.js';
import { GroupBotService } from './group/group-bot.service.js';
import { WHATSAPP_CONFIG, loadWhatsappConfig } from './whatsapp.config.js';

/**
 * WhatsApp plumbing only — what a command means lives in BotModule.
 *
 *   Cloud API (official, private chats only)  ─┐
 *                                              ├─> CommandRouterService
 *   Baileys group bot (unofficial, groups)    ─┘
 *
 * Either half can be switched off with environment variables; the module
 * always loads so the app boots with no credentials at all.
 */
@Module({
  imports: [BotModule],
  controllers: [CloudWebhookController],
  providers: [
    { provide: WHATSAPP_CONFIG, useFactory: () => loadWhatsappConfig() },
    CloudApiService,
    GroupBotService,
  ],
  exports: [CloudApiService, WHATSAPP_CONFIG],
})
export class WhatsappModule {}
