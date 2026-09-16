import { NO_ANSWER_SENTENCE } from '@unipods/config';
import { beforeAll, describe, expect, it } from 'vitest';
import { EmbeddingService } from '../services/embedding.service';
import { LlmService } from '../services/llm.service';
import { LocalProvider } from '../providers/local.provider';
import type { GroundedContextItem } from '../structured';

const provider = new LocalProvider(1536);
const embeddings = new EmbeddingService(provider);
const llm = new LlmService(provider);

const context = (overrides: Partial<GroundedContextItem> & { index: number; content: string }) => ({
  sourceId: `source-${overrides.index}`,
  title: 'Untitled',
  kind: 'DOCUMENT',
  locator: '',
  date: null,
  ...overrides,
});

describe('LocalProvider embeddings', () => {
  it('produces unit vectors of the configured size', async () => {
    const [vector] = await embeddings.embedTexts(['team declaration deadline']);
    expect(vector).toHaveLength(1536);
    const norm = Math.sqrt((vector as number[]).reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('is deterministic', async () => {
    const [a, b] = await embeddings.embedTexts(['same text', 'same text']);
    expect(a).toEqual(b);
  });

  it('scores a related sentence above an unrelated one', async () => {
    const [question, related, unrelated] = await embeddings.embedTexts([
      'When is the team declaration deadline?',
      'Team declarations are due Thursday, September 17, by close of business.',
      'Pasta is served in the cafeteria on Tuesdays.',
    ]);
    const cosine = (x: number[], y: number[]) => x.reduce((sum, value, i) => sum + value * (y[i] as number), 0);
    expect(cosine(question as number[], related as number[])).toBeGreaterThan(
      cosine(question as number[], unrelated as number[]),
    );
  });

  it('handles empty input without producing NaN', async () => {
    const [vector] = await embeddings.embedTexts(['']);
    expect((vector as number[]).every(Number.isFinite)).toBe(true);
  });

  it('preserves input order across batch boundaries', async () => {
    const service = new EmbeddingService(provider, { batchSize: 2 });
    const texts = ['alpha one', 'beta two', 'gamma three', 'delta four', 'epsilon five'];
    const vectors = await service.embedTexts(texts);
    for (const [index, text] of texts.entries()) {
      const [expected] = await embeddings.embedTexts([text]);
      expect(vectors[index]).toEqual(expected);
    }
  });
});

describe('grounded answering', () => {
  it('refuses to answer with no context', async () => {
    const result = await llm.generateAnswer({ question: 'Anything?', context: [], history: [] });
    expect(result.answer).toBe(NO_ANSWER_SENTENCE);
    expect(result.answered).toBe(false);
    expect(result.citedIndexes).toEqual([]);
  });

  it('refuses when the context does not support the question', async () => {
    const result = await llm.generateAnswer({
      question: 'How much is the first prize in cash?',
      context: [
        context({ index: 1, title: 'Program Guide', content: 'Pods meet weekly and keep shared notes.' }),
      ],
      history: [],
    });
    expect(result.answered).toBe(false);
    expect(result.answer).toBe(NO_ANSWER_SENTENCE);
  });

  it('answers from the context and cites the item it used', async () => {
    const result = await llm.generateAnswer({
      question: 'When is the team declaration deadline?',
      context: [
        context({ index: 1, title: 'Program Guide', content: 'Pods meet weekly to review progress.' }),
        context({
          index: 2,
          title: 'Hackathon Announcement',
          date: '2026-09-16T00:00:00.000Z',
          content: 'Team declarations are due Thursday, September 17, 2026, by close of business.',
        }),
      ],
      history: [],
    });
    expect(result.answered).toBe(true);
    expect(result.citedIndexes).toContain(2);
    expect(result.answer).toContain('September 17');
  });

  it('quotes only text that appears in the context', async () => {
    const source = 'Submissions close at 23:59 on Wednesday, September 23, 2026.';
    const result = await llm.generateAnswer({
      question: 'When do submissions close?',
      context: [context({ index: 1, title: 'Guidelines', content: source })],
      history: [],
    });
    const quoted = [...result.answer.matchAll(/"([^"]+)"/g)].map((match) => match[1] as string);
    expect(quoted.length).toBeGreaterThan(0);
    for (const quote of quoted) expect(source).toContain(quote);
  });

  it('reports a genuine conflict and prefers the more recent source', async () => {
    const result = await llm.generateAnswer({
      question: 'When is the registration deadline?',
      context: [
        context({
          index: 1,
          title: 'Old Schedule',
          date: '2026-09-01T00:00:00.000Z',
          content: 'The registration deadline is September 18.',
        }),
        context({
          index: 2,
          title: 'Corrected Announcement',
          date: '2026-09-16T00:00:00.000Z',
          content: 'The registration deadline is September 17.',
        }),
      ],
      history: [],
    });
    expect(result.conflicting).toBe(true);
    expect(result.answer).toContain('disagree');
    expect(result.answer).toContain('Corrected Announcement');
  });

  it('does not invent a conflict between the same date stated twice', async () => {
    const result = await llm.generateAnswer({
      question: 'When is the registration deadline?',
      context: [
        context({
          index: 1,
          title: 'Guidelines',
          date: '2026-09-05T00:00:00.000Z',
          content: 'Registration closes on September 17.',
        }),
        context({
          index: 2,
          title: 'Announcement',
          date: '2026-09-16T00:00:00.000Z',
          content: 'Registration closes on September 17, 2026.',
        }),
      ],
      history: [],
    });
    expect(result.conflicting).toBe(false);
  });

  it('does not treat someone asking the same question as the answer', async () => {
    const result = await llm.generateAnswer({
      question: 'What did we decide about the architecture?',
      context: [
        context({
          index: 1,
          title: 'General chat',
          content: 'Did anyone write down what was decided about the architecture?',
        }),
        context({
          index: 2,
          title: 'Architecture Meeting',
          content: 'Then it is decided. The prototype will use retrieval-augmented generation.',
        }),
      ],
      history: [],
    });
    expect(result.answer).toContain('retrieval-augmented generation');
  });
});

describe('meeting summarisation', () => {
  const segments = [
    { speaker: 'Amara', content: 'Welcome everyone, we are here to pick an approach.', startTime: 0, endTime: 10 },
    { speaker: 'Tunde', content: 'Should we fine-tune a model instead?', startTime: 300, endTime: 310 },
    {
      speaker: 'Amara',
      content: 'Then it is decided. We will use hybrid retrieval with citations.',
      startTime: 1935,
      endTime: 1960,
    },
    {
      speaker: 'Chidi',
      content: 'I will build the ingestion pipeline by Friday.',
      startTime: 2280,
      endTime: 2300,
    },
  ];

  let summary: Awaited<ReturnType<typeof provider.summariseMeeting>>;

  beforeAll(async () => {
    summary = await provider.summariseMeeting({
      title: 'Architecture Meeting',
      date: '2026-09-15T14:00:00.000Z',
      durationSeconds: 2700,
      segments,
    });
  });

  it('extracts the decision with its timestamp and its substance', () => {
    expect(summary.decisions).toHaveLength(1);
    expect(summary.decisions[0]?.startTime).toBe(1935);
    expect(summary.decisions[0]?.text).toContain('hybrid retrieval');
  });

  it('extracts the action item with owner and due date', () => {
    expect(summary.actionItems[0]?.text).toContain('ingestion pipeline');
    expect(summary.actionItems[0]?.owner).toBe('Chidi');
    expect(summary.actionItems[0]?.due).toBe('Friday');
  });

  it('never lists a question as a decision', () => {
    for (const decision of summary.decisions) expect(decision.text.endsWith('?')).toBe(false);
  });

  it('shows readable topic labels rather than stems', () => {
    for (const topic of summary.topics) expect(topic).toMatch(/^[A-Z][a-z]+$/);
  });

  it('returns empty structures for an empty transcript', async () => {
    const empty = await provider.summariseMeeting({
      title: 'Empty',
      date: '2026-09-15T14:00:00.000Z',
      durationSeconds: null,
      segments: [],
    });
    expect(empty.decisions).toEqual([]);
    expect(empty.actionItems).toEqual([]);
  });
});

describe('capabilities it does not have', () => {
  it('refuses to transcribe rather than inventing a transcript', async () => {
    await expect(provider.transcribe()).rejects.toThrow(/transcribe audio/i);
  });

  it('refuses free-form completion rather than guessing', async () => {
    await expect(provider.complete([])).rejects.toThrow(/offline provider/i);
  });
});
