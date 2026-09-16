import { describe, expect, it } from 'vitest';
import { AppException } from './errors';
import { decodeTextUpload, formatBytes, validateUpload, type UploadedFile } from './file-validation';

const RULE = {
  mimeTypes: ['application/pdf', 'text/plain'] as const,
  extensions: ['.pdf', '.txt'] as const,
  maxBytes: 1024,
  label: 'document',
};

function file(overrides: Partial<UploadedFile>): UploadedFile {
  const buffer = overrides.buffer ?? Buffer.from('hello');
  return {
    originalname: 'notes.txt',
    mimetype: 'text/plain',
    size: buffer.byteLength,
    buffer,
    ...overrides,
  };
}

describe('validateUpload', () => {
  it('accepts a well-formed upload', () => {
    expect(() => validateUpload(file({}), RULE)).not.toThrow();
  });

  it('rejects a missing or empty file', () => {
    expect(() => validateUpload(undefined, RULE)).toThrow(AppException);
    expect(() => validateUpload(file({ buffer: Buffer.alloc(0) }), RULE)).toThrow(/empty/i);
  });

  it('rejects a file over the size limit and says how big it was', () => {
    const big = file({ buffer: Buffer.alloc(2048) });
    expect(() => validateUpload(big, RULE)).toThrow(/2.0 KB.*limit is 1.0 KB/);
  });

  it('rejects an unsupported type and lists what is accepted', () => {
    const png = file({ originalname: 'x.png', mimetype: 'image/png' });
    expect(() => validateUpload(png, RULE)).toThrow(/\.pdf, \.txt/);
  });

  it('accepts a correct extension even when the browser sends octet-stream', () => {
    const pdf = file({
      originalname: 'guide.pdf',
      mimetype: 'application/octet-stream',
      buffer: Buffer.from('%PDF-1.7 rest'),
    });
    expect(() => validateUpload(pdf, RULE)).not.toThrow();
  });

  it('rejects a file whose bytes do not match its extension', () => {
    const fake = file({ originalname: 'guide.pdf', mimetype: 'application/pdf', buffer: Buffer.from('nope') });
    expect(() => validateUpload(fake, RULE)).toThrow(/valid PDF data/);
  });
});

describe('decodeTextUpload', () => {
  it('decodes UTF-8 and strips a byte-order mark', () => {
    expect(decodeTextUpload(file({ buffer: Buffer.from('﻿hello') }))).toBe('hello');
  });

  it('rejects binary content offered as text', () => {
    expect(() => decodeTextUpload(file({ buffer: Buffer.from([0x68, 0x00, 0x69]) }))).toThrow(
      /binary/i,
    );
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [2048, '2.0 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
  ])('formats %i as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
