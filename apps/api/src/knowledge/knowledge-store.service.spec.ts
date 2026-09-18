import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KnowledgeStoreService } from './knowledge-store.service.js';
import { loadKnowledgeConfig } from './knowledge.config.js';
import { GLOBAL_SCOPE } from './knowledge.types.js';

const newStore = async (env: Record<string, string> = {}) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kb-'));
  const store = new KnowledgeStoreService(
    loadKnowledgeConfig({ KNOWLEDGE_DATA_DIR: dataDir, ...env }),
  );
  await store.onModuleInit();
  return { store, dataDir };
};

const entry = (overrides: Record<string, unknown> = {}) => ({
  type: 'qa' as const,
  title: 'what are the opening hours?',
  content: 'We open 9h to 19h.',
  summary: 'opening hours',
  scope: 'group-1',
  ...overrides,
});

describe('KnowledgeStoreService', () => {
  it('saves an entry and reads it back from a new instance', async () => {
    const { store, dataDir } = await newStore();
    await store.addEntry(entry());

    const reloaded = new KnowledgeStoreService(
      loadKnowledgeConfig({ KNOWLEDGE_DATA_DIR: dataDir }),
    );
    await reloaded.onModuleInit();

    expect(reloaded.entries()).toHaveLength(1);
    expect(reloaded.entries()[0]?.content).toBe('We open 9h to 19h.');
    await expect(readFile(join(dataDir, 'knowledge.json'), 'utf8')).resolves.toContain('9h to 19h');
  });

  it('serves a chat its own entries plus community-wide ones', async () => {
    const { store } = await newStore();
    await store.addEntry(entry({ scope: 'group-1', title: 'mine' }));
    await store.addEntry(entry({ scope: 'group-2', title: 'theirs' }));
    await store.addEntry(entry({ scope: GLOBAL_SCOPE, type: 'meeting', title: 'the call' }));

    expect(store.entriesFor('group-1').map((item) => item.title)).toEqual(['mine', 'the call']);
  });

  it('replaces a repeated question instead of storing it twice', async () => {
    const { store } = await newStore();
    await store.addEntry(entry({ content: 'old' }));
    await store.addEntry(entry({ title: 'What Are The Opening Hours?', content: 'new' }));

    expect(store.entries()).toHaveLength(1);
    expect(store.entries()[0]?.content).toBe('new');
  });

  it('keeps two meeting chunks with the same title', async () => {
    const { store } = await newStore();
    await store.addEntry(entry({ type: 'meeting', title: 'Weekly call', content: 'part one' }));
    await store.addEntry(entry({ type: 'meeting', title: 'Weekly call', content: 'part two' }));

    expect(store.entries()).toHaveLength(2);
  });

  it('removes every chunk of one import', async () => {
    const { store } = await newStore();
    await store.addEntry(entry({ type: 'meeting', source: { label: 'Call 12 Sep' } }));
    await store.addEntry(entry({ type: 'meeting', source: { label: 'Call 12 Sep' } }));
    await store.addEntry(entry({ type: 'meeting', source: { label: 'Call 19 Sep' } }));

    await expect(store.removeBySourceLabel('Call 12 Sep')).resolves.toBe(2);
    expect(store.entries()).toHaveLength(1);
  });

  it('counts uses of the entries an answer came from', async () => {
    const { store } = await newStore();
    const first = await store.addEntry(entry());
    const second = await store.addEntry(entry({ title: 'another' }));

    await store.markUsed([first.id, second.id, 'missing-id']);

    expect(store.findEntry(first.id)?.useCount).toBe(1);
    expect(store.findEntry(second.id)?.lastUsedAt).toBeTruthy();
  });

  describe('gaps', () => {
    it('records a question nobody answered', async () => {
      const { store } = await newStore();

      const gap = await store.recordGap({ question: 'is there parking?', scope: 'group-1' });

      expect(gap.timesAsked).toBe(1);
      expect(store.openGaps('group-1')).toHaveLength(1);
    });

    it('counts repeats of the same question instead of duplicating it', async () => {
      const { store } = await newStore();
      await store.recordGap({ question: 'is there parking?', scope: 'group-1' });
      await store.recordGap({ question: 'Is There Parking?', scope: 'group-1' });

      const gaps = store.openGaps('group-1');
      expect(gaps).toHaveLength(1);
      expect(gaps[0]?.timesAsked).toBe(2);
    });

    it('keeps the same question separate per chat', async () => {
      const { store } = await newStore();
      await store.recordGap({ question: 'is there parking?', scope: 'group-1' });
      await store.recordGap({ question: 'is there parking?', scope: 'group-2' });

      expect(store.openGaps()).toHaveLength(2);
    });

    it('closes a gap when it is answered', async () => {
      const { store } = await newStore();
      const gap = await store.recordGap({ question: 'is there parking?', scope: 'group-1' });

      await store.resolveGap(gap.id, 'Yes, behind the building.', 'Youssef');

      expect(store.openGaps('group-1')).toHaveLength(0);
      expect(store.gaps()[0]).toMatchObject({
        resolved: true,
        resolvedAnswer: 'Yes, behind the building.',
      });
    });

    it('records a repeat again once the old one was resolved', async () => {
      const { store } = await newStore();
      const gap = await store.recordGap({ question: 'is there parking?', scope: 'group-1' });
      await store.resolveGap(gap.id, 'Yes.');

      await store.recordGap({ question: 'is there parking?', scope: 'group-1' });

      expect(store.openGaps('group-1')).toHaveLength(1);
    });
  });

  describe('archive', () => {
    const message = (chatId: string, text: string, at: Date) => ({
      chatId,
      senderId: 'member',
      text,
      at: at.toISOString(),
    });

    it('returns only messages after the cutoff', async () => {
      const { store } = await newStore();
      const now = Date.now();
      await store.archive(message('g', 'old', new Date(now - 48 * 3600_000)));
      await store.archive(message('g', 'recent', new Date(now - 3600_000)));

      const since = new Date(now - 24 * 3600_000);
      expect(store.archivedSince('g', since).map((item) => item.text)).toEqual(['recent']);
    });

    it('separates chats', async () => {
      const { store } = await newStore();
      await store.archive(message('a', 'in a', new Date()));
      await store.archive(message('b', 'in b', new Date()));

      expect(store.archivedSince('a', new Date(0))).toHaveLength(1);
    });

    it('keeps the newest messages per chat, not globally', async () => {
      const { store } = await newStore({ KNOWLEDGE_ARCHIVE_LIMIT: '3' });

      for (let index = 0; index < 5; index += 1) {
        await store.archive(message('busy', `busy ${index}`, new Date()));
      }
      await store.archive(message('quiet', 'quiet one', new Date()));
      for (let index = 5; index < 10; index += 1) {
        await store.archive(message('busy', `busy ${index}`, new Date()));
      }

      // The quiet chat's only message survives the busy chat's flood.
      expect(store.archivedSince('quiet', new Date(0))).toHaveLength(1);
      expect(store.archivedSince('busy', new Date(0))).toHaveLength(3);
      expect(store.archivedSince('busy', new Date(0)).at(-1)?.text).toBe('busy 9');
    });
  });
});
