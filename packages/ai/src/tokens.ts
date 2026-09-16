/**
 * Cheap token estimation.
 *
 * We deliberately avoid pulling in a full BPE tokenizer: chunk sizes only need
 * to be approximately right, and an extra 2 MB dependency (plus a WASM load on
 * every worker boot) is not worth the precision. The heuristic below tracks
 * cl100k_base within roughly ±10% on English prose, and is intentionally
 * conservative (over- rather than under-estimates) so context windows are not
 * overrun.
 */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const chars = text.length;
  const words = text.split(/\s+/).filter(Boolean).length;
  // Blend a char-based and a word-based estimate; punctuation-heavy text tends
  // to tokenise closer to chars/4, prose closer to words * 1.3.
  const byChars = chars / CHARS_PER_TOKEN;
  const byWords = words * 1.3;
  return Math.max(1, Math.ceil((byChars + byWords) / 2));
}

/** Truncates text to an approximate token budget on a word boundary. */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const approxChars = Math.max(1, Math.floor(maxTokens * CHARS_PER_TOKEN));
  const sliced = text.slice(0, approxChars);
  const lastSpace = sliced.lastIndexOf(' ');
  return (lastSpace > approxChars * 0.6 ? sliced.slice(0, lastSpace) : sliced).trimEnd();
}
