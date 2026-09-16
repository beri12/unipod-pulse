/** Shared, provider-agnostic constants used by the API, worker and web app. */

export const APP_NAME = 'UniPods Pulse';
export const APP_TAGLINE = 'Your community. One intelligent memory.';

/**
 * The exact sentence the assistant must produce when retrieval does not
 * support a confident answer. Asserted in tests and matched by the API when
 * deciding whether to log an unanswered question.
 */
export const NO_ANSWER_SENTENCE =
  "I couldn't find a confirmed answer in the available community information.";

export const QUEUE_NAMES = {
  DOCUMENT_PROCESSING: 'document-processing',
  EMBEDDING: 'embedding',
  MEETING_TRANSCRIPTION: 'meeting-transcription',
  MEETING_SUMMARY: 'meeting-summary',
  MESSAGE_PROCESSING: 'message-processing',
  CATCH_UP: 'catch-up',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const JOB_NAMES = {
  DOCUMENT_PROCESS: 'document-process',
  DOCUMENT_CHUNK: 'document-chunk',
  DOCUMENT_EMBED: 'document-embed',
  MEETING_TRANSCRIBE: 'meeting-transcribe',
  MEETING_PROCESS: 'meeting-process',
  MEETING_SUMMARISE: 'meeting-summary',
  MEETING_EMBED: 'meeting-embed',
  MESSAGE_PROCESS: 'message-process',
  MESSAGE_EMBED: 'message-embed',
  CATCH_UP_GENERATE: 'catch-up-generate',
} as const;

export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

/** MIME types accepted by the document upload endpoint. */
export const DOCUMENT_MIME_TYPES = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/msword': 'DOCX',
  'text/plain': 'TXT',
  'text/markdown': 'MARKDOWN',
  'text/x-markdown': 'MARKDOWN',
} as const;

export const DOCUMENT_EXTENSIONS: Record<string, keyof typeof DOCUMENT_MIME_TYPES> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
};

/** MIME types accepted by the meeting upload endpoint. */
export const MEETING_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/webm',
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const;

export const MEETING_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.mp4', '.webm', '.mov'] as const;

/** Chunking defaults — overridable per call and via environment variables. */
export const CHUNKING_DEFAULTS = {
  targetTokens: 600,
  overlapTokens: 80,
  minTokens: 60,
  /** Rough characters-per-token ratio for English prose. */
  charsPerToken: 4,
} as const;

export const RAG_DEFAULTS = {
  topK: 8,
  minScore: 0.12,
  /** Candidates pulled from each retriever before hybrid re-ranking. */
  candidateMultiplier: 4,
  maxContextTokens: 6_000,
  weights: {
    semantic: 0.6,
    keyword: 0.25,
    recency: 0.1,
    source: 0.05,
  },
  /**
   * Half-life (days) used by the recency score. A source this old scores 0.5.
   * Community information decays fast, so the default is deliberately short.
   */
  recencyHalfLifeDays: 30,
} as const;

export const PAGINATION_DEFAULTS = {
  page: 1,
  limit: 20,
  maxLimit: 100,
} as const;
