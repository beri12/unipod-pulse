import { describe, expect, it } from 'vitest';
import { chunkSegments, chunkText } from '../chunking';
import { estimateTokens } from '../tokens';

const SENTENCE = 'The organising committee confirmed the schedule for the coming week. ';

describe('chunkSegments', () => {
  it('returns nothing for empty input', () => {
    expect(chunkSegments([])).toEqual([]);
    expect(chunkSegments([{ text: '   ', metadata: {} }])).toEqual([]);
  });

  it('keeps a short document in a single chunk', () => {
    const chunks = chunkText('One short paragraph about the deadline.', { source: 'document' });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain('deadline');
    expect(chunks[0]?.chunkIndex).toBe(0);
  });

  it('splits long text into chunks near the target size', () => {
    const chunks = chunkText(SENTENCE.repeat(120), { source: 'document' }, {
      targetTokens: 100,
      overlapTokens: 20,
    });
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      // Chunks may exceed the target only by the final sentence that crossed it.
      expect(chunk.tokenCount).toBeLessThanOrEqual(130);
    }
  });

  it('never splits inside a sentence', () => {
    const chunks = chunkText(SENTENCE.repeat(60), { source: 'document' }, { targetTokens: 80 });
    for (const chunk of chunks) {
      expect(chunk.content.trim().endsWith('.')).toBe(true);
    }
  });

  it('overlaps consecutive chunks so a boundary fact stays retrievable', () => {
    const text = Array.from({ length: 40 }, (_, index) => `Fact number ${index} was recorded.`).join(' ');
    const chunks = chunkText(text, { source: 'document' }, { targetTokens: 60, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);

    // The overlap carries whole sentences up to the budget, so the previous
    // chunk's final sentence must reappear at the start of the next one.
    const first = chunks[0]!;
    const second = chunks[1]!;
    const tail = first.content.split(/(?<=\.)\s+/).slice(-1)[0] as string;
    expect(second.content).toContain(tail);
    expect(second.content.indexOf(tail)).toBeLessThan(second.content.length / 2);
  });

  it('carries page metadata and records a page span', () => {
    const chunks = chunkSegments(
      [
        { text: SENTENCE.repeat(10), metadata: { source: 'document', page: 1 } },
        { text: SENTENCE.repeat(10), metadata: { source: 'document', page: 2 } },
      ],
      { targetTokens: 400, overlapTokens: 0 },
    );
    expect(chunks[0]?.metadata.page).toBe(1);
    const spanning = chunks.find((chunk) => chunk.metadata.pageEnd !== undefined);
    expect(spanning?.metadata.pageEnd).toBe(2);
  });

  it('hard-splits a single sentence that exceeds the whole budget', () => {
    const monster = `${'word '.repeat(500)}.`;
    const chunks = chunkText(monster, { source: 'document' }, { targetTokens: 50 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(120);
  });

  it('breaks where the caller says to, without carrying overlap across the break', () => {
    const chunks = chunkSegments(
      [
        { text: 'We opened the call and reviewed the agenda.', metadata: { startTime: 0 } },
        { text: 'Much later we returned to the deadline.', metadata: { startTime: 1800 } },
      ],
      {
        targetTokens: 500,
        overlapTokens: 100,
        breakBetween: (start, next) => Number(next.startTime) - Number(start.startTime) > 180,
      },
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.content).not.toContain('agenda');
    expect(chunks[1]?.metadata.startTime).toBe(1800);
  });

  it('assigns sequential chunk indexes', () => {
    const chunks = chunkText(SENTENCE.repeat(50), { source: 'document' }, { targetTokens: 60 });
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(chunks.map((_, index) => index));
  });
});
