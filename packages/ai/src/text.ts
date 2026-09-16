/** Shared, dependency-free text utilities used by chunking and the offline provider. */

const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can',
  'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had',
  'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'him', 'his', 'how', 'i', 'if', 'in',
  'into', 'is', 'it', 'its', 'just', 'me', 'more', 'most', 'my', 'no', 'nor', 'not', 'now', 'of',
  'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'out', 'over', 'own', 'same', 'she',
  'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'then',
  'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up',
  'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why',
  'will', 'with', 'you', 'your', 'yours',
]);

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token);
}

export function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9'"\s.:/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenise(text: string): string[] {
  return normaliseText(text)
    .split(/[^a-z0-9']+/)
    .map((token) => token.replace(/^'+|'+$/g, ''))
    .filter((token) => token.length > 1);
}

/**
 * Very small suffix stripper.
 *
 * Retrieval only needs "declarations" and "declaration" to collide; a full
 * Porter stemmer is more machinery (and more wrong-stem surprises) than that
 * warrants. Rules are applied longest-suffix-first and never shorten a token
 * below four characters.
 */
export function stem(token: string): string {
  if (token.length <= 4) return token;
  const rules: Array<[RegExp, string]> = [
    [/ies$/, 'y'],
    [/([^aeiou])ied$/, '$1y'],
    [/(ss|sh|ch|x|z)es$/, '$1'],
    [/([^s])s$/, '$1'],
    [/ements?$/, 'ement'],
    [/ings$/, 'ing'],
    [/(\w{3,})ing$/, '$1'],
    [/(\w{3,})ed$/, '$1'],
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(token)) {
      const stemmed = token.replace(pattern, replacement);
      if (stemmed.length >= 4) return stemmed;
    }
  }
  return token;
}

/** Meaning-bearing tokens: stopwords removed and light stemming applied. */
export function contentTokens(text: string): string[] {
  return tokenise(text)
    .filter((token) => !isStopword(token))
    .map((token) => stem(token))
    .filter((token) => token.length > 1);
}

/**
 * Splits prose into sentences without a heavyweight NLP dependency. Common
 * abbreviations and decimal numbers are protected so "Sept. 17" and "3.5" do
 * not split mid-sentence.
 */
export function splitSentences(text: string): string[] {
  const protectedText = text
    .replace(
      /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|approx|Sept|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Oct|Nov|Dec)\./gi,
      '$1<DOT>',
    )
    .replace(/(\d)\.(\d)/g, '$1<DOT>$2');

  return protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])|\n{2,}/)
    .map((sentence) => sentence.replace(/<DOT>/g, '.').trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Control characters that must never survive into the database or a prompt.
 * Built from a string so the source file itself stays plain ASCII.
 */
const CONTROL_CHARS = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]',
  'g',
);

/** Collapses whitespace and strips control characters from extracted text. */
export function cleanExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Formats seconds as `MM:SS`, or `H:MM:SS` past an hour. */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}
