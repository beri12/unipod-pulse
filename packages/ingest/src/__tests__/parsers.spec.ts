import { describe, expect, it } from 'vitest';
import { DocumentExtractionError, MarkdownParser, resolveParser, TxtParser } from '../parsers';
import { stripHeader, withHeader } from '../context-header';

describe('resolveParser', () => {
  it('picks the right parser by mime type and by extension', () => {
    expect(resolveParser('application/pdf', 'x.pdf').name).toBe('pdf');
    expect(resolveParser('application/octet-stream', 'guide.docx').name).toBe('docx');
    expect(resolveParser('text/markdown', 'guide.md').name).toBe('markdown');
    expect(resolveParser('text/plain', 'notes.txt').name).toBe('txt');
  });

  it('prefers markdown over plain text for a .md file', () => {
    expect(resolveParser('text/plain', 'guide.md').name).toBe('markdown');
  });

  it('refuses an unsupported type with a message naming what is supported', () => {
    expect(() => resolveParser('image/png', 'diagram.png')).toThrow(/PDF, DOCX, TXT, Markdown/);
  });
});

describe('MarkdownParser', () => {
  const markdown = [
    '# Hackathon Guidelines',
    '',
    'Intro paragraph.',
    '',
    '## Key dates',
    '',
    'Declarations are due September 17.',
    '',
    '## Judging criteria',
    '',
    'Scored out of 100 points.',
    '',
    '```',
    '# not a heading, this is inside a fence',
    '```',
  ].join('\n');

  it('keeps headings as section metadata', async () => {
    const result = await new MarkdownParser().extract(Buffer.from(markdown), 'guide.md');
    const sections = result.pages.map((page) => page.section);
    expect(sections).toContain('Key dates');
    expect(sections).toContain('Judging criteria');
  });

  it('does not treat a fenced line as a heading', async () => {
    const result = await new MarkdownParser().extract(Buffer.from(markdown), 'guide.md');
    expect(result.pages.map((page) => page.section)).not.toContain(
      'not a heading, this is inside a fence',
    );
  });

  it('rejects an empty file rather than indexing nothing', async () => {
    await expect(new MarkdownParser().extract(Buffer.from('   '), 'empty.md')).rejects.toThrow(
      DocumentExtractionError,
    );
  });
});

describe('TxtParser', () => {
  it('strips a byte-order mark and normalises line endings', async () => {
    const result = await new TxtParser().extract(
      Buffer.from('﻿first line\r\n\r\n\r\nsecond line'),
      'notes.txt',
    );
    expect(result.text).toBe('first line\n\nsecond line');
  });
});

describe('context headers', () => {
  it('prefixes a chunk with its source and position', () => {
    expect(withHeader(['Hackathon Guidelines', 'Key dates'], 'body')).toBe(
      '[Hackathon Guidelines · Key dates]\nbody',
    );
  });

  it('omits the header when there is nothing to say', () => {
    expect(withHeader([null, undefined, '  '], 'body')).toBe('body');
  });

  it('round-trips: stripping a header leaves the original text', () => {
    const body = 'The deadline is September 17.\nSecond line.';
    expect(stripHeader(withHeader(['Doc', '32:15'], body))).toBe(body);
  });

  it('leaves text that merely starts with a bracket alone', () => {
    expect(stripHeader('[not a header] still body')).toBe('[not a header] still body');
  });
});
