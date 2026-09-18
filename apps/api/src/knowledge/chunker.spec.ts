import { chunkText } from './chunker.js';

describe('chunkText', () => {
  it('returns nothing for empty text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n  ')).toEqual([]);
  });

  it('keeps a short document in one chunk', () => {
    const chunks = chunkText('We open at 9h and close at 19h.', 1400);

    expect(chunks).toEqual([
      { text: 'We open at 9h and close at 19h.', part: 1, parts: 1 },
    ]);
  });

  it('splits a long document and numbers the parts', () => {
    const paragraph = 'A'.repeat(200);
    const chunks = chunkText(Array.from({ length: 10 }, () => paragraph).join('\n\n'), 500, 50);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toMatchObject({ part: 1, parts: chunks.length });
    expect(chunks.at(-1)?.part).toBe(chunks.length);
  });

  it('never cuts a speaker turn in half', () => {
    const turns = [
      'Youssef: we decided to move the weekly call to Thursday.',
      'Amina: does that start this week?',
      'Youssef: yes, from this Thursday at 18h.',
      'Sara: and the room is booked until 20h.',
    ];

    const chunks = chunkText(turns.join('\n'), 120, 60);

    // Every non-empty line in every chunk is one of the original turns,
    // never a fragment of one.
    for (const chunk of chunks) {
      for (const line of chunk.text.split('\n')) {
        if (line.trim()) expect(turns).toContain(line.trim());
      }
    }
  });

  it('carries whole lines into the overlap, never a fragment', () => {
    const turns = [
      'Youssef: we decided to move the weekly call to Thursday.',
      'Amina: does that start this week?',
      'Youssef: yes, from this Thursday at 18h.',
    ];

    const chunks = chunkText(turns.join('\n'), 120, 60);

    expect(chunks.length).toBeGreaterThan(1);
    // The repeated context is a complete turn.
    expect(chunks[1]!.text.split('\n')[0]).toBe('Amina: does that start this week?');
  });

  it('overlaps chunks so an answer on a boundary is still found', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index} with some content here`);
    const chunks = chunkText(lines.join('\n'), 200, 80);

    expect(chunks.length).toBeGreaterThan(1);
    const firstTail = chunks[0]!.text.split('\n').at(-1)!;
    expect(chunks[1]!.text).toContain(firstTail);
  });

  it('cuts a single line that is longer than a whole chunk', () => {
    const chunks = chunkText('X'.repeat(1000), 300, 0);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(300);
  });

  it('handles Windows line endings', () => {
    const chunks = chunkText('first line\r\n\r\nsecond line', 1400);

    expect(chunks[0]?.text).toBe('first line\n\nsecond line');
  });
});
