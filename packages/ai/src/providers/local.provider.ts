import { createHash } from 'node:crypto';
import { NO_ANSWER_SENTENCE } from '@unipods/config';
import type { MeetingSummaryPayload } from '@unipods/types';
import {
  AiCapabilityUnavailableError,
  type ChatMessage,
  type CompletionResult,
  type EmbeddingProvider,
  type EmbeddingResult,
  type LlmProvider,
  type TranscriptionProvider,
  type TranscriptionResult,
} from '../interfaces';
import type {
  CatchUpInput,
  CatchUpOutput,
  GroundedAnswerInput,
  GroundedAnswerOutput,
  GroundedContextItem,
  MeetingSummaryInput,
  StructuredProvider,
} from '../structured';
import {
  ACTION_CUES,
  CALENDAR_DATE_PATTERN,
  DATE_PATTERN,
  DEADLINE_CUES,
  DECISION_CUES,
  HEDGE_CUES,
  URGENT_CUES,
} from '../cues';
import { contentTokens, splitSentences } from '../text';

/**
 * Offline, deterministic AI provider.
 *
 * It exists so the whole product — ingestion, retrieval, answering, summaries,
 * catch-up — can run, be tested and be demoed with no external service and no
 * API key. It is *not* a language model and does not pretend to be one:
 *
 *   - Embeddings are a hashed bag-of-n-grams random projection. Cosine
 *     similarity between two of these vectors measures weighted lexical
 *     overlap. That is real retrieval signal, but it does not generalise across
 *     paraphrases the way a trained embedding model does.
 *   - Answers, summaries and catch-ups are *extractive*: every sentence in the
 *     output is copied verbatim from a retrieved source. Nothing is generated,
 *     so nothing can be hallucinated.
 *   - Speech-to-text is genuinely unavailable and throws rather than inventing
 *     a transcript. Upload an existing transcript, or configure a real
 *     provider.
 *
 * Set `AI_PROVIDER=openai` for fluent, paraphrasing answers in production.
 */
export class LocalProvider
  implements LlmProvider, EmbeddingProvider, TranscriptionProvider, StructuredProvider
{
  readonly name = 'local';
  readonly chatModel = 'local-extractive-v1';
  readonly embeddingModel = 'local-hashed-ngrams-v1';
  readonly transcriptionModel = 'unavailable';

  constructor(readonly dimensions: number = 1536) {}

  // -------------------------------------------------------------------------
  // LlmProvider
  // -------------------------------------------------------------------------

  async complete(_messages: ChatMessage[]): Promise<CompletionResult> {
    throw new AiCapabilityUnavailableError(
      this.name,
      'run free-form chat completions',
      'The offline provider only produces extractive output. Set AI_PROVIDER=openai and OPENAI_API_KEY to enable generative answers.',
    );
  }

  // -------------------------------------------------------------------------
  // EmbeddingProvider
  // -------------------------------------------------------------------------

  async embed(texts: string[]): Promise<EmbeddingResult> {
    return {
      embeddings: texts.map((text) => this.embedOne(text)),
      model: this.embeddingModel,
      provider: this.name,
      dimensions: this.dimensions,
    };
  }

  /**
   * Hashed random projection of term frequencies.
   *
   * Each unigram and bigram is hashed to `PROJECTIONS` signed positions in the
   * output vector, weighted by sublinear term frequency. The result is L2
   * normalised so a dot product is a cosine similarity.
   */
  private embedOne(text: string): number[] {
    const vector = new Float64Array(this.dimensions);
    // Stopwords are excluded deliberately: with a purely lexical projection,
    // "the/is/on" would otherwise dominate cosine similarity and make every
    // pair of English sentences look related.
    const unigrams = contentTokens(text);
    const terms = new Map<string, number>();

    const bump = (term: string, weight: number) => {
      terms.set(term, (terms.get(term) ?? 0) + weight);
    };

    for (let i = 0; i < unigrams.length; i += 1) {
      const token = unigrams[i] as string;
      bump(token, 1);
      const next = unigrams[i + 1];
      if (next) bump(`${token}_${next}`, 0.5);
    }

    if (terms.size === 0) {
      // An empty document still needs a valid unit vector; pin it to a fixed
      // direction so identical empties collide rather than producing NaN.
      vector[0] = 1;
      return Array.from(vector);
    }

    const PROJECTIONS = 4;
    for (const [term, rawWeight] of terms) {
      const weight = 1 + Math.log(rawWeight);
      const digest = createHash('sha256').update(term).digest();
      for (let p = 0; p < PROJECTIONS; p += 1) {
        const offset = p * 5;
        const index =
          (((digest[offset] as number) << 24) |
            ((digest[offset + 1] as number) << 16) |
            ((digest[offset + 2] as number) << 8) |
            (digest[offset + 3] as number)) >>>
          0;
        const sign = ((digest[offset + 4] as number) & 1) === 0 ? 1 : -1;
        vector[index % this.dimensions] += sign * weight;
      }
    }

    let norm = 0;
    for (let i = 0; i < vector.length; i += 1) norm += (vector[i] as number) ** 2;
    norm = Math.sqrt(norm);
    if (norm === 0) {
      vector[0] = 1;
      return Array.from(vector);
    }
    const out = new Array<number>(this.dimensions);
    for (let i = 0; i < this.dimensions; i += 1) out[i] = (vector[i] as number) / norm;
    return out;
  }

  // -------------------------------------------------------------------------
  // TranscriptionProvider
  // -------------------------------------------------------------------------

  async transcribe(): Promise<TranscriptionResult> {
    throw new AiCapabilityUnavailableError(
      this.name,
      'transcribe audio',
      'Set AI_PROVIDER=openai with OPENAI_API_KEY, or upload an existing transcript (.vtt/.srt/.json) to POST /api/meetings/:id/transcript.',
    );
  }

  // -------------------------------------------------------------------------
  // StructuredProvider — extractive, never generative
  // -------------------------------------------------------------------------

  async answerFromContext(input: GroundedAnswerInput): Promise<GroundedAnswerOutput> {
    const { question, context } = input;
    if (context.length === 0) {
      return { answer: NO_ANSWER_SENTENCE, citedIndexes: [], answered: false, conflicting: false };
    }

    const queryTerms = new Set(contentTokens(question));
    const idf = buildIdf(context.map((item) => stripContextHeader(item.content)));
    const intent = classifyIntent(question);

    const recency = buildRecencyWeights(context);
    const scored: ScoredSentence[] = [];
    for (const item of context) {
      const itemWeight = recency.get(item.index) ?? 1;
      // The indexer's contextual header is retrieval scaffolding; quoting it
      // back would put words in the source's mouth.
      const sentences = splitSentences(stripContextHeader(item.content));
      for (let i = 0; i < sentences.length; i += 1) {
        const sentence = sentences[i] as string;
        const score = scoreSentence(sentence, queryTerms, idf, intent, titleTerms(item)) * itemWeight;
        if (score <= 0) continue;
        // "Then it is decided." on its own tells the reader nothing, so a short
        // cue sentence is quoted together with the sentence that follows it.
        const next = sentences[i + 1];
        const needsContinuation =
          next !== undefined &&
          sentence.trim().split(/\s+/).length < 10 &&
          (DECISION_CUES.test(sentence) || ACTION_CUES.test(sentence));
        scored.push({ sentence: needsContinuation ? `${sentence} ${next}` : sentence, score, item });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    // Requires at least two distinct query terms' worth of evidence.
    const threshold = 0.9;
    if (!best || best.score < threshold) {
      return { answer: NO_ANSWER_SENTENCE, citedIndexes: [], answered: false, conflicting: false };
    }

    const selected = pickDiverse(scored, 4, best.score * 0.35);
    const conflict = detectConflict(selected, intent);

    const lines = selected.map((entry) => `- "${entry.sentence}" [${entry.item.index}]`);
    const parts: string[] = [];
    parts.push(leadIn(intent));
    parts.push(lines.join('\n'));

    if (conflict) {
      parts.push(conflict.explanation);
    }

    parts.push(
      'This answer quotes the community records directly (offline extractive mode). Open the sources below to see the full context.',
    );

    const citedIndexes = [...new Set(selected.map((entry) => entry.item.index))];
    return {
      answer: parts.join('\n\n'),
      citedIndexes,
      answered: true,
      conflicting: Boolean(conflict),
    };
  }

  async summariseMeeting(input: MeetingSummaryInput): Promise<MeetingSummaryPayload> {
    const segments = input.segments.filter((segment) => segment.content.trim().length > 0);
    if (segments.length === 0) {
      return emptySummary(this.name, this.chatModel);
    }

    const sentences: TimedSentence[] = [];
    for (const segment of segments) {
      for (const sentence of splitSentences(segment.content)) {
        sentences.push({ text: sentence, startTime: segment.startTime, speaker: segment.speaker });
      }
    }

    const idf = buildIdf(sentences.map((sentence) => sentence.text));
    const central = [...sentences]
      .map((sentence) => ({ sentence, score: centralityScore(sentence.text, idf) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .sort((a, b) => a.sentence.startTime - b.sentence.startTime);

    const decisions = sentences
      .filter((sentence) => DECISION_CUES.test(sentence.text))
      .slice(0, 8)
      .map((sentence) => ({ text: sentence.text, startTime: Math.round(sentence.startTime) }));

    const actionItems = sentences
      .filter((sentence) => ACTION_CUES.test(sentence.text) && !DECISION_CUES.test(sentence.text))
      .slice(0, 10)
      .map((sentence) => ({
        text: sentence.text,
        owner: extractOwner(sentence),
        due: extractDate(sentence.text),
        startTime: Math.round(sentence.startTime),
      }));

    const deadlines = sentences
      .filter((sentence) => DEADLINE_CUES.test(sentence.text) && DATE_PATTERN.test(sentence.text))
      .slice(0, 6)
      .map((sentence) => ({ text: sentence.text, date: extractDate(sentence.text) }));

    const openQuestions = sentences
      .filter((sentence) => sentence.text.trim().endsWith('?'))
      .slice(0, 6)
      .map((sentence) => sentence.text);

    const keyMoments = [...decisions, ...actionItems]
      .slice(0, 6)
      .map((entry) => ({ label: shorten(entry.text, 60), startTime: entry.startTime ?? 0 }))
      .sort((a, b) => a.startTime - b.startTime);

    return {
      tldr: central.map((entry) => entry.sentence.text).join(' '),
      topics: topTopics(sentences.map((sentence) => sentence.text), idf, 6),
      decisions,
      actionItems,
      deadlines,
      openQuestions,
      keyMoments,
      generatedBy: {
        provider: this.name,
        model: this.chatModel,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  async generateCatchUp(input: CatchUpInput): Promise<CatchUpOutput> {
    const importance = input.items.map((item) => {
      if (item.type === 'announcement' || URGENT_CUES.test(item.content)) return 'high' as const;
      if (item.type === 'meeting' || item.type === 'document') return 'medium' as const;
      return 'low' as const;
    });

    const idf = buildIdf(input.items.map((item) => item.content));
    const itemSummaries = input.items.map((item) => {
      const sentences = splitSentences(item.content);
      if (sentences.length === 0) return shorten(item.content, 200);
      const ranked = sentences
        .map((sentence) => ({ sentence, score: centralityScore(sentence, idf) }))
        .sort((a, b) => b.score - a.score);
      return shorten(ranked[0]?.sentence ?? sentences[0] ?? '', 220);
    });

    const highCount = importance.filter((level) => level === 'high').length;
    const summary =
      input.items.length === 0
        ? `Nothing new was recorded ${input.periodLabel}.`
        : `${input.items.length} update${input.items.length === 1 ? '' : 's'} ${input.periodLabel}` +
          (highCount > 0 ? `, ${highCount} of them time-sensitive.` : '.') +
          ' Each item below links to the source it came from.';

    return { summary, importance, itemSummaries };
  }
}

// ---------------------------------------------------------------------------
// Extractive helpers
// ---------------------------------------------------------------------------

interface ScoredSentence {
  sentence: string;
  score: number;
  item: GroundedContextItem;
}

interface TimedSentence {
  text: string;
  startTime: number;
  speaker: string | null;
}

type Intent = 'when' | 'who' | 'decision' | 'howmany' | 'general';

/** The "Author (2026-09-16):" stamp the message indexer prepends. */
/** Header the indexer prepends to a chunk: `[Title · locator]` on its own line. */
const CONTEXT_HEADER = /^\[[^\]\n]{1,200}\]\n/;

function stripContextHeader(content: string): string {
  return content.replace(CONTEXT_HEADER, '');
}

const ATTRIBUTION_PREFIX = /^\s*\[?[^\]\n]{0,80}\]?\s*[A-Za-z][^:\n]{0,60}\(\d{4}-\d{2}-\d{2}\):\s*/;

function classifyIntent(question: string): Intent {
  const q = question.toLowerCase();
  if (/\b(when|what time|deadline|due|date|closes?)\b/.test(q)) return 'when';
  if (/\b(who|whom|which person|owner|assigned)\b/.test(q)) return 'who';
  if (/\b(decide|decided|decision|agreed|conclusion|chose)\b/.test(q)) return 'decision';
  if (/\b(how many|how much|number of|count)\b/.test(q)) return 'howmany';
  return 'general';
}

function leadIn(intent: Intent): string {
  switch (intent) {
    case 'when':
      return 'Here is what the community records say about the timing:';
    case 'who':
      return 'Here is what the community records say about who is involved:';
    case 'decision':
      return 'Here is what the community records say was decided:';
    case 'howmany':
      return 'Here are the figures recorded in the community sources:';
    default:
      return 'Here is what the community records say:';
  }
}

/** Inverse document frequency across the supplied documents. */
function buildIdf(documents: string[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const document of documents) {
    for (const term of new Set(contentTokens(document))) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const total = Math.max(1, documents.length);
  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    idf.set(term, Math.log(1 + total / count));
  }
  return idf;
}

function titleTerms(item: GroundedContextItem): Set<string> {
  return new Set(contentTokens(item.title));
}

/**
 * Scores a sentence against the question.
 *
 * A query term found only in the *source's title* still counts, at half weight:
 * "what did we decide about the AI architecture" should reach a decision
 * recorded in the AI Architecture Meeting even though the sentence itself never
 * repeats the meeting's name. Titles are real metadata, not invention.
 */
function scoreSentence(
  sentence: string,
  queryTerms: Set<string>,
  idf: Map<string, number>,
  intent: Intent,
  sourceTitleTerms: Set<string> = new Set(),
): number {
  const tokens = new Set(contentTokens(sentence));
  if (tokens.size === 0) return 0;

  let score = 0;
  let matched = 0;
  for (const term of queryTerms) {
    if (tokens.has(term)) {
      score += idf.get(term) ?? 1;
      matched += 1;
    } else if (sourceTitleTerms.has(term)) {
      score += (idf.get(term) ?? 1) * 0.5;
      matched += 0.5;
    }
  }
  // At least one term must appear in the sentence itself; a title match alone
  // would make every sentence of a well-named source look relevant.
  const inSentence = [...queryTerms].some((term) => tokens.has(term));
  if (!inSentence) return 0;
  if (matched === 0) return 0;

  // Reward coverage of the question, penalise very long sentences mildly.
  score *= matched / Math.max(1, queryTerms.size);
  score /= Math.log(4 + tokens.size) / Math.log(4 + 20);

  if (intent === 'when' && DATE_PATTERN.test(sentence)) score *= 1.6;
  if (intent === 'when' && DEADLINE_CUES.test(sentence)) score *= 1.3;
  if (intent === 'decision' && DECISION_CUES.test(sentence)) score *= 1.6;
  if (intent === 'howmany' && /\b\d+\b/.test(sentence)) score *= 1.4;
  if (intent === 'who' && /\b[A-Z][a-z]{2,}\b/.test(sentence)) score *= 1.2;

  // Tentative statements are still worth showing, but a confirmed statement
  // should outrank them when both mention the same thing.
  if (HEDGE_CUES.test(sentence)) score *= 0.8;

  // Someone else asking the same question is not an answer to it. Community
  // archives are full of these, and they match the query wording better than
  // the reply does, so they need an explicit penalty.
  if (sentence.trim().endsWith('?')) score *= 0.25;

  return score;
}

/**
 * Mild preference for newer sources, so that when an old discussion and a
 * recent announcement both match, the announcement leads. Sources without a
 * date are treated as neutral.
 */
function buildRecencyWeights(context: GroundedContextItem[]): Map<number, number> {
  const times = context
    .map((item) => (item.date ? Date.parse(item.date) : Number.NaN))
    .filter((time) => !Number.isNaN(time));
  const weights = new Map<number, number>();
  if (times.length < 2) {
    for (const item of context) weights.set(item.index, 1);
    return weights;
  }
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = max - min;
  for (const item of context) {
    const time = item.date ? Date.parse(item.date) : Number.NaN;
    if (Number.isNaN(time) || span === 0) {
      weights.set(item.index, 1);
    } else {
      weights.set(item.index, 1 + 0.35 * ((time - min) / span));
    }
  }
  return weights;
}

/** Keeps the strongest sentences while avoiding near-duplicates. */
function pickDiverse(scored: ScoredSentence[], max: number, minScore: number): ScoredSentence[] {
  const chosen: ScoredSentence[] = [];
  const seen: Array<Set<string>> = [];

  for (const candidate of scored) {
    if (chosen.length >= max) break;
    if (candidate.score < minScore) break;
    const tokens = new Set(contentTokens(candidate.sentence));
    const duplicate = seen.some((previous) => jaccard(previous, tokens) > 0.7);
    if (duplicate) continue;
    chosen.push(candidate);
    seen.push(tokens);
  }
  return chosen;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

interface Conflict {
  explanation: string;
}

/**
 * Flags the case where two different sources state different dates/figures for
 * what looks like the same fact. Conflicts are surfaced, never hidden.
 */
function detectConflict(selected: ScoredSentence[], intent: Intent): Conflict | null {
  if (intent !== 'when' && intent !== 'howmany') return null;
  if (selected.length < 2) return null;

  const byValue = new Map<string, ScoredSentence>();
  for (const entry of selected) {
    // Prefer a concrete calendar date ("September 17") over a weekday name,
    // otherwise "Thursday" and "September 18" would look like a disagreement
    // when they may describe the same day.
    // Message chunks are stored as "Author (2026-09-16): text". That leading
    // stamp is provenance, not a date the source states, so comparing it
    // against a real deadline would invent a disagreement.
    const body = entry.sentence.replace(ATTRIBUTION_PREFIX, '');
    const match =
      intent === 'when'
        ? (body.match(CALENDAR_DATE_PATTERN) ?? body.match(DATE_PATTERN))
        : body.match(/\b\d+(?:\.\d+)?\b/);
    if (!match) continue;
    const key = intent === 'when' ? canonicalDateKey(match[0]) : normaliseValue(match[0]);
    if (!byValue.has(key)) byValue.set(key, entry);
  }
  if (byValue.size < 2) return null;

  const entries = [...byValue.entries()];
  const distinctSources = new Set(entries.map(([, entry]) => entry.item.sourceId));
  if (distinctSources.size < 2) return null;

  const dated = entries
    .map(([value, entry]) => ({ value, entry, time: entry.item.date ? Date.parse(entry.item.date) : NaN }))
    .sort((a, b) => (Number.isNaN(b.time) ? -1 : b.time) - (Number.isNaN(a.time) ? -1 : a.time));

  const described = dated
    .map(
      ({ value, entry }) =>
        `"${value}" according to ${entry.item.title}${entry.item.date ? ` (${entry.item.date.slice(0, 10)})` : ''} [${entry.item.index}]`,
    )
    .join(', while another source says ');

  const newest = dated[0];
  const preference = newest?.entry.item.date
    ? ` The most recent source is ${newest.entry.item.title} [${newest.entry.item.index}], so treat that as current — but please verify with the organisers if the difference matters.`
    : ' Please verify with the organisers which one is current.';

  return {
    explanation: `The sources disagree: ${described}.${preference}`,
  };
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function normaliseValue(value: string): string {
  return value.toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Reduces a date to month-day.
 *
 * "September 17" and "September 17, 2026" are the same deadline stated with
 * different precision, and reporting them as a disagreement would be worse than
 * saying nothing. The year is deliberately dropped: within a community archive
 * the ambiguous case is precision, not a different year.
 */
function canonicalDateKey(value: string): string {
  const normalised = normaliseValue(value);

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalised);
  if (iso) return `${iso[2]}-${iso[3]}`;

  const monthFirst = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+\d{4})?$/.exec(normalised);
  if (monthFirst) {
    const month = MONTHS[(monthFirst[1] as string).slice(0, 3)];
    if (month) return `${month}-${(monthFirst[2] as string).padStart(2, '0')}`;
  }

  const dayFirst = /^(\d{1,2})\s+([a-z]{3,9})(?:\s+\d{4})?$/.exec(normalised);
  if (dayFirst) {
    const month = MONTHS[(dayFirst[2] as string).slice(0, 3)];
    if (month) return `${month}-${(dayFirst[1] as string).padStart(2, '0')}`;
  }

  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/.exec(normalised);
  if (slash) {
    return `${(slash[2] as string).padStart(2, '0')}-${(slash[1] as string).padStart(2, '0')}`;
  }

  // Weekday names and relative words ("tomorrow") cannot be resolved without a
  // reference date, so they compare as themselves.
  return normalised;
}

function centralityScore(sentence: string, idf: Map<string, number>): number {
  const tokens = contentTokens(sentence);
  if (tokens.length < 4) return 0;
  let score = 0;
  for (const term of new Set(tokens)) score += idf.get(term) ?? 0;
  return score / Math.sqrt(tokens.length);
}

function topTopics(sentences: string[], idf: Map<string, number>, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    for (const term of contentTokens(sentence)) {
      if (term.length < 4) continue;
      counts.set(term, (counts.get(term) ?? 0) + (idf.get(term) ?? 1));
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => term.charAt(0).toUpperCase() + term.slice(1));
}

function extractOwner(sentence: TimedSentence): string | null {
  const named = sentence.text.match(/\b([A-Z][a-z]{2,})\s+(?:will|is going to|to)\b/);
  if (named) return named[1] ?? null;
  return sentence.speaker;
}

function extractDate(text: string): string | null {
  const match = text.match(DATE_PATTERN);
  return match ? match[0] : null;
}

function shorten(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function emptySummary(provider: string, model: string): MeetingSummaryPayload {
  return {
    tldr: 'No transcript content was available to summarise.',
    topics: [],
    decisions: [],
    actionItems: [],
    deadlines: [],
    openQuestions: [],
    keyMoments: [],
    generatedBy: { provider, model, generatedAt: new Date().toISOString() },
  };
}
