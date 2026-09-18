import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI, { toFile } from 'openai';
import { VOICE_CONFIG, type VoiceConfig } from './voice.config.js';

/**
 * Speech to text.
 *
 * OpenAI is used only for this: Claude has no audio endpoint. Everything the
 * bot decides and says still goes through Claude.
 */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);
  private readonly client?: OpenAI;

  constructor(@Inject(VOICE_CONFIG) private readonly config: VoiceConfig) {
    if (config.enabled) this.client = new OpenAI({ apiKey: config.apiKey });
  }

  get enabled(): boolean {
    return Boolean(this.client);
  }

  /**
   * @returns the spoken text, or null when it could not be transcribed.
   */
  async transcribe(audio: Buffer, filename: string): Promise<string | null> {
    if (!this.client) return null;

    const megabytes = audio.byteLength / 1024 / 1024;
    if (megabytes > this.config.maxSizeMb) {
      this.logger.warn(
        `Audio is ${megabytes.toFixed(1)} MB, over the ${this.config.maxSizeMb} MB limit — skipping`,
      );
      return null;
    }

    try {
      const started = Date.now();
      const response = await this.client.audio.transcriptions.create({
        file: await toFile(audio, filename),
        model: this.config.model,
      });

      const text = response.text?.trim();
      this.logger.log(
        `Transcribed ${megabytes.toFixed(2)} MB in ${Date.now() - started}ms (${text?.length ?? 0} chars)`,
      );
      return text || null;
    } catch (error) {
      // A failure here must leave the bot working, just deaf for this message.
      this.logger.error(`Transcription failed: ${(error as Error).message}`);
      return null;
    }
  }
}
