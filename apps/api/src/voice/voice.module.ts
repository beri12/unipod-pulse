import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { BotPipelineService } from '../bot/bot-pipeline.service.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { TranscriptionService } from './transcription.service.js';
import { VOICE_CONFIG, loadVoiceConfig } from './voice.config.js';
import { VoiceService } from './voice.service.js';

/** Hooks transcription in before routing, so audio arrives as text. */
@Injectable()
class VoiceWiring implements OnModuleInit {
  constructor(
    private readonly voice: VoiceService,
    private readonly pipeline: BotPipelineService,
  ) {}

  onModuleInit(): void {
    this.pipeline.registerPreprocessor((message) => this.voice.handle(message));
  }
}

@Module({
  imports: [BotModule, KnowledgeModule],
  providers: [
    { provide: VOICE_CONFIG, useFactory: () => loadVoiceConfig() },
    TranscriptionService,
    VoiceService,
    VoiceWiring,
  ],
  exports: [TranscriptionService, VoiceService],
})
export class VoiceModule {}
