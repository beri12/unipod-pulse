import { describe, expect, it } from 'vitest';
import { describeFailure } from '../failure';
import { MessageImportError } from '../importers';
import { DocumentExtractionError } from '../parsers/document-parser';

describe('describeFailure', () => {
  it('passes a deliberate extraction error straight through', () => {
    const error = new DocumentExtractionError(
      'No text could be extracted from this PDF. It may be a scanned image.',
    );
    const { userMessage } = describeFailure(error);
    expect(userMessage).toBe(
      'No text could be extracted from this PDF. It may be a scanned image.',
    );
  });

  it('passes a deliberate import error straight through', () => {
    const { userMessage } = describeFailure(new MessageImportError('Not a valid export.'));
    expect(userMessage).toBe('Not a valid export.');
  });

  it('never shows a server filesystem path to the uploader', () => {
    const error = new Error(
      "ENOENT: no such file or directory, open '/srv/unipods/storage/documents/2026/09/abc.md'",
    );
    const { userMessage, logDetail } = describeFailure(error);

    expect(userMessage).not.toContain('/srv/unipods');
    expect(userMessage).not.toContain('ENOENT');
    // The detail is not lost, it just goes somewhere only an operator reads.
    expect(logDetail).toContain('/srv/unipods/storage/documents/2026/09/abc.md');
  });

  it('never shows database internals to the uploader', () => {
    const { userMessage, logDetail } = describeFailure(
      new Error('relation "document_chunks" does not exist at character 13'),
    );
    expect(userMessage).not.toContain('document_chunks');
    expect(logDetail).toContain('document_chunks');
  });

  it('recognises a deliberate error by name when the class was loaded twice', () => {
    // A monorepo can load the same package from source and from dist, giving
    // two classes that fail `instanceof` against each other.
    const lookalike = new Error('This transcript format is not supported.');
    lookalike.name = 'MeetingProcessingError';
    expect(describeFailure(lookalike).userMessage).toBe(
      'This transcript format is not supported.',
    );
  });

  it('handles something thrown that is not an Error at all', () => {
    const { userMessage, logDetail } = describeFailure('a bare string');
    expect(userMessage).toMatch(/logged/i);
    expect(logDetail).toBe('a bare string');
  });
});
