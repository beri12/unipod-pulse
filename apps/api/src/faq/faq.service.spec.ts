import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from '../bot/bot.types.js';
import type { FaqMatcherService } from './faq-matcher.service.js';
import { FaqStoreService } from './faq-store.service.js';
import { loadFaqConfig } from './faq.config.js';
import { FaqService } from './faq.service.js';
import type { FaqEntry, FaqMatch } from './faq.types.js';

const GROUP = 'group-1';

const message = (overrides: Partial<IncomingMessage> = {}): IncomingMessage => ({
  channel: 'telegram',
  chatId: GROUP,
  senderId: 'member-1',
  senderName: 'Amina',
  messageId: 'm1',
  text: 'hello',
  isGroup: true,
  mentionedMe: false,
  timestamp: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

/** Matcher stub: returns whatever the test sets, records what it was asked. */
class FakeMatcher {
  enabled = true;
  result: FaqMatch | null = null;
  seen: { question: string; entries: FaqEntry[] }[] = [];

  match(question: string, entries: FaqEntry[]): Promise<FaqMatch | null> {
    this.seen.push({ question, entries });
    return Promise.resolve(this.result);
  }
}

const build = async (env: Record<string, string> = {}) => {
  const directory = await mkdtemp(join(tmpdir(), 'faq-'));
  const config = loadFaqConfig({
    ANTHROPIC_API_KEY: 'test-key',
    FAQ_STORE_PATH: join(directory, 'faq.json'),
    ...env,
  });

  const store = new FaqStoreService(config);
  await store.onModuleInit();

  const matcher = new FakeMatcher();
  const faq = new FaqService(config, store, matcher as unknown as FaqMatcherService);
  return { faq, store, matcher };
};

describe('FaqService.observe (learning from admins)', () => {
  it('learns when an admin replies to a question', async () => {
    const { faq, store } = await build();

    const learned = await faq.observe(
      message({
        senderId: 'admin-1',
        senderName: 'Youssef',
        senderIsAdmin: true,
        text: 'We open 9h to 19h, Monday to Friday.',
        quoted: { text: 'what are the opening hours?', senderId: 'member-2' },
      }),
    );

    expect(learned).toMatchObject({
      question: 'what are the opening hours?',
      answer: 'We open 9h to 19h, Monday to Friday.',
      askedBy: 'member-2',
      answeredBy: 'admin-1',
      answeredByName: 'Youssef',
    });
    expect(store.count()).toBe(1);
  });

  it('ignores a reply from someone who is not an admin', async () => {
    const { faq, store } = await build();

    await faq.observe(
      message({
        senderIsAdmin: false,
        text: 'I think they open at 9',
        quoted: { text: 'what are the opening hours?' },
      }),
    );

    expect(store.count()).toBe(0);
  });

  it('ignores a reply when admin status could not be determined', async () => {
    const { faq, store } = await build();

    await faq.observe(
      message({
        senderIsAdmin: undefined,
        text: 'We open 9h to 19h',
        quoted: { text: 'what are the opening hours?' },
      }),
    );

    expect(store.count()).toBe(0);
  });

  it('ignores an admin message that replies to nothing', async () => {
    const { faq, store } = await build();

    await faq.observe(message({ senderIsAdmin: true, text: 'Good morning everyone' }));

    expect(store.count()).toBe(0);
  });

  it('ignores an admin replying to the bot itself', async () => {
    const { faq, store } = await build();

    await faq.observe(
      message({
        senderIsAdmin: true,
        text: 'that is wrong actually',
        quoted: { text: 'what are the opening hours?', fromBot: true },
      }),
    );

    expect(store.count()).toBe(0);
  });

  it('ignores a reply to something that is not a question', async () => {
    const { faq, store } = await build();

    await faq.observe(
      message({
        senderIsAdmin: true,
        text: 'thank you too',
        quoted: { text: 'thanks everyone, see you tomorrow' },
      }),
    );

    expect(store.count()).toBe(0);
  });

  it('ignores a one-word answer', async () => {
    const { faq, store } = await build();

    await faq.observe(
      message({
        senderIsAdmin: true,
        text: 'yes',
        quoted: { text: 'is the office open on Saturday?' },
      }),
    );

    expect(store.count()).toBe(0);
  });

  it('ignores private chats — only groups teach the bot', async () => {
    const { faq, store } = await build();

    await faq.observe(
      message({
        isGroup: false,
        senderIsAdmin: true,
        text: 'We open 9h to 19h',
        quoted: { text: 'what are the opening hours?' },
      }),
    );

    expect(store.count()).toBe(0);
  });

  it('does not learn when auto-learning is switched off', async () => {
    const { faq, store } = await build({ FAQ_AUTO_LEARN: 'false' });

    await faq.observe(
      message({
        senderIsAdmin: true,
        text: 'We open 9h to 19h',
        quoted: { text: 'what are the opening hours?' },
      }),
    );

    expect(store.count()).toBe(0);
  });
});

describe('FaqService.answer', () => {
  const teach = async (faq: FaqService) =>
    faq.teach(message(), 'what are the opening hours?', 'We open 9h to 19h.');

  it('answers with the admin answer, word for word', async () => {
    const { faq, matcher } = await build();
    const entry = await teach(faq);
    matcher.result = { entry, confidence: 0.95 };

    const answer = await faq.answer(message({ text: 'chhal mn sa3a katbdaw?' }));

    expect(answer).toBe('We open 9h to 19h.');
  });

  it('counts the use', async () => {
    const { faq, store, matcher } = await build();
    const entry = await teach(faq);
    matcher.result = { entry, confidence: 0.95 };

    await faq.answer(message({ text: 'when do you open?' }));

    expect(store.find(entry.id)?.useCount).toBe(1);
  });

  it('stays silent when Claude is not confident enough', async () => {
    const { faq, matcher } = await build({ FAQ_MIN_CONFIDENCE: '0.8' });
    const entry = await teach(faq);
    matcher.result = { entry, confidence: 0.5 };

    expect(await faq.answer(message({ text: 'when do you close?' }))).toBeNull();
  });

  it('stays silent when nothing matches', async () => {
    const { faq, matcher } = await build();
    await teach(faq);
    matcher.result = null;

    expect(await faq.answer(message({ text: 'where can I park?' }))).toBeNull();
  });

  it('does not call Claude for a message that is not a question', async () => {
    const { faq, matcher } = await build();
    await teach(faq);

    expect(await faq.answer(message({ text: 'ok thanks' }))).toBeNull();
    expect(matcher.seen).toHaveLength(0);
  });

  it('does not call Claude when nothing has been learned here', async () => {
    const { faq, matcher } = await build();

    expect(await faq.answer(message({ text: 'what are the hours?' }))).toBeNull();
    expect(matcher.seen).toHaveLength(0);
  });

  it('only considers answers learned in the same chat', async () => {
    const { faq, matcher } = await build();
    await faq.teach(message({ chatId: 'other-group' }), 'what are the hours?', 'other answer');

    expect(await faq.answer(message({ chatId: GROUP, text: 'what are the hours?' }))).toBeNull();
    expect(matcher.seen).toHaveLength(0);
  });

  it('sends only this chat entries to the matcher', async () => {
    const { faq, matcher } = await build();
    await faq.teach(message({ chatId: GROUP }), 'q here', 'a here');
    await faq.teach(message({ chatId: 'other' }), 'q there', 'a there');
    matcher.result = null;

    await faq.answer(message({ text: 'what are the hours?' }));

    expect(matcher.seen[0]?.entries.map((entry) => entry.answer)).toEqual(['a here']);
  });
});
