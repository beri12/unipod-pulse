import { splitSentences } from './text';

/**
 * Cue patterns for the statements people actually search a meeting for.
 *
 * These are used in two places — the offline provider's summariser and the
 * meeting indexer — so they live here rather than being duplicated.
 */
export const DECISION_CUES =
  /\b(decided|decision|agreed|we(?:'ll| will) (?:use|go with|build|adopt)|settled on|concluded|approved|chose|choosing|it is decided|that is the direction)\b/i;

export const ACTION_CUES =
  /\b(action item|will (?:send|share|write|prepare|set up|create|follow up|draft|review|post|update|build|take|raise)|needs? to|responsible for|assigned to|take(?:s)? ownership|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week))\b/i;

export const DEADLINE_CUES =
  /\b(deadline|due|closes?|closing|cut[- ]?off|submit by|no later than|expires?)\b/i;

export const HEDGE_CUES =
  /\b(at the earliest|nothing was finalised|nothing was finalized|not final|tentative|proposed|suggested|might|maybe|we could|to be confirmed|tbc|tbd|draft)\b/i;

export const URGENT_CUES =
  /\b(deadline|due|urgent|tomorrow|today|closes?|final|required|must|immediately|reminder)\b/i;

export const DATE_PATTERN =
  /\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|next week)\b/i;

/** Concrete calendar dates only — no weekday names or relative words. */
export const CALENDAR_DATE_PATTERN =
  /\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:,?\s*\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i;

export type KeyStatementKind = 'decision' | 'action' | 'deadline' | 'question';

export interface KeyStatement {
  kind: KeyStatementKind;
  /** Verbatim sentence from the transcript — never paraphrased. */
  text: string;
  startTime: number;
  speaker: string | null;
}

export interface TimedSegment {
  speaker: string | null;
  content: string;
  startTime: number;
  endTime: number;
}

/**
 * Pulls the decisions, commitments, deadlines and open questions out of a
 * transcript, keeping every sentence verbatim.
 *
 * A decision is usually announced in a short sentence ("Then it is decided.")
 * whose substance lives in the sentence after it, so a cue sentence that is too
 * short to stand alone carries its successor with it.
 */
export function extractKeyStatements(segments: TimedSegment[]): KeyStatement[] {
  const statements: KeyStatement[] = [];

  for (const segment of segments) {
    const sentences = splitSentences(segment.content);
    for (let i = 0; i < sentences.length; i += 1) {
      const sentence = sentences[i] as string;
      const kind = classify(sentence);
      if (!kind) continue;

      let text = sentence;
      const next = sentences[i + 1];
      if (next && wordCount(sentence) < 10) {
        text = `${sentence} ${next}`;
        i += 1;
      }

      statements.push({
        kind,
        text: text.trim(),
        startTime: segment.startTime,
        speaker: segment.speaker,
      });
    }
  }

  return statements;
}

function classify(sentence: string): KeyStatementKind | null {
  if (sentence.trim().endsWith('?')) {
    return /\b(open question|should we|do we|are we)\b/i.test(sentence) ? 'question' : null;
  }
  if (DECISION_CUES.test(sentence)) return 'decision';
  if (DEADLINE_CUES.test(sentence) && DATE_PATTERN.test(sentence)) return 'deadline';
  if (ACTION_CUES.test(sentence)) return 'action';
  return null;
}

function wordCount(sentence: string): number {
  return sentence.trim().split(/\s+/).filter(Boolean).length;
}
