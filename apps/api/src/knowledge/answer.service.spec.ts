import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from '../bot/bot.types.js';
import { AnswerService, NO_ANSWER_REPLY, SMALL_TALK_REPLY } from './answer.service.js';
import type { KnowledgeClaudeService } from './claude.service.js';
import { KnowledgeStoreService } from './knowledge-store.service.js';
import { loadKnowledgeConfig } from './knowledge.config.js';
import { GLOBAL_SCOPE, type KnowledgeEntry } from './knowledge.types.js';

const CHAT = 'group-1';

const message = (overrides: Partial<IncomingMessage> = {}): IncomingMessage => ({
  channel: 'telegram',
  chatId: CHAT,
  senderId: 'member-1',
  senderName: 'Amina',
  messageId: 'm1',
  text: 'what are the opening hours?',
  isGroup: true,
  mentionedMe: true,
  timestamp: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

/** Stands in for Claude; records what it was asked to read. */
class FakeClaude {
  enabled = true;
  composed: {
    answer: string | null;
    confidence: number;
    citationIds: string[];
    isCommunityQuestion?: boolean;
  } = { answer: null, confidence: 0, citationIds: [] };
  selection: string[] = [];
  composeCalls: { question: string; entries: KnowledgeEntry[] }[] = [];
  selectCalls: { question: string; candidates: KnowledgeEntry[] }[] = [];

  summarise = async () => 'summary';

  selectRelevant = async (question: string, candidates: KnowledgeEntry[]) => {
    this.selectCalls.push({ question, candidates });
    return this.selection;
  };

  composeAnswer = async (question: string, entries: KnowledgeEntry[]) => {
    this.composeCalls.push({ question, entries });
    return this.composed;
  };

  catchUp = async () => 'catch up';
}

const build = async (env: Record<string, string> = {}) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kb-'));
  const config = loadKnowledgeConfig({
    ANTHROPIC_API_KEY: 'test-key',
    KNOWLEDGE_DATA_DIR: dataDir,
    ...env,
  });

  const store = new KnowledgeStoreService(config);
  await store.onModuleInit();

  const claude = new FakeClaude();
  const answer = new AnswerService(config, store, claude as unknown as KnowledgeClaudeService);
  return { answer, store, claude, config };
};

const addEntry = (store: KnowledgeStoreService, overrides: Record<string, unknown> = {}) =>
  store.addEntry({
    type: 'qa',
    title: 'what are the opening hours?',
    content: 'We open 9h to 19h.',
    summary: 'opening hours',
    scope: CHAT,
    source: { author: 'Youssef' },
    ...overrides,
  });

describe('AnswerService', () => {
  it('answers from the community sources and cites where it came from', async () => {
    const { answer, store, claude } = await build();
    const entry = await addEntry(store);
    claude.composed = { answer: 'We open 9h to 19h.', confidence: 0.95, citationIds: [entry.id] };

    const reply = await answer.answer(message({ text: 'chhal mn sa3a katbdaw?' }));

    expect(reply).toContain('We open 9h to 19h.');
    expect(reply).toContain('answered by Youssef');
  });

  it('cites a call by its label and date', async () => {
    const { answer, store, claude } = await build();
    const entry = await addEntry(store, {
      type: 'meeting',
      title: 'Weekly call',
      content: 'We moved the call to Thursday.',
      source: { label: 'Weekly call', date: '2026-09-12' },
    });
    claude.composed = { answer: 'It moved to Thursday.', confidence: 0.9, citationIds: [entry.id] };

    const reply = await answer.answer(message({ text: 'when is the weekly call?' }));

    expect(reply).toContain('Weekly call, 2026-09-12');
  });

  it('counts the entries an answer used', async () => {
    const { answer, store, claude } = await build();
    const entry = await addEntry(store);
    claude.composed = { answer: 'We open 9h to 19h.', confidence: 0.9, citationIds: [entry.id] };

    await answer.answer(message());

    expect(store.findEntry(entry.id)?.useCount).toBe(1);
  });

  describe('when it cannot answer', () => {
    it('records a gap and says so', async () => {
      const { answer, store } = await build();
      await addEntry(store);

      const reply = await answer.answer(message({ text: 'is there parking?' }));

      expect(reply).toBe(NO_ANSWER_REPLY);
      expect(store.openGaps(CHAT)).toHaveLength(1);
      expect(store.openGaps(CHAT)[0]).toMatchObject({
        question: 'is there parking?',
        askedByName: 'Amina',
      });
    });

    it('records a gap when Claude is not confident enough', async () => {
      const { answer, store, claude } = await build({ KNOWLEDGE_MIN_CONFIDENCE: '0.8' });
      const entry = await addEntry(store);
      claude.composed = { answer: 'Maybe 9h?', confidence: 0.4, citationIds: [entry.id] };

      const reply = await answer.answer(message({ text: 'when do you close?' }));

      expect(reply).toBe(NO_ANSWER_REPLY);
      expect(store.openGaps(CHAT)).toHaveLength(1);
    });

    it('records a gap even when nothing has been learned yet', async () => {
      const { answer, store } = await build();

      expect(await answer.answer(message())).toBe(NO_ANSWER_REPLY);
      expect(store.openGaps(CHAT)).toHaveLength(1);
    });

    it('counts repeats of the same unanswered question', async () => {
      const { answer, store } = await build();

      await answer.answer(message({ text: 'is there parking?' }));
      await answer.answer(message({ text: 'is there parking?' }));

      expect(store.openGaps(CHAT)).toHaveLength(1);
      expect(store.openGaps(CHAT)[0]?.timesAsked).toBe(2);
    });
  });

  describe('what it reads', () => {
    it('reads a small knowledge base whole, without a selection call', async () => {
      const { answer, store, claude } = await build({ KNOWLEDGE_MAX_READ: '8' });
      await addEntry(store);
      await addEntry(store, { title: 'second', type: 'note' });

      await answer.answer(message());

      expect(claude.selectCalls).toHaveLength(0);
      expect(claude.composeCalls[0]?.entries).toHaveLength(2);
    });

    it('narrows a large knowledge base by summary first', async () => {
      const { answer, store, claude } = await build({ KNOWLEDGE_MAX_READ: '2' });
      const first = await addEntry(store, { title: 'one', type: 'note' });
      await addEntry(store, { title: 'two', type: 'note' });
      await addEntry(store, { title: 'three', type: 'note' });
      claude.selection = [first.id];

      await answer.answer(message());

      expect(claude.selectCalls).toHaveLength(1);
      expect(claude.composeCalls[0]?.entries.map((entry) => entry.title)).toEqual(['one']);
    });

    it('lets a private chat read every group\'s knowledge', async () => {
      // Someone messaging the bot directly is one member of one community,
      // not a separate audience with its own empty knowledge base.
      const { answer, store, claude } = await build();
      await addEntry(store, { scope: 'group-1', title: 'from group one' });
      await addEntry(store, { scope: 'group-2', title: 'from group two' });

      await answer.answer(message({ isGroup: false, chatId: 'dm-with-amina' }));

      expect(claude.composeCalls[0]?.entries.map((entry) => entry.title)).toEqual([
        'from group one',
        'from group two',
      ]);
    });

    it('keeps groups separate when several communities share one bot', async () => {
      const { answer, store, claude } = await build({
        KNOWLEDGE_PRIVATE_SEES_EVERYTHING: 'false',
      });
      await addEntry(store, { scope: 'group-1', title: 'from group one' });

      await answer.answer(message({ isGroup: false, chatId: 'dm-with-amina' }));

      // Nothing from the other community reaches the model.
      expect(claude.composeCalls[0]?.entries).toEqual([]);
    });

    it('includes community-wide sources alongside this chat', async () => {
      const { answer, store, claude } = await build();
      await addEntry(store, { scope: CHAT, title: 'chat one' });
      await addEntry(store, { scope: GLOBAL_SCOPE, type: 'meeting', title: 'the call' });
      await addEntry(store, { scope: 'other-group', title: 'not mine' });

      await answer.answer(message());

      expect(claude.composeCalls[0]?.entries.map((entry) => entry.title)).toEqual([
        'chat one',
        'the call',
      ]);
    });
  });

  describe('small talk', () => {
    it('answers small talk politely without recording a gap', async () => {
      const { answer, store, claude } = await build();
      await addEntry(store);
      claude.composed = {
        answer: null,
        confidence: 0,
        citationIds: [],
        isCommunityQuestion: false,
      };

      const reply = await answer.answer(message({ text: 'how are you?' }));

      expect(reply).toBe(SMALL_TALK_REPLY);
      // An organiser should never see "how are you?" in the backlog.
      expect(store.openGaps(CHAT)).toHaveLength(0);
    });

    it('still records a gap for a real question Claude could not answer', async () => {
      const { answer, store, claude } = await build();
      await addEntry(store);
      claude.composed = {
        answer: null,
        confidence: 0,
        citationIds: [],
        isCommunityQuestion: true,
      };

      expect(await answer.answer(message({ text: 'is there parking?' }))).toBe(NO_ANSWER_REPLY);
      expect(store.openGaps(CHAT)).toHaveLength(1);
    });
  });

  describe('answers that say nothing', () => {
    it('refuses an answer that only repeats the question', async () => {
      const { answer, store, claude } = await build();
      const entry = await addEntry(store);
      // The failure this guards against: quoting the asker's own words back
      // at them as though they were the community's answer.
      claude.composed = {
        answer: 'Is there parking nearby?',
        confidence: 0.99,
        citationIds: [entry.id],
      };

      const reply = await answer.answer(message({ text: 'is there parking nearby?' }));

      expect(reply).toBe(NO_ANSWER_REPLY);
      expect(store.openGaps(CHAT)).toHaveLength(1);
    });

    it('keeps a real answer that happens to share words with the question', async () => {
      const { answer, store, claude } = await build();
      const entry = await addEntry(store);
      claude.composed = {
        answer: 'Yes, there is parking nearby, behind the building.',
        confidence: 0.9,
        citationIds: [entry.id],
      };

      const reply = await answer.answer(message({ text: 'is there parking nearby?' }));

      expect(reply).toContain('behind the building');
    });
  });

  it('ignores a message that is not a question', async () => {
    const { answer, claude } = await build();

    expect(await answer.answer(message({ text: 'ok thanks' }))).toBeNull();
    expect(claude.composeCalls).toHaveLength(0);
  });

  it('answers anyway when the member used !ask', async () => {
    const { answer, store, claude } = await build();
    const entry = await addEntry(store);
    claude.composed = { answer: 'We open 9h to 19h.', confidence: 0.9, citationIds: [entry.id] };

    const reply = await answer.answer(message({ text: 'opening hours' }), true);

    expect(reply).toContain('We open 9h to 19h.');
  });

  it('stays silent when Claude is not configured', async () => {
    const { answer, store, claude } = await build();
    await addEntry(store);
    claude.enabled = false;

    // No reply at all — not even the "recorded a gap" message, which would be
    // a lie when nothing was ever going to be looked up.
    expect(await answer.answer(message())).toBeNull();
    expect(store.openGaps(CHAT)).toHaveLength(0);
  });
});
