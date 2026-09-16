import type { MeetingSummaryPayload } from '@unipods/types';
import type { ChatMessage } from './interfaces';

/** One numbered piece of retrieved evidence handed to the answer generator. */
export interface GroundedContextItem {
  /** 1-based index the model must use when citing, e.g. `[2]`. */
  index: number;
  sourceId: string;
  title: string;
  kind: string;
  /** Human-readable position inside the source: "Page 4", "32:15", "Telegram". */
  locator: string;
  /** ISO date of the source content, or null when unknown. */
  date: string | null;
  content: string;
}

export interface GroundedAnswerInput {
  question: string;
  context: GroundedContextItem[];
  history: ChatMessage[];
}

export interface GroundedAnswerOutput {
  answer: string;
  /** Indexes (1-based) of context items the answer actually relies on. */
  citedIndexes: number[];
  /** False when the evidence was insufficient and the answer says so. */
  answered: boolean;
  /** True when the cited sources disagree and the answer explains the conflict. */
  conflicting: boolean;
}

export interface MeetingSummaryInput {
  title: string;
  date: string;
  durationSeconds: number | null;
  segments: Array<{ speaker: string | null; content: string; startTime: number; endTime: number }>;
}

export interface CatchUpInput {
  periodLabel: string;
  items: Array<{
    type: 'announcement' | 'meeting' | 'document' | 'discussion';
    title: string;
    content: string;
    occurredAt: string | null;
  }>;
}

export interface CatchUpOutput {
  summary: string;
  /** Per-item importance, aligned by index with the input items. */
  importance: Array<'high' | 'medium' | 'low'>;
  /** Per-item one-line summary, aligned by index with the input items. */
  itemSummaries: string[];
}

/**
 * Implemented by providers that can produce these structures without an LLM
 * round trip (the offline provider). `LlmService` prefers a real model when one
 * is configured and falls back to this deterministic path otherwise.
 */
export interface StructuredProvider {
  answerFromContext(input: GroundedAnswerInput): Promise<GroundedAnswerOutput>;
  summariseMeeting(input: MeetingSummaryInput): Promise<MeetingSummaryPayload>;
  generateCatchUp(input: CatchUpInput): Promise<CatchUpOutput>;
}

export function isStructuredProvider(value: unknown): value is StructuredProvider {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StructuredProvider).answerFromContext === 'function' &&
    typeof (value as StructuredProvider).summariseMeeting === 'function' &&
    typeof (value as StructuredProvider).generateCatchUp === 'function'
  );
}
