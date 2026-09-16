import { describe, expect, it } from 'vitest';
import { cleanExtractedText, contentTokens, formatTimestamp, splitSentences, stem } from '../text';
import { estimateTokens, truncateToTokens } from '../tokens';

describe('stem', () => {
  it.each([
    ['decide', 'decided'],
    ['decide', 'decides'],
    ['meeting', 'meetings'],
    ['architecture', 'architectures'],
    ['deadline', 'deadlines'],
    ['declaration', 'declarations'],
    ['submit', 'submitted'],
    ['plan', 'planned'],
  ])('collapses %s and %s to the same stem', (a, b) => {
    expect(stem(a)).toBe(stem(b));
  });

  it('leaves short words and non-suffixed words alone', () => {
    expect(stem('team')).toBe('team');
    expect(stem('string')).toBe('string');
    expect(stem('business')).toBe('business');
  });
});

describe('contentTokens', () => {
  it('drops stopwords so lexical similarity is not dominated by them', () => {
    expect(contentTokens('The deadline is on the seventeenth')).toEqual(['deadlin', 'seventeenth']);
  });
});

describe('splitSentences', () => {
  it('splits on sentence boundaries', () => {
    expect(splitSentences('First one. Second one! Third one?')).toHaveLength(3);
  });

  it('does not split abbreviations or decimals', () => {
    expect(splitSentences('The deadline is Sept. 17 at 23.59 sharp.')).toHaveLength(1);
  });
});

describe('cleanExtractedText', () => {
  it('normalises whitespace and removes control characters', () => {
    const dirty = `Line one\r\n\r\n\r\nLine  two${String.fromCharCode(7)}`;
    expect(cleanExtractedText(dirty)).toBe('Line one\n\nLine two');
  });
});

describe('formatTimestamp', () => {
  it.each([
    [0, '0:00'],
    [65, '1:05'],
    [1935, '32:15'],
    [3725, '1:02:05'],
  ])('formats %i seconds as %s', (seconds, expected) => {
    expect(formatTimestamp(seconds)).toBe(expected);
  });
});

describe('token estimation', () => {
  it('grows with length and never returns zero for real text', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('hello')).toBeGreaterThan(0);
    expect(estimateTokens('hello world '.repeat(100))).toBeGreaterThan(estimateTokens('hello'));
  });

  it('truncates on a word boundary and respects the budget', () => {
    const text = 'word '.repeat(500);
    const truncated = truncateToTokens(text, 50);
    expect(estimateTokens(truncated)).toBeLessThanOrEqual(60);
    expect(truncated.endsWith('word')).toBe(true);
  });
});
