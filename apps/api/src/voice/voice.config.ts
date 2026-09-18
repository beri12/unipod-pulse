export const VOICE_CONFIG = Symbol('VOICE_CONFIG');

export interface VoiceConfig {
  /** Transcription needs an OpenAI key; Claude has no audio API. */
  enabled: boolean;
  apiKey: string;
  /**
   * gpt-4o-transcribe handles French, Arabic and Darija better than whisper-1.
   * gpt-4o-transcribe-diarize labels who spoke, which suits call recordings.
   */
  model: string;
  /** Audio at least this long is treated as a recording worth importing. */
  importFromSeconds: number;
  /** Refuse anything bigger, in megabytes (the API limit is 25 MB). */
  maxSizeMb: number;
}

export function loadVoiceConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  const apiKey = env.OPENAI_API_KEY ?? '';

  return {
    enabled: Boolean(apiKey),
    apiKey,
    model: env.VOICE_MODEL ?? 'gpt-4o-transcribe',
    importFromSeconds: Number(env.VOICE_IMPORT_FROM_SECONDS ?? 120),
    maxSizeMb: Number(env.VOICE_MAX_SIZE_MB ?? 25),
  };
}
