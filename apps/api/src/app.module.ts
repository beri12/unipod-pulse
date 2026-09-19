import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { KnowledgeModule } from './knowledge/knowledge.module.js';
import { VoiceModule } from './voice/voice.module.js';
import { TelegramModule } from './telegram/telegram.module.js';
import { WhatsappModule } from './whatsapp/whatsapp.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

const observeAppKey = process.env.OBSERVE_APP_KEY ?? '';
const observeAppSecret = process.env.OBSERVE_APP_SECRET ?? '';

/**
 * Hosted telemetry (https://observe.nestjs.com) — off unless real credentials
 * are given.
 *
 * The NestJS starter ships placeholder credentials. Left in place they make
 * the telemetry agent retry against a 401 forever, which it reports once and
 * then counts silently, so the logs fill with a failure nobody asked for.
 */
export const observeEnabled = Boolean(observeAppKey && observeAppSecret);

@Module({
  imports: [
    ...(observeEnabled
      ? [
          ObserveModule.forRoot({
            appKey: observeAppKey,
            appSecret: observeAppSecret,
            serviceId: process.env.OBSERVE_SERVICE_ID ?? 'api',
          }),
        ]
      : []),
    WhatsappModule,
    TelegramModule,
    KnowledgeModule,
    VoiceModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
