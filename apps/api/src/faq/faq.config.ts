export const FAQ_CONFIG = Symbol('FAQ_CONFIG');

export interface FaqConfig {
  /** Answering is on only with an API key; learning works without one. */
  enabled: boolean;
  apiKey: string;
  model: string;
  /** Claude's effort level for the matching call. */
  effort: 'low' | 'medium' | 'high';
  /** Below this confidence the bot stays silent rather than guess. */
  minConfidence: number;
  /** Where learned answers are kept. */
  storePath: string;
  /** Learn automatically when an admin replies to a question. */
  autoLearn: boolean;
  /** Most entries to send to Claude in one matching call. */
  maxEntriesPerCall: number;
}

const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined || value === '' ? fallback : /^(1|true|yes|on)$/i.test(value);

const effortOf = (value: string | undefined): FaqConfig['effort'] =>
  value === 'medium' || value === 'high' ? value : 'low';

export function loadFaqConfig(env: NodeJS.ProcessEnv = process.env): FaqConfig {
  const apiKey = env.ANTHROPIC_API_KEY ?? '';

  return {
    enabled: Boolean(apiKey),
    apiKey,
    model: env.FAQ_MODEL ?? 'claude-opus-5',
    effort: effortOf(env.FAQ_EFFORT),
    minConfidence: Number(env.FAQ_MIN_CONFIDENCE ?? 0.75),
    storePath: env.FAQ_STORE_PATH ?? './data/faq.json',
    autoLearn: bool(env.FAQ_AUTO_LEARN, true),
    maxEntriesPerCall: Number(env.FAQ_MAX_ENTRIES ?? 300),
  };
}
