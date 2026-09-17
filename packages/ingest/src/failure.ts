import { MessageImportError } from './importers';
import { DocumentExtractionError } from './parsers/document-parser';

/**
 * Message shown when something failed for a reason the person who uploaded the
 * file can neither understand nor act on.
 */
const GENERIC_FAILURE =
  'Processing failed unexpectedly. The error has been logged — quote this item to an administrator and they can look it up.';

/** An error class raised deliberately, whose message is written for a reader. */
export interface DeliberateError extends Error {
  readonly name: string;
}

/**
 * Splits a caught error into what a user is told and what gets logged.
 *
 * `statusMessage` is returned by the API and rendered in the UI, so whatever
 * goes in it is shown to whoever uploaded the file. A raw `Error.message` is
 * the wrong thing to put there twice over: an `ENOENT` carries the server's
 * absolute filesystem path, and a database error can carry column names and
 * fragments of SQL — neither is any use to a reader, and both describe the
 * inside of the system to someone outside it.
 *
 * So the split mirrors the API's exception filter, which already works this
 * way for synchronous requests: an error raised deliberately (a PDF that is a
 * scanned image, a transcript in an unreadable format) says exactly what is
 * wrong, because that is actionable. Anything unexpected gets a generic
 * sentence, and the detail goes only to the log.
 */
export function describeFailure(error: unknown): { userMessage: string; logDetail: string } {
  const detail = error instanceof Error ? error.message : String(error);

  if (isDeliberate(error)) {
    return { userMessage: error.message, logDetail: detail };
  }

  return { userMessage: GENERIC_FAILURE, logDetail: detail };
}

/**
 * Matched by constructor and by name.
 *
 * The name check matters in a monorepo: a package loaded twice — once from
 * source and once from `dist`, which is exactly what happens between the tests
 * and the worker — produces two distinct classes, and `instanceof` quietly
 * returns false for one of them. Falling back to the name means a deliberate,
 * helpful message does not silently turn into the generic one depending on how
 * the process was started.
 */
function isDeliberate(error: unknown): error is Error {
  if (error instanceof DocumentExtractionError) return true;
  if (error instanceof MessageImportError) return true;
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'DocumentExtractionError' ||
    error.name === 'MessageImportError' ||
    error.name === 'MeetingProcessingError'
  );
}
