import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from '../bot/bot.types.js';
import type { KnowledgeClaudeService } from './claude.service.js';
import { IngestService } from './ingest.service.js';
import { KnowledgeStoreService } from './knowledge-store.service.js';
import { loadKnowledgeConfig } from './knowledge.config.js';
import { GLOBAL_SCOPE } from './knowledge.types.js';

const message = (overrides: Partial<IncomingMessage> = {}): IncomingMessage => ({
  channel: 'telegram',
  chatId: 'group-1',
  senderId: 'admin-1',
  senderName: 'Youssef',
  messageId: 'm1',
  text: 'We open 9h to 19h, Monday to Friday.',
  isGroup: true,
  mentionedMe: false,
  timestamp: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const build = async (env: Record<string, string> = {}) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kb-'));
  const config = loadKnowledgeConfig({ KNOWLEDGE_DATA_DIR: dataDir, ...env });

  const store = new KnowledgeStoreService(config);
  await store.onModuleInit();

  const claude = {
    enabled: false,
    summarise: async (title: string) => `summary of ${title}`,
  } as unknown as KnowledgeClaudeService;

  return { ingest: new IngestService(config, store, claude), store };
};

describe('IngestService.learnFromAdminReply', () => {
  const adminReply = (overrides: Partial<IncomingMessage> = {}) =>
    message({
      senderIsAdmin: true,
      quoted: { text: 'what are the opening hours?', senderId: 'member-2' },
      ...overrides,
    });

  it('learns when an admin replies to a question', async () => {
    const { ingest, store } = await build();

    const entry = await ingest.learnFromAdminReply(adminReply());

    expect(entry).toMatchObject({
      type: 'qa',
      title: 'what are the opening hours?',
      content: 'We open 9h to 19h, Monday to Friday.',
      scope: 'group-1',
    });
    expect(entry?.source?.author).toBe('Youssef');
    expect(store.entries()).toHaveLength(1);
  });

  it.each([
    ['a member who is not an admin', { senderIsAdmin: false }],
    ['a sender whose admin status is unknown', { senderIsAdmin: undefined }],
    ['a message that replies to nothing', { quoted: undefined }],
    [
      'a reply to the bot itself',
      { quoted: { text: 'what are the opening hours?', fromBot: true } },
    ],
    ['a reply to something that is not a question', { quoted: { text: 'see you tomorrow' } }],
    ['a one-word answer', { text: 'yes' }],
    ['a private chat', { isGroup: false }],
  ])('ignores %s', async (_label, overrides) => {
    const { ingest, store } = await build();

    await ingest.learnFromAdminReply(adminReply(overrides as Partial<IncomingMessage>));

    expect(store.entries()).toHaveLength(0);
  });

  it('does not learn when auto-learning is switched off', async () => {
    const { ingest, store } = await build({ KNOWLEDGE_AUTO_LEARN: 'false' });

    await ingest.learnFromAdminReply(adminReply());

    expect(store.entries()).toHaveLength(0);
  });
});

describe('IngestService.ingestDocument', () => {
  const transcript = [
    'Youssef: welcome to the weekly call.',
    'Youssef: we decided to move the call to Thursday at 18h.',
    'Amina: is the room still booked until 20h?',
    'Sara: yes, until 20h every Thursday.',
  ].join('\n');

  it('imports a call transcript as community-wide knowledge', async () => {
    const { ingest, store } = await build();

    const entries = await ingest.ingestDocument({
      title: 'Weekly call 12 Sep',
      content: transcript,
      type: 'meeting',
      date: '2026-09-12',
    });

    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toMatchObject({ type: 'meeting', scope: GLOBAL_SCOPE });
    expect(entries[0]?.source?.label).toBe('Weekly call 12 Sep');
    expect(store.entries()).toHaveLength(entries.length);
  });

  it('gives every chunk a summary for later retrieval', async () => {
    const { ingest } = await build();

    const entries = await ingest.ingestDocument({ title: 'Notes', content: transcript });

    for (const entry of entries) expect(entry.summary).toBeTruthy();
  });

  it('splits a long transcript and numbers the parts in the title', async () => {
    const { ingest } = await build({ KNOWLEDGE_CHUNK_SIZE: '120', KNOWLEDGE_CHUNK_OVERLAP: '0' });

    const entries = await ingest.ingestDocument({ title: 'Long call', content: transcript });

    expect(entries.length).toBeGreaterThan(1);
    expect(entries[0]?.title).toContain('part 1/');
  });

  it('replaces a previous import of the same call instead of duplicating it', async () => {
    const { ingest, store } = await build();

    await ingest.ingestDocument({ title: 'Weekly call', content: transcript });
    const firstCount = store.entries().length;
    await ingest.ingestDocument({ title: 'Weekly call', content: transcript });

    expect(store.entries()).toHaveLength(firstCount);
  });

  it('can scope a document to one chat', async () => {
    const { ingest } = await build();

    const entries = await ingest.ingestDocument({
      title: 'Group rules',
      content: 'Be kind.',
      type: 'note',
      scope: 'group-1',
    });

    expect(entries[0]?.scope).toBe('group-1');
  });

  it('imports nothing for empty content', async () => {
    const { ingest, store } = await build();

    await expect(ingest.ingestDocument({ title: 'Empty', content: '   ' })).resolves.toEqual([]);
    expect(store.entries()).toHaveLength(0);
  });
});
