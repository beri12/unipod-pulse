import { describe, expect, it } from 'vitest';
import { applyRenumbering, excerpt, stripCitationMarkers } from './chat.service';

describe('excerpt', () => {
  it('returns short content unchanged', () => {
    expect(excerpt('Short quote.')).toBe('Short quote.');
  });

  it('removes the indexer header so the quote is only source text', () => {
    expect(excerpt('[Hackathon Guidelines · Page 4]\nDeclarations are due Thursday.')).toBe(
      'Declarations are due Thursday.',
    );
  });

  it('cuts on a sentence boundary when it can', () => {
    const text = `${'First sentence is long enough to matter here. '.repeat(4)}Second part.`;
    const result = excerpt(text, 120);
    expect(result.endsWith('.')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(120);
  });

  it('falls back to a word boundary with an ellipsis', () => {
    const result = excerpt('word '.repeat(200), 50);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('applyRenumbering', () => {
  it('rewrites markers to the card numbers the reader sees', () => {
    const renumber = new Map([
      [3, 1],
      [7, 2],
    ]);
    expect(applyRenumbering('Due Thursday [3]. Confirmed later [7].', renumber)).toBe(
      'Due Thursday [1]. Confirmed later [2].',
    );
  });

  it('maps two passages from one card to the same number', () => {
    const renumber = new Map([
      [2, 1],
      [5, 1],
    ]);
    expect(applyRenumbering('A [2] and B [5].', renumber)).toBe('A [1] and B [1].');
  });

  it('drops a marker whose evidence did not make the final list', () => {
    expect(applyRenumbering('Claim [9] stands.', new Map([[1, 1]]))).toBe('Claim stands.');
  });

  it('strips every marker when there are no citations', () => {
    expect(stripCitationMarkers('One [1] two [2].')).toBe('One two.');
  });

  it('leaves text without markers untouched', () => {
    expect(applyRenumbering('No markers here.', new Map())).toBe('No markers here.');
  });
});
