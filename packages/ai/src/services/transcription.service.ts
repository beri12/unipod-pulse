import {
  AiCapabilityUnavailableError,
  type TranscriptionProvider,
  type TranscriptionResult,
} from '../interfaces';
import { parseTranscript } from '../transcripts';

export class TranscriptionService {
  constructor(private readonly provider: TranscriptionProvider) {}

  get providerName(): string {
    return (this.provider as { name?: string }).name ?? 'unknown';
  }

  get model(): string {
    return this.provider.transcriptionModel;
  }

  /** True when audio can actually be transcribed by the configured provider. */
  get available(): boolean {
    return this.provider.transcriptionModel !== 'unavailable';
  }

  async transcribe(
    file: Buffer,
    fileName: string,
    options: { mimeType?: string; signal?: AbortSignal } = {},
  ): Promise<TranscriptionResult> {
    if (!this.available) {
      throw new AiCapabilityUnavailableError(
        this.providerName,
        'transcribe audio',
        'Configure AI_PROVIDER=openai with OPENAI_API_KEY, or upload an existing transcript file instead.',
      );
    }
    return this.provider.transcribe(file, fileName, options);
  }

  /** Reads an existing transcript file — no AI provider involved. */
  parseTranscriptFile(fileName: string, content: string): TranscriptionResult {
    const parsed = parseTranscript(fileName, content);
    return {
      text: parsed.segments.map((segment) => segment.content).join(' '),
      language: null,
      durationSeconds: parsed.durationSeconds,
      segments: parsed.segments,
      model: `imported:${parsed.format}`,
      provider: 'import',
    };
  }
}
