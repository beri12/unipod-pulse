import { CHUNKING_DEFAULTS } from '@unipods/config';
import { splitSentences } from './text';
import { estimateTokens } from './tokens';

export interface ChunkSegment<M extends Record<string, unknown> = Record<string, unknown>> {
  text: string;
  /** Provenance for this piece of source text: page number, timestamp, author. */
  metadata: M;
}

export interface Chunk<M extends Record<string, unknown> = Record<string, unknown>> {
  content: string;
  chunkIndex: number;
  tokenCount: number;
  /** Metadata of the first contributing segment, plus any span information. */
  metadata: M & Record<string, unknown>;
}

export interface ChunkOptions<M extends Record<string, unknown> = Record<string, unknown>> {
  targetTokens?: number;
  overlapTokens?: number;
  /** Chunks below this size are merged into their neighbour instead of stored. */
  minTokens?: number;
  /**
   * Forces a chunk boundary between two segments even when the token budget is
   * not spent. Meetings use this to keep a chunk inside one stretch of the
   * recording, so its citation timestamp points at the right moment rather than
   * at the start of the call.
   */
  breakBetween?: (chunkStart: M, next: M) => boolean;
}

interface TaggedSentence<M extends Record<string, unknown>> {
  text: string;
  tokens: number;
  metadata: M;
}

/**
 * Splits source text into embedding-sized chunks.
 *
 * Properties that matter for retrieval quality:
 *  - chunks never cut a sentence in half (only a single sentence longer than
 *    the whole budget is hard-split, on a word boundary);
 *  - consecutive chunks overlap by whole sentences, so a fact that straddles a
 *    boundary is retrievable from either side;
 *  - each chunk carries the metadata of the segment it started in, so a PDF
 *    chunk knows its page and a transcript chunk knows its timestamp.
 */
export function chunkSegments<M extends Record<string, unknown>>(
  segments: Array<ChunkSegment<M>>,
  options: ChunkOptions<M> = {},
): Array<Chunk<M>> {
  const targetTokens = options.targetTokens ?? CHUNKING_DEFAULTS.targetTokens;
  const overlapTokens = Math.min(
    options.overlapTokens ?? CHUNKING_DEFAULTS.overlapTokens,
    Math.floor(targetTokens / 2),
  );
  const minTokens = options.minTokens ?? CHUNKING_DEFAULTS.minTokens;

  const sentences: Array<TaggedSentence<M>> = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    for (const sentence of splitSentences(text)) {
      for (const piece of hardSplit(sentence, targetTokens)) {
        sentences.push({ text: piece, tokens: estimateTokens(piece), metadata: segment.metadata });
      }
    }
  }

  if (sentences.length === 0) return [];

  const chunks: Array<Chunk<M>> = [];
  let current: Array<TaggedSentence<M>> = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0] as TaggedSentence<M>;
    const last = current[current.length - 1] as TaggedSentence<M>;
    const content = current.map((sentence) => sentence.text).join(' ').trim();
    chunks.push({
      content,
      chunkIndex: chunks.length,
      tokenCount: estimateTokens(content),
      metadata: mergeSpan(first.metadata, last.metadata),
    });
  };

  for (const sentence of sentences) {
    const chunkStart = current[0]?.metadata;
    const forcedBreak =
      current.length > 0 &&
      chunkStart !== undefined &&
      options.breakBetween?.(chunkStart, sentence.metadata) === true;

    if (currentTokens > 0 && (forcedBreak || currentTokens + sentence.tokens > targetTokens)) {
      flush();
      // A forced break means the next chunk belongs to a different moment, so
      // carrying sentences across it would misattribute them.
      current = forcedBreak ? [] : takeOverlap(current, overlapTokens);
      currentTokens = current.reduce((sum, entry) => sum + entry.tokens, 0);
    }
    current.push(sentence);
    currentTokens += sentence.tokens;
  }
  flush();

  return mergeTinyTail(chunks, minTokens, targetTokens);
}

/** Convenience wrapper for plain text with a single metadata bag. */
export function chunkText<M extends Record<string, unknown>>(
  text: string,
  metadata: M,
  options: ChunkOptions<M> = {},
): Array<Chunk<M>> {
  return chunkSegments<M>([{ text, metadata }], options);
}

/**
 * Carries whole sentences from the end of a chunk into the next one, up to the
 * overlap budget. Returns a fresh array so the flushed chunk is not mutated.
 */
function takeOverlap<M extends Record<string, unknown>>(
  sentences: Array<TaggedSentence<M>>,
  overlapTokens: number,
): Array<TaggedSentence<M>> {
  if (overlapTokens <= 0) return [];
  const carried: Array<TaggedSentence<M>> = [];
  let total = 0;
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    const sentence = sentences[i] as TaggedSentence<M>;
    if (total + sentence.tokens > overlapTokens) break;
    carried.unshift(sentence);
    total += sentence.tokens;
  }
  // Never carry the entire chunk forward — that would loop forever.
  return carried.length === sentences.length ? carried.slice(1) : carried;
}

/** Splits a single over-long sentence on word boundaries. */
function hardSplit(sentence: string, targetTokens: number): string[] {
  if (estimateTokens(sentence) <= targetTokens) return [sentence];
  const words = sentence.split(/\s+/);
  const pieces: string[] = [];
  let buffer: string[] = [];
  let tokens = 0;
  for (const word of words) {
    const wordTokens = estimateTokens(word);
    if (tokens + wordTokens > targetTokens && buffer.length > 0) {
      pieces.push(buffer.join(' '));
      buffer = [];
      tokens = 0;
    }
    buffer.push(word);
    tokens += wordTokens;
  }
  if (buffer.length > 0) pieces.push(buffer.join(' '));
  return pieces;
}

/**
 * Records the span a chunk covers when it crosses a segment boundary, so a
 * chunk spanning pages 3-4 reports both, and a transcript chunk reports the
 * time of its last sentence as `endTime`.
 */
function mergeSpan<M extends Record<string, unknown>>(first: M, last: M): M & Record<string, unknown> {
  const merged: Record<string, unknown> = { ...first };
  if (typeof first.page === 'number' && typeof last.page === 'number' && last.page !== first.page) {
    merged.pageEnd = last.page;
  }
  if (typeof last.endTime === 'number') {
    merged.endTime = last.endTime;
  }
  return merged as M & Record<string, unknown>;
}

/**
 * A trailing chunk far below the minimum is folded back into its predecessor —
 * a two-sentence orphan is noise in the index.
 */
function mergeTinyTail<M extends Record<string, unknown>>(
  chunks: Array<Chunk<M>>,
  minTokens: number,
  targetTokens: number,
): Array<Chunk<M>> {
  if (chunks.length < 2) return chunks;
  const last = chunks[chunks.length - 1] as Chunk<M>;
  const previous = chunks[chunks.length - 2] as Chunk<M>;
  if (last.tokenCount >= minTokens) return chunks;
  if (previous.tokenCount + last.tokenCount > targetTokens * 1.5) return chunks;

  const content = `${previous.content} ${last.content}`.trim();
  const merged: Chunk<M> = {
    content,
    chunkIndex: previous.chunkIndex,
    tokenCount: estimateTokens(content),
    metadata: mergeSpan(previous.metadata, last.metadata) as M & Record<string, unknown>,
  };
  return [...chunks.slice(0, -2), merged];
}
