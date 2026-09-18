/**
 * Greetings recognised across the languages UniPod members actually write in.
 *
 * A greeting is almost always someone's first message to a bot, so answering
 * it with "I don't know" wastes the one moment they are paying attention.
 */
const GREETINGS = new Set([
  // English
  'hello', 'hi', 'hey', 'helo', 'hallo', 'yo',
  // French
  'bonjour', 'salut', 'bonsoir', 'coucou',
  // Arabic / Darija, written in Latin letters and in Arabic script
  'salam', 'salaam', 'sallam', 'assalam', 'asalam', 'slm', 'ahlan', 'marhaba',
  'سلام', 'مرحبا', 'اهلا', 'أهلا',
  // Spanish
  'hola', 'buenas',
  // Generic openers
  'start', 'test',
]);

/** Matches a greeting, ignoring case and trailing !!! or ??? */
export function isGreeting(word: string): boolean {
  const cleaned = word
    .toLowerCase()
    .replace(/[!?.,;:]+$/u, '')
    .trim();
  return cleaned.length > 0 && GREETINGS.has(cleaned);
}
