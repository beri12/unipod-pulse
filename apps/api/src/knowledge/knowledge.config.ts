export const KNOWLEDGE_CONFIG = Symbol('KNOWLEDGE_CONFIG');

export interface KnowledgeConfig {
  /** Answering needs Claude; learning and ingestion work without it. */
  enabled: boolean;
  apiKey: string;
  model: string;
  effort: 'low' | 'medium' | 'high';
  /** Below this the bot records a gap instead of answering. */
  minConfidence: number;
  /** Directory holding the JSON data files. */
  dataDir: string;
  /** Learn automatically when a group admin replies to a question. */
  autoLearn: boolean;
  /** Entry summaries sent to Claude when choosing what to read. */
  maxCandidates: number;
  /** Entries read in full when composing an answer. */
  maxReadEntries: number;
  /** Characters per transcript chunk, and the overlap between them. */
  chunkSize: number;
  chunkOverlap: number;
  /** Messages kept per chat for "what did I miss". */
  archiveLimit: number;
  /** Bearer token required by the ingestion endpoints, if set. */
  ingestToken: string;
}

const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined || value === '' ? fallback : /^(1|true|yes|on)$/i.test(value);

const effortOf = (value: string | undefined): KnowledgeConfig['effort'] =>
  value === 'medium' || value === 'high' ? value : 'low';

export function loadKnowledgeConfig(env: NodeJS.ProcessEnv = process.env): KnowledgeConfig {
  const apiKey = env.ANTHROPIC_API_KEY ?? '';

  return {
    enabled: Boolean(apiKey),
    apiKey,
    model: env.KNOWLEDGE_MODEL ?? env.FAQ_MODEL ?? 'claude-opus-5',
    effort: effortOf(env.KNOWLEDGE_EFFORT ?? env.FAQ_EFFORT),
    minConfidence: Number(env.KNOWLEDGE_MIN_CONFIDENCE ?? env.FAQ_MIN_CONFIDENCE ?? 0.7),
    dataDir: env.KNOWLEDGE_DATA_DIR ?? './data',
    autoLearn: bool(env.KNOWLEDGE_AUTO_LEARN ?? env.FAQ_AUTO_LEARN, true),
    maxCandidates: Number(env.KNOWLEDGE_MAX_CANDIDATES ?? 400),
    maxReadEntries: Number(env.KNOWLEDGE_MAX_READ ?? 8),
    chunkSize: Number(env.KNOWLEDGE_CHUNK_SIZE ?? 1400),
    chunkOverlap: Number(env.KNOWLEDGE_CHUNK_OVERLAP ?? 200),
    archiveLimit: Number(env.KNOWLEDGE_ARCHIVE_LIMIT ?? 500),
    ingestToken: env.KNOWLEDGE_INGEST_TOKEN ?? '',
  };
}
