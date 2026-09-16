import type { TranscriptSegment } from './interfaces';
import { cleanExtractedText } from './text';

/**
 * Parsers for transcripts a community already has.
 *
 * Plenty of tools (Zoom, Meet, Teams, Whisper CLI, Otter) export WebVTT, SRT or
 * JSON. Accepting those directly means meetings can be indexed without paying
 * for speech-to-text, and it is how meeting ingestion works when no
 * transcription provider is configured.
 */

export type TranscriptFormat = 'vtt' | 'srt' | 'json' | 'txt';

export interface ParsedTranscript {
  format: TranscriptFormat;
  segments: TranscriptSegment[];
  durationSeconds: number | null;
}

export class TranscriptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptParseError';
  }
}

export function detectTranscriptFormat(fileName: string, content: string): TranscriptFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.vtt')) return 'vtt';
  if (lower.endsWith('.srt')) return 'srt';
  if (lower.endsWith('.json')) return 'json';
  // An explicit .txt wins over content sniffing: a plain transcript beginning
  // "[00:10] Amara: ..." starts with a bracket but is not JSON.
  if (lower.endsWith('.txt') || lower.endsWith('.text')) return 'txt';

  const head = content.slice(0, 200).trim();
  if (head.startsWith('WEBVTT')) return 'vtt';
  if (/^\d+\s*\r?\n\d{1,2}:\d{2}:\d{2},\d{3}\s*-->/m.test(content)) return 'srt';
  // Only treat it as JSON when the opening bracket is followed by something
  // JSON-shaped, rather than by a timestamp.
  if (/^\[\s*[{\["]/.test(head) || /^\{\s*"/.test(head)) return 'json';
  return 'txt';
}

export function parseTranscript(fileName: string, content: string): ParsedTranscript {
  const format = detectTranscriptFormat(fileName, content);
  const segments = (() => {
    switch (format) {
      case 'vtt':
        return parseCueFile(content, 'vtt');
      case 'srt':
        return parseCueFile(content, 'srt');
      case 'json':
        return parseJsonTranscript(content);
      case 'txt':
        return parsePlainText(content);
    }
  })();

  if (segments.length === 0) {
    throw new TranscriptParseError(
      `No transcript segments could be read from ${fileName}. Supported formats: WebVTT (.vtt), SubRip (.srt), JSON, plain text with [mm:ss] markers.`,
    );
  }

  const last = segments[segments.length - 1] as TranscriptSegment;
  return { format, segments, durationSeconds: last.endTime > 0 ? last.endTime : null };
}

const CUE_TIME =
  /(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function parseCueFile(content: string, format: 'vtt' | 'srt'): TranscriptSegment[] {
  const blocks = content
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/^WEBVTT[^\n]*\n/, '')
    .split(/\n{2,}/);

  const segments: TranscriptSegment[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;

    const timeLineIndex = lines.findIndex((line) => CUE_TIME.test(line));
    if (timeLineIndex === -1) continue;
    const match = (lines[timeLineIndex] as string).match(CUE_TIME);
    if (!match) continue;

    const startTime = toSeconds(match[1], match[2], match[3], match[4]);
    const endTime = toSeconds(match[5], match[6], match[7], match[8]);
    const body = lines.slice(timeLineIndex + 1).join(' ');
    const { speaker, text } = extractSpeaker(stripCueTags(body), format);
    if (!text) continue;

    segments.push({ speaker, content: text, startTime, endTime });
  }
  return mergeAdjacent(segments);
}

function toSeconds(
  hours: string | undefined,
  minutes: string | undefined,
  seconds: string | undefined,
  millis: string | undefined,
): number {
  const h = hours ? Number.parseInt(hours.replace(':', ''), 10) : 0;
  const m = Number.parseInt(minutes ?? '0', 10);
  const s = Number.parseInt(seconds ?? '0', 10);
  const ms = Number.parseInt((millis ?? '0').padEnd(3, '0'), 10);
  return h * 3600 + m * 60 + s + ms / 1000;
}

function stripCueTags(text: string): string {
  return text
    .replace(/<\/?v[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .trim();
}

const SPEAKER_PREFIX = /^([A-Za-z][A-Za-z0-9 .'-]{0,40}?):\s+/;

function extractSpeaker(text: string, _format: 'vtt' | 'srt'): { speaker: string | null; text: string } {
  const match = text.match(SPEAKER_PREFIX);
  if (match?.[1]) {
    return { speaker: match[1].trim(), text: text.slice(match[0].length).trim() };
  }
  return { speaker: null, text: text.trim() };
}

interface JsonSegmentShape {
  speaker?: string | null;
  text?: string;
  content?: string;
  start?: number | string;
  startTime?: number | string;
  end?: number | string;
  endTime?: number | string;
}

function parseJsonTranscript(content: string): TranscriptSegment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new TranscriptParseError(`Invalid JSON transcript: ${(error as Error).message}`);
  }

  const rows: JsonSegmentShape[] = Array.isArray(parsed)
    ? (parsed as JsonSegmentShape[])
    : Array.isArray((parsed as { segments?: unknown }).segments)
      ? ((parsed as { segments: JsonSegmentShape[] }).segments)
      : [];

  const segments: TranscriptSegment[] = [];
  for (const row of rows) {
    const text = cleanExtractedText(String(row.text ?? row.content ?? '')).trim();
    if (!text) continue;
    const startTime = toNumber(row.start ?? row.startTime);
    const endTime = toNumber(row.end ?? row.endTime, startTime);
    segments.push({
      speaker: typeof row.speaker === 'string' && row.speaker.trim() ? row.speaker.trim() : null,
      content: text,
      startTime,
      endTime,
    });
  }
  return segments;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    // Accept "00:01:02.500" as well as "62.5".
    if (value.includes(':')) {
      const parts = value.split(':').map((part) => Number.parseFloat(part));
      if (parts.every((part) => Number.isFinite(part))) {
        return parts.reduce((total, part) => total * 60 + part, 0);
      }
    }
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

const INLINE_TIMESTAMP = /^\[?(\d{1,2}:)?(\d{1,2}):(\d{2})\]?\s*/;

/**
 * Plain-text transcripts with `[mm:ss]` or `mm:ss` line prefixes. Lines without
 * a timestamp continue the previous segment; if the file has no timestamps at
 * all we refuse rather than invent times.
 */
function parsePlainText(content: string): TranscriptSegment[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const segments: TranscriptSegment[] = [];
  let sawTimestamp = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(INLINE_TIMESTAMP);
    if (match) {
      sawTimestamp = true;
      const startTime = toSeconds(match[1], match[2], match[3], '0');
      const rest = line.slice(match[0].length);
      const { speaker, text } = extractSpeaker(rest, 'vtt');
      if (!text) continue;
      const previous = segments[segments.length - 1];
      if (previous && previous.endTime <= previous.startTime) previous.endTime = startTime;
      segments.push({ speaker, content: text, startTime, endTime: startTime });
    } else if (segments.length > 0) {
      const previous = segments[segments.length - 1] as TranscriptSegment;
      previous.content = `${previous.content} ${line}`.trim();
    }
  }

  if (!sawTimestamp) {
    throw new TranscriptParseError(
      'This plain-text transcript has no timestamps. Upload a .vtt, .srt or JSON transcript so meeting citations can link to the right moment.',
    );
  }

  const last = segments[segments.length - 1];
  if (last && last.endTime <= last.startTime) last.endTime = last.startTime + 5;
  return segments;
}

/** Joins consecutive cues from the same speaker that run back to back. */
function mergeAdjacent(segments: TranscriptSegment[]): TranscriptSegment[] {
  const merged: TranscriptSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    const contiguous =
      previous &&
      previous.speaker === segment.speaker &&
      segment.startTime - previous.endTime < 0.75 &&
      previous.endTime - previous.startTime < 25 &&
      !/[.!?]$/.test(previous.content);
    if (contiguous && previous) {
      previous.content = `${previous.content} ${segment.content}`.trim();
      previous.endTime = segment.endTime;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}
