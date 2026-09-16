import { describe, expect, it } from 'vitest';
import { normaliseQuestionKey } from './questions.service';

describe('normaliseQuestionKey', () => {
  it('ignores word order, casing and punctuation', () => {
    expect(normaliseQuestionKey('When is the deadline?')).toBe(
      normaliseQuestionKey('the DEADLINE is when'),
    );
  });

  it('groups singular and plural phrasings', () => {
    expect(normaliseQuestionKey('What are the requirements?')).toBe(
      normaliseQuestionKey('What is the requirement?'),
    );
  });

  it('keeps genuinely different questions apart', () => {
    expect(normaliseQuestionKey('When is the deadline?')).not.toBe(
      normaliseQuestionKey('Who is on the judging panel?'),
    );
  });

  it('does not collapse to an empty key for an all-stopword question', () => {
    expect(normaliseQuestionKey('is it the one?').length).toBeGreaterThan(0);
  });
});
