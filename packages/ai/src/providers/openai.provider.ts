import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import OpenAI, { toFile } from 'openai';
import {
  AiProviderError,
  type ChatMessage,
  type CompletionOptions,
  type CompletionResult,
  type EmbeddingProvider,
  type EmbeddingResult,
  type LlmProvider,
  type TranscriptionProvider,
  type TranscriptionResult,
  type TranscriptSegment,
} from '../interfaces';

export interface OpenAiProviderConfig {
  apiKey: string;
  baseURL?: string;
  chatModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  transcriptionModel: string;
  /** Requests are retried by the SDK; this bounds total wall time per call. */
  timeoutMs?: number;
}

/**
 * Works against any OpenAI-compatible endpoint: OpenAI, Azure OpenAI gateways,
 * Groq, Together, vLLM, LM Studio, Ollama's /v1 shim. Only `baseURL` changes.
 */
export class OpenAiProvider implements LlmProvider, EmbeddingProvider, TranscriptionProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;

  constructor(private readonly config: OpenAiProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeoutMs ?? 120_000,
      maxRetries: 2,
    });
  }

  get chatModel(): string {
    return this.config.chatModel;
  }

  get embeddingModel(): string {
    return this.config.embeddingModel;
  }

  get dimensions(): number {
    return this.config.embeddingDimensions;
  }

  get transcriptionModel(): string {
    return this.config.transcriptionModel;
  }

  async complete(messages: ChatMessage[], options: CompletionOptions = {}): Promise<CompletionResult> {
    try {
      const response = await this.client.chat.completions.create(
        {
          model: this.config.chatModel,
          messages: messages.map((message) => ({ role: message.role, content: message.content })),
          temperature: options.temperature ?? 0.1,
          max_tokens: options.maxTokens ?? 1_200,
          ...(options.json ? { response_format: { type: 'json_object' as const } } : {}),
        },
        { signal: options.signal },
      );
      const choice = response.choices[0];
      return {
        content: choice?.message?.content ?? '',
        model: response.model ?? this.config.chatModel,
        provider: this.name,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
      };
    } catch (error) {
      throw new AiProviderError(
        `Chat completion failed: ${(error as Error).message}`,
        this.name,
        error,
      );
    }
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<EmbeddingResult> {
    if (texts.length === 0) {
      return {
        embeddings: [],
        model: this.config.embeddingModel,
        provider: this.name,
        dimensions: this.config.embeddingDimensions,
      };
    }
    try {
      const response = await this.client.embeddings.create(
        {
          model: this.config.embeddingModel,
          input: texts,
          // `dimensions` is only supported by text-embedding-3-*; other models
          // ignore it, and the caller validates the returned size anyway.
          ...(this.config.embeddingModel.startsWith('text-embedding-3')
            ? { dimensions: this.config.embeddingDimensions }
            : {}),
        },
        { signal },
      );
      const ordered = [...response.data].sort((a, b) => a.index - b.index);
      return {
        embeddings: ordered.map((item) => item.embedding as number[]),
        model: response.model ?? this.config.embeddingModel,
        provider: this.name,
        dimensions: ordered[0]?.embedding.length ?? this.config.embeddingDimensions,
      };
    } catch (error) {
      throw new AiProviderError(`Embedding failed: ${(error as Error).message}`, this.name, error);
    }
  }

  async transcribe(
    file: Buffer,
    fileName: string,
    options: { mimeType?: string; signal?: AbortSignal } = {},
  ): Promise<TranscriptionResult> {
    // Large media is streamed from a temp file rather than held twice in memory.
    const dir = await mkdtemp(join(tmpdir(), 'unipods-transcribe-'));
    const path = join(dir, sanitiseFileName(fileName));
    try {
      await writeFile(path, file);
      const upload = await toFile(createReadStream(path), sanitiseFileName(fileName), {
        type: options.mimeType,
      });
      const response = await this.client.audio.transcriptions.create(
        {
          model: this.config.transcriptionModel,
          file: upload,
          response_format: 'verbose_json',
          timestamp_granularities: ['segment'],
        },
        { signal: options.signal },
      );
      return mapVerboseTranscription(response, this.name, this.config.transcriptionModel);
    } catch (error) {
      throw new AiProviderError(
        `Transcription failed: ${(error as Error).message}`,
        this.name,
        error,
      );
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Strips path separators so a user-supplied name cannot escape the temp dir. */
function sanitiseFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? 'upload';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned.length > 0 ? cleaned.slice(0, 120) : 'upload';
}

interface VerboseTranscription {
  text?: string;
  language?: string;
  duration?: number;
  segments?: Array<{ id?: number; start?: number; end?: number; text?: string }>;
}

function mapVerboseTranscription(
  response: unknown,
  provider: string,
  model: string,
): TranscriptionResult {
  const payload = response as VerboseTranscription;
  const segments: TranscriptSegment[] = (payload.segments ?? [])
    .map((segment) => ({
      // Whisper does not diarise. We keep `speaker` null rather than inventing
      // "Speaker 1" — the UI shows no speaker instead of a fabricated one.
      speaker: null,
      content: (segment.text ?? '').trim(),
      startTime: Number(segment.start ?? 0),
      endTime: Number(segment.end ?? segment.start ?? 0),
    }))
    .filter((segment) => segment.content.length > 0);

  return {
    text: payload.text ?? segments.map((segment) => segment.content).join(' '),
    language: payload.language ?? null,
    durationSeconds: typeof payload.duration === 'number' ? payload.duration : null,
    segments,
    model,
    provider,
  };
}
