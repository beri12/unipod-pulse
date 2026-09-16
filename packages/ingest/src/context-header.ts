/**
 * Contextual chunk headers.
 *
 * A chunk lifted out of the middle of a document or a call carries no clue
 * about what it belongs to, yet that is exactly the signal both retrievers need:
 * a passage listing point values only answers "what are the judging criteria"
 * once it also says it comes from the Hackathon Guidelines.
 *
 * The header is part of the stored content so it is indexed by full-text search
 * as well as embedded, and it is stripped again before the text is shown as a
 * citation quote.
 */
const HEADER_PATTERN = /^\[[^\]\n]{1,200}\]\n/;

export function withHeader(parts: Array<string | null | undefined>, content: string): string {
  const header = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(' · ')
    .slice(0, 200);
  return header ? `[${header}]\n${content}` : content;
}

/** Removes a header added by `withHeader`, leaving the source text untouched. */
export function stripHeader(content: string): string {
  return content.replace(HEADER_PATTERN, '');
}
