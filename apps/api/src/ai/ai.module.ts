import { Global, Inject, Injectable, Module } from '@nestjs/common';
import {
  createAiBundle,
  EmbeddingService,
  LlmService,
  TranscriptionService,
  type AiBundle,
} from '@unipods/ai';
import type { Env } from '@unipods/config';
import { ENV } from '../config/config.module';

/** Exposes which provider is live — surfaced on the admin status page. */
@Injectable()
export class AiInfoService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  describe() {
    return {
      provider: this.env.AI_PROVIDER,
      chatModel: this.env.AI_PROVIDER === 'openai' ? this.env.AI_MODEL : 'local-extractive-v1',
      embeddingModel:
        this.env.AI_PROVIDER === 'openai' ? this.env.EMBEDDING_MODEL : 'local-hashed-ngrams-v1',
      transcriptionModel:
        this.env.AI_PROVIDER === 'openai' ? this.env.TRANSCRIPTION_MODEL : 'unavailable',
    };
  }
}

const bundleFactory = {
  provide: 'AI_BUNDLE',
  useFactory: (env: Env): AiBundle => createAiBundle(env),
  inject: [ENV],
};

@Global()
@Module({
  providers: [
    bundleFactory,
    AiInfoService,
    { provide: LlmService, useFactory: (bundle: AiBundle) => bundle.llm, inject: ['AI_BUNDLE'] },
    {
      provide: EmbeddingService,
      useFactory: (bundle: AiBundle) => bundle.embeddings,
      inject: ['AI_BUNDLE'],
    },
    {
      provide: TranscriptionService,
      useFactory: (bundle: AiBundle) => bundle.transcription,
      inject: ['AI_BUNDLE'],
    },
  ],
  exports: [LlmService, EmbeddingService, TranscriptionService, AiInfoService],
})
export class AiModule {}
