import { NO_ANSWER_SENTENCE } from '@unipods/config';
import type { MeetingSummaryPayload } from '@unipods/types';
import { AiProviderError, type ChatMessage, type LlmProvider } from '../interfaces';
import {
  buildAnswerUserPrompt,
  CATCH_UP_SYSTEM_PROMPT,
  CONVERSATION_TITLE_SYSTEM_PROMPT,
  MEETING_SUMMARY_SYSTEM_PROMPT,
  RAG_SYSTEM_PROMPT,
} from '../prompts';
import {
  isStructuredProvider,
  type CatchUpInput,
  type CatchUpOutput,
  type GroundedAnswerInput,
  type GroundedAnswerOutput,
  type MeetingSummaryInput,
  type StructuredProvider,
} from '../structured';
import { formatTimestamp, splitSentences } from '../text';
import { truncateToTokens } from '../tokens';

/**
 * Task-level AI operations. Callers never touch a provider directly, so the
 * grounding rules below are enforced in exactly one place.
 */
export class LlmService {
  private readonly structured: StructuredProvider | null;

  constructor(private readonly provider: LlmProvider) {
    this.structured = isStructuredProvider(provider) ? provider : null;
  }

  get providerName(): string {
    return this.provider.name;
  }

  get model(): string {
    return this.provider.chatModel;
  }

  /**
   * Produces a grounded answer plus the indexes of the context items it relies
   * on.
   *
   * Citation enforcement: markers are parsed out of the model's own text and
   * validated against the context. Out-of-range markers are stripped. If a
   * substantive answer arrives with no usable citation we retry once with an
   * explicit correction, and if that also fails we downgrade to the
   * "no confirmed answer" response rather than show an uncitable claim.
   */
  async generateAnswer(input: GroundedAnswerInput): Promise<GroundedAnswerOutput> {
    if (input.context.length === 0) {
      return { answer: NO_ANSWER_SENTENCE, citedIndexes: [], answered: false, conflicting: false };
    }
    if (this.structured) {
      return this.structured.answerFromContext(input);
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: RAG_SYSTEM_PROMPT },
      ...input.history.slice(-6),
      { role: 'user', content: buildAnswerUserPrompt(input.question, input.context) },
    ];

    const first = await this.provider.complete(messages, { temperature: 0.1, maxTokens: 900 });
    let parsed = this.parseAnswer(first.content, input.context.length);

    if (!parsed.answered || parsed.citedIndexes.length > 0) {
      return parsed;
    }

    const retry = await this.provider.complete(
      [
        ...messages,
        { role: 'assistant', content: first.content },
        {
          role: 'user',
          content:
            'That answer contained no valid source citation. Rewrite it citing the bracketed index of every context item you used, for example [1]. If the context does not actually support an answer, reply with exactly: ' +
            NO_ANSWER_SENTENCE,
        },
      ],
      { temperature: 0, maxTokens: 900 },
    );
    parsed = this.parseAnswer(retry.content, input.context.length);
    if (parsed.answered && parsed.citedIndexes.length === 0) {
      return { answer: NO_ANSWER_SENTENCE, citedIndexes: [], answered: false, conflicting: false };
    }
    return parsed;
  }

  private parseAnswer(raw: string, contextSize: number): GroundedAnswerOutput {
    const text = raw.trim();
    if (!text || isNoAnswer(text)) {
      return { answer: NO_ANSWER_SENTENCE, citedIndexes: [], answered: false, conflicting: false };
    }

    const cited = new Set<number>();
    // Strip citations pointing at context items that do not exist. A model that
    // invents "[9]" for a 4-item context must not produce a phantom source.
    const cleaned = text.replace(/\[(\d+)\]/g, (match, group: string) => {
      const index = Number.parseInt(group, 10);
      if (index >= 1 && index <= contextSize) {
        cited.add(index);
        return match;
      }
      return '';
    });

    const normalised = cleaned.replace(/[ \t]{2,}/g, ' ').replace(/ ([.,;:])/g, '$1').trim();
    return {
      answer: normalised,
      citedIndexes: [...cited].sort((a, b) => a - b),
      answered: true,
      conflicting: /\bconflict|disagree|contradict|differs?\b/i.test(normalised),
    };
  }

  async generateSummary(input: MeetingSummaryInput): Promise<MeetingSummaryPayload> {
    if (this.structured) {
      return this.structured.summariseMeeting(input);
    }

    const transcript = truncateToTokens(
      input.segments
        .map(
          (segment) =>
            `[${formatTimestamp(segment.startTime)} | ${Math.round(segment.startTime)}s]${
              segment.speaker ? ` ${segment.speaker}:` : ''
            } ${segment.content}`,
        )
        .join('\n'),
      12_000,
    );

    const result = await this.provider.complete(
      [
        { role: 'system', content: MEETING_SUMMARY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `MEETING: ${input.title}\nDATE: ${input.date}\nDURATION: ${
            input.durationSeconds ? `${Math.round(input.durationSeconds / 60)} minutes` : 'unknown'
          }\n\nTRANSCRIPT:\n${transcript}`,
        },
      ],
      { temperature: 0.1, maxTokens: 1_600, json: true },
    );

    const payload = safeJsonParse<Partial<MeetingSummaryPayload>>(result.content);
    if (!payload) {
      throw new AiProviderError(
        'The model did not return a parseable meeting summary.',
        this.provider.name,
      );
    }
    return normaliseSummary(payload, this.provider.name, result.model);
  }

  /** Decisions are a projection of the summary; no extra model call is made. */
  async extractDecisions(input: MeetingSummaryInput): Promise<MeetingSummaryPayload['decisions']> {
    return (await this.generateSummary(input)).decisions;
  }

  async extractActionItems(input: MeetingSummaryInput): Promise<MeetingSummaryPayload['actionItems']> {
    return (await this.generateSummary(input)).actionItems;
  }

  async generateCatchUp(input: CatchUpInput): Promise<CatchUpOutput> {
    if (input.items.length === 0) {
      return {
        summary: `Nothing new was recorded ${input.periodLabel}.`,
        importance: [],
        itemSummaries: [],
      };
    }
    if (this.structured) {
      return this.structured.generateCatchUp(input);
    }

    const rendered = input.items
      .map(
        (item, index) =>
          `[${index + 1}] (${item.type}${item.occurredAt ? `, ${item.occurredAt.slice(0, 10)}` : ''}) ${item.title}\n${truncateToTokens(item.content, 400)}`,
      )
      .join('\n\n');

    const result = await this.provider.complete(
      [
        { role: 'system', content: CATCH_UP_SYSTEM_PROMPT },
        { role: 'user', content: `PERIOD: ${input.periodLabel}\n\nUPDATES:\n\n${rendered}` },
      ],
      { temperature: 0.2, maxTokens: 1_200, json: true },
    );

    const payload = safeJsonParse<Partial<CatchUpOutput>>(result.content);
    if (!payload) {
      throw new AiProviderError(
        'The model did not return a parseable catch-up.',
        this.provider.name,
      );
    }
    return normaliseCatchUp(payload, input.items.length);
  }

  /**
   * Conversation titles are cosmetic, so a model failure must never fail the
   * chat request — we fall back to a trimmed version of the question.
   */
  async generateTitle(question: string): Promise<string> {
    const fallback = fallbackTitle(question);
    if (this.structured) return fallback;
    try {
      const result = await this.provider.complete(
        [
          { role: 'system', content: CONVERSATION_TITLE_SYSTEM_PROMPT },
          { role: 'user', content: question },
        ],
        { temperature: 0.3, maxTokens: 24 },
      );
      const title = result.content.trim().replace(/^["']|["'.]+$/g, '');
      return title.length >= 3 ? title.slice(0, 80) : fallback;
    } catch {
      return fallback;
    }
  }
}

function isNoAnswer(text: string): boolean {
  const normalised = text.toLowerCase().replace(/\s+/g, ' ').replace(/[".]/g, '').trim();
  const target = NO_ANSWER_SENTENCE.toLowerCase().replace(/[".]/g, '').trim();
  return normalised === target || normalised.startsWith(target);
}

function fallbackTitle(question: string): string {
  const firstSentence = splitSentences(question)[0] ?? question;
  const words = firstSentence.trim().split(/\s+/).slice(0, 8).join(' ');
  const title = words.replace(/[?!.]+$/, '');
  return title.length > 0 ? title.slice(0, 80) : 'New conversation';
}

function safeJsonParse<T>(raw: string): T | null {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  // Models sometimes wrap JSON in a fenced block despite json mode.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const braced = trimmed.match(/\{[\s\S]*\}/);
  if (braced?.[0]) candidates.push(braced[0]);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      continue;
    }
  }
  return null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normaliseSummary(
  payload: Partial<MeetingSummaryPayload>,
  provider: string,
  model: string,
): MeetingSummaryPayload {
  return {
    tldr: typeof payload.tldr === 'string' ? payload.tldr : '',
    topics: asArray<string>(payload.topics).filter((topic) => typeof topic === 'string'),
    decisions: asArray<{ text: string; startTime?: number }>(payload.decisions)
      .filter((item) => typeof item?.text === 'string')
      .map((item) => ({ text: item.text, startTime: numberOrUndefined(item.startTime) })),
    actionItems: asArray<MeetingSummaryPayload['actionItems'][number]>(payload.actionItems)
      .filter((item) => typeof item?.text === 'string')
      .map((item) => ({
        text: item.text,
        owner: typeof item.owner === 'string' ? item.owner : null,
        due: typeof item.due === 'string' ? item.due : null,
        startTime: numberOrUndefined(item.startTime),
      })),
    deadlines: asArray<{ text: string; date?: string | null }>(payload.deadlines)
      .filter((item) => typeof item?.text === 'string')
      .map((item) => ({ text: item.text, date: typeof item.date === 'string' ? item.date : null })),
    openQuestions: asArray<string>(payload.openQuestions).filter(
      (question) => typeof question === 'string',
    ),
    keyMoments: asArray<{ label: string; startTime: number }>(payload.keyMoments)
      .filter((item) => typeof item?.label === 'string' && Number.isFinite(item?.startTime))
      .map((item) => ({ label: item.label, startTime: Number(item.startTime) })),
    generatedBy: { provider, model, generatedAt: new Date().toISOString() },
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The per-item arrays must line up with the input or the UI would attach the
 * wrong summary to the wrong update, so they are padded/trimmed to length.
 */
function normaliseCatchUp(payload: Partial<CatchUpOutput>, itemCount: number): CatchUpOutput {
  const importance = asArray<string>(payload.importance).map((level) =>
    level === 'high' || level === 'medium' || level === 'low' ? level : 'low',
  );
  const itemSummaries = asArray<string>(payload.itemSummaries).map((summary) =>
    typeof summary === 'string' ? summary : '',
  );
  return {
    summary: typeof payload.summary === 'string' ? payload.summary : '',
    importance: Array.from({ length: itemCount }, (_, i) => importance[i] ?? 'low'),
    itemSummaries: Array.from({ length: itemCount }, (_, i) => itemSummaries[i] ?? ''),
  };
}
