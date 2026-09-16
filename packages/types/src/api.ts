import type {
  ChatRole,
  DocumentType,
  Importance,
  ProcessingStatus,
  QuestionStatus,
  Role,
  SourceKind,
} from './enums';

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    /** Field-level validation problems, when the failure is a bad request. */
    details?: Array<{ field: string; message: string }>;
    requestId?: string;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: Role;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResponse extends AuthTokens {
  user: PublicUser;
}

// ---------------------------------------------------------------------------
// Sources & citations
// ---------------------------------------------------------------------------

/** Everything the UI needs to render and open a citation. */
export interface SourceRef {
  id: string;
  type: SourceKind;
  title: string;
  /** Id of the underlying Document / Meeting / Message row. */
  referenceId: string;
  url: string | null;
  authorName: string | null;
  /** ISO date the source content is dated at (not when it was uploaded). */
  occurredAt: string | null;
  metadata: SourceLocator;
}

/**
 * Where inside the source the cited text lives. Every field is optional because
 * it depends on the source kind — a PDF has pages, a meeting has timestamps.
 */
export interface SourceLocator {
  page?: number;
  section?: string;
  /** Seconds from the start of a recording. */
  startTime?: number;
  endTime?: number;
  channel?: string;
  messageDate?: string;
  chunkIndex?: number;
  [key: string]: unknown;
}

export interface Citation {
  id: string;
  sourceId: string;
  title: string;
  type: SourceKind;
  /** Verbatim excerpt taken from the retrieved chunk — never generated. */
  quote: string | null;
  score: number;
  metadata: SourceLocator;
  source: SourceRef;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export interface ChatMessageDto {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  citations: Citation[];
  /** Retrieval diagnostics — shown in the UI's "how was this answered" panel. */
  diagnostics?: AnswerDiagnostics;
}

export interface AnswerDiagnostics {
  answered: boolean;
  confidence: number;
  retrievedChunks: number;
  usedChunks: number;
  retrievalMs: number;
  generationMs: number;
  model: string;
  provider: string;
  /** True when the sources disagreed and the answer says so. */
  conflicting?: boolean;
}

export interface ChatRequest {
  conversationId?: string;
  message: string;
}

export interface ChatResponse {
  conversationId: string;
  message: ChatMessageDto;
  citations: Citation[];
  diagnostics: AnswerDiagnostics;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview: string | null;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ChatMessageDto[];
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface DocumentDto {
  id: string;
  title: string;
  description: string | null;
  type: DocumentType;
  sourceType: SourceKind;
  originalFileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  status: ProcessingStatus;
  statusMessage: string | null;
  pageCount: number | null;
  publishedAt: string | null;
  chunkCount: number;
  embeddedChunkCount: number;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string } | null;
}

export interface DocumentChunkDto {
  id: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  metadata: SourceLocator;
  hasEmbedding: boolean;
}

export interface DocumentDetail extends DocumentDto {
  chunks: DocumentChunkDto[];
  downloadUrl: string | null;
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export interface MeetingSummaryPayload {
  tldr: string;
  topics: string[];
  decisions: Array<{ text: string; startTime?: number }>;
  actionItems: Array<{ text: string; owner?: string | null; due?: string | null; startTime?: number }>;
  deadlines: Array<{ text: string; date?: string | null }>;
  openQuestions: string[];
  keyMoments: Array<{ label: string; startTime: number }>;
  /** Provider + model that produced the summary, for transparency in the UI. */
  generatedBy?: { provider: string; model: string; generatedAt: string };
}

export interface MeetingDto {
  id: string;
  title: string;
  description: string | null;
  meetingDate: string;
  durationSeconds: number | null;
  status: ProcessingStatus;
  statusMessage: string | null;
  hasSummary: boolean;
  transcriptSegments: number;
  chunkCount: number;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string } | null;
}

export interface TranscriptSegmentDto {
  id: string;
  speaker: string | null;
  content: string;
  startTime: number;
  endTime: number;
  sequence: number;
}

export interface MeetingDetail extends MeetingDto {
  summary: MeetingSummaryPayload | null;
  transcript: TranscriptSegmentDto[];
  mediaUrl: string | null;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface MessageDto {
  id: string;
  externalId: string | null;
  channel: string;
  authorName: string;
  authorId: string | null;
  content: string;
  messageDate: string;
  replyToId: string | null;
  isAnnouncement: boolean;
  isDemo: boolean;
  metadata: Record<string, unknown>;
}

export interface MessageImportResult {
  format: string;
  channel: string;
  parsed: number;
  imported: number;
  skipped: number;
  /** Human-readable reasons for skipped rows, capped for response size. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchResultDto {
  id: string;
  title: string;
  snippet: string;
  type: SourceKind;
  score: number;
  occurredAt: string | null;
  source: SourceRef;
}

export interface SearchResponse {
  query: string;
  results: SearchResultDto[];
  took: number;
}

// ---------------------------------------------------------------------------
// Catch-up
// ---------------------------------------------------------------------------

export interface CatchUpItem {
  id: string;
  importance: Importance;
  type: 'announcement' | 'meeting' | 'document' | 'discussion';
  title: string;
  summary: string;
  occurredAt: string | null;
  source: SourceRef;
}

export interface CatchUpResponse {
  period: string;
  from: string;
  to: string;
  summary: string;
  items: CatchUpItem[];
  /** True when nothing happened in the window — the UI shows an empty state. */
  empty: boolean;
  generatedBy: { provider: string; model: string };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface AdminStats {
  documents: { total: number; completed: number; failed: number; pending: number };
  meetings: { total: number; completed: number; failed: number; pending: number };
  messages: { total: number; announcements: number };
  knowledge: { chunks: number; pendingEmbeddings: number };
  questions: {
    today: number;
    total: number;
    answered: number;
    unanswered: number;
    openUnansweredGroups: number;
  };
  demoMode: boolean;
}

export interface UnansweredQuestionDto {
  id: string;
  question: string;
  normalizedQuestion: string;
  count: number;
  lastAskedAt: string;
  status: QuestionStatus;
  resolutionNote: string | null;
  createdAt: string;
}

export interface QuestionLogDto {
  id: string;
  question: string;
  answered: boolean;
  confidence: number;
  latencyMs: number | null;
  createdAt: string;
  user: { id: string; name: string } | null;
}

export interface SystemStatus {
  status: 'ok' | 'degraded' | 'error';
  uptimeSeconds: number;
  version: string;
  demoMode: boolean;
  services: Array<{
    name: string;
    status: 'ok' | 'error';
    latencyMs: number | null;
    detail?: string;
  }>;
  queues: Array<{
    name: string;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }>;
  ai: { provider: string; chatModel: string; embeddingModel: string; transcriptionModel: string };
}
