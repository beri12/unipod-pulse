import type { Env } from '@unipods/config';
import type { EmbeddingProvider, LlmProvider, TranscriptionProvider } from './interfaces';
import { LocalProvider } from './providers/local.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { EmbeddingService } from './services/embedding.service';
import { LlmService } from './services/llm.service';
import { TranscriptionService } from './services/transcription.service';

export interface AiBundle {
  provider: LlmProvider & EmbeddingProvider & TranscriptionProvider;
  llm: LlmService;
  embeddings: EmbeddingService;
  transcription: TranscriptionService;
}

/**
 * Single place where a provider is chosen. Everything downstream receives
 * services, never the provider, so adding a provider means adding one branch.
 */
export function createAiBundle(env: Env): AiBundle {
  const provider =
    env.AI_PROVIDER === 'openai'
      ? new OpenAiProvider({
          apiKey: env.OPENAI_API_KEY as string,
          baseURL: env.OPENAI_BASE_URL,
          chatModel: env.AI_MODEL,
          embeddingModel: env.EMBEDDING_MODEL,
          embeddingDimensions: env.EMBEDDING_DIMENSIONS,
          transcriptionModel: env.TRANSCRIPTION_MODEL,
        })
      : new LocalProvider(env.EMBEDDING_DIMENSIONS);

  return {
    provider,
    llm: new LlmService(provider),
    embeddings: new EmbeddingService(provider),
    transcription: new TranscriptionService(provider),
  };
}
