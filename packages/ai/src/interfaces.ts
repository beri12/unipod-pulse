/**
 * Provider-facing contracts. Everything above this layer (RAG, meetings,
 * catch-up) depends only on these interfaces, so swapping OpenAI for another
 * OpenAI-compatible endpoint — or the offline provider — touches one file.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for a JSON object. Providers that cannot must still
   *  return parseable JSON — callers validate and fall back safely. */
  json?: boolean;
  signal?: AbortSignal;
}

export interface CompletionResult {
  content: string;
  model: string;
  provider: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface EmbeddingResult {
  embeddings: number[][];
  model: string;
  provider: string;
  dimensions: number;
}

export interface TranscriptSegment {
  speaker: string | null;
  content: string;
  /** Seconds from the start of the media. */
  startTime: number;
  endTime: number;
}

export interface TranscriptionResult {
  text: string;
  language: string | null;
  durationSeconds: number | null;
  segments: TranscriptSegment[];
  model: string;
  provider: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly chatModel: string;
  complete(messages: ChatMessage[], options?: CompletionOptions): Promise<CompletionResult>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly embeddingModel: string;
  readonly dimensions: number;
  embed(texts: string[], signal?: AbortSignal): Promise<EmbeddingResult>;
}

export interface TranscriptionProvider {
  readonly name: string;
  readonly transcriptionModel: string;
  transcribe(
    file: Buffer,
    fileName: string,
    options?: { mimeType?: string; signal?: AbortSignal },
  ): Promise<TranscriptionResult>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** Thrown when a capability is genuinely unavailable — never silently faked. */
export class AiCapabilityUnavailableError extends AiProviderError {
  constructor(provider: string, capability: string, hint: string) {
    super(`${provider} cannot ${capability}. ${hint}`, provider);
    this.name = 'AiCapabilityUnavailableError';
  }
}
