/** Words that open a question, in the languages UniPod members write in. */
const QUESTION_OPENERS = [
  // English
  'what', 'where', 'when', 'how', 'why', 'who', 'which', 'is', 'are', 'do',
  'does', 'did', 'can', 'could', 'should', 'may', 'anyone', 'any',
  // French
  'quoi', 'que', 'quel', 'quelle', 'quels', 'quelles', 'ou', 'où', 'quand',
  'comment', 'pourquoi', 'qui', 'combien', 'est', 'peut', 'puis',
  // Arabic and Darija
  'كيف', 'كيفاش', 'أين', 'اين', 'فين', 'شحال', 'بشحال', 'متى', 'إمتى', 'امتى',
  'واش', 'شنو', 'شني', 'علاش', 'لماذا', 'ماذا', 'من', 'هل', 'كم',
];

const MIN_LENGTH = 8;

/**
 * Loose test for "this looks like someone asking something".
 *
 * Deliberately permissive: a missed question just means the pair is not
 * learned automatically, and an admin can still teach it with !learn.
 */
export function looksLikeQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_LENGTH) return false;

  // Latin "?" and Arabic "؟".
  if (/[?؟]/u.test(trimmed)) return true;

  const firstWord = trimmed
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .split(/\s+/)[0];

  return Boolean(firstWord) && QUESTION_OPENERS.includes(firstWord);
}
