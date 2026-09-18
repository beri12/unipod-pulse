import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFaqConfig } from './faq.config.js';
import { FaqStoreService } from './faq-store.service.js';

const newStore = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'faq-'));
  const storePath = join(directory, 'nested', 'faq.json');
  const store = new FaqStoreService(loadFaqConfig({ FAQ_STORE_PATH: storePath }));
  await store.onModuleInit();
  return { store, storePath };
};

const pair = (question: string, answer: string, chatId = 'group-1') => ({
  question,
  answer,
  channel: 'telegram' as const,
  chatId,
});

describe('FaqStoreService', () => {
  it('starts empty when there is no file yet', async () => {
    const { store } = await newStore();

    expect(store.count()).toBe(0);
  });

  it('saves an entry and reads it back from disk', async () => {
    const { store, storePath } = await newStore();

    const entry = await store.add(pair('what are the hours?', '9h to 19h'));

    expect(entry.id).toBeTruthy();
    expect(entry.useCount).toBe(0);

    const reloaded = new FaqStoreService(loadFaqConfig({ FAQ_STORE_PATH: storePath }));
    await reloaded.onModuleInit();

    expect(reloaded.count()).toBe(1);
    expect(reloaded.all()[0]).toMatchObject({ question: 'what are the hours?', answer: '9h to 19h' });
  });

  it('creates the directory it needs', async () => {
    const { store, storePath } = await newStore();

    await store.add(pair('q', 'a'));

    await expect(readFile(storePath, 'utf8')).resolves.toContain('"answer": "a"');
  });

  it('replaces the answer when the same question is taught again', async () => {
    const { store } = await newStore();

    await store.add(pair('what are the hours?', 'old answer'));
    await store.add(pair('What Are The Hours?', 'new answer'));

    expect(store.count()).toBe(1);
    expect(store.all()[0]?.answer).toBe('new answer');
  });

  it('keeps the same question separately per chat', async () => {
    const { store } = await newStore();

    await store.add(pair('what are the hours?', 'group one', 'group-1'));
    await store.add(pair('what are the hours?', 'group two', 'group-2'));

    expect(store.count()).toBe(2);
  });

  it('counts uses', async () => {
    const { store } = await newStore();
    const entry = await store.add(pair('q', 'a'));

    await store.markUsed(entry.id);
    await store.markUsed(entry.id);

    expect(store.find(entry.id)?.useCount).toBe(2);
    expect(store.find(entry.id)?.lastUsedAt).toBeTruthy();
  });

  it('removes an entry', async () => {
    const { store } = await newStore();
    const entry = await store.add(pair('q', 'a'));

    await expect(store.remove(entry.id)).resolves.toBe(true);
    await expect(store.remove(entry.id)).resolves.toBe(false);
    expect(store.count()).toBe(0);
  });

  it('starts empty on a corrupt file without destroying it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'faq-'));
    const storePath = join(directory, 'faq.json');
    await writeFile(storePath, '{ this is not json', 'utf8');

    const store = new FaqStoreService(loadFaqConfig({ FAQ_STORE_PATH: storePath }));
    await store.onModuleInit();

    expect(store.count()).toBe(0);
    // The unreadable file is left alone so it can be recovered by hand.
    await expect(readFile(storePath, 'utf8')).resolves.toBe('{ this is not json');
  });
});
