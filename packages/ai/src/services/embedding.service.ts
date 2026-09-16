import { AiProviderError, type EmbeddingProvider } from '../interfaces';
import { estimateTokens, truncateToTokens } from '../tokens';

export interface EmbeddingServiceOptions {
  /** Maximum inputs per provider request. */
  batchSize?: number;
  /** Maximum estimated tokens per provider request. */
  maxTokensPerBatch?: number;
  /** Hard cap per individual input; longer text is truncated before sending. */
  maxTokensPerInput?: number;
  /** Retries per batch on transient provider failures. */
  maxRetries?: number;
}

const DEFAULTS: Required<EmbeddingServiceOptions> = {
  batchSize: 96,
  maxTokensPerBatch: 100_000,
  maxTokensPerInput: 8_000,
  maxRetries: 3,
};

export class EmbeddingService {
  private readonly options: Required<EmbeddingServiceOptions>;

  constructor(
    private readonly provider: EmbeddingProvider,
    options: EmbeddingServiceOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  get providerName(): string {
    return this.provider.name;
  }

  get model(): string {
    return this.provider.embeddingModel;
  }

  get dimensions(): number {
    return this.provider.dimensions;
  }

  async embedText(text: string, signal?: AbortSignal): Promise<number[]> {
    const [embedding] = await this.embedTexts([text], signal);
    if (!embedding) {
      throw new AiProviderError('Provider returned no embedding.', this.provider.name);
    }
    return embedding;
  }

  /**
   * Embeds many texts with batching so a 400-chunk document costs a handful of
   * requests rather than 400. Order is preserved: `result[i]` always
   * corresponds to `texts[i]`.
   */
  async embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return [];

    const prepared = texts.map((text) => {
      const trimmed = text.trim();
      // Empty input would produce a degenerate vector; a single space keeps the
      // provider happy and the row's embedding obviously uninformative.
      return truncateToTokens(trimmed.length > 0 ? trimmed : ' ', this.options.maxTokensPerInput);
    });

    const results: number[][] = new Array(prepared.length);
    let cursor = 0;

    while (cursor < prepared.length) {
      const batch: string[] = [];
      const indexes: number[] = [];
      let batchTokens = 0;

      while (cursor < prepared.length && batch.length < this.options.batchSize) {
        const text = prepared[cursor] as string;
        const tokens = estimateTokens(text);
        if (batch.length > 0 && batchTokens + tokens > this.options.maxTokensPerBatch) break;
        batch.push(text);
        indexes.push(cursor);
        batchTokens += tokens;
        cursor += 1;
      }

      const embeddings = await this.embedBatchWithRetry(batch, signal);
      if (embeddings.length !== batch.length) {
        throw new AiProviderError(
          `Provider returned ${embeddings.length} embeddings for ${batch.length} inputs.`,
          this.provider.name,
        );
      }
      for (let i = 0; i < embeddings.length; i += 1) {
        const embedding = embeddings[i] as number[];
        this.assertDimensions(embedding);
        results[indexes[i] as number] = embedding;
      }
    }

    return results;
  }

  private async embedBatchWithRetry(batch: string[], signal?: AbortSignal): Promise<number[][]> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.options.maxRetries; attempt += 1) {
      try {
        const result = await this.provider.embed(batch, signal);
        return result.embeddings;
      } catch (error) {
        lastError = error;
        if (signal?.aborted) break;
        // Exponential backoff with jitter: 500ms, 1s, 2s.
        const delay = 500 * 2 ** attempt + Math.random() * 250;
        await sleep(delay);
      }
    }
    throw new AiProviderError(
      `Embedding batch failed after ${this.options.maxRetries} attempts: ${
        (lastError as Error)?.message ?? 'unknown error'
      }`,
      this.provider.name,
      lastError,
    );
  }

  private assertDimensions(embedding: number[]): void {
    if (embedding.length !== this.provider.dimensions) {
      throw new AiProviderError(
        `Provider returned a ${embedding.length}-dimension embedding but ${this.provider.dimensions} was configured. ` +
          'Update EMBEDDING_DIMENSIONS and migrate the vector columns together.',
        this.provider.name,
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
